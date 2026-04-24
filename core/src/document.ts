/**
 * Single-file JSON persistence for the static Nonsheet Finance app.
 *
 * FX rows (`fxRates[]`) store explicit **fromCurrency → toCurrency** with **rate** = units of `toCurrency`
 * per **1** `fromCurrency` (so `amountTo = amountFrom * rate`). Legacy documents used `{ currency, rate }`
 * meaning **USD → currency** with the same numeric `rate`; those are normalized on parse.
 * `settings.baseCurrency` is the aggregation / book currency. Optional `settings.displayCurrency` defaults the Dashboard view.
 */

import type { GroupKind } from './index.js'

export const WEALTH_DOCUMENT_SCHEMA_VERSION = 1 as const

export type WealthDocumentMeta = {
  savedAt?: string
  title?: string
}

/** One FX quote: `rate` = units of `toCurrency` per 1 `fromCurrency` at `date`. */
export type FxRateRecord = {
  id: string
  date: string
  fromCurrency: string
  toCurrency: string
  rate: number
  createdAt: string
  updatedAt: string
}

export type PortfolioRecord = {
  id: string
  name: string
  description?: string | null
  color?: string | null
  icon?: string | null
  createdAt: string
  updatedAt: string
}

export type AssetGroupRecord = {
  id: string
  portfolioId: string
  name: string
  description?: string | null
  color?: string | null
  icon?: string | null
  kind: GroupKind | string
  createdAt: string
  updatedAt: string
}

export type AssetRecord = {
  id: string
  assetGroupId?: string | null
  name: string
  category: string
  estimatedValue: number
  currency: string
  isin?: string | null
  position?: number | null
  sharePrice?: number | null
  note?: string | null
  archivedAt?: string | null
  createdAt: string
  updatedAt: string
}

export type LiabilityRecord = {
  id: string
  assetGroupId?: string | null
  name: string
  category: string
  outstandingBalance: number
  currency: string
  note?: string | null
  createdAt: string
  updatedAt: string
}

export type PropertyRecord = {
  id: string
  assetGroupId: string
  name: string
  description?: string | null
  notes?: string | null
  address?: string | null
  monthlyRent?: number | null
  monthlyMortgagePayment?: number | null
  archivedAt?: string | null
  createdAt: string
  updatedAt: string
}

export type PropertyValuationRecord = {
  id: string
  propertyId: string
  date: string
  value: number
  currency: string
  createdAt: string
  updatedAt: string
}

export type PropertyMortgageRecord = {
  id: string
  propertyId: string
  date: string
  outstandingBalance: number
  currency: string
  loanName?: string | null
  createdAt: string
  updatedAt: string
}

export type PropertyExpenseRecord = {
  id: string
  propertyId: string
  date: string
  name: string
  description?: string | null
  amount: number
  createdAt: string
  updatedAt: string
}

/** One rent contract window for a property (calendar inclusive start/end). */
export type PropertyRentPeriodRecord = {
  id: string
  propertyId: string
  startDate: string
  /** When null/omitted, period is open-ended (still active). */
  endDate?: string | null
  rent: number
  hausgeld: number
  tenantNames: string[]
  notes?: string | null
  createdAt: string
  updatedAt: string
}

export type AssetValuationRecord = {
  id: string
  assetId: string
  date: string
  value: number
  currency: string
  createdAt: string
  updatedAt: string
}

export type SecurityTransactionRecord = {
  id: string
  assetGroupId: string
  assetId: string
  date: string
  kind: string
  quantity: number
  pricePerShare: number
  note?: string | null
  createdAt: string
  updatedAt: string
}

export type SecurityInfoRecord = {
  isin: string
  ticker: string
  name: string
  currency: string
  updatedAt: string
}

export type SecurityValuationRecord = {
  id: string
  assetId: string
  isin?: string
  date: string
  sharePrice: number
  currency: string
  note?: string | null
  createdAt: string
  updatedAt: string
}

export type SettingsRecord = {
  id: string
  /** Book / aggregation currency (dashboard totals and history are computed in this currency). */
  baseCurrency: string
  /**
   * Default currency pre-selected on the Dashboard. When omitted or empty, defaults to `baseCurrency`.
   * Dashboard amounts are still aggregated in `baseCurrency`; the UI converts to this code when it differs.
   */
  displayCurrency?: string
  /** Months without updates before general / real-estate items appear in notifications (default 3). */
  staleAssetWarningMonths?: number
  createdAt: string
  updatedAt: string
}

export type WealthDocument = {
  schemaVersion: typeof WEALTH_DOCUMENT_SCHEMA_VERSION
  meta?: WealthDocumentMeta
  settings: SettingsRecord
  portfolios: PortfolioRecord[]
  assetGroups: AssetGroupRecord[]
  assets: AssetRecord[]
  liabilities: LiabilityRecord[]
  properties: PropertyRecord[]
  propertyValuations: PropertyValuationRecord[]
  propertyMortgages: PropertyMortgageRecord[]
  propertyExpenses: PropertyExpenseRecord[]
  propertyRentPeriods: PropertyRentPeriodRecord[]
  assetValuations: AssetValuationRecord[]
  securityTransactions: SecurityTransactionRecord[]
  securityInfo: SecurityInfoRecord[]
  securityValuations: SecurityValuationRecord[]
  fxRates: FxRateRecord[]
}

export class WealthDocumentParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WealthDocumentParseError'
  }
}

function isObj(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

function reqStr(o: Record<string, unknown>, k: string): string {
  const v = o[k]
  if (typeof v !== 'string' || !v.trim()) throw new WealthDocumentParseError(`Missing or invalid string: ${k}`)
  return v
}

function optStr(o: Record<string, unknown>, k: string): string | null | undefined {
  const v = o[k]
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string') throw new WealthDocumentParseError(`Invalid string|null: ${k}`)
  return v
}

function reqNum(o: Record<string, unknown>, k: string): number {
  const v = o[k]
  if (typeof v !== 'number' || Number.isNaN(v)) throw new WealthDocumentParseError(`Missing or invalid number: ${k}`)
  return v
}

function optNum(o: Record<string, unknown>, k: string): number | null | undefined {
  const v = o[k]
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'number' || Number.isNaN(v)) throw new WealthDocumentParseError(`Invalid number|null: ${k}`)
  return v
}

function parseArr<T>(raw: unknown, name: string, item: (x: unknown) => T): T[] {
  if (!Array.isArray(raw)) throw new WealthDocumentParseError(`Expected array: ${name}`)
  return raw.map((x, i) => {
    try {
      return item(x)
    } catch (e) {
      if (e instanceof WealthDocumentParseError) throw new WealthDocumentParseError(`${name}[${i}]: ${e.message}`)
      throw e
    }
  })
}

function clampStaleAssetMonths(n: number): number {
  if (!Number.isFinite(n)) return 3
  return Math.min(120, Math.max(1, Math.round(n)))
}

function parseSettings(o: unknown): SettingsRecord {
  if (!isObj(o)) throw new WealthDocumentParseError('settings must be an object')
  const rawMonths = o.staleAssetWarningMonths
  let staleAssetWarningMonths: number | undefined
  if (typeof rawMonths === 'number' && !Number.isNaN(rawMonths)) {
    staleAssetWarningMonths = clampStaleAssetMonths(rawMonths)
  }
  const baseCurrency = reqStr(o, 'baseCurrency').trim().toUpperCase()
  const rawDisplay = optStr(o, 'displayCurrency')
  let displayCurrency: string | undefined
  if (rawDisplay != null && rawDisplay.trim()) {
    const d = rawDisplay.trim().toUpperCase()
    if (d.length >= 3) displayCurrency = d.slice(0, 3)
  }
  return {
    id: reqStr(o, 'id'),
    baseCurrency,
    ...(displayCurrency !== undefined ? { displayCurrency } : {}),
    ...(staleAssetWarningMonths !== undefined ? { staleAssetWarningMonths } : {}),
    createdAt: reqStr(o, 'createdAt'),
    updatedAt: reqStr(o, 'updatedAt'),
  }
}

function parsePortfolio(o: unknown): PortfolioRecord {
  if (!isObj(o)) throw new WealthDocumentParseError('portfolio item')
  return {
    id: reqStr(o, 'id'),
    name: reqStr(o, 'name'),
    description: optStr(o, 'description'),
    color: optStr(o, 'color'),
    icon: optStr(o, 'icon'),
    createdAt: reqStr(o, 'createdAt'),
    updatedAt: reqStr(o, 'updatedAt'),
  }
}

function parseAssetGroup(o: unknown): AssetGroupRecord {
  if (!isObj(o)) throw new WealthDocumentParseError('assetGroup item')
  return {
    id: reqStr(o, 'id'),
    portfolioId: reqStr(o, 'portfolioId'),
    name: reqStr(o, 'name'),
    description: optStr(o, 'description'),
    color: optStr(o, 'color'),
    icon: optStr(o, 'icon'),
    kind: reqStr(o, 'kind'),
    createdAt: reqStr(o, 'createdAt'),
    updatedAt: reqStr(o, 'updatedAt'),
  }
}

function parseAsset(o: unknown): AssetRecord {
  if (!isObj(o)) throw new WealthDocumentParseError('asset item')
  return {
    id: reqStr(o, 'id'),
    assetGroupId: optStr(o, 'assetGroupId') ?? null,
    name: reqStr(o, 'name'),
    category: typeof o.category === 'string' ? o.category : 'other',
    estimatedValue: typeof o.estimatedValue === 'number' ? o.estimatedValue : 0,
    currency: typeof o.currency === 'string' ? o.currency : 'EUR',
    isin: optStr(o, 'isin'),
    position: optNum(o, 'position'),
    sharePrice: optNum(o, 'sharePrice'),
    note: optStr(o, 'note'),
    archivedAt: optStr(o, 'archivedAt'),
    createdAt: reqStr(o, 'createdAt'),
    updatedAt: reqStr(o, 'updatedAt'),
  }
}

function parseLiability(o: unknown): LiabilityRecord {
  if (!isObj(o)) throw new WealthDocumentParseError('liability item')
  return {
    id: reqStr(o, 'id'),
    assetGroupId: optStr(o, 'assetGroupId') ?? null,
    name: reqStr(o, 'name'),
    category: typeof o.category === 'string' ? o.category : 'other',
    outstandingBalance: typeof o.outstandingBalance === 'number' ? o.outstandingBalance : 0,
    currency: typeof o.currency === 'string' ? o.currency : 'EUR',
    note: optStr(o, 'note'),
    createdAt: reqStr(o, 'createdAt'),
    updatedAt: reqStr(o, 'updatedAt'),
  }
}

function parseProperty(o: unknown): PropertyRecord {
  if (!isObj(o)) throw new WealthDocumentParseError('property item')
  return {
    id: reqStr(o, 'id'),
    assetGroupId: reqStr(o, 'assetGroupId'),
    name: reqStr(o, 'name'),
    description: optStr(o, 'description'),
    notes: optStr(o, 'notes'),
    address: optStr(o, 'address'),
    monthlyRent: optNum(o, 'monthlyRent'),
    monthlyMortgagePayment: optNum(o, 'monthlyMortgagePayment'),
    archivedAt: optStr(o, 'archivedAt'),
    createdAt: reqStr(o, 'createdAt'),
    updatedAt: reqStr(o, 'updatedAt'),
  }
}

function parsePropertyValuation(o: unknown): PropertyValuationRecord {
  if (!isObj(o)) throw new WealthDocumentParseError('propertyValuation item')
  return {
    id: reqStr(o, 'id'),
    propertyId: reqStr(o, 'propertyId'),
    date: reqStr(o, 'date'),
    value: reqNum(o, 'value'),
    currency: typeof o.currency === 'string' ? o.currency : 'EUR',
    createdAt: reqStr(o, 'createdAt'),
    updatedAt: reqStr(o, 'updatedAt'),
  }
}

function parsePropertyMortgage(o: unknown): PropertyMortgageRecord {
  if (!isObj(o)) throw new WealthDocumentParseError('propertyMortgage item')
  return {
    id: reqStr(o, 'id'),
    propertyId: reqStr(o, 'propertyId'),
    date: reqStr(o, 'date'),
    outstandingBalance: reqNum(o, 'outstandingBalance'),
    currency: typeof o.currency === 'string' ? o.currency : 'EUR',
    loanName: optStr(o, 'loanName'),
    createdAt: reqStr(o, 'createdAt'),
    updatedAt: reqStr(o, 'updatedAt'),
  }
}

function parsePropertyExpense(o: unknown): PropertyExpenseRecord {
  if (!isObj(o)) throw new WealthDocumentParseError('propertyExpense item')
  return {
    id: reqStr(o, 'id'),
    propertyId: reqStr(o, 'propertyId'),
    date: reqStr(o, 'date'),
    name: reqStr(o, 'name'),
    description: optStr(o, 'description'),
    amount: reqNum(o, 'amount'),
    createdAt: reqStr(o, 'createdAt'),
    updatedAt: reqStr(o, 'updatedAt'),
  }
}

function parseTenantNamesField(o: Record<string, unknown>): string[] {
  const raw = o.tenantNames
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function parsePropertyRentPeriod(o: unknown): PropertyRentPeriodRecord {
  if (!isObj(o)) throw new WealthDocumentParseError('propertyRentPeriod item')
  const endRaw = optStr(o, 'endDate')
  const endDate = endRaw != null && endRaw.trim() !== '' ? endRaw.trim().slice(0, 10) : null
  const startYmd = reqStr(o, 'startDate').slice(0, 10)
  if (endDate != null && endDate < startYmd) {
    throw new WealthDocumentParseError('propertyRentPeriod.endDate must be on or after startDate')
  }
  const hg = o.hausgeld
  const hausgeld =
    typeof hg === 'number' && !Number.isNaN(hg) ? hg : typeof hg === 'string' && hg.trim() ? Number(hg) : 0
  const rent = reqNum(o, 'rent')
  if (rent < 0) throw new WealthDocumentParseError('propertyRentPeriod.rent must be >= 0')
  const h = Number.isFinite(hausgeld) ? hausgeld : 0
  if (h < 0) throw new WealthDocumentParseError('propertyRentPeriod.hausgeld must be >= 0')
  return {
    id: reqStr(o, 'id'),
    propertyId: reqStr(o, 'propertyId'),
    startDate: startYmd,
    endDate,
    rent,
    hausgeld: h,
    tenantNames: parseTenantNamesField(o),
    notes: optStr(o, 'notes'),
    createdAt: reqStr(o, 'createdAt'),
    updatedAt: reqStr(o, 'updatedAt'),
  }
}

function parseAssetValuation(o: unknown): AssetValuationRecord {
  if (!isObj(o)) throw new WealthDocumentParseError('assetValuation item')
  return {
    id: reqStr(o, 'id'),
    assetId: reqStr(o, 'assetId'),
    date: reqStr(o, 'date'),
    value: reqNum(o, 'value'),
    currency: typeof o.currency === 'string' ? o.currency : 'EUR',
    createdAt: reqStr(o, 'createdAt'),
    updatedAt: reqStr(o, 'updatedAt'),
  }
}

function parseSecurityTransaction(o: unknown): SecurityTransactionRecord {
  if (!isObj(o)) throw new WealthDocumentParseError('securityTransaction item')
  return {
    id: reqStr(o, 'id'),
    assetGroupId: reqStr(o, 'assetGroupId'),
    assetId: reqStr(o, 'assetId'),
    date: reqStr(o, 'date'),
    kind: reqStr(o, 'kind'),
    quantity: reqNum(o, 'quantity'),
    pricePerShare: reqNum(o, 'pricePerShare'),
    note: optStr(o, 'note'),
    createdAt: reqStr(o, 'createdAt'),
    updatedAt: reqStr(o, 'updatedAt'),
  }
}

function parseSecurityInfo(o: unknown): SecurityInfoRecord {
  if (!isObj(o)) throw new WealthDocumentParseError('securityInfo item')
  return {
    isin: reqStr(o, 'isin').trim().toUpperCase(),
    ticker: reqStr(o, 'ticker'),
    name: reqStr(o, 'name'),
    currency: reqStr(o, 'currency'),
    updatedAt: reqStr(o, 'updatedAt'),
  }
}

function parseSecurityValuation(o: unknown): SecurityValuationRecord {
  if (!isObj(o)) throw new WealthDocumentParseError('securityValuation item')
  return {
    id: reqStr(o, 'id'),
    assetId: reqStr(o, 'assetId'),
    isin: optStr(o, 'isin') ?? undefined,
    date: reqStr(o, 'date'),
    sharePrice: reqNum(o, 'sharePrice'),
    currency: typeof o.currency === 'string' ? o.currency : 'EUR',
    note: optStr(o, 'note'),
    createdAt: reqStr(o, 'createdAt'),
    updatedAt: reqStr(o, 'updatedAt'),
  }
}

/** Legacy single-leg rows used `currency` = To with implied From = USD. */
const FX_LEGACY_PIVOT = 'USD'

function parseFxPairFields(o: Record<string, unknown>): { from: string; to: string; rate: number } {
  const rate = reqNum(o, 'rate')
  if (rate <= 0) throw new WealthDocumentParseError('fxRate.rate must be positive')
  const fromRaw = typeof o.fromCurrency === 'string' ? o.fromCurrency.trim().toUpperCase() : ''
  const toRaw = typeof o.toCurrency === 'string' ? o.toCurrency.trim().toUpperCase() : ''
  const leg = typeof o.currency === 'string' ? o.currency.trim().toUpperCase() : ''
  if (fromRaw && toRaw) {
    if (fromRaw === toRaw) throw new WealthDocumentParseError('fxRate fromCurrency and toCurrency must differ')
    return { from: fromRaw, to: toRaw, rate }
  }
  if (leg) {
    if (leg === FX_LEGACY_PIVOT) {
      throw new WealthDocumentParseError(
        'Legacy fxRate used "currency" as the To leg with From = USD; currency cannot be USD. Use fromCurrency and toCurrency for USD-inclusive quotes.',
      )
    }
    return { from: FX_LEGACY_PIVOT, to: leg, rate }
  }
  throw new WealthDocumentParseError('fxRate requires fromCurrency+toCurrency, or legacy "currency" (To) with From = USD')
}

function parseFxRate(o: unknown): FxRateRecord {
  if (!isObj(o)) throw new WealthDocumentParseError('fxRate item')
  const { from, to, rate } = parseFxPairFields(o)
  return {
    id: reqStr(o, 'id'),
    date: reqStr(o, 'date').slice(0, 10),
    fromCurrency: from,
    toCurrency: to,
    rate,
    createdAt: reqStr(o, 'createdAt'),
    updatedAt: reqStr(o, 'updatedAt'),
  }
}

function parseMeta(o: unknown): WealthDocumentMeta | undefined {
  if (o === undefined) return undefined
  if (!isObj(o)) throw new WealthDocumentParseError('meta must be an object')
  const out: WealthDocumentMeta = {}
  if (typeof o.savedAt === 'string') out.savedAt = o.savedAt
  if (typeof o.title === 'string') out.title = o.title
  return Object.keys(out).length ? out : undefined
}

export function parseWealthDocument(json: unknown): WealthDocument {
  if (!isObj(json)) throw new WealthDocumentParseError('Root must be an object')
  const sv = json.schemaVersion
  if (sv !== WEALTH_DOCUMENT_SCHEMA_VERSION) {
    throw new WealthDocumentParseError(`Unsupported schemaVersion: ${String(sv)} (expected ${WEALTH_DOCUMENT_SCHEMA_VERSION})`)
  }
  return {
    schemaVersion: WEALTH_DOCUMENT_SCHEMA_VERSION,
    meta: json.meta !== undefined ? parseMeta(json.meta) : undefined,
    settings: parseSettings(json.settings),
    portfolios: parseArr(json.portfolios, 'portfolios', parsePortfolio),
    assetGroups: parseArr(json.assetGroups, 'assetGroups', parseAssetGroup),
    assets: parseArr(json.assets, 'assets', parseAsset),
    liabilities: parseArr(json.liabilities, 'liabilities', parseLiability),
    properties: parseArr(json.properties, 'properties', parseProperty),
    propertyValuations: json.propertyValuations !== undefined
      ? parseArr(json.propertyValuations, 'propertyValuations', parsePropertyValuation)
      : [],
    propertyMortgages: json.propertyMortgages !== undefined
      ? parseArr(json.propertyMortgages, 'propertyMortgages', parsePropertyMortgage)
      : [],
    propertyExpenses: json.propertyExpenses !== undefined
      ? parseArr(json.propertyExpenses, 'propertyExpenses', parsePropertyExpense)
      : [],
    propertyRentPeriods: json.propertyRentPeriods !== undefined
      ? parseArr(json.propertyRentPeriods, 'propertyRentPeriods', parsePropertyRentPeriod)
      : [],
    assetValuations: json.assetValuations !== undefined ? parseArr(json.assetValuations, 'assetValuations', parseAssetValuation) : [],
    securityTransactions: parseArr(json.securityTransactions, 'securityTransactions', parseSecurityTransaction),
    securityInfo: json.securityInfo !== undefined ? parseArr(json.securityInfo, 'securityInfo', parseSecurityInfo) : [],
    securityValuations: json.securityValuations !== undefined
      ? parseArr(json.securityValuations, 'securityValuations', parseSecurityValuation)
      : [],
    fxRates: json.fxRates !== undefined ? parseArr(json.fxRates, 'fxRates', parseFxRate) : [],
  }
}

function isoNow(): string {
  return new Date().toISOString()
}

export function newEntityTimestamps(): { createdAt: string; updatedAt: string } {
  const t = isoNow()
  return { createdAt: t, updatedAt: t }
}

function randomId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Lenient coercion for merge/import (skips invalid rows). Legacy `{ currency, rate }` → USD→currency.
 */
export function tryCoerceFxRateImportRow(
  item: unknown,
  timestamps: { createdAt: string; updatedAt: string },
): FxRateRecord | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const o = item as Record<string, unknown>
  const date = typeof o.date === 'string' ? o.date.slice(0, 10) : ''
  const rateRaw = o.rate
  const rateNum = typeof rateRaw === 'number' ? rateRaw : Number(rateRaw)
  if (!date || Number.isNaN(rateNum) || rateNum <= 0) return null
  let pair: { from: string; to: string; rate: number }
  try {
    pair = parseFxPairFields({ ...o, date, rate: rateNum })
  } catch {
    return null
  }
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : randomId()
  const createdAt = typeof o.createdAt === 'string' && o.createdAt.trim() ? o.createdAt : timestamps.createdAt
  const updatedAt = typeof o.updatedAt === 'string' && o.updatedAt.trim() ? o.updatedAt : timestamps.updatedAt
  return {
    id,
    date,
    fromCurrency: pair.from,
    toCurrency: pair.to,
    rate: pair.rate,
    createdAt,
    updatedAt,
  }
}

/** Parse `fxRates` from a raw JSON array or `{ "fxRates": [...] }` (for imports / merge). */
export function parseFxRatesJsonInput(json: unknown): FxRateRecord[] {
  if (Array.isArray(json)) return parseArr(json, 'fxRates', parseFxRate)
  if (isObj(json) && json.fxRates !== undefined) return parseArr(json.fxRates, 'fxRates', parseFxRate)
  throw new WealthDocumentParseError('Expected an array of FX rate objects or { "fxRates": [...] }')
}

/**
 * Merge imported FX rows into `existing`. Matches by `id`, else by (`date`, `fromCurrency`, `toCurrency`).
 * Normalizes dates to `YYYY-MM-DD` and currency codes to uppercase.
 */
export function mergeFxRateRecords(existing: FxRateRecord[], incoming: FxRateRecord[]): FxRateRecord[] {
  const { updatedAt: now } = newEntityTimestamps()
  const norm = (c: string) => c.trim().toUpperCase()
  const out: FxRateRecord[] = existing.map((r) => ({ ...r }))
  const idToIdx = new Map<string, number>()
  const tripleToIdx = new Map<string, number>()
  const reindex = () => {
    idToIdx.clear()
    tripleToIdx.clear()
    out.forEach((r, i) => {
      idToIdx.set(r.id, i)
      tripleToIdx.set(`${r.date.slice(0, 10)}\t${norm(r.fromCurrency)}\t${norm(r.toCurrency)}`, i)
    })
  }
  reindex()

  for (const raw of incoming) {
    const fromC = norm(raw.fromCurrency)
    const toC = norm(raw.toCurrency)
    if (!fromC || !toC || fromC === toC) continue
    const date = typeof raw.date === 'string' ? raw.date.slice(0, 10) : ''
    const rate = raw.rate
    if (!date || typeof rate !== 'number' || Number.isNaN(rate) || rate <= 0) continue

    let idx: number | undefined
    if (raw.id && idToIdx.has(raw.id)) idx = idToIdx.get(raw.id)
    else idx = tripleToIdx.get(`${date}\t${fromC}\t${toC}`)

    const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : now

    if (idx !== undefined) {
      const prev = out[idx]
      const oldKey = `${prev.date.slice(0, 10)}\t${norm(prev.fromCurrency)}\t${norm(prev.toCurrency)}`
      tripleToIdx.delete(oldKey)
      out[idx] = {
        ...prev,
        id: prev.id,
        date,
        fromCurrency: fromC,
        toCurrency: toC,
        rate,
        updatedAt,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : prev.createdAt,
      }
      tripleToIdx.set(`${date}\t${fromC}\t${toC}`, idx)
      continue
    }

    const id = raw.id && !idToIdx.has(raw.id) ? raw.id : randomId()
    const fresh = newEntityTimestamps()
    const row: FxRateRecord = {
      id,
      date,
      fromCurrency: fromC,
      toCurrency: toC,
      rate,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : fresh.createdAt,
      updatedAt,
    }
    idToIdx.set(id, out.length)
    tripleToIdx.set(`${date}\t${fromC}\t${toC}`, out.length)
    out.push(row)
  }
  return out
}

/**
 * Merge imported security reference rows into `existing`. Matches by `isin` (case-insensitive).
 * Later rows with the same ISIN replace earlier ones in `incoming` and overwrite the stored row.
 */
export function mergeSecurityInfoRecords(existing: SecurityInfoRecord[], incoming: SecurityInfoRecord[]): SecurityInfoRecord[] {
  const { updatedAt: now } = newEntityTimestamps()
  const out: SecurityInfoRecord[] = existing.map((r) => ({ ...r, isin: r.isin.trim().toUpperCase() }))
  const isinToIdx = new Map<string, number>()
  out.forEach((r, i) => isinToIdx.set(r.isin, i))

  for (const raw of incoming) {
    const isin = typeof raw.isin === 'string' ? raw.isin.trim().toUpperCase() : ''
    const ticker = typeof raw.ticker === 'string' ? raw.ticker.trim() : ''
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    const currency = typeof raw.currency === 'string' ? raw.currency.trim().toUpperCase() : ''
    if (!isin || !ticker || !name || !currency) continue
    const updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt : now
    const row: SecurityInfoRecord = { isin, ticker, name, currency, updatedAt }
    const idx = isinToIdx.get(isin)
    if (idx !== undefined) out[idx] = row
    else {
      isinToIdx.set(isin, out.length)
      out.push(row)
    }
  }
  return out
}

/** Empty app state (one settings row, no portfolios). */
export function createEmptyWealthDocument(): WealthDocument {
  const { createdAt, updatedAt } = newEntityTimestamps()
  const sid = `settings-${randomId()}`
  return {
    schemaVersion: WEALTH_DOCUMENT_SCHEMA_VERSION,
    meta: {},
    settings: {
      id: sid,
      baseCurrency: 'EUR',
      staleAssetWarningMonths: 3,
      createdAt,
      updatedAt,
    },
    portfolios: [],
    assetGroups: [],
    assets: [],
    liabilities: [],
    properties: [],
    propertyValuations: [],
    propertyMortgages: [],
    propertyExpenses: [],
    propertyRentPeriods: [],
    assetValuations: [],
    securityTransactions: [],
    securityInfo: [],
    securityValuations: [],
    fxRates: [],
  }
}

/** Serialize for download / save (pretty-printed). */
export function stringifyWealthDocument(doc: WealthDocument, pretty = true): string {
  const out = {
    ...doc,
    meta: { ...doc.meta, savedAt: isoNow() },
  }
  return pretty ? `${JSON.stringify(out, null, 2)}\n` : `${JSON.stringify(out)}\n`
}
