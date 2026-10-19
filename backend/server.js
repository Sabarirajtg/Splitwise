require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { nanoid } = require("nanoid");
const connectDB = require("./db");
const { User, Group, Expense, Settlement } = require("./models");
const { convert, getRates, convertWithSnapshot } = require("./fx");
const { simplifyDebts, expenseSummary } = require("./calculations");

const app = express();
app.use(cors());
app.use(express.json());

// Health check - used by the uptime pinger to keep Render awake
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "THB", "JPY", "AUD", "CAD", "SGD", "AED"];

// ---------- Auth ----------

// Called server-side by the Next.js NextAuth callback (never from the browser directly),
// so it's protected by a shared secret instead of a user-facing password.
app.post("/api/auth/google", async (req, res) => {
  try {
    const secret = req.headers["x-internal-secret"];
    if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { googleId, email, name, avatarUrl } = req.body;
    if (!googleId || !email) return res.status(400).json({ error: "Missing Google account details" });

    let user = await User.findOne({ googleId });
    if (!user) {
      // Also check by email in case they previously signed up with name+PIN using the same email pattern
      user = await User.findOne({ email });
      if (user) {
        user.googleId = googleId;
        user.avatarUrl = avatarUrl;
        await user.save();
      } else {
        user = await User.create({
          _id: nanoid(10), name: name || email.split("@")[0], email, googleId, avatarUrl
        });
      }
    } else {
      // keep name/avatar fresh in case they changed on Google's side
      user.name = name || user.name;
      user.avatarUrl = avatarUrl;
      await user.save();
    }
    res.json({ id: user._id, name: user.name, avatarUrl: user.avatarUrl || null, upiId: user.upiId || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/users/:id", async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json({ id: user._id, name: user.name, avatarUrl: user.avatarUrl || null, upiId: user.upiId || null });
});
app.put("/api/users/:id/upi", async (req, res) => {
  if (!requireInternal(req, res)) return;
  const { userId, upiId } = req.body || {};
  if (!userId || userId !== req.params.id) {
    return res.status(403).json({ error: "You can only update your own UPI ID" });
  }
  const normalized = typeof upiId === "string" ? upiId.trim() : "";
  if (normalized && !/^[A-Za-z0-9._-]{2,128}@[A-Za-z0-9.-]{2,64}$/.test(normalized)) {
    return res.status(400).json({ error: "Enter a valid UPI ID, such as name@bank" });
  }
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  user.upiId = normalized || null;
  await user.save();
  res.json({ id: user._id, upiId: user.upiId || null });
});

// ---------- Currencies / FX ----------
app.get("/api/currencies", (req, res) => res.json(CURRENCIES));

app.get("/api/fx/:base", async (req, res) => {
  try {
    const rates = await getRates(req.params.base.toUpperCase());
    res.json({ base: req.params.base.toUpperCase(), rates });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- Groups ----------
app.get("/api/users/:userId/groups", async (req, res) => {
  const groups = await Group.find({ memberIds: req.params.userId });
  res.json(groups.map(g => ({ id: g._id, name: g.name, baseCurrency: g.baseCurrency, memberIds: g.memberIds, createdBy: g.createdBy })));
});

app.post("/api/groups", async (req, res) => {
  const { name, baseCurrency, spendingCurrency, userId } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Enter a group name" });
  }

  if (!userId) {
    return res.status(400).json({ error: "Missing user" });
  }

  const selectedSpendingCurrency = spendingCurrency || baseCurrency;

  if (
    !CURRENCIES.includes(baseCurrency) ||
    !CURRENCIES.includes(selectedSpendingCurrency)
  ) {
    return res.status(400).json({ error: "Select valid currencies" });
  }

  const group = await Group.create({
    _id: nanoid(10),
    name: name.trim(),
    baseCurrency,
    spendingCurrency: selectedSpendingCurrency,
    memberIds: [userId],
    createdBy: userId,
    simplificationOptOutIds: [],
    inviteToken: nanoid(24),
  });

  res.json({
    id: group._id,
    name: group.name,
    baseCurrency: group.baseCurrency,
    spendingCurrency: group.spendingCurrency,
    memberIds: group.memberIds,
  });
});

app.post("/api/groups/:id/join", async (req, res) => {
  const { userId } = req.body;
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: "No group found with that code" });
  if (!group.memberIds.includes(userId)) {
    group.memberIds.push(userId);
    await group.save();
  }
  res.json({ id: group._id, name: group.name, baseCurrency: group.baseCurrency, spendingCurrency: group.spendingCurrency || group.baseCurrency, memberIds: group.memberIds });
});

app.get("/api/groups/:id", async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: "Not found" });
  const members = await User.find({ _id: { $in: group.memberIds } });
  res.json({
    id: group._id, name: group.name, baseCurrency: group.baseCurrency, spendingCurrency: group.spendingCurrency || group.baseCurrency,
    currencyConfigured: Boolean(group.spendingCurrency), memberIds: group.memberIds, simplificationOptOutIds: group.simplificationOptOutIds || [], inviteToken: group.inviteToken || null,
    members: members.map(m => ({ id: m._id, name: m.name, upiId: m.upiId || null }))
  });
});


function requireInternal(req, res) {
  const secret = req.headers["x-internal-secret"];

  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  return true;
}

function isGroupMember(group, userId) {
  return Boolean(userId && group.memberIds.includes(userId));
}

function isValidInvitation(group) {
  return Boolean(
    group && (!group.inviteExpiresAt || group.inviteExpiresAt > new Date()),
  );
}

async function recalculateGroupCurrency(group, baseCurrency) {
  const expenses = await Expense.find({ groupId: group._id });
  const convertedExpenses = [];

  // Calculate all new values before saving any records.
  for (const expense of expenses) {
    let rates = expense.fxRates;

    if (!rates || !rates[baseCurrency]) {
      rates = await getRates(expense.currency);
    }

    const rate =
      expense.currency === baseCurrency ? 1 : rates[baseCurrency];

    if (!rate) {
      throw new Error(
        `No conversion rate for ${expense.currency} to ${baseCurrency}`,
      );
    }

    convertedExpenses.push({
      expense,
      rate,
      rates,
      amountInBase: Math.round(expense.amount * rate * 100) / 100,
    });
  }

  const settlements = await Settlement.find({ groupId: group._id });
  const convertedSettlements = [];

  for (const settlement of settlements) {
    const amount =
      settlement.currency === baseCurrency
        ? settlement.amount
        : await convert(
            settlement.amount,
            settlement.currency,
            baseCurrency,
          );

    convertedSettlements.push({ settlement, amount });
  }

  for (const { expense, rate, rates, amountInBase } of convertedExpenses) {
    expense.amountInBase = amountInBase;
    expense.fxRate = rate;
    expense.fxRates = { ...rates, [expense.currency]: 1 };
    await expense.save();
  }

  for (const { settlement, amount } of convertedSettlements) {
    settlement.amount = amount;
    settlement.currency = baseCurrency;
    await settlement.save();
  }
}

app.put("/api/groups/:id/settings", async (req, res) => {
  if (!requireInternal(req, res)) return;

  try {
    const { userId, baseCurrency, spendingCurrency } = req.body;
    const group = await Group.findById(req.params.id);

    if (!group) {
      return res.status(404).json({ error: "Group not found" });
    }

    if (!isGroupMember(group, userId)) {
      return res.status(403).json({
        error: "Only group members can update settings",
      });
    }

    if (
      !CURRENCIES.includes(baseCurrency) ||
      !CURRENCIES.includes(spendingCurrency)
    ) {
      return res.status(400).json({ error: "Select valid currencies" });
    }

    if (baseCurrency !== group.baseCurrency) {
      await recalculateGroupCurrency(group, baseCurrency);
    }

    group.baseCurrency = baseCurrency;
    group.spendingCurrency = spendingCurrency;
    await group.save();

    res.json({
      id: group._id,
      baseCurrency,
      spendingCurrency,
      currencyConfigured: true,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Could not save settings",
    });
  }
});

app.put("/api/groups/:id/simplification", async (req, res) => {
  if (!requireInternal(req, res)) return;

  const { userId, enabled } = req.body;
  const group = await Group.findById(req.params.id);

  if (!group) {
    return res.status(404).json({ error: "Group not found" });
  }

  if (!isGroupMember(group, userId)) {
    return res.status(403).json({
      error: "Only group members can change this preference",
    });
  }

  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be boolean" });
  }

  const optedOutIds = new Set(group.simplificationOptOutIds || []);

  if (enabled) {
    optedOutIds.delete(userId);
  } else {
    optedOutIds.add(userId);
  }

  group.simplificationOptOutIds = [...optedOutIds];
  await group.save();

  res.json({
    simplificationOptOutIds: group.simplificationOptOutIds,
  });
});

app.post("/api/groups/:id/invite", async (req, res) => {
  if (!requireInternal(req, res)) return;

  const { userId, expiresAt } = req.body;
  const group = await Group.findById(req.params.id);

  if (!group) {
    return res.status(404).json({ error: "Group not found" });
  }

  if (!isGroupMember(group, userId)) {
    return res.status(403).json({
      error: "Only members can manage invitations",
    });
  }

  if (
    expiresAt &&
    (!Number.isFinite(Date.parse(expiresAt)) ||
      Date.parse(expiresAt) <= Date.now())
  ) {
    return res.status(400).json({
      error: "Expiration must be in the future",
    });
  }

  if (!group.inviteToken) {
    group.inviteToken = nanoid(24);
  }

  group.inviteExpiresAt = expiresAt ? new Date(expiresAt) : null;
  await group.save();

  res.json({
    token: group.inviteToken,
    expiresAt: group.inviteExpiresAt,
    groupId: group._id,
    groupName: group.name,
  });
});

app.delete("/api/groups/:id/invite", async (req, res) => {
  if (!requireInternal(req, res)) return;

  const { userId } = req.body || {};
  const group = await Group.findById(req.params.id);

  if (!group) {
    return res.status(404).json({ error: "Group not found" });
  }

  if (!isGroupMember(group, userId)) {
    return res.status(403).json({
      error: "Only members can manage invitations",
    });
  }

  group.inviteToken = null;
  group.inviteExpiresAt = null;
  await group.save();

  res.json({ ok: true });
});

app.get("/api/invitations/:token", async (req, res) => {
  const group = await Group.findOne({ inviteToken: req.params.token });

  if (!isValidInvitation(group)) {
    return res.status(404).json({
      error: "Invitation is invalid or expired",
    });
  }

  res.json({
    groupName: group.name,
    expiresAt: group.inviteExpiresAt,
  });
});

app.post("/api/invitations/:token/join", async (req, res) => {
  if (!requireInternal(req, res)) return;

  const { userId } = req.body;

  if (!userId) {
    return res.status(401).json({ error: "Sign in before joining" });
  }

  const group = await Group.findOne({ inviteToken: req.params.token });

  if (!isValidInvitation(group)) {
    return res.status(404).json({
      error: "Invitation is invalid or expired",
    });
  }

  if (!group.memberIds.includes(userId)) {
    group.memberIds.push(userId);
    await group.save();
  }

  res.json({ id: group._id, name: group.name });
});

// ---------- Expenses ----------
app.get("/api/groups/:id/expenses", async (req, res) => {
  const expenses = await Expense.find({ groupId: req.params.id }).sort({ date: -1 });
  res.json(expenses.map(mapExpense));
});

function mapExpense(e) {
  return {
    id: e._id, groupId: e.groupId, desc: e.desc, amount: e.amount, currency: e.currency,
    amountInBase: e.amountInBase, fxRate: e.fxRate, paidBy: e.paidBy, splits: e.splits, date: e.date,
    recurring: e.recurring, splitMethod: e.splitMethod, lastGenerated: e.lastGenerated
  };
}

app.post("/api/groups/:id/expenses", async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    const { desc, amount, currency, paidBy, date, recurring, splitMethod, splits } = req.body;
    if (!desc || !desc.trim()) return res.status(400).json({ error: "Enter a description" });
    if (!amount || amount <= 0) return res.status(400).json({ error: "Enter a valid amount" });
    if (!splits || splits.length === 0) return res.status(400).json({ error: "Select at least one person to split with" });

    const amountInBase = await convert(amount, currency, group.baseCurrency);

    const expense = await Expense.create({
      _id: nanoid(10), groupId: group._id, desc: desc.trim(), amount, currency, amountInBase,
      paidBy, date: date || new Date().toISOString().slice(0, 10), recurring: recurring || null,
      splitMethod, splits, lastGenerated: date
    });
    res.json(mapExpense(expense));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

app.put("/api/expenses/:id", async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: "Not found" });
    const group = await Group.findById(expense.groupId);
    const { desc, amount, currency, paidBy, date, recurring, splitMethod, splits } = req.body;
    if (!CURRENCIES.includes(currency)||!group.memberIds.includes(paidBy)) return res.status(400).json({error:"Invalid currency or payer"});
    if (!Array.isArray(splits)||!splits.length||splits.some(x=>!group.memberIds.includes(x.userId)||!Number.isFinite(Number(x.amount))||Number(x.amount)<0)) return res.status(400).json({error:"Invalid expense splits"});
    const sameAmountAndCurrency = expense.amount === Number(amount) && expense.currency === currency && expense.amountInBase != null;
    const fx = sameAmountAndCurrency ? { amountInBase: expense.amountInBase, rate: expense.fxRate, rates: expense.fxRates } : await convertWithSnapshot(Number(amount),currency,group.baseCurrency);
    Object.assign(expense,{desc,amount:Number(amount),currency,amountInBase:fx.amountInBase,fxRate:fx.rate,fxRates:fx.rates,paidBy,date,recurring:recurring||null,splitMethod,splits});
    await expense.save();
    res.json(mapExpense(expense));
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

app.delete("/api/expenses/:id", async (req, res) => {
  await Expense.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// Generate any due recurring expenses (call when opening a group)
app.post("/api/groups/:id/recurring/process", async (req, res) => {
  const templates = await Expense.find({ groupId: req.params.id, recurring: { $ne: null } });
  const now = new Date();
  for (const t of templates) {
    let last = new Date(t.lastGenerated || t.date);
    let next = new Date(last);
    const step = () => { if (t.recurring === "weekly") next.setDate(next.getDate() + 7); else next.setMonth(next.getMonth() + 1); };
    step();
    while (next <= now) {
      const newDate = next.toISOString().slice(0, 10);
      await Expense.create({
        _id: nanoid(10), groupId: t.groupId, desc: t.desc, amount: t.amount, currency: t.currency,
        amountInBase: t.amountInBase, fxRate: t.fxRate, fxRates: t.fxRates, paidBy: t.paidBy, splits: t.splits, date: newDate,
        recurring: null, splitMethod: t.splitMethod, lastGenerated: newDate, generatedFrom: t._id
      });
      t.lastGenerated = newDate;
      last = new Date(newDate); next = new Date(last); step();
    }
    await t.save();
  }
  res.json({ ok: true });
});

// ---------- Settlements & balances ----------
app.get("/api/groups/:id/settlements", async (req, res) => {
  const settlements = await Settlement.find({ groupId: req.params.id }).sort({ createdAt: -1, date: -1 });
  res.json(settlements.map(s => ({
    id: s._id, groupId: s.groupId, from: s.from, to: s.to, amount: s.amount, currency: s.currency, date: s.date,
    status: s.status || "settled", reportedBy: s.reportedBy || null, confirmedBy: s.confirmedBy || null,
    reportedAt: s.reportedAt || s.createdAt || null, confirmedAt: s.confirmedAt || null, issueNote: s.issueNote || null
  })));
});

// A payer report remains pending until the recipient confirms receipt.
app.post("/api/groups/:id/settlements", async (req, res) => {
  const { from, to, amount, currency, userId } = req.body || {};
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: "Group not found" });
  if (!userId || userId !== from || !isGroupMember(group, userId)) {
    return res.status(403).json({ error: "Only the person paying can mark this payment as paid" });
  }
  if (!to || to === from || !isGroupMember(group, to)) {
    return res.status(400).json({ error: "Choose a valid recipient in this group" });
  }
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: "Enter a valid payment amount" });
  }
  if (currency !== group.baseCurrency) {
    return res.status(400).json({ error: "Settlement amount must use the group base currency" });
  }
  const existingPending = await Settlement.findOne({ groupId: group._id, from, to, status: { $in: ["pending_confirmation", "reported_problem"] } });
  if (existingPending) return res.status(409).json({ error: "There is already a payment waiting for confirmation between these members" });
  const now = new Date();
  const s = await Settlement.create({
    _id: nanoid(10), groupId: group._id, from, to, amount: Math.round(Number(amount) * 100) / 100, currency,
    date: now.toISOString().slice(0, 10), status: "pending_confirmation", reportedBy: userId, reportedAt: now
  });
  res.status(201).json({ id: s._id, groupId: s.groupId, from: s.from, to: s.to, amount: s.amount, currency: s.currency, date: s.date, status: s.status, reportedAt: s.reportedAt });
});

app.post("/api/groups/:groupId/settlements/:settlementId/confirm", async (req, res) => {
  const { userId } = req.body || {};
  const group = await Group.findById(req.params.groupId);
  if (!group) return res.status(404).json({ error: "Group not found" });
  if (!userId || !isGroupMember(group, userId)) return res.status(403).json({ error: "Only group members can confirm payments" });
  const settlement = await Settlement.findOne({ _id: req.params.settlementId, groupId: group._id });
  if (!settlement) return res.status(404).json({ error: "Payment report not found" });
  if (settlement.to !== userId) return res.status(403).json({ error: "Only the recipient can confirm this payment" });
  if ((settlement.status || "settled") === "settled") return res.json({ id: settlement._id, status: "settled", confirmedAt: settlement.confirmedAt || settlement.updatedAt });
  settlement.status = "settled"; settlement.confirmedBy = userId; settlement.confirmedAt = new Date(); settlement.issueNote = null;
  await settlement.save();
  res.json({ id: settlement._id, status: settlement.status, confirmedAt: settlement.confirmedAt });
});

app.post("/api/groups/:groupId/settlements/:settlementId/report-problem", async (req, res) => {
  const { userId, note } = req.body || {};
  const group = await Group.findById(req.params.groupId);
  if (!group) return res.status(404).json({ error: "Group not found" });
  if (!userId || !isGroupMember(group, userId)) return res.status(403).json({ error: "Only group members can report payment issues" });
  const settlement = await Settlement.findOne({ _id: req.params.settlementId, groupId: group._id });
  if (!settlement) return res.status(404).json({ error: "Payment report not found" });
  if (settlement.to !== userId) return res.status(403).json({ error: "Only the recipient can report this payment" });
  if ((settlement.status || "settled") === "settled") return res.status(409).json({ error: "This payment is already settled" });
  settlement.status = "reported_problem"; settlement.reportedBy = userId; settlement.reportedAt = new Date();
  settlement.issueNote = typeof note === "string" ? note.trim().slice(0, 300) : "Recipient has not confirmed receipt";
  await settlement.save();
  res.json({ id: settlement._id, status: settlement.status, reportedAt: settlement.reportedAt });
});

app.get("/api/users/:userId/pending-settlements", async (req, res) => {
  const userId = req.params.userId;
  const settlements = await Settlement.find({
    $or: [
      { to: userId, status: "pending_confirmation" },
      { from: userId, status: "reported_problem" },
      { to: userId, status: "reported_problem" }
    ]
  }).sort({ createdAt: -1 });
  if (!settlements.length) return res.json([]);
  const groupIds = [...new Set(settlements.map(s => s.groupId))];
  const memberIds = [...new Set(settlements.flatMap(s => [s.from, s.to]))];
  const [groups, users] = await Promise.all([Group.find({ _id: { $in: groupIds } }), User.find({ _id: { $in: memberIds } })]);
  const groupById = new Map(groups.map(g => [String(g._id), g]));
  const userById = new Map(users.map(u => [String(u._id), u]));
  res.json(settlements.map(s => ({
    id: s._id, groupId: s.groupId, groupName: (groupById.get(String(s.groupId)) || {}).name || "Group",
    from: s.from, fromName: (userById.get(String(s.from)) || {}).name || "A member",
    to: s.to, toName: (userById.get(String(s.to)) || {}).name || "A member",
    amount: s.amount, currency: s.currency, status: s.status, date: s.date, createdAt: s.createdAt, issueNote: s.issueNote || null
  })));
});

app.get("/api/groups/:id/balances", async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: "Not found" });
  const expenses = await Expense.find({ groupId: group._id });
  const settlements = await Settlement.find({ groupId: group._id });
  const bal = {};
  group.memberIds.forEach(id => (bal[id] = 0));
  expenses.forEach(e => {
    const baseAmount = e.amountInBase != null ? e.amountInBase : e.amount;
    const ratio = baseAmount / e.amount;
    bal[e.paidBy] = (bal[e.paidBy] || 0) + baseAmount;
    e.splits.forEach(s => { bal[s.userId] = (bal[s.userId] || 0) - Math.round(s.amount * ratio * 100) / 100; });
  });
  settlements.forEach(s => {
    // Old records without status are completed; new pending reports never change balances.
    if ((s.status || "settled") !== "settled") return;
    bal[s.from] = (bal[s.from] || 0) + s.amount;
    bal[s.to] = (bal[s.to] || 0) - s.amount;
  });
  const breakdown = expenseSummary(expenses.map(e => ({ amount: e.amount, currency: e.currency, amountInBase: e.amountInBase, splits: e.splits })), group.memberIds, group.baseCurrency);
  res.json({ balances: bal, simplified: simplifyDebts(bal, group.simplificationOptOutIds || []), baseCurrency: group.baseCurrency, expenseBreakdown: breakdown });
});
const PORT = process.env.PORT || 4000;
connectDB().then(() => {
  app.listen(PORT, () => console.log(`SplitShare API listening on port ${PORT}`));
});
