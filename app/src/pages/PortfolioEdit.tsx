import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import PortfolioIconPicker from '../components/PortfolioIconPicker'
import { ApiError, api } from '../api'
import type { Portfolio } from '../api'
import { PORTFOLIOS_UPDATED_EVENT } from '../groupKinds'
import { resolvePortfolioNavIconId, type GroupNavIconId } from '../groupNavIcons'

function getFriendlyError(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    if (error.status >= 500) return 'The server had trouble saving the portfolio.'
    return error.message
  }
  if (error instanceof Error) return error.message
  return fallback
}

export default function PortfolioEdit() {
  const { portfolioId } = useParams<{ portfolioId: string }>()
  const navigate = useNavigate()
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', description: '', icon: 'folder' as GroupNavIconId })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!portfolioId) return
    setLoading(true)
    setError(null)
    api.portfolios
      .get(portfolioId)
      .then((p) => {
        setPortfolio(p)
        setForm({
          name: p.name,
          description: p.description ?? '',
          icon: resolvePortfolioNavIconId(p.icon),
        })
      })
      .catch(() => setError('Portfolio not found.'))
      .finally(() => setLoading(false))
  }, [portfolioId])

  const validationError = useMemo(() => {
    if (!form.name.trim()) return 'Name is required.'
    return null
  }, [form.name])

  const save = async () => {
    if (!portfolioId || validationError) {
      setError(validationError ?? 'Missing portfolio.')
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await api.portfolios.update(portfolioId, {
        name: form.name.trim(),
        description: form.description.trim() || null,
        icon: form.icon,
      })
      setSuccess('Portfolio updated.')
      window.dispatchEvent(new Event(PORTFOLIOS_UPDATED_EVENT))
    } catch (e: unknown) {
      setError(getFriendlyError(e, 'Failed to update portfolio.'))
    } finally {
      setSaving(false)
    }
  }

  const del = async () => {
    if (!portfolioId || !confirm('Delete this portfolio? All Asset Groups inside it will be removed.')) return
    setError(null)
    try {
      await api.portfolios.delete(portfolioId)
      window.dispatchEvent(new Event(PORTFOLIOS_UPDATED_EVENT))
      navigate('/', { replace: true })
    } catch (e: unknown) {
      setError(getFriendlyError(e, 'Failed to delete portfolio.'))
    }
  }

  if (loading) return <div className="page-loading">Loading portfolio…</div>
  if (!portfolioId || error === 'Portfolio not found.' || !portfolio) {
    return <div className="page-error">{error ?? 'Portfolio not found.'}</div>
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Edit portfolio</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn" type="button" onClick={() => navigate('/')}>
            Back
          </button>
          <button className="btn btn-danger" type="button" onClick={del}>
            Delete
          </button>
        </div>
      </div>

      {error && error !== 'Portfolio not found.' ? <div className="page-error">{error}</div> : null}
      {success ? <div className="page-success">{success}</div> : null}

      <div className="form-panel">
        <div className="form-grid">
          <div className="portfolio-edit__identity span-2">
            <div className="portfolio-edit__icon-field">
              <span className="portfolio-edit__icon-label" id="portfolio-edit-icon-label">
                Icon
              </span>
              <div aria-labelledby="portfolio-edit-icon-label">
                <PortfolioIconPicker value={form.icon} onChange={(icon) => setForm((f) => ({ ...f, icon }))} />
              </div>
            </div>
            <label className="portfolio-edit__name">
              Name *
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </label>
          </div>
          <label className="span-2">
            Description
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
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
