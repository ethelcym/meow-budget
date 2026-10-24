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
