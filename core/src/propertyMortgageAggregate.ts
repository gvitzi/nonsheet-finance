/**
 * Aggregate property mortgage marks: legacy rows (no `loanId`) form one stream;
 * each non-null `loanId` is a separate stream. Latest-as-of is taken per stream, then summed by callers (with FX).
 */

function endOfDay(d: Date): number {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x.getTime()
}

function toDate(d: string | Date): Date {
  return typeof d === 'string' ? new Date(d) : d
}

function latestMortgageMetaBefore(
  rows: { date: Date; outstandingBalance: number; currency: string }[],
  asOf: Date,
  fallback: { value: number; currency: string },
): { value: number; currency: string } {
  const t = endOfDay(asOf)
  const eligible = rows.filter((v) => v.date.getTime() <= t)
  if (!eligible.length) return fallback
  eligible.sort((a, b) => b.date.getTime() - a.date.getTime())
  const row = eligible[0]
  return { value: row.outstandingBalance, currency: row.currency }
}

export type MortgageMarkLike = {
  date: string | Date
  loanId?: string | null
  outstandingBalance: number
  currency: string
}

/** One contribution per legacy bucket (optional) plus one per distinct `loanId`. */
export function mortgageDebtContributionsAsOf(marks: MortgageMarkLike[], asOf: Date): { value: number; currency: string }[] {
  const normalized = marks.map((m) => ({
    date: toDate(m.date),
    loanId: m.loanId && String(m.loanId).trim() ? String(m.loanId).trim() : null,
    outstandingBalance: m.outstandingBalance,
    currency: m.currency,
  }))
  const legacy = normalized.filter((m) => !m.loanId)
  const withLoan = normalized.filter((m) => m.loanId)
  const out: { value: number; currency: string }[] = []

  if (legacy.length > 0) {
    const mapped = legacy.map((m) => ({ date: m.date, outstandingBalance: m.outstandingBalance, currency: m.currency }))
    const fb = { value: 0, currency: legacy[0]?.currency ?? 'EUR' }
    out.push(latestMortgageMetaBefore(mapped, asOf, fb))
  }

  const byLoan = new Map<string, typeof normalized>()
  for (const m of withLoan) {
    const id = m.loanId!
    const list = byLoan.get(id) ?? []
    list.push(m)
    byLoan.set(id, list)
  }
  for (const list of byLoan.values()) {
    const mapped = list.map((m) => ({ date: m.date, outstandingBalance: m.outstandingBalance, currency: m.currency }))
    const fb = { value: 0, currency: list[0]?.currency ?? 'EUR' }
    out.push(latestMortgageMetaBefore(mapped, asOf, fb))
  }
  return out
}

export type MortgageMarkPaymentLike = MortgageMarkLike & {
  principalMonthlyPayment?: number | null
  interestMonthlyPayment?: number | null
}

export type LatestMortgagePaymentSlice = {
  /** `null` = legacy bucket */
  loanId: string | null
  outstandingBalance: number
  principalMonthly: number
  interestMonthly: number
  currency: string
  markDate: Date
}

function paymentPair(m: MortgageMarkPaymentLike): { principal: number; interest: number } {
  const p = m.principalMonthlyPayment
  const i = m.interestMonthlyPayment
  const principal = p != null && !Number.isNaN(p) ? p : 0
  const interest = i != null && !Number.isNaN(i) ? i : 0
  return { principal, interest }
}

/** Latest mark per legacy bucket / per loan with payment and balance fields for UI / cashflow. */
export function mortgageLatestSlicesAsOf(marks: MortgageMarkPaymentLike[], asOf: Date): LatestMortgagePaymentSlice[] {
  type Norm = {
    date: Date
    loanId: string | null
    outstandingBalance: number
    currency: string
    principal: number
    interest: number
  }
  const normalized: Norm[] = marks.map((m) => {
    const { principal, interest } = paymentPair(m)
    return {
      date: toDate(m.date),
      loanId: m.loanId && String(m.loanId).trim() ? String(m.loanId).trim() : null,
      outstandingBalance: m.outstandingBalance,
      currency: m.currency,
      principal,
      interest,
    }
  })
  const legacy = normalized.filter((m) => !m.loanId)
  const withLoan = normalized.filter((m) => m.loanId)
  const out: LatestMortgagePaymentSlice[] = []

  if (legacy.length > 0) {
    const mapped = legacy.map((m) => ({ date: m.date, outstandingBalance: m.outstandingBalance, currency: m.currency }))
    const fb = { value: 0, currency: legacy[0]?.currency ?? 'EUR' }
    const meta = latestMortgageMetaBefore(mapped, asOf, fb)
    const chosen = legacy
      .filter((m) => m.date.getTime() <= endOfDay(asOf))
      .sort((a, b) => b.date.getTime() - a.date.getTime())[0]
    if (chosen) {
      out.push({
        loanId: null,
        outstandingBalance: meta.value,
        principalMonthly: chosen.principal,
        interestMonthly: chosen.interest,
        currency: meta.currency,
        markDate: chosen.date,
      })
    }
  }

  const byLoan = new Map<string, Norm[]>()
  for (const m of withLoan) {
    const id = m.loanId!
    const list = byLoan.get(id) ?? []
    list.push(m)
    byLoan.set(id, list)
  }
  for (const [loanId, list] of byLoan) {
    const mapped = list.map((m) => ({ date: m.date, outstandingBalance: m.outstandingBalance, currency: m.currency }))
    const fb = { value: 0, currency: list[0]?.currency ?? 'EUR' }
    const meta = latestMortgageMetaBefore(mapped, asOf, fb)
    const chosen = list
      .filter((m) => m.date.getTime() <= endOfDay(asOf))
      .sort((a, b) => b.date.getTime() - a.date.getTime())[0]
    if (chosen) {
      out.push({
        loanId,
        outstandingBalance: meta.value,
        principalMonthly: chosen.principal,
        interestMonthly: chosen.interest,
        currency: meta.currency,
        markDate: chosen.date,
      })
    }
  }
  return out
}
