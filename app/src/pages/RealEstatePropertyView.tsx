import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../api'
import type { Property, PropertyExpense, PropertyMortgageEntry, PropertyValuation } from '../api'
import { assetGroupHubPath } from '../portfolioPaths'

const fmt = (n: number, currency = 'EUR') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)

function err(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return fallback
}

function dateInputFromIso(iso: string) {
  const d = iso.includes('T') ? iso.slice(0, 10) : iso.slice(0, 10)
  return d.length === 10 ? d : ''
}

type Props = {
  portfolioId: string
  assetGroupId: string
  propertyId: string
  groupName: string
}

const valuationEmpty = { date: '', value: '', currency: 'EUR' }
const expenseEmpty = { date: '', name: '', description: '', amount: '' }
const mortgageEmpty = { date: '', outstandingBalance: '', currency: 'EUR', loanName: '' }

type PropertyAccordionSection = 'valuations' | 'expenses' | 'mortgages'

export default function RealEstatePropertyView({ portfolioId, assetGroupId, propertyId, groupName }: Props) {
  const navigate = useNavigate()
  const [property, setProperty] = useState<Property | null>(null)
  const [valuations, setValuations] = useState<PropertyValuation[]>([])
  const [expenses, setExpenses] = useState<PropertyExpense[]>([])
  const [mortgages, setMortgages] = useState<PropertyMortgageEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [metaForm, setMetaForm] = useState({
    name: '',
    description: '',
    notes: '',
    address: '',
    monthlyRent: '',
    monthlyMortgagePayment: '',
  })
  const [metaSaving, setMetaSaving] = useState(false)
  const [detailsEditing, setDetailsEditing] = useState(false)

  const [vForm, setVForm] = useState(valuationEmpty)
  const [vEditing, setVEditing] = useState<PropertyValuation | null>(null)
  const [vSaving, setVSaving] = useState(false)
  const [valuationModalOpen, setValuationModalOpen] = useState(false)

  const closeValuationModal = useCallback(() => {
    setValuationModalOpen(false)
    setVEditing(null)
    setVForm(valuationEmpty)
  }, [])

  const [eForm, setEForm] = useState(expenseEmpty)
  const [eEditing, setEEditing] = useState<PropertyExpense | null>(null)
  const [eSaving, setESaving] = useState(false)

  const [mForm, setMForm] = useState(mortgageEmpty)
  const [mEditing, setMEditing] = useState<PropertyMortgageEntry | null>(null)
  const [mSaving, setMSaving] = useState(false)

  const [openAccordionSection, setOpenAccordionSection] = useState<PropertyAccordionSection | null>('valuations')

  const [selectedValuationId, setSelectedValuationId] = useState<string | null>(null)
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null)
  const [selectedMortgageId, setSelectedMortgageId] = useState<string | null>(null)

  const onAccordionToggle = useCallback((section: PropertyAccordionSection, e: SyntheticEvent<HTMLDetailsElement>) => {
    const el = e.currentTarget
    if (el.open) setOpenAccordionSection(section)
    else setOpenAccordionSection((prev) => (prev === section ? null : prev))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setBanner(null)
    try {
      const [p, v, e, m] = await Promise.all([
        api.properties.get(propertyId),
        api.properties.listValuations(propertyId),
        api.properties.listExpenses(propertyId),
        api.properties.listMortgageEntries(propertyId),
      ])
      setProperty(p)
      setMetaForm({
        name: p.name,
        description: p.description ?? '',
        notes: p.notes ?? '',
        address: p.address ?? '',
        monthlyRent: p.monthlyRent != null && !Number.isNaN(p.monthlyRent) ? String(p.monthlyRent) : '',
        monthlyMortgagePayment:
          p.monthlyMortgagePayment != null && !Number.isNaN(p.monthlyMortgagePayment) ? String(p.monthlyMortgagePayment) : '',
      })
      setValuations(v)
      setExpenses(e)
      setMortgages(m)
      setSelectedValuationId(null)
      setSelectedExpenseId(null)
      setSelectedMortgageId(null)
    } catch {
      setProperty(null)
      setBanner({ type: 'err', text: 'Property not found.' })
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (vEditing && selectedValuationId !== vEditing.id) {
      setVEditing(null)
      setVForm(valuationEmpty)
      setValuationModalOpen(false)
    }
  }, [selectedValuationId, vEditing])

  useEffect(() => {
    if (!valuationModalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeValuationModal()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [valuationModalOpen, closeValuationModal])

  useEffect(() => {
    if (eEditing && selectedExpenseId !== eEditing.id) {
      setEEditing(null)
      setEForm(expenseEmpty)
    }
  }, [selectedExpenseId, eEditing])

  useEffect(() => {
    if (mEditing && selectedMortgageId !== mEditing.id) {
      setMEditing(null)
      setMForm(mortgageEmpty)
    }
  }, [selectedMortgageId, mEditing])

  const propertyLabel = property?.name ?? 'Property'

  const latestValuation = useMemo(() => {
    const sorted = [...valuations].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    return sorted[0] ?? null
  }, [valuations])

  const latestMortgage = useMemo(() => {
    const sorted = [...mortgages].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    return sorted[0] ?? null
  }, [mortgages])

  const parseOptionalMoney = (s: string) => {
    const t = s.trim()
    if (!t) return null
    const n = parseFloat(t)
    return Number.isNaN(n) ? null : n
  }

  const derivedMonthlyCashflow = useMemo(() => {
    const r = parseOptionalMoney(metaForm.monthlyRent)
    const m = parseOptionalMoney(metaForm.monthlyMortgagePayment)
    if (r === null && m === null) return null
    return (r ?? 0) - (m ?? 0)
  }, [metaForm.monthlyRent, metaForm.monthlyMortgagePayment])

  const savedMonthlyCashflow = useMemo(() => {
    if (!property) return null
    const r = property.monthlyRent
    const m = property.monthlyMortgagePayment
    if (r == null && m == null) return null
    return (r ?? 0) - (m ?? 0)
  }, [property])

  const cancelDetailsEdit = useCallback(() => {
    if (!property) return
    setMetaForm({
      name: property.name,
      description: property.description ?? '',
      notes: property.notes ?? '',
      address: property.address ?? '',
      monthlyRent: property.monthlyRent != null && !Number.isNaN(property.monthlyRent) ? String(property.monthlyRent) : '',
      monthlyMortgagePayment:
        property.monthlyMortgagePayment != null && !Number.isNaN(property.monthlyMortgagePayment)
          ? String(property.monthlyMortgagePayment)
          : '',
    })
    setDetailsEditing(false)
    setBanner(null)
  }, [property])

  const saveMeta = async () => {
    if (!metaForm.name.trim()) {
      setBanner({ type: 'err', text: 'Name is required.' })
      return
    }
    for (const key of ['monthlyRent', 'monthlyMortgagePayment'] as const) {
      const t = metaForm[key].trim()
      if (t && Number.isNaN(Number(t))) {
        setBanner({ type: 'err', text: 'Monthly amounts must be valid numbers when provided.' })
        return
      }
    }
    setMetaSaving(true)
    setBanner(null)
    try {
      const p = await api.properties.update(propertyId, {
        name: metaForm.name.trim(),
        description: metaForm.description.trim() || null,
        notes: metaForm.notes.trim() || null,
        address: metaForm.address.trim() || null,
        monthlyRent: parseOptionalMoney(metaForm.monthlyRent),
        monthlyMortgagePayment: parseOptionalMoney(metaForm.monthlyMortgagePayment),
      })
      setProperty(p)
      setDetailsEditing(false)
      setBanner({ type: 'ok', text: 'Saved.' })
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to save.') })
    } finally {
      setMetaSaving(false)
    }
  }

  const delProperty = async () => {
    if (!confirm('Delete this property and all valuations, expenses, and mortgage rows?')) return
    try {
      await api.properties.delete(propertyId)
      navigate(assetGroupHubPath(portfolioId, assetGroupId))
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to delete.') })
    }
  }

  const vValidation = useMemo(() => {
    if (!vForm.date) return 'Date is required.'
    if (Number.isNaN(Number(vForm.value))) return 'Value must be a number.'
    return null
  }, [vForm])

  const saveValuation = async () => {
    if (vValidation) {
      setBanner({ type: 'err', text: vValidation })
      return
    }
    setVSaving(true)
    setBanner(null)
    try {
      const iso = new Date(vForm.date + 'T12:00:00').toISOString()
      const body = { date: iso, value: parseFloat(vForm.value), currency: vForm.currency.trim().toUpperCase() }
      if (vEditing) await api.properties.updateValuation(propertyId, vEditing.id, body)
      else await api.properties.createValuation(propertyId, body)
      setVForm(valuationEmpty)
      setVEditing(null)
      setValuationModalOpen(false)
      setBanner({ type: 'ok', text: vEditing ? 'Valuation updated.' : 'Valuation added.' })
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to save valuation.') })
    } finally {
      setVSaving(false)
    }
  }

  const delValuation = async (id: string) => {
    if (!confirm('Delete this valuation row?')) return
    try {
      await api.properties.deleteValuation(propertyId, id)
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to delete.') })
    }
  }

  const eValidation = useMemo(() => {
    if (!eForm.date) return 'Date is required.'
    if (!eForm.name.trim()) return 'Name is required.'
    if (Number.isNaN(Number(eForm.amount))) return 'Amount must be a number.'
    return null
  }, [eForm])

  const saveExpense = async () => {
    if (eValidation) {
      setBanner({ type: 'err', text: eValidation })
      return
    }
    setESaving(true)
    setBanner(null)
    try {
      const iso = new Date(eForm.date + 'T12:00:00').toISOString()
      const body = {
        date: iso,
        name: eForm.name.trim(),
        description: eForm.description.trim() || null,
        amount: parseFloat(eForm.amount),
      }
      if (eEditing) await api.properties.updateExpense(propertyId, eEditing.id, body)
      else await api.properties.createExpense(propertyId, body)
      setEForm(expenseEmpty)
      setEEditing(null)
      setBanner({ type: 'ok', text: eEditing ? 'Expense updated.' : 'Expense added.' })
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to save expense.') })
    } finally {
      setESaving(false)
    }
  }

  const delExpense = async (id: string) => {
    if (!confirm('Delete this expense?')) return
    try {
      await api.properties.deleteExpense(propertyId, id)
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to delete.') })
    }
  }

  const mValidation = useMemo(() => {
    if (!mForm.date) return 'Date is required.'
    if (Number.isNaN(Number(mForm.outstandingBalance))) return 'Outstanding balance must be a number.'
    return null
  }, [mForm])

  const saveMortgage = async () => {
    if (mValidation) {
      setBanner({ type: 'err', text: mValidation })
      return
    }
    setMSaving(true)
    setBanner(null)
    try {
      const iso = new Date(mForm.date + 'T12:00:00').toISOString()
      const body = {
        date: iso,
        outstandingBalance: parseFloat(mForm.outstandingBalance),
        currency: mForm.currency.trim().toUpperCase(),
        loanName: mForm.loanName.trim() || null,
      }
      if (mEditing) await api.properties.updateMortgageEntry(propertyId, mEditing.id, body)
      else await api.properties.createMortgageEntry(propertyId, body)
      setMForm(mortgageEmpty)
      setMEditing(null)
      setBanner({ type: 'ok', text: mEditing ? 'Mortgage row updated.' : 'Mortgage row added.' })
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to save mortgage row.') })
    } finally {
      setMSaving(false)
    }
  }

  const delMortgage = async (id: string) => {
    if (!confirm('Delete this mortgage row?')) return
    try {
      await api.properties.deleteMortgageEntry(propertyId, id)
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to delete.') })
    }
  }

  if (loading) return <div className="page-loading">Loading property…</div>
  if (!property) return <div className="page-error">{banner?.text ?? 'Property not found.'}</div>

  return (
    <div className="page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={assetGroupHubPath(portfolioId, assetGroupId)}>{groupName}</Link>
        <span aria-hidden="true"> / </span>
        <span>{propertyLabel}</span>
      </nav>

      <div className="page-header">
        <h1>{property.name}</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link className="btn" to={assetGroupHubPath(portfolioId, assetGroupId)}>
            All properties
          </Link>
          <button className="btn btn-danger" type="button" onClick={delProperty}>
            Delete property
          </button>
        </div>
      </div>

      {banner?.type === 'err' ? <div className="page-error">{banner.text}</div> : null}
      {banner?.type === 'ok' ? <div className="page-success">{banner.text}</div> : null}

      <section className="panel property-details-section" aria-labelledby="property-details-heading">
        <div className="property-details-section__head">
          <h2 id="property-details-heading">Details</h2>
          {detailsEditing ? (
            <button className="btn" type="button" onClick={cancelDetailsEdit}>
              Cancel
            </button>
          ) : (
            <button className="btn btn-primary" type="button" onClick={() => setDetailsEditing(true)}>
              Edit details
            </button>
          )}
        </div>

        {detailsEditing ? (
          <>
            <div className="form-grid property-details-section__form">
              <label className="span-2">
                Name *
                <input value={metaForm.name} onChange={(e) => setMetaForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <label className="span-2">
                Description (single line)
                <input
                  value={metaForm.description}
                  onChange={(e) => setMetaForm((f) => ({ ...f, description: e.target.value }))}
                />
              </label>
              <label className="span-2">
                Notes
                <textarea rows={5} value={metaForm.notes} onChange={(e) => setMetaForm((f) => ({ ...f, notes: e.target.value }))} />
              </label>
              <label className="span-2">
                Address
                <textarea rows={2} value={metaForm.address} onChange={(e) => setMetaForm((f) => ({ ...f, address: e.target.value }))} />
              </label>
              <div className="span-2 property-details-section__fin-intro">
                <h3 className="property-details-section__fin-title">Financial summary</h3>
                <p className="page-subtitle property-details-section__fin-copy">
                  Value and liabilities follow the latest dated row in the valuation and mortgage tables below. Net cashflow is
                  rent minus mortgage payment (EUR).
                </p>
              </div>
              <label>
                Value (latest valuation)
                <input
                  readOnly
                  value={latestValuation ? fmt(latestValuation.value, latestValuation.currency) : '—'}
                  className="input-readonly"
                />
              </label>
              <label>
                Liabilities (latest mortgage balance)
                <input
                  readOnly
                  value={latestMortgage ? fmt(latestMortgage.outstandingBalance, latestMortgage.currency) : '—'}
                  className="input-readonly"
                />
              </label>
              <label>
                Rent (monthly)
                <input
                  type="number"
                  step="0.01"
                  value={metaForm.monthlyRent}
                  onChange={(e) => setMetaForm((f) => ({ ...f, monthlyRent: e.target.value }))}
                />
              </label>
              <label>
                Mortgage monthly payment
                <input
                  type="number"
                  step="0.01"
                  value={metaForm.monthlyMortgagePayment}
                  onChange={(e) => setMetaForm((f) => ({ ...f, monthlyMortgagePayment: e.target.value }))}
                />
              </label>
              <label className="span-2">
                Net cashflow (monthly)
                <input
                  readOnly
                  value={derivedMonthlyCashflow === null ? '—' : fmt(derivedMonthlyCashflow, 'EUR')}
                  className="input-readonly"
                  title="Rent minus mortgage payment"
                />
              </label>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" type="button" onClick={saveMeta} disabled={metaSaving}>
                {metaSaving ? 'Saving…' : 'Save details'}
              </button>
            </div>
          </>
        ) : (
          <div className="property-details-read">
            <div className="property-details-read__block">
              <div className="label">Name</div>
              <div className="property-details-read__value">{property.name}</div>
            </div>
            <div className="property-details-read__block">
              <div className="label">Description</div>
              <div className="property-details-read__value property-details-read__value--muted">
                {property.description?.trim() ? property.description : '—'}
              </div>
            </div>
            <div className="property-details-read__block">
              <div className="label">Notes</div>
              {property.notes?.trim() ? (
                <p className="property-details-read__notes">{property.notes}</p>
              ) : (
                <div className="property-details-read__value property-details-read__value--muted">—</div>
              )}
            </div>
            <div className="property-details-read__block">
              <div className="label">Address</div>
              {property.address?.trim() ? (
                <div className="property-details-read__address">{property.address}</div>
              ) : (
                <div className="property-details-read__value property-details-read__value--muted">—</div>
              )}
            </div>

            <div className="property-details-read__fin">
              <h3 className="property-details-section__fin-title">Financial summary</h3>
              <p className="page-subtitle property-details-section__fin-copy">
                Value and liabilities follow the latest dated row in the valuation and mortgage tables below. Net cashflow is
                rent minus mortgage payment (EUR).
              </p>
              <div className="property-details-read__stats">
                <div className="property-details-read__stat">
                  <div className="label">Latest valuation</div>
                  <div className="property-details-read__stat-value">
                    {latestValuation ? fmt(latestValuation.value, latestValuation.currency) : '—'}
                  </div>
                  {latestValuation ? (
                    <div className="property-details-read__stat-meta">
                      As of {new Date(latestValuation.date).toLocaleDateString()}
                    </div>
                  ) : null}
                </div>
                <div className="property-details-read__stat">
                  <div className="label">Latest mortgage balance</div>
                  <div className="property-details-read__stat-value">
                    {latestMortgage ? fmt(latestMortgage.outstandingBalance, latestMortgage.currency) : '—'}
                  </div>
                  {latestMortgage ? (
                    <div className="property-details-read__stat-meta">
                      As of {new Date(latestMortgage.date).toLocaleDateString()}
                      {latestMortgage.loanName?.trim() ? ` · ${latestMortgage.loanName}` : ''}
                    </div>
                  ) : null}
                </div>
                <div className="property-details-read__stat">
                  <div className="label">Rent (monthly)</div>
                  <div className="property-details-read__stat-value">
                    {property.monthlyRent != null && !Number.isNaN(property.monthlyRent)
                      ? fmt(property.monthlyRent, 'EUR')
                      : '—'}
                  </div>
                </div>
                <div className="property-details-read__stat">
                  <div className="label">Mortgage payment (monthly)</div>
                  <div className="property-details-read__stat-value">
                    {property.monthlyMortgagePayment != null && !Number.isNaN(property.monthlyMortgagePayment)
                      ? fmt(property.monthlyMortgagePayment, 'EUR')
                      : '—'}
                  </div>
                </div>
                <div className="property-details-read__stat property-details-read__stat--wide">
                  <div className="label">Net cashflow (monthly)</div>
                  <div
                    className={`property-details-read__stat-value property-details-read__stat-value--cashflow${
                      savedMonthlyCashflow != null && savedMonthlyCashflow >= 0 ? ' positive' : ''
                    }${savedMonthlyCashflow != null && savedMonthlyCashflow < 0 ? ' negative' : ''}`}
                  >
                    {savedMonthlyCashflow === null ? '—' : fmt(savedMonthlyCashflow, 'EUR')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="property-accordions" role="presentation">
        <details
          className="property-accordion"
          open={openAccordionSection === 'valuations'}
          onToggle={(e) => onAccordionToggle('valuations', e)}
        >
          <summary className="property-accordion__summary">
            <span className="property-accordion__title">Valuations over time</span>
          </summary>
          <div className="property-accordion__body stack">
        <p className="page-subtitle">Date and value for this property.</p>

        <div className="property-table-toolbar">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              setVEditing(null)
              setVForm(valuationEmpty)
              setSelectedValuationId(null)
              setValuationModalOpen(true)
            }}
          >
            Add valuation
          </button>
          {selectedValuationId ? (
            <div className="property-table-toolbar__actions">
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => {
                  const r = valuations.find((x) => x.id === selectedValuationId)
                  if (!r) return
                  setVEditing(r)
                  setVForm({
                    date: dateInputFromIso(r.date),
                    value: String(r.value),
                    currency: r.currency,
                  })
                  setValuationModalOpen(true)
                }}
              >
                Edit
              </button>
              <button className="btn btn-sm btn-danger" type="button" onClick={() => void delValuation(selectedValuationId)}>
                Delete
              </button>
            </div>
          ) : null}
        </div>

        {valuations.length === 0 ? (
          <div className="empty-state">No valuation rows yet.</div>
        ) : (
          <div className="property-table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Value</th>
                  <th>Property name</th>
                </tr>
              </thead>
              <tbody>
                {valuations.map((r) => (
                  <tr
                    key={r.id}
                    className={`property-table-row--selectable${selectedValuationId === r.id ? ' property-table-row--selected' : ''}`}
                    tabIndex={0}
                    aria-selected={selectedValuationId === r.id}
                    onClick={() => setSelectedValuationId((prev) => (prev === r.id ? null : r.id))}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault()
                      setSelectedValuationId((prev) => (prev === r.id ? null : r.id))
                    }}
                  >
                    <td>{new Date(r.date).toLocaleDateString()}</td>
                    <td className="positive">{fmt(r.value, r.currency)}</td>
                    <td>{property.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
          </div>
        </details>

        <details
          className="property-accordion"
          open={openAccordionSection === 'expenses'}
          onToggle={(e) => onAccordionToggle('expenses', e)}
        >
          <summary className="property-accordion__summary">
            <span className="property-accordion__title">Expenses</span>
          </summary>
          <div className="property-accordion__body stack">
        <p className="page-subtitle">Recorded costs for this property (repairs, fees, insurance, etc.). Amounts in EUR.</p>

        <div className="form-panel">
          <h3>{eEditing ? 'Edit expense' : 'Add expense'}</h3>
          <div className="form-grid">
            <label>
              Date *
              <input type="date" value={eForm.date} onChange={(ev) => setEForm((f) => ({ ...f, date: ev.target.value }))} />
            </label>
            <label>
              Name *
              <input value={eForm.name} onChange={(ev) => setEForm((f) => ({ ...f, name: ev.target.value }))} />
            </label>
            <label className="span-2">
              Description
              <input value={eForm.description} onChange={(ev) => setEForm((f) => ({ ...f, description: ev.target.value }))} />
            </label>
            <label>
              Amount *
              <input type="number" step="0.01" value={eForm.amount} onChange={(ev) => setEForm((f) => ({ ...f, amount: ev.target.value }))} />
            </label>
          </div>
          {eValidation ? <p className="inline-hint inline-error">{eValidation}</p> : null}
          <div className="form-actions">
            {eEditing ? (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setEEditing(null)
                  setEForm(expenseEmpty)
                }}
              >
                Cancel edit
              </button>
            ) : null}
            <button className="btn btn-primary" type="button" onClick={saveExpense} disabled={Boolean(eValidation) || eSaving}>
              {eSaving ? 'Saving…' : eEditing ? 'Update expense' : 'Add expense'}
            </button>
          </div>
        </div>

        {expenses.length === 0 ? (
          <div className="empty-state">No expenses yet.</div>
        ) : (
          <>
            {selectedExpenseId ? (
              <div className="property-table-toolbar">
                <div className="property-table-toolbar__actions">
                  <button
                    className="btn btn-sm"
                    type="button"
                    onClick={() => {
                      const r = expenses.find((x) => x.id === selectedExpenseId)
                      if (!r) return
                      setEEditing(r)
                      setEForm({
                        date: dateInputFromIso(r.date),
                        name: r.name,
                        description: r.description ?? '',
                        amount: String(r.amount),
                      })
                    }}
                  >
                    Edit
                  </button>
                  <button className="btn btn-sm btn-danger" type="button" onClick={() => void delExpense(selectedExpenseId)}>
                    Delete
                  </button>
                </div>
              </div>
            ) : null}
            <div className="property-table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>Description</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((r) => (
                    <tr
                      key={r.id}
                      className={`property-table-row--selectable${selectedExpenseId === r.id ? ' property-table-row--selected' : ''}`}
                      tabIndex={0}
                      aria-selected={selectedExpenseId === r.id}
                      onClick={() => setSelectedExpenseId((prev) => (prev === r.id ? null : r.id))}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return
                        e.preventDefault()
                        setSelectedExpenseId((prev) => (prev === r.id ? null : r.id))
                      }}
                    >
                      <td>{new Date(r.date).toLocaleDateString()}</td>
                      <td>{r.name}</td>
                      <td>{r.description?.trim() ? r.description : '—'}</td>
                      <td className="negative">{fmt(r.amount, 'EUR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
          </div>
        </details>

        <details
          className="property-accordion"
          open={openAccordionSection === 'mortgages'}
          onToggle={(e) => onAccordionToggle('mortgages', e)}
        >
          <summary className="property-accordion__summary">
            <span className="property-accordion__title">Mortgage over time</span>
          </summary>
          <div className="property-accordion__body stack">
        <p className="page-subtitle">Outstanding balance (debt) per date. Loan name is optional.</p>

        <div className="form-panel">
          <h3>{mEditing ? 'Edit mortgage row' : 'Add mortgage row'}</h3>
          <div className="form-grid">
            <label>
              Date *
              <input type="date" value={mForm.date} onChange={(e) => setMForm((f) => ({ ...f, date: e.target.value }))} />
            </label>
            <label>
              Outstanding balance (debt) *
              <input
                type="number"
                step="0.01"
                value={mForm.outstandingBalance}
                onChange={(e) => setMForm((f) => ({ ...f, outstandingBalance: e.target.value }))}
              />
            </label>
            <label>
              Currency
              <input value={mForm.currency} maxLength={3} onChange={(e) => setMForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} />
            </label>
            <label>
              Loan name (optional)
              <input value={mForm.loanName} onChange={(e) => setMForm((f) => ({ ...f, loanName: e.target.value }))} />
            </label>
          </div>
          {mValidation ? <p className="inline-hint inline-error">{mValidation}</p> : null}
          <div className="form-actions">
            {mEditing ? (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setMEditing(null)
                  setMForm(mortgageEmpty)
                }}
              >
                Cancel edit
              </button>
            ) : null}
            <button className="btn btn-primary" type="button" onClick={saveMortgage} disabled={Boolean(mValidation) || mSaving}>
              {mSaving ? 'Saving…' : mEditing ? 'Update row' : 'Add row'}
            </button>
          </div>
        </div>

        {mortgages.length === 0 ? (
          <div className="empty-state">No mortgage rows yet.</div>
        ) : (
          <>
            {selectedMortgageId ? (
              <div className="property-table-toolbar">
                <div className="property-table-toolbar__actions">
                  <button
                    className="btn btn-sm"
                    type="button"
                    onClick={() => {
                      const r = mortgages.find((x) => x.id === selectedMortgageId)
                      if (!r) return
                      setMEditing(r)
                      setMForm({
                        date: dateInputFromIso(r.date),
                        outstandingBalance: String(r.outstandingBalance),
                        currency: r.currency,
                        loanName: r.loanName ?? '',
                      })
                    }}
                  >
                    Edit
                  </button>
                  <button className="btn btn-sm btn-danger" type="button" onClick={() => void delMortgage(selectedMortgageId)}>
                    Delete
                  </button>
                </div>
              </div>
            ) : null}
            <div className="property-table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Outstanding (debt)</th>
                    <th>Loan name</th>
                    <th>Property name</th>
                  </tr>
                </thead>
                <tbody>
                  {mortgages.map((r) => (
                    <tr
                      key={r.id}
                      className={`property-table-row--selectable${selectedMortgageId === r.id ? ' property-table-row--selected' : ''}`}
                      tabIndex={0}
                      aria-selected={selectedMortgageId === r.id}
                      onClick={() => setSelectedMortgageId((prev) => (prev === r.id ? null : r.id))}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return
                        e.preventDefault()
                        setSelectedMortgageId((prev) => (prev === r.id ? null : r.id))
                      }}
                    >
                      <td>{new Date(r.date).toLocaleDateString()}</td>
                      <td className="negative">{fmt(r.outstandingBalance, r.currency)}</td>
                      <td>{r.loanName ?? '—'}</td>
                      <td>{property.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
          </div>
        </details>
      </div>

      {valuationModalOpen ? (
        <div
          className="valuation-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeValuationModal()
          }}
        >
          <div className="valuation-modal" role="dialog" aria-modal="true" aria-labelledby="valuation-modal-title">
            <div className="valuation-modal__head">
              <h2 id="valuation-modal-title">{vEditing ? 'Edit valuation' : 'Add valuation'}</h2>
              <button className="btn btn-sm valuation-modal__close" type="button" onClick={closeValuationModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className="form-grid">
              <label>
                Date *
                <input
                  type="date"
                  value={vForm.date}
                  onChange={(e) => setVForm((f) => ({ ...f, date: e.target.value }))}
                />
              </label>
              <label>
                Value *
                <input type="number" step="0.01" value={vForm.value} onChange={(e) => setVForm((f) => ({ ...f, value: e.target.value }))} />
              </label>
              <label>
                Currency
                <input value={vForm.currency} maxLength={3} onChange={(e) => setVForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} />
              </label>
            </div>
            {vValidation ? <p className="inline-hint inline-error">{vValidation}</p> : null}
            <div className="form-actions">
              <button className="btn" type="button" onClick={closeValuationModal}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void saveValuation()} disabled={Boolean(vValidation) || vSaving}>
                {vSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
