const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/202610240001_add_app_state_revision.sql',
  'utf8'
);
const baseline = fs.readFileSync(
  'supabase/migrations/202610240000_initial_shared_household_schema.sql',
  'utf8'
);

test('sync client uses household-scoped revision-checked RPC instead of unconditional state upsert', () => {
  assert.match(html, /rpc\('save_app_state',\s*\{p_household_id:householdId,p_expected_revision:expectedRevision,p_state:JSON\.parse\(snapshot\)\}\)/);
  assert.match(html, /select\('state,revision'\)/);
  assert.match(html, /cloudRevision=Number\(data\)/);
  assert.doesNotMatch(html, /from\('app_state'\)\.upsert\(\{household_id:householdId,state:JSON\.parse\(snapshot\)/);
});

test('stale revision is treated as a conflict and local changes are retained', () => {
  assert.match(html, /REVISION_CONFLICT/);
  assert.match(html, /cloudConflict=true;cloudLocalDirty=true/);
  assert.match(html, /已暫停自動同步/);
  assert.match(html, /本機修改已保留/);
});

test('Realtime does not replace local state when there are unsynced edits', () => {
  const start = html.indexOf('function subscribeCloud()');
  const end = html.indexOf('async function signOutCloud()', start);
  assert.notEqual(start, -1, 'subscribeCloud function should exist');
  assert.notEqual(end, -1, 'subscribeCloud function boundary should exist');
  const realtime = html.slice(start, end);
  assert.match(realtime, /if\(cloudLocalDirty\)\s*\{[\s\S]*?cloudConflict=true/);
  assert.ok(
    realtime.indexOf('if(cloudLocalDirty)') < realtime.indexOf('S=normalizeState(payload.new.state)'),
    'local dirty-state guard must run before remote state replacement'
  );
  assert.match(realtime, /incomingRevision<=Number\(cloudRevision\|\|0\)/);
});

test('Realtime handles same-account devices and acknowledges identical in-flight saves', () => {
  const start = html.indexOf('function subscribeCloud()');
  const end = html.indexOf('async function signOutCloud()', start);
  const realtime = html.slice(start, end);
  assert.doesNotMatch(realtime, /payload\.new\.updated_by!==cloudUser\?\.id/);
  assert.match(realtime, /JSON\.stringify\(incomingState\)===JSON\.stringify\(S\)/);
  assert.match(realtime, /cloudRevision=incomingRevision\|\|cloudRevision/);
  assert.match(realtime, /cloudConflict=true;setCloudStatus/);
});

test('revision migration adds a counter and contains no destructive state operations', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1/i);
  assert.match(migration, /UPDATE public\.app_state/i);
  assert.match(migration, /revision = a\.revision \+ 1/i);
  assert.match(migration, /a\.revision = p_expected_revision/i);
  assert.match(migration, /RAISE EXCEPTION 'REVISION_CONFLICT'/i);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM public\.app_state/i);
});

test('save RPC is household-scoped and uses a fixed search path with restricted execution', () => {
  assert.match(migration, /p_household_id uuid/i);
  assert.match(migration, /SECURITY DEFINER/i);
  assert.match(migration, /SET search_path = pg_catalog, public/i);
  assert.match(migration, /a\.household_id = p_household_id/i);
  assert.match(migration, /hm\.household_id = a\.household_id/i);
  assert.match(migration, /hm\.user_id = auth\.uid\(\)/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.save_app_state\(uuid, bigint, jsonb\) FROM PUBLIC/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.save_app_state\(uuid, bigint, jsonb\) FROM anon/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.save_app_state\(uuid, bigint, jsonb\) TO authenticated/i);
  assert.match(migration, /REVOKE UPDATE ON TABLE public\.app_state FROM authenticated/i);
});

test('migration rejects invalid expected revisions and null state', () => {
  assert.match(migration, /p_expected_revision IS NULL OR p_expected_revision < 1/i);
  assert.match(migration, /p_state IS NULL/i);
  assert.match(migration, /RAISE EXCEPTION 'INVALID_EXPECTED_REVISION'/i);
  assert.match(migration, /RAISE EXCEPTION 'INVALID_STATE'/i);
});

test('baseline creates household tables, RLS, unique user membership, and restricted RPC grants', () => {
  assert.match(baseline, /CREATE TABLE public\.households/i);
  assert.match(baseline, /CREATE TABLE public\.household_members/i);
  assert.match(baseline, /CREATE TABLE public\.app_state/i);
  assert.match(baseline, /ALTER TABLE public\.app_state ENABLE ROW LEVEL SECURITY/i);
  assert.match(baseline, /UNIQUE \(user_id\)/i);
  assert.match(baseline, /REVOKE ALL ON FUNCTION public\.join_household\(text\) FROM PUBLIC/i);
  assert.match(baseline, /REVOKE ALL ON TABLE public\.households, public\.household_members, public\.app_state FROM anon/i);
  assert.doesNotMatch(baseline, /GRANT[^;]*UPDATE[^;]*app_state/i);
  assert.doesNotMatch(baseline, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test('browser source does not include a service-role secret key', () => {
  assert.doesNotMatch(html, /service_role\s*[:=]\s*['"][^'"]+['"]/i);
});

const additive = fs.readFileSync('docs/sql/production-additive-cas-stage-draft.sql','utf8');
test('staged production CAS draft keeps legacy UPDATE until separately approved enforcement',()=>{
 assert.match(additive,/ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1/i);
 assert.match(additive,/CREATE OR REPLACE FUNCTION public\.save_app_state/i);
 assert.match(additive,/REVOKE ALL ON FUNCTION public\.save_app_state\(uuid, bigint, jsonb\) FROM PUBLIC/i);
 assert.match(additive,/GRANT EXECUTE ON FUNCTION public\.save_app_state\(uuid, bigint, jsonb\) TO authenticated/i);
 assert.doesNotMatch(additive,/REVOKE\s+UPDATE\s+ON\s+TABLE\s+public\.app_state/i);
 assert.doesNotMatch(additive,/\b(?:TRUNCATE|DROP TABLE|DELETE FROM public\.app_state)\b/i);
});

test('personal expense defaults follow device role and shared option stays last', () => {
 assert.match(html, /function loadMyRole\(\)[\s\S]*?U\.group=myRole;U\.payer=myRole/);
 assert.match(html, /function groupOrder\(\)\{return \[myRole,myRole==='Mrs Meow'\?'Mr Meow':'Mrs Meow','共同'\]\}/);
 assert.match(html, /function setMyRole\(role\)[\s\S]*?U\.group=role;U\.payer=role/);
});

test('cloud save never silently overwrites a stale revision', () => {
 const start=html.indexOf('function scheduleCloudSave()');
 const end=html.indexOf('function subscribeCloud()',start);
 assert.ok(start>=0&&end>start);
 const code=html.slice(start,end);
 assert.match(code,/if\(!Number\.isInteger\(expectedRevision\)\|\|expectedRevision<1\)throw/);
 assert.match(code,/cloudConflict=true;cloudLocalDirty=true/);
 assert.match(code,/if\(cloudConflict\)return/);
 assert.match(code,/if\(JSON\.stringify\(S\)===snapshot\)/);
});
