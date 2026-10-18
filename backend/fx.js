const fetch = require("node-fetch");

// Rates are cached for one hour per source currency.
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;

async function getRates(baseCurrency) {
  const cached = cache.get(baseCurrency);
  const cacheIsFresh =
    cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;

  if (cacheIsFresh) {
    return cached.rates;
  }

  const response = await fetch(
    `https://open.er-api.com/v6/latest/${baseCurrency}`,
  );

  if (!response.ok) {
    if (cached) return cached.rates;
    throw new Error("Failed to fetch FX rates");
  }

  const data = await response.json();

  if (data.result !== "success") {
    if (cached) return cached.rates;
    throw new Error("FX provider returned an error");
  }

  const rates = { ...data.rates, [baseCurrency]: 1 };
  cache.set(baseCurrency, { rates, fetchedAt: Date.now() });

  return rates;
}

async function convertWithSnapshot(amount, fromCurrency, toCurrency) {
  const rates = await getRates(fromCurrency);
  const rate =
    fromCurrency === toCurrency ? 1 : rates[toCurrency];

  if (!rate) {
    throw new Error(
      `No FX rate available for ${fromCurrency} -> ${toCurrency}`,
    );
  }

  return {
    amountInBase: Math.round(amount * rate * 100) / 100,
    rate,
    rates: { ...rates, [fromCurrency]: 1 },
  };
}

async function convert(amount, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  const result = await convertWithSnapshot(
    amount,
    fromCurrency,
    toCurrency,
  );

  return result.amountInBase;
}

module.exports = {
  getRates,
  convert,
  convertWithSnapshot,
};
