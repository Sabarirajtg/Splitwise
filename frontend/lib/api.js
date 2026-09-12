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

export const api = {
  login: (name, pin) => request("/auth/login", { method: "POST", body: JSON.stringify({ name, pin }) }),
  getUser: (id) => request(`/users/${id}`),
  currencies: () => request("/currencies"),
  fx: (base) => request(`/fx/${base}`),

  userGroups: (userId) => request(`/users/${userId}/groups`),
  createGroup: (name, baseCurrency, userId) => request("/groups", { method: "POST", body: JSON.stringify({ name, baseCurrency, userId }) }),
  joinGroup: (groupId, userId) => request(`/groups/${groupId}/join`, { method: "POST", body: JSON.stringify({ userId }) }),
  getGroup: (id) => request(`/groups/${id}`),

  groupExpenses: (id) => request(`/groups/${id}/expenses`),
  addExpense: (groupId, payload) => request(`/groups/${groupId}/expenses`, { method: "POST", body: JSON.stringify(payload) }),
  updateExpense: (id, payload) => request(`/expenses/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteExpense: (id) => request(`/expenses/${id}`, { method: "DELETE" }),
  processRecurring: (groupId) => request(`/groups/${groupId}/recurring/process`, { method: "POST" }),

  groupSettlements: (id) => request(`/groups/${id}/settlements`),
  recordSettlement: (groupId, payload) => request(`/groups/${groupId}/settlements`, { method: "POST", body: JSON.stringify(payload) }),
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

const SYMBOLS = { USD: "$", EUR: "€", GBP: "£", INR: "₹", THB: "฿", JPY: "¥", AUD: "A$", CAD: "C$", SGD: "S$", AED: "د.إ" };

export function money(n, cur) {
  const v = Math.round((n + Number.EPSILON) * 100) / 100;
  return (SYMBOLS[cur] || cur + " ") + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function initials(name) {
  return (name || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
