import type { WealthDocument } from '@nonsheet-finance/core'
import { createEmptyWealthDocument, parseWealthDocument, stringifyWealthDocument } from '@nonsheet-finance/core'

const DOC_KEY = 'nonsheet-finance:cached-wealth-json'
const AT_KEY = 'nonsheet-finance:cached-wealth-at'

const ARRAY_KEYS: (keyof WealthDocument)[] = [
  'portfolios',
  'assetGroups',
  'assets',
  'liabilities',
  'properties',
  'propertyValuations',
  'propertyMortgages',
  'propertyExpenses',
  'assetValuations',
  'securityTransactions',
  'securityInfo',
  'securityValuations',
  'fxRates',
]

/** True if the document has any user-visible data worth offering as “restore from browser”. */
function isBrowserCacheWorthShowing(doc: WealthDocument): boolean {
  for (const k of ARRAY_KEYS) {
    const a = doc[k]
    if (Array.isArray(a) && a.length > 0) return true
  }
  const title = doc.meta?.title
  if (typeof title === 'string' && title.trim()) return true
  const empty = createEmptyWealthDocument()
  if (doc.settings.baseCurrency !== empty.settings.baseCurrency) return true
  return false
}

export function readBrowserCacheDocument(): { doc: WealthDocument; savedAtIso: string } | null {
  try {
    const raw = localStorage.getItem(DOC_KEY)
    const at = localStorage.getItem(AT_KEY)
    if (!raw || !at) return null
    const doc = parseWealthDocument(JSON.parse(raw) as unknown)
    if (!isBrowserCacheWorthShowing(doc)) return null
    return { doc, savedAtIso: at }
  } catch {
    try {
      localStorage.removeItem(DOC_KEY)
      localStorage.removeItem(AT_KEY)
    } catch {
      /* ignore */
    }
    return null
  }
}

export function writeBrowserCacheDocument(doc: WealthDocument): void {
  try {
    const raw = stringifyWealthDocument(doc)
    localStorage.setItem(DOC_KEY, raw)
    localStorage.setItem(AT_KEY, new Date().toISOString())
  } catch {
    /* quota, private mode */
  }
}

export function clearBrowserCacheDocument(): void {
  try {
    localStorage.removeItem(DOC_KEY)
    localStorage.removeItem(AT_KEY)
  } catch {
    /* ignore */
  }
}

export function formatBrowserCacheSavedLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
