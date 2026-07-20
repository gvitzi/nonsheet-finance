/**
 * Builds a dated net-worth series from valuations and ledgers (no manual net-worth rows).
 * Amounts are converted to `displayCurrency` using explicit `fxRates` from→to pairs (see `fxUsd.ts`).
 */

import type { FxRateRecord } from './document.js'
import { convertAmountViaFxRates } from './fxUsd.js'
import { mortgageDebtContributionsAsOf } from './propertyMortgageAggregate.js'

const SEC = 'securities'
const KIND_PURCHASE = 'purchase'
const KIND_SALE = 'sale'

export type PropertySlice = {
  valuations: { date: Date; value: number; currency: string }[]
  mortgages: { date: Date; outstandingBalance: number; currency: string; loanId?: string | null }[]
}

export type AssetSlice = {
  category: string
  estimatedValue: number
  currency: string
  securityTransactions: { date: Date; createdAt: Date; kind: string; quantity: number }[]
  securityValuations: { date: Date; sharePrice: number; currency: string }[]
  assetValuations: { date: Date; value: number; currency: string }[]
}

export type LiabilityBalanceSlice = {
  outstandingBalance: number
  currency: string
}

function endOfDay(d: Date): number {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x.getTime()
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function latestPropertyValueMetaBefore(
  vals: { date: Date; value: number; currency: string }[],
  asOf: Date,
  fallback: { value: number; currency: string },
): { value: number; currency: string } {
  const t = endOfDay(asOf)
  const eligible = vals.filter((v) => v.date.getTime() <= t)
  if (!eligible.length) return fallback
  eligible.sort((a, b) => b.date.getTime() - a.date.getTime())
  const row = eligible[0]
  return { value: row.value, currency: row.currency }
}

function positionAtDate(
  txs: { date: Date; createdAt: Date; kind: string; quantity: number }[],
  asOf: Date,
): number {
  const t = endOfDay(asOf)
  const sorted = [...txs]
    .filter((x) => x.date.getTime() <= t)
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime())
  let pos = 0
  for (const x of sorted) {
    const q = x.quantity
    if (Number.isNaN(q)) continue
    if (x.kind === KIND_PURCHASE) pos += q
    else if (x.kind === KIND_SALE) pos -= q
  }
  return Math.max(0, pos)
}

function sharePriceMetaAtDate(
  vals: { date: Date; sharePrice: number; currency: string }[],
  asOf: Date,
): { sharePrice: number; currency: string } | null {
  const t = endOfDay(asOf)
  const eligible = vals.filter((v) => v.date.getTime() <= t)
  if (!eligible.length) return null
  eligible.sort((a, b) => b.date.getTime() - a.date.getTime())
  const p = eligible[0].sharePrice
  if (Number.isNaN(p)) return null
  return { sharePrice: p, currency: eligible[0].currency }
}

function assetMarkValueMetaBefore(
  vals: { date: Date; value: number; currency: string }[],
  asOf: Date,
  fallback: { value: number; currency: string },
): { value: number; currency: string } {
  const t = endOfDay(asOf)
  const eligible = vals.filter((v) => v.date.getTime() <= t)
  if (!eligible.length) return fallback
  eligible.sort((a, b) => b.date.getTime() - a.date.getTime())
  return { value: eligible[0].value, currency: eligible[0].currency }
}

function zeroAssetFallback(vals: { date: Date; value: number; currency: string }[], assetCurrency: string): { value: number; currency: string } {
  return vals[0] ? { value: 0, currency: vals[0].currency } : { value: 0, currency: assetCurrency }
}

function collectDates(properties: PropertySlice[], assets: AssetSlice[]): Date[] {
  const out: number[] = []
  const push = (d: Date) => out.push(d.getTime())
  for (const p of properties) {
    for (const v of p.valuations) push(v.date)
    for (const m of p.mortgages) push(m.date)
  }
  for (const a of assets) {
    for (const v of a.securityValuations) push(v.date)
    for (const v of a.assetValuations) push(v.date)
    for (const t of a.securityTransactions) push(t.date)
  }
  push(new Date())
  const uniq = [...new Set(out)].sort((x, y) => x - y)
  return uniq.map((ms) => new Date(ms))
}

export type GroupHistoryItem = {
  id: string
  name: string
  series: Array<{ date: string; value: number }>
}

export type GroupHistoryFxOptions = {
  fxRates: FxRateRecord[]
  displayCurrency: string
}

export function computeGroupHistory(
  input: {
    generalAssets?: Array<{
      id: string
      name: string
      estimatedValue: number
      currency: string
      assetValuations: { date: Date; value: number; currency: string }[]
    }>
    securitiesAssets?: Array<{
      id: string
      name: string
      securityTransactions: { date: Date; createdAt: Date; kind: string; quantity: number }[]
      securityValuations: { date: Date; sharePrice: number; currency: string }[]
    }>
    realEstateProperties?: Array<{
      id: string
      name: string
      valuations: { date: Date; value: number; currency: string }[]
      mortgages: { date: Date; outstandingBalance: number; currency: string; loanId?: string | null }[]
    }>
  },
  fx?: GroupHistoryFxOptions,
): GroupHistoryItem[] {
  const toKey = (d: Date) => d.toISOString().slice(0, 10)
  const asOf = (dk: string) => new Date(dk)
  const items: GroupHistoryItem[] = []

  const conv = (amount: number, from: string, dateKey: string) =>
    fx
      ? convertAmountViaFxRates(amount, from, fx.displayCurrency, fx.fxRates, dateKey)
      : amount

  for (const asset of input.generalAssets ?? []) {
    const dateKeys = [...new Set(asset.assetValuations.map((v) => toKey(v.date)))].sort()
    if (dateKeys.length === 0) {
      const dk = toKey(new Date())
      items.push({
        id: asset.id,
        name: asset.name,
        series: [{ date: dk, value: conv(asset.estimatedValue, asset.currency, dk) }],
      })
      continue
    }
    const allKeys = [...new Set([...dateKeys, toKey(new Date())])].sort()
    const series = allKeys.map((dk) => {
      const meta = assetMarkValueMetaBefore(asset.assetValuations, asOf(dk), zeroAssetFallback(asset.assetValuations, asset.currency))
      return { date: dk, value: conv(meta.value, meta.currency, dk) }
    })
    items.push({ id: asset.id, name: asset.name, series })
  }

  for (const asset of input.securitiesAssets ?? []) {
    const dateKeys = [...new Set(asset.securityValuations.map((v) => toKey(v.date)))].sort()
    if (dateKeys.length === 0) continue
    const series = dateKeys.flatMap((dk) => {
      const pos = positionAtDate(asset.securityTransactions, asOf(dk))
      const px = sharePriceMetaAtDate(asset.securityValuations, asOf(dk))
      if (px != null && pos > 0) {
        const raw = pos * px.sharePrice
        return [{ date: dk, value: conv(raw, px.currency, dk) }]
      }
      return []
    })
    if (series.length > 0) items.push({ id: asset.id, name: asset.name, series })
  }

  for (const prop of input.realEstateProperties ?? []) {
    const valFallbackCur = prop.valuations[0]?.currency ?? 'USD'
    const dateKeys = [
      ...new Set([
        ...prop.valuations.map((v) => toKey(v.date)),
        ...prop.mortgages.map((m) => toKey(m.date)),
        toKey(new Date()),
      ]),
    ].sort()
    const series = dateKeys.flatMap((dk) => {
      const vMeta = latestPropertyValueMetaBefore(prop.valuations, asOf(dk), { value: 0, currency: valFallbackCur })
      if (vMeta.value === 0 && prop.valuations.length === 0) return []
      const mContrib = mortgageDebtContributionsAsOf(
        prop.mortgages.map((m) => ({
          date: m.date,
          loanId: m.loanId,
          outstandingBalance: m.outstandingBalance,
          currency: m.currency,
        })),
        asOf(dk),
      )
      let mSum = 0
      for (const c of mContrib) {
        mSum += conv(c.value, c.currency, dk)
      }
      const net = conv(vMeta.value, vMeta.currency, dk) - mSum
      return [{ date: dk, value: net }]
    })
    if (series.length > 0) items.push({ id: prop.id, name: prop.name, series })
  }

  return items
}

export function computeNetWorthHistorySeries(input: {
  displayCurrency: string
  fxRates: FxRateRecord[]
  properties: PropertySlice[]
  assets: AssetSlice[]
  liabilities: LiabilityBalanceSlice[]
}): Array<{
  id: string
  asOfDate: Date
  netWorth: number
  totalAssets: number
  totalLiabilities: number
  currency: string
  note: string | null
}> {
  const { displayCurrency, fxRates, properties, assets, liabilities } = input
  const dates = collectDates(properties, assets)
  const series: Array<{
    id: string
    asOfDate: Date
    netWorth: number
    totalAssets: number
    totalLiabilities: number
    currency: string
    note: string | null
  }> = []

  for (const asOf of dates) {
    const dk = toDateKey(asOf)
    const cvt = (amount: number, from: string) =>
      convertAmountViaFxRates(amount, from, displayCurrency, fxRates, dk)

    let propertyAssets = 0
    let propertyMortgages = 0
    for (const p of properties) {
      const valFb = p.valuations[0]
        ? { value: 0, currency: p.valuations[0].currency }
        : { value: 0, currency: 'USD' }
      const vMeta = latestPropertyValueMetaBefore(p.valuations, asOf, valFb)
      const mContrib = mortgageDebtContributionsAsOf(
        p.mortgages.map((m) => ({
          date: m.date,
          loanId: m.loanId,
          outstandingBalance: m.outstandingBalance,
          currency: m.currency,
        })),
        asOf,
      )
      propertyAssets += cvt(vMeta.value, vMeta.currency)
      for (const c of mContrib) {
        propertyMortgages += cvt(c.value, c.currency)
      }
    }

    let otherAssets = 0
    let securitiesAssets = 0
    for (const a of assets) {
      if (a.category === SEC) {
        const qty = positionAtDate(a.securityTransactions, asOf)
        const px = sharePriceMetaAtDate(a.securityValuations, asOf)
        if (px != null && qty > 0) securitiesAssets += cvt(qty * px.sharePrice, px.currency)
      } else {
        const meta = assetMarkValueMetaBefore(a.assetValuations, asOf, zeroAssetFallback(a.assetValuations, a.currency))
        otherAssets += cvt(meta.value, meta.currency)
      }
    }

    let nonMortgageLiabilities = 0
    for (const l of liabilities) {
      nonMortgageLiabilities += cvt(l.outstandingBalance, l.currency)
    }

    const totalAssets = propertyAssets + securitiesAssets + otherAssets
    const totalLiabilities = propertyMortgages + nonMortgageLiabilities
    const netWorth = totalAssets - totalLiabilities

    series.push({
      id: `nw-${asOf.getTime()}`,
      asOfDate: asOf,
      netWorth,
      totalAssets,
      totalLiabilities,
      currency: displayCurrency,
      note: null,
    })
  }

  return series
}

export type PropertyTimelineSlice = PropertySlice & { assetGroupId: string }

export type AssetTimelineSlice = AssetSlice & {
  assetGroupId: string | null | undefined
  archivedAt?: string | null | undefined
}

export type LiabilityTimelineSlice = LiabilityBalanceSlice & { assetGroupId: string | null | undefined }

/**
 * For each timeline date, net worth (assets − liabilities) attributed to each asset group.
 * Ungrouped assets and liabilities are omitted from per-group values but still reflected in portfolio total elsewhere.
 */
export function computeNetWorthByAssetGroupAtDates(input: {
  displayCurrency: string
  fxRates: FxRateRecord[]
  dates: Date[]
  assetGroupIds: string[]
  properties: PropertyTimelineSlice[]
  assets: AssetTimelineSlice[]
  liabilities: LiabilityTimelineSlice[]
}): Record<string, number>[] {
  const { displayCurrency, fxRates, dates, assetGroupIds, properties, assets, liabilities } = input
  const out: Record<string, number>[] = []

  for (const asOf of dates) {
    const dk = toDateKey(asOf)
    const cvt = (amount: number, from: string) =>
      convertAmountViaFxRates(amount, from, displayCurrency, fxRates, dk)

    const sums: Record<string, number> = {}
    for (const id of assetGroupIds) sums[id] = 0

    for (const p of properties) {
      const gid = p.assetGroupId
      if (!(gid in sums)) continue
      const valFb = p.valuations[0]
        ? { value: 0, currency: p.valuations[0].currency }
        : { value: 0, currency: 'USD' }
      const vMeta = latestPropertyValueMetaBefore(p.valuations, asOf, valFb)
      const mContrib = mortgageDebtContributionsAsOf(
        p.mortgages.map((m) => ({
          date: m.date,
          loanId: m.loanId,
          outstandingBalance: m.outstandingBalance,
          currency: m.currency,
        })),
        asOf,
      )
      let mSum = 0
      for (const c of mContrib) {
        mSum += cvt(c.value, c.currency)
      }
      const net = cvt(vMeta.value, vMeta.currency) - mSum
      sums[gid] += net
    }

    for (const a of assets) {
      if (a.archivedAt) continue
      const gid = a.assetGroupId
      if (!gid || !(gid in sums)) continue
      if (a.category === SEC) {
        const qty = positionAtDate(a.securityTransactions, asOf)
        const px = sharePriceMetaAtDate(a.securityValuations, asOf)
        if (px != null && qty > 0) sums[gid] += cvt(qty * px.sharePrice, px.currency)
      } else {
        const meta = assetMarkValueMetaBefore(a.assetValuations, asOf, zeroAssetFallback(a.assetValuations, a.currency))
        sums[gid] += cvt(meta.value, meta.currency)
      }
    }

    for (const l of liabilities) {
      const gid = l.assetGroupId
      if (!gid || !(gid in sums)) continue
      sums[gid] -= cvt(l.outstandingBalance, l.currency)
    }

    out.push(sums)
  }

  return out
}
