import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FxRateRecord } from '@nonsheet-finance/core'
import { buildFxRatesAiPrompt } from '../components/aiImportPrompts'
import ImportJsonModal from '../components/ImportJsonModal'
import { ApiError, api } from '../api'
import type { JsonImportMode } from '../api'

/**
 * FX rows: explicit **fromCurrency → toCurrency** with **rate** = units of To per 1 From
 * (`amountTo = amountFrom * rate`).
 */
export default function FxRates() {
  const [rows, setRows] = useState<FxRateRecord[]>([])
  const [baseCurrency, setBaseCurrency] = useState('EUR')
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    fromCurrency: 'EUR',
    toCurrency: 'USD',
    rate: '1.08',
  })
  const [error, setError] = useState<string | null>(null)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importJsonOpen, setImportJsonOpen] = useState(false)
  const [importMode, setImportMode] = useState<JsonImportMode>('add')
  const [pastedJson, setPastedJson] = useState('')
  const seededFromBase = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [fx, settings] = await Promise.all([api.fxRates.list(), api.settings.get()])
      setRows(fx as FxRateRecord[])
      setBaseCurrency(settings.baseCurrency.trim().toUpperCase() || 'EUR')
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

  useEffect(() => {
    if (loading || seededFromBase.current) return
    seededFromBase.current = true
    setForm((f) => ({ ...f, fromCurrency: baseCurrency }))
  }, [loading, baseCurrency])

  const sorted = useMemo(() => [...rows].sort((a, b) => b.date.localeCompare(a.date)), [rows])

  const addRow = async () => {
    setError(null)
    setImportMessage(null)
    const rate = Number(form.rate)
    const fromC = form.fromCurrency.trim().toUpperCase()
    const toC = form.toCurrency.trim().toUpperCase()
    if (!fromC || !toC || Number.isNaN(rate) || rate <= 0) {
      setError('Enter valid From and To currency codes and a positive rate.')
      return
    }
    if (fromC === toC) {
      setError('From and To must be different currencies.')
      return
    }
    try {
      await api.fxRates.create({ date: form.date, fromCurrency: fromC, toCurrency: toC, rate })
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
            Each row is an explicit <strong>From → To</strong> quote: <strong>1 From = rate × To</strong> (stored as{' '}
            <strong>fromCurrency</strong>, <strong>toCurrency</strong>, <strong>rate</strong>). Dashboard totals use your
            base currency (<strong>{baseCurrency}</strong>); conversion walks these pairs (including inverse hops).
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
              <input
                maxLength={8}
                value={form.fromCurrency}
                onChange={(e) => setForm((f) => ({ ...f, fromCurrency: e.target.value.toUpperCase() }))}
                title="From currency (ISO code)"
                placeholder="EUR"
                aria-label="From currency"
              />
              <span className="fx-add-rate-form__arrow" aria-hidden>
                →
              </span>
              <input
                maxLength={8}
                value={form.toCurrency}
                onChange={(e) => setForm((f) => ({ ...f, toCurrency: e.target.value.toUpperCase() }))}
                title="To currency (ISO code)"
                placeholder="USD"
                aria-label="To currency"
              />
            </div>
          </label>
          <label>
            Rate (1 From = … To)
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
            No FX rows yet. Dashboard and group charts assume raw numbers match the aggregation currency until you add
            quotes.
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
                    <strong>{r.fromCurrency}</strong>
                    <span aria-hidden> → </span>
                    <strong>{r.toCurrency}</strong>
                  </td>
                  <td>
                    1 {r.fromCurrency} = {r.rate} {r.toCurrency}
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
