import type { WealthDocument } from './document.js'

export type WealthAppNotificationSeverity = 'info' | 'warning' | 'error'

/** Optional deep link into the SPA (path only; works with hash routers). */
export type WealthAppNotificationAction = {
  path: string
  label: string
}

export type WealthAppNotification = {
  id: string
  message: string
  severity: WealthAppNotificationSeverity
  /** When set, the client may show a control that navigates to this path. */
  action?: WealthAppNotificationAction
}

const SEVERITY_RANK: Record<WealthAppNotificationSeverity, number> = {
  info: 1,
  warning: 2,
  error: 3,
}

/** Highest severity among notifications (for a single aggregate badge). */
export function maxWealthAppNotificationSeverity(
  items: WealthAppNotification[],
): WealthAppNotificationSeverity | null {
  if (!items.length) return null
  let best: WealthAppNotificationSeverity = 'info'
  let r = 0
  for (const n of items) {
    const k = SEVERITY_RANK[n.severity]
    if (k > r) {
      r = k
      best = n.severity
    }
  }
  return best
}

function parseTimeMs(iso: string | undefined | null): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

function maxTime(...values: number[]): number {
  let m = 0
  for (const v of values) {
    if (Number.isFinite(v)) m = Math.max(m, v)
  }
  return m
}

/** Latest as-of `date` among marks, or `null` if there are none / no valid dates. */
function latestAsOfDateMs(rows: { date: string }[]): number | null {
  if (!rows.length) return null
  let best = 0
  for (const r of rows) {
    const t = parseTimeMs(r.date)
    if (t > best) best = t
  }
  return best > 0 ? best : null
}

/**
 * Notifications for general (non-securities) assets and real-estate properties.
 *
 * - **General assets**: latest **asset valuation** `date` (or record dates if none yet) vs threshold.
 * - **Real estate**: separate checks — latest **valuation** `date` and latest **mortgage** `date` must
 *   each fall within the last `settings.staleAssetWarningMonths` (default 3); missing rows count as stale.
 */
export function computeStaleDataNotifications(doc: WealthDocument, nowInput?: Date): WealthAppNotification[] {
  const now = nowInput ?? new Date()
  const months = doc.settings.staleAssetWarningMonths ?? 3
  const cutoff = new Date(now)
  cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffMs = cutoff.getTime()

  const groupById = new Map(doc.assetGroups.map((g) => [g.id, g]))
  /** Calendar date only (no time of day) for notification text. */
  const fmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' })

  const assetPath = (portfolioId: string, assetGroupId: string, assetId: string) =>
    `/portfolios/${portfolioId}/asset-groups/${assetGroupId}/assets/${assetId}`
  const propertyPath = (portfolioId: string, assetGroupId: string, propertyId: string) =>
    `/portfolios/${portfolioId}/asset-groups/${assetGroupId}/properties/${propertyId}`

  const out: WealthAppNotification[] = []

  for (const asset of doc.assets) {
    if (asset.archivedAt) continue
    const ag = asset.assetGroupId ? groupById.get(asset.assetGroupId) : undefined
    if (!ag || ag.kind !== 'general') continue
    if (asset.category === 'securities') continue

    /** Latest valuation as-of `date` only (not row `updatedAt`). */
    let markMs = 0
    for (const v of doc.assetValuations) {
      if (v.assetId !== asset.id) continue
      markMs = maxTime(markMs, parseTimeMs(v.date))
    }
    let lastMs =
      markMs > 0 ? markMs : maxTime(parseTimeMs(asset.updatedAt), parseTimeMs(asset.createdAt))
    if (lastMs === 0) lastMs = parseTimeMs(asset.createdAt)
    if (lastMs < cutoffMs) {
      const pid = ag.portfolioId
      const gid = ag.id
      out.push({
        id: `stale-asset-${asset.id}`,
        message: `General asset ${asset.name} was last updated at ${fmt(lastMs)}`,
        severity: 'warning',
        action: { path: assetPath(pid, gid, asset.id), label: 'Open asset' },
      })
    }
  }

  for (const prop of doc.properties) {
    if (prop.archivedAt) continue
    const ag = groupById.get(prop.assetGroupId)
    if (!ag || ag.kind !== 'real_estate') continue

    const valuations = doc.propertyValuations.filter((v) => v.propertyId === prop.id)
    const mortgages = doc.propertyMortgages.filter((m) => m.propertyId === prop.id)
    const latestValMs = latestAsOfDateMs(valuations)
    const latestMortMs = latestAsOfDateMs(mortgages)

    const pid = ag.portfolioId
    const gid = ag.id
    const openProperty: WealthAppNotificationAction = {
      path: propertyPath(pid, gid, prop.id),
      label: 'Open property',
    }

    if (latestValMs == null || latestValMs < cutoffMs) {
      const when = latestValMs != null ? fmt(latestValMs) : 'none on file'
      out.push({
        id: `stale-property-${prop.id}-valuation`,
        message: `Real estate ${prop.name}: add a property valuation with as-of date within the last ${months} month${months === 1 ? '' : 's'}. Latest valuation as of: ${when}.`,
        severity: 'warning',
        action: openProperty,
      })
    }

    const trackMortgage =
      mortgages.length > 0 || (prop.monthlyMortgagePayment != null && prop.monthlyMortgagePayment > 0)
    if (trackMortgage && (latestMortMs == null || latestMortMs < cutoffMs)) {
      const when = latestMortMs != null ? fmt(latestMortMs) : 'none on file'
      out.push({
        id: `stale-property-${prop.id}-mortgage`,
        message: `Real estate ${prop.name}: add a mortgage balance mark with as-of date within the last ${months} month${months === 1 ? '' : 's'}. Latest mortgage as of: ${when}.`,
        severity: 'warning',
        action: openProperty,
      })
    }
  }

  out.sort((a, b) => a.message.localeCompare(b.message, undefined, { sensitivity: 'base' }))
  return out
}
