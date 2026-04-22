import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { compareSortValues, type SortDirection } from './sortFilterUtils'

export type ColumnFilterConfig<T> =
  | { type: 'none' }
  | { type: 'text'; placeholder?: string }
  | { type: 'select'; placeholder?: string; getOptions: (rows: T[]) => { value: string; label: string }[] }

export type ColumnDef<T> = {
  id: string
  header: string
  /** When false, header is not clickable for sort. */
  sortable?: boolean
  /** Used for sorting; not shown. */
  getSortValue: (row: T) => string | number | Date
  /** Matched against text (substring, case-insensitive) or exact for select. */
  getFilterValue: (row: T) => string
  filter?: ColumnFilterConfig<T>
  cell: (row: T) => ReactNode
  thClassName?: string
  tdClassName?: string
}

export type DefaultSort = { columnId: string; direction: SortDirection }

type Props<T> = {
  rows: T[]
  columns: ColumnDef<T>[]
  getRowKey: (row: T) => string
  defaultSort?: DefaultSort
  /** Shown when `rows` is empty (parent may still render filters). */
  emptyFilteredMessage?: string
  /** Shown when there are rows but filters exclude all. */
  emptyAfterFilterMessage?: string
}

function nextDirection(prevCol: string | null, prevDir: SortDirection, clickedId: string): SortDirection {
  if (prevCol !== clickedId) return 'asc'
  return prevDir === 'asc' ? 'desc' : 'asc'
}

export default function SortableFilterableTable<T>({
  rows,
  columns,
  getRowKey,
  defaultSort,
  emptyFilteredMessage = 'No rows to display.',
  emptyAfterFilterMessage = 'No rows match the current filters.',
}: Props<T>) {
  const [sortColumn, setSortColumn] = useState<string | null>(
    () => defaultSort?.columnId ?? columns.find((c) => c.sortable !== false)?.id ?? null,
  )
  const [sortDir, setSortDir] = useState<SortDirection>(() => defaultSort?.direction ?? 'asc')
  const [filters, setFilters] = useState<Record<string, string>>({})

  const setFilter = useCallback((columnId: string, value: string) => {
    setFilters((f) => ({ ...f, [columnId]: value }))
  }, [])

  const clearFilters = useCallback(() => {
    setFilters({})
  }, [])

  const processedRows = useMemo(() => {
    let out = [...rows]
    for (const col of columns) {
      const mode = col.filter?.type ?? 'none'
      if (mode === 'none') continue
      const raw = filters[col.id]
      if (raw == null || raw === '') continue
      if (mode === 'text') {
        const q = raw.trim().toLowerCase()
        if (!q) continue
        out = out.filter((row) => col.getFilterValue(row).toLowerCase().includes(q))
      } else if (mode === 'select') {
        out = out.filter((row) => col.getFilterValue(row) === raw)
      }
    }
    const sc = sortColumn
    const col = columns.find((c) => c.id === sc)
    if (col && col.sortable !== false) {
      out.sort((a, b) => compareSortValues(col.getSortValue(a), col.getSortValue(b), sortDir))
    }
    return out
  }, [rows, columns, filters, sortColumn, sortDir])

  const activeFilterCount = useMemo(
    () => columns.filter((c) => c.filter && c.filter.type !== 'none' && (filters[c.id] ?? '') !== '').length,
    [columns, filters],
  )

  const onHeaderClick = (col: ColumnDef<T>) => {
    if (col.sortable === false) return
    const next = nextDirection(sortColumn, sortDir, col.id)
    setSortColumn(col.id)
    setSortDir(next)
  }

  const sortIndicator = (colId: string) => {
    if (sortColumn !== colId) return <span className="table-sort-icon" aria-hidden>↕</span>
    return <span className="table-sort-icon table-sort-icon--active" aria-hidden>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  if (rows.length === 0) {
    return <div className="empty-state">{emptyFilteredMessage}</div>
  }

  return (
    <div className="sortable-table-wrap">
      {activeFilterCount > 0 ? (
        <div className="sortable-table-toolbar">
          <span className="sortable-table-toolbar__meta">{activeFilterCount} filter(s) active</span>
          <button type="button" className="btn btn-sm" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      ) : null}
      <div className="table-scroll">
        <table className="table table--sortable">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.id} className={col.thClassName}>
                  {col.sortable === false ? (
                    col.header
                  ) : (
                    <button type="button" className="table-sort-header" onClick={() => onHeaderClick(col)}>
                      <span>{col.header}</span>
                      {sortIndicator(col.id)}
                    </button>
                  )}
                </th>
              ))}
            </tr>
            <tr className="table-filter-row">
              {columns.map((col) => {
                const fc = col.filter
                if (!fc || fc.type === 'none') {
                  return <th key={col.id} className={col.thClassName} />
                }
                if (fc.type === 'text') {
                  return (
                    <th key={col.id} className={col.thClassName}>
                      <input
                        type="search"
                        className="table-filter-input"
                        placeholder={fc.placeholder ?? 'Filter…'}
                        value={filters[col.id] ?? ''}
                        onChange={(e) => setFilter(col.id, e.target.value)}
                        aria-label={`Filter ${col.header}`}
                      />
                    </th>
                  )
                }
                const opts = fc.getOptions(rows)
                return (
                  <th key={col.id} className={col.thClassName}>
                    <select
                      className="table-filter-select"
                      value={filters[col.id] ?? ''}
                      onChange={(e) => setFilter(col.id, e.target.value)}
                      aria-label={`Filter ${col.header}`}
                    >
                      {opts.map((o: { value: string; label: string }) => (
                        <option key={o.value === '' ? '__all' : o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {processedRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="empty-state">
                  {emptyAfterFilterMessage}
                </td>
              </tr>
            ) : (
              processedRows.map((row) => (
                <tr key={getRowKey(row)}>
                  {columns.map((col) => (
                    <td key={col.id} className={col.tdClassName}>
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
