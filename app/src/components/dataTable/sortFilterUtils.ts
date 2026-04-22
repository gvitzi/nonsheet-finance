export type SortDirection = 'asc' | 'desc'

/** Lexicographic / numeric / date comparison for table sorting. */
export function compareSortValues(a: unknown, b: unknown, dir: SortDirection): number {
  const m = dir === 'asc' ? 1 : -1
  if (a instanceof Date && b instanceof Date && !Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
    return (a.getTime() - b.getTime()) * m
  }
  if (typeof a === 'number' && typeof b === 'number' && !Number.isNaN(a) && !Number.isNaN(b)) {
    return (a - b) * m
  }
  const na = Number(a)
  const nb = Number(b)
  if (!Number.isNaN(na) && !Number.isNaN(nb) && typeof a !== 'string') {
    return (na - nb) * m
  }
  const sa = String(a ?? '').toLowerCase()
  const sb = String(b ?? '').toLowerCase()
  if (sa < sb) return -1 * m
  if (sa > sb) return 1 * m
  return 0
}
