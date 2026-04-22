import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../api'
import type { AssetGroup, Property, PropertyMortgageEntry, PropertyValuation } from '../api'
import { assetGroupEditPath, assetGroupPropertyPath } from '../portfolioPaths'
import { useDisplayMoney } from '../useDisplayMoney'
import StatsPanel from './StatsPanel'

const fmt = (n: number, currency = 'EUR') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)

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

type Row = Property & { latestValuation?: PropertyValuation | null; latestMortgage?: PropertyMortgageEntry | null }

type Props = {
  group: AssetGroup
  portfolioId: string
  assetGroupId: string
}

const emptyForm = {
  name: '',
  description: '',
  notes: '',
  monthlyRent: '',
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
            latestMortgage: latestByDate(mgs) ?? null,
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
        const m = p.latestMortgage?.outstandingBalance ?? 0
        const mCur = p.latestMortgage?.currency ?? 'USD'
        const net = convert(v, vCur) - convert(m, mCur)
        return { id: p.id, name: p.name, value: Math.max(0, net) }
      }),
    [rows, convert],
  )

  const validation = useMemo(() => {
    if (!form.name.trim()) return 'Property name is required.'
    const nr = (v: string) => (v.trim() === '' ? null : Number(v))
    for (const key of ['monthlyRent', 'monthlyMortgagePayment'] as const) {
      const n = nr(form[key])
      if (n !== null && Number.isNaN(n)) return 'Monthly amounts must be numbers when provided.'
    }
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
        monthlyRent: parseOptionalMoney(form.monthlyRent),
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

  const archiveProperty = async (id: string) => {
    try {
      await api.properties.archive(id)
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to archive property.') })
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
            All properties in this group. Value and liabilities follow the latest valuation and mortgage rows. Monthly rent
            and mortgage payment are stored per property; cashflow is rent minus mortgage payment.
          </p>
        </div>
        <Link className="btn" to={assetGroupEditPath(portfolioId, assetGroupId)}>
          Edit Asset Group
        </Link>
      </div>

      {banner?.type === 'err' ? <div className="page-error">{banner.text}</div> : null}
      {banner?.type === 'ok' ? <div className="page-success">{banner.text}</div> : null}

      <StatsPanel assetGroupId={assetGroupId} displayCurrency={displayCurrency} items={statsItems} />

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
            <label>
              Rent (monthly)
              <input type="number" step="0.01" value={form.monthlyRent} onChange={(e) => setForm((f) => ({ ...f, monthlyRent: e.target.value }))} />
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
        <div className="empty-state">No properties yet. Add one to track valuations and mortgage over time.</div>
      ) : (
        <table className="table">
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
            {rows.map((p) => (
              <tr key={p.id} className={p.archivedAt ? 'row--archived' : undefined}>
                <td>
                  <div className="property-table-name">
                    <Link className="property-table-name__link" to={assetGroupPropertyPath(portfolioId, assetGroupId, p.id)}>
                      {p.name}
                    </Link>
                    {p.description?.trim() ? (
                      <span className="property-table-name__meta">{p.description.trim()}</span>
                    ) : null}
                  </div>
                </td>
                <td className="positive">
                  {p.latestValuation ? fmt(p.latestValuation.value, p.latestValuation.currency) : '—'}
                </td>
                <td className="negative">
                  {p.latestMortgage ? fmt(p.latestMortgage.outstandingBalance, p.latestMortgage.currency) : '—'}
                </td>
                <td className={
                  p.latestValuation
                    ? (p.latestValuation.value - (p.latestMortgage?.outstandingBalance ?? 0)) >= 0 ? 'positive' : 'negative'
                    : undefined
                }>
                  {p.latestValuation
                    ? fmt(p.latestValuation.value - (p.latestMortgage?.outstandingBalance ?? 0), p.latestValuation.currency)
                    : '—'}
                </td>
                <td>{fmtMonthly(p.monthlyRent)}</td>
                <td>{fmtMonthly(p.monthlyMortgagePayment)}</td>
                <td
                  className={
                    p.monthlyCashflow == null || Number.isNaN(p.monthlyCashflow)
                      ? undefined
                      : p.monthlyCashflow >= 0
                        ? 'positive'
                        : 'negative'
                  }
                >
                  {fmtMonthly(p.monthlyCashflow)}
                </td>
                <td className="actions">
                  {p.archivedAt ? (
                    <button className="btn btn-sm" type="button" onClick={() => unarchiveProperty(p.id)}>
                      Unarchive
                    </button>
                  ) : (
                    <button className="btn btn-sm" type="button" onClick={() => archiveProperty(p.id)}>
                      Archive
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
