export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** How a JSON import combines with data already in the document. */
export type JsonImportMode = 'replace' | 'add'

export type AssetGroupHistory = {
  displayCurrency: string
  items: Array<{
    id: string
    name: string
    series: Array<{ date: string; value: number }>
  }>
}

export type DashboardAssetGroupBreakdown = {
  id: string
  name: string
  color: string | null
  kind: string
  portfolioId: string
  portfolioName: string
  totalAssets: number
  totalLiabilities: number
  netWorth: number
}

export type DashboardPortfolioBreakdown = {
  id: string
  name: string
  color: string | null
  totalAssets: number
  totalLiabilities: number
  netWorth: number
}

export type GroupKind = 'investments' | 'real_estate' | 'general'

export interface Property {
  id: string
  assetGroupId: string
  name: string
  description?: string | null
  notes?: string | null
  address?: string | null
  /** Legacy stored field; not used for display. Use `effectiveMonthlyRent` from rent periods. */
  monthlyRent?: number | null
  monthlyMortgagePayment?: number | null
  /** Base monthly rent from the rent period active today (0 if none). */
  effectiveMonthlyRent: number
  /** Hausgeld from the rent period active today (0 if none). */
  effectiveMonthlyHausgeld: number
  monthlyCashflow?: number | null
  archivedAt?: string | null
  assetGroup?: { id: string; name: string; kind: string }
  createdAt: string
  updatedAt: string
}

export interface PropertyValuation {
  id: string
  propertyId: string
  date: string
  value: number
  currency: string
  property?: { id: string; name: string }
  createdAt: string
  updatedAt: string
}

export interface PropertyLoan {
  id: string
  propertyId: string
  name: string
  /** Loan start (YYYY-MM-DD); null if not set. */
  startDate: string | null
  endDate: string
  interestAnnualPercent: number | null
  originalLoanAmount: number | null
  amortizationAnnualPercent: number | null
  remainingDebtAfterFixedPeriod: number | null
  property?: { id: string; name: string }
  createdAt: string
  updatedAt: string
}

export interface PropertyMortgageEntry {
  id: string
  propertyId: string
  date: string
  outstandingBalance: number
  currency: string
  /** @deprecated Prefer `loanId` and loan name. */
  loanName?: string | null
  loanId?: string | null
  principalMonthlyPayment?: number | null
  interestMonthlyPayment?: number | null
  property?: { id: string; name: string }
  createdAt: string
  updatedAt: string
}

export interface PropertyExpense {
  id: string
  propertyId: string
  date: string
  name: string
  description?: string | null
  amount: number
  property?: { id: string; name: string }
  createdAt: string
  updatedAt: string
}

export interface PropertyRentPeriod {
  id: string
  propertyId: string
  startDate: string
  endDate?: string | null
  rent: number
  hausgeld: number
  tenantNames: string[]
  notes?: string | null
  property?: { id: string; name: string }
  createdAt: string
  updatedAt: string
}

export interface Portfolio {
  id: string
  name: string
  description?: string | null
  color?: string | null
  icon?: string | null
  createdAt: string
  updatedAt: string
  assetGroups?: AssetGroup[]
}

export interface AssetGroup {
  id: string
  portfolioId: string
  name: string
  description?: string | null
  color?: string | null
  icon?: string | null
  kind: GroupKind | string
  createdAt: string
  updatedAt: string
  portfolio?: { id: string; name: string }
}

/** @deprecated Use `AssetGroup` */
export type Group = AssetGroup

export interface Asset {
  id: string
  name: string
  category: string
  estimatedValue: number
  currency: string
  isin?: string | null
  ticker?: string | null
  securityName?: string | null
  position?: number | null
  sharePrice?: number | null
  assetGroupId?: string | null
  note?: string | null
  archivedAt?: string | null
  assetGroup?: { id: string; name: string } | null
  createdAt: string
  updatedAt: string
}

export interface AssetValuation {
  id: string
  assetId: string
  date: string
  value: number
  currency: string
  asset?: { id: string; name: string }
  createdAt: string
  updatedAt: string
}

export type SecurityTxKind = 'purchase' | 'sale'

export interface SecurityTransaction {
  id: string
  assetGroupId: string
  assetId: string
  date: string
  kind: SecurityTxKind
  quantity: number
  pricePerShare: number
  note?: string | null
  asset?: {
    id: string
    name: string
    currency: string
    category: string
    assetGroupId: string | null
    isin?: string | null
    ticker?: string | null
    securityName?: string | null
  }
  createdAt: string
  updatedAt: string
}

export type SecurityTransactionInput = {
  assetGroupId: string
  assetId: string
  date: string
  kind: SecurityTxKind
  quantity: number
  pricePerShare: number
  note?: string | null
}

export interface SecurityInfoRecord {
  isin: string
  ticker: string
  name: string
  currency: string
  updatedAt: string
}

export type SecurityInfoRecordInput = {
  isin: string
  ticker: string
  name: string
  currency: string
}

export interface SecurityValuation {
  id: string
  isin: string
  date: string
  sharePrice: number
  currency: string
  note?: string | null
  asset?: {
    id: string
    name: string
    currency: string
    category: string
    assetGroupId: string | null
    isin?: string | null
    ticker?: string | null
    securityName?: string | null
    assetGroup?: {
      id: string
      name: string
      portfolioId: string
    } | null
  }
  createdAt: string
  updatedAt: string
}

export type SecurityValuationInput = {
  isin: string
  date: string
  sharePrice: number
  currency?: string
  note?: string | null
}

export interface Liability {
  id: string
  name: string
  category: string
  outstandingBalance: number
  currency: string
  assetGroupId?: string | null
  note?: string | null
  assetGroup?: { id: string; name: string } | null
  createdAt: string
  updatedAt: string
}

export interface NetWorthHistoryPoint {
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

export interface Settings {
  id: string
  baseCurrency: string
  /** Default currency pre-selected on the Dashboard; when omitted, use `baseCurrency`. */
  displayCurrency?: string
  theme?: 'light' | 'dark'
  staleAssetWarningMonths?: number
  /** Months ahead (and past maturities) for mortgage loan end-date notifications; default 3. */
  mortgageLoanEndWarningMonths?: number
  createdAt: string
  updatedAt: string
}

export interface DashboardTimelineGroupMeta {
  id: string
  name: string
  portfolioName: string
  color: string | null
}

export interface DashboardTimelineChartPoint {
  asOfDate: string
  dateLabel: string
  totalNetWorth: number
  netWorthByGroupId: Record<string, number>
}

export interface DashboardSummary {
  /** Aggregation / book currency amounts in this payload are expressed in. */
  displayCurrency: string
  /** Settings default for the dashboard currency selector. */
  defaultDisplayCurrency: string
  totalAssets: number
  totalLiabilities: number
  netWorth: number
  counts: {
    portfolios: number
    assetGroups: number
    assets: number
    liabilities: number
    snapshots: number
  }
  snapshots: NetWorthHistoryPoint[]
  byAssetGroup: DashboardAssetGroupBreakdown[]
  byPortfolio: DashboardPortfolioBreakdown[]
  timelineChart: {
    assetGroups: DashboardTimelineGroupMeta[]
    points: DashboardTimelineChartPoint[]
  }
}
