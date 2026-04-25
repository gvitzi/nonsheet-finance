import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../api'
import type { Asset, AssetValuation } from '../api'
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
  assetId: string
  groupName: string
}

const valuationEmpty = { date: '', value: '', currency: 'EUR' }

export default function GeneralAssetView({ portfolioId, assetGroupId, assetId, groupName }: Props) {
  const navigate = useNavigate()
  const [asset, setAsset] = useState<Asset | null>(null)
  const [valuations, setValuations] = useState<AssetValuation[]>([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [metaForm, setMetaForm] = useState({ name: '', category: 'other', note: '', currency: 'EUR' })
  const [metaSaving, setMetaSaving] = useState(false)

  const [vForm, setVForm] = useState(valuationEmpty)
  const [vEditing, setVEditing] = useState<AssetValuation | null>(null)
  const [vSaving, setVSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setBanner(null)
    try {
      const [a, v] = await Promise.all([api.assets.get(assetId), api.assets.listValuations(assetId)])
      setAsset(a)
      setMetaForm({
        name: a.name,
        category: a.category,
        note: a.note ?? '',
        currency: a.currency,
      })
      setValuations(v)
    } catch {
      setAsset(null)
      setBanner({ type: 'err', text: 'Asset not found or valuations are not available for this asset.' })
    } finally {
      setLoading(false)
    }
  }, [assetId])

  useEffect(() => {
    load()
  }, [load])

  const saveMeta = async () => {
    if (!metaForm.name.trim()) {
      setBanner({ type: 'err', text: 'Name is required.' })
      return
    }
    setMetaSaving(true)
    setBanner(null)
    try {
      const a = await api.assets.update(assetId, {
        name: metaForm.name.trim(),
        category: metaForm.category.trim(),
        note: metaForm.note.trim() || null,
        currency: metaForm.currency.trim().toUpperCase(),
      })
      setAsset(a)
      setBanner({ type: 'ok', text: 'Details saved.' })
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to save.') })
    } finally {
      setMetaSaving(false)
    }
  }

  const delAsset = async () => {
    if (!confirm('Delete this asset and all valuation rows?')) return
    try {
      await api.assets.delete(assetId)
      navigate(assetGroupHubPath(portfolioId, assetGroupId))
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to delete.') })
    }
  }

  const sortedValuations = useMemo(
    () => [...valuations].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [valuations],
  )

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
      if (vEditing) await api.assets.updateValuation(assetId, vEditing.id, body)
      else await api.assets.createValuation(assetId, body)
      setVForm(valuationEmpty)
      setVEditing(null)
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
      await api.assets.deleteValuation(assetId, id)
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to delete.') })
    }
  }

  if (loading) return <div className="page-loading">Loading asset…</div>
  if (!asset) return <div className="page-error">{banner?.text ?? 'Asset not found.'}</div>

  return (
    <div className="page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={assetGroupHubPath(portfolioId, assetGroupId)}>{groupName}</Link>
        <span aria-hidden="true"> / </span>
        <span>{asset.name}</span>
      </nav>

      <div className="page-header">
        <h1>{asset.name}</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link className="btn" to={assetGroupHubPath(portfolioId, assetGroupId)}>
            Back to Asset Group
          </Link>
          <button className="btn btn-danger" type="button" onClick={delAsset}>
            Delete asset
          </button>
        </div>
      </div>

      {banner?.type === 'err' ? <div className="page-error">{banner.text}</div> : null}
      {banner?.type === 'ok' ? <div className="page-success">{banner.text}</div> : null}

      <div className="form-panel">
        <h2>Details</h2>
        <p className="page-subtitle">
          Book value follows the <strong>latest dated valuation</strong> below (same pattern as real estate properties).
        </p>
        <div className="form-grid">
          <label className="span-2">
            Name *
            <input value={metaForm.name} onChange={(e) => setMetaForm((f) => ({ ...f, name: e.target.value }))} />
          </label>
          <label>
            Category
            <input value={metaForm.category} onChange={(e) => setMetaForm((f) => ({ ...f, category: e.target.value }))} />
          </label>
          <label>
            Currency
            <input
              value={metaForm.currency}
              maxLength={3}
              onChange={(e) => setMetaForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
            />
          </label>
          <label className="span-2">
            Note
            <input value={metaForm.note} onChange={(e) => setMetaForm((f) => ({ ...f, note: e.target.value }))} />
          </label>
          <label>
            Current value (from latest valuation)
            <input readOnly value={fmt(asset.estimatedValue, asset.currency)} className="input-readonly" />
          </label>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" type="button" onClick={saveMeta} disabled={metaSaving}>
            {metaSaving ? 'Saving…' : 'Save details'}
          </button>
        </div>
      </div>

      <section className="stack">
        <h2>Valuations over time</h2>
        <p className="page-subtitle">Date and total value for this asset. Add historical marks to track how value changed.</p>

        <div className="form-panel">
          <h3>{vEditing ? 'Edit valuation' : 'Add valuation'}</h3>
          <div className="form-grid">
            <label>
              Date *
              <input type="date" value={vForm.date} onChange={(e) => setVForm((f) => ({ ...f, date: e.target.value }))} />
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
            {vEditing ? (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setVEditing(null)
                  setVForm(valuationEmpty)
                }}
              >
                Cancel edit
              </button>
            ) : null}
            <button className="btn btn-primary" type="button" onClick={saveValuation} disabled={Boolean(vValidation) || vSaving}>
              {vSaving ? 'Saving…' : vEditing ? 'Update valuation' : 'Add valuation'}
            </button>
          </div>
        </div>

        {valuations.length === 0 ? (
          <div className="empty-state">No valuation rows yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Value</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sortedValuations.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.date).toLocaleDateString()}</td>
                  <td className="positive">{fmt(r.value, r.currency)}</td>
                  <td className="actions">
                    <button
                      className="btn btn-sm"
                      type="button"
                      onClick={() => {
                        setVEditing(r)
                        setVForm({
                          date: dateInputFromIso(r.date),
                          value: String(r.value),
                          currency: r.currency,
                        })
                      }}
                    >
                      Edit
                    </button>
                    <button className="btn btn-sm btn-danger" type="button" onClick={() => delValuation(r.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
