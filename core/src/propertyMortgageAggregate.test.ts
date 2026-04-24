import { describe, expect, it } from 'vitest'
import { mortgageDebtContributionsAsOf } from './propertyMortgageAggregate.js'

describe('mortgageDebtContributionsAsOf', () => {
  const asOf = new Date('2024-06-15T12:00:00')

  it('legacy-only rows use single latest stream', () => {
    const marks = [
      { date: '2024-01-01', loanId: null, outstandingBalance: 100_000, currency: 'EUR' },
      { date: '2024-06-01', loanId: undefined, outstandingBalance: 90_000, currency: 'EUR' },
    ]
    const c = mortgageDebtContributionsAsOf(marks, asOf)
    expect(c).toEqual([{ value: 90_000, currency: 'EUR' }])
  })

  it('splits by loanId and sums as separate contributions', () => {
    const marks = [
      { date: '2024-05-01', loanId: 'a', outstandingBalance: 50_000, currency: 'EUR' },
      { date: '2024-05-01', loanId: 'b', outstandingBalance: 30_000, currency: 'EUR' },
      { date: '2024-04-01', loanId: 'a', outstandingBalance: 55_000, currency: 'EUR' },
    ]
    const c = mortgageDebtContributionsAsOf(marks, asOf)
    expect(c.length).toBe(2)
    const sum = c.reduce((s, x) => s + x.value, 0)
    expect(sum).toBe(80_000)
  })

  it('adds legacy bucket alongside loan streams', () => {
    const marks = [
      { date: '2024-05-01', loanId: null, outstandingBalance: 10_000, currency: 'EUR' },
      { date: '2024-05-01', loanId: 'x', outstandingBalance: 20_000, currency: 'EUR' },
    ]
    const c = mortgageDebtContributionsAsOf(marks, asOf)
    expect(c.length).toBe(2)
    expect(c.reduce((s, x) => s + x.value, 0)).toBe(30_000)
  })
})
