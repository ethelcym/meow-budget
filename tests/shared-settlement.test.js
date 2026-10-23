/**
 * 喵喵記帳 — shared expense settlement model (pure functions)
 * Run with: node --test tests/shared-settlement.test.js
 *
 * Money is represented in integer cents. Legacy transactions without explicit
 * shares are intentionally ignored by this model until the UI migration policy
 * is implemented; they must never be silently reinterpreted as 50/50.
 */
const PEOPLE = ['Mrs Meow', 'Mr Meow'];

function cents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new TypeError('Amount must be finite');
  return Math.round(n * 100);
}

function amountFromCents(value) {
  return value / 100;
}

/**
 * Expense schema:
 * {
 *   type: 'expense',
 *   amount: 600,
 *   group: '共同' | 'Mrs Meow' | 'Mr Meow',
 *   payer: 'Mrs Meow' | 'Mr Meow',
 *   shares: { 'Mrs Meow': 300, 'Mr Meow': 300 }
 * }
 *
 * For personal expenses, the group owner bears the full expense, while payer
 * independently records who actually advanced the cash.
 *
 * Repayment schema: { from: 'Mr Meow', to: 'Mrs Meow', amount: 100 }
 */
function calculateSettlement(transactions, repayments = []) {
  const balance = Object.fromEntries(PEOPLE.map(person => [person, 0]));
  let householdExpenseCents = 0;

  for (const tx of transactions) {
    if (!tx || tx.type !== 'expense') continue;
    const amount = cents(tx.amount);
    if (amount <= 0) throw new RangeError('Expense amount must be positive');

    // Old records have no shares; keep them out of the new debt calculation.
    if (!tx.shares || typeof tx.shares !== 'object') continue;

    const shares = Object.fromEntries(PEOPLE.map(person => [
      person, cents(tx.shares[person] || 0)
    ]));
    if (PEOPLE.some(person => shares[person] < 0)) {
      throw new RangeError('Expense shares cannot be negative');
    }
    if (shares[PEOPLE[0]] + shares[PEOPLE[1]] !== amount) {
      throw new RangeError('Shares must add up to the expense amount');
    }

    householdExpenseCents += amount;
    for (const person of PEOPLE) balance[person] -= shares[person];

    if (PEOPLE.includes(tx.payer)) {
      balance[tx.payer] += amount;
    } else {
      throw new TypeError('New-model expenses must specify a valid payer');
    }
  }

  let totalRepaidCents = 0;
  for (const repayment of repayments) {
    if (!PEOPLE.includes(repayment.from) || !PEOPLE.includes(repayment.to) ||
        repayment.from === repayment.to) {
      throw new TypeError('Repayment must be between the two different household members');
    }
    const amount = cents(repayment.amount);
    if (amount <= 0) throw new RangeError('Repayment amount must be positive');
    balance[repayment.from] += amount;
    balance[repayment.to] -= amount;
    totalRepaidCents += amount;
  }

  const netCents = balance[PEOPLE[0]] + balance[PEOPLE[1]];
  if (netCents !== 0) {
    throw new Error('Settlement balances do not net to zero');
  }

  const difference = balance[PEOPLE[0]];
  return {
    householdExpense: amountFromCents(householdExpenseCents),
    totalRepaid: amountFromCents(totalRepaidCents),
    balances: Object.fromEntries(PEOPLE.map(person => [
      person, amountFromCents(balance[person])
    ])),
    debtor: difference > 0 ? PEOPLE[1] : difference < 0 ? PEOPLE[0] : null,
    creditor: difference > 0 ? PEOPLE[0] : difference < 0 ? PEOPLE[1] : null,
    outstanding: amountFromCents(Math.abs(difference))
  };
}

module.exports = { PEOPLE, calculateSettlement };


// Tests are kept in this file so the accounting model can be reviewed in isolation.
if (require.main === module) {
  const assert = require('node:assert/strict');
  const { test } = require('node:test');
  const shared = (amount, payer, a, b) => ({type:'expense', group:'共同', amount, payer, shares:{'Mrs Meow':a,'Mr Meow':b}});
  test('HK$600 shared equally, Mrs pays all: Mr owes Mrs HK$300', () => {
    const r = calculateSettlement([shared(600,'Mrs Meow',300,300)]);
    assert.equal(r.householdExpense,600); assert.equal(r.outstanding,300);
    assert.equal(r.debtor,'Mr Meow'); assert.equal(r.creditor,'Mrs Meow');
  });
  test('partial repayment of HK$100 leaves HK$200 outstanding', () => {
    const r = calculateSettlement([shared(600,'Mrs Meow',300,300)],[{from:'Mr Meow',to:'Mrs Meow',amount:100}]);
    assert.equal(r.outstanding,200); assert.equal(r.totalRepaid,100);
  });
  test('personal expense: Mrs advances HK$800 for Mr, Mr owes Mrs HK$800', () => {
    const tx={type:'expense',group:'Mr Meow',amount:800,payer:'Mrs Meow',shares:{'Mrs Meow':0,'Mr Meow':800}};
    const r=calculateSettlement([tx]); assert.equal(r.outstanding,800);
    assert.equal(r.debtor,'Mr Meow'); assert.equal(r.creditor,'Mrs Meow');
  });
  test('shared expense paid by both in proportion to their shares nets to zero', () => {
    const r=calculateSettlement([shared(600,'Mrs Meow',300,300),shared(400,'Mr Meow',200,200)]);
    assert.equal(r.outstanding,0); assert.equal(r.householdExpense,1000);
  });
  test('custom split respects shares and identifies who owes whom', () => {
    const r=calculateSettlement([shared(600,'Mr Meow',400,200)]);
    assert.equal(r.outstanding,200); assert.equal(r.debtor,'Mrs Meow'); assert.equal(r.creditor,'Mr Meow');
  });
  test('rejects shares that do not add up to the transaction total', () => {
    assert.throws(() => calculateSettlement([shared(600,'Mrs Meow',300,200)]), /add up/);
  });
  test('legacy records without explicit shares are not silently reinterpreted', () => {
    const r=calculateSettlement([{type:'expense',group:'共同',amount:600,payer:'Mrs Meow'}]);
    assert.equal(r.householdExpense,0); assert.equal(r.outstanding,0);
  });
}
