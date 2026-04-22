import { FX_STORAGE_BASE_CURRENCY } from '@nonsheet-finance/core'

const hub = FX_STORAGE_BASE_CURRENCY

/** FX rows: `{ date, fromCurrency, toCurrency, rate }` — **rate** = units of **toCurrency** per **1** **fromCurrency**. */
export function buildFxRatesAiPrompt(baseCurrency: string): string {
  const base = (baseCurrency || 'EUR').trim().toUpperCase() || 'EUR'
  const baseToHub =
    base === hub
      ? ''
      : `- One series **${base}**→**${hub}** (book currency to hub) so amounts in **${base}** connect to other crosses.\n`

  return `You are producing data for a personal finance app.

Output: a single JSON array only (no markdown, no explanation). Each element must be an object with exactly these keys:
- "date": string, calendar date in YYYY-MM-DD (use the last day of each calendar quarter).
- "fromCurrency": string, 3-letter ISO 4217 — **From** leg of the quote.
- "toCurrency": string, 3-letter ISO 4217 — **To** leg (must differ from **fromCurrency**).
- "rate": number, strictly positive: units of **toCurrency** per **1** **fromCurrency** (so amount in To = amount in From × rate).

Context:
- The user's **base / book currency** is **${base}**. Treat **${base}** as the primary **From** currency when reasoning about which crosses matter for their balances.
- Each row is self-contained: no implicit pivot. You may still use **${hub}** as a convenient hub currency in the data you emit.

Required rows (one time series each, same quarter-end dates):
${baseToHub}- **${hub}**→**EUR**, **${hub}**→**ILS**, and **${hub}**→**GBP**

Date coverage: for each required series above, emit one row per **calendar quarter** from **2020-Q1** through the **current quarter** (inclusive), using the **quarter-end** date (e.g. 2020-03-31, 2020-06-30, …).

Use realistic historical FX levels where you can; if uncertain, approximate clearly and stay internally consistent.`
}

export type StockValuationHoldingLine = { assetId: string; label: string }

/** Security valuation marks: `{ assetId, date, sharePrice }` (+ optional fields). */
export function buildStockValuationsAiPrompt(holdings: StockValuationHoldingLine[]): string {
  const lines =
    holdings.length > 0
      ? holdings.map((h) => `- assetId "${h.assetId}" — ${h.label}`).join('\n')
      : '(No holdings were loaded; ask the user for their assetId UUIDs from the app, or describe securities and they will map IDs manually.)'

  return `You are producing data for a personal finance app: **dated per-share marks** (not trades).

Output: a single JSON array only (no markdown, no explanation). Each element must be an object with at least:
- "assetId": string UUID (must match one of the holdings listed below when importing into this file).
- "date": string YYYY-MM-DD or full ISO datetime (end of quarter is fine).
- "sharePrice": number ≥ 0 (price per share in the security's natural currency at that date).

Optional keys if helpful: "note" (string), "currency" (3-letter ISO).

Date coverage: for **each** holding below, produce one mark per **calendar quarter** from **2020-Q1** through the **current quarter** (inclusive), using quarter-end dates, with plausible share prices for that security.

Holdings in this document (use these assetId values exactly):
${lines}`
}

export type SecurityInfoLine = { isin: string; ticker: string; name: string; currency: string }

/** Stock reference rows: \`{ isin, ticker, name, currency }\`. */
export function buildStockInformationAiPrompt(existing: SecurityInfoLine[]): string {
  const existingBlock =
    existing.length > 0
      ? `Reference rows already in the file (you may refresh names/tickers/currency or add new ISINs; user will choose import mode):\n${existing
          .map((r) => `- ${r.isin} — ${r.ticker} — ${r.name} (${r.currency})`)
          .join('\n')}`
      : 'The reference table is currently empty.'

  return `You are producing data for a personal finance app: a **security reference** table (ISIN → display fields).

Output: a single JSON array only (no markdown, no explanation). Each element must be an object with exactly these keys:
- "isin": string, uppercase ISIN.
- "ticker": string, common trading symbol.
- "name": string, issuer / security display name.
- "currency": string, 3-letter ISO for the price / share currency typically used for this line.

${existingBlock}

Task: output a concise set of rows for **liquid, widely held** equities and ETFs (mix of US and international) that a retail portfolio might hold—at least **15** distinct ISINs unless the list above already covers enough, in which case you may align with or extend that set. Use **valid ISO 6166 ISIN** values (2-letter country code + 9-character NSIN + 1 check character).`
}
