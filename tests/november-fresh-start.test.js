const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('cloud-test.html','utf8');
const start=html.indexOf('function buildFreshStartState(source)');
const end=html.indexOf('function resetAll()',start);
assert.ok(start>=0&&end>start,'pure cutover helper must exist');
const transform=vm.runInNewContext('('+html.slice(start,end).trim()+')',{normalizeState:s=>s});
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
