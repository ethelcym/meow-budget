const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('cloud-test.html','utf8');
const start=html.indexOf('function buildFreshStartState(source)');
const end=html.indexOf('function resetAll()',start);
assert.ok(start>=0&&end>start,'pure cutover helper must exist');
const transform=vm.runInNewContext('('+html.slice(start,end).trim()+')',{normalizeState:s=>{if(!s||!Array.isArray(s.tx)||!Array.isArray(s.cats)||!s.budgets)throw new Error('invalid backup');return s;}});
const original={cats:[{id:'food',name:'Food',type:'expense'}],budgets:{'共同':{food:1000},'Mrs Meow':{},'Mr Meow':{}},tx:[{id:'test',amount:1}],repayments:[{id:'settlement'}],recurring:[{id:'monthly'}],planned:[{id:'future'}],version:1,customSetting:'retain'};
test('November transform removes trial ledger, settlements, recurring and planned entries',()=>{
 const cleaned=transform(original);
 for(const key of ['tx','repayments','recurring','planned'])assert.equal(cleaned[key].length,0,key);
 assert.equal(cleaned.cats[0].name,'Food');
 assert.equal(cleaned.budgets['共同'].food,1000);
 assert.equal(cleaned.customSetting,'retain');
 assert.equal(original.tx.length,1,'input must remain unchanged');
});
test('November transform is repeatable and does not restore demo entries',()=>{
 const once=transform(original),twice=transform(once);
 assert.deepEqual(JSON.parse(JSON.stringify(twice)),JSON.parse(JSON.stringify(once)));
 assert.equal(once.tx.length,0);
});
test('cutover helper is not automatically invoked or attached to reset button',()=>{
 assert.equal((html.match(/buildFreshStartState\(/g)||[]).length,1);
 assert.match(html,/onclick="resetAll\(\)"/);
});

test('malformed input is rejected rather than cleared',()=>{
 assert.throws(()=>transform({tx:[],cats:null,budgets:{}}),/invalid backup/);
});
test('the helper does not mutate nested original settings',()=>{
 const result=transform(original);
 result.budgets['共同'].food=500;
 result.cats[0].name='changed';
 assert.equal(original.budgets['共同'].food,1000);
 assert.equal(original.cats[0].name,'Food');
});

// Explicitly protect household configuration and user preferences from cutover cleanup.
test('fresh start preserves household configuration, identity and preferences',()=>{
 const source={...original,householdId:'household-keep',inviteCode:'invite-keep',members:[{role:'owner',user_id:'member-keep'}],role:'Mrs Meow',preferences:{currency:'HKD',theme:'light'}};
 const cleaned=transform(source);
 assert.equal(cleaned.householdId,'household-keep');
 assert.equal(cleaned.inviteCode,'invite-keep');
 assert.equal(cleaned.members[0].user_id,'member-keep');
 assert.equal(cleaned.role,'Mrs Meow');
 assert.equal(cleaned.preferences.currency,'HKD');
 assert.equal(cleaned.preferences.theme,'light');
 for(const key of ['tx','repayments','recurring','planned'])assert.deepEqual(JSON.parse(JSON.stringify(cleaned[key])),[]);
});

test('fresh-start helper works with the REAL normalizeState and linked recurring/planned records',()=>{
 const normalStart=html.indexOf('function normalizeState(s)');
 const normalEnd=html.indexOf('function load()',normalStart);
 assert.ok(normalStart>=0&&normalEnd>normalStart,'real state normalizer found');
 const context={G:['共同','Mrs Meow','Mr Meow'],P:['Mrs Meow','Mr Meow']};
 vm.createContext(context);
 vm.runInContext(html.slice(normalStart,normalEnd),context);
 const actual=vm.runInContext('('+html.slice(start,end).trim()+')',context);
 const sample={
  cats:[{id:'food',name:'Food',type:'expense'}],
  budgets:{'共同':{food:1000},'Mrs Meow':{},'Mr Meow':{}},
  tx:[{id:'trial',type:'expense',group:'共同',amount:100,date:'2026-10-29',categoryId:'food',payer:'Mrs Meow',shares:{'Mrs Meow':50,'Mr Meow':50}}],
  recurring:[{id:'rec1',frequency:'monthly',startDate:'2026-10-01',nextDue:'2026-11-01',categoryId:'food',group:'共同',amount:100,payer:'Mrs Meow'}],
  planned:[{id:'plan1',recurringId:'rec1',dueDate:'2026-11-01',amount:100,status:'planned'}],
  repayments:[{id:'rep1',from:'Mr Meow',to:'Mrs Meow',amount:50,date:'2026-10-29'}],
  customSetting:{review:'monthly'}
 };
 const result=actual(sample);
 for(const k of ['tx','recurring','planned','repayments'])assert.equal(result[k].length,0,k);
 assert.equal(result.budgets['共同'].food,1000);
 assert.equal(result.cats[0].name,'Food');
 assert.equal(result.customSetting.review,'monthly');
 assert.equal(sample.tx.length,1,'original remains unchanged');
 assert.equal(sample.recurring.length,1,'original recurring remains unchanged');
});

test('real normalizer refuses invalid linked trial data rather than silently wiping it',()=>{
 const normalStart=html.indexOf('function normalizeState(s)');
 const normalEnd=html.indexOf('function load()',normalStart);
 const context={G:['共同','Mrs Meow','Mr Meow'],P:['Mrs Meow','Mr Meow']};
 vm.createContext(context);
 vm.runInContext(html.slice(normalStart,normalEnd),context);
 const actual=vm.runInContext('('+html.slice(start,end).trim()+')',context);
 const invalid={cats:[{id:'food',name:'Food',type:'expense'}],budgets:{'共同':{food:1000}},tx:[],recurring:[{id:'r1',frequency:'monthly',startDate:'2026-10-01',nextDue:'2026-11-01',categoryId:'missing',group:'共同',amount:1}],planned:[],repayments:[]};
 assert.throws(()=>actual(invalid),/週期交易資料不完整/);
 assert.equal(invalid.recurring.length,1,'failed cutover must not mutate source');
});
