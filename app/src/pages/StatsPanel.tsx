import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api'
import type { AssetGroupHistory } from '../api'

const PALETTE = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
]

/** Reserved `LineChart` dataKey for the dashed total series (avoids collision with asset names). */
const TOTAL_LINE_KEY = '__totalNetWorth'
const TOTAL_LINE_STROKE = '#94a3b8'

export type StatsPanelItem = { id: string; name: string; value: number }

type Props = {
  assetGroupId: string
  /** ISO currency for chart labels (converted totals from `items`). */
  displayCurrency: string
  items: StatsPanelItem[]
}

export default function StatsPanel({ assetGroupId, displayCurrency, items }: Props) {
  const fmtValue = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: displayCurrency, maximumFractionDigits: 0 }).format(n)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [history, setHistory] = useState<AssetGroupHistory | null>(null)
  const [histLoading, setHistLoading] = useState(false)

  useEffect(() => {
    if (!detailsOpen || history) return
    setHistLoading(true)
    api.assetGroups.history(assetGroupId)
      .then(setHistory)
      .catch(() => {})
      .finally(() => setHistLoading(false))
  }, [detailsOpen, assetGroupId, history])

  // Reset cached history when the group or display currency changes
  useEffect(() => {
    setHistory(null)
  }, [assetGroupId, displayCurrency])

  const pieData = useMemo(() => items.filter((i) => i.value > 0), [items])

  const { timelineData, timelineKeys } = useMemo(() => {
    if (!history) return { timelineData: [], timelineKeys: [] }
    const allDates = [...new Set(history.items.flatMap((item) => item.series.map((s) => s.date)))].sort()
    const sortedSeries = history.items.map((item) => ({
      name: item.name,
      points: [...item.series].sort((a, b) => a.date.localeCompare(b.date)),
    }))

    const valueOnOrBefore = (points: { date: string; value: number }[], date: string): number | null => {
      let last: number | null = null
      for (const p of points) {
        if (p.date <= date) last = p.value
        else break
      }
      return last
    }

    const data = allDates.map((date) => {
      const point: Record<string, string | number> = { date }
      for (const item of history.items) {
        const match = item.series.find((s) => s.date === date)
        if (match) point[item.name] = match.value
      }
      let total = 0
      for (const item of sortedSeries) {
        const v = valueOnOrBefore(item.points, date)
        if (v != null && !Number.isNaN(v)) total += v
      }
      point[TOTAL_LINE_KEY] = total
      return point
    })
    return { timelineData: data, timelineKeys: history.items.map((i) => i.name) }
  }, [history])

  return (
    <details
      className="property-accordion stats-panel-details"
      open={detailsOpen}
      onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
    >
      <summary className="property-accordion__summary" aria-label="Show or hide charts">
        <span className="property-accordion__title">Charts</span>
      </summary>
      <div className="property-accordion__body">
        <div className="panel-grid">
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Net Worth by Asset</h2>
            {pieData.length === 0 ? (
              <div className="empty-state">No positive values to chart.</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="46%"
                    innerRadius={48}
                    outerRadius={84}
                    paddingAngle={1}
                    label={({ name, percent }) =>
                      `${name} (${((typeof percent === 'number' ? percent : 0) * 100).toFixed(0)}%)`
                    }
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="var(--panel-bg, #fff)" strokeWidth={1} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ payload }) => {
                      if (!payload?.length) return null
                      const entry = payload[0]
                      return (
                        <div style={{ background: 'var(--panel-bg, #fff)', border: '1px solid #e2e8f0', padding: '4px 10px', borderRadius: 4, fontSize: 13 }}>
                          <strong>{entry.name}</strong>: {fmtValue(Number(entry.value))}
                        </div>
                      )
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Net worth over time</h2>
            {histLoading ? (
              <div className="page-loading" style={{ padding: '2rem 0' }}>Loading…</div>
            ) : timelineData.length === 0 ? (
              <div className="empty-state">No historical data available.</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtValue(Number(v))} width={80} />
                  <Tooltip
                    formatter={(v, name) => [fmtValue(Number(v)), name]}
                    labelStyle={{ fontWeight: 600 }}
                  />
                  <Legend />
                  {timelineKeys.map((key, i) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stroke={PALETTE[i % PALETTE.length]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                  <Line
                    type="monotone"
                    name="Total"
                    dataKey={TOTAL_LINE_KEY}
                    stroke={TOTAL_LINE_STROKE}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </details>
  )
}
