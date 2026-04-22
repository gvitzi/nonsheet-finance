import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PortfolioIconPicker from '../components/PortfolioIconPicker'
import { ApiError, api } from '../api'
import { PORTFOLIOS_UPDATED_EVENT } from '../groupKinds'
import type { GroupNavIconId } from '../groupNavIcons'
import { assetGroupNewPath } from '../portfolioPaths'

function getFriendlyError(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    if (error.status >= 500) return 'The server had trouble saving the portfolio.'
    return error.message
  }
  if (error instanceof Error) return error.message
  return fallback
}

export default function PortfolioNew() {
  const navigate = useNavigate()
  const [name, setName] = useState('My portfolio')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState<GroupNavIconId>('folder')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validationError = useMemo(() => {
    if (!name.trim()) return 'Name is required.'
    return null
  }, [name])

  const save = async () => {
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const p = await api.portfolios.create({
        name: name.trim(),
        description: description.trim() || null,
        icon,
      })
      window.dispatchEvent(new Event(PORTFOLIOS_UPDATED_EVENT))
      navigate(assetGroupNewPath(p.id), { replace: true })
    } catch (e: unknown) {
      setError(getFriendlyError(e, 'Failed to create portfolio.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>New portfolio</h1>
        <button className="btn" type="button" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </div>

      {error ? <div className="page-error">{error}</div> : null}

      <div className="form-panel">
        <p className="page-subtitle">A portfolio groups related Asset Groups (for example securities and cash in one household view).</p>
        <div className="form-grid">
          <div className="portfolio-edit__identity span-2">
            <div className="portfolio-edit__icon-field">
              <span className="portfolio-edit__icon-label" id="portfolio-new-icon-label">
                Icon
              </span>
              <div aria-labelledby="portfolio-new-icon-label">
                <PortfolioIconPicker value={icon} onChange={setIcon} />
              </div>
            </div>
            <label className="portfolio-edit__name">
              Name *
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
          </div>
          <label className="span-2">
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>
        {validationError ? <p className="inline-hint inline-error">{validationError}</p> : null}
        <div className="form-actions">
          <button className="btn btn-primary" type="button" onClick={save} disabled={Boolean(validationError) || saving}>
            {saving ? 'Creating…' : 'Create portfolio'}
          </button>
        </div>
      </div>
    </div>
  )
}
