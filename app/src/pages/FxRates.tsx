import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FxRateRecord } from '@nonsheet-finance/core'
import { FX_STORAGE_BASE_CURRENCY } from '@nonsheet-finance/core'
import { buildFxRatesAiPrompt } from '../components/aiImportPrompts'
import ImportJsonModal from '../components/ImportJsonModal'
import { ApiError, api } from '../api'
import type { JsonImportMode } from '../api'

/**
 * FX rows: `rate` = units of `currency` (the **To** side) per **1 From** (USD pivot in storage).
 * The UI labels each row as From → To so the quote is unambiguous.
 */
export default function FxRates() {
  const [rows, setRows] = useState<FxRateRecord[]>([])
  const [baseCurrency, setBaseCurrency] = useState('EUR')
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), currency: 'EUR', rate: '0.92' })
  const [error, setError] = useState<string | null>(null)
  const [pastedJson, setPastedJson] = useState('')
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importJsonOpen, setImportJsonOpen] = useState(false)
  const [importMode, setImportMode] = useState<JsonImportMode>('add')

  const fromLabel = FX_STORAGE_BASE_CURRENCY

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [fx, settings] = await Promise.all([api.fxRates.list(), api.settings.get()])
      setRows(fx as FxRateRecord[])
      setBaseCurrency(settings.baseCurrency)
    } catch {
      setError('Could not load FX rates.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sorted = useMemo(() => [...rows].sort((a, b) => b.date.localeCompare(a.date)), [rows])

  const addRow = async () => {
    setError(null)
    setImportMessage(null)
    const rate = Number(form.rate)
    const cur = form.currency.trim().toUpperCase()
    if (!form.currency.trim() || Number.isNaN(rate) || rate <= 0) {
      setError('Enter a valid “To” currency code and a positive rate.')
      return
    }
    if (cur === fromLabel) {
      setError(`${fromLabel} is the stored “From” pivot. Add rows for other currencies (the “To” side), as units of that currency per 1 USD.`)
      return
    }
    try {
      await api.fxRates.create({ date: form.date, currency: cur, rate })
      setForm((f) => ({ ...f, rate: '1' }))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  const remove = async (id: string) => {
    try {
      await api.fxRates.delete(id)
      await load()
    } catch {
      setError('Delete failed')
    }
  }

  const getFxAiPrompt = useCallback(() => buildFxRatesAiPrompt(baseCurrency), [baseCurrency])

  const runJsonImport = async () => {
    setError(null)
    setImportMessage(null)
    const t = pastedJson.trim()
    if (!t) {
      setError('Paste JSON first.')
      return
    }
    setImporting(true)
    try {
      const out = await api.fxRates.importJson(t, importMode)
      setPastedJson('')
      setImportMessage(
        `Imported ${out.importedRowCount} row(s); ${out.totalRows} total in document${importMode === 'replace' ? ' (replaced all rates).' : '.'}`,
      )
      setImportJsonOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  if (loading) return <div className="page-loading">Loading…</div>

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>FX rates</h1>
          <p className="page-subtitle">
            Each row is an explicit <strong>{fromLabel} → currency</strong> quote: <strong>1 {fromLabel} = rate × To</strong>{' '}
            (stored as units of <strong>To</strong> per 1 {fromLabel}). Totals are aggregated in your base currency (
            <strong>{baseCurrency}</strong>); these rows drive conversion via the USD pivot.
          </p>
        </div>
      </div>

      {error ? <div className="page-error">{error}</div> : null}
      {importMessage ? <div className="page-success">{importMessage}</div> : null}

      <div className="panel">
        <h2>Add rate</h2>
        <div className="form-grid fx-add-rate-form">
          <label>
            Date
            <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </label>
          <label>
            From → To
            <div className="fx-add-rate-form__pair">
              <span className="settings-readonly-value fx-add-rate-form__from" title="Storage pivot">
                {fromLabel}
              </span>
              <span className="fx-add-rate-form__arrow" aria-hidden>
                →
              </span>
              <input
                maxLength={8}
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                title="Target currency (ISO code)"
                placeholder="EUR"
              />
            </div>
          </label>
          <label>
            Rate (1 {fromLabel} = … To)
            <input inputMode="decimal" value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
          </label>
          <div className="form-actions fx-add-rate-form__actions">
            <button type="button" className="btn btn-primary" onClick={() => void addRow()}>
              Add
            </button>
          </div>
        </div>
      </div>

      <ImportJsonModal
        open={importJsonOpen}
        title="Import JSON — FX rates"
        pastedJson={pastedJson}
        onPastedJsonChange={setPastedJson}
        importMode={importMode}
        onImportModeChange={setImportMode}
        importing={importing}
        onClose={() => {
          setImportJsonOpen(false)
          setError(null)
        }}
        onImport={() => void runJsonImport()}
        getAiPrompt={getFxAiPrompt}
        radioName="fx-import-mode"
      />

      <div>
        <button type="button" className="btn" onClick={() => setImportJsonOpen(true)}>
          Import JSON…
        </button>
      </div>

      <div className="panel">
        <h2>Saved rates</h2>
        {sorted.length === 0 ? (
          <p className="page-subtitle">
            No FX rows yet. Dashboard and group charts assume raw numbers match the aggregation currency until you add quotes.
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>From → To</th>
                <th>Rate (1 From = … To)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id}>
                  <td>{r.date}</td>
                  <td>
                    <strong>{fromLabel}</strong>
                    <span aria-hidden> → </span>
                    <strong>{r.currency}</strong>
                  </td>
                  <td>
                    1 {fromLabel} = {r.rate} {r.currency}
                  </td>
                  <td>
                    <button type="button" className="btn btn-sm" onClick={() => void remove(r.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
