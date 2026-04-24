import {
  activeRentPeriodForProperty,
  computeDashboardSummary,
  computeGroupHistory,
  decodeSecurityValuationId,
  findOverlappingRentPeriods,
  mergeFxRateRecords,
  mergeSecurityInfoRecords,
  newEntityTimestamps,
  rentPeriodDateYmd,
  securityValuationIdForAsset,
  tryCoerceFxRateImportRow,
  type FxRateRecord,
  type GroupHistoryItem,
  type PropertyRentPeriodRecord,
  type SecurityValuationRecord,
  type WealthDocument,
} from '@nonsheet-finance/core'
import type {
  Asset,
  AssetGroup,
  AssetGroupHistory,
  AssetValuation,
  DashboardSummary,
  JsonImportMode,
  Liability,
  Portfolio,
  Property,
  PropertyExpense,
  PropertyMortgageEntry,
  PropertyRentPeriod,
  PropertyValuation,
  SecurityInfoRecord,
  SecurityInfoRecordInput,
  SecurityTransaction,
  SecurityTransactionInput,
  SecurityValuation,
  SecurityValuationInput,
  Settings,
} from './apiTypes'
import { ApiError } from './apiTypes'
import { PORTFOLIOS_UPDATED_EVENT } from './groupKinds'
import {
  syncGeneralAssetEstimatedFromValuations,
  syncSecuritiesHolding,
  syncSecuritiesHoldingsByIsin,
  validateLedgerWithChange,
} from './securitiesSync'
import { getWealthDocument, updateWealthDocument } from './wealthDocStore'

function nowIso(): string {
  return new Date().toISOString()
}

function randomId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function notifyPortfolios() {
  window.dispatchEvent(new CustomEvent(PORTFOLIOS_UPDATED_EVENT))
}

function rej(status: number, message: string): Promise<never> {
  return Promise.reject(new ApiError(message, status))
}

function derivedMonthlyCashflow(
  rent: number | null | undefined,
  mortgagePayment: number | null | undefined,
): number | null {
  const r = rent != null && !Number.isNaN(rent) ? rent : null
  const m = mortgagePayment != null && !Number.isNaN(mortgagePayment) ? mortgagePayment : null
  if (r === null && m === null) return null
  return (r ?? 0) - (m ?? 0)
}

function localCalendarYmd(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function normalizeTenantNames(names: string[] | undefined): string[] {
  if (!names?.length) return []
  return names.map((s) => String(s).trim()).filter((s) => s.length > 0)
}

/** Local-calendar YYYY-MM-DD arithmetic (matches `new Date(ymd + 'T12:00:00')` in this module). */
function addCalendarDaysToYmd(ymd: string, deltaDays: number): string {
  const y = Number(ymd.slice(0, 4))
  const month = Number(ymd.slice(5, 7))
  const day = Number(ymd.slice(8, 10))
  const d = new Date(y, month - 1, day + deltaDays)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Open-ended periods use an unbounded end in overlap checks, so a second "open" period would always fail.
 * Before adding or moving a period to `newStartYmd`, end any still-open period on this property that
 * starts strictly earlier, at the calendar day before `newStartYmd`.
 */
function withOpenRentPeriodsClosedBeforeStart(
  periods: PropertyRentPeriodRecord[],
  propertyId: string,
  newStartYmd: string,
  updatedAt: string,
): PropertyRentPeriodRecord[] {
  if (newStartYmd.length < 10) return periods
  const prevEndYmd = addCalendarDaysToYmd(newStartYmd, -1)
  return periods.map((r) => {
    if (r.propertyId !== propertyId) return r
    const open = r.endDate == null || r.endDate === ''
    if (!open) return r
    const rs = rentPeriodDateYmd(r.startDate)
    if (rs.length < 10 || rs >= newStartYmd) return r
    if (prevEndYmd < rs) return r
    return { ...r, endDate: new Date(prevEndYmd + 'T12:00:00').toISOString(), updatedAt }
  })
}

function assertRentPeriodNoOverlap(doc: WealthDocument, candidate: PropertyRentPeriodRecord, ignoreId?: string): void {
  const hits = findOverlappingRentPeriods(doc.propertyRentPeriods, candidate, ignoreId)
  if (hits.length > 0) throw new ApiError('This rent period overlaps an existing one for this property.', 400)
}

function infoByIsin(doc: WealthDocument): Map<string, { ticker: string; name: string }> {
  const m = new Map<string, { ticker: string; name: string }>()
  for (const r of doc.securityInfo) {
    m.set(r.isin.trim().toUpperCase(), { ticker: r.ticker, name: r.name })
  }
  return m
}

function securitiesHistoryDisplayName(
  asset: { name: string; isin: string | null | undefined },
  info: { ticker: string; name: string } | undefined,
): string {
  const refName = info?.name?.trim()
  if (refName) return refName
  const tk = info?.ticker?.trim()
  if (tk) return tk
  const n = asset.name.trim()
  const isinKey = asset.isin?.trim().toUpperCase() ?? ''
  if (n && (!isinKey || n.toUpperCase() !== isinKey)) return n
  return isinKey || 'Security'
}

function enrichAsset(doc: WealthDocument, a: (typeof doc.assets)[0]): Asset {
  if (a.category !== 'securities' || !a.isin?.trim()) return a as Asset
  const inf = infoByIsin(doc).get(a.isin.trim().toUpperCase())
  return {
    ...(a as Asset),
    ticker: inf?.ticker ?? null,
    securityName: inf?.name ?? null,
  }
}

function serializeProperty(doc: WealthDocument, p: (typeof doc.properties)[0]): Property {
  const ag = doc.assetGroups.find((g) => g.id === p.assetGroupId)
  const active = activeRentPeriodForProperty(doc.propertyRentPeriods, p.id, localCalendarYmd())
  const effectiveMonthlyRent = active ? active.rent : 0
  const effectiveMonthlyHausgeld = active ? active.hausgeld : 0
  const rentTotal = effectiveMonthlyRent + effectiveMonthlyHausgeld
  return {
    ...p,
    effectiveMonthlyRent,
    effectiveMonthlyHausgeld,
    monthlyCashflow: derivedMonthlyCashflow(rentTotal, p.monthlyMortgagePayment),
    assetGroup: ag ? { id: ag.id, name: ag.name, kind: ag.kind } : undefined,
  } as Property
}

function findSecurityValuation(doc: WealthDocument, id: string) {
  const direct = doc.securityValuations.find((v) => v.id === id)
  if (direct) return direct
  const dec = decodeSecurityValuationId(id)
  if (!dec) return undefined
  return doc.securityValuations.find((v) => {
    const a = doc.assets.find((x) => x.id === v.assetId)
    const isin = a?.isin?.trim().toUpperCase()
    const dk = v.date.slice(0, 10)
    if (dec.assetId) return v.assetId === dec.assetId && isin === dec.isin && dk === dec.dateKey
    return isin === dec.isin && dk === dec.dateKey
  })
}

function serializeSecurityValuation(doc: WealthDocument, v: (typeof doc.securityValuations)[0]): SecurityValuation {
  const asset = doc.assets.find((a) => a.id === v.assetId)
  const isinKey = asset?.isin?.trim().toUpperCase()
  const inf = isinKey ? infoByIsin(doc).get(isinKey) : undefined
  const ag = asset?.assetGroupId ? doc.assetGroups.find((g) => g.id === asset.assetGroupId) : undefined
  const pf = ag ? doc.portfolios.find((p) => p.id === ag.portfolioId) : undefined
  return {
    id: v.id,
    assetId: v.assetId,
    isin: v.isin ?? asset?.isin ?? undefined,
    date: v.date,
    sharePrice: v.sharePrice,
    currency: v.currency,
    note: v.note ?? null,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    asset: asset
      ? {
          id: asset.id,
          name: asset.name,
          currency: asset.currency,
          category: asset.category,
          assetGroupId: asset.assetGroupId ?? null,
          isin: asset.isin ?? null,
          ticker: inf?.ticker ?? null,
          securityName: inf?.name ?? null,
          assetGroup: ag && pf ? { id: ag.id, name: ag.name, portfolioId: pf.id } : null,
        }
      : undefined,
  }
}

function serializeSecurityTransaction(doc: WealthDocument, t: (typeof doc.securityTransactions)[0]): SecurityTransaction {
  const asset = doc.assets.find((a) => a.id === t.assetId)
  const isinKey = asset?.isin?.trim().toUpperCase()
  const inf = isinKey ? infoByIsin(doc).get(isinKey) : undefined
  return {
    id: t.id,
    assetGroupId: t.assetGroupId,
    assetId: t.assetId,
    date: t.date,
    kind: t.kind as SecurityTransaction['kind'],
    quantity: t.quantity,
    pricePerShare: t.pricePerShare,
    note: t.note ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    asset: asset
      ? {
          id: asset.id,
          name: asset.name,
          currency: asset.currency,
          category: asset.category,
          assetGroupId: asset.assetGroupId ?? null,
          isin: asset.isin ?? null,
          ticker: inf?.ticker ?? null,
          securityName: inf?.name ?? null,
        }
      : undefined,
  }
}

export const api = {
  properties: {
    list: (assetGroupId: string, includeArchived?: boolean): Promise<Property[]> => {
      const d = getWealthDocument()
      let list = d.properties.filter((p) => p.assetGroupId === assetGroupId)
      if (!includeArchived) list = list.filter((p) => !p.archivedAt)
      return Promise.resolve(list.map((p) => serializeProperty(d, p)))
    },
    get: (id: string): Promise<Property> => {
      const d = getWealthDocument()
      const p = d.properties.find((x) => x.id === id)
      if (!p) return rej(404, 'Not found')
      return Promise.resolve(serializeProperty(d, p))
    },
    archive: (id: string): Promise<Property> => {
      const t = nowIso()
      updateWealthDocument((d) => {
        const props = d.properties.map((p) => (p.id === id ? { ...p, archivedAt: t, updatedAt: t } : p))
        return { ...d, properties: props }
      })
      notifyPortfolios()
      return api.properties.get(id)
    },
    unarchive: (id: string): Promise<Property> => {
      const t = nowIso()
      updateWealthDocument((d) => {
        const props = d.properties.map((p) => (p.id === id ? { ...p, archivedAt: null, updatedAt: t } : p))
        return { ...d, properties: props }
      })
      notifyPortfolios()
      return api.properties.get(id)
    },
    create: (data: {
      assetGroupId: string
      name: string
      description?: string | null
      notes?: string | null
      address?: string | null
      monthlyMortgagePayment?: number | null
    }): Promise<Property> => {
      const d0 = getWealthDocument()
      const g = d0.assetGroups.find((x) => x.id === data.assetGroupId)
      if (!g) return rej(404, 'Asset group not found')
      if (g.kind !== 'real_estate') return rej(400, 'Properties are only available for real estate asset groups')
      const { createdAt, updatedAt } = newEntityTimestamps()
      const row = {
        id: randomId(),
        assetGroupId: data.assetGroupId,
        name: data.name,
        description: data.description ?? null,
        notes: data.notes ?? null,
        address: data.address ?? null,
        monthlyRent: null,
        monthlyMortgagePayment: data.monthlyMortgagePayment ?? null,
        archivedAt: null,
        createdAt,
        updatedAt,
      }
      updateWealthDocument((d) => ({ ...d, properties: [...d.properties, row] }))
      notifyPortfolios()
      return api.properties.get(row.id)
    },
    update: (
      id: string,
      data: Partial<Pick<Property, 'name' | 'description' | 'notes' | 'address' | 'monthlyMortgagePayment'>>,
    ): Promise<Property> => {
      const t = nowIso()
      updateWealthDocument((d) => ({
        ...d,
        properties: d.properties.map((p) => (p.id === id ? { ...p, ...data, updatedAt: t } : p)),
      }))
      notifyPortfolios()
      return api.properties.get(id)
    },
    delete: (id: string): Promise<void> => {
      updateWealthDocument((d) => ({
        ...d,
        properties: d.properties.filter((p) => p.id !== id),
        propertyValuations: d.propertyValuations.filter((v) => v.propertyId !== id),
        propertyMortgages: d.propertyMortgages.filter((m) => m.propertyId !== id),
        propertyExpenses: d.propertyExpenses.filter((e) => e.propertyId !== id),
        propertyRentPeriods: d.propertyRentPeriods.filter((r) => r.propertyId !== id),
      }))
      notifyPortfolios()
      return Promise.resolve()
    },
    listValuations: (propertyId: string): Promise<PropertyValuation[]> => {
      const d = getWealthDocument()
      return Promise.resolve(
        d.propertyValuations
          .filter((v) => v.propertyId === propertyId)
          .map((v) => {
            const prop = d.properties.find((p) => p.id === propertyId)
            return {
              ...v,
              property: prop ? { id: prop.id, name: prop.name } : undefined,
            } as PropertyValuation
          }),
      )
    },
    createValuation: (propertyId: string, data: { date: string; value: number; currency?: string }): Promise<PropertyValuation> => {
      const { createdAt, updatedAt } = newEntityTimestamps()
      const row = {
        id: randomId(),
        propertyId,
        date: data.date,
        value: data.value,
        currency: data.currency ?? 'EUR',
        createdAt,
        updatedAt,
      }
      updateWealthDocument((d) => ({ ...d, propertyValuations: [...d.propertyValuations, row] }))
      return Promise.resolve({ ...row } as PropertyValuation)
    },
    updateValuation: (
      propertyId: string,
      valuationId: string,
      data: Partial<{ date: string; value: number; currency: string }>,
    ): Promise<PropertyValuation> => {
      const t = nowIso()
      updateWealthDocument((d) => ({
        ...d,
        propertyValuations: d.propertyValuations.map((v) =>
          v.id === valuationId && v.propertyId === propertyId ? { ...v, ...data, updatedAt: t } : v,
        ),
      }))
      const d = getWealthDocument()
      const v = d.propertyValuations.find((x) => x.id === valuationId)
      if (!v) return rej(404, 'Not found')
      return Promise.resolve({ ...v } as PropertyValuation)
    },
    deleteValuation: (propertyId: string, valuationId: string): Promise<void> => {
      updateWealthDocument((d) => ({
        ...d,
        propertyValuations: d.propertyValuations.filter((v) => !(v.id === valuationId && v.propertyId === propertyId)),
      }))
      return Promise.resolve()
    },
    listMortgageEntries: (propertyId: string): Promise<PropertyMortgageEntry[]> => {
      const d = getWealthDocument()
      return Promise.resolve(
        d.propertyMortgages
          .filter((m) => m.propertyId === propertyId)
          .map((m) => {
            const prop = d.properties.find((p) => p.id === propertyId)
            return { ...m, property: prop ? { id: prop.id, name: prop.name } : undefined } as PropertyMortgageEntry
          }),
      )
    },
    createMortgageEntry: (
      propertyId: string,
      data: { date: string; outstandingBalance: number; currency?: string; loanName?: string | null },
    ): Promise<PropertyMortgageEntry> => {
      const { createdAt, updatedAt } = newEntityTimestamps()
      const row = {
        id: randomId(),
        propertyId,
        date: data.date,
        outstandingBalance: data.outstandingBalance,
        currency: data.currency ?? 'EUR',
        loanName: data.loanName ?? null,
        createdAt,
        updatedAt,
      }
      updateWealthDocument((d) => ({ ...d, propertyMortgages: [...d.propertyMortgages, row] }))
      return Promise.resolve({ ...row } as PropertyMortgageEntry)
    },
    updateMortgageEntry: (
      propertyId: string,
      entryId: string,
      data: Partial<{ date: string; outstandingBalance: number; currency: string; loanName: string | null }>,
    ): Promise<PropertyMortgageEntry> => {
      const t = nowIso()
      updateWealthDocument((d) => ({
        ...d,
        propertyMortgages: d.propertyMortgages.map((m) =>
          m.id === entryId && m.propertyId === propertyId ? { ...m, ...data, updatedAt: t } : m,
        ),
      }))
      const d = getWealthDocument()
      const m = d.propertyMortgages.find((x) => x.id === entryId)
      if (!m) return rej(404, 'Not found')
      return Promise.resolve({ ...m } as PropertyMortgageEntry)
    },
    deleteMortgageEntry: (propertyId: string, entryId: string): Promise<void> => {
      updateWealthDocument((d) => ({
        ...d,
        propertyMortgages: d.propertyMortgages.filter((m) => !(m.id === entryId && m.propertyId === propertyId)),
      }))
      return Promise.resolve()
    },
    listExpenses: (propertyId: string): Promise<PropertyExpense[]> => {
      const d = getWealthDocument()
      return Promise.resolve(
        d.propertyExpenses
          .filter((e) => e.propertyId === propertyId)
          .map((e) => {
            const prop = d.properties.find((p) => p.id === propertyId)
            return { ...e, property: prop ? { id: prop.id, name: prop.name } : undefined } as PropertyExpense
          }),
      )
    },
    createExpense: (
      propertyId: string,
      data: { date: string; name: string; description?: string | null; amount: number },
    ): Promise<PropertyExpense> => {
      const { createdAt, updatedAt } = newEntityTimestamps()
      const row = {
        id: randomId(),
        propertyId,
        date: data.date,
        name: data.name,
        description: data.description ?? null,
        amount: data.amount,
        createdAt,
        updatedAt,
      }
      updateWealthDocument((d) => ({ ...d, propertyExpenses: [...d.propertyExpenses, row] }))
      return Promise.resolve({ ...row } as PropertyExpense)
    },
    updateExpense: (
      propertyId: string,
      expenseId: string,
      data: Partial<{ date: string; name: string; description: string | null; amount: number }>,
    ): Promise<PropertyExpense> => {
      const t = nowIso()
      updateWealthDocument((d) => ({
        ...d,
        propertyExpenses: d.propertyExpenses.map((e) =>
          e.id === expenseId && e.propertyId === propertyId ? { ...e, ...data, updatedAt: t } : e,
        ),
      }))
      const d = getWealthDocument()
      const e = d.propertyExpenses.find((x) => x.id === expenseId)
      if (!e) return rej(404, 'Not found')
      return Promise.resolve({ ...e } as PropertyExpense)
    },
    deleteExpense: (propertyId: string, expenseId: string): Promise<void> => {
      updateWealthDocument((d) => ({
        ...d,
        propertyExpenses: d.propertyExpenses.filter((e) => !(e.id === expenseId && e.propertyId === propertyId)),
      }))
      return Promise.resolve()
    },
    listRentPeriods: (propertyId: string): Promise<PropertyRentPeriod[]> => {
      const d = getWealthDocument()
      const rows = d.propertyRentPeriods
        .filter((r) => r.propertyId === propertyId)
        .sort((a, b) => rentPeriodDateYmd(b.startDate).localeCompare(rentPeriodDateYmd(a.startDate)))
      return Promise.resolve(
        rows.map((r) => {
          const prop = d.properties.find((p) => p.id === propertyId)
          return { ...r, property: prop ? { id: prop.id, name: prop.name } : undefined } as PropertyRentPeriod
        }),
      )
    },
    createRentPeriod: (
      propertyId: string,
      data: {
        startDate: string
        endDate?: string | null
        rent: number
        hausgeld?: number
        tenantNames?: string[]
        notes?: string | null
      },
    ): Promise<PropertyRentPeriod> => {
      const d0 = getWealthDocument()
      if (!d0.properties.some((p) => p.id === propertyId)) return rej(404, 'Property not found')
      if (Number.isNaN(data.rent) || data.rent < 0) return rej(400, 'Rent must be a non-negative number.')
      const hg = data.hausgeld ?? 0
      if (Number.isNaN(hg) || hg < 0) return rej(400, 'Hausgeld must be a non-negative number.')
      const startYmd = rentPeriodDateYmd(data.startDate)
      const endYmd =
        data.endDate != null && String(data.endDate).trim() !== '' ? rentPeriodDateYmd(String(data.endDate)) : null
      if (startYmd.length < 10) return rej(400, 'Start date is required.')
      if (endYmd != null && endYmd.length >= 10 && endYmd < startYmd) return rej(400, 'End date must be on or after start date.')
      const { createdAt, updatedAt } = newEntityTimestamps()
      const row: PropertyRentPeriodRecord = {
        id: randomId(),
        propertyId,
        startDate: new Date(startYmd + 'T12:00:00').toISOString(),
        endDate: endYmd != null && endYmd.length >= 10 ? new Date(endYmd + 'T12:00:00').toISOString() : null,
        rent: data.rent,
        hausgeld: hg,
        tenantNames: normalizeTenantNames(data.tenantNames),
        notes: data.notes?.trim() ? data.notes.trim() : null,
        createdAt,
        updatedAt,
      }
      const touch = nowIso()
      const periodsAdjusted = withOpenRentPeriodsClosedBeforeStart(d0.propertyRentPeriods, propertyId, startYmd, touch)
      assertRentPeriodNoOverlap({ ...d0, propertyRentPeriods: periodsAdjusted }, row)
      updateWealthDocument((d) => ({
        ...d,
        propertyRentPeriods: [...withOpenRentPeriodsClosedBeforeStart(d.propertyRentPeriods, propertyId, startYmd, touch), row],
      }))
      notifyPortfolios()
      const prop = d0.properties.find((p) => p.id === propertyId)
      return Promise.resolve({ ...row, property: prop ? { id: prop.id, name: prop.name } : undefined } as PropertyRentPeriod)
    },
    updateRentPeriod: (
      propertyId: string,
      periodId: string,
      data: Partial<{
        startDate: string
        endDate: string | null
        rent: number
        hausgeld: number
        tenantNames: string[]
        notes: string | null
      }>,
    ): Promise<PropertyRentPeriod> => {
      const d0 = getWealthDocument()
      const prev = d0.propertyRentPeriods.find((r) => r.id === periodId && r.propertyId === propertyId)
      if (!prev) return rej(404, 'Not found')
      const t = nowIso()
      const startYmd = data.startDate !== undefined ? rentPeriodDateYmd(data.startDate) : rentPeriodDateYmd(prev.startDate)
      let endYmd: string | null
      if (data.endDate === undefined) {
        endYmd = prev.endDate != null && prev.endDate !== '' ? rentPeriodDateYmd(prev.endDate) : null
      } else if (data.endDate === null || String(data.endDate).trim() === '') {
        endYmd = null
      } else {
        endYmd = rentPeriodDateYmd(String(data.endDate))
      }
      if (startYmd.length < 10) return rej(400, 'Start date is required.')
      if (endYmd != null && endYmd.length >= 10 && endYmd < startYmd) return rej(400, 'End date must be on or after start date.')
      const rent = data.rent !== undefined ? data.rent : prev.rent
      if (Number.isNaN(rent) || rent < 0) return rej(400, 'Rent must be a non-negative number.')
      const hausgeld = data.hausgeld !== undefined ? data.hausgeld : prev.hausgeld
      if (Number.isNaN(hausgeld) || hausgeld < 0) return rej(400, 'Hausgeld must be a non-negative number.')
      const candidate: PropertyRentPeriodRecord = {
        ...prev,
        startDate: new Date(startYmd + 'T12:00:00').toISOString(),
        endDate: endYmd != null && endYmd.length >= 10 ? new Date(endYmd + 'T12:00:00').toISOString() : null,
        rent,
        hausgeld,
        tenantNames: data.tenantNames !== undefined ? normalizeTenantNames(data.tenantNames) : prev.tenantNames,
        notes: data.notes !== undefined ? (data.notes?.trim() ? data.notes.trim() : null) : prev.notes,
        updatedAt: t,
      }
      const base = d0.propertyRentPeriods.filter((r) => !(r.id === periodId && r.propertyId === propertyId))
      const periodsAdjusted = withOpenRentPeriodsClosedBeforeStart(base, propertyId, startYmd, t)
      assertRentPeriodNoOverlap({ ...d0, propertyRentPeriods: periodsAdjusted }, candidate, periodId)
      updateWealthDocument((d) => {
        const base0 = d.propertyRentPeriods.filter((r) => !(r.id === periodId && r.propertyId === propertyId))
        const adj = withOpenRentPeriodsClosedBeforeStart(base0, propertyId, startYmd, t)
        return { ...d, propertyRentPeriods: [...adj, candidate] }
      })
      notifyPortfolios()
      const d = getWealthDocument()
      const out = d.propertyRentPeriods.find((x) => x.id === periodId)
      if (!out) return rej(404, 'Not found')
      const prop = d.properties.find((p) => p.id === propertyId)
      return Promise.resolve({ ...out, property: prop ? { id: prop.id, name: prop.name } : undefined } as PropertyRentPeriod)
    },
    deleteRentPeriod: (propertyId: string, periodId: string): Promise<void> => {
      updateWealthDocument((d) => ({
        ...d,
        propertyRentPeriods: d.propertyRentPeriods.filter((r) => !(r.id === periodId && r.propertyId === propertyId)),
      }))
      notifyPortfolios()
      return Promise.resolve()
    },
  },

  portfolios: {
    list: (): Promise<Portfolio[]> => {
      const d = getWealthDocument()
      return Promise.resolve(
        d.portfolios.map((p) => ({
          ...p,
          assetGroups: d.assetGroups.filter((g) => g.portfolioId === p.id),
        })),
      )
    },
    get: (id: string): Promise<Portfolio> => {
      const d = getWealthDocument()
      const p = d.portfolios.find((x) => x.id === id)
      if (!p) return rej(404, 'Not found')
      return Promise.resolve({
        ...p,
        assetGroups: d.assetGroups.filter((g) => g.portfolioId === id),
      })
    },
    create: (data: Partial<Portfolio>): Promise<Portfolio> => {
      const { createdAt, updatedAt } = newEntityTimestamps()
      const row = {
        id: randomId(),
        name: data.name?.trim() || 'Portfolio',
        description: data.description ?? null,
        color: data.color ?? null,
        icon: data.icon ?? null,
        createdAt,
        updatedAt,
      }
      updateWealthDocument((d) => ({ ...d, portfolios: [...d.portfolios, row] }))
      notifyPortfolios()
      return api.portfolios.get(row.id)
    },
    update: (id: string, data: Partial<Portfolio>): Promise<Portfolio> => {
      const t = nowIso()
      updateWealthDocument((d) => ({
        ...d,
        portfolios: d.portfolios.map((p) => (p.id === id ? { ...p, ...data, updatedAt: t } : p)),
      }))
      notifyPortfolios()
      return api.portfolios.get(id)
    },
    delete: (id: string): Promise<void> => {
      updateWealthDocument((d) => {
        const groupIds = d.assetGroups.filter((g) => g.portfolioId === id).map((g) => g.id)
        const assetIds = d.assets.filter((a) => a.assetGroupId && groupIds.includes(a.assetGroupId)).map((a) => a.id)
        const propertyIds = d.properties.filter((p) => groupIds.includes(p.assetGroupId)).map((p) => p.id)
        return {
          ...d,
          portfolios: d.portfolios.filter((p) => p.id !== id),
          assetGroups: d.assetGroups.filter((g) => g.portfolioId !== id),
          assets: d.assets.filter((a) => !a.assetGroupId || !groupIds.includes(a.assetGroupId)),
          liabilities: d.liabilities.filter((l) => !l.assetGroupId || !groupIds.includes(l.assetGroupId)),
          properties: d.properties.filter((p) => !groupIds.includes(p.assetGroupId)),
          propertyValuations: d.propertyValuations.filter((v) => !propertyIds.includes(v.propertyId)),
          propertyMortgages: d.propertyMortgages.filter((m) => !propertyIds.includes(m.propertyId)),
          propertyExpenses: d.propertyExpenses.filter((e) => !propertyIds.includes(e.propertyId)),
          propertyRentPeriods: d.propertyRentPeriods.filter((r) => !propertyIds.includes(r.propertyId)),
          assetValuations: d.assetValuations.filter((v) => !assetIds.includes(v.assetId)),
          securityTransactions: d.securityTransactions.filter((t) => !groupIds.includes(t.assetGroupId)),
          securityValuations: d.securityValuations.filter((v) => !assetIds.includes(v.assetId)),
        }
      })
      notifyPortfolios()
      return Promise.resolve()
    },
  },

  assetGroups: {
    list: (portfolioId?: string): Promise<AssetGroup[]> => {
      const d = getWealthDocument()
      let rows = d.assetGroups
      if (portfolioId) rows = rows.filter((g) => g.portfolioId === portfolioId)
      return Promise.resolve(
        rows.map((g) => {
          const pf = d.portfolios.find((p) => p.id === g.portfolioId)
          return { ...g, portfolio: pf ? { id: pf.id, name: pf.name } : undefined } as AssetGroup
        }),
      )
    },
    get: (id: string): Promise<AssetGroup> => {
      const d = getWealthDocument()
      const g = d.assetGroups.find((x) => x.id === id)
      if (!g) return rej(404, 'Not found')
      const pf = d.portfolios.find((p) => p.id === g.portfolioId)
      return Promise.resolve({ ...g, portfolio: pf ? { id: pf.id, name: pf.name } : undefined } as AssetGroup)
    },
    create: (data: Partial<AssetGroup> & { portfolioId: string; name: string }): Promise<AssetGroup> => {
      const d0 = getWealthDocument()
      if (!d0.portfolios.some((p) => p.id === data.portfolioId)) return rej(404, 'Portfolio not found')
      const { createdAt, updatedAt } = newEntityTimestamps()
      const row = {
        id: randomId(),
        portfolioId: data.portfolioId,
        name: data.name,
        description: data.description ?? null,
        color: data.color ?? null,
        icon: null,
        kind: data.kind ?? 'general',
        createdAt,
        updatedAt,
      }
      updateWealthDocument((d) => ({ ...d, assetGroups: [...d.assetGroups, row] }))
      notifyPortfolios()
      return api.assetGroups.get(row.id)
    },
    update: (id: string, data: Partial<AssetGroup>): Promise<AssetGroup> => {
      const t = nowIso()
      updateWealthDocument((d) => ({
        ...d,
        assetGroups: d.assetGroups.map((g) => (g.id === id ? { ...g, ...data, icon: null, updatedAt: t } : g)),
      }))
      notifyPortfolios()
      return api.assetGroups.get(id)
    },
    delete: (id: string): Promise<void> => {
      updateWealthDocument((d) => {
        const assetIds = d.assets.filter((a) => a.assetGroupId === id).map((a) => a.id)
        const propertyIds = d.properties.filter((p) => p.assetGroupId === id).map((p) => p.id)
        return {
          ...d,
          assetGroups: d.assetGroups.filter((g) => g.id !== id),
          assets: d.assets.filter((a) => a.assetGroupId !== id),
          liabilities: d.liabilities.filter((l) => l.assetGroupId !== id),
          properties: d.properties.filter((p) => p.assetGroupId !== id),
          propertyValuations: d.propertyValuations.filter((v) => !propertyIds.includes(v.propertyId)),
          propertyMortgages: d.propertyMortgages.filter((m) => !propertyIds.includes(m.propertyId)),
          propertyExpenses: d.propertyExpenses.filter((e) => !propertyIds.includes(e.propertyId)),
          propertyRentPeriods: d.propertyRentPeriods.filter((r) => !propertyIds.includes(r.propertyId)),
          assetValuations: d.assetValuations.filter((v) => !assetIds.includes(v.assetId)),
          securityTransactions: d.securityTransactions.filter((t) => t.assetGroupId !== id),
          securityValuations: d.securityValuations.filter((v) => !assetIds.includes(v.assetId)),
        }
      })
      notifyPortfolios()
      return Promise.resolve()
    },
    history: (id: string): Promise<AssetGroupHistory> => {
      const d = getWealthDocument()
      const group = d.assetGroups.find((g) => g.id === id)
      if (!group) return rej(404, 'Not found')
      const infMap = infoByIsin(d)
      const displayCurrency = d.settings.baseCurrency ?? 'EUR'
      const fxOpts = { fxRates: d.fxRates, displayCurrency }
      let items: GroupHistoryItem[] = []
      if (group.kind === 'general') {
        const assets = d.assets.filter((a) => a.assetGroupId === id && !a.archivedAt)
        items = computeGroupHistory(
          {
            generalAssets: assets.map((a) => ({
              id: a.id,
              name: a.name,
              estimatedValue: a.estimatedValue,
              currency: a.currency,
              assetValuations: d.assetValuations
                .filter((v) => v.assetId === a.id)
                .map((v) => ({ date: new Date(v.date), value: v.value, currency: v.currency })),
            })),
          },
          fxOpts,
        )
      } else if (group.kind === 'investments') {
        const assets = d.assets.filter((a) => a.assetGroupId === id && a.category === 'securities' && !a.archivedAt)
        items = computeGroupHistory(
          {
            securitiesAssets: assets.map((a) => {
              const k = a.isin?.trim().toUpperCase()
              const info = k ? infMap.get(k) : undefined
              return {
                id: a.id,
                name: securitiesHistoryDisplayName({ name: a.name, isin: a.isin }, info),
                securityTransactions: d.securityTransactions
                  .filter((t) => t.assetId === a.id)
                  .map((t) => ({
                    date: new Date(t.date),
                    createdAt: new Date(t.createdAt),
                    kind: t.kind,
                    quantity: t.quantity,
                  })),
                securityValuations: d.securityValuations
                  .filter((v) => v.assetId === a.id)
                  .map((v) => ({ date: new Date(v.date), sharePrice: v.sharePrice, currency: v.currency })),
              }
            }),
          },
          fxOpts,
        )
      } else if (group.kind === 'real_estate') {
        const properties = d.properties.filter((p) => p.assetGroupId === id)
        items = computeGroupHistory(
          {
            realEstateProperties: properties.map((p) => ({
              id: p.id,
              name: p.name,
              valuations: d.propertyValuations
                .filter((v) => v.propertyId === p.id)
                .map((v) => ({ date: new Date(v.date), value: v.value, currency: v.currency })),
              mortgages: d.propertyMortgages
                .filter((m) => m.propertyId === p.id)
                .map((m) => ({
                  date: new Date(m.date),
                  outstandingBalance: m.outstandingBalance,
                  currency: m.currency,
                })),
            })),
          },
          fxOpts,
        )
      }
      return Promise.resolve({ displayCurrency, items })
    },
  },

  assets: {
    list: (assetGroupId?: string, includeArchived?: boolean): Promise<Asset[]> => {
      const d = getWealthDocument()
      let rows = d.assets
      if (assetGroupId) rows = rows.filter((a) => a.assetGroupId === assetGroupId)
      if (!includeArchived) rows = rows.filter((a) => !a.archivedAt)
      return Promise.resolve(rows.map((a) => enrichAsset(d, a)))
    },
    get: (id: string): Promise<Asset> => {
      const d = getWealthDocument()
      const a = d.assets.find((x) => x.id === id)
      if (!a) return rej(404, 'Not found')
      const ag = a.assetGroupId ? d.assetGroups.find((g) => g.id === a.assetGroupId) : undefined
      return Promise.resolve({
        ...enrichAsset(d, a),
        assetGroup: ag ? { id: ag.id, name: ag.name } : null,
      } as Asset)
    },
    create: (data: Partial<Asset>): Promise<Asset> => {
      const { createdAt, updatedAt } = newEntityTimestamps()
      const gid = data.assetGroupId ?? (data as { groupId?: string }).groupId ?? null
      const row = {
        id: randomId(),
        name: data.name?.trim() || 'Asset',
        category: data.category ?? 'other',
        estimatedValue: data.estimatedValue ?? 0,
        currency: data.currency ?? 'EUR',
        isin: data.isin ?? null,
        position: data.position ?? null,
        sharePrice: data.sharePrice ?? null,
        assetGroupId: gid,
        note: data.note ?? null,
        archivedAt: null,
        createdAt,
        updatedAt,
      }
      updateWealthDocument((d) => ({ ...d, assets: [...d.assets, row] }))
      notifyPortfolios()
      return api.assets.get(row.id)
    },
    update: (id: string, data: Partial<Asset>): Promise<Asset> => {
      const t = nowIso()
      updateWealthDocument((d) => {
        let next: WealthDocument = {
          ...d,
          assets: d.assets.map((a) => (a.id === id ? { ...a, ...data, updatedAt: t } : a)),
        }
        if (next.assets.find((a) => a.id === id)?.category === 'securities') {
          next = syncSecuritiesHolding(next, id)
        }
        return next
      })
      notifyPortfolios()
      return api.assets.get(id)
    },
    delete: (id: string): Promise<void> => {
      const d0 = getWealthDocument()
      const existing = d0.assets.find((a) => a.id === id)
      const isin = existing?.isin?.trim().toUpperCase() ?? ''
      updateWealthDocument((d) => {
        let next: WealthDocument = {
          ...d,
          assets: d.assets.filter((a) => a.id !== id),
          assetValuations: d.assetValuations.filter((v) => v.assetId !== id),
          securityTransactions: d.securityTransactions.filter((t) => t.assetId !== id),
          securityValuations: d.securityValuations.filter((v) => v.assetId !== id),
        }
        if (isin) next = syncSecuritiesHoldingsByIsin(next, isin)
        return next
      })
      notifyPortfolios()
      return Promise.resolve()
    },
    archive: (id: string): Promise<Asset> => {
      const t = nowIso()
      updateWealthDocument((d) => ({
        ...d,
        assets: d.assets.map((a) => (a.id === id ? { ...a, archivedAt: t, updatedAt: t } : a)),
      }))
      notifyPortfolios()
      return api.assets.get(id)
    },
    unarchive: (id: string): Promise<Asset> => {
      const t = nowIso()
      updateWealthDocument((d) => ({
        ...d,
        assets: d.assets.map((a) => (a.id === id ? { ...a, archivedAt: null, updatedAt: t } : a)),
      }))
      notifyPortfolios()
      return api.assets.get(id)
    },
    listValuations: (assetId: string): Promise<AssetValuation[]> => {
      const d = getWealthDocument()
      return Promise.resolve(
        d.assetValuations
          .filter((v) => v.assetId === assetId)
          .map((v) => {
            const asset = d.assets.find((a) => a.id === assetId)
            return { ...v, asset: asset ? { id: asset.id, name: asset.name } : undefined } as AssetValuation
          }),
      )
    },
    createValuation: (assetId: string, data: { date: string; value: number; currency?: string }): Promise<AssetValuation> => {
      const d0 = getWealthDocument()
      const asset = d0.assets.find((a) => a.id === assetId)
      if (!asset?.assetGroupId) return rej(400, 'Asset has no asset group')
      const g = d0.assetGroups.find((x) => x.id === asset.assetGroupId)
      if (!g || g.kind !== 'general') return rej(400, 'Valuations for this asset are only available in general asset groups')
      if (asset.category === 'securities') return rej(400, 'Use security valuations and trades for securities holdings')
      const { createdAt, updatedAt } = newEntityTimestamps()
      const row = {
        id: randomId(),
        assetId,
        date: data.date,
        value: data.value,
        currency: data.currency ?? 'EUR',
        createdAt,
        updatedAt,
      }
      updateWealthDocument((d) => {
        let next: WealthDocument = { ...d, assetValuations: [...d.assetValuations, row] }
        next = syncGeneralAssetEstimatedFromValuations(next, assetId)
        return next
      })
      notifyPortfolios()
      const d = getWealthDocument()
      const v = d.assetValuations.find((x) => x.id === row.id)!
      return Promise.resolve({ ...v } as AssetValuation)
    },
    updateValuation: (
      assetId: string,
      valuationId: string,
      data: Partial<{ date: string; value: number; currency: string }>,
    ): Promise<AssetValuation> => {
      const t = nowIso()
      updateWealthDocument((d) => {
        let next: WealthDocument = {
          ...d,
          assetValuations: d.assetValuations.map((v) =>
            v.id === valuationId && v.assetId === assetId ? { ...v, ...data, updatedAt: t } : v,
          ),
        }
        next = syncGeneralAssetEstimatedFromValuations(next, assetId)
        return next
      })
      notifyPortfolios()
      const d = getWealthDocument()
      const v = d.assetValuations.find((x) => x.id === valuationId)
      if (!v) return rej(404, 'Not found')
      return Promise.resolve({ ...v } as AssetValuation)
    },
    deleteValuation: (assetId: string, valuationId: string): Promise<void> => {
      updateWealthDocument((d) => {
        let next: WealthDocument = {
          ...d,
          assetValuations: d.assetValuations.filter((v) => !(v.id === valuationId && v.assetId === assetId)),
        }
        next = syncGeneralAssetEstimatedFromValuations(next, assetId)
        return next
      })
      notifyPortfolios()
      return Promise.resolve()
    },
  },

  securityTransactions: {
    list: (assetGroupId: string): Promise<SecurityTransaction[]> => {
      const d = getWealthDocument()
      const g = d.assetGroups.find((x) => x.id === assetGroupId)
      if (!g) return rej(404, 'Asset group not found')
      if (g.kind !== 'investments') return rej(400, 'Security transactions are only for securities asset groups')
      const rows = d.securityTransactions
        .filter((t) => t.assetGroupId === assetGroupId)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      return Promise.resolve(rows.map((t) => serializeSecurityTransaction(d, t)))
    },
    create: (data: SecurityTransactionInput): Promise<SecurityTransaction> => {
      const d0 = getWealthDocument()
      const g = d0.assetGroups.find((x) => x.id === data.assetGroupId)
      const asset = d0.assets.find((a) => a.id === data.assetId)
      if (!g) return rej(404, 'Asset group not found')
      if (g.kind !== 'investments') return rej(400, 'Security transactions are only for securities asset groups')
      if (!asset || asset.assetGroupId !== data.assetGroupId) return rej(404, 'Holding not found')
      if (asset.category !== 'securities') return rej(400, 'Transactions apply to securities holdings only')
      const v = validateLedgerWithChange(d0, data.assetId, {
        date: typeof data.date === 'string' ? data.date : new Date(data.date as unknown as string).toISOString(),
        kind: data.kind,
        quantity: data.quantity,
      })
      if (!v.ok) return rej(400, v.message)
      const { createdAt, updatedAt } = newEntityTimestamps()
      const row = {
        id: randomId(),
        assetGroupId: data.assetGroupId,
        assetId: data.assetId,
        date: typeof data.date === 'string' ? data.date : new Date(data.date as unknown as string).toISOString(),
        kind: data.kind,
        quantity: data.quantity,
        pricePerShare: data.pricePerShare,
        note: data.note ?? null,
        createdAt,
        updatedAt,
      }
      updateWealthDocument((d) => {
        let next: WealthDocument = { ...d, securityTransactions: [...d.securityTransactions, row] }
        next = syncSecuritiesHolding(next, data.assetId)
        return next
      })
      notifyPortfolios()
      const d = getWealthDocument()
      return Promise.resolve(serializeSecurityTransaction(d, row))
    },
    update: (id: string, data: Partial<Omit<SecurityTransactionInput, 'assetGroupId'>>): Promise<SecurityTransaction> => {
      const d0 = getWealthDocument()
      const existing = d0.securityTransactions.find((t) => t.id === id)
      if (!existing) return rej(404, 'Not found')
      const g = d0.assetGroups.find((x) => x.id === existing.assetGroupId)
      if (!g || g.kind !== 'investments') return rej(400, 'Invalid asset group')
      const nextAssetId = data.assetId ?? existing.assetId
      const merged = {
        date: data.date ?? existing.date,
        kind: data.kind ?? existing.kind,
        quantity: data.quantity ?? existing.quantity,
      }
      const v = validateLedgerWithChange(d0, nextAssetId, {
        date: typeof merged.date === 'string' ? merged.date : new Date(merged.date as unknown as string).toISOString(),
        kind: merged.kind as 'purchase' | 'sale',
        quantity: merged.quantity,
        excludeTransactionId: existing.id,
      })
      if (!v.ok) return rej(400, v.message)
      const t = nowIso()
      updateWealthDocument((d) => {
        let next: WealthDocument = {
          ...d,
          securityTransactions: d.securityTransactions.map((x) =>
            x.id === id
              ? {
                  ...x,
                  ...(data.date !== undefined ? { date: typeof data.date === 'string' ? data.date : new Date(data.date as unknown as string).toISOString() } : {}),
                  ...(data.kind !== undefined ? { kind: data.kind } : {}),
                  ...(data.quantity !== undefined ? { quantity: data.quantity } : {}),
                  ...(data.pricePerShare !== undefined ? { pricePerShare: data.pricePerShare } : {}),
                  ...(data.note !== undefined ? { note: data.note } : {}),
                  ...(data.assetId !== undefined ? { assetId: data.assetId } : {}),
                  updatedAt: t,
                }
              : x,
          ),
        }
        next = syncSecuritiesHolding(next, existing.assetId)
        if (data.assetId && data.assetId !== existing.assetId) next = syncSecuritiesHolding(next, data.assetId)
        return next
      })
      notifyPortfolios()
      const d = getWealthDocument()
      const row = d.securityTransactions.find((x) => x.id === id)!
      return Promise.resolve(serializeSecurityTransaction(d, row))
    },
    delete: (id: string): Promise<void> => {
      const d0 = getWealthDocument()
      const existing = d0.securityTransactions.find((t) => t.id === id)
      if (!existing) return rej(404, 'Not found')
      const g = d0.assetGroups.find((x) => x.id === existing.assetGroupId)
      if (!g || g.kind !== 'investments') return rej(400, 'Invalid asset group')
      const assetId = existing.assetId
      updateWealthDocument((d) => {
        let next: WealthDocument = { ...d, securityTransactions: d.securityTransactions.filter((t) => t.id !== id) }
        next = syncSecuritiesHolding(next, assetId)
        return next
      })
      notifyPortfolios()
      return Promise.resolve()
    },
  },

  securityValuations: {
    list: (assetGroupId?: string): Promise<SecurityValuation[]> => {
      const d = getWealthDocument()
      let assetIds: string[] = []
      if (assetGroupId) {
        const g = d.assetGroups.find((x) => x.id === assetGroupId)
        if (!g) return rej(404, 'Asset group not found')
        if (g.kind !== 'investments') return rej(400, 'Valuations are only for securities asset groups')
        assetIds = d.assets.filter((a) => a.assetGroupId === assetGroupId && a.category === 'securities').map((a) => a.id)
      } else {
        const gids = d.assetGroups.filter((x) => x.kind === 'investments').map((x) => x.id)
        if (!gids.length) return Promise.resolve([])
        assetIds = d.assets.filter((a) => a.assetGroupId && gids.includes(a.assetGroupId) && a.category === 'securities').map((a) => a.id)
      }
      if (!assetIds.length) return Promise.resolve([])
      const rows = d.securityValuations.filter((v) => assetIds.includes(v.assetId))
      return Promise.resolve(rows.map((r) => serializeSecurityValuation(d, r)))
    },
    create: (data: SecurityValuationInput, assetGroupId?: string): Promise<SecurityValuation> => {
      const d0 = getWealthDocument()
      let gid = assetGroupId
      const asset = d0.assets.find((a) => a.id === data.assetId)
      if (!gid) {
        if (!asset?.assetGroupId) return rej(404, 'Holding not found')
        const ag = d0.assetGroups.find((g) => g.id === asset.assetGroupId)
        if (!ag || ag.kind !== 'investments' || asset.category !== 'securities') {
          return rej(400, 'Valuations apply to securities in an investments asset group only.')
        }
        gid = asset.assetGroupId
      }
      const g = d0.assetGroups.find((x) => x.id === gid)
      if (!g || !asset) return rej(404, 'Not found')
      if (g.kind !== 'investments' || asset.category !== 'securities' || asset.assetGroupId !== gid) {
        return rej(400, 'Invalid holding')
      }
      if (!asset.isin?.trim()) return rej(400, 'Holding must have an ISIN; stock marks are keyed by ISIN.')
      const isin = asset.isin.trim().toUpperCase()
      const dateKey = (typeof data.date === 'string' ? data.date : new Date(data.date as unknown as string).toISOString()).slice(0, 10)
      const currency = (data.currency ?? asset.currency ?? 'USD').trim().toUpperCase()
      const { createdAt, updatedAt } = newEntityTimestamps()
      const id = securityValuationIdForAsset(isin, dateKey, data.assetId)
      const row = {
        id,
        assetId: data.assetId,
        isin,
        date: `${dateKey}T12:00:00.000Z`,
        sharePrice: data.sharePrice,
        currency,
        note: data.note ?? null,
        createdAt,
        updatedAt,
      }
      updateWealthDocument((d) => {
        const others = d.securityValuations.filter((v) => v.id !== id)
        const si = d.securityInfo.filter((x) => x.isin !== isin)
        const now = nowIso()
        const infoRow = {
          isin,
          ticker: asset.name,
          name: asset.name,
          currency,
          updatedAt: now,
        }
        let next: WealthDocument = {
          ...d,
          securityValuations: [...others, row],
          securityInfo: [...si, infoRow],
        }
        next = syncSecuritiesHoldingsByIsin(next, isin)
        return next
      })
      notifyPortfolios()
      const d = getWealthDocument()
      return Promise.resolve(serializeSecurityValuation(d, row))
    },
    update: (id: string, data: Partial<SecurityValuationInput>): Promise<SecurityValuation> => {
      const d0 = getWealthDocument()
      const existing = findSecurityValuation(d0, id)
      if (!existing) return rej(404, 'Not found')
      const assetBefore = d0.assets.find((a) => a.id === existing.assetId)
      const assetGroupId = assetBefore?.assetGroupId
      if (!assetGroupId) return rej(400, 'Holding has no asset group')
      const g = d0.assetGroups.find((x) => x.id === assetGroupId)
      if (!g || g.kind !== 'investments') return rej(400, 'Invalid asset group')
      const nextAssetId = data.assetId ?? existing.assetId
      const asset = d0.assets.find((a) => a.id === nextAssetId)
      if (!asset || asset.category !== 'securities' || asset.assetGroupId !== assetGroupId) return rej(400, 'Invalid holding')
      if (!asset.isin?.trim()) return rej(400, 'Holding must have an ISIN; stock marks are keyed by ISIN.')
      const oldIsin = existing.isin ?? d0.assets.find((a) => a.id === existing.assetId)?.isin?.trim().toUpperCase() ?? ''
      const mergedDate = data.date ?? existing.date
      const dateKey = mergedDate.slice(0, 10)
      const nextIsin = asset.isin.trim().toUpperCase()
      const newId = securityValuationIdForAsset(nextIsin, dateKey, nextAssetId)
      const t = nowIso()
      updateWealthDocument((d) => {
        const rest = d.securityValuations.filter((v) => v.id !== existing.id)
        const row = {
          id: newId,
          assetId: nextAssetId,
          isin: nextIsin,
          date: `${dateKey}T12:00:00.000Z`,
          sharePrice: data.sharePrice ?? existing.sharePrice,
          currency: (data.currency ?? existing.currency).trim().toUpperCase(),
          note: data.note !== undefined ? data.note : existing.note,
          createdAt: existing.createdAt,
          updatedAt: t,
        }
        const si = d.securityInfo.filter((x) => x.isin !== nextIsin)
        const infoRow = {
          isin: nextIsin,
          ticker: asset.name,
          name: asset.name,
          currency: row.currency,
          updatedAt: t,
        }
        let next: WealthDocument = {
          ...d,
          securityValuations: [...rest, row],
          securityInfo: [...si, infoRow],
        }
        next = syncSecuritiesHoldingsByIsin(next, oldIsin)
        if (nextIsin !== oldIsin) next = syncSecuritiesHoldingsByIsin(next, nextIsin)
        return next
      })
      notifyPortfolios()
      const d = getWealthDocument()
      const updated = findSecurityValuation(d, newId)
      if (!updated) return rej(404, 'Not found')
      return Promise.resolve(serializeSecurityValuation(d, updated))
    },
    delete: (id: string): Promise<void> => {
      const d0 = getWealthDocument()
      const existing = findSecurityValuation(d0, id)
      if (!existing) return rej(404, 'Not found')
      const isin = existing.isin ?? d0.assets.find((a) => a.id === existing.assetId)?.isin?.trim().toUpperCase() ?? ''
      updateWealthDocument((d) => {
        let next: WealthDocument = { ...d, securityValuations: d.securityValuations.filter((v) => v.id !== existing.id) }
        next = syncSecuritiesHoldingsByIsin(next, isin)
        return next
      })
      notifyPortfolios()
      return Promise.resolve()
    },
    /** Import JSON array or `{ "securityValuations": [...] }`. `mode`: replace all marks, or add/update by key. */
    importJson: (text: string, mode: JsonImportMode): Promise<{ importedRowCount: number; totalRows: number }> => {
      let parsed: unknown
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        return rej(400, 'Invalid JSON.')
      }
      const arr = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { securityValuations?: unknown }).securityValuations)
          ? (parsed as { securityValuations: unknown[] }).securityValuations
          : null
      if (!Array.isArray(arr)) {
        return rej(400, 'Expected a JSON array of valuation rows or an object with a "securityValuations" array.')
      }
      const d0 = getWealthDocument()
      const ts = newEntityTimestamps()
      const coerced: SecurityValuationRecord[] = []
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue
        const o = item as Record<string, unknown>
        const assetId = typeof o.assetId === 'string' ? o.assetId.trim() : ''
        if (!assetId) continue
        const asset = d0.assets.find((a) => a.id === assetId)
        if (!asset || asset.category !== 'securities') continue
        const ag = asset.assetGroupId ? d0.assetGroups.find((g) => g.id === asset.assetGroupId) : undefined
        if (!ag || ag.kind !== 'investments') continue
        const isinFromAsset = asset.isin?.trim().toUpperCase() ?? ''
        const isinFromRow = typeof o.isin === 'string' ? o.isin.trim().toUpperCase() : ''
        const isin = isinFromRow || isinFromAsset
        if (!isin) continue
        if (isinFromRow && isinFromAsset && isinFromRow !== isinFromAsset) continue
        const dateSrc = o.date
        const dateStr =
          typeof dateSrc === 'string'
            ? dateSrc.includes('T')
              ? dateSrc
              : `${dateSrc.slice(0, 10)}T12:00:00.000Z`
            : ''
        if (!dateStr) continue
        let dateKey: string
        try {
          dateKey = new Date(dateStr).toISOString().slice(0, 10)
        } catch {
          continue
        }
        const spRaw = o.sharePrice
        const sharePrice = typeof spRaw === 'number' ? spRaw : Number(spRaw)
        if (Number.isNaN(sharePrice) || sharePrice < 0) continue
        const currency =
          (typeof o.currency === 'string' && o.currency.trim()
            ? o.currency.trim().toUpperCase()
            : asset.currency?.trim().toUpperCase()) || 'USD'
        const note =
          o.note === undefined ? null : o.note === null ? null : typeof o.note === 'string' ? o.note : null
        const id = securityValuationIdForAsset(isin, dateKey, assetId)
        const existing = d0.securityValuations.find((v) => v.id === id)
        const createdAt =
          typeof o.createdAt === 'string' && o.createdAt.trim() ? o.createdAt : existing?.createdAt ?? ts.createdAt
        const updatedAt = typeof o.updatedAt === 'string' && o.updatedAt.trim() ? o.updatedAt : ts.updatedAt
        coerced.push({
          id,
          assetId,
          isin,
          date: `${dateKey}T12:00:00.000Z`,
          sharePrice,
          currency,
          note,
          createdAt,
          updatedAt,
        })
      }
      const lastById = new Map<string, SecurityValuationRecord>()
      for (const row of coerced) lastById.set(row.id, row)
      const unique = [...lastById.values()]
      if (unique.length === 0 && mode === 'add') {
        return rej(
          400,
          'No valid valuation rows to import. Each row needs assetId (a securities holding), date, sharePrice ≥ 0, and the holding must have an ISIN (or include isin matching the holding).',
        )
      }
      updateWealthDocument((d) => {
        const prevIsins = new Set<string>()
        for (const v of d.securityValuations) {
          const is = (v.isin ?? d.assets.find((a) => a.id === v.assetId)?.isin)?.trim().toUpperCase()
          if (is) prevIsins.add(is)
        }
        let valuations: SecurityValuationRecord[]
        if (mode === 'replace') {
          valuations = unique
        } else {
          const byId = new Set(unique.map((r) => r.id))
          valuations = [...d.securityValuations.filter((v) => !byId.has(v.id)), ...unique]
        }
        let next: WealthDocument = { ...d, securityValuations: valuations }
        let si = [...next.securityInfo]
        for (const row of unique) {
          const asset = d.assets.find((a) => a.id === row.assetId)
          if (!asset) continue
          const inf = {
            isin: row.isin!,
            ticker: asset.name,
            name: asset.name,
            currency: row.currency,
            updatedAt: row.updatedAt,
          }
          si = si.filter((x) => x.isin !== row.isin)
          si.push(inf)
        }
        next = { ...next, securityInfo: si }
        const nextIsins = new Set(unique.map((r) => r.isin).filter(Boolean) as string[])
        for (const isin of new Set([...prevIsins, ...nextIsins])) {
          next = syncSecuritiesHoldingsByIsin(next, isin)
        }
        return next
      })
      notifyPortfolios()
      return Promise.resolve({ importedRowCount: unique.length, totalRows: getWealthDocument().securityValuations.length })
    },
  },

  securityInfo: {
    list: (): Promise<SecurityInfoRecord[]> => {
      const d = getWealthDocument()
      return Promise.resolve(
        [...d.securityInfo].sort((a, b) => a.isin.localeCompare(b.isin, undefined, { sensitivity: 'base' })),
      )
    },
    create: (data: SecurityInfoRecordInput): Promise<SecurityInfoRecord> => {
      const isin = data.isin.trim().toUpperCase()
      const t = nowIso()
      const row: SecurityInfoRecord = {
        isin,
        ticker: data.ticker,
        name: data.name,
        currency: data.currency.trim().toUpperCase(),
        updatedAt: t,
      }
      updateWealthDocument((d) => ({
        ...d,
        securityInfo: [...d.securityInfo.filter((x) => x.isin !== isin), row],
      }))
      notifyPortfolios()
      return Promise.resolve(row)
    },
    update: (isinRaw: string, data: Partial<SecurityInfoRecordInput>): Promise<SecurityInfoRecord> => {
      const isin = isinRaw.trim().toUpperCase()
      const t = nowIso()
      let found = false
      updateWealthDocument((d) => ({
        ...d,
        securityInfo: d.securityInfo.map((r) => {
          if (r.isin !== isin) return r
          found = true
          return {
            ...r,
            ...(data.ticker !== undefined ? { ticker: data.ticker } : {}),
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.currency !== undefined ? { currency: data.currency.trim().toUpperCase() } : {}),
            updatedAt: t,
          }
        }),
      }))
      if (!found) return rej(404, 'Not found')
      const d = getWealthDocument()
      const r = d.securityInfo.find((x) => x.isin === isin)!
      notifyPortfolios()
      return Promise.resolve(r)
    },
    delete: (isinRaw: string): Promise<void> => {
      const isin = isinRaw.trim().toUpperCase()
      updateWealthDocument((d) => ({
        ...d,
        securityInfo: d.securityInfo.filter((x) => x.isin !== isin),
      }))
      notifyPortfolios()
      return Promise.resolve()
    },
    /** Import JSON array or `{ "securityInfo": [...] }`. `mode`: replace entire reference table, or add/update by ISIN. */
    importJson: (text: string, mode: JsonImportMode): Promise<{ importedRowCount: number; totalRows: number }> => {
      let parsed: unknown
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        return rej(400, 'Invalid JSON.')
      }
      const arr = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { securityInfo?: unknown }).securityInfo)
          ? (parsed as { securityInfo: unknown[] }).securityInfo
          : null
      if (!Array.isArray(arr)) {
        return rej(400, 'Expected a JSON array of security info rows or an object with a "securityInfo" array.')
      }
      const ts = newEntityTimestamps()
      const incoming: SecurityInfoRecord[] = []
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue
        const o = item as Record<string, unknown>
        const isin = typeof o.isin === 'string' ? o.isin.trim().toUpperCase() : ''
        const ticker = typeof o.ticker === 'string' ? o.ticker.trim() : ''
        const name = typeof o.name === 'string' ? o.name.trim() : ''
        const currency = typeof o.currency === 'string' ? o.currency.trim().toUpperCase() : ''
        if (!isin || !ticker || !name || !currency) continue
        incoming.push({
          isin,
          ticker,
          name,
          currency,
          updatedAt: typeof o.updatedAt === 'string' && o.updatedAt.trim() ? o.updatedAt : ts.updatedAt,
        })
      }
      if (incoming.length === 0 && mode === 'add') {
        return rej(400, 'No valid rows to import (each needs non-empty isin, ticker, name, currency).')
      }
      updateWealthDocument((d) => ({
        ...d,
        securityInfo:
          mode === 'replace' ? mergeSecurityInfoRecords([], incoming) : mergeSecurityInfoRecords(d.securityInfo, incoming),
      }))
      notifyPortfolios()
      return Promise.resolve({ importedRowCount: incoming.length, totalRows: getWealthDocument().securityInfo.length })
    },
  },

  liabilities: {
    list: (assetGroupId?: string): Promise<Liability[]> => {
      const d = getWealthDocument()
      let rows = d.liabilities
      if (assetGroupId) rows = rows.filter((l) => l.assetGroupId === assetGroupId)
      return Promise.resolve(
        rows.map((l) => {
          const ag = l.assetGroupId ? d.assetGroups.find((g) => g.id === l.assetGroupId) : undefined
          return { ...l, assetGroup: ag ? { id: ag.id, name: ag.name } : null } as Liability
        }),
      )
    },
    get: (id: string): Promise<Liability> => {
      const d = getWealthDocument()
      const l = d.liabilities.find((x) => x.id === id)
      if (!l) return rej(404, 'Not found')
      const ag = l.assetGroupId ? d.assetGroups.find((g) => g.id === l.assetGroupId) : undefined
      return Promise.resolve({ ...l, assetGroup: ag ? { id: ag.id, name: ag.name } : null } as Liability)
    },
    create: (data: Partial<Liability>): Promise<Liability> => {
      const { createdAt, updatedAt } = newEntityTimestamps()
      const row = {
        id: randomId(),
        name: data.name?.trim() || 'Liability',
        category: data.category ?? 'other',
        outstandingBalance: data.outstandingBalance ?? 0,
        currency: data.currency ?? 'EUR',
        assetGroupId: data.assetGroupId ?? null,
        note: data.note ?? null,
        createdAt,
        updatedAt,
      }
      updateWealthDocument((d) => ({ ...d, liabilities: [...d.liabilities, row] }))
      notifyPortfolios()
      return api.liabilities.get(row.id)
    },
    update: (id: string, data: Partial<Liability>): Promise<Liability> => {
      const t = nowIso()
      updateWealthDocument((d) => ({
        ...d,
        liabilities: d.liabilities.map((l) => (l.id === id ? { ...l, ...data, updatedAt: t } : l)),
      }))
      notifyPortfolios()
      return api.liabilities.get(id)
    },
    delete: (id: string): Promise<void> => {
      updateWealthDocument((d) => ({ ...d, liabilities: d.liabilities.filter((l) => l.id !== id) }))
      notifyPortfolios()
      return Promise.resolve()
    },
  },

  dashboard: {
    summary: (): Promise<DashboardSummary> => {
      const d = getWealthDocument()
      const s = computeDashboardSummary(d)
      return Promise.resolve(s as DashboardSummary)
    },
  },

  settings: {
    get: (): Promise<Settings> => {
      return Promise.resolve(getWealthDocument().settings as Settings)
    },
    update: (data: Partial<Settings>): Promise<Settings> => {
      const t = nowIso()
      updateWealthDocument((d) => {
        const merged = { ...d.settings, ...data, updatedAt: t }
        const b = String(merged.baseCurrency ?? d.settings.baseCurrency)
          .trim()
          .toUpperCase()
        const disp =
          typeof merged.displayCurrency === 'string' ? merged.displayCurrency.trim().toUpperCase() : undefined
        if (disp !== undefined && disp === b) {
          const { displayCurrency: _omit, ...rest } = merged
          return { ...d, settings: rest }
        }
        return { ...d, settings: merged }
      })
      return Promise.resolve(getWealthDocument().settings as Settings)
    },
  },

  /** FX rates stored in the document (see Settings / FX page). */
  fxRates: {
    list: () => Promise.resolve([...getWealthDocument().fxRates].sort((a, b) => b.date.localeCompare(a.date))),
    create: (data: { date: string; fromCurrency: string; toCurrency: string; rate: number }) => {
      const fromC = data.fromCurrency.trim().toUpperCase()
      const toC = data.toCurrency.trim().toUpperCase()
      if (!fromC || !toC || fromC === toC) {
        return rej(400, 'From and to currency must differ.')
      }
      const { createdAt, updatedAt } = newEntityTimestamps()
      const row = {
        id: randomId(),
        date: data.date.slice(0, 10),
        fromCurrency: fromC,
        toCurrency: toC,
        rate: data.rate,
        createdAt,
        updatedAt,
      }
      updateWealthDocument((d) => ({ ...d, fxRates: [...d.fxRates, row] }))
      return Promise.resolve(row)
    },
    update: (id: string, data: Partial<{ date: string; fromCurrency: string; toCurrency: string; rate: number }>) => {
      const cur = getWealthDocument().fxRates.find((x) => x.id === id)
      if (!cur) return rej(404, 'Not found')
      const nextFrom = data.fromCurrency !== undefined ? data.fromCurrency.trim().toUpperCase() : cur.fromCurrency
      const nextTo = data.toCurrency !== undefined ? data.toCurrency.trim().toUpperCase() : cur.toCurrency
      if (nextFrom === nextTo) return rej(400, 'From and to currency must differ.')
      const t = nowIso()
      updateWealthDocument((d) => ({
        ...d,
        fxRates: d.fxRates.map((r) =>
          r.id === id
            ? {
                ...r,
                ...(data.date !== undefined ? { date: data.date.slice(0, 10) } : {}),
                ...(data.fromCurrency !== undefined ? { fromCurrency: data.fromCurrency.trim().toUpperCase() } : {}),
                ...(data.toCurrency !== undefined ? { toCurrency: data.toCurrency.trim().toUpperCase() } : {}),
                ...(data.rate !== undefined ? { rate: data.rate } : {}),
                updatedAt: t,
              }
            : r,
        ),
      }))
      const r = getWealthDocument().fxRates.find((x) => x.id === id)!
      return Promise.resolve(r)
    },
    delete: (id: string) => {
      updateWealthDocument((d) => ({ ...d, fxRates: d.fxRates.filter((r) => r.id !== id) }))
      return Promise.resolve()
    },
    /** Import JSON array or `{ "fxRates": [...] }`. `mode`: replace all FX rows, or add/update by id or (date, from, to). */
    importJson: (text: string, mode: JsonImportMode): Promise<{ importedRowCount: number; totalRows: number }> => {
      let parsed: unknown
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        return rej(400, 'Invalid JSON.')
      }
      const arr = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { fxRates?: unknown }).fxRates)
          ? (parsed as { fxRates: unknown[] }).fxRates
          : null
      if (!Array.isArray(arr)) {
        return rej(400, 'Expected a JSON array of FX rows or an object with an "fxRates" array.')
      }
      const ts = newEntityTimestamps()
      const coerced: FxRateRecord[] = []
      for (const item of arr) {
        const row = tryCoerceFxRateImportRow(item, ts)
        if (row) coerced.push(row)
      }
      if (coerced.length === 0 && mode === 'add') {
        return rej(400, 'No valid FX rows to import.')
      }
      updateWealthDocument((d) => ({
        ...d,
        fxRates: mode === 'replace' ? mergeFxRateRecords([], coerced) : mergeFxRateRecords(d.fxRates, coerced),
      }))
      return Promise.resolve({ importedRowCount: coerced.length, totalRows: getWealthDocument().fxRates.length })
    },
  },
}
