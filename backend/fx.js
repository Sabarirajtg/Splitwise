const fetch = require("node-fetch");

// Free, no-key FX API. Cached in memory for 1 hour per base currency.
const cache = new Map(); // base -> {rates, fetchedAt}
const TTL_MS = 60 * 60 * 1000;

async function getRates(base) {
  const cached = cache.get(base);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.rates;
  }
  // open.er-api.com is free, keyless, and covers a broad currency set (incl. THB, INR)
  const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
  if (!res.ok) {
    if (cached) return cached.rates; // fall back to stale cache if API hiccups
    throw new Error("Failed to fetch FX rates");
  }
  const data = await res.json();
  if (data.result !== "success") {
    if (cached) return cached.rates;
    throw new Error("FX provider returned an error");
  }
  const rates = { ...data.rates, [base]: 1 };
  cache.set(base, { rates, fetchedAt: Date.now() });
  return rates;
}

async function convertWithSnapshot(amount, from, to) {
 if (from === to) return { amountInBase: amount, rate: 1, rates: { [from]: 1 } };
 const rates = await getRates(from), rate = rates[to];
 if (!rate) throw new Error(`No FX rate available for ${from} -> ${to}`);
 return { amountInBase: Math.round(amount * rate * 100) / 100, rate, rates: { ...rates, [from]: 1 } };
}
async function convert(amount, from, to) { if (from === to) return amount; return (await convertWithSnapshot(amount, from, to)).amountInBase; }
module.exports = { getRates, convert, convertWithSnapshot };
