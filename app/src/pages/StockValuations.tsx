import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildStockValuationsAiPrompt } from '../components/aiImportPrompts'
import ImportJsonModal from '../components/ImportJsonModal'
import { ApiError, api } from '../api'
import type { JsonImportMode, SecurityValuation } from '../api'
import SortableFilterableTable, { type ColumnDef } from '../components/dataTable/SortableFilterableTable'
import { PORTFOLIOS_UPDATED_EVENT } from '../groupKinds'
import { displayTickerInTable, stockValuationNameDisplay } from '../securityDisplay'

type HoldingOption = {
  isin: string
  assetId?: string
  assetGroupId?: string
  portfolioId?: string
  label: string
}

type ValFormState = {
  isin: string
  date: string
  sharePrice: string
  note: string
}

function todayIsoDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function valFormEmpty(): ValFormState {
  return { isin: '', date: todayIsoDate(), sharePrice: '', note: '' }
}

const fmtSharePrice = (n: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 6, minimumFractionDigits: 2 }).format(n)

function err(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return fallback
}

async function loadAllSecurityHoldings(): Promise<HoldingOption[]> {
  const [portfolios, infoRows] = await Promise.all([api.portfolios.list(), api.securityInfo.list()])
  const byIsin = new Map<string, HoldingOption>()
  for (const r of infoRows) {
    const isin = r.isin.trim().toUpperCase()
    byIsin.set(isin, {
      isin,
      label: `${r.ticker} — ${r.name} (${isin})`,
    })
  }
  for (const p of portfolios) {
    for (const g of (p.assetGroups ?? []).filter((ag) => ag.kind === 'investments')) {
      const assets = await api.assets.list(g.id)
      for (const a of assets.filter((x) => x.category === 'securities' && x.isin?.trim())) {
        const isin = a.isin!.trim().toUpperCase()
        const sym = displayTickerInTable(a)
        byIsin.set(isin, {
          isin,
          assetId: a.id,
          assetGroupId: g.id,
          portfolioId: p.id,
          label: `${p.name} → ${g.name} — ${sym} (${isin})`,
        })
      }
    }
  }
  const out = [...byIsin.values()]
  out.sort((x, y) => x.label.localeCompare(y.label, undefined, { sensitivity: 'base' }))
  return out
}

export default function StockValuations() {
  const [rows, setRows] = useState<SecurityValuation[]>([])
  const [holdings, setHoldings] = useState<HoldingOption[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [valForm, setValForm] = useState(() => valFormEmpty())
  const [valEditing, setValEditing] = useState<SecurityValuation | null>(null)
  const [valPanelOpen, setValPanelOpen] = useState(false)
  const [valSaving, setValSaving] = useState(false)
  const [importJsonOpen, setImportJsonOpen] = useState(false)
  const [pastedJson, setPastedJson] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMode, setImportMode] = useState<JsonImportMode>('add')

  const load = useCallback(async () => {
    setLoading(true)
    setPageError(null)
    try {
      const [vals, hol] = await Promise.all([api.securityValuations.list(), loadAllSecurityHoldings()])
      setRows(vals)
      setHoldings(hol)
    } catch {
      setPageError('Could not load stock valuations.')
      setRows([])
      setHoldings([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    window.addEventListener(PORTFOLIOS_UPDATED_EVENT, load)
    return () => window.removeEventListener(PORTFOLIOS_UPDATED_EVENT, load)
  }, [load])

  const valValidation = useMemo(() => {
    if (!valForm.isin) return 'Security is required.'
    if (!valForm.date) return 'Date is required.'
    if (Number.isNaN(Number(valForm.sharePrice)) || Number(valForm.sharePrice) < 0) return 'Share price must be a number (≥ 0).'
    return null
  }, [valForm])

  const openValCreate = () => {
    setValForm({
      ...valFormEmpty(),
      isin: holdings[0]?.isin ?? '',
    })
    setValEditing(null)
    setValPanelOpen(true)
    setBanner(null)
  }

  const openValEdit = useCallback((v: SecurityValuation) => {
    setValForm({
      isin: v.isin,
      date: v.date.slice(0, 10),
      sharePrice: String(v.sharePrice),
      note: v.note ?? '',
    })
    setValEditing(v)
    setValPanelOpen(true)
    setBanner(null)
  }, [])

  const closeValPanel = () => {
    setValPanelOpen(false)
    setValEditing(null)
    setValForm(valFormEmpty())
  }

  const saveVal = async () => {
    if (valValidation) {
      setBanner({ type: 'err', text: valValidation })
      return
    }
    setValSaving(true)
    setBanner(null)
    try {
      const iso = new Date(valForm.date + 'T12:00:00').toISOString()
      const payload = {
        isin: valForm.isin,
        date: iso,
        sharePrice: parseFloat(valForm.sharePrice),
        note: valForm.note.trim() || null,
      }
      if (valEditing) await api.securityValuations.update(valEditing.id, payload)
      else await api.securityValuations.create(payload)
      setBanner({ type: 'ok', text: valEditing ? 'Valuation updated.' : 'Valuation added.' })
      closeValPanel()
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to save valuation.') })
    } finally {
      setValSaving(false)
    }
  }

  const getStockValuationsAiPrompt = useCallback(
    () => buildStockValuationsAiPrompt(holdings.map((h) => ({ assetId: h.isin, label: h.label }))),
    [holdings],
  )

  const runJsonImport = async () => {
    const t = pastedJson.trim()
    if (!t) {
      setBanner({ type: 'err', text: 'Paste JSON first.' })
      return
    }
    setImporting(true)
    setBanner(null)
    try {
      const out = await api.securityValuations.importJson(t, importMode)
      setPastedJson('')
      setBanner({
        type: 'ok',
        text: `Imported ${out.importedRowCount} row(s); ${out.totalRows} total marks${importMode === 'replace' ? ' (replaced all marks).' : '.'}`,
      })
      setImportJsonOpen(false)
      await load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Import failed.') })
    } finally {
      setImporting(false)
    }
  }

  const delVal = useCallback(async (id: string) => {
    if (!confirm('Delete this valuation? Dashboard value uses the latest remaining mark per line.')) return
    try {
      await api.securityValuations.delete(id)
      setBanner({ type: 'ok', text: 'Valuation deleted.' })
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to delete.') })
    }
  }, [load])

  const valuationColumns = useMemo<ColumnDef<SecurityValuation>[]>(
    () => [
      {
        id: 'date',
        header: 'Date',
        getSortValue: (v) => new Date(v.date),
        getFilterValue: () => '',
        filter: { type: 'none' },
        cell: (v) => new Date(v.date).toLocaleDateString(),
      },
      {
        id: 'name',
        header: 'Name',
        getSortValue: (v) => {
          const d = stockValuationNameDisplay(v)
          return [d.primary, d.ticker, d.isin].filter(Boolean).join(' ')
        },
        getFilterValue: (v) => v.isin,
        filter: {
          type: 'select',
          getOptions: (all) => {
            const byId = new Map<string, string>()
            for (const r of all) {
              const d = stockValuationNameDisplay(r)
              const label = [d.primary, d.ticker, d.isin].filter(Boolean).join(' — ')
              byId.set(r.isin, label)
            }
            const entries = [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
            return [{ value: '', label: 'All securities' }, ...entries.map(([id, label]) => ({ value: id, label }))]
          },
        },
        cell: (v) => {
          const d = stockValuationNameDisplay(v)
          return (
            <div className="holding-table-name">
              <div className="holding-table-name__primary">{d.primary}</div>
              {d.ticker || d.isin ? (
                <div className="holding-table-name__sub">
                  {d.ticker ? <span className="holding-table-name__ticker">{d.ticker}</span> : null}
                  {d.isin ? <span className="holding-table-name__isin">{d.isin}</span> : null}
                </div>
              ) : null}
            </div>
          )
        },
      },
      {
        id: 'sharePrice',
        header: 'Share price',
        getSortValue: (v) => v.sharePrice,
        getFilterValue: () => '',
        filter: { type: 'none' },
        cell: (v) => {
          const cur = v.currency ?? v.asset?.currency ?? 'USD'
          return fmtSharePrice(v.sharePrice, cur)
        },
      },
      {
        id: 'note',
        header: 'Note',
        getSortValue: (v) => v.note ?? '',
        getFilterValue: () => '',
        filter: { type: 'none' },
        cell: (v) => v.note ?? '—',
      },
      {
        id: 'actions',
        header: '\u00a0',
        sortable: false,
        getSortValue: () => '',
        getFilterValue: () => '',
        filter: { type: 'none' },
        tdClassName: 'actions',
        cell: (v) => (
          <>
            <button className="btn btn-sm" type="button" onClick={() => openValEdit(v)}>
              Edit
            </button>
            <button className="btn btn-sm btn-danger" type="button" onClick={() => delVal(v.id)}>
              Delete
            </button>
          </>
        ),
      },
    ],
    [openValEdit, delVal],
  )

  if (loading) return <div className="page-loading">Loading stock valuations…</div>
  if (pageError) return <div className="page-error">{pageError}</div>

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">All portfolios</p>
          <h1>Stock Valuations</h1>
          <p className="page-subtitle">
            Manual per-share marks for any securities holding. These are <strong>not</strong> trades — record trades from each
            investments Asset Group hub. The <strong>latest</strong> mark × shares held drives totals on the dashboard.
          </p>
        </div>
        <button className="btn btn-primary" type="button" onClick={openValCreate} disabled={holdings.length === 0}>
          + Add valuation
        </button>
      </div>

      {banner?.type === 'err' ? <div className="page-error">{banner.text}</div> : null}
      {banner?.type === 'ok' ? <div className="page-success">{banner.text}</div> : null}

      <ImportJsonModal
        open={importJsonOpen}
        title="Import JSON — stock valuations"
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
        getAiPrompt={getStockValuationsAiPrompt}
        radioName="sv-import-mode"
      />

      <div>
        <button type="button" className="btn" onClick={() => setImportJsonOpen(true)}>
          Import JSON…
        </button>
      </div>

      {holdings.length === 0 ? (
        <div className="empty-state">
          No securities holdings yet. Add an investments Asset Group and record a purchase from that Asset Group hub to open a line.
        </div>
      ) : null}

      {valPanelOpen ? (
        <div
          className="valuation-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeValPanel()
          }}
        >
          <div
            className="valuation-modal valuation-modal--stock-valuations"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sv-valuation-modal-title"
          >
            <div className="valuation-modal__head">
              <h2 id="sv-valuation-modal-title">{valEditing ? 'Edit valuation' : 'Add valuation'}</h2>
              <button className="btn btn-sm valuation-modal__close" type="button" onClick={closeValPanel} aria-label="Close">
                ×
              </button>
            </div>
            <div className="form-grid">
              <label className="span-2">
                Security *
                <select value={valForm.isin} onChange={(e) => setValForm((f) => ({ ...f, isin: e.target.value }))}>
                  <option value="">Select…</option>
                  {holdings.map((h) => (
                    <option key={h.isin} value={h.isin}>
                      {h.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Date *
                <input type="date" value={valForm.date} onChange={(e) => setValForm((f) => ({ ...f, date: e.target.value }))} />
              </label>
              <label className="span-2">
                Share price (your mark) *
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={valForm.sharePrice}
                  onChange={(e) => setValForm((f) => ({ ...f, sharePrice: e.target.value }))}
                />
              </label>
              <label className="span-2">
                Note
                <input value={valForm.note} onChange={(e) => setValForm((f) => ({ ...f, note: e.target.value }))} />
              </label>
            </div>
            {valValidation ? <p className="inline-hint inline-error">{valValidation}</p> : null}
            <div className="form-actions">
              <button className="btn" type="button" onClick={closeValPanel}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void saveVal()} disabled={Boolean(valValidation) || valSaving}>
                {valSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {holdings.length === 0 ? null : rows.length === 0 ? (
        <div className="empty-state">No valuations yet. Add marks when you want dated per-share values.</div>
      ) : (
        <section className="stack">
          <SortableFilterableTable
            rows={rows}
            columns={valuationColumns}
            getRowKey={(v) => v.id}
            defaultSort={{ columnId: 'date', direction: 'desc' }}
            emptyFilteredMessage="No valuations to display."
            emptyAfterFilterMessage="No rows match the current filters."
          />
        </section>
      )}
    </div>
  )
}
