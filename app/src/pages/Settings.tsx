import { useEffect, useMemo, useState } from 'react'
import { ApiError, api } from '../api'
import type { Settings } from '../api'
import { applyTheme, normalizeTheme, type AppTheme } from '../theme'

function getFriendlyError(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    if (error.status >= 500) return 'The server had trouble saving your settings.'
    return error.message
  }
  if (error instanceof Error) return error.message
  return fallback
}

function isoCodeError(label: string, raw: string) {
  const t = raw.trim().toUpperCase()
  if (t.length !== 3) return `${label} must be a 3-letter ISO 4217 code.`
  return null
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [baseCurrency, setBaseCurrency] = useState('EUR')
  const [displayCurrency, setDisplayCurrency] = useState('EUR')
  const [theme, setTheme] = useState<AppTheme>('light')
  const [staleMonths, setStaleMonths] = useState('3')
  const [loanEndWarnMonths, setLoanEndWarnMonths] = useState('3')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const validationError = useMemo(() => {
    const e1 = isoCodeError('Base currency', baseCurrency)
    if (e1) return e1
    const e2 = isoCodeError('Display currency (dashboard default)', displayCurrency)
    if (e2) return e2
    const st = staleMonths.trim()
    if (st === '') return 'Enter number of months for stale data reminder (1–120).'
    const m = parseInt(st, 10)
    if (Number.isNaN(m) || m < 1 || m > 120) return 'Stale reminder must be a whole number from 1 to 120 months.'
    const le = loanEndWarnMonths.trim()
    if (le === '') return 'Enter number of months for mortgage loan end reminder (1–120).'
    const lm = parseInt(le, 10)
    if (Number.isNaN(lm) || lm < 1 || lm > 120) return 'Mortgage loan end reminder must be a whole number from 1 to 120 months.'
    return null
  }, [baseCurrency, displayCurrency, staleMonths, loanEndWarnMonths])

  useEffect(() => {
    api.settings
      .get()
      .then((data) => {
        setSettings(data)
        setBaseCurrency(data.baseCurrency)
        setDisplayCurrency((data.displayCurrency ?? data.baseCurrency).trim().toUpperCase() || data.baseCurrency)
        setTheme(normalizeTheme(data.theme))
        setStaleMonths(String(data.staleAssetWarningMonths ?? 3))
        setLoanEndWarnMonths(String(data.mortgageLoanEndWarningMonths ?? 3))
      })
      .catch((e: unknown) => setError(getFriendlyError(e, 'Failed to load settings.')))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(null)

    const base = baseCurrency.trim().toUpperCase()
    const disp = displayCurrency.trim().toUpperCase()

    try {
      const updated = await api.settings.update({
        baseCurrency: base,
        displayCurrency: disp,
        theme,
        staleAssetWarningMonths: parseInt(staleMonths.trim(), 10),
        mortgageLoanEndWarningMonths: parseInt(loanEndWarnMonths.trim(), 10),
      })
      setSettings(updated)
      setBaseCurrency(updated.baseCurrency)
      setDisplayCurrency((updated.displayCurrency ?? updated.baseCurrency).trim().toUpperCase() || updated.baseCurrency)
      setTheme(normalizeTheme(updated.theme))
      applyTheme(normalizeTheme(updated.theme))
      setStaleMonths(String(updated.staleAssetWarningMonths ?? 3))
      setLoanEndWarnMonths(String(updated.mortgageLoanEndWarningMonths ?? 3))
      setSuccess('Settings saved.')
    } catch (e: unknown) {
      setError(getFriendlyError(e, 'Failed to save settings.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="page-loading">Loading settings…</div>

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Preferences</h1>
        </div>
      </div>

      {error ? <div className="page-error">{error}</div> : null}
      {success ? <div className="page-success">{success}</div> : null}

      <div className="panel settings-panel">
        <h2>Application</h2>
        <div className="form-grid settings-grid">
          <label className="span-2">
            Base currency
            <input
              value={baseCurrency}
              maxLength={3}
              onChange={(e) => setBaseCurrency(e.target.value.toUpperCase())}
              placeholder="EUR"
              title="ISO 4217 code. All positions are converted into this currency for totals, dashboard, and group statistics."
            />
          </label>
          <label className="span-2">
            Display currency
            <input
              value={displayCurrency}
              maxLength={3}
              onChange={(e) => setDisplayCurrency(e.target.value.toUpperCase())}
              placeholder="EUR"
              title="Default currency pre-selected on the Dashboard. Set equal to base currency to show aggregated amounts without an extra conversion step."
            />
          </label>
          <label className="span-2">
            Theme
            <select value={theme} onChange={(e) => setTheme(normalizeTheme(e.target.value))} aria-label="Theme">
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>

        {settings && (
          <div className="meta-list">
            <div>
              <span className="label">Created</span>
              <strong>{new Date(settings.createdAt).toLocaleString()}</strong>
            </div>
            <div>
              <span className="label">Updated</span>
              <strong>{new Date(settings.updatedAt).toLocaleString()}</strong>
            </div>
          </div>
        )}
      </div>

      <div className="panel settings-panel">
        <h2>Notifications</h2>
        <p className="page-subtitle" style={{ marginTop: 0 }}>
          The title bar bell lists unsaved changes, stale marks, and upcoming or past mortgage loan end dates. For each
          real-estate property you get separate checks: the latest <strong>valuation as-of date</strong> and (when you
          track a loan) the latest <strong>mortgage as-of date</strong> must fall within the stale window below. General
          non-securities assets use their latest valuation as-of date. Each loan’s <strong>end date</strong> (contract /
          term end) is compared to the second window below.
        </p>
        <div className="form-grid settings-grid">
          <label className="span-2">
            Notify when marks are older than (months)
            <input
              inputMode="numeric"
              value={staleMonths}
              onChange={(e) => setStaleMonths(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="3"
              title="Valuation and mortgage marks use their as-of date field. Range 1–120; default 3. Mortgage reminders apply when there are mortgage rows or a monthly mortgage payment is set."
            />
          </label>
          <label className="span-2">
            Notify when a mortgage loan term ends within (months)
            <input
              inputMode="numeric"
              value={loanEndWarnMonths}
              onChange={(e) => setLoanEndWarnMonths(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="3"
              title="Uses each property loan’s end date. You are notified if the term has already passed or ends on or before this many months from today. Placeholder end dates (2090 and later) are ignored. Range 1–120; default 3."
            />
          </label>
        </div>
      </div>

      {validationError ? <p className="inline-hint inline-error" style={{ margin: '0 0.15rem' }}>{validationError}</p> : null}

      <div className="form-actions" style={{ paddingLeft: '0.15rem' }}>
        <button className="btn btn-primary" onClick={save} disabled={saving || Boolean(validationError)}>
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
    </div>
  )
}
