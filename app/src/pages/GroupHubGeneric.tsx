import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../api'
import type { Asset, AssetGroup, Liability } from '../api'
import { PORTFOLIOS_UPDATED_EVENT, labelForGroupKind } from '../groupKinds'
import { assetGroupAssetPath, assetGroupEditPath } from '../portfolioPaths'
import { useDisplayMoney } from '../useDisplayMoney'
import StatsPanel from './StatsPanel'

const assetEmpty = { name: '', category: 'other', estimatedValue: '0', currency: 'EUR', note: '' }
const liabilityEmpty = { name: '', category: 'other', outstandingBalance: '0', currency: 'EUR', note: '' }

const fmt = (n: number, currency = 'EUR') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)

function err(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return fallback
}

type Props = {
  group: AssetGroup
  portfolioId: string
  assetGroupId: string
}

export default function GroupHubGeneric({ group, portfolioId, assetGroupId }: Props) {
  const { displayCurrency, convert } = useDisplayMoney()
  const [assets, setAssets] = useState<Asset[]>([])
  const [liabilities, setLiabilities] = useState<Liability[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const [assetForm, setAssetForm] = useState(assetEmpty)
  const [liabilityForm, setLiabilityForm] = useState(liabilityEmpty)
  const [assetEditing, setAssetEditing] = useState<Asset | null>(null)
  const [moveToGroupId, setMoveToGroupId] = useState<string>(assetGroupId)
  const [sameKindGroups, setSameKindGroups] = useState<{ id: string; label: string }[]>([])
  const [moveAsset, setMoveAsset] = useState<Asset | null>(null)
  const [moveTargetGroupId, setMoveTargetGroupId] = useState('')
  const [movePanelGroups, setMovePanelGroups] = useState<{ id: string; label: string }[]>([])
  const [moveSaving, setMoveSaving] = useState(false)
  const [liabilityEditing, setLiabilityEditing] = useState<Liability | null>(null)
  const [assetCreating, setAssetCreating] = useState(false)
  const [liabilityCreating, setLiabilityCreating] = useState(false)
  const [assetSaving, setAssetSaving] = useState(false)
  const [liabilitySaving, setLiabilitySaving] = useState(false)
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setPageError(null)
    Promise.all([api.assets.list(assetGroupId, showArchived), api.liabilities.list(assetGroupId)])
      .then(([a, l]) => {
        setAssets(a)
        setLiabilities(l)
      })
      .catch(() => setPageError('Could not load assets or liabilities.'))
      .finally(() => setLoading(false))
  }, [assetGroupId, showArchived])

  useEffect(() => {
    load()
  }, [load])

  const assetValidation = useMemo(() => {
    if (!assetForm.name.trim()) return 'Asset name is required.'
    if (!assetForm.currency.trim() || assetForm.currency.trim().length !== 3) return 'Currency must be a 3-letter code.'
    if (Number.isNaN(Number(assetForm.estimatedValue))) return 'Estimated value must be a number.'
    return null
  }, [assetForm])

  const liabilityValidation = useMemo(() => {
    if (!liabilityForm.name.trim()) return 'Liability name is required.'
    if (!liabilityForm.currency.trim() || liabilityForm.currency.trim().length !== 3) return 'Currency must be a 3-letter code.'
    if (Number.isNaN(Number(liabilityForm.outstandingBalance))) return 'Balance must be a number.'
    return null
  }, [liabilityForm])

  const assetsTableTotals = useMemo(() => {
    let sum = 0
    for (const a of assets) {
      sum += convert(a.estimatedValue, a.currency)
    }
    return {
      display: fmt(sum, displayCurrency),
      title: `Totals converted to ${displayCurrency} (sum of latest value per asset).`,
    }
  }, [assets, convert, displayCurrency])

  const cancelMoveAsset = () => {
    setMoveAsset(null)
    setMoveTargetGroupId('')
    setMovePanelGroups([])
  }

  const openAssetCreate = () => {
    cancelMoveAsset()
    setAssetForm(assetEmpty)
    setAssetCreating(true)
    setAssetEditing(null)
    setBanner(null)
  }
  const openAssetEdit = (a: Asset) => {
    cancelMoveAsset()
    setAssetForm({
      name: a.name,
      category: a.category,
      estimatedValue: String(a.estimatedValue),
      currency: a.currency,
      note: a.note ?? '',
    })
    setAssetEditing(a)
    setAssetCreating(false)
    setMoveToGroupId(assetGroupId)
    setBanner(null)
    api.portfolios.list().then((portfolios) => {
      const groups = portfolios
        .flatMap((p) => (p.assetGroups ?? []).map((g) => ({ ...g, portfolioName: p.name })))
        .filter((g) => g.kind === group.kind && g.id !== assetGroupId)
        .map((g) => ({ id: g.id, label: `${g.portfolioName} > ${g.name}` }))
      setSameKindGroups(groups)
    }).catch(() => {})
  }
  const closeAssetForm = () => {
    setAssetCreating(false)
    setAssetEditing(null)
    setSameKindGroups([])
  }

  const openMoveAsset = (a: Asset) => {
    closeAssetForm()
    setMoveAsset(a)
    setMoveTargetGroupId('')
    setMovePanelGroups([])
    setBanner(null)
    api.portfolios
      .list()
      .then((portfolios) => {
        const groups = portfolios
          .flatMap((p) => (p.assetGroups ?? []).map((g) => ({ ...g, portfolioName: p.name })))
          .filter((g) => g.kind === group.kind && g.id !== assetGroupId)
          .map((g) => ({ id: g.id, label: `${g.portfolioName} > ${g.name}` }))
        setMovePanelGroups(groups)
        if (groups.length > 0) setMoveTargetGroupId(groups[0].id)
      })
      .catch(() => {})
  }

  const confirmMoveAsset = async () => {
    if (!moveAsset || !moveTargetGroupId) return
    setMoveSaving(true)
    setBanner(null)
    try {
      await api.assets.update(moveAsset.id, { assetGroupId: moveTargetGroupId })
      window.dispatchEvent(new Event(PORTFOLIOS_UPDATED_EVENT))
      setBanner({ type: 'ok', text: `${moveAsset.name} moved.` })
      cancelMoveAsset()
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to move asset.') })
    } finally {
      setMoveSaving(false)
    }
  }

  const saveAsset = async () => {
    if (assetValidation) {
      setBanner({ type: 'err', text: assetValidation })
      return
    }
    setAssetSaving(true)
    setBanner(null)
    try {
      const targetGroupId = assetEditing ? moveToGroupId : assetGroupId
      const data = {
        name: assetForm.name.trim(),
        category: assetForm.category.trim(),
        estimatedValue: parseFloat(assetForm.estimatedValue),
        currency: assetForm.currency.trim().toUpperCase(),
        assetGroupId: targetGroupId,
        note: assetForm.note.trim() || null,
      }
      if (assetEditing) await api.assets.update(assetEditing.id, data)
      else await api.assets.create(data)
      if (targetGroupId !== assetGroupId) window.dispatchEvent(new Event(PORTFOLIOS_UPDATED_EVENT))
      setBanner({ type: 'ok', text: assetEditing ? 'Asset updated.' : 'Asset created.' })
      closeAssetForm()
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to save asset.') })
    } finally {
      setAssetSaving(false)
    }
  }

  const delAsset = async (id: string) => {
    if (
      !confirm(
        'Permanently delete this asset? This removes the row and any linked valuation history, securities trades, and marks for this holding. Archive instead if you only want to hide it from totals.',
      )
    )
      return
    try {
      await api.assets.delete(id)
      setBanner({ type: 'ok', text: 'Asset deleted.' })
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to delete asset.') })
    }
  }

  const archiveAsset = async (id: string) => {
    try {
      await api.assets.archive(id)
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to archive asset.') })
    }
  }

  const unarchiveAsset = async (id: string) => {
    try {
      await api.assets.unarchive(id)
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to unarchive asset.') })
    }
  }

  const openLiabilityCreate = () => {
    setLiabilityForm(liabilityEmpty)
    setLiabilityCreating(true)
    setLiabilityEditing(null)
    setBanner(null)
  }
  const openLiabilityEdit = (l: Liability) => {
    setLiabilityForm({
      name: l.name,
      category: l.category,
      outstandingBalance: String(l.outstandingBalance),
      currency: l.currency,
      note: l.note ?? '',
    })
    setLiabilityEditing(l)
    setLiabilityCreating(false)
    setBanner(null)
  }
  const closeLiabilityForm = () => {
    setLiabilityCreating(false)
    setLiabilityEditing(null)
  }

  const saveLiability = async () => {
    if (liabilityValidation) {
      setBanner({ type: 'err', text: liabilityValidation })
      return
    }
    setLiabilitySaving(true)
    setBanner(null)
    try {
      const data = {
        name: liabilityForm.name.trim(),
        category: liabilityForm.category.trim(),
        outstandingBalance: parseFloat(liabilityForm.outstandingBalance),
        currency: liabilityForm.currency.trim().toUpperCase(),
        assetGroupId,
        note: liabilityForm.note.trim() || null,
      }
      if (liabilityEditing) await api.liabilities.update(liabilityEditing.id, data)
      else await api.liabilities.create(data)
      setBanner({ type: 'ok', text: liabilityEditing ? 'Liability updated.' : 'Liability created.' })
      closeLiabilityForm()
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to save liability.') })
    } finally {
      setLiabilitySaving(false)
    }
  }

  const delLiability = async (id: string) => {
    if (!confirm('Delete this liability?')) return
    try {
      await api.liabilities.delete(id)
      setBanner({ type: 'ok', text: 'Liability deleted.' })
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to delete liability.') })
    }
  }

  if (loading) return <div className="page-loading">Loading assets and liabilities…</div>
  if (pageError) return <div className="page-error">{pageError}</div>

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">{labelForGroupKind(group.kind)}</p>
          <h1>{group.name}</h1>
          {group.description ? <p className="page-subtitle">{group.description}</p> : null}
        </div>
        <Link className="btn" to={assetGroupEditPath(portfolioId, assetGroupId)}>
          Edit Asset Group
        </Link>
      </div>

      {banner?.type === 'err' ? <div className="page-error">{banner.text}</div> : null}
      {banner?.type === 'ok' ? <div className="page-success">{banner.text}</div> : null}

      <StatsPanel
        assetGroupId={assetGroupId}
        displayCurrency={displayCurrency}
        items={assets.map((a) => ({
          id: a.id,
          name: a.name,
          value: convert(a.estimatedValue, a.currency),
        }))}
      />

      <section className="stack" aria-labelledby="assets-heading">
        <div className="page-header">
          <h2 id="assets-heading">Assets</h2>
          <div className="page-header__actions">
            <button
              className={`btn btn-sm${showArchived ? ' btn-active' : ''}`}
              type="button"
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived ? 'Hide archived' : 'Show archived'}
            </button>
            <button className="btn btn-primary" type="button" onClick={openAssetCreate}>
              + New asset
            </button>
          </div>
        </div>
        {group.kind === 'general' ? (
          <p className="page-subtitle" style={{ marginTop: '-0.25rem' }}>
            Each asset can have <strong>valuation history</strong> over time (like real estate). Open an asset to add dated
            marks; the group table shows the latest value.
          </p>
        ) : null}

        {(assetCreating || assetEditing) && (
          <div className="form-panel">
            <h3>{assetEditing ? 'Edit asset' : 'New asset'}</h3>
            <div className="form-grid">
              <label>
                Name *
                <input value={assetForm.name} onChange={(e) => setAssetForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <label>
                Category
                <input
                  value={assetForm.category}
                  onChange={(e) => setAssetForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="e.g. vehicle, savings"
                />
              </label>
              <label>
                Estimated value
                <input
                  type="number"
                  step="0.01"
                  value={assetForm.estimatedValue}
                  onChange={(e) => setAssetForm((f) => ({ ...f, estimatedValue: e.target.value }))}
                />
              </label>
              <label>
                Currency
                <input
                  value={assetForm.currency}
                  maxLength={3}
                  onChange={(e) => setAssetForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                />
              </label>
              <label className="span-2">
                Note
                <input value={assetForm.note} onChange={(e) => setAssetForm((f) => ({ ...f, note: e.target.value }))} />
              </label>
              {assetEditing && sameKindGroups.length > 0 ? (
                <label className="span-2">
                  Move to group
                  <select value={moveToGroupId} onChange={(e) => setMoveToGroupId(e.target.value)}>
                    <option value={assetGroupId}>{group.name} (current)</option>
                    {sameKindGroups.map((g) => (
                      <option key={g.id} value={g.id}>{g.label}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            {assetValidation ? <p className="inline-hint inline-error">{assetValidation}</p> : null}
            <div className="form-actions">
              <button className="btn" type="button" onClick={closeAssetForm}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" onClick={saveAsset} disabled={Boolean(assetValidation) || assetSaving}>
                {assetSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {assets.length === 0 ? (
          <div className="empty-state">No assets in this group yet.</div>
        ) : (
          <div className="re-property-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Value (latest)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id} className={a.archivedAt ? 'row--archived' : undefined}>
                    <td>{a.name}</td>
                    <td>
                      <span className="badge">{a.category}</span>
                    </td>
                    <td className="positive">{fmt(a.estimatedValue, a.currency)}</td>
                    <td className="actions">
                      {group.kind === 'general' ? (
                        <Link className="btn btn-sm" to={assetGroupAssetPath(portfolioId, assetGroupId, a.id)}>
                          Open
                        </Link>
                      ) : null}
                      {group.kind === 'general' ? (
                        <button className="btn btn-sm" type="button" onClick={() => openMoveAsset(a)}>
                          Move
                        </button>
                      ) : null}
                      <button className="btn btn-sm" type="button" onClick={() => openAssetEdit(a)}>
                        Edit
                      </button>
                      {a.archivedAt ? (
                        <>
                          <button className="btn btn-sm" type="button" onClick={() => unarchiveAsset(a.id)}>
                            Unarchive
                          </button>
                          <button className="btn btn-sm btn-danger" type="button" onClick={() => delAsset(a.id)}>
                            Delete
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-sm" type="button" onClick={() => archiveAsset(a.id)}>
                            Archive
                          </button>
                          <button className="btn btn-sm btn-danger" type="button" onClick={() => delAsset(a.id)}>
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="re-property-table-footer">
                <tr>
                  <th scope="row">Totals</th>
                  <td />
                  <td className="positive" title={assetsTableTotals.title}>
                    {assetsTableTotals.display}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {moveAsset && group.kind === 'general' ? (
          <div className="form-panel">
            <h3>Move asset</h3>
            <p>
              Move <strong>{moveAsset.name}</strong> and its <strong>valuation history</strong> to another{' '}
              {labelForGroupKind(group.kind).toLowerCase()} asset group.
            </p>
            <div className="form-grid">
              <label className="span-2">
                Target group
                {movePanelGroups.length === 0 ? (
                  <p className="inline-hint">No other {labelForGroupKind(group.kind).toLowerCase()} asset groups found.</p>
                ) : (
                  <select value={moveTargetGroupId} onChange={(e) => setMoveTargetGroupId(e.target.value)}>
                    {movePanelGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            </div>
            <div className="form-actions">
              <button className="btn" type="button" onClick={cancelMoveAsset}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void confirmMoveAsset()}
                disabled={!moveTargetGroupId || moveSaving}
              >
                {moveSaving ? 'Moving…' : 'Move'}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="stack" aria-labelledby="liabilities-heading">
        <div className="page-header">
          <h2 id="liabilities-heading">Liabilities</h2>
          <button className="btn btn-primary" type="button" onClick={openLiabilityCreate}>
            + New liability
          </button>
        </div>

        {(liabilityCreating || liabilityEditing) && (
          <div className="form-panel">
            <h3>{liabilityEditing ? 'Edit liability' : 'New liability'}</h3>
            <div className="form-grid">
              <label>
                Name *
                <input value={liabilityForm.name} onChange={(e) => setLiabilityForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <label>
                Category
                <input
                  value={liabilityForm.category}
                  onChange={(e) => setLiabilityForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="e.g. loan, card"
                />
              </label>
              <label>
                Outstanding balance
                <input
                  type="number"
                  step="0.01"
                  value={liabilityForm.outstandingBalance}
                  onChange={(e) => setLiabilityForm((f) => ({ ...f, outstandingBalance: e.target.value }))}
                />
              </label>
              <label>
                Currency
                <input
                  value={liabilityForm.currency}
                  maxLength={3}
                  onChange={(e) => setLiabilityForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                />
              </label>
              <label className="span-2">
                Note
                <input value={liabilityForm.note} onChange={(e) => setLiabilityForm((f) => ({ ...f, note: e.target.value }))} />
              </label>
            </div>
            {liabilityValidation ? <p className="inline-hint inline-error">{liabilityValidation}</p> : null}
            <div className="form-actions">
              <button className="btn" type="button" onClick={closeLiabilityForm}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={saveLiability}
                disabled={Boolean(liabilityValidation) || liabilitySaving}
              >
                {liabilitySaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {liabilities.length === 0 ? (
          <div className="empty-state">No liabilities in this group yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Balance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {liabilities.map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td>
                    <span className="badge">{l.category}</span>
                  </td>
                  <td className="negative">{fmt(l.outstandingBalance, l.currency)}</td>
                  <td className="actions">
                    <button className="btn btn-sm" type="button" onClick={() => openLiabilityEdit(l)}>
                      Edit
                    </button>
                    <button className="btn btn-sm btn-danger" type="button" onClick={() => delLiability(l.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
