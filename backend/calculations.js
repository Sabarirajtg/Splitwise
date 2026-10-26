const toMinor = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100);

const fromMinor = (value) => value / 100;

/**
 * Allocate a converted expense total across its splits in integer minor units.
 * Largest-remainder allocation guarantees that the shares add up exactly to
 * the converted total, even when equal shares cannot be represented evenly
 * in the currency's minor unit.
 */
function allocateSharesMinor(totalAmount, splits = []) {
  const totalMinor = toMinor(totalAmount);
  if (!splits.length) return [];

  const weights = splits.map((split) => Math.max(0, Number(split.amount) || 0));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0 || totalMinor <= 0) {
    return splits.map(() => 0);
  }

  const allocations = weights.map((weight, index) => {
    const exactMinor = (totalMinor * weight) / weightTotal;
    const floorMinor = Math.floor(exactMinor);
    return { index, amount: floorMinor, remainder: exactMinor - floorMinor };
  });

  const remaining = totalMinor - allocations.reduce((sum, item) => sum + item.amount, 0);
  const priority = [...allocations].sort(
    (a, b) => b.remainder - a.remainder || a.index - b.index,
  );

  for (let i = 0; i < remaining; i += 1) {
    priority[i % priority.length].amount += 1;
  }

  return allocations
    .sort((a, b) => a.index - b.index)
    .map((item) => item.amount);
}

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
  const memberTotalsMinor = Object.fromEntries(
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

    const splits = expense.splits || [];
    const allocatedShares = allocateSharesMinor(fromMinor(amountInBase), splits);

    splits.forEach((split, index) => {
      memberTotalsMinor[split.userId] =
        (memberTotalsMinor[split.userId] || 0) + allocatedShares[index];
    });
  }

  return {
    baseCurrency,
    groupTotal: fromMinor(groupTotalMinor),
    memberTotals: Object.fromEntries(
      Object.entries(memberTotalsMinor).map(([id, amount]) => [
        id,
        fromMinor(amount),
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
  allocateSharesMinor,
  simplifyDebts,
  expenseSummary,
  isDirty,
};
