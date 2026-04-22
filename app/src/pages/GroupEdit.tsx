import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError, api } from '../api'
import type { AssetGroup, GroupKind, Portfolio } from '../api'
import { GROUP_KIND_LABELS, PORTFOLIOS_UPDATED_EVENT, labelForGroupKind } from '../groupKinds'
import { GroupNavGlyph, resolveGroupNavIconId } from '../groupNavIcons'
import { assetGroupHubPath } from '../portfolioPaths'

function getFriendlyError(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    if (error.status >= 500) return 'The server had trouble saving the Asset Group.'
    return error.message
  }
  if (error instanceof Error) return error.message
  return fallback
}

export default function GroupEdit() {
  const { portfolioId, assetGroupId } = useParams<{ portfolioId: string; assetGroupId: string }>()
  const navigate = useNavigate()
  const [assetGroup, setAssetGroup] = useState<AssetGroup | null>(null)
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    name: '',
    description: '',
    color: '#6366f1',
    kind: 'general' as GroupKind,
    portfolioId: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!assetGroupId) return
    setLoading(true)
    setError(null)
    Promise.all([api.assetGroups.get(assetGroupId), api.portfolios.list()])
      .then(([g, ps]) => {
        if (portfolioId && g.portfolioId !== portfolioId) {
          setError('Asset group not found in this portfolio.')
          setAssetGroup(null)
          return
        }
        setAssetGroup(g)
        setPortfolios(ps)
        setForm({
          name: g.name,
          description: g.description ?? '',
          color: g.color ?? '#6366f1',
          kind: (['investments', 'real_estate', 'general'].includes(g.kind) ? g.kind : 'general') as GroupKind,
          portfolioId: g.portfolioId,
        })
      })
      .catch(() => setError('Asset group not found.'))
      .finally(() => setLoading(false))
  }, [assetGroupId, portfolioId])

  const validationError = useMemo(() => {
    if (!form.name.trim()) return 'Name is required.'
    if (!form.portfolioId) return 'Portfolio is required.'
    return null
  }, [form.name, form.portfolioId])

  const save = async () => {
    if (!assetGroupId || validationError) {
      setError(validationError ?? 'Missing Asset Group.')
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await api.assetGroups.update(assetGroupId, {
        name: form.name.trim(),
        description: form.description.trim() || null,
        color: form.color || null,
        portfolioId: form.portfolioId,
      })
      setSuccess('Asset group updated.')
      window.dispatchEvent(new Event(PORTFOLIOS_UPDATED_EVENT))
      if (form.portfolioId !== assetGroup?.portfolioId) {
        navigate(assetGroupHubPath(form.portfolioId, assetGroupId), { replace: true })
      }
    } catch (e: unknown) {
      setError(getFriendlyError(e, 'Failed to update Asset Group.'))
    } finally {
      setSaving(false)
    }
  }

  const del = async () => {
    if (
      !assetGroupId ||
      !confirm(
        'Delete this Asset Group? Remove or reassign dependent assets, liabilities, or properties first if delete fails.',
      )
    )
      return
    setError(null)
    try {
      await api.assetGroups.delete(assetGroupId)
      window.dispatchEvent(new Event(PORTFOLIOS_UPDATED_EVENT))
      navigate('/', { replace: true })
    } catch (e: unknown) {
      setError(getFriendlyError(e, 'Failed to delete Asset Group. Remove or reassign dependent records first.'))
    }
  }

  if (loading) return <div className="page-loading">Loading Asset Group…</div>
  if (!assetGroupId || error === 'Asset group not found.' || !assetGroup) {
    return <div className="page-error">{error ?? 'Asset group not found.'}</div>
  }

  const pid = portfolioId ?? assetGroup.portfolioId

  return (
    <div className="page">
      <div className="page-header">
        <h1>Edit Asset Group</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn" type="button" onClick={() => navigate(assetGroupHubPath(pid, assetGroupId))}>
            Back
          </button>
          <button className="btn btn-danger" type="button" onClick={del}>
            Delete
          </button>
        </div>
      </div>

      {error && error !== 'Asset group not found.' ? <div className="page-error">{error}</div> : null}
      {success ? <div className="page-success">{success}</div> : null}

      <div className="form-panel">
        <div className="form-grid">
          <div className="group-edit__identity span-2">
            <input
              type="color"
              className="input-color-circle input-color-circle--inline"
              value={form.color}
              onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
              aria-label="Asset group color"
              title="Asset group color"
            />
            <span
              className="group-edit__type-icon"
              style={{ color: form.color }}
              title="Icon is set from the Asset Group type (Securities, Real estate, or General)."
              aria-hidden
            >
              <GroupNavGlyph iconId={resolveGroupNavIconId(form.kind)} />
            </span>
            <div className="group-edit__name-type-row">
              <label className="group-edit__name">
                Name *
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <div className="group-edit__type-aside">
                <span className="group-edit__asset-type-label">Asset Type</span>
                <div className="group-edit__type-readonly" aria-readonly="true">
                  {form.kind in GROUP_KIND_LABELS ? GROUP_KIND_LABELS[form.kind as GroupKind] : labelForGroupKind(form.kind)}
                </div>
              </div>
            </div>
          </div>
          <label className="span-2">
            Description
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </label>
          <label className="span-2">
            Portfolio
            <select value={form.portfolioId} onChange={(e) => setForm((f) => ({ ...f, portfolioId: e.target.value }))}>
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {validationError ? <p className="inline-hint inline-error">{validationError}</p> : null}
        <div className="form-actions">
          <button className="btn btn-primary" type="button" onClick={save} disabled={Boolean(validationError) || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
