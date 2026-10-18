const test = require("node:test");
const assert = require("node:assert/strict");

const {
  toMinor,
  fromMinor,
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
