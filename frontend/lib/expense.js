const EXPENSE_CATEGORIES = [
  { pattern: /flight|airfare|airline|plane|airport/i, icon: "✈️" },
  {
    pattern: /hotel|hostel|accommodation|resort|stay|airbnb|room/i,
    icon: "🏨",
  },
  {
    pattern: /breakfast|lunch|dinner|restaurant|cafe|coffee|food|meal|snack|pizza|drink/i,
    icon: "🍽️",
  },
  {
    pattern: /taxi|cab|uber|ola|bus|train|metro|transport|tuk.?tuk|rickshaw/i,
    icon: "🚕",
  },
  {
    pattern: /shopping|clothes|mall|souvenir|purchase/i,
    icon: "🛍️",
  },
  {
    pattern: /movie|cinema|museum|ticket|tour|activity|show|amusement|entertainment/i,
    icon: "🎟️",
  },
  {
    pattern: /grocery|groceries|supermarket|vegetable|fruit/i,
    icon: "🛒",
  },
  { pattern: /fuel|petrol|diesel|gas station/i, icon: "⛽" },
];

export function expenseIcon(description = "") {
  const category = EXPENSE_CATEGORIES.find(({ pattern }) =>
    pattern.test(description),
  );

  return category ? category.icon : "🧾";
}

export function summarizeExpenses(expenses, members, baseCurrency) {
  const memberTotals = Object.fromEntries(
    members.map((member) => [member.id, 0]),
  );
  const currencyTotals = {};
  let groupTotal = 0;

  for (const expense of expenses) {
    const originalAmount = Number(expense.amount) || 0;
    const amountInBase =
      Number(expense.amountInBase ?? expense.amount) || 0;

    groupTotal += amountInBase;

    const currency = expense.currency || baseCurrency;
    currencyTotals[currency] =
      (currencyTotals[currency] || 0) + originalAmount;

    const conversionRatio =
      originalAmount > 0 ? amountInBase / originalAmount : 1;

    for (const split of expense.splits || []) {
      const splitInBase =
        Math.round(Number(split.amount || 0) * conversionRatio * 100) /
        100;

      memberTotals[split.userId] =
        (memberTotals[split.userId] || 0) + splitInBase;
    }
  }

  return {
    total: Math.round(groupTotal * 100) / 100,
    totals: Object.fromEntries(
      Object.entries(memberTotals).map(([memberId, amount]) => [
        memberId,
        Math.round(amount * 100) / 100,
      ]),
    ),
    byCurrency: currencyTotals,
    baseCurrency,
  };
}
