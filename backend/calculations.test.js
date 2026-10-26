const test = require("node:test");
const assert = require("node:assert/strict");

const {
  toMinor,
  fromMinor,
  allocateSharesMinor,
  simplifyDebts,
  expenseSummary,
  isDirty,
} = require("./calculations");

test("minor-unit arithmetic avoids common floating-point errors", () => {
  const result = fromMinor(toMinor(0.1) + toMinor(0.2));

  assert.equal(result, 0.3);
});

test("simplification preserves every member's net balance", () => {
  const balances = { a: -60, b: -40, c: 70, d: 30 };
  const transactions = simplifyDebts(balances, ["a"]);
  const calculatedBalances = { a: 0, b: 0, c: 0, d: 0 };

  for (const transaction of transactions) {
    calculatedBalances[transaction.from] -= transaction.amount;
    calculatedBalances[transaction.to] += transaction.amount;
  }

  for (const memberId of Object.keys(balances)) {
    assert.equal(
      Math.round(calculatedBalances[memberId] * 100),
      Math.round(balances[memberId] * 100),
    );
  }

  assert.ok(
    transactions.some(
      ({ from, to }) => from === "a" || to === "a",
    ),
  );
});

test("expense summary keeps original currencies separate", () => {
  const result = expenseSummary(
    [
      {
        amount: 1000,
        currency: "THB",
        amountInBase: 2500,
        splits: [
          { userId: "a", amount: 500 },
          { userId: "b", amount: 500 },
        ],
      },
      {
        amount: 100,
        currency: "INR",
        amountInBase: 100,
        splits: [
          { userId: "a", amount: 50 },
          { userId: "b", amount: 50 },
        ],
      },
    ],
    ["a", "b"],
    "INR",
  );

  assert.equal(result.groupTotal, 2600);
  assert.deepEqual(result.currencyTotals, { THB: 1000, INR: 100 });
  assert.equal(result.memberTotals.a, 1300);
});

test("dirty-state comparison detects changes and reverts", () => {
  const original = { base: "INR", spending: "THB" };

  assert.equal(
    isDirty({ base: "USD", spending: "THB" }, original),
    true,
  );
  assert.equal(
    isDirty({ base: "INR", spending: "THB" }, original),
    false,
  );
});


test("converted shares always sum to the rounded expense total", () => {
  const cases = [
    { total: 8439.19, splits: [{ userId: "a", amount: 1000 }, { userId: "b", amount: 1000 }, { userId: "c", amount: 1000 }] },
    { total: 3375.67, splits: [{ userId: "a", amount: 400 }, { userId: "b", amount: 400 }, { userId: "c", amount: 400 }] },
    { total: 2520, splits: [{ userId: "a", amount: 300 }, { userId: "b", amount: 300 }, { userId: "c", amount: 300 }] },
  ];

  for (const { total, splits } of cases) {
    const shares = allocateSharesMinor(total, splits);
    assert.equal(shares.reduce((sum, amount) => sum + amount, 0), toMinor(total));
  }
});

test("remainder allocation is deterministic for equal splits", () => {
  const splits = [{ amount: 1 }, { amount: 1 }, { amount: 1 }];
  assert.deepEqual(allocateSharesMinor(10, splits), [334, 333, 333]);
  assert.deepEqual(allocateSharesMinor(10, splits), [334, 333, 333]);
});

test("converted member totals reconcile exactly to the group total", () => {
  const summary = expenseSummary(
    [
      {
        amount: 3000,
        currency: "THB",
        amountInBase: 8439.19,
        splits: [
          { userId: "a", amount: 1000 },
          { userId: "b", amount: 1000 },
          { userId: "c", amount: 1000 },
        ],
      },
      {
        amount: 1200,
        currency: "THB",
        amountInBase: 3375.67,
        splits: [
          { userId: "a", amount: 400 },
          { userId: "b", amount: 400 },
          { userId: "c", amount: 400 },
        ],
      },
    ],
    ["a", "b", "c"],
    "INR",
  );

  const memberTotalMinor = Object.values(summary.memberTotals)
    .reduce((sum, amount) => sum + toMinor(amount), 0);
  assert.equal(memberTotalMinor, toMinor(summary.groupTotal));
});
