/** Same separator as legacy stock DB `encodeMarkId` / migration exporter. */
export const MARK_ID_SEP = '::'

export function encodeMarkId(isin: string, dateKey: string): string {
  return `${isin.trim().toUpperCase()}${MARK_ID_SEP}${dateKey.trim()}`
}

export function decodeMarkId(id: string): { isin: string; dateKey: string } | null {
  const parts = id.split(MARK_ID_SEP)
  if (parts.length !== 2) return null
  const isin = parts[0].trim().toUpperCase()
  const dateKey = parts[1].trim()
  if (!isin || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null
  return { isin, dateKey }
}

/** Accept legacy `ISIN::date::assetId` ids, but canonical ids are now `ISIN::date`. */
export function decodeSecurityValuationId(id: string): { isin: string; dateKey: string; assetId?: string } | null {
  const parts = id.split(MARK_ID_SEP)
  if (parts.length >= 3) {
    const assetId = parts[parts.length - 1]
    const dateKey = parts[parts.length - 2]
    const isin = parts.slice(0, -2).join(MARK_ID_SEP).trim().toUpperCase()
    if (!isin || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null
    return { isin, dateKey, assetId }
  }
  const d = decodeMarkId(id)
  return d ? { ...d } : null
}

/** Deterministic id: one security valuation row per (ISIN, date). */
export function securityValuationIdForAsset(isin: string, dateKey: string, _assetId?: string): string {
  return encodeMarkId(isin, dateKey)
}
