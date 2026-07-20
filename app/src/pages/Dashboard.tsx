import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import {
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import { convertAmountViaUsdFx, type FxRateRecord } from '@nonsheet-finance/core'
import { ApiError, api } from '../api'
import type { DashboardSummary, GroupKind } from '../api'
import { GROUP_KIND_LABELS, GROUP_KIND_ORDER, PORTFOLIOS_UPDATED_EVENT, labelForGroupKind } from '../groupKinds'
import { GroupNavGlyph, resolveGroupNavIconId, resolvePortfolioNavIconId } from '../groupNavIcons'
import { assetGroupHubPath } from '../portfolioPaths'

const fmt = (n: number) => n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const COLORS = ['#4f8ef7', '#34d399', '#f97316', '#a78bfa', '#f43f5e', '#facc15', '#22d3ee']

function fmtMoney(n: number, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
  } catch {
    return `${currency} ${fmt(n)}`
  }
}

function getFriendlyError(error: unknown) {
  if (error instanceof ApiError && error.status >= 500) return 'The dashboard data could not be loaded right now.'
  if (error instanceof Error) return error.message
  return 'Failed to load dashboard.'
}

const MOBILE_MQ = '(max-width: 767px)'

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

export default function Dashboard() {
  const isMobile = useMediaQuery(MOBILE_MQ)
  const [data, setData] = useState<DashboardSummary | null>(null)
  const [fxRates, setFxRates] = useState<FxRateRecord[]>([])
  const [error, setError] = useState('')
  /** `null` = use settings “Display currency” default from the latest dashboard payload. */
  const [viewCurrencyPreference, setViewCurrencyPreference] = useState<string | null>(null)
  const [filterPortfolioIds, setFilterPortfolioIds] = useState<string[]>([])
  const [filterKind, setFilterKind] = useState<GroupKind | ''>('')
  const [filterAssetGroupId, setFilterAssetGroupId] = useState('')

  const filterActive = Boolean(filterKind || filterAssetGroupId || filterPortfolioIds.length > 0)

  useEffect(() => {
    let cancelled = false
    let hasLoadedOk = false
    const load = () => {
      void Promise.all([api.dashboard.summary(), api.fxRates.list()])
        .then(([d, fx]) => {
          if (cancelled) return
          hasLoadedOk = true
          setData(d)
          setFxRates(fx as FxRateRecord[])
          setError('')
        })
        .catch((e: unknown) => {
          if (cancelled) return
          if (!hasLoadedOk) setError(getFriendlyError(e))
        })
    }
    load()
    window.addEventListener(PORTFOLIOS_UPDATED_EVENT, load)
    return () => {
      cancelled = true
      window.removeEventListener(PORTFOLIOS_UPDATED_EVENT, load)
    }
  }, [])

  /** Aggregation / book currency (numbers in the API payload are in this code). */
  const bookCurrencyCode = (data?.displayCurrency ?? 'EUR').trim().toUpperCase() || 'EUR'

  const viewCurrencyCode = useMemo(() => {
    const def = (data?.defaultDisplayCurrency ?? data?.displayCurrency ?? 'EUR').trim().toUpperCase() || 'EUR'
    return (viewCurrencyPreference ?? def).trim().toUpperCase() || 'EUR'
  }, [data, viewCurrencyPreference])

  const displayCurrencySelectOptions = useMemo(() => {
    if (!data) return [] as { value: string; label: string }[]
    const book = (data.displayCurrency ?? 'EUR').trim().toUpperCase() || 'EUR'
    const def = (data.defaultDisplayCurrency ?? book).trim().toUpperCase() || book
    const fromFx = fxRates.flatMap((r) => {
      const a = typeof r.fromCurrency === 'string' ? r.fromCurrency.trim().toUpperCase() : ''
      const b = typeof r.toCurrency === 'string' ? r.toCurrency.trim().toUpperCase() : ''
      return [a, b].filter(Boolean)
    })
    const fxSorted = [...new Set(fromFx)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

    const opts: { value: string; label: string }[] = []
    const seen = new Set<string>()

    if (def === book) {
      opts.push({ value: '__default__', label: `Default (${def})` })
      seen.add(def)
    } else {
      opts.push({ value: '__default__', label: `Dashboard default (${def})` })
      opts.push({ value: book, label: `Aggregated (${book})` })
      seen.add(def)
      seen.add(book)
    }
    for (const c of fxSorted) {
      if (seen.has(c)) continue
      seen.add(c)
      opts.push({ value: c, label: c })
    }
    return opts
  }, [data, fxRates])

  const displayCurrencySelectValue = useMemo(() => {
    if (viewCurrencyPreference === null) return '__default__'
    return viewCurrencyPreference
  }, [viewCurrencyPreference])

  useEffect(() => {
    if (!data || viewCurrencyPreference === null) return
    const allowed = new Set(
      displayCurrencySelectOptions.filter((o) => o.value !== '__default__').map((o) => o.value.trim().toUpperCase()),
    )
    const cur = viewCurrencyPreference.trim().toUpperCase()
    if (!allowed.has(cur)) setViewCurrencyPreference(null)
  }, [data, displayCurrencySelectOptions, viewCurrencyPreference])

  const portfolioOptions = useMemo(() => {
    if (!data?.byPortfolio.length) return []
    return [...data.byPortfolio].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [data])

  useEffect(() => {
    if (!data?.byPortfolio.length || filterPortfolioIds.length === 0) return
    const valid = new Set(data.byPortfolio.map((p) => p.id))
    const next = filterPortfolioIds.filter((id) => valid.has(id))
    const same =
      next.length === filterPortfolioIds.length && next.every((id, i) => id === filterPortfolioIds[i])
    if (!same) setFilterPortfolioIds(next)
  }, [data, filterPortfolioIds])

  const matchesPortfolioFilter = (portfolioId: string) =>
    filterPortfolioIds.length === 0 || filterPortfolioIds.includes(portfolioId)

  const assetGroupOptions = useMemo(() => {
    if (!data) return []
    let list = data.byAssetGroup.filter((g) => matchesPortfolioFilter(g.portfolioId))
    if (filterKind) list = list.filter((g) => g.kind === filterKind)
    return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [data, filterKind, filterPortfolioIds])

  useEffect(() => {
    if (!data?.byAssetGroup.length || !filterAssetGroupId) return
    if (!assetGroupOptions.some((g) => g.id === filterAssetGroupId)) setFilterAssetGroupId('')
  }, [data, filterAssetGroupId, assetGroupOptions])

  const filteredByAssetGroup = useMemo(() => {
    if (!data) return []
    let list = data.byAssetGroup.filter((g) => matchesPortfolioFilter(g.portfolioId))
    if (filterKind) list = list.filter((g) => g.kind === filterKind)
    if (filterAssetGroupId) list = list.filter((g) => g.id === filterAssetGroupId)
    return list
  }, [data, filterKind, filterAssetGroupId, filterPortfolioIds])

  const displayTotals = useMemo(() => {
    if (!data) return null
    if (!filterKind && !filterAssetGroupId && filterPortfolioIds.length === 0) {
      return {
        netWorth: data.netWorth,
        totalAssets: data.totalAssets,
        totalLiabilities: data.totalLiabilities,
        scope: 'all' as const,
      }
    }
    if (filteredByAssetGroup.length === 0) {
      return {
        netWorth: 0,
        totalAssets: 0,
        totalLiabilities: 0,
        scope: 'empty' as const,
      }
    }
    const totalAssets = filteredByAssetGroup.reduce((s, g) => s + g.totalAssets, 0)
    const totalLiabilities = filteredByAssetGroup.reduce((s, g) => s + g.totalLiabilities, 0)
    const netWorth = totalAssets - totalLiabilities
    return {
      netWorth,
      totalAssets,
      totalLiabilities,
      scope: 'subset' as const,
    }
  }, [data, filterKind, filterAssetGroupId, filterPortfolioIds, filteredByAssetGroup])

  const viewDisplayTotals = useMemo(() => {
    if (!displayTotals || !data) return null
    const from = data.displayCurrency
    const to = (viewCurrencyPreference ?? from).trim().toUpperCase() || from
    const conv = (n: number) => convertAmountViaUsdFx(n, from, to, fxRates, undefined)
    return {
      ...displayTotals,
      netWorth: conv(displayTotals.netWorth),
      totalAssets: conv(displayTotals.totalAssets),
      totalLiabilities: conv(displayTotals.totalLiabilities),
    }
  }, [displayTotals, data, viewCurrencyPreference, fxRates])

  const pieSlicesView = useMemo(() => {
    if (!data) return []
    const from = data.displayCurrency
    const to = (viewCurrencyPreference ?? from).trim().toUpperCase() || from
    return filteredByAssetGroup
      .filter((g) => g.netWorth > 0)
      .map((g, i) => ({
        name: g.name,
        portfolioName: g.portfolioName,
        value: convertAmountViaUsdFx(g.netWorth, from, to, fxRates, undefined),
        fill: g.color?.trim() || COLORS[i % COLORS.length],
      }))
  }, [filteredByAssetGroup, data, viewCurrencyPreference, fxRates])

  const portfolioPieSlicesView = useMemo(() => {
    if (!data) return []
    const from = data.displayCurrency
    const to = (viewCurrencyPreference ?? from).trim().toUpperCase() || from
    return data.byPortfolio
      .filter((p) => matchesPortfolioFilter(p.id))
      .filter((p) => p.netWorth > 0)
      .map((p, i) => ({
        id: p.id,
        name: p.name,
        value: convertAmountViaUsdFx(p.netWorth, from, to, fxRates, undefined),
        fill: p.color?.trim() || COLORS[i % COLORS.length],
      }))
      .sort((a, b) => b.value - a.value)
  }, [data, viewCurrencyPreference, fxRates, filterPortfolioIds])

  const assetTypePieSlicesView = useMemo(() => {
    if (!data) return []
    const from = data.displayCurrency
    const to = (viewCurrencyPreference ?? from).trim().toUpperCase() || from
    const sums = new Map<GroupKind, number>()
    for (const group of filteredByAssetGroup) {
      if (group.netWorth <= 0) continue
      const kind = group.kind as GroupKind
      sums.set(kind, (sums.get(kind) ?? 0) + group.netWorth)
    }
    return GROUP_KIND_ORDER.map((kind: GroupKind, i) => {
      const rawValue = sums.get(kind) ?? 0
      return {
        id: kind,
        name: GROUP_KIND_LABELS[kind],
        value: convertAmountViaUsdFx(rawValue, from, to, fxRates, undefined),
        fill: COLORS[i % COLORS.length],
      }
    })
      .filter((slice) => slice.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [data, filteredByAssetGroup, viewCurrencyPreference, fxRates])

  const assetGroupTableRows = useMemo(() => {
    if (!data) return []
    const from = data.displayCurrency
    const to = (viewCurrencyPreference ?? from).trim().toUpperCase() || from
    return filteredByAssetGroup.map((g) => ({
      ...g,
      totalAssets: convertAmountViaUsdFx(g.totalAssets, from, to, fxRates, undefined),
      totalLiabilities: convertAmountViaUsdFx(g.totalLiabilities, from, to, fxRates, undefined),
      netWorth: convertAmountViaUsdFx(g.netWorth, from, to, fxRates, undefined),
    }))
  }, [filteredByAssetGroup, data, viewCurrencyPreference, fxRates])

  const omittedFromPieCount = useMemo(
    () => filteredByAssetGroup.filter((g) => g.netWorth <= 0).length,
    [filteredByAssetGroup],
  )

  const omittedPortfolioPieCount = useMemo(() => {
    if (!data) return 0
    return data.byPortfolio.filter((p) => matchesPortfolioFilter(p.id)).filter((p) => p.netWorth <= 0).length
  }, [data, filterPortfolioIds])

  const omittedAssetTypePieCount = useMemo(() => {
    const visibleKinds = new Set(filteredByAssetGroup.map((g) => g.kind))
    let omitted = 0
    for (const kind of visibleKinds) {
      const total = filteredByAssetGroup
        .filter((g) => g.kind === kind)
        .reduce((sum, g) => sum + g.netWorth, 0)
      if (total <= 0) omitted += 1
    }
    return omitted
  }, [filteredByAssetGroup])

  const timelineVisibleGroups = useMemo(() => {
    if (!data?.timelineChart) return []
    if (!filterActive) return data.timelineChart.assetGroups
    return filteredByAssetGroup.map((g) => ({
      id: g.id,
      name: g.name,
      portfolioName: g.portfolioName,
      color: g.color,
    }))
  }, [data, filterActive, filteredByAssetGroup])

  const timelineChartData = useMemo(() => {
    if (!data?.timelineChart) return []
    const from = data.displayCurrency
    const to = (viewCurrencyPreference ?? from).trim().toUpperCase() || from
    const conv = (n: number) => convertAmountViaUsdFx(n, from, to, fxRates, undefined)

    if (!filterActive) {
      return data.timelineChart.points.map((p) => ({
        date: p.dateLabel,
        currency: to,
        __total: conv(p.totalNetWorth),
        ...Object.fromEntries(
          Object.entries(p.netWorthByGroupId).map(([k, v]) => {
            const n = typeof v === 'number' && !Number.isNaN(v) ? v : 0
            return [k, conv(n)] as const
          }),
        ),
      }))
    }
    const ids = filteredByAssetGroup.map((g) => g.id)
    return data.timelineChart.points.map((p) => {
      const row: Record<string, string | number> = {
        date: p.dateLabel,
        currency: to,
      }
      let sum = 0
      for (const id of ids) {
        const raw = p.netWorthByGroupId[id]
        const n = typeof raw === 'number' && !Number.isNaN(raw) ? raw : 0
        const c = conv(n)
        row[id] = c
        sum += c
      }
      row.__total = sum
      return row
    })
  }, [data, filterActive, filteredByAssetGroup, viewCurrencyPreference, fxRates])

  const displayPortfolioCount = useMemo(() => {
    if (!data) return 0
    if (!filterActive) return data.counts.portfolios
    if (filteredByAssetGroup.length === 0) return 0
    return new Set(filteredByAssetGroup.map((g) => g.portfolioId)).size
  }, [data, filterActive, filteredByAssetGroup])

  const displayAssetGroupCount = useMemo(() => {
    if (!data) return 0
    if (!filterActive) return data.counts.assetGroups
    return filteredByAssetGroup.length
  }, [data, filterActive, filteredByAssetGroup])

  /** Same as full-document snapshot count when anything is in view; zero when filters exclude every group (no timeline). */
  const displayTimelinePointCount = useMemo(() => {
    if (!data?.timelineChart) return 0
    if (filterActive && filteredByAssetGroup.length === 0) return 0
    return data.timelineChart.points.length
  }, [data, filterActive, filteredByAssetGroup])

  const portfolioFilterSummary = useMemo(() => {
    if (!data || filterPortfolioIds.length === 0) return null
    const names = data.byPortfolio
      .filter((p) => filterPortfolioIds.includes(p.id))
      .map((p) => p.name)
    return names.length ? names.join(', ') : null
  }, [data, filterPortfolioIds])

  const selectAllPortfolios = () => {
    if (!data) return
    setFilterPortfolioIds(data.byPortfolio.map((p) => p.id))
  }

  const clearPortfolioFilter = () => setFilterPortfolioIds([])

  const togglePortfolioInFilter = (id: string) => {
    setFilterPortfolioIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  if (error) return <div className="page-error">{error}</div>
  if (!data || !displayTotals || !viewDisplayTotals) return <div className="page-loading">Loading dashboard…</div>

  const showingConvertedCurrency = viewCurrencyCode !== bookCurrencyCode

  const subtitle =
    displayTotals.scope === 'empty' ? (
      <>No Asset Groups match the current filters. Try another portfolio, type, or Asset Group.</>
    ) : displayTotals.scope === 'all' ? (
      <>
        Current totals combine manual assets and liabilities with the latest real-estate valuation and summed mortgage debt per
        property (latest mark per loan plus any legacy marks). The
        timeline shows <strong>net worth per asset group</strong> over time plus a dashed <strong>total</strong> portfolio line.
      </>
    ) : filterAssetGroupId ? (
      <>
        Showing <strong>{data.byAssetGroup.find((g) => g.id === filterAssetGroupId)?.name ?? 'Asset Group'}</strong>
        {filterKind ? (
          <>
            {' '}
            (<strong>{labelForGroupKind(filterKind)}</strong>)
          </>
        ) : null}
        {portfolioFilterSummary ? (
          <>
            {' '}
            in <strong>{portfolioFilterSummary}</strong>
          </>
        ) : null}
        : assets, liabilities, net worth, pie, and timeline for that Asset Group only (dashed line is the filtered total).
      </>
    ) : filterKind ? (
      <>
        Showing all <strong>{GROUP_KIND_LABELS[filterKind]}</strong> Asset Groups ({filteredByAssetGroup.length}{' '}
        {filteredByAssetGroup.length === 1 ? 'Asset Group' : 'Asset Groups'})
        {portfolioFilterSummary ? (
          <>
            {' '}
            in <strong>{portfolioFilterSummary}</strong>
          </>
        ) : null}
        . Totals, pie, and timeline include only those groups; the dashed line is their combined net worth.
      </>
    ) : portfolioFilterSummary ? (
      <>
        Showing Asset Groups in <strong>{portfolioFilterSummary}</strong> ({filteredByAssetGroup.length}{' '}
        {filteredByAssetGroup.length === 1 ? 'group' : 'groups'}). Totals, pie, and timeline match this selection.
      </>
    ) : null

  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
        <details className="dashboard-filters-drawer">
          <summary className="dashboard-filters-drawer__summary" aria-label="Show or hide dashboard filters">
            <span className="dashboard-filters-drawer__summary-text">
              {filterActive ? 'Filters · active' : 'Filters'}
            </span>
          </summary>
          <div className="dashboard-filters">
          <div className="dashboard-filters__row">
            <div className="dashboard-filters__portfolio-wrap">
              <span className="dashboard-filters__field-label" id="dashboard-portfolio-filter-label">
                Portfolios
              </span>
              <details className="dashboard-portfolio-filter" aria-labelledby="dashboard-portfolio-filter-label">
                <summary aria-label="Open portfolio filter. Use checkboxes to include one or more portfolios.">
                  {filterPortfolioIds.length === 0
                    ? 'All portfolios'
                    : portfolioFilterSummary ?? `${filterPortfolioIds.length} selected`}
                </summary>
                <div className="dashboard-portfolio-filter__panel" role="group" aria-label="Portfolio filter">
                  <div className="dashboard-portfolio-filter__actions">
                    <button type="button" onClick={selectAllPortfolios}>
                      Select all
                    </button>
                    <button type="button" onClick={clearPortfolioFilter}>
                      Clear
                    </button>
                  </div>
                  {portfolioOptions.map((p) => (
                    <label key={p.id} className="dashboard-portfolio-filter__option">
                      <input
                        type="checkbox"
                        checked={filterPortfolioIds.includes(p.id)}
                        onChange={() => togglePortfolioInFilter(p.id)}
                      />
                      <span>{p.name}</span>
                    </label>
                  ))}
                </div>
              </details>
            </div>
          </div>
          <div className="dashboard-filters__row dashboard-filters__row--triple">
            <label>
              Type
              <select
                value={filterKind}
                onChange={(e) => setFilterKind((e.target.value || '') as GroupKind | '')}
                aria-label="Filter dashboard by Asset Group type"
              >
                <option value="">All types</option>
                {GROUP_KIND_ORDER.map((k) => (
                  <option key={k} value={k}>
                    {GROUP_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Asset group
              <select
                value={filterAssetGroupId}
                onChange={(e) => setFilterAssetGroupId(e.target.value)}
                aria-label="Filter dashboard by Asset Group"
              >
                <option value="">All Asset Groups{filterKind ? ` (${GROUP_KIND_LABELS[filterKind]})` : ''}</option>
                {assetGroupOptions.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.portfolioName ? `${g.name} (${g.portfolioName})` : g.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Display currency
              <select
                value={displayCurrencySelectValue}
                onChange={(e) => {
                  const v = e.target.value
                  setViewCurrencyPreference(v === '__default__' ? null : v)
                }}
                aria-label="Currency used for dashboard amounts and charts"
              >
                {displayCurrencySelectOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          </div>
        </details>
      </div>
      <p className="page-subtitle">{subtitle}</p>
      {showingConvertedCurrency ? (
        <p className="inline-hint" style={{ marginTop: '-0.25rem', marginBottom: '0.75rem' }}>
          Amounts are shown in <strong>{viewCurrencyCode}</strong>, converted from aggregated totals (
          <strong>{bookCurrencyCode}</strong>) using the latest USD-quoted FX rows in your document.
        </p>
      ) : null}

      <div className="summary-grid">
        <div className="summary-card highlight">
          <span className="label">
            {displayTotals.scope === 'all'
              ? 'Net Worth'
              : displayTotals.scope === 'empty'
                ? 'Net worth (filtered)'
                : filterAssetGroupId
                  ? 'Net worth (this Asset Group)'
                  : 'Net worth (filtered)'}
          </span>
          <strong className={viewDisplayTotals.netWorth >= 0 ? 'positive' : 'negative'}>
            {fmtMoney(viewDisplayTotals.netWorth, viewCurrencyCode)}
          </strong>
        </div>
        <div className="summary-card">
          <span className="label">
            {displayTotals.scope === 'all' ? 'Total Assets' : filterAssetGroupId ? 'Assets (this Asset Group)' : 'Assets (filtered)'}
          </span>
          <strong className="positive">{fmtMoney(viewDisplayTotals.totalAssets, viewCurrencyCode)}</strong>
        </div>
        <div className="summary-card">
          <span className="label">
            {displayTotals.scope === 'all'
              ? 'Total Liabilities'
              : filterAssetGroupId
                ? 'Liabilities (this Asset Group)'
                : 'Liabilities (filtered)'}
          </span>
          <strong
            className={viewDisplayTotals.totalLiabilities === 0 ? 'amount-zero' : 'negative'}
          >
            {fmtMoney(viewDisplayTotals.totalLiabilities, viewCurrencyCode)}
          </strong>
        </div>
        <div className="summary-card summary-card--compact-counter">
          <span className="label">{filterActive ? 'Portfolios in view' : 'Portfolios'}</span>
          <strong>{displayPortfolioCount}</strong>
        </div>
        <div className="summary-card summary-card--compact-counter">
          <span className="label">{filterActive ? 'Asset groups in view' : 'Asset groups'}</span>
          <strong>{displayAssetGroupCount}</strong>
        </div>
        <div className="summary-card summary-card--compact-counter">
          <span className="label">Timeline points</span>
          <strong>{displayTimelinePointCount}</strong>
        </div>
      </div>

      <div className="panel-grid">
        {data.byPortfolio.length > 0 ? (
          <div className="panel">
            <h2>{filterPortfolioIds.length > 0 ? 'Net worth by portfolio (filtered)' : 'Net worth by portfolio'}</h2>
            {portfolioPieSlicesView.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={portfolioPieSlicesView}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="46%"
                      innerRadius={52}
                      outerRadius={88}
                      paddingAngle={1}
                      label={({ name, percent }) => {
                        const pct = typeof percent === 'number' ? percent : 0
                        return `${name} (${(pct * 100).toFixed(0)}%)`
                      }}
                    >
                      {portfolioPieSlicesView.map((entry) => (
                        <Cell key={entry.id} fill={entry.fill} stroke="var(--panel-bg, #fff)" strokeWidth={1} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ payload }) => {
                        if (!payload?.length) return null
                        const entry = payload[0]
                        const total = portfolioPieSlicesView.reduce((s, p) => s + p.value, 0)
                        const pct = total > 0 ? `${((Number(entry.value) / total) * 100).toFixed(0)}%` : ''
                        return (
                          <div style={{ background: 'var(--panel-bg, #fff)', border: '1px solid #e2e8f0', padding: '4px 10px', borderRadius: 4, fontSize: 13 }}>
                            {`${String(entry.name)}  ${fmtMoney(Number(entry.value), viewCurrencyCode)}  ${pct}`}
                          </div>
                        )
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {omittedPortfolioPieCount > 0 ? (
                  <p className="inline-hint" style={{ marginTop: '0.5rem' }}>
                    {omittedPortfolioPieCount} portfolio{omittedPortfolioPieCount === 1 ? '' : 's'} with zero or lower net worth omitted from this chart.
                  </p>
                ) : null}
              </>
            ) : (
              <div className="empty-state" style={{ padding: '1.5rem 0' }}>
                No portfolios in this view have a positive net worth, so there is nothing to chart.
              </div>
            )}
          </div>
        ) : (
          <div className="panel empty-state">
            No portfolios yet. Create a portfolio to see net worth split here.
          </div>
        )}

        {filteredByAssetGroup.length > 0 ? (
          <div className="panel">
            <h2>{filterActive ? 'Net worth by asset type (filtered)' : 'Net worth by asset type'}</h2>
            {assetTypePieSlicesView.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={assetTypePieSlicesView}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="46%"
                      innerRadius={52}
                      outerRadius={88}
                      paddingAngle={1}
                      label={({ name, percent }) => {
                        const pct = typeof percent === 'number' ? percent : 0
                        return `${name} (${(pct * 100).toFixed(0)}%)`
                      }}
                    >
                      {assetTypePieSlicesView.map((entry) => (
                        <Cell key={entry.id} fill={entry.fill} stroke="var(--panel-bg, #fff)" strokeWidth={1} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ payload }) => {
                        if (!payload?.length) return null
                        const entry = payload[0]
                        const total = assetTypePieSlicesView.reduce((s, p) => s + p.value, 0)
                        const pct = total > 0 ? `${((Number(entry.value) / total) * 100).toFixed(0)}%` : ''
                        return (
                          <div style={{ background: 'var(--panel-bg, #fff)', border: '1px solid #e2e8f0', padding: '4px 10px', borderRadius: 4, fontSize: 13 }}>
                            {`${String(entry.name)}  ${fmtMoney(Number(entry.value), viewCurrencyCode)}  ${pct}`}
                          </div>
                        )
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {omittedAssetTypePieCount > 0 ? (
                  <p className="inline-hint" style={{ marginTop: '0.5rem' }}>
                    {omittedAssetTypePieCount} asset type{omittedAssetTypePieCount === 1 ? '' : 's'} with zero or lower net worth omitted from this chart.
                  </p>
                ) : null}
              </>
            ) : (
              <div className="empty-state" style={{ padding: '1.5rem 0' }}>
                No asset types in this view have a positive net worth, so there is nothing to chart.
              </div>
            )}
          </div>
        ) : data.byAssetGroup.length > 0 ? (
          <div className="panel empty-state">No Asset Groups match these filters.</div>
        ) : (
          <div className="panel empty-state">
            No Asset Groups yet. Create a portfolio, add an Asset Group, then add positions or balances.
          </div>
        )}

        {filteredByAssetGroup.length > 0 ? (
          <div className="panel">
            <h2>{filterActive ? 'Net worth by Asset Group (filtered)' : 'Net worth by Asset Group'}</h2>
            {pieSlicesView.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={pieSlicesView}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="46%"
                      innerRadius={52}
                      outerRadius={88}
                      paddingAngle={1}
                      label={({ name, percent }) => {
                        const pct = typeof percent === 'number' ? percent : 0
                        return `${name} (${(pct * 100).toFixed(0)}%)`
                      }}
                    >
                      {pieSlicesView.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} stroke="var(--panel-bg, #fff)" strokeWidth={1} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ payload }) => {
                        if (!payload?.length) return null
                        const entry = payload[0]
                        const slice = entry.payload as { name: string; portfolioName: string }
                        const total = pieSlicesView.reduce((s, p) => s + p.value, 0)
                        const pct = total > 0 ? `${((Number(entry.value) / total) * 100).toFixed(0)}%` : ''
                        return (
                          <div style={{ background: 'var(--panel-bg, #fff)', border: '1px solid #e2e8f0', padding: '4px 10px', borderRadius: 4, fontSize: 13 }}>
                            {`${slice.portfolioName} | ${slice.name}  ${fmtMoney(Number(entry.value), viewCurrencyCode)}  ${pct}`}
                          </div>
                        )
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {omittedFromPieCount > 0 ? (
                  <p className="inline-hint" style={{ marginTop: '0.5rem' }}>
                    {omittedFromPieCount} asset group{omittedFromPieCount === 1 ? '' : 's'} with zero or lower net worth omitted from this chart.
                  </p>
                ) : null}
              </>
            ) : (
              <div className="empty-state" style={{ padding: '1.5rem 0' }}>
                No Asset Groups in this view have a positive net worth, so there is nothing to chart. Use the summary table for
                amounts.
              </div>
            )}
          </div>
        ) : data.byAssetGroup.length > 0 ? (
          <div className="panel empty-state">No Asset Groups match these filters.</div>
        ) : (
          <div className="panel empty-state">
            No Asset Groups yet. Create a portfolio, add an Asset Group, then add positions or balances.
          </div>
        )}

        {timelineChartData.length > 0 ? (
          timelineVisibleGroups.length > 0 ? (
            <div className="panel">
              <h2>{filterActive ? 'Net worth timeline (filtered)' : 'Net worth timeline'}</h2>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={timelineChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  {!isMobile ? (
                    <Tooltip
                      formatter={(v, name) => {
                        const n = Number(v)
                        return [fmtMoney(n, viewCurrencyCode), typeof name === 'string' ? name : 'Value']
                      }}
                    />
                  ) : null}
                  <Legend wrapperStyle={{ fontSize: '0.78rem' }} />
                  {timelineVisibleGroups.map((g, i) => (
                    <Line
                      key={g.id}
                      type="monotone"
                      dataKey={g.id}
                      name={g.portfolioName ? `${g.portfolioName} — ${g.name}` : g.name}
                      stroke={g.color?.trim() || COLORS[i % COLORS.length]}
                      strokeWidth={1.75}
                      dot={false}
                      connectNulls
                    />
                  ))}
                  {(!filterActive || timelineVisibleGroups.length > 1) && (
                    <Line
                      type="monotone"
                      dataKey="__total"
                      name={filterActive ? 'Filtered total' : 'Total'}
                      stroke="#94a3b8"
                      strokeWidth={2}
                      strokeDasharray="6 4"
                      dot={false}
                      connectNulls
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="panel empty-state">No Asset Groups match these filters, so there is no timeline to show.</div>
          )
        ) : (
          <div className="panel empty-state">
            No timeline points yet. Add property valuations, security marks or trades, or other asset marks to build a dated
            series; with no marks you still get a single point for today from current balances.
          </div>
        )}
      </div>

      {filteredByAssetGroup.length > 0 && (
        <div className="panel">
          <h2>{filterActive ? 'Asset group summary (filtered)' : 'Asset group summary'}</h2>
          <table>
            <thead>
              <tr>
                <th>Portfolio</th>
                <th>Asset group</th>
                <th>Gross value</th>
                <th>Net Worth</th>
              </tr>
            </thead>
            <tbody>
              {assetGroupTableRows.map((g, i) => {
                const groupColor = g.color?.trim() || COLORS[i % COLORS.length]
                return (
                <tr key={g.id}>
                  <td>
                    <span className="dashboard-portfolio-cell">
                      <span className="dashboard-portfolio-cell__icon">
                        <GroupNavGlyph iconId={resolvePortfolioNavIconId(g.portfolioIcon)} title="Portfolio" />
                      </span>
                      <span>{g.portfolioName}</span>
                    </span>
                  </td>
                  <td>
                    <Link className="dashboard-asset-group-cell dashboard-asset-group-cell--link" to={assetGroupHubPath(g.portfolioId, g.id)}>
                      <span className="dashboard-asset-group-cell__icon" style={{ color: groupColor }}>
                        <GroupNavGlyph
                          iconId={resolveGroupNavIconId(g.kind)}
                          title={labelForGroupKind(g.kind)}
                        />
                      </span>
                      <span>{g.name}</span>
                    </Link>
                  </td>
                  <td>
                    <div className="positive">{fmtMoney(g.totalAssets, viewCurrencyCode)}</div>
                    {g.totalLiabilities !== 0 ? (
                      <div className="negative" style={{ fontSize: '0.85em', marginTop: '0.15rem' }}>
                        {fmtMoney(g.totalLiabilities, viewCurrencyCode)} liabilities
                      </div>
                    ) : null}
                  </td>
                  <td className={g.netWorth >= 0 ? 'positive' : 'negative'}>{fmtMoney(g.netWorth, viewCurrencyCode)}</td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
