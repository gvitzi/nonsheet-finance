import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { computeStaleDataNotifications, type WealthAppNotification } from '@nonsheet-finance/core'
import { WEALTH_DOC_LOADED_EVENT, type WealthDocLoadedSource } from './groupKinds'
import { getWealthDocument, subscribeWealthDocStore } from './wealthDocStore'
import { useWealthFile } from './WealthStoreProvider'

function messageForDocLoaded(source: WealthDocLoadedSource): string {
  return source === 'browser-cache'
    ? 'Data loaded from local browser cache'
    : 'Data loaded from imported file'
}

function IconBell() {
  return (
    <svg className="titlebar-notifications__icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 8a6 6 0 10-12 0c0 7-3 7-3 14h18c0-7-3-7-3-14 M13.73 21a2 2 0 01-3.46 0"
      />
    </svg>
  )
}

export function TitlebarNotificationsBell() {
  const wealthFile = useWealthFile()
  const [open, setOpen] = useState(false)
  const [docGen, setDocGen] = useState(0)
  const [docLoadedNotices, setDocLoadedNotices] = useState<WealthAppNotification[]>([])
  const wrapRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

  useEffect(() => {
    return subscribeWealthDocStore(() => setDocGen((g) => g + 1))
  }, [])

  useEffect(() => {
    const onLoaded = (e: Event) => {
      const ce = e as CustomEvent<{ source: WealthDocLoadedSource }>
      const source = ce.detail?.source
      if (source !== 'browser-cache' && source !== 'import') return
      const id = `doc-loaded-${Date.now()}`
      const item: WealthAppNotification = { id, message: messageForDocLoaded(source) }
      setDocLoadedNotices((prev) => [...prev, item])
      window.setTimeout(() => {
        setDocLoadedNotices((prev) => prev.filter((n) => n.id !== id))
      }, 8000)
    }
    window.addEventListener(WEALTH_DOC_LOADED_EVENT, onLoaded)
    return () => window.removeEventListener(WEALTH_DOC_LOADED_EVENT, onLoaded)
  }, [])

  useEffect(() => {
    setOpen(false)
  }, [location.pathname, location.search, location.hash])

  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const notifications = useMemo((): WealthAppNotification[] => {
    const doc = getWealthDocument()
    const stale = computeStaleDataNotifications(doc)
    const items: WealthAppNotification[] = [...docLoadedNotices]
    if (wealthFile.dirty) {
      items.push({
        id: 'unsaved',
        message:
          'You have unsaved changes. Export a copy from the menu (cog) if you want a dated JSON file on disk; the app also keeps a copy in this browser.',
      })
    }
    items.push(...stale)
    return items
  }, [docGen, docLoadedNotices, wealthFile.dirty])

  const count = notifications.length
  const badgeLabel = count > 99 ? '99+' : String(count)

  return (
    <div className="titlebar-notifications" ref={wrapRef}>
      <button
        type="button"
        id="titlebar-notifications-button"
        className={`titlebar-notifications__trigger${count > 0 ? ' titlebar-notifications__trigger--active' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="titlebar-notifications-panel"
        title="Notifications"
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        onClick={() => setOpen((v) => !v)}
      >
        <IconBell />
        {count > 0 ? (
          <span className="titlebar-notifications__badge" aria-hidden="true">
            {badgeLabel}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id="titlebar-notifications-panel"
          className="titlebar-notifications__dropdown"
          role="dialog"
          aria-labelledby="titlebar-notifications-button"
        >
          <div className="titlebar-menu__heading">Notifications</div>
          {count === 0 ? (
            <div className="titlebar-notifications__empty">No notifications</div>
          ) : (
            <ul className="titlebar-notifications__list">
              {notifications.map((n) => (
                <li key={n.id} className="titlebar-notifications__item">
                  {n.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
