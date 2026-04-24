import { describe, expect, it } from 'vitest'
import type { WealthDocument } from './document.js'
import { computeStaleDataNotifications } from './staleNotifications.js'

function baseDoc(over: Partial<WealthDocument> = {}): WealthDocument {
  const t = '2024-01-01T00:00:00.000Z'
  const d: WealthDocument = {
    schemaVersion: 1,
    settings: {
      id: 's1',
      baseCurrency: 'EUR',
      staleAssetWarningMonths: 3,
      createdAt: t,
      updatedAt: t,
    },
    portfolios: [{ id: 'pf', name: 'P', createdAt: t, updatedAt: t }],
    assetGroups: [{ id: 'ag', portfolioId: 'pf', name: 'RE', kind: 'real_estate', createdAt: t, updatedAt: t }],
    assets: [],
    liabilities: [],
    properties: [
      {
        id: 'prop1',
        assetGroupId: 'ag',
        name: 'Villa',
        createdAt: t,
        updatedAt: t,
      },
    ],
    propertyValuations: [
      {
        id: 'v1',
        propertyId: 'prop1',
        date: '2024-06-01',
        value: 500_000,
        currency: 'EUR',
        createdAt: t,
        updatedAt: t,
      },
    ],
    propertyLoans: [],
    propertyMortgages: [],
    propertyExpenses: [],
    propertyRentPeriods: [],
    assetValuations: [],
    securityTransactions: [],
    securityInfo: [],
    securityValuations: [],
    fxRates: [],
    ...over,
  }
  return d
}

describe('computeStaleDataNotifications mortgages', () => {
  const now = new Date('2024-08-01T12:00:00')

  it('legacy: single property-level message when no loans', () => {
    const doc = baseDoc({
      propertyMortgages: [
        {
          id: 'm1',
          propertyId: 'prop1',
          date: '2024-01-01',
          outstandingBalance: 100,
          currency: 'EUR',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    })
    const items = computeStaleDataNotifications(doc, now)
    const hit = items.find((n) => n.id === 'stale-property-prop1-mortgage')
    expect(hit).toBeDefined()
    expect(hit?.message).toContain('Villa')
    expect(hit?.message).not.toContain('· loan')
  })

  it('per-loan messages when loans exist', () => {
    const doc = baseDoc({
      propertyLoans: [
        {
          id: 'loan1',
          propertyId: 'prop1',
          name: 'Fix 1',
          endDate: '2050-01-01',
          interestAnnualPercent: 3,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      propertyMortgages: [
        {
          id: 'm1',
          propertyId: 'prop1',
          loanId: 'loan1',
          date: '2024-01-01',
          outstandingBalance: 100,
          currency: 'EUR',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    })
    const items = computeStaleDataNotifications(doc, now)
    const hit = items.find((n) => n.id === 'stale-property-prop1-loan-loan1')
    expect(hit).toBeDefined()
    expect(hit?.message).toContain('Villa')
    expect(hit?.message).toContain('Fix 1')
  })
})
