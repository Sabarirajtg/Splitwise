const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

async function requestNext(path, options = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

export const api = {
  getUser: (id) => request(`/users/${id}`),
  updateUpi: (id, upiId) => requestNext(`/api/users/${id}/upi`, { method: "PUT", body: JSON.stringify({ upiId }) }),
  currencies: () => request("/currencies"),
  fx: (base) => request(`/fx/${base}`),

  userGroups: (userId) => request(`/users/${userId}/groups`),
  createGroup: (name, baseCurrency, userId, spendingCurrency = baseCurrency) => request("/groups", { method: "POST", body: JSON.stringify({ name, baseCurrency, spendingCurrency, userId }) }),
  joinGroup: (groupId, userId) => request(`/groups/${groupId}/join`, { method: "POST", body: JSON.stringify({ userId }) }),
  getGroup: (id) => request(`/groups/${id}`),


  updateGroupSettings: (id, payload) =>
    requestNext(`/api/groups/${id}/settings`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  updateSimplification: (id, payload) =>
    requestNext(`/api/groups/${id}/simplification`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  getInvite: (token, userId) => requestNext("/api/invitations/" + encodeURIComponent(token) + (userId ? "?userId=" + encodeURIComponent(userId) : "")),
  joinInvite: (token, userId) =>
    requestNext(`/api/invitations/${encodeURIComponent(token)}/join`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),

  createInvite: (id, payload) =>
    requestNext(`/api/groups/${id}/invite`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  revokeInvite: (id, payload) =>
    requestNext(`/api/groups/${id}/invite`, {
      method: "DELETE",
      body: JSON.stringify(payload),
    }),


  groupExpenses: (id) => request(`/groups/${id}/expenses`),
  addExpense: (groupId, payload) => requestNext(`/api/groups/${groupId}/expenses`, { method: "POST", body: JSON.stringify(payload) }),
  updateExpense: (id, payload) => requestNext(`/api/expenses/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteExpense: (id) => requestNext(`/api/expenses/${id}`, { method: "DELETE", body: JSON.stringify({}) }),
  processRecurring: (groupId) => request(`/groups/${groupId}/recurring/process`, { method: "POST" }),

  groupSettlements: (id) => request(`/groups/${id}/settlements`),
  recordSettlement: (groupId, payload) => requestNext(`/api/groups/${groupId}/settlements`, { method: "POST", body: JSON.stringify(payload) }),
  confirmSettlement: (groupId, settlementId, userId) => requestNext(`/api/groups/${groupId}/settlements/${settlementId}/confirm`, { method: "POST", body: JSON.stringify({ userId }) }),
  reportSettlementProblem: (groupId, settlementId, userId, note) => requestNext(`/api/groups/${groupId}/settlements/${settlementId}/report-problem`, { method: "POST", body: JSON.stringify({ userId, note }) }),
  pushPublicKey: () => requestNext("/api/push/public-key"),
  savePushSubscription: (subscription) => requestNext("/api/push/subscriptions", { method: "POST", body: JSON.stringify(subscription) }),
  removePushSubscription: (endpoint) => requestNext("/api/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint }) }),
  pendingSettlements: (userId) => request(`/users/${userId}/pending-settlements`),
  balances: (groupId) => request(`/groups/${groupId}/balances`)
};

export function getSession() {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("splitshare_session");
  return raw ? JSON.parse(raw) : null;
}

export function setSession(user) {
  localStorage.setItem("splitshare_session", JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem("splitshare_session");
}

export const CURRENCIES = ["USD", "EUR", "GBP", "INR", "THB", "JPY", "AUD", "CAD", "SGD", "AED"];

export const CURRENCY_META = {
  USD: { name: "US Dollar", symbol: "$" },
  EUR: { name: "Euro", symbol: "€" },
  GBP: { name: "British Pound", symbol: "£" },
  INR: { name: "Indian Rupee", symbol: "₹" },
  THB: { name: "Thai Baht", symbol: "฿" },
  JPY: { name: "Japanese Yen", symbol: "¥" },
  AUD: { name: "Australian Dollar", symbol: "A$" },
  CAD: { name: "Canadian Dollar", symbol: "C$" },
  SGD: { name: "Singapore Dollar", symbol: "S$" },
  AED: { name: "UAE Dirham", symbol: "د.إ" },
};

const SYMBOLS = Object.fromEntries(
  Object.entries(CURRENCY_META).map(([code, metadata]) => [code, metadata.symbol])
);

export function money(n, cur) {
  const v = Math.round((n + Number.EPSILON) * 100) / 100;
  return (SYMBOLS[cur] || cur + " ") + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function initials(name) {
  return (name || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

export function todayISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
