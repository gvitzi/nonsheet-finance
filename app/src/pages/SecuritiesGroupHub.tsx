import { type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../api'
import type { Asset, AssetGroup, SecurityTransaction, SecurityTxKind, SecurityValuation } from '../api'
import { PORTFOLIOS_UPDATED_EVENT, labelForGroupKind } from '../groupKinds'
import { assetGroupEditPath } from '../portfolioPaths'
import { chartLabelForSecurityHolding, displayTickerInTable, securityTablePrimaryName } from '../securityDisplay'
import { useDisplayMoney } from '../useDisplayMoney'
import StatsPanel from './StatsPanel'

const SECURITIES_CATEGORY = 'securities'

function todayIsoDate() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type SecurityOption = {
  isin: string
  /** Short symbol (from reference data or holding name). */
  ticker: string
  /** Long security / issuer name when known; omitted from layout when null or same as ticker. */
  issuerName: string | null
  currency: string
}

function labelsForSecurityRow(src: {
  name: string
  isin?: string | null
  ticker?: string | null
  securityName?: string | null
}): { ticker: string; issuerName: string | null; isin: string | null } {
  const ticker = (src.ticker?.trim() || src.name).trim()
  const issuerRaw = src.securityName?.trim()
  const issuerName = issuerRaw && issuerRaw !== ticker ? issuerRaw : null
  const isin = src.isin?.trim() || null
  return { ticker, issuerName, isin }
}

type TxFormState = {
  valIsin: string
  assetId: string
  kind: SecurityTxKind
  date: string
  quantity: string
  pricePerShare: string
  priceManual: boolean  // true = user typed the price; triggers valuation creation on save
  note: string
}

function txFormEmpty(): TxFormState {
  return { valIsin: '', assetId: '', kind: 'purchase', date: todayIsoDate(), quantity: '', pricePerShare: '', priceManual: false, note: '' }
}

const fmtMoney = (n: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)

const fmtSharePrice = (n: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 6, minimumFractionDigits: 2 }).format(n)

/** Holdings table “Marked share price”: at most 2 fraction digits. */
const fmtMarkedSharePriceTable = (n: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n)

const fmtShares = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 6, useGrouping: true }).format(n)

/** Holdings table quantity: at most 2 fraction digits. */
const fmtSharesTable = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0, useGrouping: true }).format(n)

function sharePriceForAsset(a: Asset): number | null {
  if (a.sharePrice != null && !Number.isNaN(a.sharePrice)) return a.sharePrice
  const q = a.position
  if (q == null || Number.isNaN(q) || q === 0) return null
  return a.estimatedValue / q
}

function marketValueForAsset(a: Asset): number | null {
  const q = a.position
  if (q == null || Number.isNaN(q)) return null
  const sp = sharePriceForAsset(a)
  if (sp == null || Number.isNaN(sp)) return null
  return q * sp
}

function err(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return fallback
}

function kindLabel(k: SecurityTxKind) {
  return k === 'purchase' ? 'Purchase' : 'Sale'
}

function SecurityPicker({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: SecurityOption[]
  value: string
  onChange: (isin: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selected = options.find((o) => o.isin === value)
  const q = search.trim().toLowerCase()

  const filtered = q
    ? options.filter(
        (o) =>
          o.ticker.toLowerCase().includes(q) ||
          (o.issuerName ?? '').toLowerCase().includes(q) ||
          (o.isin ?? '').toLowerCase().includes(q),
      )
    : options

  return (
    <div className="sec-picker" ref={containerRef}>
      <button
        type="button"
        className={`sec-picker__trigger${open ? ' sec-picker__trigger--open' : ''}${disabled ? ' sec-picker__trigger--disabled' : ''}`}
        onClick={() => { if (!disabled) setOpen((v) => !v) }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected ? (
          <span className="sec-picker__selected sec-picker__selected--stacked">
            <span className="sec-picker__ticker">{selected.ticker}</span>
            {selected.issuerName ? <span className="sec-picker__issuer">{selected.issuerName}</span> : null}
            {selected.isin ? <span className="sec-picker__isin sec-picker__isin--muted">{selected.isin}</span> : null}
          </span>
        ) : (
          <span className="sec-picker__placeholder">Select a security…</span>
        )}
        {!disabled && <span className="sec-picker__chevron" aria-hidden>▾</span>}
      </button>

      {open && (
        <div className="sec-picker__dropdown">
          <input
            autoFocus
            className="sec-picker__search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ticker, name, or ISIN…"
          />
          <ul className="sec-picker__list" role="listbox">
            {filtered.length === 0 ? (
              <li className="sec-picker__empty">No matches</li>
            ) : (
              filtered.map((o) => (
                <li
                  key={o.isin}
                  className={`sec-picker__option${o.isin === value ? ' sec-picker__option--active' : ''}`}
                  role="option"
                  aria-selected={o.isin === value}
                  onMouseDown={() => {
                    onChange(o.isin)
                    setOpen(false)
                    setSearch('')
                  }}
                >
                  <span className="sec-picker__option-ticker">{o.ticker}</span>
                  {o.issuerName ? <span className="sec-picker__option-issuer">{o.issuerName}</span> : null}
                  {o.isin ? <span className="sec-picker__option-isin">{o.isin}</span> : null}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

type Props = {
  group: AssetGroup
  portfolioId: string
  assetGroupId: string
}

export default function SecuritiesGroupHub({ group, portfolioId, assetGroupId }: Props) {
  const { displayCurrency, convert } = useDisplayMoney()
  const [rows, setRows] = useState<Asset[]>([])
  const [txRows, setTxRows] = useState<SecurityTransaction[]>([])
  const [allValuations, setAllValuations] = useState<SecurityValuation[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [txForm, setTxForm] = useState(() => txFormEmpty())
  const [txEditing, setTxEditing] = useState<SecurityTransaction | null>(null)
  const [txPanelOpen, setTxPanelOpen] = useState(false)
  const [txSaving, setTxSaving] = useState(false)

  const [moveAsset, setMoveAsset] = useState<Asset | null>(null)
  const [moveTargetId, setMoveTargetId] = useState('')
  const [sameKindGroups, setSameKindGroups] = useState<{ id: string; label: string }[]>([])
  const [moveSaving, setMoveSaving] = useState(false)

  const [tradesAccordionOpen, setTradesAccordionOpen] = useState(true)
  const onTradesAccordionToggle = useCallback((e: SyntheticEvent<HTMLDetailsElement>) => {
    const el = e.currentTarget
    if (el.open) setTradesAccordionOpen(true)
    else setTradesAccordionOpen(false)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setPageError(null)
    try {
      const [assetsList, txs, vals] = await Promise.all([
        api.assets.list(assetGroupId),
        api.securityTransactions.list(assetGroupId),
        api.securityValuations.list(),
      ])
      setRows(assetsList)
      setTxRows(txs)
      setAllValuations(vals)
    } catch {
      setPageError('Could not load holdings or trades.')
      setRows([])
      setTxRows([])
      setAllValuations([])
    } finally {
      setLoading(false)
    }
  }, [assetGroupId])

  useEffect(() => {
    load()
  }, [load])

  const statsPanelItems = useMemo(
    () =>
      rows.map((a) => ({
        id: a.id,
        name: chartLabelForSecurityHolding(a),
        value: convert(marketValueForAsset(a) ?? a.estimatedValue, a.currency),
      })),
    [rows, convert],
  )

  const holdingsFooterTotal = useMemo(() => {
    let sum = 0
    for (const a of rows) {
      sum += convert(marketValueForAsset(a) ?? a.estimatedValue, a.currency)
    }
    return {
      display: fmtMoney(sum, displayCurrency),
      title: `Totals converted to ${displayCurrency} (sum of market value per row). Quantity and price are not additive across holdings.`,
    }
  }, [rows, convert, displayCurrency])

  // Unique securities: global stock valuations + holdings in this group without valuations
  const securityOptions = useMemo((): SecurityOption[] => {
    const seen = new Map<string, SecurityOption>()
    for (const v of allValuations) {
      if (!v.asset || seen.has(v.isin)) continue
      const labels = labelsForSecurityRow(v.asset)
      seen.set(v.isin, {
        isin: v.isin,
        ticker: labels.ticker,
        issuerName: labels.issuerName,
        currency: v.currency,
      })
    }
    for (const a of rows) {
      const isin = a.isin?.trim().toUpperCase()
      if (!isin || seen.has(isin)) continue
      const labels = labelsForSecurityRow(a)
      seen.set(isin, { isin, ticker: labels.ticker, issuerName: labels.issuerName, currency: a.currency })
    }
    return Array.from(seen.values()).sort((a, b) => {
      const c = a.ticker.localeCompare(b.ticker)
      if (c !== 0) return c
      return (a.issuerName ?? '').localeCompare(b.issuerName ?? '')
    })
  }, [allValuations, rows])

  // Auto-fill price from latest valuation on or before the trade date (only when not manually set)
  const { valIsin, date: formDate } = txForm
  useEffect(() => {
    if (!valIsin || !formDate) return
    const matching = allValuations
      .filter((v) => v.isin === valIsin && v.date.slice(0, 10) <= formDate)
      .sort((a, b) => b.date.localeCompare(a.date))
    setTxForm((f) => ({ ...f, pricePerShare: matching[0] ? String(matching[0].sharePrice) : '', priceManual: false }))
  }, [valIsin, formDate, allValuations])

  const isNewToGroup = !txForm.assetId && Boolean(txForm.valIsin)

  const txValidation = useMemo(() => {
    if (!txForm.valIsin) return 'Select a security.'
    if (!txForm.date) return 'Date is required.'
    if (Number.isNaN(Number(txForm.quantity)) || Number(txForm.quantity) <= 0)
      return 'Quantity must be a positive number.'
    if (!txForm.pricePerShare || Number.isNaN(Number(txForm.pricePerShare)) || Number(txForm.pricePerShare) < 0)
      return 'Price per share is required.'
    if (!txEditing && isNewToGroup && txForm.kind === 'sale')
      return 'First trade for a new holding must be a purchase.'
    return null
  }, [txForm, txEditing, isNewToGroup])

  const openTxCreate = () => {
    setTxForm(txFormEmpty())
    setTxEditing(null)
    setTxPanelOpen(true)
    setBanner(null)
  }

  const applySecurityPick = (pickedIsin: string) => {
    const existingInGroup = rows.find((r) => r.isin?.trim().toUpperCase() === pickedIsin)
    setTxForm((f) => ({
      ...f,
      valIsin: pickedIsin,
      assetId: existingInGroup ? existingInGroup.id : '',
      kind: 'purchase',
      pricePerShare: '', // filled by effect
      priceManual: false,
    }))
  }

  const openTxEdit = (t: SecurityTransaction) => {
    const holding = rows.find((r) => r.id === t.assetId)
    setTxForm({
      valIsin: holding?.isin?.trim().toUpperCase() ?? '',
      assetId: t.assetId,
      kind: t.kind,
      date: t.date.slice(0, 10),
      quantity: String(t.quantity),
      pricePerShare: String(t.pricePerShare),
      priceManual: false,
      note: t.note ?? '',
    })
    setTxEditing(t)
    setTxPanelOpen(true)
    setBanner(null)
  }

  const closeTxPanel = () => {
    setTxPanelOpen(false)
    setTxEditing(null)
    setTxForm(txFormEmpty())
  }

  const saveTx = async () => {
    if (txValidation) {
      setBanner({ type: 'err', text: txValidation })
      return
    }
    setTxSaving(true)
    setBanner(null)
    try {
      const iso = new Date(txForm.date + 'T12:00:00').toISOString()
      let assetId = txForm.assetId

      if (!txEditing && !assetId && txForm.valIsin) {
        const opt = securityOptions.find((o) => o.isin === txForm.valIsin)!
        const created = await api.assets.create({
          name: opt.ticker,
          category: SECURITIES_CATEGORY,
          isin: opt.isin,
          position: 0,
          estimatedValue: 0,
          currency: opt.currency,
          assetGroupId,
          note: null,
        })
        assetId = created.id
      }

      const body = {
        date: iso,
        assetId,
        kind: txForm.kind,
        quantity: parseFloat(txForm.quantity),
        pricePerShare: parseFloat(txForm.pricePerShare),
        note: txForm.note.trim() || null,
      }
      if (txEditing) await api.securityTransactions.update(txEditing.id, body)
      else {
        await api.securityTransactions.create({ assetGroupId, ...body })
        if (txForm.priceManual) {
          await api.securityValuations.create({ isin: txForm.valIsin, date: iso, sharePrice: parseFloat(txForm.pricePerShare) }, assetGroupId)
        }
      }
      setBanner({ type: 'ok', text: txEditing ? 'Trade updated.' : 'Trade recorded.' })
      closeTxPanel()
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to save trade.') })
    } finally {
      setTxSaving(false)
    }
  }

  const delTx = async (id: string) => {
    if (!confirm('Delete this trade? Holdings and marks will be recalculated.')) return
    try {
      await api.securityTransactions.delete(id)
      setBanner({ type: 'ok', text: 'Trade deleted.' })
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to delete.') })
    }
  }

  const openMove = (a: Asset) => {
    setMoveAsset(a)
    setMoveTargetId('')
    setBanner(null)
    if (sameKindGroups.length === 0) {
      api.portfolios.list().then((portfolios) => {
        const groups = portfolios
          .flatMap((p) => (p.assetGroups ?? []).map((g) => ({ ...g, portfolioName: p.name })))
          .filter((g) => g.kind === group.kind && g.id !== assetGroupId)
          .map((g) => ({ id: g.id, label: `${g.portfolioName} > ${g.name}` }))
        setSameKindGroups(groups)
        if (groups.length > 0) setMoveTargetId(groups[0].id)
      }).catch(() => {})
    } else {
      setMoveTargetId(sameKindGroups[0]?.id ?? '')
    }
  }

  const cancelMove = () => { setMoveAsset(null); setMoveTargetId('') }

  const confirmMove = async () => {
    if (!moveAsset || !moveTargetId) return
    setMoveSaving(true)
    try {
      await api.assets.update(moveAsset.id, { assetGroupId: moveTargetId })
      window.dispatchEvent(new Event(PORTFOLIOS_UPDATED_EVENT))
      setBanner({ type: 'ok', text: `${moveAsset.name} moved.` })
      cancelMove()
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to move holding.') })
    } finally {
      setMoveSaving(false)
    }
  }

  if (loading) return <div className="page-loading">Loading holdings…</div>
  if (pageError) return <div className="page-error">{pageError}</div>

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">{labelForGroupKind(group.kind)}</p>
          <h1>{group.name}</h1>
          {group.description ? <p className="page-subtitle">{group.description}</p> : null}
          <p className="page-subtitle" style={{ marginTop: '0.5rem' }}>
            <strong>Trades</strong> are purchases or sales. Price per share is taken from the nearest{' '}
            <strong>Stock Valuation</strong> mark on or before the trade date — add marks there first. The latest mark ×
            shares held drives totals on the dashboard.
          </p>
        </div>
        <Link className="btn" to={assetGroupEditPath(portfolioId, assetGroupId)}>
          Edit group
        </Link>
      </div>

      {banner?.type === 'err' ? <div className="page-error">{banner.text}</div> : null}
      {banner?.type === 'ok' ? <div className="page-success">{banner.text}</div> : null}

      <StatsPanel assetGroupId={assetGroupId} displayCurrency={displayCurrency} items={statsPanelItems} />

      <section className="stack" aria-labelledby="holdings-heading">
        <h2 id="holdings-heading">Holdings</h2>

        {rows.length === 0 ? (
          <div className="empty-state">No holdings yet. Add a purchase below to open a line.</div>
        ) : (
          <div className="re-property-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Quantity</th>
                  <th>Marked share price</th>
                  <th>Market value</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const sp = sharePriceForAsset(a)
                  const mv = marketValueForAsset(a)
                  const closed = a.position != null && !Number.isNaN(a.position) && a.position === 0
                  const isin = a.isin?.trim().toUpperCase() ?? ''
                  const sym = displayTickerInTable(a)
                  return (
                    <tr key={a.id}>
                      <td>
                        <div className="holding-table-name">
                          <div className="holding-table-name__primary">{securityTablePrimaryName(a)}</div>
                          <div className="holding-table-name__sub">
                            <span className="holding-table-name__ticker">{sym}</span>
                            {isin ? <span className="holding-table-name__isin">{isin}</span> : null}
                          </div>
                          {closed ? <span className="holding-table-name__closed"> — closed</span> : null}
                        </div>
                      </td>
                      <td>{a.position != null && !Number.isNaN(a.position) ? fmtSharesTable(a.position) : '—'}</td>
                      <td>{sp != null && !Number.isNaN(sp) ? fmtMarkedSharePriceTable(sp, a.currency) : '—'}</td>
                      <td className="positive">{mv != null && !Number.isNaN(mv) ? fmtMoney(mv, a.currency) : '—'}</td>
                      <td className="actions">
                        <button className="btn btn-sm" type="button" onClick={() => openMove(a)}>
                          Move
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="re-property-table-footer">
                <tr>
                  <th scope="row">Totals</th>
                  <td>—</td>
                  <td>—</td>
                  <td className="positive" title={holdingsFooterTotal.title}>
                    {holdingsFooterTotal.display}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {moveAsset && (
          <div className="form-panel">
            <h3>Move holding</h3>
            <p>Move <strong>{moveAsset.name}</strong> and all its trades to another securities group.</p>
            <div className="form-grid">
              <label className="span-2">
                Target group
                {sameKindGroups.length === 0 ? (
                  <p className="inline-hint">No other securities groups found.</p>
                ) : (
                  <select value={moveTargetId} onChange={(e) => setMoveTargetId(e.target.value)}>
                    {sameKindGroups.map((g) => (
                      <option key={g.id} value={g.id}>{g.label}</option>
                    ))}
                  </select>
                )}
              </label>
            </div>
            <div className="form-actions">
              <button className="btn" type="button" onClick={cancelMove}>Cancel</button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={confirmMove}
                disabled={!moveTargetId || moveSaving}
              >
                {moveSaving ? 'Moving…' : 'Move'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="stack" aria-labelledby="tx-heading">
        <div className="property-accordions" role="presentation">
          <details
            className="property-accordion"
            open={tradesAccordionOpen}
            onToggle={onTradesAccordionToggle}
          >
            <summary className="property-accordion__summary">
              <span className="property-accordion__title" id="tx-heading">
                Trades (purchases &amp; sales)
              </span>
            </summary>
            <div className="property-accordion__body stack">
              <div className="property-table-toolbar">
                <button className="btn btn-primary" type="button" onClick={openTxCreate}>
                  + Add trade
                </button>
              </div>

        {txPanelOpen && (
          <div className="form-panel">
            <h3>{txEditing ? 'Edit trade' : 'Add trade'}</h3>
            <div className="form-grid">
              <label className="span-2">
                Security *
                <SecurityPicker
                  options={securityOptions}
                  value={txForm.valIsin}
                  onChange={applySecurityPick}
                  disabled={Boolean(txEditing)}
                />
              </label>

              {!txEditing && txForm.valIsin ? (
                <label className="span-2">
                  Type *
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.35rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <input
                        type="radio"
                        name="tx-kind"
                        checked={txForm.kind === 'purchase'}
                        onChange={() => setTxForm((f) => ({ ...f, kind: 'purchase' }))}
                      />
                      Purchase
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <input
                        type="radio"
                        name="tx-kind"
                        checked={txForm.kind === 'sale'}
                        onChange={() => setTxForm((f) => ({ ...f, kind: 'sale' }))}
                        disabled={isNewToGroup}
                      />
                      Sale
                    </label>
                  </div>
                </label>
              ) : null}

              <label>
                Date *
                <input
                  type="date"
                  value={txForm.date}
                  onChange={(e) => setTxForm((f) => ({ ...f, date: e.target.value }))}
                />
              </label>
              <label>
                Quantity (shares) *
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={txForm.quantity}
                  onChange={(e) => setTxForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </label>

              <label className="span-2">
                Price per share *
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={txForm.pricePerShare}
                  placeholder="auto-filled from valuations"
                  onChange={(e) => setTxForm((f) => ({ ...f, pricePerShare: e.target.value, priceManual: true }))}
                />
                {txForm.priceManual && txForm.pricePerShare ? (
                  <span className="inline-hint">A stock valuation will be recorded at this price.</span>
                ) : null}
              </label>

              <label className="span-2">
                Note
                <input
                  value={txForm.note}
                  onChange={(e) => setTxForm((f) => ({ ...f, note: e.target.value }))}
                />
              </label>
            </div>
            {txValidation ? <p className="inline-hint inline-error">{txValidation}</p> : null}
            <div className="form-actions">
              <button className="btn" type="button" onClick={closeTxPanel}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={saveTx}
                disabled={Boolean(txValidation) || txSaving}
              >
                {txSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {txRows.length === 0 ? (
          <div className="empty-state">No trades yet. Use Add trade to record a purchase.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Name</th>
                <th>Quantity</th>
                <th>Price / sh</th>
                <th>Trade value</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...txRows]
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((t) => {
                  const cur = t.asset?.currency ?? 'EUR'
                  const tv =
                    !Number.isNaN(t.quantity) && !Number.isNaN(t.pricePerShare) ? t.quantity * t.pricePerShare : null
                  const isin = t.asset?.isin?.trim().toUpperCase() ?? ''
                  const sym = t.asset ? displayTickerInTable(t.asset) : '—'
                  return (
                    <tr key={t.id}>
                      <td>{new Date(t.date).toLocaleDateString()}</td>
                      <td>{kindLabel(t.kind)}</td>
                      <td>
                        {t.asset ? (
                          <div className="holding-table-name">
                            <div className="holding-table-name__primary">{securityTablePrimaryName(t.asset)}</div>
                            <div className="holding-table-name__sub">
                              <span className="holding-table-name__ticker">{sym}</span>
                              {isin ? <span className="holding-table-name__isin">{isin}</span> : null}
                            </div>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{fmtShares(t.quantity)}</td>
                      <td>{fmtSharePrice(t.pricePerShare, cur)}</td>
                      <td className="positive">{tv != null && !Number.isNaN(tv) ? fmtMoney(tv, cur) : '—'}</td>
                      <td>{t.note ?? '—'}</td>
                      <td className="actions">
                        <button className="btn btn-sm" type="button" onClick={() => openTxEdit(t)}>
                          Edit
                        </button>
                        <button className="btn btn-sm btn-danger" type="button" onClick={() => delTx(t.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        )}
            </div>
          </details>
        </div>
      </section>
    </div>
  )
}
