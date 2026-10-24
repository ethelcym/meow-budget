const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/202610240001_add_app_state_revision.sql',
  'utf8'
);

function saveWithRevision(row, expectedRevision, nextState) {
  if (row.revision !== expectedRevision) {
    const error = new Error('REVISION_CONFLICT');
    error.code = 'REVISION_CONFLICT';
    throw error;
  }
  row.state = structuredClone(nextState);
  row.revision += 1;
  return row.revision;
}

test('stale writer is rejected and does not overwrite the newer cloud state', () => {
  const cloud = { revision: 4, state: { expenses: ['base'] } };
  const deviceARevision = cloud.revision;
  const deviceBRevision = cloud.revision;

  saveWithRevision(cloud, deviceARevision, { expenses: ['base', 'from-A'] });
  const afterA = structuredClone(cloud);

  assert.throws(
    () => saveWithRevision(cloud, deviceBRevision, { expenses: ['base', 'from-B'] }),
    error => error.code === 'REVISION_CONFLICT'
  );
  assert.deepEqual(cloud, afterA);
  assert.deepEqual(cloud.state.expenses, ['base', 'from-A']);
  assert.equal(cloud.revision, 5);
});

test('two sequential writers with a refreshed revision can both save', () => {
  const cloud = { revision: 1, state: { marker: 'initial' } };
  const revisionAfterFirst = saveWithRevision(cloud, 1, { marker: 'first' });
  assert.equal(revisionAfterFirst, 2);
  const revisionAfterSecond = saveWithRevision(cloud, revisionAfterFirst, { marker: 'second' });
  assert.equal(revisionAfterSecond, 3);
  assert.deepEqual(cloud.state, { marker: 'second' });
});

test('database RPC implements compare-and-swap and explicit conflict response', () => {
  assert.match(migration, /a\.revision = p_expected_revision/i);
  assert.match(migration, /RAISE EXCEPTION 'REVISION_CONFLICT'/i);
  assert.match(migration, /revision = a\.revision \+ 1/i);
});

test('client pauses automatic overwrite on conflict and preserves local edits', () => {
  assert.match(html, /REVISION_CONFLICT/);
  assert.match(html, /cloudConflict=true;cloudLocalDirty=true/);
  assert.match(html, /本機修改已保留/);
  const start = html.indexOf('function subscribeCloud()');
  const end = html.indexOf('async function signOutCloud()', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const realtime = html.slice(start, end);
  assert.match(realtime, /if\(cloudLocalDirty\)\s*\{[\s\S]*?cloudConflict=true/);
  assert.ok(
    realtime.indexOf('if(cloudLocalDirty)') < realtime.indexOf('S=normalizeState(payload.new.state)'),
    'remote payload must not replace local state before the dirty-state guard'
  );
});

test('isolated acceptance branch targets test project, not production project', () => {
  assert.match(html, /https:\/\/kixnyvgqtznjzdrvbweb\.supabase\.co/);
  assert.doesNotMatch(html, /https:\/\/hennrsqbxvrwmdizdnzg\.supabase\.co/);
});
