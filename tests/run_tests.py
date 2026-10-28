import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
source=Path(sys.argv[1]).resolve()
if not source.is_file():
 print('Preview file not found:',source,file=sys.stderr)
 sys.exit(2)
# Deployment safety checks: fail closed if preview/test/prod endpoints are mixed.
repo_root=Path(__file__).resolve().parent.parent
prod=(repo_root/'index.html').read_text()
preview=(repo_root/'identity-preview.html').read_text()
cloud_test=(repo_root/'cloud-test.html').read_text()
assert 'hennrsqbxvrwmdizdnzg.supabase.co' in prod, 'Production endpoint unexpectedly changed'
assert 'kixnyvgqtznjzdrvbweb.supabase.co' not in prod, 'Test endpoint found in production'
assert 'hennrsqbxvrwmdizdnzg.supabase.co' not in preview, 'Production endpoint found in offline preview'
assert 'hennrsqbxvrwmdizdnzg.supabase.co' not in cloud_test, 'Production endpoint found in cloud test'
assert 'kixnyvgqtznjzdrvbweb.supabase.co' in cloud_test, 'Cloud test endpoint missing'
assert 'tx-repeat-frequency' in prod and 'tx-repeat-frequency' in preview, 'Recurring UI missing from candidate'
assert 'tx-repeat-frequency' in cloud_test, 'Recurring UI missing from cloud test'
assert "const K='meow_cloud_test_v1'" in cloud_test, 'Cloud test local storage key incorrect'
assert "const ROLE_KEY='meow_cloud_test_personal_role_'" in cloud_test, 'Cloud test role key incorrect'
results=[]
def check(name,fn):
 try:
  fn();results.append({'test':name,'status':'PASS'})
 except Exception as exc:
  results.append({'test':name,'status':'FAIL','detail':str(exc)[:400]})
def assert_visible(page,sel):
 assert page.locator(sel).is_visible(),sel
def assert_hidden(page,sel):
 assert page.locator(sel).is_hidden(),sel
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(source.as_uri(),wait_until='domcontentloaded')
 page.wait_for_timeout(600)
 check('No production Supabase endpoint in preview',lambda: (_ for _ in ()).throw(AssertionError('production URL present')) if 'hennrsqbxvrwmdizdnzg.supabase.co' in source.read_text() else None)
 check('Amount visible',lambda: assert_visible(page,'#tx-amount'))
 check('Recurring details hidden',lambda: assert_hidden(page,'#tx-repeat-options'))
 def expand():
  page.locator('#tx-repeat').check();assert_visible(page,'#tx-repeat-options')
  page.locator('#tx-repeat').uncheck();assert_hidden(page,'#tx-repeat-options')
 check('Recurring checkbox expands and collapses',expand)
 def focus():
  page.evaluate("switchTab('records');switchTab('add')");page.wait_for_timeout(300)
  assert page.evaluate('document.activeElement.id')=='tx-amount'
 check('Amount auto-focus',focus)
 def footer():
  page.evaluate("document.querySelector('main').scrollTop=900")
  b=page.locator('#submit-btn').bounding_box();n=page.locator('#nav').bounding_box()
  assert b and n and b['y']+b['height']<=n['y']+2
 check('Save button remains above nav',footer)
 def basic():
  page.evaluate("switchTab('add');U.type='expense';U.group='Mrs Meow';U.payer='Mrs Meow';U.cat=S.cats.find(c=>c.type==='expense'&&!c.parentId&&!c.archived).id")
  page.locator('#tx-amount').fill('10')
  before=page.evaluate('S.tx.length')
  page.locator('#submit-btn').click()
  assert page.evaluate('S.tx.length')==before+1
 check('Save expense',basic)
 def invalid_amount():
  page.evaluate("switchTab('add');U.cat=S.cats.find(c=>c.type==='expense'&&!c.parentId&&!c.archived).id")
  page.locator('#tx-amount').fill('0')
  before=page.evaluate('S.tx.length')
  page.locator('#submit-btn').click()
  assert page.evaluate('S.tx.length')==before
 check('Reject zero amount',invalid_amount)
 def invalid_end_date():
  page.locator('#tx-amount').fill('20')
  page.locator('#tx-date').fill('2026-10-28')
  page.locator('#tx-repeat').check()
  page.locator('#tx-repeat-end').fill('2026-10-27')
  before=page.evaluate('[S.tx.length,S.recurring.length]')
  page.locator('#submit-btn').click()
  assert page.evaluate('[S.tx.length,S.recurring.length]')==before
  page.locator('#tx-repeat-end').fill('')
  page.locator('#tx-repeat').uncheck()
 check('Reject recurring end before start',invalid_end_date)
 def recurrence():
  page.evaluate("switchTab('add');U.type='expense';U.group='Mrs Meow';U.payer='Mrs Meow';U.cat=S.cats.find(c=>c.type==='expense'&&!c.parentId&&!c.archived).id")
  page.locator('#tx-amount').fill('15')
  page.locator('#tx-repeat').check()
  page.locator('#tx-repeat-frequency').select_option('monthly')
  page.locator('#tx-date').fill('2026-10-28')
  before=page.evaluate('S.recurring.length')
  page.locator('#submit-btn').click()
  assert page.evaluate('S.recurring.length')==before+1
  assert page.evaluate('S.recurring.at(-1).nextDue')=='2026-11-28'
 check('Monthly recurrence creates next due date',recurrence)
 def dedup():
  page.evaluate("materializeDueRecurring('2026-11-29')")
  a=page.evaluate('S.planned.filter(x=>x.dueDate==="2026-11-28").length')
  page.evaluate("materializeDueRecurring('2026-11-29')")
  b=page.evaluate('S.planned.filter(x=>x.dueDate==="2026-11-28").length')
  assert a==b==1,(a,b)
 check('No duplicate pending occurrence',dedup)
 def leap():
  assert page.evaluate("nextOccurrence('2026-01-31','monthly',31,0)")=='2026-02-28'
  assert page.evaluate("nextOccurrence('2028-01-31','monthly',31,0)")=='2028-02-29'
 check('Month-end and leap-year schedule',leap)
 def role():
  page.evaluate("setMyRole('Mr Meow');switchTab('records');switchTab('add')")
  page.wait_for_timeout(300)
  assert page.evaluate("U.group")=='Mr Meow'
  assert page.evaluate("U.payer")=='Mr Meow'
  assert page.evaluate("groupOrder().at(-1)")=='共同'
 check('Mr Meow defaults and shared last',role)
 def weekly_yearly():
  assert page.evaluate("nextOccurrence('2026-10-28','weekly')")=='2026-11-04'
  assert page.evaluate("nextOccurrence('2028-02-29','yearly',29,1)")=='2029-02-28'
 check('Weekly and yearly recurrence dates',weekly_yearly)
 def storage():
  # Compare the persisted snapshot after the app's documented load normalization.
  # Also check that saving/reloading does not lose transactions or recurring data.
  before=page.evaluate("""() => ({memory:JSON.parse(JSON.stringify(S)),disk:JSON.parse(localStorage.getItem(K))})""")
  assert before['disk'] is not None,'No saved local state'
  expected=page.evaluate("""raw => normalizeState(JSON.parse(JSON.stringify(raw)))""",before['disk'])
  page.reload(wait_until='domcontentloaded')
  page.wait_for_timeout(300)
  after=page.evaluate("JSON.parse(JSON.stringify(S))")
  if after!=expected:
   keys=set(expected)|set(after)
   differences={k:{'expected':str(expected.get(k))[:180],'actual':str(after.get(k))[:180]} for k in keys if expected.get(k)!=after.get(k)}
   raise AssertionError('Reload differs from persisted normalized state: '+str(differences)[:900])
  for key in ('tx','recurring','planned','repayments'):
   assert len(after.get(key,[]))==len(expected.get(key,[])),key+' record count changed'
 check('Local data survives reload',storage)
 def custom_split():
  page.evaluate("""S.recurring.push({id:'test-custom-split',type:'expense',group:'共同',payer:'Mrs Meow',amount:1000,shares:{'Mrs Meow':700,'Mr Meow':300},categoryId:'c1',note:'custom split test',frequency:'monthly',startDate:'2026-12-01',nextDue:'2026-12-01',anchorDay:1,anchorMonth:11,endDate:'2026-12-01',paused:false})""")
  page.evaluate("materializeDueRecurring('2026-12-01')")
  assert page.evaluate("S.planned.find(p=>p.recurringId==='test-custom-split').shares['Mrs Meow']")==700
  page.evaluate("postPlanned(S.planned.find(p=>p.recurringId==='test-custom-split').id)")
  shares=page.evaluate("S.tx.find(t=>t.recurringId==='test-custom-split').shares")
  assert shares=={'Mrs Meow':700,'Mr Meow':300},shares
 check('Custom shared split preserved when recurring posts',custom_split)
 def reject_corrupt_shares():
  state=page.evaluate("JSON.stringify(S)")
  result=page.evaluate("""raw => {
   const bad=JSON.parse(raw);
   const r=bad.recurring.find(x=>x.id==='test-custom-split');
   r.shares={'Mrs Meow':700,'Mr Meow':400};
   try {normalizeState(bad);return 'accepted'}catch(e){return e.message}
  }""",state)
  assert result!='accepted',result
 check('Reject inconsistent recurring split in imported backup',reject_corrupt_shares)
 check('No uncaught page errors',lambda: (_ for _ in ()).throw(AssertionError(str(errors))) if errors else None)
 # Cloud preview browser checks without logging in or writing to Supabase.
 cloud_page=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
 cloud_errors=[]
 cloud_page.on('pageerror',lambda e:cloud_errors.append(str(e)))
 cloud_page.goto((repo_root/'cloud-test.html').as_uri(),wait_until='domcontentloaded')
 cloud_page.wait_for_timeout(600)
 def cloud_endpoint():
  assert cloud_page.evaluate("CLOUD_CONFIG.url")=='https://kixnyvgqtznjzdrvbweb.supabase.co'
  assert cloud_page.evaluate("K")=='meow_cloud_test_v1'
  assert cloud_page.evaluate("cloudReady()"),'Test Supabase client not initialized'
 check('Cloud preview uses isolated Supabase configuration',cloud_endpoint)
 check('Cloud preview has recurring amount input',lambda: assert_visible(cloud_page,'#tx-amount'))
 def cloud_recurring():
  cloud_page.locator('#tx-repeat').check()
  assert_visible(cloud_page,'#tx-repeat-options')
  cloud_page.locator('#tx-repeat-frequency').select_option('yearly')
  assert cloud_page.locator('#tx-repeat-frequency').input_value()=='yearly'
 check('Cloud preview recurring controls work',cloud_recurring)
 check('Cloud preview has no uncaught browser errors',lambda: (_ for _ in ()).throw(AssertionError(str(cloud_errors))) if cloud_errors else None)
 cloud_page.close()
 browser.close()
Path('test-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps(results,ensure_ascii=False,indent=2))
sys.exit(1 if any(r['status']=='FAIL' for r in results) else 0)
