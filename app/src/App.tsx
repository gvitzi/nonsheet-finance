import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import './App.css'
import { api } from './api'
import type { Portfolio } from './api'
import { useWealthFile } from './WealthStoreProvider'
import Dashboard from './pages/Dashboard'
import GroupHub from './pages/GroupHub'
import GroupNew from './pages/GroupNew'
import GroupEdit from './pages/GroupEdit'
import PortfolioNew from './pages/PortfolioNew'
import PortfolioEdit from './pages/PortfolioEdit'
import SettingsPage from './pages/Settings'
import StockValuations from './pages/StockValuations'
import StockInformation from './pages/StockInformation'
import FxRates from './pages/FxRates'
import { PORTFOLIOS_UPDATED_EVENT, sortAssetGroupsForNav } from './groupKinds'
import { GroupNavGlyph, resolveGroupNavIconId, resolvePortfolioNavIconId } from './groupNavIcons'
import { assetGroupHubPath, assetGroupNewPath } from './portfolioPaths'
import { TitlebarNotificationsBell } from './TitlebarNotificationsBell'
import { usePwaInstall } from './usePwaInstall'
import { useAppliedTheme } from './theme'

const SIDEBAR_COLLAPSED_KEY = 'nonsheet-finance-sidebar-collapsed'

const MOBILE_NAV_MQ = '(max-width: 767px)'

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onStoreChange)
      return () => mq.removeEventListener('change', onStoreChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

function readInitialSidebarCollapsed(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* ignore */
  }
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_NAV_MQ).matches
}

const appVersionLabel = `v${__APP_VERSION__}`

function IconDashboard() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10"
      />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg className="settings-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
      />
    </svg>
  )
}

function IconPanelLeft() {
  return (
    <svg className="sidebar-toggle-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M9 3v18"
      />
    </svg>
  )
}

function IconPlus() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 5v14M5 12h14"
      />
    </svg>
  )
}

function IconStockValuations() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 18V6M7 18v-5M11 18V9M15 18v-3M19 18V7"
      />
    </svg>
  )
}

function IconStockInformation() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 6h16M4 12h10M4 18h14M16 12l2 2 4-4"
      />
    </svg>
  )
}

/** Sidebar: portfolio nav edit mode off — click to show New portfolio / New Asset Group. */
function IconPortfoliosEditOff() {
  return (
    <svg className="nav-icon nav-icon--portfolios-edit" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
      />
    </svg>
  )
}

/** Sidebar: portfolio nav edit mode on — pencil with active marker. */
function IconPortfoliosEditOn() {
  return (
    <svg className="nav-icon nav-icon--portfolios-edit" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
      />
      <circle cx="19" cy="5" r="2.25" fill="currentColor" />
    </svg>
  )
}

const settingsRoute = { path: '/settings', element: <SettingsPage /> }

function TitlebarCogMenu() {
  const wealthFile = useWealthFile()
  const pwa = usePwaInstall()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

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

  const close = () => setOpen(false)

  return (
    <div className="titlebar-menu" ref={wrapRef}>
      <button
        type="button"
        id="titlebar-menu-button"
        className={`titlebar-menu__trigger${wealthFile.dirty ? ' titlebar-menu__trigger--dirty' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls="titlebar-menu-dropdown"
        title="Menu"
        onClick={() => setOpen((v) => !v)}
      >
        <IconSettings />
      </button>
      {open ? (
        <div id="titlebar-menu-dropdown" className="titlebar-menu__dropdown" role="menu" aria-labelledby="titlebar-menu-button">
          <div className="titlebar-menu__heading">Data file</div>
          {wealthFile.dirty ? <div className="titlebar-menu__hint">Unsaved changes</div> : null}
          <button
            type="button"
            className="titlebar-menu__item"
            role="menuitem"
            onClick={() => {
              wealthFile.newDocument()
              close()
            }}
          >
            New
          </button>
          <button
            type="button"
            className="titlebar-menu__item"
            role="menuitem"
            onClick={() => {
              wealthFile.openFile()
              close()
            }}
          >
            Import…
          </button>
          <button
            type="button"
            className="titlebar-menu__item"
            role="menuitem"
            onClick={() => {
              void wealthFile.exportFile().then(close)
            }}
          >
            Export…
          </button>
          <div className="titlebar-menu__divider" role="separator" />
          <div className="titlebar-menu__heading">Add to Home Screen</div>
          {pwa.standalone ? (
            <div className="titlebar-menu__hint titlebar-menu__hint--wrap">Opened from your home screen.</div>
          ) : null}
          {pwa.showChromeInstall ? (
            <button
              type="button"
              className="titlebar-menu__item"
              role="menuitem"
              onClick={() => {
                void pwa.triggerInstallFromPrompt().then(close)
              }}
            >
              Install app
            </button>
          ) : null}
          {pwa.showIosInstallHint ? (
            <div className="titlebar-menu__hint titlebar-menu__hint--wrap">
              <strong>Safari:</strong> tap Share, then <strong>Add to Home Screen</strong>.
            </div>
          ) : null}
          {pwa.showAndroidBrowserHint ? (
            <div className="titlebar-menu__hint titlebar-menu__hint--wrap">
              <strong>Android:</strong> open the browser menu (⋮) and choose <strong>Add to Home screen</strong> or{' '}
              <strong>Install app</strong> (wording varies by browser).
            </div>
          ) : null}
          {pwa.showDesktopHomeScreenHint ? (
            <div className="titlebar-menu__hint titlebar-menu__hint--wrap">
              Use the browser menu to <strong>install</strong> this page or create a shortcut (where your browser supports
              it).
            </div>
          ) : null}
          <div className="titlebar-menu__divider" role="separator" />
          <NavLink
            to={settingsRoute.path}
            className={({ isActive }) => `titlebar-menu__link${isActive ? ' titlebar-menu__link--active' : ''}`}
            role="menuitem"
            onClick={close}
          >
            Settings
          </NavLink>
        </div>
      ) : null}
    </div>
  )
}

function App() {
  useAppliedTheme()
  const location = useLocation()
  const compactNav = useMediaQuery(MOBILE_NAV_MQ)
  const pathKey = `${location.pathname}${location.search}`
  const prevPathKeyRef = useRef<string | null>(null)
  const hadCompactNavRef = useRef(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readInitialSidebarCollapsed)
  const [sidebarPortfolios, setSidebarPortfolios] = useState<Portfolio[]>([])
  /** When true, sidebar shows New portfolio / New Asset Group. Off by default. */
  const [portfoliosEditMode, setPortfoliosEditMode] = useState(false)
  const [hubTitle, setHubTitle] = useState('')
  const [propertyTitle, setPropertyTitle] = useState('')
  const [assetTitle, setAssetTitle] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
    if (sidebarCollapsed) setPortfoliosEditMode(false)
  }, [sidebarCollapsed])

  useEffect(() => {
    if (compactNav && !hadCompactNavRef.current) {
      setSidebarCollapsed(true)
    }
    hadCompactNavRef.current = compactNav
  }, [compactNav])

  useEffect(() => {
    if (!compactNav) return
    if (prevPathKeyRef.current === null) {
      prevPathKeyRef.current = pathKey
      return
    }
    if (pathKey !== prevPathKeyRef.current) {
      prevPathKeyRef.current = pathKey
      setSidebarCollapsed(true)
    }
  }, [compactNav, pathKey])

  useEffect(() => {
    const load = () => {
      api.portfolios
        .list()
        .then((list) => setSidebarPortfolios(list))
        .catch(() => setSidebarPortfolios([]))
    }
    load()
    window.addEventListener(PORTFOLIOS_UPDATED_EVENT, load)
    return () => window.removeEventListener(PORTFOLIOS_UPDATED_EVENT, load)
  }, [location.pathname])

  useEffect(() => {
    const assetMatch = location.pathname.match(/^\/portfolios\/([^/]+)\/asset-groups\/([^/]+)\/assets\/([^/]+)$/)
    if (assetMatch) {
      const [, portfolioId, assetGroupId, aid] = assetMatch
      setPropertyTitle('')
      Promise.all([api.assetGroups.get(assetGroupId), api.assets.get(aid)])
        .then(([g, a]) => {
          if (g.portfolioId !== portfolioId) {
            setHubTitle('Asset Group')
            setAssetTitle(a.name)
            return
          }
          setHubTitle(g.name)
          setAssetTitle(a.name)
        })
        .catch(() => {
          setHubTitle('Asset Group')
          setAssetTitle('Asset')
        })
      return
    }

    setAssetTitle('')
    const propMatch = location.pathname.match(/^\/portfolios\/([^/]+)\/asset-groups\/([^/]+)\/properties\/([^/]+)$/)
    if (propMatch) {
      const [, portfolioId, assetGroupId, propertyId] = propMatch
      setPropertyTitle('')
      Promise.all([api.assetGroups.get(assetGroupId), api.properties.get(propertyId)])
        .then(([g, p]) => {
          if (g.portfolioId !== portfolioId) {
            setHubTitle('Asset Group')
            setPropertyTitle(p.name)
            return
          }
          setHubTitle(g.name)
          setPropertyTitle(p.name)
        })
        .catch(() => {
          setHubTitle('Asset Group')
          setPropertyTitle('Property')
        })
      return
    }

    setPropertyTitle('')
    const hubMatch = location.pathname.match(/^\/portfolios\/([^/]+)\/asset-groups\/([^/]+)$/)
    const portfolioId = hubMatch?.[1]
    const assetGroupId = hubMatch?.[2]
    if (!assetGroupId || assetGroupId === 'new') {
      setHubTitle('')
      return
    }
    api.assetGroups
      .get(assetGroupId)
      .then((g) => {
        if (portfolioId && g.portfolioId !== portfolioId) setHubTitle('Asset Group')
        else setHubTitle(g.name)
      })
      .catch(() => setHubTitle('Asset Group'))
  }, [location.pathname])

  const pageTitle = useMemo(() => {
    if (location.pathname === '/stock-valuations') return 'Stock Valuations'
    if (location.pathname === '/stock-information') return 'Stock Information'
    if (location.pathname === '/fx-rates') return 'FX rates'
    if (location.pathname === settingsRoute.path) return 'Settings'
    if (location.pathname === '/portfolios/new') return 'New portfolio'
    if (/^\/portfolios\/[^/]+\/edit$/.test(location.pathname)) return 'Edit portfolio'
    if (/^\/portfolios\/[^/]+\/asset-groups\/new$/.test(location.pathname)) return 'New Asset Group'
    if (/^\/portfolios\/[^/]+\/asset-groups\/[^/]+\/edit$/.test(location.pathname)) return 'Edit Asset Group'
    if (/^\/portfolios\/[^/]+\/asset-groups\/[^/]+\/assets\/[^/]+$/.test(location.pathname)) {
      if (hubTitle && assetTitle) return `${hubTitle} · ${assetTitle}`
      return assetTitle || hubTitle || 'Asset'
    }
    if (/^\/portfolios\/[^/]+\/asset-groups\/[^/]+\/properties\/[^/]+$/.test(location.pathname)) {
      if (hubTitle && propertyTitle) return `${hubTitle} · ${propertyTitle}`
      return propertyTitle || hubTitle || 'Property'
    }
    const m = location.pathname.match(/^\/portfolios\/([^/]+)\/asset-groups\/([^/]+)$/)
    if (m?.[2] && m[2] !== 'new') return hubTitle || 'Asset Group'
    if (location.pathname === '/') return 'Dashboard'
    return 'Nonsheet Finance'
  }, [hubTitle, propertyTitle, assetTitle, location.pathname])

  return (
    <div className="app-shell">
      <header className="app-titlebar">
        <div className="app-titlebar__start">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-expanded={!sidebarCollapsed}
            aria-controls="app-sidebar"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <IconPanelLeft />
          </button>
          <div className="app-titlebar__brand">
            <span className="app-titlebar__name">Nonsheet Finance</span>
            <span className="app-titlebar__sep" aria-hidden="true">
              /
            </span>
            <span className="app-titlebar__page">{pageTitle}</span>
          </div>
        </div>
        <div className="app-titlebar__end">
          <TitlebarNotificationsBell />
          <TitlebarCogMenu />
        </div>
      </header>

      <div className="app-main">
        {compactNav && !sidebarCollapsed ? (
          <button
            type="button"
            className="sidebar-backdrop"
            aria-label="Close navigation menu"
            onClick={() => setSidebarCollapsed(true)}
          />
        ) : null}
        <aside
          id="app-sidebar"
          className={`sidebar${sidebarCollapsed ? ' sidebar--collapsed' : ''}${compactNav && !sidebarCollapsed ? ' sidebar--mobile-overlay' : ''}`}
          aria-label="Primary navigation"
          aria-hidden={compactNav && sidebarCollapsed ? true : undefined}
        >
          <nav className="sidebar-nav">
            <ul className="nav-list">
              <li>
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}
                  title="Dashboard"
                >
                  <span className="nav-link__icon">
                    <IconDashboard />
                  </span>
                  <span className="nav-link__text">Dashboard</span>
                </NavLink>
              </li>
            </ul>

            <div className="nav-section-header nav-section-header--portfolios">
              <p className="nav-section-label nav-section-label--row">Portfolios</p>
              <button
                type="button"
                className={`nav-portfolios-edit-toggle${portfoliosEditMode ? ' nav-portfolios-edit-toggle--on' : ''}`}
                aria-pressed={portfoliosEditMode}
                aria-label={
                  portfoliosEditMode
                    ? 'Portfolio edit mode on. Click to turn off and hide portfolio Edit, New portfolio, and New Asset Group.'
                    : 'Portfolio edit mode off. Click to turn on and show portfolio Edit, New portfolio, and New Asset Group.'
                }
                title={
                  portfoliosEditMode
                    ? 'Edit mode on — click to turn off'
                    : 'Edit mode off — click to show portfolio actions'
                }
                onClick={() => setPortfoliosEditMode((v) => !v)}
              >
                <span className="nav-portfolios-edit-toggle__icon" aria-hidden>
                  {portfoliosEditMode ? <IconPortfoliosEditOn /> : <IconPortfoliosEditOff />}
                </span>
              </button>
            </div>
            <ul className="nav-list nav-list--tight">
              {sidebarPortfolios.map((p) => (
                <li key={p.id}>
                  <div className="nav-portfolio-row">
                    <div className="nav-portfolio-row__main">
                      <span
                        className="nav-portfolio-row__icon"
                        style={p.color ? { color: p.color } : undefined}
                        aria-hidden
                      >
                        <GroupNavGlyph iconId={resolvePortfolioNavIconId(p.icon)} />
                      </span>
                      <span className="nav-portfolio-name" title={p.name}>
                        {p.name}
                      </span>
                    </div>
                    {portfoliosEditMode ? (
                      <NavLink
                        to={`/portfolios/${p.id}/edit`}
                        className={({ isActive }) => `nav-link nav-link--inline${isActive ? ' nav-link--active' : ''}`}
                        title="Edit portfolio"
                        aria-label={`Edit portfolio ${p.name}`}
                      >
                        <span className="nav-link__text nav-link__text--muted">Edit</span>
                      </NavLink>
                    ) : null}
                  </div>
                  <ul className="nav-list nav-list--tight nav-list--nested">
                    {[...(p.assetGroups ?? [])].sort(sortAssetGroupsForNav).map((g) => (
                      <li key={g.id}>
                        <NavLink
                          to={assetGroupHubPath(p.id, g.id)}
                          className={({ isActive }) => `nav-link nav-link--child${isActive ? ' nav-link--active' : ''}`}
                          title={g.name}
                        >
                          <span
                            className="nav-link__icon nav-link__icon--group"
                            style={g.color ? { color: g.color } : undefined}
                          >
                            <GroupNavGlyph iconId={resolveGroupNavIconId(g.kind)} />
                          </span>
                          <span className="nav-link__text">{g.name}</span>
                        </NavLink>
                      </li>
                    ))}
                    {portfoliosEditMode ? (
                      <li>
                        <NavLink
                          to={assetGroupNewPath(p.id)}
                          className={({ isActive }) =>
                            `nav-link nav-link--child nav-link--add${isActive ? ' nav-link--active' : ''}`
                          }
                          title="New Asset Group"
                        >
                          <span className="nav-link__icon">
                            <IconPlus />
                          </span>
                          <span className="nav-link__text">New Asset Group</span>
                        </NavLink>
                      </li>
                    ) : null}
                  </ul>
                </li>
              ))}
              {portfoliosEditMode ? (
                <li>
                  <NavLink
                    to="/portfolios/new"
                    className={({ isActive }) => `nav-link nav-link--child nav-link--add${isActive ? ' nav-link--active' : ''}`}
                    title="New portfolio"
                  >
                    <span className="nav-link__icon">
                      <IconPlus />
                    </span>
                    <span className="nav-link__text">New portfolio</span>
                  </NavLink>
                </li>
              ) : null}
            </ul>

            <div className="nav-section-header nav-section-header--secondary">
              <p className="nav-section-label nav-section-label--row">{'Securities & FX'}</p>
            </div>
            <ul className="nav-list nav-list--tight">
              <li>
                <NavLink
                  to="/stock-valuations"
                  className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}
                  title="Stock Valuations"
                >
                  <span className="nav-link__icon">
                    <IconStockValuations />
                  </span>
                  <span className="nav-link__text">Stock Valuations</span>
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/stock-information"
                  className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}
                  title="Stock Information"
                >
                  <span className="nav-link__icon">
                    <IconStockInformation />
                  </span>
                  <span className="nav-link__text">Stock Information</span>
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/fx-rates"
                  className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}
                  title="FX rates"
                >
                  <span className="nav-link__text">FX rates</span>
                </NavLink>
              </li>
            </ul>

          </nav>
          <footer className="sidebar-footer">
            <span
              className="app-version"
              title={`Nonsheet Finance ${appVersionLabel}`}
              aria-label={`Application version ${appVersionLabel}`}
            >
              {appVersionLabel}
            </span>
          </footer>
        </aside>

        <main className="content">
          <Routes>
            <Route path="/portfolios/new" element={<PortfolioNew />} />
            <Route path="/portfolios/:portfolioId/edit" element={<PortfolioEdit />} />
            <Route path="/portfolios/:portfolioId/asset-groups/new" element={<GroupNew />} />
            <Route path="/portfolios/:portfolioId/asset-groups/:assetGroupId/edit" element={<GroupEdit />} />
            <Route path="/portfolios/:portfolioId/asset-groups/:assetGroupId/assets/:assetId" element={<GroupHub />} />
            <Route path="/portfolios/:portfolioId/asset-groups/:assetGroupId/properties/:propertyId" element={<GroupHub />} />
            <Route path="/portfolios/:portfolioId/asset-groups/:assetGroupId" element={<GroupHub />} />
            <Route path="/" element={<Dashboard />} />
            <Route path="/stock-valuations" element={<StockValuations />} />
            <Route path="/stock-information" element={<StockInformation />} />
            <Route path="/fx-rates" element={<FxRates />} />
            <Route path={settingsRoute.path} element={settingsRoute.element} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default App
