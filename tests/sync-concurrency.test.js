const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/202610240001_add_app_state_revision.sql',
  'utf8'
);

test('sync client uses revision-checked RPC instead of unconditional state upsert', () => {
  assert.match(html, /rpc\('save_app_state',\s*\{p_expected_revision:expectedRevision,p_state:JSON\.parse\(snapshot\)\}\)/);
  assert.match(html, /select\('state,revision'\)/);
  assert.match(html, /cloudRevision=Number\(data\)/);
  assert.doesNotMatch(html, /from\('app_state'\)\.upsert\(\{household_id:householdId,state:JSON\.parse\(snapshot\)/);
});

test('stale revision is treated as a conflict and local changes are retained', () => {
  assert.match(html, /REVISION_CONFLICT/);
  assert.match(html, /cloudConflict=true;cloudLocalDirty=true/);
  assert.match(html, /已暫停自動同步/);
});

test('migration adds a non-null revision counter without replacing existing state', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1/i);
  assert.match(migration, /UPDATE public\.app_state/i);
  assert.match(migration, /revision = revision \+ 1/i);
  assert.match(migration, /AND revision = p_expected_revision/i);
  assert.match(migration, /RAISE EXCEPTION 'REVISION_CONFLICT'/i);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM public\.app_state/i);
});

test('save RPC requires authentication and restricts execution grants', () => {
  assert.match(migration, /IF auth\.uid\(\) IS NULL THEN/i);
  assert.match(migration, /SECURITY INVOKER/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.save_app_state\(bigint, jsonb\) FROM anon/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.save_app_state\(bigint, jsonb\) TO authenticated/i);
});
