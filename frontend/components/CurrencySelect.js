import { useMemo, useState } from "react";
import { CURRENCIES, CURRENCY_META } from "../lib/api";

export default function CurrencySelect({
  value,
  onChange,
  label,
  disabled = false,
}) {
  const [search, setSearch] = useState("");

  const filteredCurrencies = useMemo(() => {
    const query = search.trim().toLowerCase();

    return CURRENCIES.filter((currency) => {
      const metadata = CURRENCY_META[currency] || {};
      const searchableText = [
        currency,
        metadata.name || currency,
        metadata.symbol || currency,
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(query);
    });
  }, [search]);

  return (
    <div className="currency-select">
      {label && <label>{label}</label>}
      <select
        aria-label={label || "Currency"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {filteredCurrencies.map((currency) => {
          const metadata = CURRENCY_META[currency] || {};

          return (
            <option key={currency} value={currency}>
              {metadata.name || currency} ({currency}) ·{" "}
              {metadata.symbol || currency}
            </option>
          );
        })}

        {!filteredCurrencies.includes(value) && (
          <option value={value}>{value}</option>
        )}
      </select>
    </div>
  );
}
