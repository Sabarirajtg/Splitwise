require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { nanoid } = require("nanoid");
const connectDB = require("./db");
const { User, Group, Expense, Settlement } = require("./models");
const { convert, getRates } = require("./fx");

const app = express();
app.use(cors());
app.use(express.json());

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "THB", "JPY", "AUD", "CAD", "SGD", "AED"];

// ---------- Auth ----------
app.post("/api/auth/login", async (req, res) => {
  try {
    const { name, pin } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Enter your name" });
    if (!pin || pin.length < 4) return res.status(400).json({ error: "PIN must be at least 4 digits" });
    const nameLower = name.trim().toLowerCase();
    let user = await User.findOne({ nameLower });
    if (user) {
      if (user.pin !== pin) return res.status(401).json({ error: "Wrong PIN for this name" });
    } else {
      user = await User.create({ _id: nanoid(10), name: name.trim(), nameLower, pin });
    }
    res.json({ id: user._id, name: user.name });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/users/:id", async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json({ id: user._id, name: user.name });
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
  const { name, baseCurrency, userId } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Enter a group name" });
  if (!CURRENCIES.includes(baseCurrency)) return res.status(400).json({ error: "Invalid currency" });
  const group = await Group.create({
    _id: nanoid(10), name: name.trim(), baseCurrency, memberIds: [userId], createdBy: userId
  });
  res.json({ id: group._id, name: group.name, baseCurrency: group.baseCurrency, memberIds: group.memberIds });
});

app.post("/api/groups/:id/join", async (req, res) => {
  const { userId } = req.body;
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: "No group found with that code" });
  if (!group.memberIds.includes(userId)) {
    group.memberIds.push(userId);
    await group.save();
  }
  res.json({ id: group._id, name: group.name, baseCurrency: group.baseCurrency, memberIds: group.memberIds });
});

app.get("/api/groups/:id", async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: "Not found" });
  const members = await User.find({ _id: { $in: group.memberIds } });
  res.json({
    id: group._id, name: group.name, baseCurrency: group.baseCurrency, memberIds: group.memberIds,
    members: members.map(m => ({ id: m._id, name: m.name }))
  });
});

// ---------- Expenses ----------
app.get("/api/groups/:id/expenses", async (req, res) => {
  const expenses = await Expense.find({ groupId: req.params.id }).sort({ date: -1 });
  res.json(expenses.map(mapExpense));
});

function mapExpense(e) {
  return {
    id: e._id, groupId: e.groupId, desc: e.desc, amount: e.amount, currency: e.currency,
    amountInBase: e.amountInBase, paidBy: e.paidBy, splits: e.splits, date: e.date,
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
    const amountInBase = await convert(amount, currency, group.baseCurrency);
    Object.assign(expense, { desc, amount, currency, amountInBase, paidBy, date, recurring: recurring || null, splitMethod, splits });
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
        amountInBase: t.amountInBase, paidBy: t.paidBy, splits: t.splits, date: newDate,
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
  const settlements = await Settlement.find({ groupId: req.params.id }).sort({ date: -1 });
  res.json(settlements.map(s => ({ id: s._id, groupId: s.groupId, from: s.from, to: s.to, amount: s.amount, currency: s.currency, date: s.date })));
});

app.post("/api/groups/:id/settlements", async (req, res) => {
  const { from, to, amount, currency } = req.body;
  const s = await Settlement.create({
    _id: nanoid(10), groupId: req.params.id, from, to, amount, currency, date: new Date().toISOString().slice(0, 10)
  });
  res.json({ id: s._id, from: s.from, to: s.to, amount: s.amount, currency: s.currency, date: s.date });
});

function simplifyDebts(balances) {
  const creditors = [], debtors = [];
  Object.entries(balances).forEach(([id, amt]) => {
    const a = Math.round(amt * 100) / 100;
    if (a > 0.005) creditors.push({ id, amt: a });
    else if (a < -0.005) debtors.push({ id, amt: -a });
  });
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);
  const txns = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i], c = creditors[j];
    const amt = Math.min(d.amt, c.amt);
    txns.push({ from: d.id, to: c.id, amount: Math.round(amt * 100) / 100 });
    d.amt -= amt; c.amt -= amt;
    if (d.amt < 0.005) i++;
    if (c.amt < 0.005) j++;
  }
  return txns;
}

app.get("/api/groups/:id/balances", async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: "Not found" });
  const expenses = await Expense.find({ groupId: group._id });
  const settlements = await Settlement.find({ groupId: group._id });

  const bal = {};
  group.memberIds.forEach(id => (bal[id] = 0));
  expenses.forEach(e => {
    // amountInBase is the paid amount converted to group's base currency
    const baseAmount = e.amountInBase != null ? e.amountInBase : e.amount;
    const ratio = baseAmount / e.amount;
    bal[e.paidBy] = (bal[e.paidBy] || 0) + baseAmount;
    e.splits.forEach(s => {
      bal[s.userId] = (bal[s.userId] || 0) - Math.round(s.amount * ratio * 100) / 100;
    });
  });
  settlements.forEach(s => {
    bal[s.from] = (bal[s.from] || 0) + s.amount;
    bal[s.to] = (bal[s.to] || 0) - s.amount;
  });

  res.json({ balances: bal, simplified: simplifyDebts(bal), baseCurrency: group.baseCurrency });
});

const PORT = process.env.PORT || 4000;
connectDB().then(() => {
  app.listen(PORT, () => console.log(`SplitShare API listening on port ${PORT}`));
});
