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
});

test('yearly recurrence clamps leap day in non-leap years', () => {
  const c = contextFor({recurring:[], planned:[]}, '2026-01-01');
  assert.equal(c.nextOccurrence('2024-02-29', 'yearly'), '2025-02-28');
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
