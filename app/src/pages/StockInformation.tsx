import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildStockInformationAiPrompt } from '../components/aiImportPrompts'
import ImportJsonModal from '../components/ImportJsonModal'
import { ApiError, api } from '../api'
import type { JsonImportMode, SecurityInfoRecord } from '../api'
import SortableFilterableTable, { type ColumnDef } from '../components/dataTable/SortableFilterableTable'

type EditDraft = {
  originalIsin: string
  isin: string
  ticker: string
  name: string
  currency: string
}

const emptyAdd = (): { isin: string; ticker: string; name: string; currency: string } => ({
  isin: '',
  ticker: '',
  name: '',
  currency: 'EUR',
})

function err(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return fallback
}

function fmtUpdated(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export default function StockInformation() {
  const [rows, setRows] = useState<SecurityInfoRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [draft, setDraft] = useState<EditDraft | null>(null)
  const [addForm, setAddForm] = useState(emptyAdd)
  const [saving, setSaving] = useState(false)
  const [importJsonOpen, setImportJsonOpen] = useState(false)
  const [pastedJson, setPastedJson] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMode, setImportMode] = useState<JsonImportMode>('add')

  const load = useCallback(async () => {
    setLoading(true)
    setPageError(null)
    try {
      const list = await api.securityInfo.list()
      setRows(list)
    } catch {
      setPageError('Could not load stock reference data.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const startEdit = useCallback((r: SecurityInfoRecord) => {
    setBanner(null)
    setDraft({
      originalIsin: r.isin,
      isin: r.isin,
      ticker: r.ticker,
      name: r.name,
      currency: r.currency,
    })
  }, [])

  const cancelEdit = useCallback(() => {
    setDraft(null)
  }, [])

  const saveEdit = useCallback(async () => {
    if (!draft) return
    const { originalIsin, isin, ticker, name, currency } = draft
    if (!isin.trim() || !ticker.trim() || !name.trim() || !currency.trim()) {
      setBanner({ type: 'err', text: 'ISIN, ticker, name, and currency are required.' })
      return
    }
    setSaving(true)
    setBanner(null)
    try {
      await api.securityInfo.update(originalIsin, { isin: isin.trim().toUpperCase(), ticker, name, currency })
      setDraft(null)
      setBanner({ type: 'ok', text: 'Saved.' })
      await load()
    } catch (e) {
      setBanner({ type: 'err', text: err(e, 'Save failed.') })
    } finally {
      setSaving(false)
    }
  }, [draft, load])

  const remove = useCallback(
    async (isin: string) => {
      if (!window.confirm(`Delete reference ${isin} and all dated marks for it in the stock database?`)) return
      setBanner(null)
      try {
        await api.securityInfo.delete(isin)
        setBanner({ type: 'ok', text: 'Deleted.' })
        if (draft?.originalIsin === isin) setDraft(null)
        await load()
      } catch (e) {
        setBanner({ type: 'err', text: err(e, 'Delete failed.') })
      }
    },
    [draft, load],
  )

  const getStockInfoAiPrompt = useCallback(
    () =>
      buildStockInformationAiPrompt(
        rows.map((r) => ({ isin: r.isin, ticker: r.ticker, name: r.name, currency: r.currency })),
      ),
    [rows],
  )

  const runJsonImport = useCallback(async () => {
    const t = pastedJson.trim()
    if (!t) {
      setBanner({ type: 'err', text: 'Paste JSON first.' })
      return
    }
    setImporting(true)
    setBanner(null)
    try {
      const out = await api.securityInfo.importJson(t, importMode)
      setPastedJson('')
      setBanner({
        type: 'ok',
        text: `Imported ${out.importedRowCount} row(s); ${out.totalRows} total reference rows${importMode === 'replace' ? ' (replaced entire table).' : '.'}`,
      })
      setImportJsonOpen(false)
      await load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Import failed.') })
    } finally {
      setImporting(false)
    }
  }, [pastedJson, importMode, load])

  const submitAdd = useCallback(async () => {
    const { isin, ticker, name, currency } = addForm
    if (!isin.trim() || !ticker.trim() || !name.trim() || !currency.trim()) {
      setBanner({ type: 'err', text: 'Fill all fields to add a reference row.' })
      return
    }
    setSaving(true)
    setBanner(null)
    try {
      await api.securityInfo.create({
        isin: isin.trim().toUpperCase(),
        ticker: ticker.trim(),
        name: name.trim(),
        currency: currency.trim().toUpperCase(),
      })
      setAddForm(emptyAdd())
      setBanner({ type: 'ok', text: 'Reference added.' })
      await load()
    } catch (e) {
      setBanner({ type: 'err', text: err(e, 'Could not add row.') })
    } finally {
      setSaving(false)
    }
  }, [addForm, load])

  const columns = useMemo((): ColumnDef<SecurityInfoRecord>[] => {
    const isEditing = (r: SecurityInfoRecord) => draft?.originalIsin === r.isin

    return [
      {
        id: 'isin',
        header: 'ISIN',
        getSortValue: (r) => r.isin,
        getFilterValue: (r) => r.isin,
        filter: { type: 'text', placeholder: 'ISIN…' },
        cell: (r) =>
          isEditing(r) ? (
            <input
              className="table-filter-input"
              value={draft!.isin}
              onChange={(e) => setDraft((d) => (d ? { ...d, isin: e.target.value } : d))}
              aria-label="ISIN"
            />
          ) : (
            <code>{r.isin}</code>
          ),
      },
      {
        id: 'ticker',
        header: 'Ticker',
        getSortValue: (r) => r.ticker,
        getFilterValue: (r) => r.ticker,
        filter: { type: 'text', placeholder: 'Ticker…' },
        cell: (r) =>
          isEditing(r) ? (
            <input
              className="table-filter-input"
              value={draft!.ticker}
              onChange={(e) => setDraft((d) => (d ? { ...d, ticker: e.target.value } : d))}
              aria-label="Ticker"
            />
          ) : (
            <strong>{r.ticker}</strong>
          ),
      },
      {
        id: 'name',
        header: 'Name',
        getSortValue: (r) => r.name,
        getFilterValue: (r) => `${r.name} ${r.ticker}`,
        filter: { type: 'text', placeholder: 'Name…' },
        cell: (r) =>
          isEditing(r) ? (
            <input
              className="table-filter-input"
              value={draft!.name}
              onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
              aria-label="Security name"
            />
          ) : (
            r.name
          ),
      },
      {
        id: 'currency',
        header: 'CCY',
        getSortValue: (r) => r.currency,
        getFilterValue: (r) => r.currency,
        filter: { type: 'text', placeholder: '…' },
        cell: (r) =>
          isEditing(r) ? (
            <input
              className="table-filter-input"
              value={draft!.currency}
              onChange={(e) => setDraft((d) => (d ? { ...d, currency: e.target.value } : d))}
              aria-label="Currency"
              maxLength={8}
            />
          ) : (
            r.currency
          ),
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        getSortValue: (r) => r.updatedAt,
        getFilterValue: () => '',
        filter: { type: 'none' },
        cell: (r) => (
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{fmtUpdated(r.updatedAt)}</span>
        ),
      },
      {
        id: 'actions',
        header: '\u00a0',
        sortable: false,
        getSortValue: () => '',
        getFilterValue: () => '',
        filter: { type: 'none' },
        tdClassName: 'actions',
        cell: (r) =>
          isEditing(r) ? (
            <>
              <button className="btn btn-sm btn-primary" type="button" onClick={saveEdit} disabled={saving}>
                {saving ? '…' : 'Save'}
              </button>
              <button className="btn btn-sm" type="button" onClick={cancelEdit} disabled={saving}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-sm" type="button" onClick={() => startEdit(r)} disabled={Boolean(draft)}>
                Edit
              </button>
              <button className="btn btn-sm btn-danger" type="button" onClick={() => remove(r.isin)} disabled={Boolean(draft)}>
                Delete
              </button>
            </>
          ),
      },
    ]
  }, [draft, remove, saveEdit, cancelEdit, startEdit, saving])

  if (loading) return <div className="page-loading">Loading stock information…</div>
  if (pageError) return <div className="page-error">{pageError}</div>

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Local stock database</p>
          <h1>Stock Information</h1>
          <p className="page-subtitle">
            Map each <strong>ISIN</strong> to a <strong>ticker</strong> and display <strong>name</strong>. This table backs labels in
            Stock Valuations and securities hubs; changing an ISIN here also rewrites matching holdings in your portfolios.
          </p>
        </div>
      </div>

      {banner?.type === 'err' ? <div className="page-error">{banner.text}</div> : null}
      {banner?.type === 'ok' ? <div className="page-success">{banner.text}</div> : null}

      <ImportJsonModal
        open={importJsonOpen}
        title="Import JSON — stock information"
        pastedJson={pastedJson}
        onPastedJsonChange={setPastedJson}
        importMode={importMode}
        onImportModeChange={setImportMode}
        importing={importing}
        onClose={() => {
          setImportJsonOpen(false)
          setBanner(null)
        }}
        onImport={() => void runJsonImport()}
        getAiPrompt={getStockInfoAiPrompt}
        radioName="si-import-mode"
      />

      <div>
        <button type="button" className="btn" onClick={() => setImportJsonOpen(true)}>
          Import JSON…
        </button>
      </div>

      <section className="form-panel">
        <h2>Add reference</h2>
        <div className="form-grid">
          <label>
            ISIN *
            <input
              value={addForm.isin}
              onChange={(e) => setAddForm((f) => ({ ...f, isin: e.target.value }))}
              placeholder="e.g. US67066G1040"
              autoComplete="off"
            />
          </label>
          <label>
            Ticker *
            <input
              value={addForm.ticker}
              onChange={(e) => setAddForm((f) => ({ ...f, ticker: e.target.value }))}
              placeholder="NVDA"
              autoComplete="off"
            />
          </label>
          <label className="span-2">
            Name *
            <input
              value={addForm.name}
              onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Issuer / security name"
              autoComplete="off"
            />
          </label>
          <label>
            Currency *
            <input
              value={addForm.currency}
              onChange={(e) => setAddForm((f) => ({ ...f, currency: e.target.value }))}
              placeholder="USD"
              maxLength={8}
            />
          </label>
          <div className="form-actions span-2">
            <button className="btn btn-primary" type="button" onClick={submitAdd} disabled={saving || Boolean(draft)}>
              Add row
            </button>
          </div>
        </div>
      </section>

      <section className="stack">
        {rows.length === 0 ? (
          <div className="empty-state">No reference rows yet. Add an ISIN above, or create a valuation from a holding (which seeds a row).</div>
        ) : (
          <SortableFilterableTable
            rows={rows}
            columns={columns}
            getRowKey={(r) => r.isin}
            defaultSort={{ columnId: 'isin', direction: 'asc' }}
            emptyFilteredMessage="No rows to display."
            emptyAfterFilterMessage="No rows match the current filters."
          />
        )}
      </section>
    </div>
  )
}
