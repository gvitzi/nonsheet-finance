export const groupKinds = ['investments', 'real_estate', 'general'] as const

export type GroupKind = (typeof groupKinds)[number]

export interface BaseEntity {
  id: string
  createdAt: string
  updatedAt: string
}

/** Top-level bucket containing one or more asset groups. */
export interface PortfolioDto extends BaseEntity {
  name: string
  description?: string | null
  color?: string | null
  icon?: string | null
}

/** Typed middle tier (securities, real estate, general) holding assets, liabilities, and properties. */
export interface AssetGroupDto extends BaseEntity {
  portfolioId: string
  name: string
  description?: string | null
  color?: string | null
  /** Legacy; unused — icon is implied by `kind` in the app. */
  icon?: string | null
  kind: GroupKind
}

/** @deprecated Use `AssetGroupDto`. */
export type GroupDto = AssetGroupDto

export interface AssetDto extends BaseEntity {
  assetGroupId?: string | null
  name: string
  category: string
  estimatedValue: number
  currency: string
  /** Per-unit price when category is securities. */
  sharePrice?: number | null
  note?: string | null
  archivedAt?: string | null
}

export interface LiabilityDto extends BaseEntity {
  assetGroupId?: string | null
  name: string
  category: string
  outstandingBalance: number
  currency: string
  note?: string | null
}

/** One point on the dashboard net worth timeline (computed server-side from marks and ledgers). */
export interface NetWorthHistoryPointDto {
  id: string
  asOfDate: string
  netWorth: number
  totalAssets?: number | null
  totalLiabilities?: number | null
  currency: string
  note?: string | null
  createdAt: string
  updatedAt: string
}

export interface SettingDto extends BaseEntity {
  baseCurrency: string
  /** Default currency on the Dashboard; falls back to `baseCurrency` when unset. */
  displayCurrency?: string
  /** Months without valuation/mortgage or asset marks before title notifications (default 3). */
  staleAssetWarningMonths?: number
}

export * from './document.js'
export * from './fxUsd.js'
export * from './netWorthHistory.js'
export * from './dashboardSummary.js'
export * from './markIds.js'
export * from './staleNotifications.js'
