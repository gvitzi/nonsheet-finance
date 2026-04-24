import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { mortgageDebtContributionsAsOf } from '@nonsheet-finance/core'
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

type Row = Property & { latestValuation?: PropertyValuation | null; mortgageEntries: PropertyMortgageEntry[] }

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
            </table>
          </div>
        </>
      )}
    </div>
  )
}
