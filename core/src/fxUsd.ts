import type { FxRateRecord } from './document.js'

/** Legacy default "from" when old rows only stored a `currency` (To) leg. */
export const FX_STORAGE_BASE_CURRENCY = 'USD' as const

function normCurrency(c: string): string {
  return c.trim().toUpperCase()
}

/**
 * Latest observation per directed pair (from→to) on or before `onOrBeforeDate`, then bidirectional edges:
 * forward mult = rate (1 from = rate × to), inverse mult = 1/rate.
 */
function buildAdjacency(
  fxRates: FxRateRecord[],
  onOrBeforeDate?: string,
): Map<string, { to: string; mult: number }[]> {
  const cutoff = onOrBeforeDate ?? '9999-12-31'
  const bestForward = new Map<string, FxRateRecord>()
  for (const r of fxRates) {
    if (r.date > cutoff) continue
    const f = normCurrency(r.fromCurrency)
    const t = normCurrency(r.toCurrency)
    if (f === t) continue
    if (typeof r.rate !== 'number' || Number.isNaN(r.rate) || r.rate <= 0) continue
    const k = `${f}\t${t}`
    const prev = bestForward.get(k)
    if (!prev || r.date > prev.date) bestForward.set(k, r)
  }

  const adj = new Map<string, { to: string; mult: number }[]>()
  const add = (from: string, to: string, mult: number) => {
    if (!adj.has(from)) adj.set(from, [])
    adj.get(from)!.push({ to, mult })
  }

  for (const r of bestForward.values()) {
    const f = normCurrency(r.fromCurrency)
    const t = normCurrency(r.toCurrency)
    const rate = r.rate
    add(f, t, rate)
    add(t, f, 1 / rate)
  }

  return adj
}

/**
 * Convert `amount` in `fromCurrency` to `toCurrency` using explicit FX rows (BFS on the rate graph).
 * Uses the latest row per directed (from,to) pair on or before `onOrBeforeDate`.
 * If no path exists, returns `amount` unchanged (same as previous USD-pivot fallback).
 */
export function convertAmountViaFxRates(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  fxRates: FxRateRecord[],
  onOrBeforeDate?: string,
): number {
  const f = normCurrency(fromCurrency)
  const t = normCurrency(toCurrency)
  if (f === t) return amount

  const adj = buildAdjacency(fxRates, onOrBeforeDate)
  const visited = new Set<string>()
  const queue: { cur: string; amt: number }[] = [{ cur: f, amt: amount }]
  visited.add(f)

  while (queue.length > 0) {
    const { cur, amt } = queue.shift()!
    if (cur === t) return amt
    for (const e of adj.get(cur) ?? []) {
      if (visited.has(e.to)) continue
      visited.add(e.to)
      queue.push({ cur: e.to, amt: amt * e.mult })
    }
  }

  return amount
}

/** @deprecated Use {@link convertAmountViaFxRates}; behavior is identical (USD is not special). */
export const convertAmountViaUsdFx = convertAmountViaFxRates
