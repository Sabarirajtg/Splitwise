require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { nanoid } = require("nanoid");
const connectDB = require("./db");
const { User, Group, Expense, Settlement, PushSubscription } = require("./models");
const { convert, getRates, convertWithSnapshot } = require("./fx");
const { toMinor, fromMinor, allocateSharesMinor, simplifyDebts, expenseSummary } = require("./calculations");
const { getVapidPublicKey, isPushConfigured, sendWebPush } = require("./webPush");

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
    res.json({ id: user._id, name: user.name, avatarUrl: user.avatarUrl || null });
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
  if (!userId || userId !== req.params.id) return res.status(403).json({ error: "You can only update your own UPI ID" });
  const normalized = typeof upiId === "string" ? upiId.trim() : "";
  if (normalized && !/^[A-Za-z0-9._-]{2,128}@[A-Za-z0-9.-]{2,64}$/.test(normalized)) return res.status(400).json({ error: "Enter a valid UPI ID, such as name@bank" });
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  user.upiId = normalized || null;
  await user.save();
  res.json({ id: user._id, upiId: user.upiId || null });
});

// ---------- Web push subscriptions ----------
app.get("/api/push/public-key", (req, res) => {
  try {
    const publicKey = getVapidPublicKey();
    res.json({ publicKey: publicKey || null, configured: Boolean(publicKey) });
  } catch (error) {
    console.error("Invalid VAPID configuration:", error.message);
    res.status(500).json({ error: "Push notifications are misconfigured" });
  }
});

app.post("/api/push/subscriptions", async (req, res) => {
  if (!requireInternal(req, res)) return;
  try {
    const { userId, endpoint, keys, expirationTime } = req.body || {};
    if (!userId || !await User.exists({ _id: userId })) {
      return res.status(401).json({ error: "Sign in to enable push notifications" });
    }
    if (!isAllowedPushEndpoint(endpoint)) {
      return res.status(400).json({ error: "Unsupported push subscription endpoint" });
    }
    if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string" ||
        keys.p256dh.length > 256 || keys.auth.length > 128) {
      return res.status(400).json({ error: "Invalid push subscription keys" });
    }
    if (!isPushConfigured()) {
      return res.status(503).json({ error: "Push notifications are not configured on the server" });
    }

    let parsedExpiration = null;
    if (expirationTime != null) {
      const timestamp = Number(expirationTime);
      if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return res.status(400).json({ error: "Invalid subscription expiration time" });
      }
      parsedExpiration = new Date(timestamp);
    }

    const subscriptionId = require("crypto").createHash("sha256").update(endpoint).digest("hex");
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        $set: { userId, keys: { p256dh: keys.p256dh, auth: keys.auth }, expirationTime: parsedExpiration },
        $setOnInsert: { _id: subscriptionId }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
    res.status(201).json({ ok: true });
  } catch (error) {
    console.error("Could not save push subscription:", error.message);
    res.status(500).json({ error: "Could not save push subscription" });
  }
});

app.delete("/api/push/subscriptions", async (req, res) => {
  if (!requireInternal(req, res)) return;
  const { userId, endpoint } = req.body || {};
  if (!userId) return res.status(401).json({ error: "Sign in to manage push notifications" });
  if (typeof endpoint !== "string" || endpoint.length > 2048) {
    return res.status(400).json({ error: "Invalid subscription endpoint" });
  }
  await PushSubscription.deleteOne({ userId, endpoint });
  res.json({ ok: true });
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
    currencyConfigured: Boolean(group.spendingCurrency), cashFxRates: group.cashFxRates || {}, expenseHistoryCutoffAt: group.expenseHistoryCutoffAt || null, memberIds: group.memberIds, simplificationOptOutIds: group.simplificationOptOutIds || [], inviteToken: group.inviteToken || null,
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

function isAllowedPushEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return host === "fcm.googleapis.com" ||
      host === "web.push.apple.com" ||
      host.endsWith(".push.apple.com") ||
      host === "push.services.mozilla.com" ||
      host.endsWith(".push.services.mozilla.com") ||
      host.endsWith(".notify.windows.com");
  } catch {
    return false;
  }
}

function formatPushAmount(amount, currency) {
  const symbols = { INR: "₹", USD: "$", EUR: "€", GBP: "£", THB: "฿", JPY: "¥", AUD: "A$", CAD: "C$", SGD: "S$", AED: "د.إ" };
  const rounded = Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
  return (symbols[currency] || (currency + " ")) + rounded.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function shortPushText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength - 1) + "…" : text;
}

async function sendPushToUser(userId, payload) {
  if (!isPushConfigured()) return;
  const subscriptions = await PushSubscription.find({ userId }).lean();
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await sendWebPush({
        endpoint: subscription.endpoint,
        keys: subscription.keys
      }, {
        ...payload,
        tag: payload.tag ? payload.tag + "-" + subscription._id : undefined
      });
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await PushSubscription.deleteOne({ _id: subscription._id });
      } else {
        console.error("Push notification delivery failed:", error.statusCode || error.message);
      }
    }
  }));
}

async function notifyPushUsers(userIds, actorId, makePayload) {
  if (!isPushConfigured()) return;
  const recipients = [...new Set((userIds || []).filter((id) => id && id !== actorId))];
  await Promise.all(recipients.map(async (recipientId) => {
    try {
      await sendPushToUser(recipientId, makePayload(recipientId));
    } catch (error) {
      console.error("Could not deliver push notification:", error.message);
    }
  }));
}

function expenseInvolvedIds(expense) {
  return [...new Set([expense.paidBy, ...(expense.splits || []).map((split) => split.userId)].filter(Boolean))];
}

async function notifyExpenseChange(group, expense, actorId, verb, previousInvolvedIds) {
  const actor = await User.findById(actorId).select("name").lean();
  const actorName = (actor && actor.name) || "A group member";
  const recipients = [...new Set([...(previousInvolvedIds || []), ...expenseInvolvedIds(expense)])]
    .filter((id) => group.memberIds.includes(id));
  await notifyPushUsers(recipients, actorId, (recipientId) => {
    const split = (expense.splits || []).find((item) => item.userId === recipientId);
    let shareText = "";
    if (verb === "added") {
      shareText = split
        ? " Your share: " + formatPushAmount(split.amount, expense.currency) + "."
        : expense.paidBy === recipientId ? " You paid for this expense." : "";
    } else if (split) {
      shareText = " Your current share: " + formatPushAmount(split.amount, expense.currency) + ".";
    } else if (previousInvolvedIds && previousInvolvedIds.includes(recipientId)) {
      shareText = " You're no longer included in this expense.";
    }
    return {
      title: verb === "added" ? "New group expense" : "Expense updated",
      body: actorName + " " + verb + " \"" + shortPushText(expense.desc, 60) + "\" in " + shortPushText(group.name, 55) + "." + shareText,
      url: "/groups/" + encodeURIComponent(group._id),
      tag: "expense-" + expense._id + "-" + verb
    };
  });
}

async function notifyExpenseDeleted(group, expense, actorId) {
  const actor = await User.findById(actorId).select("name").lean();
  const actorName = (actor && actor.name) || "A group member";
  await notifyPushUsers(expenseInvolvedIds(expense), actorId, () => ({
    title: "Expense removed",
    body: actorName + " removed \"" + shortPushText(expense.desc, 65) + "\" from " + shortPushText(group.name, 55) + ".",
    url: "/groups/" + encodeURIComponent(group._id),
    tag: "expense-" + expense._id + "-deleted"
  }));
}

async function notifySettlement(group, settlement, recipientId, actorId, kind) {
  const actor = await User.findById(actorId).select("name").lean();
  const actorName = (actor && actor.name) || "A group member";
  const amount = formatPushAmount(settlement.amount, settlement.currency);
  let title = "Payment update";
  let body = "";
  if (kind === "paid") {
    title = "Payment marked as paid";
    body = actorName + " marked " + amount + " as paid to you in " + shortPushText(group.name, 55) + ". Please confirm receipt.";
  } else if (kind === "confirmed") {
    title = "Payment confirmed";
    body = actorName + " confirmed your " + amount + " payment in " + shortPushText(group.name, 55) + ".";
  } else {
    title = "Payment needs attention";
    body = actorName + " reported they have not received your " + amount + " payment in " + shortPushText(group.name, 55) + ".";
  }
  await notifyPushUsers([recipientId], actorId, () => ({
    title,
    body,
    url: "/groups/" + encodeURIComponent(group._id),
    tag: "settlement-" + settlement._id + "-" + kind
  }));
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

  const userId = typeof req.query.userId === "string" ? req.query.userId : "";
  res.json({
    groupId: group._id,
    groupName: group.name,
    expiresAt: group.inviteExpiresAt,
    isMember: Boolean(userId && group.memberIds.some((id) => String(id) === userId)),
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
  // The editable expense date can be earlier than the moment it was entered.
  // Creation time defines newest-added-first order; date is only a fallback.
  const expenses = await Expense.find({ groupId: req.params.id }).sort({
    createdAt: -1,
    date: -1,
    _id: -1
  });
  res.json(expenses.map(mapExpense));
});

function mapExpense(e) {
  return {
    id: e._id, groupId: e.groupId, desc: e.desc, amount: e.amount, currency: e.currency,
    amountInBase: e.amountInBase, fxRate: e.fxRate, paymentMethod: e.paymentMethod || "digital", paidBy: e.paidBy, splits: e.splits, createdBy: e.createdBy || null, date: e.date,
    createdAt: e.createdAt || null, updatedAt: e.updatedAt || null,
    recurring: e.recurring, splitMethod: e.splitMethod, lastGenerated: e.lastGenerated
  };
}

async function resolveExpenseFx(amount, currency, baseCurrency, paymentMethod, requestedRate, group) {
  if (currency === baseCurrency) {
    return { amountInBase: Math.round(amount * 100) / 100, rate: 1, rates: { [currency]: 1 } };
  }

  if (paymentMethod === "cash") {
    const pairKey = `${currency}_${baseCurrency}`;
    let rate = requestedRate;
    if (rate === undefined || rate === null || rate === "") {
      rate = group.cashFxRates && group.cashFxRates[pairKey];
    }
    if (rate === undefined || rate === null || rate === "") {
      const currentRates = await getRates(currency);
      rate = currentRates[baseCurrency];
    }
    rate = Number(rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("Enter a valid cash conversion rate");
    return {
      amountInBase: Math.round(amount * rate * 100) / 100,
      rate,
      rates: { [currency]: 1, [baseCurrency]: rate },
      rememberedPair: pairKey
    };
  }

  const fx = await convertWithSnapshot(amount, currency, baseCurrency);
  return { ...fx, rememberedPair: null };
}

function rememberCashRate(group, fx) {
  if (!fx.rememberedPair || !Number.isFinite(fx.rate) || fx.rate <= 0) return;
  group.cashFxRates = { ...(group.cashFxRates || {}), [fx.rememberedPair]: fx.rate };
}

async function getGroupSimplifiedBalances(group) {
  const expenses = await Expense.find({ groupId: group._id });
  const settlements = await Settlement.find({ groupId: group._id });
  const balMinor = {};
  group.memberIds.forEach(id => (balMinor[id] = 0));
  expenses.forEach(e => {
    const baseAmount = e.amountInBase != null ? e.amountInBase : e.amount;
    balMinor[e.paidBy] = (balMinor[e.paidBy] || 0) + toMinor(baseAmount);
    const allocatedShares = allocateSharesMinor(baseAmount, e.splits || []);
    (e.splits || []).forEach((split, index) => {
      balMinor[split.userId] = (balMinor[split.userId] || 0) - allocatedShares[index];
    });
  });
  settlements.forEach(s => {
    if ((s.status || "settled") !== "settled") return;
    const amountMinor = toMinor(s.amount);
    balMinor[s.from] = (balMinor[s.from] || 0) + amountMinor;
    balMinor[s.to] = (balMinor[s.to] || 0) - amountMinor;
  });
  const balances = Object.fromEntries(Object.entries(balMinor).map(([id, amount]) => [id, fromMinor(amount)]));
  return simplifyDebts(balances, group.simplificationOptOutIds || []);
}

app.post("/api/groups/:id/expenses", async (req, res) => {
  if (!requireInternal(req, res)) return;
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    const { userId, desc, amount, currency, paymentMethod = "cash", fxRate, paidBy, date, recurring, splitMethod, splits } = req.body || {};
    if (!isGroupMember(group, userId)) return res.status(403).json({ error: "Only group members can add expenses" });
    if (typeof desc !== "string" || !desc.trim()) return res.status(400).json({ error: "Enter a description" });
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return res.status(400).json({ error: "Enter a valid amount" });
    if (!CURRENCIES.includes(currency) || !isGroupMember(group, paidBy)) return res.status(400).json({ error: "Select a valid currency and payer" });
    if (!["cash", "digital"].includes(paymentMethod)) return res.status(400).json({ error: "Select Cash or Digital Payment" });
    if (paymentMethod === "cash" && currency !== group.baseCurrency && fxRate !== undefined && (!Number.isFinite(Number(fxRate)) || Number(fxRate) <= 0)) return res.status(400).json({ error: "Enter a valid cash conversion rate" });
    if (!Array.isArray(splits) || splits.length === 0 ||
        splits.some((split) => !split || !isGroupMember(group, split.userId) ||
          !Number.isFinite(Number(split.amount)) || Number(split.amount) < 0)) {
      return res.status(400).json({ error: "Select valid people and amounts for the split" });
    }

    const fx = await resolveExpenseFx(Number(amount), currency, group.baseCurrency, paymentMethod, fxRate, group);
    const expense = await Expense.create({
      _id: nanoid(10), groupId: group._id, desc: desc.trim(), amount: Number(amount), currency,
      amountInBase: fx.amountInBase, fxRate: fx.rate, fxRates: fx.rates, paymentMethod,
      paidBy, createdBy: userId, date: date || new Date().toISOString().slice(0, 10), recurring: recurring || null,
      splitMethod, splits, lastGenerated: date
    });
    if (paymentMethod === "cash" && fx.rememberedPair) {
      rememberCashRate(group, fx);
      await group.save();
    }
    await notifyExpenseChange(group, expense, userId, "added").catch((error) => console.error("Expense notification failed:", error.message));
    res.status(201).json(mapExpense(expense));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

app.put("/api/expenses/:id", async (req, res) => {
  if (!requireInternal(req, res)) return;
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: "Not found" });
    const group = await Group.findById(expense.groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });
    const { userId, desc, amount, currency, paymentMethod = expense.paymentMethod || "digital", fxRate, paidBy, date, recurring, splitMethod, splits } = req.body || {};
    if (!isGroupMember(group, userId)) return res.status(403).json({ error: "Only group members can update expenses" });
    const allSettlements = await Settlement.find({ groupId: group._id });
    const hasOutstandingDebt = (await getGroupSimplifiedBalances(group)).length > 0;
    const cutoff = group.expenseHistoryCutoffAt ? new Date(group.expenseHistoryCutoffAt) : null;
    const settlementSinceCutoff = allSettlements.some(s => !cutoff || new Date(s.createdAt || s.date) > cutoff);
    if (hasOutstandingDebt && settlementSinceCutoff) {
      return res.status(409).json({ error: "Expenses are locked while a group settlement is in progress. Finish or resolve the reported payment before editing or deleting expenses." });
    }
    if (typeof desc !== "string" || !desc.trim() || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: "Enter a valid description and amount" });
    }
    if (!CURRENCIES.includes(currency) || !isGroupMember(group, paidBy)) return res.status(400).json({ error: "Invalid currency or payer" });
    if (!["cash", "digital"].includes(paymentMethod)) return res.status(400).json({ error: "Select Cash or Digital Payment" });
    if (paymentMethod === "cash" && currency !== group.baseCurrency && fxRate !== undefined && (!Number.isFinite(Number(fxRate)) || Number(fxRate) <= 0)) return res.status(400).json({ error: "Enter a valid cash conversion rate" });
    if (!Array.isArray(splits) || !splits.length || splits.some((split) => !group.memberIds.includes(split.userId) || !Number.isFinite(Number(split.amount)) || Number(split.amount) < 0)) {
      return res.status(400).json({ error: "Invalid expense splits" });
    }
    const previousInvolvedIds = expenseInvolvedIds(expense);
    const sameAmountCurrencyMethodAndRate = expense.amount === Number(amount) &&
      expense.currency === currency &&
      (expense.paymentMethod || "digital") === paymentMethod &&
      (paymentMethod !== "cash" || fxRate === undefined || Number(expense.fxRate) === Number(fxRate)) &&
      expense.amountInBase != null;
    const fx = sameAmountCurrencyMethodAndRate
      ? { amountInBase: expense.amountInBase, rate: expense.fxRate || 1, rates: expense.fxRates || { [currency]: 1 }, rememberedPair: paymentMethod === "cash" && currency !== group.baseCurrency ? (currency + "_" + group.baseCurrency) : null }
      : await resolveExpenseFx(Number(amount), currency, group.baseCurrency, paymentMethod, fxRate, group);
    Object.assign(expense, {
      desc: desc.trim(), amount: Number(amount), currency, amountInBase: fx.amountInBase,
      fxRate: fx.rate, fxRates: fx.rates, paymentMethod, paidBy, date, recurring: recurring || null, splitMethod, splits
    });
    if (paymentMethod === "cash" && fx.rememberedPair) {
      rememberCashRate(group, fx);
      await group.save();
    }
    await expense.save();
    await notifyExpenseChange(group, expense, userId, "updated", previousInvolvedIds).catch((error) => console.error("Expense update notification failed:", error.message));
    res.json(mapExpense(expense));
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

app.delete("/api/expenses/:id", async (req, res) => {
  if (!requireInternal(req, res)) return;
  try {
    const { userId } = req.body || {};
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: "Expense not found" });
    const group = await Group.findById(expense.groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (!isGroupMember(group, userId)) return res.status(403).json({ error: "Only group members can remove expenses" });
    const allSettlements = await Settlement.find({ groupId: group._id });
    const hasOutstandingDebt = (await getGroupSimplifiedBalances(group)).length > 0;
    const cutoff = group.expenseHistoryCutoffAt ? new Date(group.expenseHistoryCutoffAt) : null;
    const settlementSinceCutoff = allSettlements.some(s => !cutoff || new Date(s.createdAt || s.date) > cutoff);
    if (hasOutstandingDebt && settlementSinceCutoff) {
      return res.status(409).json({ error: "Expenses are locked while a group settlement is in progress. Finish or resolve the reported payment before editing or deleting expenses." });
    }
    await notifyExpenseDeleted(group, expense, userId).catch((error) => console.error("Expense deletion notification failed:", error.message));
    await Expense.deleteOne({ _id: expense._id });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not delete expense" });
  }
});

// Generate any due recurring expenses (call when opening a group)
app.post("/api/groups/:id/recurring/process", async (req, res) => {
  const group = await Group.findById(req.params.id);
  const templates = await Expense.find({ groupId: req.params.id, recurring: { $ne: null } });
  const now = new Date();
  for (const t of templates) {
    let last = new Date(t.lastGenerated || t.date);
    let next = new Date(last);
    const step = () => { if (t.recurring === "weekly") next.setDate(next.getDate() + 7); else next.setMonth(next.getMonth() + 1); };
    step();
    while (next <= now) {
      const newDate = next.toISOString().slice(0, 10);
      const generatedExpense = await Expense.create({
        _id: nanoid(10), groupId: t.groupId, desc: t.desc, amount: t.amount, currency: t.currency,
        amountInBase: t.amountInBase, fxRate: t.fxRate, fxRates: t.fxRates, paymentMethod: t.paymentMethod || "digital", paidBy: t.paidBy, splits: t.splits, date: newDate,
        createdBy: t.createdBy || null, recurring: null, splitMethod: t.splitMethod, lastGenerated: newDate, generatedFrom: t._id
      });
      if (group) {
        await notifyExpenseChange(group, generatedExpense, null, "added")
          .catch((error) => console.error("Recurring expense notification failed:", error.message));
      }
      t.lastGenerated = newDate;
      last = new Date(newDate); next = new Date(last); step();
    }
    await t.save();
  }
  res.json({ ok: true });
});

// ---------- Settlements & balances ----------
app.get("/api/groups/:id/settlements", async (req, res) => {
  const settlements = await Settlement.find({ groupId: req.params.id }).sort({
    updatedAt: -1,
    createdAt: -1,
    date: -1
  });
  res.json(settlements.map(s => ({
    id: s._id,
    groupId: s.groupId,
    from: s.from,
    to: s.to,
    amount: s.amount,
    currency: s.currency,
    date: s.date,
    status: s.status || "settled",
    reportedBy: s.reportedBy || null,
    confirmedBy: s.confirmedBy || null,
    reportedAt: s.reportedAt || s.createdAt || null,
    confirmedAt: s.confirmedAt || null,
    createdAt: s.createdAt || null,
    updatedAt: s.updatedAt || null,
    issueNote: s.issueNote || null
  })));
});

app.post("/api/groups/:id/settlements", async (req, res) => {
  if (!requireInternal(req, res)) return;
  const { from, to, amount, currency, userId, existingSettlementId, date: requestedDate } = req.body || {};
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: "Group not found" });
  if (!userId || !isGroupMember(group, userId)) return res.status(403).json({ error: "Only group members can mark payments" });

  // Reopen a disputed payment without changing its ID or original amount.
  // That keeps a later expense from being merged into the original payment.
  if (existingSettlementId) {
    const existing = await Settlement.findOne({ _id: existingSettlementId, groupId: group._id });
    if (!existing) return res.status(404).json({ error: "Payment report not found" });
    if (existing.from !== userId || from !== userId || existing.to !== to) {
      return res.status(403).json({ error: "Only the original payer can retry this payment" });
    }
    if (existing.status !== "reported_problem") {
      return res.status(409).json({ error: "Only a reported payment issue can be retried" });
    }

    existing.status = "pending_confirmation";
    existing.reportedBy = userId;
    existing.reportedAt = new Date();
    existing.confirmedBy = null;
    existing.confirmedAt = null;
    existing.issueNote = null;
    await existing.save();
    await notifySettlement(group, existing, existing.to, existing.from, "paid")
      .catch((error) => console.error("Payment retry notification failed:", error.message));
    return res.json({
      id: existing._id,
      groupId: existing.groupId,
      from: existing.from,
      to: existing.to,
      amount: existing.amount,
      currency: existing.currency,
      date: existing.date,
      status: existing.status,
      reportedAt: existing.reportedAt
    });
  }

  if (!from || userId !== from) return res.status(403).json({ error: "Only the person paying can mark this payment as paid" });
  if (!to || to === from || !isGroupMember(group, to)) return res.status(400).json({ error: "Choose a valid recipient in this group" });
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return res.status(400).json({ error: "Enter a valid payment amount" });
  if (currency !== group.baseCurrency) return res.status(400).json({ error: "Settlement amount must use the group base currency" });

  const roundedAmount = Math.round(Number(amount) * 100) / 100;
  // Block an identical duplicate request, but allow a different payment amount
  // for newer debt even when another amount is reported or awaiting confirmation.
  const duplicatePending = await Settlement.findOne({
    groupId: group._id,
    from,
    to,
    amount: roundedAmount,
    status: "pending_confirmation"
  });
  if (duplicatePending) {
    return res.status(409).json({ error: "A payment for this amount is already awaiting confirmation" });
  }

  const now = new Date();
  const s = await Settlement.create({
    _id: nanoid(10),
    groupId: group._id,
    from,
    to,
    amount: roundedAmount,
    currency,
    date: requestedDate || now.toISOString().slice(0, 10),
    status: "pending_confirmation",
    reportedBy: userId,
    reportedAt: now
  });
  await notifySettlement(group, s, to, from, "paid")
    .catch((error) => console.error("Payment notification failed:", error.message));
  res.status(201).json({
    id: s._id,
    groupId: s.groupId,
    from: s.from,
    to: s.to,
    amount: s.amount,
    currency: s.currency,
    date: s.date,
    status: s.status,
    reportedAt: s.reportedAt
  });
});

app.post("/api/groups/:groupId/settlements/:settlementId/confirm", async (req, res) => {
  if (!requireInternal(req, res)) return;
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
  const remainingDebts = await getGroupSimplifiedBalances(group);
  if (remainingDebts.length === 0) {
    group.expenseHistoryCutoffAt = settlement.confirmedAt;
    await group.save();
  }
  await notifySettlement(group, settlement, settlement.from, userId, "confirmed").catch((error) => console.error("Payment confirmation notification failed:", error.message));
  res.json({ id: settlement._id, status: settlement.status, confirmedAt: settlement.confirmedAt });
});

app.post("/api/groups/:groupId/settlements/:settlementId/report-problem", async (req, res) => {
  if (!requireInternal(req, res)) return;
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
  await notifySettlement(group, settlement, settlement.from, userId, "problem").catch((error) => console.error("Payment issue notification failed:", error.message));
  res.json({ id: settlement._id, status: settlement.status, reportedAt: settlement.reportedAt });
});

app.get("/api/users/:userId/pending-settlements", async (req, res) => {
  const userId = req.params.userId;
  const settlements = await Settlement.find({ $or: [{ to: userId, status: "pending_confirmation" }, { from: userId, status: "reported_problem" }] }).sort({ createdAt: -1 });
  if (!settlements.length) return res.json([]);
  const groupIds = [...new Set(settlements.map(s => s.groupId))];
  const memberIds = [...new Set(settlements.flatMap(s => [s.from, s.to]))];
  const [groups, users] = await Promise.all([Group.find({ _id: { $in: groupIds } }), User.find({ _id: { $in: memberIds } })]);
  const groupById = new Map(groups.map(g => [String(g._id), g]));
  const userById = new Map(users.map(u => [String(u._id), u]));
  res.json(settlements.map(s => ({ id: s._id, groupId: s.groupId, groupName: (groupById.get(String(s.groupId)) || {}).name || "Group", from: s.from, fromName: (userById.get(String(s.from)) || {}).name || "A member", to: s.to, toName: (userById.get(String(s.to)) || {}).name || "A member", amount: s.amount, currency: s.currency, status: s.status, date: s.date, createdAt: s.createdAt, issueNote: s.issueNote || null })));
});

app.get("/api/groups/:id/balances", async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: "Not found" });
  const expenses = await Expense.find({ groupId: group._id });
  const settlements = await Settlement.find({ groupId: group._id });
  // Keep the ledger in integer minor units and allocate each converted expense
  // total across splits so rounding can never create or destroy a cent.
  const balMinor = {};
  group.memberIds.forEach(id => (balMinor[id] = 0));
  expenses.forEach(e => {
    const baseAmount = e.amountInBase != null ? e.amountInBase : e.amount;
    balMinor[e.paidBy] = (balMinor[e.paidBy] || 0) + toMinor(baseAmount);
    const allocatedShares = allocateSharesMinor(baseAmount, e.splits || []);
    (e.splits || []).forEach((split, index) => {
      balMinor[split.userId] = (balMinor[split.userId] || 0) - allocatedShares[index];
    });
  });
  settlements.forEach(s => {
    if ((s.status || "settled") !== "settled") return;
    const amountMinor = toMinor(s.amount);
    balMinor[s.from] = (balMinor[s.from] || 0) + amountMinor;
    balMinor[s.to] = (balMinor[s.to] || 0) - amountMinor;
  });
  const bal = Object.fromEntries(
    Object.entries(balMinor).map(([id, amount]) => [id, fromMinor(amount)]),
  );
  const breakdown = expenseSummary(expenses.map(e => ({ amount: e.amount, currency: e.currency, amountInBase: e.amountInBase, splits: e.splits })), group.memberIds, group.baseCurrency);
  res.json({ balances: bal, simplified: simplifyDebts(bal, group.simplificationOptOutIds || []), baseCurrency: group.baseCurrency, expenseBreakdown: breakdown });
});
const PORT = process.env.PORT || 4000;
connectDB().then(() => {
  app.listen(PORT, () => console.log(`SplitShare API listening on port ${PORT}`));
});
