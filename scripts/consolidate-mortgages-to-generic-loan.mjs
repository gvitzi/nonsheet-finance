/**
 * Replace propertyLoans with one loan named "mortgage" per property that has
 * mortgage marks, and point all propertyMortgages at that loan (drop loanName).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'

const INPUT = process.argv[2] ?? './input.json'
const OUTPUT = process.argv[3] ?? './output-generic-mortgage.json'

const now = new Date().toISOString()
/** Generic maturity placeholder when unknown (schema requires endDate). */
const PLACEHOLDER_END = '2100-12-31'

function main() {
  const doc = JSON.parse(fs.readFileSync(INPUT, 'utf8'))
  const propertyIds = [...new Set(doc.propertyMortgages.map((m) => m.propertyId))]

  const loanIdByProperty = new Map()
  const propertyLoans = propertyIds.map((propertyId) => {
    const id = crypto.randomUUID()
    loanIdByProperty.set(propertyId, id)
    return {
      id,
      propertyId,
      name: 'mortgage',
      startDate: null,
      endDate: PLACEHOLDER_END,
      interestAnnualPercent: null,
      originalLoanAmount: null,
      amortizationAnnualPercent: null,
      remainingDebtAfterFixedPeriod: null,
      createdAt: now,
      updatedAt: now,
    }
  })

  doc.propertyLoans = propertyLoans
  doc.propertyMortgages = doc.propertyMortgages.map((m) => {
    const loanId = loanIdByProperty.get(m.propertyId)
    if (!loanId) throw new Error(`Missing loan for property ${m.propertyId}`)
    const { loanName: _drop, ...rest } = m
    return {
      ...rest,
      loanId,
      updatedAt: now,
    }
  })

  doc.meta = { ...doc.meta, savedAt: now }

  fs.writeFileSync(OUTPUT, JSON.stringify(doc, null, 2), 'utf8')
  console.log(JSON.stringify({ INPUT, OUTPUT, loans: propertyLoans.length, marks: doc.propertyMortgages.length }, null, 2))
}

main()
