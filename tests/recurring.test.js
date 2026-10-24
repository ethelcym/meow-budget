const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, 'missing function ' + name);
  const next = html.indexOf('\nfunction ', start + marker.length);
  return html.slice(start, next < 0 ? html.indexOf('\n}', start) + 2 : next);
}
function contextFor(state, today) {
  const context = {
    S: state,
    ld: () => today,
    pad: n => String(n).padStart(2, '0'),
    uid: (() => { let i = 0; return () => 'test' + (++i); })(),
    console
  };
  context.dateOnly = s => { const d = new Date(s + 'T12:00:00'); return Number.isNaN(d.getTime()) ? null : d; };
  context.dateStr = d => d.getFullYear() + '-' + context.pad(d.getMonth()+1) + '-' + context.pad(d.getDate());
  vm.createContext(context);
  vm.runInContext(extractFunction('nextOccurrence') + '\n' + extractFunction('materializeDueRecurring'), context);
  return context;
}

test('monthly recurrence clamps end-of-month dates without skipping a month', () => {
  const c = contextFor({recurring:[], planned:[]}, '2026-01-01');
  assert.equal(c.nextOccurrence('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(c.nextOccurrence('2026-03-31', 'monthly'), '2026-04-30');
  assert.equal(c.nextOccurrence('2026-02-28', 'monthly', 31, 0), '2026-03-31');
});

test('yearly recurrence clamps leap day in non-leap years', () => {
  const c = contextFor({recurring:[], planned:[]}, '2026-01-01');
  assert.equal(c.nextOccurrence('2024-02-29', 'yearly'), '2025-02-28');
  assert.equal(c.nextOccurrence('2025-02-28', 'yearly', 29, 1), '2026-02-28');
  assert.equal(c.nextOccurrence('2027-02-28', 'yearly', 29, 1), '2028-02-29');
});

test('due occurrences become planned, not actual transactions, and are idempotent', () => {
  const state = {
    recurring: [{id:'r1',type:'expense',group:'共同',payer:'Mrs Meow',amount:50,categoryId:'c1',note:'rent',frequency:'monthly',startDate:'2026-08-01',nextDue:'2026-08-01',endDate:null,paused:false}],
    planned: [], tx:[]
  };
  const c = contextFor(state, '2026-10-24');
  assert.equal(c.materializeDueRecurring(), 3);
  assert.equal(state.planned.length, 3);
  assert.equal(state.tx.length, 0);
  assert.equal(state.recurring[0].nextDue, '2026-11-01');
  assert.equal(c.materializeDueRecurring(), 0);
  assert.equal(state.planned.length, 3);
});

test('end date is inclusive and prevents later planned occurrences', () => {
  const state = {
    recurring: [{id:'r2',type:'expense',group:'共同',payer:'Mr Meow',amount:10,categoryId:'c1',note:'bill',frequency:'weekly',startDate:'2026-10-03',nextDue:'2026-10-03',endDate:'2026-10-17',paused:false}],
    planned: [], tx:[]
  };
  const c = contextFor(state, '2026-11-01');
  assert.equal(c.materializeDueRecurring(), 3);
  assert.deepEqual(state.planned.map(p => p.dueDate), ['2026-10-03','2026-10-10','2026-10-17']);
});

function postingContext(state, opts={}) {
  const calls = { saves:0, errors:[], success:[] };
  const context = {
    S:state,
    uid:(()=>{let i=0;return()=> 'posted'+(++i)})(),
    cat:id=>state.cats.find(c=>c.id===id),
    save:()=>{calls.saves++;return opts.saveResult!==false},
    toast:(msg,warn=false)=>{(warn?calls.errors:calls.success).push(msg)},
    renderSettings:()=>{calls.rendered=(calls.rendered||0)+1},
    navigator:{vibrate:()=>{calls.vibrated=true}},
    Math, Number, String, Date,
    calls
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('postPlanned'),context);
  return context;
}
function postingState(overrides={}) {
  return {
    cats:[{id:'c1',name:'Rent',type:'expense',archived:false}],
    tx:[],
    planned:[{id:'p1',recurringId:'r1',dueDate:'2026-10-01',type:'expense',group:'共同',payer:'Mrs Meow',amount:50,categoryId:'c1',note:'rent',status:'planned'}],
    ...overrides
  };
}

test('confirming a planned shared expense posts once, preserves date and payer, and marks it posted', () => {
  const state=postingState(), c=postingContext(state);
  c.postPlanned('p1');
  assert.equal(state.tx.length,1);
  assert.equal(state.tx[0].amount,50);
  assert.equal(state.tx[0].date,'2026-10-01');
  assert.equal(state.tx[0].payer,'Mrs Meow');
  assert.equal(state.tx[0].shares['Mrs Meow']+state.tx[0].shares['Mr Meow'],50);
  assert.equal(state.planned[0].status,'posted');
  assert.equal(c.calls.saves,1);
  assert.equal(c.calls.success.length,1);
  c.postPlanned('p1');
  assert.equal(state.tx.length,1,'second confirmation should not create another transaction');
});

test('an existing transaction for the same recurrence date blocks duplicate posting', () => {
  const state=postingState({tx:[{id:'existing',recurringId:'r1',recurringDueDate:'2026-10-01'}]});
  const c=postingContext(state);
  c.postPlanned('p1');
  assert.equal(state.tx.length,1);
  assert.equal(state.planned[0].status,'planned');
  assert.equal(c.calls.errors.length,1);
});

test('archived or missing categories block posting without changing the plan', () => {
  for (const category of [null,{id:'c1',name:'Rent',type:'expense',archived:true}]) {
    const state=postingState({cats:category?[category]:[]}), c=postingContext(state);
    c.postPlanned('p1');
    assert.equal(state.tx.length,0);
    assert.equal(state.planned[0].status,'planned');
    assert.equal(c.calls.errors.length,1);
  }
});

test('failed save rolls back the in-memory post and keeps the plan retryable', () => {
  const state=postingState(), c=postingContext(state,{saveResult:false});
  c.postPlanned('p1');
  assert.equal(state.tx.length,0);
  assert.equal(state.planned[0].status,'planned');
  assert.equal(c.calls.success.length,0);
});

test('recurring expenses count against each personal budget share, not a joint budget', () => {
  const html=fs.readFileSync('index.html','utf8');
  const start=html.indexOf('const spent=');
  const end=html.indexOf('const seg=',start);
  assert.ok(start>=0&&end>start,'spent calculation must exist');
  const expression=html.slice(start,end).trim();
  const state={tx:[
    {type:'expense',group:'共同',amount:50,categoryId:'c1',date:'2026-10-01',shares:{'Mrs Meow':25,'Mr Meow':25}},
    {type:'expense',group:'共同',amount:30,categoryId:'c1',date:'2026-10-02'},
    {type:'expense',group:'Mr Meow',amount:80,categoryId:'c1',date:'2026-10-03',shares:{'Mrs Meow':0,'Mr Meow':80}}
  ]};
  const c={S:state,sum:a=>a.reduce((n,v)=>n+v,0),Number};
  vm.createContext(c);
  vm.runInContext(expression+'; this.spent=spent;',c);
  assert.equal(c.spent('Mrs Meow','c1','2026-10'),25);
  assert.equal(c.spent('Mr Meow','c1','2026-10'),105);
  assert.equal(c.spent('共同','c1','2026-10'),30,'legacy joint expense remains visible without being counted twice');
});

test('legacy state without recurrence fields migrates additively without changing old transactions', () => {
  const marker='function normalizeState(s){';
  const start=html.indexOf(marker);
  const end=html.indexOf('function load()',start);
  assert.ok(start>=0&&end>start);
  const context={
    G:['共同','Mrs Meow','Mr Meow'],P:['Mrs Meow','Mr Meow'],
    Set,Array,Number,String,Math,Error
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start,end),context);
  const legacy={cats:[{id:'c1',name:'Rent',type:'expense'}],
    tx:[{id:'old1',type:'expense',group:'共同',amount:30,date:'2026-09-01',categoryId:'c1',note:'old rent'}],
    budgets:{'共同':{'c1':500},'Mrs Meow':{},'Mr Meow':{}}};
  const result=context.normalizeState(legacy);
  assert.equal(result.tx.length,1);
  assert.equal(result.tx[0].id,'old1');
  assert.equal(result.tx[0].amount,30);
  assert.deepEqual(Array.from(result.recurring),[]);
  assert.deepEqual(Array.from(result.planned),[]);
  assert.deepEqual(Array.from(result.repayments),[]);
  assert.equal(result.budgets['共同'].c1,500);
});

function integrationContext(state, extra={}) {
  const calls={saves:0,toasts:[],renders:0,confirms:0};
  const elements={};
  const context={
    S:state,G:['共同','Mrs Meow','Mr Meow'],P:['Mrs Meow','Mr Meow'],
    U:{editId:null,type:'expense',group:'共同',payer:'Mrs Meow',splitMode:'equal',shareMrs:0,shareMr:0,saving:false,cat:'c1',sub:null,tab:'add'},
    uid:(()=>{let i=0;return()=> 'generated'+(++i)})(),
    cat:id=>state.cats.find(c=>c.id===id),
    spent:(g,cid,m)=>state.tx.filter(t=>t.type==='expense'&&t.categoryId===cid&&t.date.startsWith(m)).reduce((sum,t)=>sum+(g==='共同'?(!t.shares&&t.group==='共同'?t.amount:0):(t.shares?Number(t.shares[g]||0):(t.group===g?t.amount:0))),0),
    save:()=>{calls.saves++;return extra.saveResult!==false},
    toast:(msg,warn=false)=>calls.toasts.push({msg,warn}),
    renderSettings:()=>{calls.renders++},renderRecords:()=>{calls.renders++},renderAdd:()=>{calls.renders++},
    resetForm:()=>{context.U.editId=null},money:n=>'$'+Number(n).toFixed(2),
    confirm:()=>{calls.confirms++;return extra.confirmResult!==false},
    navigator:{vibrate(){}},Math,Number,String,Array,Object,Set,Date,
    calls,
    $:id=>elements[id]||(elements[id]={value:'',focus(){},select(){},classList:{add(){},remove(){}}}),
    localStorage:{setItem(){}},
    console
  };
  vm.createContext(context);
  const names=['spent','currentSettlement','postPlanned','submitTx','editTx','delTx','normalizeState','showBackup','importBackup'];
  const code=names.map(n=>{try{return extractFunction(n)}catch(e){return ''}}).join('\n');
  vm.runInContext(code,context);
  return context;
}
function integrationState() {
  return {
    cats:[{id:'c1',name:'Rent',type:'expense',archived:false}],
    budgets:{'共同':{c1:100},'Mrs Meow':{c1:60},'Mr Meow':{c1:60}},
    tx:[],
    repayments:[],
    recurring:[{id:'r1',type:'expense',group:'共同',payer:'Mrs Meow',amount:50.01,categoryId:'c1',note:'rent',frequency:'monthly',startDate:'2026-10-01',nextDue:'2026-11-01',anchorDay:1,anchorMonth:9,endDate:null,paused:false}],
    planned:[{id:'p1',recurringId:'r1',dueDate:'2026-10-01',type:'expense',group:'共同',payer:'Mrs Meow',amount:50.01,categoryId:'c1',note:'rent',status:'planned'}]
  };
}

test('posted recurring shared expense updates both personal budgets and settlement; repayment nets it down', () => {
  const state=integrationState(),c=integrationContext(state);
  c.postPlanned('p1');
  assert.equal(state.tx.length,1);
  assert.equal(c.spent('Mrs Meow','c1','2026-10'),25);
  assert.equal(c.spent('Mr Meow','c1','2026-10'),25.01);
  let st=c.currentSettlement();
  assert.equal(st.tracked,5001);
  assert.equal(st.outstanding,25.01);
  state.repayments.push({id:'pay1',from:'Mr Meow',to:'Mrs Meow',amount:10,date:'2026-10-20'});
  st=c.currentSettlement();
  assert.equal(st.repaid,1000);
  assert.equal(st.outstanding,15.01);
});

test('posted personal recurring expense affects only the selected person budget and records an advance correctly', () => {
  const state=integrationState();
  state.planned[0]={id:'p2',recurringId:'r1',dueDate:'2026-10-01',type:'expense',group:'Mr Meow',payer:'Mrs Meow',amount:80,categoryId:'c1',note:'personal bill',status:'planned'};
  const c=integrationContext(state);
  c.postPlanned('p2');
  assert.equal(c.spent('Mrs Meow','c1','2026-10'),0);
  assert.equal(c.spent('Mr Meow','c1','2026-10'),80);
  const st=c.currentSettlement();
  assert.equal(st.outstanding,80);
  assert.equal(st.debtor,'Mr Meow');
  assert.equal(st.creditor,'Mrs Meow');
});

test('deleting a posted recurring transaction removes its budget and settlement impact and reopens its plan', () => {
  const state=integrationState();
  state.tx=[{id:'tx1',type:'expense',group:'共同',payer:'Mrs Meow',amount:50.01,categoryId:'c1',date:'2026-10-01',note:'rent',shares:{'Mrs Meow':25.01,'Mr Meow':25},recurringId:'r1',recurringDueDate:'2026-10-01'}];
  state.planned[0].status='posted';
  const c=integrationContext(state);
  c.delTx('tx1');
  assert.equal(state.tx.length,0);
  assert.equal(state.planned[0].status,'planned');
  assert.equal(c.spent('Mrs Meow','c1','2026-10'),0);
  assert.equal(c.currentSettlement().outstanding,0);
});

test('editing a posted recurring transaction preserves its recurrence identity', () => {
  const state=integrationState();
  state.tx=[{id:'tx1',type:'expense',group:'共同',payer:'Mrs Meow',amount:50,categoryId:'c1',date:'2026-10-01',note:'rent',shares:{'Mrs Meow':25,'Mr Meow':25},recurringId:'r1',recurringDueDate:'2026-10-01'}];
  const c=integrationContext(state);
  c.U.editId='tx1';c.U.type='expense';c.U.group='共同';c.U.payer='Mrs Meow';c.U.splitMode='equal';c.U.cat='c1';c.U.sub=null;
  c.$('tx-amount').value='60';c.$('tx-date').value='2026-10-01';c.$('tx-note').value='edited rent';
  c.submitTx();
  assert.equal(state.tx[0].amount,60);
  assert.equal(state.tx[0].recurringId,'r1');
  assert.equal(state.tx[0].recurringDueDate,'2026-10-01');
  assert.equal(c.currentSettlement().tracked,6000);
  assert.equal(c.spent('Mrs Meow','c1','2026-10'),30);
  assert.equal(c.spent('Mr Meow','c1','2026-10'),30);
});

test('JSON backup round-trip and normalized reload retain recurring rules and planned items', () => {
  const state=integrationState();
  const c=integrationContext(state);
  c.showBackup();
  const backup=c.$('bk').value;
  assert.ok(backup.includes('"recurring"'));
  assert.ok(backup.includes('"planned"'));
  const reloaded=JSON.parse(backup);
  const normalized=c.normalizeState(reloaded);
  assert.equal(normalized.recurring[0].id,'r1');
  assert.equal(normalized.planned[0].id,'p1');
  assert.equal(normalized.planned[0].status,'planned');
  assert.equal(normalized.recurring[0].nextDue,'2026-11-01');
});

test('import validation rejects malformed planned references without replacing current state', () => {
  const state=integrationState(),c=integrationContext(state);
  c.$('bk').value=JSON.stringify({...state,planned:[{id:'bad',recurringId:'missing',dueDate:'2026-10-01',amount:10,status:'planned'}]});
  c.importBackup();
  assert.equal(state.planned[0].id,'p1');
  assert.ok(c.calls.toasts.some(x=>x.warn));
});

test('successful JSON import replaces state and keeps recurrence, planned item and repayment data', () => {
  const current=integrationState();
  const c=integrationContext(current);
  const imported=integrationState();
  imported.recurring[0].amount=75;
  imported.planned[0].amount=75;
  imported.repayments=[{id:'rep1',from:'Mr Meow',to:'Mrs Meow',amount:5,date:'2026-10-20',note:'partial'}];
  c.$('bk').value=JSON.stringify(imported);
  c.importBackup();
  assert.equal(c.S.recurring[0].amount,75);
  assert.equal(c.S.planned[0].amount,75);
  assert.equal(c.S.planned[0].status,'planned');
  assert.equal(c.S.repayments[0].id,'rep1');
  assert.equal(c.calls.saves,1);
  assert.ok(c.calls.toasts.some(x=>x.msg==='匯入成功'));
});
