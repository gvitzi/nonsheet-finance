/** Pie / line charts and legends: prefer reference issuer name, then ticker, then a non-ISIN holding name, then ISIN. */
export function chartLabelForSecurityHolding(src: {
  name: string
  isin?: string | null
  ticker?: string | null
  securityName?: string | null
}): string {
  const sn = src.securityName?.trim()
  if (sn) return sn
  const tk = src.ticker?.trim()
  if (tk) return tk
  const n = src.name?.trim() ?? ''
  const isinKey = src.isin?.trim().toUpperCase() ?? ''
  if (n && (!isinKey || n.toUpperCase() !== isinKey)) return n
  return isinKey || n || '—'
}

/** Primary line for securities tables (holdings, stock valuations): issuer / name, not the trading symbol. */
export function securityTablePrimaryName(src: {
  name: string
  isin?: string | null
  ticker?: string | null
  securityName?: string | null
}): string {
  const sn = src.securityName?.trim()
  if (sn) return sn
  const n = src.name?.trim() ?? ''
  const isinKey = src.isin?.trim().toUpperCase() ?? ''
  if (n && (!isinKey || n.toUpperCase() !== isinKey)) return n
  const sym = displayTickerInTable(src)
  return sym !== '—' ? sym : isinKey || '—'
}

/** Ticker column: reference ticker, else holding name unless it duplicates the ISIN (or looks ISIN-only). */
export function displayTickerInTable(src: {
  name: string
  isin?: string | null
  ticker?: string | null
}): string {
  const ref = src.ticker?.trim()
  if (ref) return ref
  const n = src.name?.trim() ?? ''
  if (!n) return '—'
  const isinKey = src.isin?.trim().toUpperCase() ?? ''
  if (isinKey && n.toUpperCase() === isinKey) return '—'
  if (/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i.test(n)) return '—'
  if (/^CRYPTO-[A-Z0-9-]+$/i.test(n)) return '—'
  return n
}

/** Mark id format from API: `ISIN::YYYY-MM-DD` */
export function decodeIsinFromValuationId(id: string): string | null {
  const sep = '::'
  const i = id.indexOf(sep)
  if (i <= 0) return null
  const raw = id.slice(0, i).trim().toUpperCase()
  return raw || null
}

/** Stock valuations “Name” cell: same primary / ticker / ISIN layout as securities holdings. */
export function stockValuationNameDisplay(v: {
  id: string
  isin?: string
  asset?: {
    name: string
    isin?: string | null
    ticker?: string | null
    securityName?: string | null
  }
}): { primary: string; ticker: string | null; isin: string | null } {
  const isinResolved = (v.asset?.isin?.trim() || v.isin?.trim() || decodeIsinFromValuationId(v.id) || '').toUpperCase()
  const isinShow = isinResolved || null

  if (!v.asset) {
    return { primary: isinShow ?? '—', ticker: null, isin: null }
  }

  const tk = displayTickerInTable(v.asset)
  return {
    primary: securityTablePrimaryName(v.asset),
    ticker: tk !== '—' ? tk : null,
    isin: isinShow,
  }
}
