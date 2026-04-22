import type { FxRateRecord } from './document.js'

/** FX rows in the wealth document are always quoted vs USD (`rate` = units of `currency` per 1 USD). */
export const FX_STORAGE_BASE_CURRENCY = 'USD' as const

function normCurrency(c: string): string {
  return c.trim().toUpperCase()
}

/**
 * Latest stored quote: units of `currency` per 1 USD, using rows with `date` on or before `onOrBeforeDate`
 * (inclusive). When `onOrBeforeDate` is omitted, uses the latest row by date for that currency.
 */
export function latestUnitsOfCurrencyPerUsd(
  fxRates: FxRateRecord[],
  currency: string,
  onOrBeforeDate?: string,
): number | null {
  const c = normCurrency(currency)
  if (c === FX_STORAGE_BASE_CURRENCY) return 1
  const cutoff = onOrBeforeDate ?? '9999-12-31'
  let best: FxRateRecord | null = null
  for (const r of fxRates) {
    if (normCurrency(r.currency) !== c) continue
    if (r.date > cutoff) continue
    if (!best || r.date > best.date) best = r
  }
  if (!best || typeof best.rate !== 'number' || Number.isNaN(best.rate) || best.rate <= 0) return null
  return best.rate
}

/**
 * Convert a nominal amount from `fromCurrency` to `toCurrency` using USD as the pivot.
 * Missing FX for a non-USD leg falls back to returning the original `amount` (legacy / incomplete data).
 */
export function convertAmountViaUsdFx(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  fxRates: FxRateRecord[],
  onOrBeforeDate?: string,
): number {
  const f = normCurrency(fromCurrency)
  const t = normCurrency(toCurrency)
  if (f === t) return amount
  const rF = latestUnitsOfCurrencyPerUsd(fxRates, f, onOrBeforeDate)
  const rT = latestUnitsOfCurrencyPerUsd(fxRates, t, onOrBeforeDate)
  const usd =
    f === FX_STORAGE_BASE_CURRENCY ? amount : rF != null && rF > 0 ? amount / rF : null
  if (usd === null) return amount
  if (t === FX_STORAGE_BASE_CURRENCY) return usd
  if (rT == null || rT <= 0) return amount
  return usd * rT
}
