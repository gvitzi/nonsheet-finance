import type { WealthDocument } from '@nonsheet-finance/core'

const KIND_PURCHASE = 'purchase'
const KIND_SALE = 'sale'

export type LedgerChange = {
  date: string
  createdAt?: string
  kind: typeof KIND_PURCHASE | typeof KIND_SALE
  quantity: number
  excludeTransactionId?: string
}

export function validateLedgerWithChange(
  doc: WealthDocument,
  assetId: string,
  change: LedgerChange,
): { ok: true } | { ok: false; message: string } {
  const txs = doc.securityTransactions.filter((t) => t.assetId === assetId)
  const filtered = change.excludeTransactionId ? txs.filter((t) => t.id !== change.excludeTransactionId) : txs

  type Row = { date: string; createdAt: string; kind: string; quantity: number }
  const rows: Row[] = filtered.map((t) => ({
    date: t.date,
    createdAt: t.createdAt,
    kind: t.kind,
    quantity: t.quantity,
  }))
  const createdAt = change.createdAt ?? new Date().toISOString()
  rows.push({
    date: change.date,
    createdAt,
    kind: change.kind,
    quantity: change.quantity,
  })
  rows.sort((a, b) => {
    const d = new Date(a.date).getTime() - new Date(b.date).getTime()
    if (d !== 0) return d
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })

  let position = 0
  for (const t of rows) {
    const q = t.quantity
    if (Number.isNaN(q) || q < 0) return { ok: false, message: 'Invalid quantity.' }
    if (t.kind === KIND_PURCHASE) position += q
    else if (t.kind === KIND_SALE) position -= q
    else return { ok: false, message: 'Invalid transaction kind.' }
    if (position < -1e-9) {
      return { ok: false, message: 'This would sell more shares than were held on that date.' }
    }
  }
  return { ok: true }
}

function computePositionFromLedger(doc: WealthDocument, assetId: string): number {
  const txs = doc.securityTransactions.filter((t) => t.assetId === assetId)
  let position = 0
  for (const t of txs) {
    const q = t.quantity
    if (Number.isNaN(q)) continue
    if (t.kind === KIND_PURCHASE) position += q
    else if (t.kind === KIND_SALE) position -= q
  }
  return position
}

function latestValuationForAsset(doc: WealthDocument, assetId: string) {
  const asset = doc.assets.find((a) => a.id === assetId)
  const isin = asset?.isin?.trim().toUpperCase() ?? ''
  if (!isin) return null
  const rows = doc.securityValuations.filter((v) => v.isin.trim().toUpperCase() === isin)
  if (!rows.length) return null
  return [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] ?? null
}

/** Returns updated assets array (immutable). */
export function syncSecuritiesHolding(doc: WealthDocument, assetId: string): WealthDocument {
  const asset = doc.assets.find((a) => a.id === assetId)
  if (!asset || asset.category !== 'securities') return doc

  const positionRaw = computePositionFromLedger(doc, assetId)
  const position = Math.max(0, positionRaw)
  const latestVal = latestValuationForAsset(doc, assetId)
  const sharePrice = latestVal != null && !Number.isNaN(latestVal.sharePrice) ? latestVal.sharePrice : null
  let estimatedValue = 0
  if (sharePrice != null && position > 0 && !Number.isNaN(sharePrice)) {
    estimatedValue = position * sharePrice
  }

  const now = new Date().toISOString()
  const assets = doc.assets.map((a) =>
    a.id === assetId
      ? {
          ...a,
          position,
          sharePrice,
          estimatedValue,
          updatedAt: now,
        }
      : a,
  )
  return { ...doc, assets }
}

export function syncSecuritiesHoldingsByIsin(doc: WealthDocument, isin: string): WealthDocument {
  const n = isin.trim().toUpperCase()
  if (!n) return doc
  let next = doc
  for (const a of doc.assets) {
    if (a.category === 'securities' && a.isin?.trim().toUpperCase() === n) {
      next = syncSecuritiesHolding(next, a.id)
    }
  }
  return next
}

function latestAssetValuation(doc: WealthDocument, assetId: string) {
  const rows = doc.assetValuations.filter((v) => v.assetId === assetId)
  if (!rows.length) return null
  return [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] ?? null
}

export function syncGeneralAssetEstimatedFromValuations(doc: WealthDocument, assetId: string): WealthDocument {
  const asset = doc.assets.find((a) => a.id === assetId)
  if (!asset) return doc
  const latest = latestAssetValuation(doc, assetId)
  const now = new Date().toISOString()
  const assets = doc.assets.map((a) => {
    if (a.id !== assetId) return a
    if (!latest) return { ...a, estimatedValue: 0, updatedAt: now }
    return {
      ...a,
      estimatedValue: latest.value,
      currency: latest.currency,
      updatedAt: now,
    }
  })
  return { ...doc, assets }
}
