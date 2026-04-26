import type { WealthDocument } from '@nonsheet-finance/core'
import { parseWealthDocument, stringifyWealthDocument } from '@nonsheet-finance/core'

const DOC_KEY_PREFIX = 'nonsheet-finance-cached-wealth-json'
const AT_KEY = 'nonsheet-finance-cached-wealth-at'
const PARTS_KEY = 'nonsheet-finance-cached-wealth-parts'
const COOKIE_PATH = 'path=/'
const COOKIE_SAME_SITE = 'SameSite=Lax'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90
const CHUNK_SIZE = 3500
const MAX_PARTS = 120

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const encodedName = `${encodeURIComponent(name)}=`
  const parts = document.cookie ? document.cookie.split('; ') : []
  for (const p of parts) {
    if (p.startsWith(encodedName)) return decodeURIComponent(p.slice(encodedName.length))
  }
  return null
}

function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return
  document.cookie =
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}; ${COOKIE_PATH}; ${COOKIE_SAME_SITE}; Max-Age=${COOKIE_MAX_AGE_SECONDS}`
}

function clearCookie(name: string): void {
  if (typeof document === 'undefined') return
  document.cookie = `${encodeURIComponent(name)}=; ${COOKIE_PATH}; ${COOKIE_SAME_SITE}; Max-Age=0`
}

function readJsonRawFromCookies(): string | null {
  const partsRaw = readCookie(PARTS_KEY)
  if (!partsRaw) return null
  const count = parseInt(partsRaw, 10)
  if (!Number.isFinite(count) || count < 1 || count > MAX_PARTS) return null
  let raw = ''
  for (let i = 0; i < count; i += 1) {
    const chunk = readCookie(`${DOC_KEY_PREFIX}-${i}`)
    if (!chunk) return null
    raw += chunk
  }
  return raw
}

function clearJsonCookies(): void {
  const partsRaw = readCookie(PARTS_KEY)
  const count = partsRaw ? parseInt(partsRaw, 10) : 0
  if (Number.isFinite(count) && count > 0) {
    for (let i = 0; i < count; i += 1) clearCookie(`${DOC_KEY_PREFIX}-${i}`)
  }
  // Cleanup any stale extra chunks from previous larger writes.
  for (let i = 0; i < MAX_PARTS; i += 1) clearCookie(`${DOC_KEY_PREFIX}-${i}`)
  clearCookie(PARTS_KEY)
}

export function readBrowserCacheDocument(): { doc: WealthDocument; savedAtIso: string } | null {
  try {
    const raw = readJsonRawFromCookies()
    const at = readCookie(AT_KEY)
    if (!raw || !at) return null
    const doc = parseWealthDocument(JSON.parse(raw) as unknown)
    return { doc, savedAtIso: at }
  } catch {
    try {
      clearJsonCookies()
      clearCookie(AT_KEY)
    } catch {
      /* ignore */
    }
    return null
  }
}

/** Returns false if the write failed (quota, private mode, blocked storage). */
export function writeBrowserCacheDocument(doc: WealthDocument): boolean {
  try {
    const raw = stringifyWealthDocument(doc)
    const chunks: string[] = []
    for (let i = 0; i < raw.length; i += CHUNK_SIZE) {
      chunks.push(raw.slice(i, i + CHUNK_SIZE))
    }
    if (chunks.length === 0 || chunks.length > MAX_PARTS) return false
    clearJsonCookies()
    chunks.forEach((chunk, idx) => writeCookie(`${DOC_KEY_PREFIX}-${idx}`, chunk))
    writeCookie(PARTS_KEY, String(chunks.length))
    writeCookie(AT_KEY, new Date().toISOString())
    return true
  } catch {
    return false
  }
}

export function clearBrowserCacheDocument(): void {
  try {
    clearJsonCookies()
    clearCookie(AT_KEY)
  } catch {
    /* ignore */
  }
}

export function formatBrowserCacheSavedLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
