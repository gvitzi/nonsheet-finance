import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  computeStaleDataNotifications,
  maxWealthAppNotificationSeverity,
  type WealthAppNotification,
  type WealthAppNotificationSeverity,
} from '@nonsheet-finance/core'
import {
  WEALTH_APP_ERROR_NOTIFICATION_EVENT,
  WEALTH_DOC_LOADED_EVENT,
  type WealthDocLoadedSource,
} from './groupKinds'
import { getWealthDocument, subscribeWealthDocStore } from './wealthDocStore'
import { useWealthFile } from './WealthStoreProvider'

function messageForDocLoaded(source: WealthDocLoadedSource): string {
  if (source === 'browser-cache') return 'Data loaded from local browser cache'
  if (source === 'demo') return 'Demo data loaded'
  return 'Data loaded from imported file'
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

function NotificationSeverityIcon({ severity }: { severity: WealthAppNotificationSeverity }) {
  const common = { className: 'titlebar-notifications__severity-icon', viewBox: '0 0 24 24', 'aria-hidden': true as const }
  if (severity === 'info') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <path fill="currentColor" d="M11 10h2v8h-2zm0-4h2v2h-2z" />
      </svg>
    )
  }
  if (severity === 'warning') {
    return (
      <svg {...common}>
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          d="M12 5l9 16H3L12 5z"
        />
        <path fill="currentColor" d="M11 10h2v5h-2zm0 6h2v2h-2z" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        d="M15 9l-6 6M9 9l6 6"
      />
    </svg>
  )
}

export function TitlebarNotificationsBell() {
  const wealthFile = useWealthFile()
  const [open, setOpen] = useState(false)
  const [docGen, setDocGen] = useState(0)
  const [docLoadedNotices, setDocLoadedNotices] = useState<WealthAppNotification[]>([])
  const [errorNotices, setErrorNotices] = useState<WealthAppNotification[]>([])
  const [dismissedIds, setDismissedIds] = useState(() => new Set<string>())
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
      const item: WealthAppNotification = {
        id,
        message: messageForDocLoaded(source),
        severity: 'info',
      }
      setDocLoadedNotices((prev) => [...prev, item])
      window.setTimeout(() => {
        setDocLoadedNotices((prev) => prev.filter((n) => n.id !== id))
      }, 8000)
    }
    window.addEventListener(WEALTH_DOC_LOADED_EVENT, onLoaded)
    return () => window.removeEventListener(WEALTH_DOC_LOADED_EVENT, onLoaded)
  }, [])

  useEffect(() => {
    const onError = (e: Event) => {
      const ce = e as CustomEvent<{ message: string }>
      const message = ce.detail?.message?.trim()
      if (!message) return
      const id = `app-error-${Date.now()}`
      const item: WealthAppNotification = { id, message, severity: 'error' }
      setErrorNotices((prev) => [...prev, item])
      window.setTimeout(() => {
        setErrorNotices((prev) => prev.filter((n) => n.id !== id))
      }, 20000)
    }
    window.addEventListener(WEALTH_APP_ERROR_NOTIFICATION_EVENT, onError)
    return () => window.removeEventListener(WEALTH_APP_ERROR_NOTIFICATION_EVENT, onError)
  }, [])

  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(false))
    return () => cancelAnimationFrame(id)
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

  const rawNotifications = useMemo((): WealthAppNotification[] => {
    void docGen
    const doc = getWealthDocument()
    const stale = computeStaleDataNotifications(doc)
    const items: WealthAppNotification[] = [...errorNotices, ...docLoadedNotices]
    if (wealthFile.dirty) {
      items.push({
        id: 'unsaved',
        message:
          'You have unsaved changes. Export a copy from the menu (cog) if you want a dated JSON file on disk; the app also keeps a copy in this browser.',
        severity: 'warning',
      })
    }
    items.push(...stale)
    return items
  }, [docGen, docLoadedNotices, errorNotices, wealthFile.dirty])

  const allowedNotificationIds = useMemo(
    () => new Set(rawNotifications.map((n) => n.id)),
    [rawNotifications],
  )

  const activeNotificationIdsKey = useMemo(
    () => [...allowedNotificationIds].sort().join('\0'),
    [allowedNotificationIds],
  )

  useEffect(() => {
    queueMicrotask(() => {
      setDismissedIds((prev) => {
        const next = new Set<string>()
        for (const id of prev) {
          if (allowedNotificationIds.has(id)) next.add(id)
        }
        const prevKey = [...prev].sort().join('\0')
        const nextKey = [...next].sort().join('\0')
        if (prevKey === nextKey) return prev
        return next
      })
    })
  }, [activeNotificationIdsKey, allowedNotificationIds])

  const notifications = useMemo(
    () => rawNotifications.filter((n) => !dismissedIds.has(n.id)),
    [rawNotifications, dismissedIds],
  )

  const maxSeverity = useMemo(() => maxWealthAppNotificationSeverity(notifications), [notifications])

  const count = notifications.length
  const badgeLabel = count > 99 ? '99+' : String(count)

  const badgeModifier =
    maxSeverity === 'error'
      ? 'titlebar-notifications__badge--error'
      : maxSeverity === 'warning'
        ? 'titlebar-notifications__badge--warning'
        : 'titlebar-notifications__badge--info'

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
          <span className={`titlebar-notifications__badge ${badgeModifier}`} aria-hidden="true">
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
                <li
                  key={n.id}
                  className={`titlebar-notifications__item titlebar-notifications__item--${n.severity}`}
                >
                  <span className="titlebar-notifications__item-icon-wrap">
                    <NotificationSeverityIcon severity={n.severity} />
                  </span>
                  <div className="titlebar-notifications__item-body">
                    <span className="titlebar-notifications__item-text">{n.message}</span>
                    {n.action ? (
                      <Link
                        className="titlebar-notifications__item-link"
                        to={n.action.path}
                        onClick={() => setOpen(false)}
                      >
                        {n.action.label}
                      </Link>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="titlebar-notifications__dismiss"
                    aria-label="Dismiss notification"
                    title="Dismiss"
                    onClick={() =>
                      setDismissedIds((prev) => {
                        const next = new Set(prev)
                        next.add(n.id)
                        return next
                      })
                    }
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
