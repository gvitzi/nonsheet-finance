import type { AssetGroup, GroupKind } from './api'

/** Stored on `AssetGroup.kind` — investments = securities / ETFs & trading, real_estate = property, general = everything else */
export const GROUP_KIND_ORDER = ['investments', 'real_estate', 'general'] as const satisfies readonly GroupKind[]

export const GROUP_KIND_LABELS: Record<GroupKind, string> = {
  investments: 'Securities',
  real_estate: 'Real estate',
  general: 'General',
}

export function labelForGroupKind(kind: string): string {
  if (kind in GROUP_KIND_LABELS) return GROUP_KIND_LABELS[kind as GroupKind]
  return kind
}

/** Dispatch after portfolio or asset group create/update so the shell can refresh navigation. */
export const PORTFOLIOS_UPDATED_EVENT = 'nonsheet-finance:portfolios-updated'

/** Fired when the active wealth document was replaced from cache or a JSON import. */
export const WEALTH_DOC_LOADED_EVENT = 'nonsheet-finance:wealth-doc-loaded'

export type WealthDocLoadedSource = 'browser-cache' | 'import'

/** Fired when the app should surface a short-lived error row in the notifications panel. */
export const WEALTH_APP_ERROR_NOTIFICATION_EVENT = 'nonsheet-finance:wealth-app-error-notification'

/** @deprecated Use `PORTFOLIOS_UPDATED_EVENT` (same channel). */
export const GROUPS_UPDATED_EVENT = PORTFOLIOS_UPDATED_EVENT

export function sortAssetGroupsForNav(a: AssetGroup, b: AssetGroup): number {
  const rank = (k: string) => {
    const i = (GROUP_KIND_ORDER as readonly string[]).indexOf(k)
    return i === -1 ? GROUP_KIND_ORDER.length : i
  }
  const d = rank(a.kind) - rank(b.kind)
  if (d !== 0) return d
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

/** @deprecated Use `sortAssetGroupsForNav`. */
export const sortGroupsForNav = sortAssetGroupsForNav
