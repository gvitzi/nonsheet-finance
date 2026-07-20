import { useCallback, useEffect, useMemo, useState, type ReactNode, type SyntheticEvent } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { mortgageDebtContributionsAsOf } from '@nonsheet-finance/core'
import { ApiError, api } from '../api'
import type { AssetGroup, Property, PropertyMortgageEntry, PropertyValuation } from '../api'
import { assetGroupEditPath, assetGroupPropertyPath } from '../portfolioPaths'
import { useDisplayMoney } from '../useDisplayMoney'
import StatsPanel from './StatsPanel'

const fmt = (n: number, currency = 'EUR') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)

const CHART_PALETTE = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
]
const TOTAL_LINE_KEY = '__totalPropertyValue'
const TOTAL_LINE_STROKE = '#94a3b8'

const fmtMonthly = (n: number | null | undefined) =>
  n != null && !Number.isNaN(n) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n) : '—'

function err(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return fallback
}

function latestByDate<T extends { date: string }>(rows: T[]): T | undefined {
  if (!rows.length) return undefined
  return [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
}

type Row = Property & { latestValuation?: PropertyValuation | null; valuations: PropertyValuation[]; mortgageEntries: PropertyMortgageEntry[] }

function mortgageDebtDisplay(mgs: PropertyMortgageEntry[]): string {
  const cont = mortgageDebtContributionsAsOf(
    mgs.map((m) => ({
      date: m.date,
      loanId: m.loanId,
      outstandingBalance: m.outstandingBalance,
      currency: m.currency,
    })),
    new Date(),
  )
  if (!cont.length) return '—'
  const curs = new Set(cont.map((c) => c.currency))
  if (curs.size === 1) return fmt(cont.reduce((s, c) => s + c.value, 0), cont[0]!.currency)
  return 'Various currencies'
}

function getPropertyListMetrics(p: Row) {
  const value = p.latestValuation ? fmt(p.latestValuation.value, p.latestValuation.currency) : '—'
  const liabilities = mortgageDebtDisplay(p.mortgageEntries)
  let netValue = '—'
  let netValueClass: string | undefined
  if (p.latestValuation) {
    const v0 = p.latestValuation
    const cont = mortgageDebtContributionsAsOf(
      p.mortgageEntries.map((m) => ({
        date: m.date,
        loanId: m.loanId,
        outstandingBalance: m.outstandingBalance,
        currency: m.currency,
      })),
      new Date(),
    )
    if (cont.length === 0) {
      netValue = fmt(v0.value, v0.currency)
      netValueClass = v0.value >= 0 ? 'positive' : 'negative'
    } else if (cont.every((c) => c.currency === v0.currency)) {
      const debtSum = cont.reduce((s, c) => s + c.value, 0)
      const net = v0.value - debtSum
      netValue = fmt(net, v0.currency)
      netValueClass = net >= 0 ? 'positive' : 'negative'
    }
  }
  const cashflowClass =
    p.monthlyCashflow == null || Number.isNaN(p.monthlyCashflow)
      ? undefined
      : p.monthlyCashflow >= 0
        ? 'positive'
        : 'negative'
  return {
    value,
    liabilities,
    netValue,
    netValueClass,
    rent: fmtMonthly(p.effectiveMonthlyRent),
    mortgagePayment: (() => {
      const rentTotal = p.effectiveMonthlyRent + p.effectiveMonthlyHausgeld
      if (p.monthlyCashflow != null && !Number.isNaN(p.monthlyCashflow)) {
        return fmtMonthly(rentTotal - p.monthlyCashflow)
      }
      return fmtMonthly(p.monthlyMortgagePayment)
    })(),
    cashflow: fmtMonthly(p.monthlyCashflow),
    cashflowClass,
  }
}

function RePropertyStat({ label, children, valueClass }: { label: string; children: ReactNode; valueClass?: string }) {
  return (
    <>
      <dt className="re-property-card__dt">{label}</dt>
      <dd className={['re-property-card__dd', valueClass].filter(Boolean).join(' ')}>{children}</dd>
    </>
  )
}

type Props = {
  group: AssetGroup
  portfolioId: string
  assetGroupId: string
}

const emptyForm = {
  name: '',
  description: '',
  notes: '',
  address: '',
  monthlyMortgagePayment: '',
}

export default function RealEstateAggregate({ group, portfolioId, assetGroupId }: Props) {
  const { displayCurrency, convert } = useDisplayMoney()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [chartsOpen, setChartsOpen] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setBanner(null)
    try {
      const list = await api.properties.list(assetGroupId, showArchived)
      const enriched = await Promise.all(
        list.map(async (p) => {
          const [vals, mgs] = await Promise.all([
            api.properties.listValuations(p.id),
            api.properties.listMortgageEntries(p.id),
          ])
          return {
            ...p,
            latestValuation: latestByDate(vals) ?? null,
            valuations: vals,
            mortgageEntries: mgs,
          }
        }),
      )
      setRows(enriched)
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to load properties.') })
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [assetGroupId, showArchived])

  useEffect(() => {
    load()
  }, [load])

  const statsItems = useMemo(
    () =>
      rows.map((p) => {
        const v = p.latestValuation?.value ?? 0
        const vCur = p.latestValuation?.currency ?? 'USD'
        const cont = mortgageDebtContributionsAsOf(
          p.mortgageEntries.map((m) => ({
            date: m.date,
            loanId: m.loanId,
            outstandingBalance: m.outstandingBalance,
            currency: m.currency,
          })),
          new Date(),
        )
        const debtSum = cont.reduce((s, c) => s + convert(c.value, c.currency), 0)
        const net = convert(v, vCur) - debtSum
        return { id: p.id, name: p.name, value: Math.max(0, net) }
      }),
    [rows, convert],
  )

  const propertyTimeline = useMemo(() => {
    const allDates = [...new Set(rows.flatMap((p) => p.valuations.map((v) => v.date)))].sort()
    if (allDates.length === 0) return { data: [], keys: [] as string[] }

    const withHistory = rows
      .filter((p) => p.valuations.length > 0)
      .map((p) => ({
        name: p.name,
        points: [...p.valuations].sort((a, b) => a.date.localeCompare(b.date)),
      }))
    const keys = withHistory.map((p) => p.name)

    const valueOnOrBefore = (points: PropertyValuation[], date: string): number | null => {
      let last: PropertyValuation | null = null
      for (const p of points) {
        if (p.date <= date) last = p
        else break
      }
      return last ? convert(last.value, last.currency) : null
    }

    const data = allDates.map((date) => {
      const point: Record<string, string | number> = { date }
      let total = 0
      for (const p of withHistory) {
        const v = valueOnOrBefore(p.points, date)
        if (v != null && !Number.isNaN(v)) {
          point[p.name] = v
          total += v
        }
      }
      point[TOTAL_LINE_KEY] = total
      return point
    })

    return { data, keys }
  }, [rows, convert])

  const aggregateTimeline = useMemo(() => {
    const allDates = [...new Set(rows.flatMap((p) => [...p.valuations.map((v) => v.date), ...p.mortgageEntries.map((m) => m.date)]))].sort()
    if (allDates.length === 0) return [] as Array<Record<string, string | number>>

    const latestValuationOnOrBefore = (vals: PropertyValuation[], date: string): PropertyValuation | null => {
      let last: PropertyValuation | null = null
      for (const v of [...vals].sort((a, b) => a.date.localeCompare(b.date))) {
        if (v.date <= date) last = v
        else break
      }
      return last
    }

    return allDates.map((date) => {
      let gross = 0
      let liabilities = 0
      for (const p of rows) {
        const v = latestValuationOnOrBefore(p.valuations, date)
        if (v) gross += convert(v.value, v.currency)
        const debt = mortgageDebtContributionsAsOf(
          p.mortgageEntries
            .filter((m) => m.date <= date)
            .map((m) => ({
              date: m.date,
              loanId: m.loanId,
              outstandingBalance: m.outstandingBalance,
              currency: m.currency,
            })),
          new Date(date),
        )
        for (const d of debt) liabilities += convert(d.value, d.currency)
      }
      return {
        date,
        gross,
        liabilities,
        netWorth: gross - liabilities,
      }
    })
  }, [rows, convert])

  const tableTotals = useMemo(() => {
    let sumValue = 0
    let sumDebt = 0
    let sumRent = 0
    let sumMortgage = 0
    let sumCashflow = 0
    let cashflowMissing = false

    for (const p of rows) {
      const v = p.latestValuation
      if (v) sumValue += convert(v.value, v.currency)

      const cont = mortgageDebtContributionsAsOf(
        p.mortgageEntries.map((m) => ({
          date: m.date,
          loanId: m.loanId,
          outstandingBalance: m.outstandingBalance,
          currency: m.currency,
        })),
        new Date(),
      )
      for (const c of cont) sumDebt += convert(c.value, c.currency)

      sumRent += p.effectiveMonthlyRent

      const rentTotal = p.effectiveMonthlyRent + p.effectiveMonthlyHausgeld
      if (p.monthlyCashflow != null && !Number.isNaN(p.monthlyCashflow)) {
        sumMortgage += rentTotal - p.monthlyCashflow
      } else if (p.monthlyMortgagePayment != null && !Number.isNaN(p.monthlyMortgagePayment)) {
        sumMortgage += p.monthlyMortgagePayment
      }

      if (p.monthlyCashflow != null && !Number.isNaN(p.monthlyCashflow)) {
        sumCashflow += p.monthlyCashflow
      } else {
        cashflowMissing = true
      }
    }

    const net = sumValue - sumDebt
    const curTitle = `Totals converted to ${displayCurrency} (value, liabilities, net). Rent and monthly columns are summed in EUR.`

    return {
      value: fmt(sumValue, displayCurrency),
      liabilities: fmt(sumDebt, displayCurrency),
      net: fmt(net, displayCurrency),
      netClass: net >= 0 ? 'positive' : 'negative',
      rent: fmtMonthly(sumRent),
      mortgage: fmtMonthly(sumMortgage),
      cashflow: cashflowMissing ? '—' : fmtMonthly(sumCashflow),
      cashflowClass: cashflowMissing ? undefined : sumCashflow >= 0 ? 'positive' : 'negative',
      title: curTitle,
    }
  }, [rows, convert, displayCurrency])

  const validation = useMemo(() => {
    if (!form.name.trim()) return 'Property name is required.'
    const nr = (v: string) => (v.trim() === '' ? null : Number(v))
    const n = nr(form.monthlyMortgagePayment)
    if (n !== null && Number.isNaN(n)) return 'Mortgage payment must be a number when provided.'
    return null
  }, [form])

  const parseOptionalMoney = (s: string) => {
    const t = s.trim()
    if (!t) return null
    const n = parseFloat(t)
    return Number.isNaN(n) ? null : n
  }

  const createProperty = async () => {
    if (validation) {
      setBanner({ type: 'err', text: validation })
      return
    }
    setSaving(true)
    setBanner(null)
    try {
      await api.properties.create({
        assetGroupId,
        name: form.name.trim(),
        description: form.description.trim() || null,
        notes: form.notes.trim() || null,
        address: form.address.trim() || null,
        monthlyMortgagePayment: parseOptionalMoney(form.monthlyMortgagePayment),
      })
      setBanner({ type: 'ok', text: 'Property created.' })
      setForm(emptyForm)
      setCreating(false)
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to create property.') })
    } finally {
      setSaving(false)
    }
  }

  const unarchiveProperty = async (id: string) => {
    try {
      await api.properties.unarchive(id)
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to unarchive property.') })
    }
  }

  if (loading) return <div className="page-loading">Loading properties…</div>

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Real estate</p>
          <h1>{group.name}</h1>
          <p className="page-subtitle">
            All properties in this group. Liabilities sum the latest mortgage mark per loan (and legacy marks). Rent follows the
            rent period that contains today (set on each property page). Cashflow uses per-loan payments when configured.
          </p>
        </div>
        <Link className="btn" to={assetGroupEditPath(portfolioId, assetGroupId)}>
          Edit Asset Group
        </Link>
      </div>

      {banner?.type === 'err' ? <div className="page-error">{banner.text}</div> : null}
      {banner?.type === 'ok' ? <div className="page-success">{banner.text}</div> : null}

      <StatsPanel assetGroupId={assetGroupId} displayCurrency={displayCurrency} items={statsItems} />

      <div className="property-accordions" role="presentation">
        <details className="property-accordion" open={chartsOpen} onToggle={(e: SyntheticEvent<HTMLDetailsElement>) => setChartsOpen(e.currentTarget.open)}>
          <summary className="property-accordion__summary">
            <span className="property-accordion__title">Charts</span>
          </summary>
          <div className="property-accordion__body stack">
            {propertyTimeline.data.length > 0 ? (
              <div className="panel">
                <h2>Property values over time</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={propertyTimeline.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(Number(v), displayCurrency)} width={90} />
                    <Tooltip formatter={(v, name) => [fmt(Number(v), displayCurrency), name]} labelStyle={{ fontWeight: 600 }} />
                    <Legend />
                    {propertyTimeline.keys.map((key, i) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    ))}
                    <Line
                      type="monotone"
                      name="Total"
                      dataKey={TOTAL_LINE_KEY}
                      stroke={TOTAL_LINE_STROKE}
                      strokeWidth={2}
                      strokeDasharray="6 4"
                      dot={false}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : null}

            {aggregateTimeline.length > 0 ? (
              <div className="panel">
                <h2>Gross value, liabilities, and net worth</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={aggregateTimeline}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(Number(v), displayCurrency)} width={90} />
                    <Tooltip formatter={(v, name) => [fmt(Number(v), displayCurrency), String(name)]} labelStyle={{ fontWeight: 600 }} />
                    <Legend />
                    <Line type="monotone" dataKey="gross" name="Gross value" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
                    <Line type="monotone" dataKey="liabilities" name="Liabilities" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls />
                    <Line type="monotone" dataKey="netWorth" name="Net worth" stroke="#10b981" strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : null}
          </div>
        </details>
      </div>

      <div className="page-header">
        <h2>Properties</h2>
        <div className="page-header__actions">
          <button
            className={`btn btn-sm${showArchived ? ' btn-active' : ''}`}
            type="button"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
          <button className="btn btn-primary" type="button" onClick={() => setCreating((c) => !c)}>
            {creating ? 'Close form' : '+ New property'}
          </button>
        </div>
      </div>

      {creating && (
        <div className="form-panel">
          <h3>New property</h3>
          <div className="form-grid">
            <label className="span-2">
              Name *
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="span-2">
              Description (single line)
              <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </label>
            <label className="span-2">
              Notes
              <textarea rows={4} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </label>
            <label className="span-2">
              Address
              <textarea rows={2} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </label>
            <label>
              Mortgage monthly payment
              <input
                type="number"
                step="0.01"
                value={form.monthlyMortgagePayment}
                onChange={(e) => setForm((f) => ({ ...f, monthlyMortgagePayment: e.target.value }))}
              />
            </label>
          </div>
          {validation ? <p className="inline-hint inline-error">{validation}</p> : null}
          <div className="form-actions">
            <button className="btn btn-primary" type="button" onClick={createProperty} disabled={Boolean(validation) || saving}>
              {saving ? 'Saving…' : 'Create property'}
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty-state">No properties yet. Add one to track valuations, mortgage, and rent periods over time.</div>
      ) : (
        <>
          <div className="re-property-cards" role="list" aria-label="Properties">
            {rows.map((p) => {
              const m = getPropertyListMetrics(p)
              return (
                <article
                  key={p.id}
                  className={`re-property-card${p.archivedAt ? ' re-property-card--archived' : ''}`}
                  role="listitem"
                >
                  <div className="re-property-card__head">
                    <span className="re-property-card__title">{p.name}</span>
                    {p.description?.trim() ? <p className="re-property-card__subtitle">{p.description.trim()}</p> : null}
                  </div>
                  <dl className="re-property-card__dl">
                    <RePropertyStat label="Value" valueClass="positive">
                      {m.value}
                    </RePropertyStat>
                    <RePropertyStat label="Liabilities" valueClass="negative">
                      {m.liabilities}
                    </RePropertyStat>
                    <RePropertyStat label="Net value" valueClass={m.netValueClass}>
                      {m.netValue}
                    </RePropertyStat>
                    <RePropertyStat label="Rent (monthly)">{m.rent}</RePropertyStat>
                    <RePropertyStat label="Mortgage monthly payment">{m.mortgagePayment}</RePropertyStat>
                    <RePropertyStat label="Net cashflow" valueClass={m.cashflowClass}>
                      {m.cashflow}
                    </RePropertyStat>
                  </dl>
                  <div className="re-property-card__actions">
                    <Link
                      className="btn btn-sm btn-primary"
                      to={assetGroupPropertyPath(portfolioId, assetGroupId, p.id)}
                      aria-label={`View ${p.name}`}
                    >
                      View
                    </Link>
                    {p.archivedAt ? (
                      <button className="btn btn-sm" type="button" onClick={() => unarchiveProperty(p.id)}>
                        Unarchive
                      </button>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>

          <div className="re-property-table-wrap">
            <table className="table re-property-table--desktop">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Value</th>
                  <th>Liabilities</th>
                  <th>Net Value</th>
                  <th>Rent</th>
                  <th>Mortgage monthly payment</th>
                  <th>Net cashflow</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const m = getPropertyListMetrics(p)
                  return (
                    <tr key={p.id} className={p.archivedAt ? 'row--archived' : undefined}>
                      <td>
                        <div className="property-table-name">
                          <span className="property-table-name__text">{p.name}</span>
                          {p.description?.trim() ? (
                            <span className="property-table-name__meta">{p.description.trim()}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="positive">{m.value}</td>
                      <td className="negative">{m.liabilities}</td>
                      <td className={m.netValueClass}>{m.netValue}</td>
                      <td>{m.rent}</td>
                      <td>{m.mortgagePayment}</td>
                      <td className={m.cashflowClass}>{m.cashflow}</td>
                      <td className="actions">
                        <Link
                          className="btn btn-sm btn-primary"
                          to={assetGroupPropertyPath(portfolioId, assetGroupId, p.id)}
                          aria-label={`View ${p.name}`}
                        >
                          View
                        </Link>
                        {p.archivedAt ? (
                          <button className="btn btn-sm" type="button" onClick={() => unarchiveProperty(p.id)}>
                            Unarchive
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="re-property-table-footer">
                <tr>
                  <th scope="row">Totals</th>
                  <td className="positive" title={tableTotals.title}>
                    {tableTotals.value}
                  </td>
                  <td className="negative" title={tableTotals.title}>
                    {tableTotals.liabilities}
                  </td>
                  <td className={tableTotals.netClass} title={tableTotals.title}>
                    {tableTotals.net}
                  </td>
                  <td title="Sum of monthly rent (EUR)">{tableTotals.rent}</td>
                  <td title="Sum of implied or stored mortgage payments (EUR)">{tableTotals.mortgage}</td>
                  <td className={tableTotals.cashflowClass} title="Sum of stored net cashflow when every property has it">
                    {tableTotals.cashflow}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
