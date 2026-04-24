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
          startDate: null,
          endDate: '2050-01-01',
          interestAnnualPercent: 3,
          originalLoanAmount: null,
          amortizationAnnualPercent: null,
          remainingDebtAfterFixedPeriod: null,
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

describe('computeStaleDataNotifications loan end date', () => {
  const t = '2024-01-01T00:00:00.000Z'

  it('warns when loan end is within the warning window', () => {
    const now = new Date('2024-08-01T12:00:00')
    const doc = baseDoc({
      settings: {
        id: 's1',
        baseCurrency: 'EUR',
        staleAssetWarningMonths: 3,
        mortgageLoanEndWarningMonths: 3,
        createdAt: t,
        updatedAt: t,
      },
      propertyLoans: [
        {
          id: 'loanEnd1',
          propertyId: 'prop1',
          name: 'Main',
          startDate: null,
          endDate: '2024-10-15',
          interestAnnualPercent: 3,
          originalLoanAmount: null,
          amortizationAnnualPercent: null,
          remainingDebtAfterFixedPeriod: null,
          createdAt: t,
          updatedAt: t,
        },
      ],
      propertyMortgages: [
        {
          id: 'm1',
          propertyId: 'prop1',
          loanId: 'loanEnd1',
          date: '2024-07-01',
          outstandingBalance: 100,
          currency: 'EUR',
          createdAt: t,
          updatedAt: t,
        },
      ],
    })
    const items = computeStaleDataNotifications(doc, now)
    const hit = items.find((n) => n.id === 'loan-end-prop1-loanEnd1')
    expect(hit).toBeDefined()
    expect(hit?.message).toContain('Villa')
    expect(hit?.message).toContain('Main')
    expect(hit?.message).toContain('loan term ends on')
    expect(hit?.action?.path).toContain('/properties/prop1')
  })

  it('warns when loan term has passed', () => {
    const now = new Date('2024-08-01T12:00:00')
    const doc = baseDoc({
      propertyLoans: [
        {
          id: 'loanPast',
          propertyId: 'prop1',
          name: 'Old',
          startDate: null,
          endDate: '2024-05-01',
          interestAnnualPercent: null,
          originalLoanAmount: null,
          amortizationAnnualPercent: null,
          remainingDebtAfterFixedPeriod: null,
          createdAt: t,
          updatedAt: t,
        },
      ],
      propertyMortgages: [
        {
          id: 'm1',
          propertyId: 'prop1',
          loanId: 'loanPast',
          date: '2024-04-01',
          outstandingBalance: 100,
          currency: 'EUR',
          createdAt: t,
          updatedAt: t,
        },
      ],
    })
    const items = computeStaleDataNotifications(doc, now)
    const hit = items.find((n) => n.id === 'loan-end-prop1-loanPast')
    expect(hit).toBeDefined()
    expect(hit?.message).toContain('loan term ended on')
  })

  it('ignores placeholder end dates (2090+)', () => {
    const now = new Date('2024-08-01T12:00:00')
    const doc = baseDoc({
      propertyLoans: [
        {
          id: 'loanPh',
          propertyId: 'prop1',
          name: 'Generic',
          startDate: null,
          endDate: '2100-12-31',
          interestAnnualPercent: null,
          originalLoanAmount: null,
          amortizationAnnualPercent: null,
          remainingDebtAfterFixedPeriod: null,
          createdAt: t,
          updatedAt: t,
        },
      ],
      propertyMortgages: [
        {
          id: 'm1',
          propertyId: 'prop1',
          loanId: 'loanPh',
          date: '2024-07-01',
          outstandingBalance: 100,
          currency: 'EUR',
          createdAt: t,
          updatedAt: t,
        },
      ],
    })
    const items = computeStaleDataNotifications(doc, now)
    expect(items.find((n) => n.id === 'loan-end-prop1-loanPh')).toBeUndefined()
  })
})
