import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError, api } from '../api'
import type { GroupKind } from '../api'
import { GROUP_KIND_LABELS, GROUP_KIND_ORDER, PORTFOLIOS_UPDATED_EVENT } from '../groupKinds'
import { assetGroupHubPath } from '../portfolioPaths'

const emptyForm = {
  name: 'Securities',
  description: '',
  color: '#6366f1',
  kind: 'investments' as GroupKind,
}

function getFriendlyError(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    if (error.status >= 500) return 'The server had trouble saving the Asset Group.'
    return error.message
  }
  if (error instanceof Error) return error.message
  return fallback
}

export default function GroupNew() {
  const { portfolioId } = useParams<{ portfolioId: string }>()
  const navigate = useNavigate()
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validationError = useMemo(() => {
    if (!form.name.trim()) return 'Name is required.'
    return null
  }, [form.name])

  const save = async () => {
    if (!portfolioId) {
      setError('Missing portfolio.')
      return
    }
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const g = await api.assetGroups.create({
        portfolioId,
        name: form.name.trim(),
        description: form.description.trim() || null,
        color: form.color || null,
        kind: form.kind,
      })
      window.dispatchEvent(new Event(PORTFOLIOS_UPDATED_EVENT))
      navigate(assetGroupHubPath(portfolioId, g.id), { replace: true })
    } catch (e: unknown) {
      setError(getFriendlyError(e, 'Failed to create Asset Group.'))
    } finally {
      setSaving(false)
    }
  }

  if (!portfolioId) {
    return <div className="page-error">Missing portfolio. Open “New Asset Group” from a portfolio in the sidebar.</div>
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>New Asset Group</h1>
        <button className="btn" type="button" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </div>

      {error ? <div className="page-error">{error}</div> : null}

      <div className="form-panel">
        <p className="page-subtitle">
          Asset groups hold assets, liabilities, and (for real estate) properties. Choose a type: <strong>Securities</strong> for
          ETFs and trading, <strong>Real estate</strong> for property, or <strong>General</strong> for other balances.
        </p>
        <div className="form-grid">
          <label>
            Name *
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
          </label>
          <label>
            Type
            <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as GroupKind }))}>
              {GROUP_KIND_ORDER.map((k) => (
                <option key={k} value={k}>
                  {GROUP_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Color
            <input
              type="color"
              className="input-color-circle"
              value={form.color}
              onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
              aria-label="Asset group color"
            />
          </label>
          <label className="span-2">
            Description
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </label>
        </div>
        {validationError ? <p className="inline-hint inline-error">{validationError}</p> : null}
        <div className="form-actions">
          <button className="btn btn-primary" type="button" onClick={save} disabled={Boolean(validationError) || saving}>
            {saving ? 'Creating…' : 'Create Asset Group'}
          </button>
        </div>
      </div>
    </div>
  )
}
