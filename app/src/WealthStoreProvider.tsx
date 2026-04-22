import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createEmptyWealthDocument, parseWealthDocument, stringifyWealthDocument } from '@nonsheet-finance/core'
import {
  PORTFOLIOS_UPDATED_EVENT,
  WEALTH_APP_ERROR_NOTIFICATION_EVENT,
  WEALTH_DOC_LOADED_EVENT,
  type WealthDocLoadedSource,
} from './groupKinds'
import {
  clearBrowserCacheDocument,
  readBrowserCacheDocument,
  writeBrowserCacheDocument,
} from './wealthDocBrowserCache'
import {
  getWealthDocument,
  isWealthDocStoreDirty,
  markWealthDocStoreSaved,
  replaceWealthDocument,
  setWealthFileHandle,
  subscribeWealthDocStore,
} from './wealthDocStore'

type WealthFileContextValue = {
  dirty: boolean
  newDocument: () => void
  openFile: (opts?: { onLoaded?: () => void }) => void
  exportFile: () => Promise<void>
}

const WealthFileContext = createContext<WealthFileContextValue | null>(null)

export function useWealthFile(): WealthFileContextValue {
  const v = useContext(WealthFileContext)
  if (!v) throw new Error('useWealthFile must be used within WealthStoreProvider')
  return v
}

function downloadJson(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function WealthStoreProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(isWealthDocStoreDirty)
  /** Until true, user must pick a JSON file or start an empty document (welcome overlay). */
  const [documentSessionReady, setDocumentSessionReady] = useState(() => {
    const cached = readBrowserCacheDocument()
    if (!cached) return false
    setWealthFileHandle(null)
    replaceWealthDocument(cached.doc, { markDirty: false })
    return true
  })
  const autoRestoredFromCacheRef = useRef(documentSessionReady)
  const welcomePrimaryRef = useRef<HTMLButtonElement>(null)
  const lastBrowserCacheFailNotifyAtRef = useRef(0)

  const dispatchAppErrorNotification = useCallback((message: string) => {
    window.dispatchEvent(
      new CustomEvent<{ message: string }>(WEALTH_APP_ERROR_NOTIFICATION_EVENT, { detail: { message } }),
    )
  }, [])

  const notifyBrowserCacheWriteFailed = useCallback(() => {
    const now = Date.now()
    if (now - lastBrowserCacheFailNotifyAtRef.current < 90_000) return
    lastBrowserCacheFailNotifyAtRef.current = now
    dispatchAppErrorNotification(
      'Could not save a browser backup copy (storage may be full or blocked). Your changes still work in this tab; export regularly from the menu.',
    )
  }, [dispatchAppErrorNotification])

  useEffect(() => {
    return subscribeWealthDocStore(() => setDirty(isWealthDocStoreDirty()))
  }, [])

  useEffect(() => {
    if (!autoRestoredFromCacheRef.current) return
    autoRestoredFromCacheRef.current = false
    window.dispatchEvent(new CustomEvent(PORTFOLIOS_UPDATED_EVENT))
    window.dispatchEvent(
      new CustomEvent<{ source: WealthDocLoadedSource }>(WEALTH_DOC_LOADED_EVENT, {
        detail: { source: 'browser-cache' },
      }),
    )
  }, [])

  /** After the user picks a source, keep a debounced copy in localStorage for the next visit. */
  useEffect(() => {
    if (!documentSessionReady) return
    if (!writeBrowserCacheDocument(getWealthDocument())) notifyBrowserCacheWriteFailed()
  }, [documentSessionReady, notifyBrowserCacheWriteFailed])

  useEffect(() => {
    if (!documentSessionReady) return
    let t: ReturnType<typeof setTimeout> | undefined
    const unsub = subscribeWealthDocStore(() => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        if (!writeBrowserCacheDocument(getWealthDocument())) notifyBrowserCacheWriteFailed()
      }, 400)
    })
    return () => {
      unsub()
      if (t) clearTimeout(t)
    }
  }, [documentSessionReady, notifyBrowserCacheWriteFailed])

  useLayoutEffect(() => {
    if (documentSessionReady) return
    welcomePrimaryRef.current?.focus()
  }, [documentSessionReady])

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isWealthDocStoreDirty()) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Note: `useBlocker` only works with a data router (createHashRouter + RouterProvider), not <HashRouter>.
  // In-app navigation when dirty is not blocked; closing/reloading the tab is still guarded via `beforeunload`.

  const newDocument = useCallback(() => {
    if (isWealthDocStoreDirty() && !window.confirm('Discard unsaved changes and start a new file?')) return
    setWealthFileHandle(null)
    replaceWealthDocument(createEmptyWealthDocument(), { markDirty: false })
    window.dispatchEvent(new CustomEvent(PORTFOLIOS_UPDATED_EVENT))
  }, [])

  const openFile = useCallback((opts?: { onLoaded?: () => void }) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      void file.text().then((text) => {
        try {
          const parsed = parseWealthDocument(JSON.parse(text) as unknown)
          if (isWealthDocStoreDirty() && !window.confirm('Replace current data? Unsaved changes will be lost.')) return
          replaceWealthDocument(parsed, { markDirty: false })
          setWealthFileHandle(null)
          window.dispatchEvent(new CustomEvent(PORTFOLIOS_UPDATED_EVENT))
          window.dispatchEvent(
            new CustomEvent<{ source: WealthDocLoadedSource }>(WEALTH_DOC_LOADED_EVENT, {
              detail: { source: 'import' },
            }),
          )
          opts?.onLoaded?.()
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Invalid file'
          dispatchAppErrorNotification(`Could not import the JSON file: ${msg}`)
        }
      })
    }
    input.click()
  }, [dispatchAppErrorNotification])

  const beginEmptyDocumentSession = useCallback(() => {
    clearBrowserCacheDocument()
    setWealthFileHandle(null)
    replaceWealthDocument(createEmptyWealthDocument(), { markDirty: false })
    window.dispatchEvent(new CustomEvent(PORTFOLIOS_UPDATED_EVENT))
    setDocumentSessionReady(true)
  }, [])

  const exportFile = useCallback(async () => {
    const raw = stringifyWealthDocument(getWealthDocument())
    const day = new Date().toISOString().slice(0, 10)
    downloadJson(`nonsheet-finance-${day}.json`, raw)
    markWealthDocStoreSaved()
  }, [])

  const value = useMemo(
    () => ({ dirty, newDocument, openFile, exportFile }),
    [dirty, newDocument, openFile, exportFile],
  )

  return (
    <WealthFileContext.Provider value={value}>
      <div className="app-viewport">
        {children}
        {!documentSessionReady ? (
          <div className="welcome-doc-overlay" role="presentation">
            <div className="welcome-doc-backdrop" aria-hidden />
            <div
              className="welcome-doc-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="welcome-doc-title"
              aria-describedby="welcome-doc-desc"
            >
              <h1 id="welcome-doc-title" className="welcome-doc-title">
                Choose your data file
              </h1>
              <p id="welcome-doc-desc" className="welcome-doc-desc">
                This app keeps everything in one JSON file. While you work, a copy is also kept in this browser (local storage) so you can pick up where you left off after a refresh. If a saved copy exists, it is loaded automatically; otherwise import a file from disk or start fresh.
              </p>
              <div className="welcome-doc-actions">
                <button
                  type="button"
                  className="btn btn-primary welcome-doc-btn"
                  ref={welcomePrimaryRef}
                  onClick={() => openFile({ onLoaded: () => setDocumentSessionReady(true) })}
                >
                  Import JSON file…
                </button>
                <button type="button" className="btn welcome-doc-btn" onClick={beginEmptyDocumentSession}>
                  Start with an empty document
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </WealthFileContext.Provider>
  )
}
