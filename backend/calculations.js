const toMinor = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100);

const fromMinor = (value) => value / 100;

function simplifyDebts(balances, optOutIds = []) {
  const optedOut = new Set(optOutIds);
  const creditors = [];
  const debtors = [];

  for (const [id, balance] of Object.entries(balances)) {
    const amount = toMinor(balance);

    if (amount > 0) {
      creditors.push({ id, amount });
    } else if (amount < 0) {
      debtors.push({ id, amount: -amount });
    }
  }

  // Process larger balances first to reduce the number of suggested transfers.
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const transactions = [];

  while (debtors.length > 0 && creditors.length > 0) {
    // Prefer a direct settlement involving an opted-out member where possible.
    // Their balance remains in the ledger regardless of this preference.
    let debtorIndex = debtors.findIndex(({ id }) => optedOut.has(id));
    let creditorIndex = creditors.findIndex(({ id }) => optedOut.has(id));

    if (debtorIndex === -1) debtorIndex = 0;
    if (creditorIndex === -1) creditorIndex = 0;

    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.amount, creditor.amount);

    transactions.push({
      from: debtor.id,
      to: creditor.id,
      amount: fromMinor(amount),
      optedOutParticipant:
        optedOut.has(debtor.id) || optedOut.has(creditor.id),
    });

    debtor.amount -= amount;
    creditor.amount -= amount;

    if (debtor.amount === 0) debtors.splice(debtorIndex, 1);
    if (creditor.amount === 0) creditors.splice(creditorIndex, 1);
  }

  return transactions;
}

function expenseSummary(expenses, memberIds, baseCurrency) {
  const memberTotals = Object.fromEntries(
    memberIds.map((memberId) => [memberId, 0]),
  );
  const currencyTotals = {};
  let groupTotalMinor = 0;

  for (const expense of expenses) {
    const amountInBase = toMinor(
      expense.amountInBase == null ? expense.amount : expense.amountInBase,
    );
    const currency = expense.currency || baseCurrency;

    groupTotalMinor += amountInBase;
    currencyTotals[currency] =
      (currencyTotals[currency] || 0) + toMinor(expense.amount);

    const originalAmount = Number(expense.amount);
    const conversionRatio =
      originalAmount > 0
        ? fromMinor(amountInBase) / originalAmount
        : 1;

    for (const split of expense.splits || []) {
      const splitInBase = toMinor(
        Number(split.amount || 0) * conversionRatio,
      );

      memberTotals[split.userId] =
        (memberTotals[split.userId] || 0) + fromMinor(splitInBase);
    }
  }

  return {
    baseCurrency,
    groupTotal: fromMinor(groupTotalMinor),
    memberTotals: Object.fromEntries(
      Object.entries(memberTotals).map(([id, amount]) => [
        id,
        fromMinor(toMinor(amount)),
      ]),
    ),
    currencyTotals: Object.fromEntries(
      Object.entries(currencyTotals).map(([currency, amount]) => [
        currency,
        fromMinor(amount),
      ]),
    ),
  };
}

function isDirty(currentValues, originalValues) {
  return Object.keys(currentValues).some(
    (key) => currentValues[key] !== originalValues[key],
  );
}

module.exports = {
  toMinor,
  fromMinor,
  simplifyDebts,
  expenseSummary,
  isDirty,
};
