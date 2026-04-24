import type { PropertyRentPeriodRecord } from './document.js'

const OPEN_END_YMD = '9999-12-31'

/** First 10 chars as YYYY-MM-DD for ISO or date-only strings. */
export function rentPeriodDateYmd(iso: string): string {
  const s = typeof iso === 'string' ? iso : ''
  return s.length >= 10 ? s.slice(0, 10) : s
}

export function rentPeriodCoversDate(period: PropertyRentPeriodRecord, asOfYmd: string): boolean {
  const start = rentPeriodDateYmd(period.startDate)
  const end = period.endDate == null || period.endDate === '' ? null : rentPeriodDateYmd(period.endDate)
  if (asOfYmd.length < 10 || start.length < 10) return false
  if (asOfYmd < start) return false
  if (end === null) return true
  return asOfYmd <= end
}

function effectiveEndYmd(period: PropertyRentPeriodRecord): string {
  if (period.endDate == null || period.endDate === '') return OPEN_END_YMD
  return rentPeriodDateYmd(period.endDate)
}

/** Inclusive overlap on the calendar-day axis; open end → unbounded. */
export function rentPeriodRangesOverlap(a: PropertyRentPeriodRecord, b: PropertyRentPeriodRecord): boolean {
  if (a.propertyId !== b.propertyId) return false
  const a0 = rentPeriodDateYmd(a.startDate)
  const a1 = effectiveEndYmd(a)
  const b0 = rentPeriodDateYmd(b.startDate)
  const b1 = effectiveEndYmd(b)
  return a0 <= b1 && b0 <= a1
}

/** Periods that overlap `candidate` for the same property, excluding `ignoreId` if set. */
export function findOverlappingRentPeriods(
  periods: PropertyRentPeriodRecord[],
  candidate: PropertyRentPeriodRecord,
  ignoreId?: string,
): PropertyRentPeriodRecord[] {
  return periods.filter((p) => p.id !== ignoreId && p.propertyId === candidate.propertyId && rentPeriodRangesOverlap(p, candidate))
}

export function activeRentPeriodForProperty(
  periods: PropertyRentPeriodRecord[],
  propertyId: string,
  asOfYmd: string,
): PropertyRentPeriodRecord | undefined {
  const matches = periods.filter((p) => p.propertyId === propertyId && rentPeriodCoversDate(p, asOfYmd))
  if (matches.length === 0) return undefined
  if (matches.length === 1) return matches[0]
  return [...matches].sort((a, b) => rentPeriodDateYmd(b.startDate).localeCompare(rentPeriodDateYmd(a.startDate)))[0]
}
