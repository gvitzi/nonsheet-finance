import type { WealthDocument } from '@nonsheet-finance/core'
import { parseWealthDocument, stringifyWealthDocument } from '@nonsheet-finance/core'

const DOC_KEY = 'nonsheet-finance-cached-wealth-json'
const AT_KEY = 'nonsheet-finance-cached-wealth-at'

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readBrowserCacheDocument(): { doc: WealthDocument; savedAtIso: string } | null {
  try {
    const storage = getStorage()
    if (!storage) return null
    const raw = storage.getItem(DOC_KEY)
    const at = storage.getItem(AT_KEY)
    if (!raw || !at) return null
    const doc = parseWealthDocument(JSON.parse(raw) as unknown)
    return { doc, savedAtIso: at }
  } catch {
    try {
      const storage = getStorage()
      storage?.removeItem(DOC_KEY)
      storage?.removeItem(AT_KEY)
    } catch {
      /* ignore */
    }
    return null
  }
}

/** Returns false if the write failed (quota, private mode, blocked storage). */
export function writeBrowserCacheDocument(doc: WealthDocument): boolean {
  try {
    const storage = getStorage()
    if (!storage) return false
    storage.setItem(DOC_KEY, stringifyWealthDocument(doc))
    storage.setItem(AT_KEY, new Date().toISOString())
    return true
  } catch {
    return false
  }
}

export function clearBrowserCacheDocument(): void {
  try {
    const storage = getStorage()
    storage?.removeItem(DOC_KEY)
    storage?.removeItem(AT_KEY)
  } catch {
    /* ignore */
  }
}

export function formatBrowserCacheSavedLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
