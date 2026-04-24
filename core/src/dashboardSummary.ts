import type { WealthDocument } from './document.js'
import { convertAmountViaFxRates } from './fxUsd.js'
import { mortgageDebtContributionsAsOf } from './propertyMortgageAggregate.js'
import {
  computeNetWorthByAssetGroupAtDates,
  computeNetWorthHistorySeries,
  type AssetTimelineSlice,
  type LiabilityTimelineSlice,
  type PropertyTimelineSlice,
} from './netWorthHistory.js'

export type NetWorthHistoryPointPayload = {
  id: string
  asOfDate: string
  netWorth: number
  totalAssets?: number | null
  totalLiabilities?: number | null
  currency: string
  note?: string | null
  createdAt: string
  updatedAt: string
}

export type DashboardAssetGroupBreakdownPayload = {
  id: string
  name: string
  color: string | null
  kind: string
  portfolioId: string
  portfolioName: string
  totalAssets: number
  totalLiabilities: number
  netWorth: number
}

export type DashboardPortfolioBreakdownPayload = {
  id: string
  name: string
  color: string | null
  totalAssets: number
  totalLiabilities: number
  netWorth: number
}

export type DashboardTimelineChartPayload = {
  assetGroups: Array<{ id: string; name: string; portfolioName: string; color: string | null }>
  points: Array<{
    asOfDate: string
    dateLabel: string
    totalNetWorth: number
    netWorthByGroupId: Record<string, number>
  }>
}

export type DashboardSummaryPayload = {
  /** Amounts in the payload are aggregated in this currency (`settings.baseCurrency`). FX rows are explicit from→to pairs. */
  displayCurrency: string
  /** Default dashboard view currency from settings (`displayCurrency` or `baseCurrency`). */
  defaultDisplayCurrency: string
  totalAssets: number
  totalLiabilities: number
  netWorth: number
  counts: {
    portfolios: number
    assetGroups: number
    assets: number
    liabilities: number
    snapshots: number
  }
  snapshots: NetWorthHistoryPointPayload[]
  byAssetGroup: DashboardAssetGroupBreakdownPayload[]
  byPortfolio: DashboardPortfolioBreakdownPayload[]
  timelineChart: DashboardTimelineChartPayload
}

function toDate(iso: string): Date {
  return new Date(iso)
}

function latestByDate<T extends { date: string }>(rows: T[]): T | undefined {
  if (!rows.length) return undefined
  return [...rows].sort((a, b) => toDate(b.date).getTime() - toDate(a.date).getTime())[0]
}

/** Dashboard totals and breakdowns; amounts converted to `settings.baseCurrency` using explicit `fxRates` pairs. */
export function computeDashboardSummary(doc: WealthDocument): DashboardSummaryPayload {
  const displayCurrency = doc.settings.baseCurrency ?? 'EUR'
  const defaultDisplayCurrency = (doc.settings.displayCurrency?.trim() || displayCurrency).toUpperCase()
  const fxRates = doc.fxRates

  const cvt = (amount: number, fromCurrency: string) =>
    convertAmountViaFxRates(amount, fromCurrency, displayCurrency, fxRates, undefined)

  const assets = doc.assets
  const liabilities = doc.liabilities
  const assetGroups = doc.assetGroups
  const properties = doc.properties
  const portfolios = doc.portfolios

  const valuationsByProperty = new Map<string, typeof doc.propertyValuations>()
  for (const v of doc.propertyValuations) {
    const list = valuationsByProperty.get(v.propertyId) ?? []
    list.push(v)
    valuationsByProperty.set(v.propertyId, list)
  }
  const mortgagesByProperty = new Map<string, typeof doc.propertyMortgages>()
  for (const m of doc.propertyMortgages) {
    const list = mortgagesByProperty.get(m.propertyId) ?? []
    list.push(m)
    mortgagesByProperty.set(m.propertyId, list)
  }

  const txsByAsset = new Map<string, typeof doc.securityTransactions>()
  for (const t of doc.securityTransactions) {
    const list = txsByAsset.get(t.assetId) ?? []
    list.push(t)
    txsByAsset.set(t.assetId, list)
  }
  const secValByAsset = new Map<string, Array<{ date: Date; sharePrice: number; currency: string }>>()
  for (const v of doc.securityValuations) {
    const list = secValByAsset.get(v.assetId) ?? []
    list.push({ date: toDate(v.date), sharePrice: v.sharePrice, currency: v.currency })
    secValByAsset.set(v.assetId, list)
  }
  const assetValByAsset = new Map<string, typeof doc.assetValuations>()
  for (const v of doc.assetValuations) {
    const list = assetValByAsset.get(v.assetId) ?? []
    list.push(v)
    assetValByAsset.set(v.assetId, list)
  }

  const propertySlices = properties.map((p) => ({
    valuations: (valuationsByProperty.get(p.id) ?? []).map((v) => ({
      date: toDate(v.date),
      value: v.value,
      currency: v.currency,
    })),
    mortgages: (mortgagesByProperty.get(p.id) ?? []).map((m) => ({
      date: toDate(m.date),
      outstandingBalance: m.outstandingBalance,
      currency: m.currency,
      loanId: m.loanId,
    })),
  }))

  const propertySlicesWithGroup: PropertyTimelineSlice[] = properties.map((p) => ({
    assetGroupId: p.assetGroupId,
    valuations: (valuationsByProperty.get(p.id) ?? []).map((v) => ({
      date: toDate(v.date),
      value: v.value,
      currency: v.currency,
    })),
    mortgages: (mortgagesByProperty.get(p.id) ?? []).map((m) => ({
      date: toDate(m.date),
      outstandingBalance: m.outstandingBalance,
      currency: m.currency,
      loanId: m.loanId,
    })),
  }))

  const assetSlices = assets.map((a) => ({
    category: a.category,
    estimatedValue: a.estimatedValue,
    currency: a.currency,
    securityTransactions: (txsByAsset.get(a.id) ?? []).map((t) => ({
      date: toDate(t.date),
      createdAt: toDate(t.createdAt),
      kind: t.kind,
      quantity: t.quantity,
    })),
    securityValuations: secValByAsset.get(a.id) ?? [],
    assetValuations: (assetValByAsset.get(a.id) ?? []).map((v) => ({
      date: toDate(v.date),
      value: v.value,
      currency: v.currency,
    })),
  }))

  const assetSlicesWithGroup: AssetTimelineSlice[] = assets.map((a) => ({
    category: a.category,
    estimatedValue: a.estimatedValue,
    currency: a.currency,
    assetGroupId: a.assetGroupId,
    archivedAt: a.archivedAt,
    securityTransactions: (txsByAsset.get(a.id) ?? []).map((t) => ({
      date: toDate(t.date),
      createdAt: toDate(t.createdAt),
      kind: t.kind,
      quantity: t.quantity,
    })),
    securityValuations: secValByAsset.get(a.id) ?? [],
    assetValuations: (assetValByAsset.get(a.id) ?? []).map((v) => ({
      date: toDate(v.date),
      value: v.value,
      currency: v.currency,
    })),
  }))

  const liabilitySlicesWithGroup: LiabilityTimelineSlice[] = liabilities.map((l) => ({
    outstandingBalance: l.outstandingBalance,
    currency: l.currency,
    assetGroupId: l.assetGroupId,
  }))

  const historySeries = computeNetWorthHistorySeries({
    displayCurrency,
    fxRates,
    properties: propertySlices,
    assets: assetSlices,
    liabilities: liabilities.map((l) => ({ outstandingBalance: l.outstandingBalance, currency: l.currency })),
  })

  const assetGroupIds = assetGroups.map((g) => g.id)
  const netByGroupSeries =
    assetGroupIds.length > 0 && historySeries.length > 0
      ? computeNetWorthByAssetGroupAtDates({
          displayCurrency,
          fxRates,
          dates: historySeries.map((r) => r.asOfDate),
          assetGroupIds,
          properties: propertySlicesWithGroup,
          assets: assetSlicesWithGroup,
          liabilities: liabilitySlicesWithGroup,
        })
      : historySeries.map(() => ({} as Record<string, number>))

  const toIso = (d: Date) => d.toISOString()
  const snapshots: NetWorthHistoryPointPayload[] = historySeries.map((row) => ({
    id: row.id,
    asOfDate: toIso(row.asOfDate),
    netWorth: row.netWorth,
    totalAssets: row.totalAssets,
    totalLiabilities: row.totalLiabilities,
    currency: row.currency,
    note: row.note,
    createdAt: toIso(row.asOfDate),
    updatedAt: toIso(row.asOfDate),
  }))
  const snapshotCount = snapshots.length

  const manualAssets = assets.reduce((sum, a) => sum + cvt(a.estimatedValue, a.currency), 0)
  const manualLiabilities = liabilities.reduce((sum, l) => sum + cvt(l.outstandingBalance, l.currency), 0)

  let propertyAssetSum = 0
  let propertyLiabilitySum = 0
  const propertyContributionByAssetGroup: Record<string, { assets: number; liabilities: number }> = {}

  const nowForMortgages = new Date()
  for (const p of properties) {
    const vals = valuationsByProperty.get(p.id) ?? []
    const morts = mortgagesByProperty.get(p.id) ?? []
    const latestV = latestByDate(vals)
    const v = latestV?.value ?? 0
    const vCur = latestV?.currency ?? 'USD'
    const mContrib = mortgageDebtContributionsAsOf(
      morts.map((m) => ({
        date: m.date,
        loanId: m.loanId,
        outstandingBalance: m.outstandingBalance,
        currency: m.currency,
      })),
      nowForMortgages,
    )
    let mSum = 0
    for (const c of mContrib) {
      mSum += cvt(c.value, c.currency)
    }
    propertyAssetSum += cvt(v, vCur)
    propertyLiabilitySum += mSum
    if (!propertyContributionByAssetGroup[p.assetGroupId]) {
      propertyContributionByAssetGroup[p.assetGroupId] = { assets: 0, liabilities: 0 }
    }
    propertyContributionByAssetGroup[p.assetGroupId].assets += cvt(v, vCur)
    propertyContributionByAssetGroup[p.assetGroupId].liabilities += mSum
  }

  const totalAssets = manualAssets + propertyAssetSum
  const totalLiabilities = manualLiabilities + propertyLiabilitySum
  const netWorth = totalAssets - totalLiabilities

  const assetGroupMap: Record<string, DashboardAssetGroupBreakdownPayload> = {}

  for (const g of assetGroups) {
    const pf = portfolios.find((p) => p.id === g.portfolioId)
    assetGroupMap[g.id] = {
      id: g.id,
      name: g.name,
      color: g.color ?? null,
      kind: g.kind,
      portfolioId: g.portfolioId,
      portfolioName: pf?.name ?? '',
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
    }
  }

  for (const asset of assets) {
    if (!asset.assetGroupId || !assetGroupMap[asset.assetGroupId]) continue
    assetGroupMap[asset.assetGroupId].totalAssets += cvt(asset.estimatedValue, asset.currency)
  }
  for (const liability of liabilities) {
    if (!liability.assetGroupId || !assetGroupMap[liability.assetGroupId]) continue
    assetGroupMap[liability.assetGroupId].totalLiabilities += cvt(liability.outstandingBalance, liability.currency)
  }
  for (const [gid, contrib] of Object.entries(propertyContributionByAssetGroup)) {
    if (!assetGroupMap[gid]) continue
    assetGroupMap[gid].totalAssets += contrib.assets
    assetGroupMap[gid].totalLiabilities += contrib.liabilities
  }

  for (const g of Object.values(assetGroupMap)) {
    g.netWorth = g.totalAssets - g.totalLiabilities
  }

  const portfolioMap: Record<string, DashboardPortfolioBreakdownPayload> = {}

  for (const p of portfolios) {
    portfolioMap[p.id] = {
      id: p.id,
      name: p.name,
      color: p.color ?? null,
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
    }
  }

  for (const g of Object.values(assetGroupMap)) {
    const slot = portfolioMap[g.portfolioId]
    if (!slot) continue
    slot.totalAssets += g.totalAssets
    slot.totalLiabilities += g.totalLiabilities
  }
  for (const p of Object.values(portfolioMap)) {
    p.netWorth = p.totalAssets - p.totalLiabilities
  }

  const timelineChart: DashboardTimelineChartPayload = {
    assetGroups: assetGroups.map((g) => {
      const pf = portfolios.find((p) => p.id === g.portfolioId)
      return {
        id: g.id,
        name: g.name,
        portfolioName: pf?.name ?? '',
        color: g.color ?? null,
      }
    }),
    points: historySeries.map((row, i) => ({
      asOfDate: toIso(row.asOfDate),
      dateLabel: row.asOfDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
      totalNetWorth: row.netWorth,
      netWorthByGroupId: netByGroupSeries[i] ?? {},
    })),
  }

  return {
    displayCurrency,
    defaultDisplayCurrency,
    totalAssets,
    totalLiabilities,
    netWorth,
    counts: {
      portfolios: portfolios.length,
      assetGroups: assetGroups.length,
      assets: assets.length,
      liabilities: liabilities.length,
      snapshots: snapshotCount,
    },
    snapshots,
    byAssetGroup: Object.values(assetGroupMap),
    byPortfolio: Object.values(portfolioMap),
    timelineChart,
  }
}
