import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { mortgageDebtContributionsAsOf, mortgageLatestSlicesAsOf } from '@nonsheet-finance/core'
import { ApiError, api } from '../api'
import type { Property, PropertyExpense, PropertyLoan, PropertyMortgageEntry, PropertyRentPeriod, PropertyValuation } from '../api'
import { assetGroupHubPath } from '../portfolioPaths'

const fmt = (n: number, currency = 'EUR') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)

function err(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return fallback
}

function dateInputFromIso(iso: string) {
  const d = iso.includes('T') ? iso.slice(0, 10) : iso.slice(0, 10)
  return d.length === 10 ? d : ''
}

function tenantNamesFromInput(s: string): string[] {
  return s.split(/[,;]/).map((x) => x.trim()).filter(Boolean)
}

function tenantNamesToInput(names: string[]): string {
  return names.join(', ')
}

function notesPreview(s: string | null | undefined, maxLen: number) {
  const t = (s ?? '').trim()
  if (!t) return '—'
  return t.length <= maxLen ? t : `${t.slice(0, maxLen)}…`
}

type Props = {
  portfolioId: string
  assetGroupId: string
  propertyId: string
  groupName: string
}

const valuationEmpty = { date: '', value: '', currency: 'EUR' }
const expenseEmpty = { date: '', name: '', description: '', amount: '' }
const mortgageEmpty = {
  date: '',
  outstandingBalance: '',
  currency: 'EUR',
  loanName: '',
  paymentMonthly: '',
  interestMonthly: '',
}
const loanEmpty = {
  name: '',
  startDate: '',
  endDate: '',
  interestAnnualPercent: '',
  originalLoanAmount: '',
  amortizationAnnualPercent: '',
  remainingDebtAfterFixedPeriod: '',
}
const rentPeriodEmpty = { startDate: '', endDate: '', rent: '', hausgeld: '0', tenantNames: '', notes: '' }

type PropertyAccordionSection = 'charts' | 'valuations' | 'expenses' | 'mortgages' | 'rentPeriods'

export default function RealEstatePropertyView({ portfolioId, assetGroupId, propertyId, groupName }: Props) {
  const navigate = useNavigate()
  const [property, setProperty] = useState<Property | null>(null)
  const [valuations, setValuations] = useState<PropertyValuation[]>([])
  const [expenses, setExpenses] = useState<PropertyExpense[]>([])
  const [mortgages, setMortgages] = useState<PropertyMortgageEntry[]>([])
  const [rentPeriods, setRentPeriods] = useState<PropertyRentPeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [metaForm, setMetaForm] = useState({
    name: '',
    description: '',
    notes: '',
    address: '',
    monthlyMortgagePayment: '',
  })
  const [metaSaving, setMetaSaving] = useState(false)
  const [detailsEditing, setDetailsEditing] = useState(false)

  const [vForm, setVForm] = useState(valuationEmpty)
  const [vEditing, setVEditing] = useState<PropertyValuation | null>(null)
  const [vSaving, setVSaving] = useState(false)
  const [valuationModalOpen, setValuationModalOpen] = useState(false)

  const closeValuationModal = useCallback(() => {
    setValuationModalOpen(false)
    setVEditing(null)
    setVForm(valuationEmpty)
  }, [])

  const [eForm, setEForm] = useState(expenseEmpty)
  const [eEditing, setEEditing] = useState<PropertyExpense | null>(null)
  const [eSaving, setESaving] = useState(false)
  const [expenseModalOpen, setExpenseModalOpen] = useState(false)

  const [mForm, setMForm] = useState(mortgageEmpty)
  const [mEditing, setMEditing] = useState<PropertyMortgageEntry | null>(null)
  const [mSaving, setMSaving] = useState(false)
  const [mortgageModalOpen, setMortgageModalOpen] = useState(false)
  const [loans, setLoans] = useState<PropertyLoan[]>([])
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null)
  const [loanModalOpen, setLoanModalOpen] = useState(false)
  const [loanEditing, setLoanEditing] = useState<PropertyLoan | null>(null)
  const [lForm, setLForm] = useState(loanEmpty)
  const [lSaving, setLSaving] = useState(false)

  const [rpForm, setRpForm] = useState(() => ({ ...rentPeriodEmpty }))
  const [rpEditing, setRpEditing] = useState<PropertyRentPeriod | null>(null)
  const [rpSaving, setRpSaving] = useState(false)
  const [rentPeriodModalOpen, setRentPeriodModalOpen] = useState(false)
  const [rentPeriodModalError, setRentPeriodModalError] = useState<string | null>(null)

  const closeExpenseModal = useCallback(() => {
    setExpenseModalOpen(false)
    setEEditing(null)
    setEForm(expenseEmpty)
  }, [])

  const closeMortgageModal = useCallback(() => {
    setMortgageModalOpen(false)
    setMEditing(null)
    setMForm(mortgageEmpty)
  }, [])

  const closeLoanModal = useCallback(() => {
    setLoanModalOpen(false)
    setLoanEditing(null)
    setLForm(loanEmpty)
  }, [])

  const closeRentPeriodModal = useCallback(() => {
    setRentPeriodModalOpen(false)
    setRpEditing(null)
    setRpForm({ ...rentPeriodEmpty })
    setRentPeriodModalError(null)
  }, [])

  const [openAccordionSection, setOpenAccordionSection] = useState<PropertyAccordionSection | null>('charts')

  const [selectedValuationId, setSelectedValuationId] = useState<string | null>(null)
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null)
  const [selectedMortgageId, setSelectedMortgageId] = useState<string | null>(null)
  const [selectedRentPeriodId, setSelectedRentPeriodId] = useState<string | null>(null)

  const onAccordionToggle = useCallback((section: PropertyAccordionSection, e: SyntheticEvent<HTMLDetailsElement>) => {
    const el = e.currentTarget
    if (el.open) setOpenAccordionSection(section)
    else setOpenAccordionSection((prev) => (prev === section ? null : prev))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setBanner(null)
    try {
      const [p, v, e, m, rp, ln] = await Promise.all([
        api.properties.get(propertyId),
        api.properties.listValuations(propertyId),
        api.properties.listExpenses(propertyId),
        api.properties.listMortgageEntries(propertyId),
        api.properties.listRentPeriods(propertyId),
        api.properties.listLoans(propertyId),
      ])
      setProperty(p)
      setMetaForm({
        name: p.name,
        description: p.description ?? '',
        notes: p.notes ?? '',
        address: p.address ?? '',
        monthlyMortgagePayment:
          p.monthlyMortgagePayment != null && !Number.isNaN(p.monthlyMortgagePayment) ? String(p.monthlyMortgagePayment) : '',
      })
      setValuations(v)
      setExpenses(e)
      setMortgages(m)
      setLoans(ln)
      setRentPeriods(rp)
      setValuationModalOpen(false)
      setVEditing(null)
      setVForm(valuationEmpty)
      setExpenseModalOpen(false)
      setEEditing(null)
      setEForm(expenseEmpty)
      setMortgageModalOpen(false)
      setMEditing(null)
      setMForm(mortgageEmpty)
      setLoanModalOpen(false)
      setLoanEditing(null)
      setLForm(loanEmpty)
      setRentPeriodModalOpen(false)
      setRentPeriodModalError(null)
      setRpEditing(null)
      setRpForm({ ...rentPeriodEmpty })
      setSelectedValuationId(null)
      setSelectedExpenseId(null)
      setSelectedMortgageId(null)
      setSelectedRentPeriodId(null)
    } catch {
      setProperty(null)
      setBanner({ type: 'err', text: 'Property not found.' })
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (vEditing && selectedValuationId !== vEditing.id) {
      setVEditing(null)
      setVForm(valuationEmpty)
      setValuationModalOpen(false)
    }
  }, [selectedValuationId, vEditing])

  useEffect(() => {
    const anyOpen =
      valuationModalOpen || expenseModalOpen || mortgageModalOpen || rentPeriodModalOpen || loanModalOpen
    if (!anyOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (valuationModalOpen) closeValuationModal()
      else if (expenseModalOpen) closeExpenseModal()
      else if (mortgageModalOpen) closeMortgageModal()
      else if (loanModalOpen) closeLoanModal()
      else closeRentPeriodModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    valuationModalOpen,
    expenseModalOpen,
    mortgageModalOpen,
    rentPeriodModalOpen,
    loanModalOpen,
    closeValuationModal,
    closeExpenseModal,
    closeMortgageModal,
    closeLoanModal,
    closeRentPeriodModal,
  ])

  useEffect(() => {
    if (eEditing && selectedExpenseId !== eEditing.id) {
      setEEditing(null)
      setEForm(expenseEmpty)
      setExpenseModalOpen(false)
    }
  }, [selectedExpenseId, eEditing])

  useEffect(() => {
    if (mEditing && selectedMortgageId !== mEditing.id) {
      setMEditing(null)
      setMForm(mortgageEmpty)
      setMortgageModalOpen(false)
    }
  }, [selectedMortgageId, mEditing])

  useEffect(() => {
    if (rpEditing && selectedRentPeriodId !== rpEditing.id) {
      setRpEditing(null)
      setRpForm({ ...rentPeriodEmpty })
      setRentPeriodModalOpen(false)
      setRentPeriodModalError(null)
    }
  }, [selectedRentPeriodId, rpEditing])

  useEffect(() => {
    setRentPeriodModalError(null)
  }, [rpForm])

  useEffect(() => {
    if (loans.length === 0) {
      setSelectedLoanId(null)
      return
    }
    setSelectedLoanId((prev) => {
      if (prev && loans.some((l) => l.id === prev)) return prev
      return loans[0]!.id
    })
  }, [loans])

  const propertyLabel = property?.name ?? 'Property'

  const sortedValuations = useMemo(
    () => [...valuations].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [valuations],
  )
  const sortedExpenses = useMemo(
    () => [...expenses].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [expenses],
  )
  const sortedMortgages = useMemo(
    () => [...mortgages].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [mortgages],
  )
  const legacyMortgageRows = useMemo(() => sortedMortgages.filter((m) => !m.loanId), [sortedMortgages])
  const sortedRentPeriods = useMemo(
    () =>
      [...rentPeriods].sort((a, b) => {
        const start = new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
        if (start !== 0) return start
        const endA = a.endDate ? new Date(a.endDate).getTime() : Number.POSITIVE_INFINITY
        const endB = b.endDate ? new Date(b.endDate).getTime() : Number.POSITIVE_INFINITY
        return endB - endA
      }),
    [rentPeriods],
  )

  const latestValuation = useMemo(() => {
    return sortedValuations[0] ?? null
  }, [sortedValuations])

  const propertyChartsTimeline = useMemo(() => {
    const allDates = [...new Set([...valuations.map((v) => v.date), ...mortgages.map((m) => m.date)])].sort()
    if (allDates.length === 0) return [] as Array<Record<string, string | number>>

    const latestValuationOnOrBefore = (date: string) => {
      let last: PropertyValuation | null = null
      for (const v of [...valuations].sort((a, b) => a.date.localeCompare(b.date))) {
        if (v.date <= date) last = v
        else break
      }
      return last
    }

    return allDates.map((date) => {
      const v = latestValuationOnOrBefore(date)
      const gross = v ? v.value : 0
      const valCurrency = v?.currency ?? 'EUR'
      const debtParts = mortgageDebtContributionsAsOf(
        mortgages
          .filter((m) => m.date <= date)
          .map((m) => ({
            date: m.date,
            loanId: m.loanId,
            outstandingBalance: m.outstandingBalance,
            currency: m.currency,
          })),
        new Date(date),
      )
      const liabilities = debtParts.reduce((s, d) => s + (d.currency === valCurrency ? d.value : 0), 0)
      return {
        date,
        gross,
        liabilities,
        netWorth: gross - liabilities,
        currency: valCurrency,
      }
    })
  }, [valuations, mortgages])

  const propertyCashflowTimeline = useMemo(() => {
    const rentPeriodStarts = rentPeriods.map((r) => r.startDate).filter(Boolean).sort()
    if (rentPeriodStarts.length === 0) return [] as Array<Record<string, string | number>>

    const start = new Date(rentPeriodStarts[0]!)
    const now = new Date()
    const quarterStart = new Date(start.getFullYear(), Math.floor(start.getMonth() / 3) * 3, 1)

    const isoDate = (d: Date) => {
      const y = d.getFullYear()
      const m = `${d.getMonth() + 1}`.padStart(2, '0')
      const day = `${d.getDate()}`.padStart(2, '0')
      return `${y}-${m}-${day}`
    }

    const addMonths = (d: Date, months: number) => new Date(d.getFullYear(), d.getMonth() + months, 1)
    const quarterLabel = (d: Date) => `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`
    const daysInMonth = (year: number, monthIndex: number) => new Date(year, monthIndex + 1, 0).getDate()

    const monthIncome = (year: number, monthIndex: number) => {
      const monthStart = new Date(year, monthIndex, 1)
      const monthEnd = new Date(year, monthIndex + 1, 0)
      const monthStartMs = monthStart.getTime()
      const monthEndMs = monthEnd.getTime()
      let total = 0
      for (const period of rentPeriods) {
        const periodStart = new Date(period.startDate)
        const periodEnd = period.endDate ? new Date(period.endDate) : monthEnd
        const overlapStart = Math.max(monthStartMs, periodStart.getTime())
        const overlapEnd = Math.min(monthEndMs, periodEnd.getTime())
        if (overlapEnd < overlapStart) continue
        const coveredDays = Math.floor((overlapEnd - overlapStart) / 86400000) + 1
        total += (period.rent * coveredDays) / daysInMonth(year, monthIndex)
      }
      return total
    }

    const mortgageRows = mortgages.map((m) => ({
      date: m.date,
      loanId: m.loanId,
      outstandingBalance: m.outstandingBalance,
      currency: m.currency,
      principalMonthlyPayment: m.principalMonthlyPayment,
      interestMonthlyPayment: m.interestMonthlyPayment,
    }))

    const monthMortgageExpense = (monthStart: Date) => {
      const slices = mortgageLatestSlicesAsOf(mortgageRows, monthStart)
      const loanIdSet = new Set(loans.map((l) => l.id))
      const hasLoanMark = mortgages.some((m) => m.loanId && loanIdSet.has(m.loanId))
      if (hasLoanMark) {
        let total = 0
        for (const s of slices) {
          if (s.loanId && loanIdSet.has(s.loanId)) total += s.principalMonthly + s.interestMonthly
        }
        return total
      }
      if (property?.monthlyMortgagePayment != null && !Number.isNaN(property.monthlyMortgagePayment)) {
        return property.monthlyMortgagePayment
      }
      return 0
    }

    const expenseByQuarter = new Map<string, number>()
    for (const expense of expenses) {
      const d = new Date(expense.date)
      const qStart = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)
      const key = isoDate(qStart)
      expenseByQuarter.set(key, (expenseByQuarter.get(key) ?? 0) + expense.amount)
    }

    const data: Array<Record<string, string | number>> = []
    let cumulativeIncome = 0
    let cumulativeExpenses = 0
    for (let cursor = new Date(quarterStart); cursor <= now; cursor = addMonths(cursor, 3)) {
      let quarterIncome = 0
      let quarterMortgage = 0
      for (let i = 0; i < 3; i += 1) {
        const month = new Date(cursor.getFullYear(), cursor.getMonth() + i, 1)
        if (month > now) break
        quarterIncome += monthIncome(month.getFullYear(), month.getMonth())
        quarterMortgage += monthMortgageExpense(month)
      }
      const key = isoDate(cursor)
      const quarterRecordedExpenses = expenseByQuarter.get(key) ?? 0
      cumulativeIncome += quarterIncome
      cumulativeExpenses += quarterMortgage + quarterRecordedExpenses
      data.push({
        date: key,
        label: quarterLabel(cursor),
        cumulativeIncome,
        cumulativeExpenses,
        cumulativeCashflow: cumulativeIncome - cumulativeExpenses,
      })
    }
    return data
  }, [property, valuations, mortgages, expenses, rentPeriods, loans])

  const mortgageFinanceRead = useMemo(() => {
    const now = new Date()
    const markLike = mortgages.map((m) => ({
      date: m.date,
      loanId: m.loanId,
      outstandingBalance: m.outstandingBalance,
      currency: m.currency,
      principalMonthlyPayment: m.principalMonthlyPayment,
      interestMonthlyPayment: m.interestMonthlyPayment,
    }))
    const debtContrib = mortgageDebtContributionsAsOf(markLike, now)
    const debtCurrencies = new Set(debtContrib.map((c) => c.currency))
    const totalDebtFormatted =
      debtContrib.length === 0
        ? '—'
        : debtCurrencies.size === 1
          ? fmt(
              debtContrib.reduce((s, c) => s + c.value, 0),
              debtContrib[0]!.currency,
            )
          : 'Various currencies'

    const slices = mortgageLatestSlicesAsOf(markLike, now)
    const perLoan = loans.map((loan) => {
      const sl = slices.find((s) => s.loanId === loan.id)
      return { loan, slice: sl ?? null }
    })
    let sumPrincipal = 0
    let sumInterest = 0
    let sumPayment = 0
    let payCur: string | null = null
    for (const { slice } of perLoan) {
      if (!slice) continue
      if (payCur === null) payCur = slice.currency
      if (slice.currency === payCur) {
        sumPrincipal += slice.principalMonthly
        sumInterest += slice.interestMonthly
        sumPayment += slice.principalMonthly + slice.interestMonthly
      } else {
        payCur = '__mixed__'
      }
    }
    const totalsSameCurrency = payCur != null && payCur !== '__mixed__' && perLoan.some((x) => x.slice)
    return {
      totalDebtFormatted,
      perLoan,
      totalsSameCurrency,
      sumPrincipal,
      sumInterest,
      sumPayment,
      payCur: totalsSameCurrency ? payCur : null,
    }
  }, [mortgages, loans])

  const mortgagePaymentReadLabel = useMemo(() => {
    if (!property) return '—'
    const { totalsSameCurrency, sumPayment, payCur } = mortgageFinanceRead
    if (loans.length > 0 && totalsSameCurrency && payCur) {
      return fmt(sumPayment, payCur)
    }
    if (property.monthlyMortgagePayment != null && !Number.isNaN(property.monthlyMortgagePayment)) {
      return fmt(property.monthlyMortgagePayment, 'EUR')
    }
    return '—'
  }, [property, loans.length, mortgageFinanceRead])

  const parseOptionalMoney = (s: string) => {
    const t = s.trim()
    if (!t) return null
    const n = parseFloat(t)
    return Number.isNaN(n) ? null : n
  }

  const derivedMonthlyCashflow = useMemo(() => {
    if (!property) return null
    const r = property.effectiveMonthlyRent + property.effectiveMonthlyHausgeld
    if (loans.length > 0) {
      const slices = mortgageLatestSlicesAsOf(
        mortgages.map((m) => ({
          date: m.date,
          loanId: m.loanId,
          outstandingBalance: m.outstandingBalance,
          currency: m.currency,
          principalMonthlyPayment: m.principalMonthlyPayment,
          interestMonthlyPayment: m.interestMonthlyPayment,
        })),
        new Date(),
      )
      const loanIdSet = new Set(loans.map((l) => l.id))
      const hasLoanMark = mortgages.some((m) => m.loanId && loanIdSet.has(m.loanId))
      if (hasLoanMark) {
        let m = 0
        for (const s of slices) {
          if (s.loanId && loanIdSet.has(s.loanId)) {
            m += s.principalMonthly + s.interestMonthly
          }
        }
        return r - m
      }
    }
    const mManual = parseOptionalMoney(metaForm.monthlyMortgagePayment)
    return r - (mManual ?? 0)
  }, [property, loans, mortgages, metaForm.monthlyMortgagePayment])

  const savedMonthlyCashflow = useMemo(() => {
    if (!property) return null
    return property.monthlyCashflow ?? null
  }, [property])

  const cancelDetailsEdit = useCallback(() => {
    if (!property) return
    setMetaForm({
      name: property.name,
      description: property.description ?? '',
      notes: property.notes ?? '',
      address: property.address ?? '',
      monthlyMortgagePayment:
        property.monthlyMortgagePayment != null && !Number.isNaN(property.monthlyMortgagePayment)
          ? String(property.monthlyMortgagePayment)
          : '',
    })
    setDetailsEditing(false)
    setBanner(null)
  }, [property])

  const saveMeta = async () => {
    if (!metaForm.name.trim()) {
      setBanner({ type: 'err', text: 'Name is required.' })
      return
    }
    const mt = metaForm.monthlyMortgagePayment.trim()
    if (mt && Number.isNaN(Number(mt))) {
      setBanner({ type: 'err', text: 'Mortgage payment must be a valid number when provided.' })
      return
    }
    setMetaSaving(true)
    setBanner(null)
    try {
      const p = await api.properties.update(propertyId, {
        name: metaForm.name.trim(),
        description: metaForm.description.trim() || null,
        notes: metaForm.notes.trim() || null,
        address: metaForm.address.trim() || null,
        monthlyMortgagePayment: parseOptionalMoney(metaForm.monthlyMortgagePayment),
      })
      setProperty(p)
      setDetailsEditing(false)
      setBanner({ type: 'ok', text: 'Saved.' })
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to save.') })
    } finally {
      setMetaSaving(false)
    }
  }

  const delProperty = async () => {
    if (!confirm('Delete this property and all valuations, expenses, mortgage rows, and rent periods?')) return
    try {
      await api.properties.delete(propertyId)
      navigate(assetGroupHubPath(portfolioId, assetGroupId))
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to delete.') })
    }
  }

  const archiveProperty = async () => {
    if (
      !confirm(
        'Archive this property? It will be hidden from default lists and totals until you show archived on the group page or unarchive it here.',
      )
    )
      return
    try {
      await api.properties.archive(propertyId)
      setBanner({ type: 'ok', text: 'Property archived.' })
      await load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to archive property.') })
    }
  }

  const unarchiveProperty = async () => {
    try {
      await api.properties.unarchive(propertyId)
      setBanner({ type: 'ok', text: 'Property restored.' })
      await load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to unarchive property.') })
    }
  }

  const vValidation = useMemo(() => {
    if (!vForm.date) return 'Date is required.'
    if (Number.isNaN(Number(vForm.value))) return 'Value must be a number.'
    return null
  }, [vForm])

  const saveValuation = async () => {
    if (vValidation) {
      setBanner({ type: 'err', text: vValidation })
      return
    }
    setVSaving(true)
    setBanner(null)
    try {
      const iso = new Date(vForm.date + 'T12:00:00').toISOString()
      const body = { date: iso, value: parseFloat(vForm.value), currency: vForm.currency.trim().toUpperCase() }
      if (vEditing) await api.properties.updateValuation(propertyId, vEditing.id, body)
      else await api.properties.createValuation(propertyId, body)
      setVForm(valuationEmpty)
      setVEditing(null)
      setValuationModalOpen(false)
      setBanner({ type: 'ok', text: vEditing ? 'Valuation updated.' : 'Valuation added.' })
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to save valuation.') })
    } finally {
      setVSaving(false)
    }
  }

  const delValuation = async (id: string) => {
    if (!confirm('Delete this valuation row?')) return
    try {
      await api.properties.deleteValuation(propertyId, id)
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to delete.') })
    }
  }

  const eValidation = useMemo(() => {
    if (!eForm.date) return 'Date is required.'
    if (!eForm.name.trim()) return 'Name is required.'
    if (Number.isNaN(Number(eForm.amount))) return 'Amount must be a number.'
    return null
  }, [eForm])

  const saveExpense = async () => {
    if (eValidation) {
      setBanner({ type: 'err', text: eValidation })
      return
    }
    setESaving(true)
    setBanner(null)
    try {
      const updating = Boolean(eEditing)
      const iso = new Date(eForm.date + 'T12:00:00').toISOString()
      const body = {
        date: iso,
        name: eForm.name.trim(),
        description: eForm.description.trim() || null,
        amount: parseFloat(eForm.amount),
      }
      if (eEditing) await api.properties.updateExpense(propertyId, eEditing.id, body)
      else await api.properties.createExpense(propertyId, body)
      closeExpenseModal()
      setBanner({ type: 'ok', text: updating ? 'Expense updated.' : 'Expense added.' })
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to save expense.') })
    } finally {
      setESaving(false)
    }
  }

  const delExpense = async (id: string) => {
    if (!confirm('Delete this expense?')) return
    try {
      await api.properties.deleteExpense(propertyId, id)
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to delete.') })
    }
  }

  const lValidation = useMemo(() => {
    if (!lForm.name.trim()) return 'Loan name is required.'
    if (!lForm.startDate) return 'Start date is required.'
    if (!lForm.endDate) return 'End date is required.'
    if (lForm.startDate && lForm.endDate && lForm.endDate < lForm.startDate) return 'End date must be on or after start date.'
    const ir = lForm.interestAnnualPercent.trim()
    if (ir && Number.isNaN(Number(ir))) return 'Interest must be a number when provided.'
    const oa = lForm.originalLoanAmount.trim()
    if (oa && (Number.isNaN(Number(oa)) || Number(oa) < 0)) return 'Original loan amount must be a non-negative number when provided.'
    const am = lForm.amortizationAnnualPercent.trim()
    if (am && (Number.isNaN(Number(am)) || Number(am) < 0)) return 'Amortization rate must be a non-negative number when provided.'
    const fd = lForm.remainingDebtAfterFixedPeriod.trim()
    if (fd && (Number.isNaN(Number(fd)) || Number(fd) < 0)) {
      return 'Remaining debt at end of fixed period must be a non-negative number when provided.'
    }
    return null
  }, [lForm])

  const saveLoan = async () => {
    if (lValidation) {
      setBanner({ type: 'err', text: lValidation })
      return
    }
    setLSaving(true)
    setBanner(null)
    try {
      const ir = lForm.interestAnnualPercent.trim()
      const interestAnnualPercent = ir === '' ? null : Number(ir)
      const oa = lForm.originalLoanAmount.trim()
      const originalLoanAmount = oa === '' ? null : Number(oa)
      const am = lForm.amortizationAnnualPercent.trim()
      const amortizationAnnualPercent = am === '' ? null : Number(am)
      const fd = lForm.remainingDebtAfterFixedPeriod.trim()
      const remainingDebtAfterFixedPeriod = fd === '' ? null : Number(fd)
      const loanPayload = {
        name: lForm.name.trim(),
        startDate: lForm.startDate,
        endDate: lForm.endDate,
        interestAnnualPercent,
        originalLoanAmount,
        amortizationAnnualPercent,
        remainingDebtAfterFixedPeriod,
      }
      if (loanEditing) {
        await api.properties.updateLoan(propertyId, loanEditing.id, loanPayload)
      } else {
        await api.properties.createLoan(propertyId, loanPayload)
      }
      closeLoanModal()
      setBanner({ type: 'ok', text: loanEditing ? 'Loan updated.' : 'Loan added.' })
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to save loan.') })
    } finally {
      setLSaving(false)
    }
  }

  const deleteLoan = async (loanId: string) => {
    if (!confirm('Delete this loan and all of its mortgage history rows?')) return
    try {
      await api.properties.deleteLoan(propertyId, loanId)
      if (selectedLoanId === loanId) setSelectedLoanId(null)
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to delete loan.') })
    }
  }

  const mValidation = useMemo(() => {
    if (!mForm.date) return 'Date is required.'
    if (Number.isNaN(Number(mForm.outstandingBalance))) return 'Outstanding balance must be a number.'
    const pay = mForm.paymentMonthly.trim()
    const int = mForm.interestMonthly.trim()
    if (pay && Number.isNaN(Number(pay))) return 'Monthly payment must be a number.'
    if (int && Number.isNaN(Number(int))) return 'Interest monthly must be a number.'
    const payN = pay === '' ? 0 : Number(pay)
    const intN = int === '' ? 0 : Number(int)
    if (payN < 0 || intN < 0) return 'Monthly payment and interest must be non-negative.'
    if (intN > payN) return 'Interest cannot exceed the monthly payment.'
    return null
  }, [mForm])

  const derivedMortgagePrincipalMonthly = useMemo(() => {
    const pay = mForm.paymentMonthly.trim()
    const int = mForm.interestMonthly.trim()
    const payN = pay === '' || Number.isNaN(Number(pay)) ? 0 : Number(pay)
    const intN = int === '' || Number.isNaN(Number(int)) ? 0 : Number(int)
    return payN - intN
  }, [mForm.paymentMonthly, mForm.interestMonthly])

  const saveMortgage = async () => {
    if (mValidation) {
      setBanner({ type: 'err', text: mValidation })
      return
    }
    if (loans.length > 0 && !selectedLoanId) {
      setBanner({ type: 'err', text: 'Select a loan before adding mortgage history.' })
      return
    }
    setMSaving(true)
    setBanner(null)
    try {
      const updating = Boolean(mEditing)
      const iso = new Date(mForm.date + 'T12:00:00').toISOString()
      const payN = mForm.paymentMonthly.trim() === '' ? 0 : parseFloat(mForm.paymentMonthly)
      const interestMonthlyPayment = mForm.interestMonthly.trim() === '' ? 0 : parseFloat(mForm.interestMonthly)
      const principalMonthlyPayment = payN - interestMonthlyPayment
      const body = {
        date: iso,
        outstandingBalance: parseFloat(mForm.outstandingBalance),
        currency: mForm.currency.trim().toUpperCase(),
        loanName: loans.length === 0 ? mForm.loanName.trim() || null : null,
        loanId: loans.length > 0 ? selectedLoanId : null,
        principalMonthlyPayment,
        interestMonthlyPayment,
      }
      if (mEditing) await api.properties.updateMortgageEntry(propertyId, mEditing.id, body)
      else await api.properties.createMortgageEntry(propertyId, body)
      closeMortgageModal()
      setBanner({ type: 'ok', text: updating ? 'Mortgage row updated.' : 'Mortgage row added.' })
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to save mortgage row.') })
    } finally {
      setMSaving(false)
    }
  }

  const delMortgage = async (id: string) => {
    if (!confirm('Delete this mortgage row?')) return
    try {
      await api.properties.deleteMortgageEntry(propertyId, id)
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to delete.') })
    }
  }

  const rpValidation = useMemo(() => {
    if (!rpForm.startDate) return 'Start date is required.'
    const rentStr = String(rpForm.rent ?? '').trim()
    const rentN = Number(rentStr)
    if (rentStr === '' || Number.isNaN(rentN) || rentN < 0) return 'Rent must be a non-negative number.'
    const hgStr = String(rpForm.hausgeld ?? '').trim()
    const hg = hgStr === '' ? 0 : Number(hgStr)
    if (Number.isNaN(hg) || hg < 0) return 'Hausgeld must be a non-negative number.'
    const endStr = String(rpForm.endDate ?? '').trim()
    if (endStr && endStr < rpForm.startDate) return 'End date must be on or after start date.'
    return null
  }, [rpForm])

  const saveRentPeriod = async () => {
    if (rpValidation) {
      setRentPeriodModalError(rpValidation)
      return
    }
    setRpSaving(true)
    setRentPeriodModalError(null)
    setBanner(null)
    try {
      const updating = Boolean(rpEditing)
      const startIso = new Date(rpForm.startDate + 'T12:00:00').toISOString()
      const endStr = String(rpForm.endDate ?? '').trim()
      const endPart = endStr
        ? { endDate: new Date(endStr + 'T12:00:00').toISOString() }
        : { endDate: null as string | null }
      const rent = parseFloat(String(rpForm.rent ?? '').trim())
      const hgStr = String(rpForm.hausgeld ?? '').trim()
      const hausgeld = hgStr === '' ? 0 : parseFloat(hgStr)
      const body = {
        startDate: startIso,
        ...endPart,
        rent,
        hausgeld,
        tenantNames: tenantNamesFromInput(String(rpForm.tenantNames ?? '')),
        notes: (rpForm.notes ?? '').trim() || null,
      }
      if (rpEditing) await api.properties.updateRentPeriod(propertyId, rpEditing.id, body)
      else await api.properties.createRentPeriod(propertyId, body)
      closeRentPeriodModal()
      setSelectedRentPeriodId(null)
      setBanner({ type: 'ok', text: updating ? 'Rent period updated.' : 'Rent period added.' })
      load()
    } catch (e: unknown) {
      const msg = err(e, 'Failed to save rent period.')
      setRentPeriodModalError(msg)
      setBanner({ type: 'err', text: msg })
    } finally {
      setRpSaving(false)
    }
  }

  const delRentPeriod = async (id: string) => {
    if (!confirm('Delete this rent period?')) return
    try {
      await api.properties.deleteRentPeriod(propertyId, id)
      load()
    } catch (e: unknown) {
      setBanner({ type: 'err', text: err(e, 'Failed to delete.') })
    }
  }

  if (loading) return <div className="page-loading">Loading property…</div>
  if (!property) return <div className="page-error">{banner?.text ?? 'Property not found.'}</div>

  return (
    <div className="page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={assetGroupHubPath(portfolioId, assetGroupId)}>{groupName}</Link>
        <span aria-hidden="true"> / </span>
        <span>{propertyLabel}</span>
      </nav>

      <div className="page-header">
        <h1>{property.name}</h1>
        <div className="page-header__actions">
          <Link className="btn" to={assetGroupHubPath(portfolioId, assetGroupId)}>
            All properties
          </Link>
          {property.archivedAt ? (
            <button className="btn btn-sm" type="button" onClick={unarchiveProperty}>
              Unarchive
            </button>
          ) : (
            <button className="btn btn-sm" type="button" onClick={archiveProperty}>
              Archive
            </button>
          )}
          <button className="btn btn-danger" type="button" onClick={delProperty}>
            Delete property
          </button>
        </div>
      </div>

      {banner?.type === 'err' ? <div className="page-error">{banner.text}</div> : null}
      {banner?.type === 'ok' ? <div className="page-success">{banner.text}</div> : null}

      <section className="panel property-details-section" aria-labelledby="property-details-heading">
        <div className="property-details-section__head">
          <h2 id="property-details-heading">Details</h2>
          {detailsEditing ? (
            <button className="btn" type="button" onClick={cancelDetailsEdit}>
              Cancel
            </button>
          ) : (
            <button className="btn btn-primary" type="button" onClick={() => setDetailsEditing(true)}>
              Edit details
            </button>
          )}
        </div>

        {detailsEditing ? (
          <>
            <div className="form-grid property-details-section__form">
              <label className="span-2">
                Name *
                <input value={metaForm.name} onChange={(e) => setMetaForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <label className="span-2">
                Description (single line)
                <input
                  value={metaForm.description}
                  onChange={(e) => setMetaForm((f) => ({ ...f, description: e.target.value }))}
                />
              </label>
              <label className="span-2">
                Notes
                <textarea rows={5} value={metaForm.notes} onChange={(e) => setMetaForm((f) => ({ ...f, notes: e.target.value }))} />
              </label>
              <label className="span-2">
                Address
                <textarea rows={2} value={metaForm.address} onChange={(e) => setMetaForm((f) => ({ ...f, address: e.target.value }))} />
              </label>
              <div className="span-2 property-details-section__fin-intro">
                <h3 className="property-details-section__fin-title">Financial summary</h3>
              </div>
              <label>
                Value (latest valuation)
                <input
                  readOnly
                  value={latestValuation ? fmt(latestValuation.value, latestValuation.currency) : '—'}
                  className="input-readonly"
                />
              </label>
              <label>
                Liabilities (mortgage debt, latest marks)
                <input readOnly value={mortgageFinanceRead.totalDebtFormatted} className="input-readonly" />
              </label>
              <label>
                Rent (monthly)
                <input readOnly className="input-readonly" value={fmt(property.effectiveMonthlyRent, 'EUR')} title="From rent period active today" />
              </label>
              <label>
                Hausgeld (monthly)
                <input readOnly className="input-readonly" value={fmt(property.effectiveMonthlyHausgeld, 'EUR')} title="From rent period active today" />
              </label>
              <label>
                Mortgage monthly payment (fallback when no loan marks)
                <input
                  type="number"
                  step="0.01"
                  value={metaForm.monthlyMortgagePayment}
                  onChange={(e) => setMetaForm((f) => ({ ...f, monthlyMortgagePayment: e.target.value }))}
                  title={
                    loans.length > 0
                      ? 'Used for cashflow only when there are no mortgage marks linked to a loan yet.'
                      : 'Manual monthly payment for cashflow when you are not using per-loan marks.'
                  }
                />
              </label>
              <label className="span-2">
                Net cashflow (monthly)
                <input
                  readOnly
                  value={derivedMonthlyCashflow === null ? '—' : fmt(derivedMonthlyCashflow, 'EUR')}
                  className="input-readonly"
                  title="Rent plus Hausgeld minus mortgage payment"
                />
              </label>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" type="button" onClick={saveMeta} disabled={metaSaving}>
                {metaSaving ? 'Saving…' : 'Save details'}
              </button>
            </div>
          </>
        ) : (
          <div className="property-details-read">
            <div className="property-details-read__block">
              <div className="label">Name</div>
              <div className="property-details-read__value">{property.name}</div>
            </div>
            <div className="property-details-read__block">
              <div className="label">Description</div>
              <div className="property-details-read__value property-details-read__value--muted">
                {property.description?.trim() ? property.description : '—'}
              </div>
            </div>
            <div className="property-details-read__block">
              <div className="label">Notes</div>
              {property.notes?.trim() ? (
                <p className="property-details-read__notes">{property.notes}</p>
              ) : (
                <div className="property-details-read__value property-details-read__value--muted">—</div>
              )}
            </div>
            <div className="property-details-read__block">
              <div className="label">Address</div>
              {property.address?.trim() ? (
                <div className="property-details-read__address">{property.address}</div>
              ) : (
                <div className="property-details-read__value property-details-read__value--muted">—</div>
              )}
            </div>

            <div className="property-details-read__fin">
              <h3 className="property-details-section__fin-title">Financial summary</h3>
              <div className="property-details-read__stats">
                <div className="property-details-read__stat">
                  <div className="label">Latest valuation</div>
                  <div className="property-details-read__stat-value">
                    {latestValuation ? fmt(latestValuation.value, latestValuation.currency) : '—'}
                  </div>
                  {latestValuation ? (
                    <div className="property-details-read__stat-meta">
                      As of {new Date(latestValuation.date).toLocaleDateString()}
                    </div>
                  ) : null}
                </div>
                <div className="property-details-read__stat property-details-read__stat--wide">
                  <div className="label">Mortgages (latest per loan)</div>
                  {loans.length === 0 && legacyMortgageRows.length === 0 ? (
                    <div className="property-details-read__stat-value property-details-read__value--muted">—</div>
                  ) : (
                    <ul className="property-loan-summary-list">
                      {mortgageFinanceRead.perLoan.map(({ loan, slice }) => (
                        <li key={loan.id}>
                          <strong>{loan.name}</strong>
                          {loan.startDate ? (
                            <>
                              {' · '}
                              Start {new Date(loan.startDate + 'T12:00:00').toLocaleDateString()}
                            </>
                          ) : null}
                          {' · '}
                          End {new Date(loan.endDate + 'T12:00:00').toLocaleDateString()}
                          {loan.originalLoanAmount != null && !Number.isNaN(loan.originalLoanAmount) ? (
                            <>
                              {' · '}
                              Original {fmt(loan.originalLoanAmount, 'EUR')}
                            </>
                          ) : null}
                          {loan.amortizationAnnualPercent != null && !Number.isNaN(loan.amortizationAnnualPercent) ? (
                            <> · Amortization {loan.amortizationAnnualPercent}% p.a.</>
                          ) : null}
                          {loan.remainingDebtAfterFixedPeriod != null && !Number.isNaN(loan.remainingDebtAfterFixedPeriod) ? (
                            <>
                              {' · '}
                              After fixed period {fmt(loan.remainingDebtAfterFixedPeriod, 'EUR')}
                            </>
                          ) : null}
                          {slice ? (
                            <>
                              {' · '}
                              Debt {fmt(slice.outstandingBalance, slice.currency)} (as of{' '}
                              {slice.markDate.toLocaleDateString()})
                              {' · '}
                              Payment {fmt(slice.principalMonthly + slice.interestMonthly, slice.currency)}/mo (P{' '}
                              {fmt(slice.principalMonthly, slice.currency)} + I {fmt(slice.interestMonthly, slice.currency)})
                            </>
                          ) : (
                            <span className="property-details-read__value--muted"> · no marks yet</span>
                          )}
                        </li>
                      ))}
                      {legacyMortgageRows.length > 0 ? (
                        <li>
                          <strong>Legacy marks (no loan)</strong>
                          {loans.length > 0 ? <span> · included in total debt</span> : null}
                          {(() => {
                            const sorted = [...legacyMortgageRows].sort(
                              (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
                            )[0]
                            return sorted ? (
                              <>
                                {' · '}
                                Latest {fmt(sorted.outstandingBalance, sorted.currency)} as of{' '}
                                {new Date(sorted.date).toLocaleDateString()}
                              </>
                            ) : null
                          })()}
                        </li>
                      ) : null}
                      {loans.length !== 1 || legacyMortgageRows.length > 0 ? (
                        <li className="property-loan-summary-list__totals">
                          <strong>All loans total</strong>
                          {' · '}
                          Debt {mortgageFinanceRead.totalDebtFormatted}
                          {' · '}
                          Payment{' '}
                          {mortgageFinanceRead.totalsSameCurrency && mortgageFinanceRead.payCur
                            ? fmt(mortgageFinanceRead.sumPayment, mortgageFinanceRead.payCur) + '/mo'
                            : '—'}
                          {' · '}
                          Principal{' '}
                          {mortgageFinanceRead.totalsSameCurrency && mortgageFinanceRead.payCur
                            ? fmt(mortgageFinanceRead.sumPrincipal, mortgageFinanceRead.payCur) + '/mo'
                            : '—'}
                          {' · '}
                          Interest{' '}
                          {mortgageFinanceRead.totalsSameCurrency && mortgageFinanceRead.payCur
                            ? fmt(mortgageFinanceRead.sumInterest, mortgageFinanceRead.payCur) + '/mo'
                            : '—'}
                          {' · '}
                          End date —
                        </li>
                      ) : null}
                    </ul>
                  )}
                </div>
                <div className="property-details-read__stat">
                  <div className="label">Rent (monthly)</div>
                  <div className="property-details-read__stat-value">{fmt(property.effectiveMonthlyRent, 'EUR')}</div>
                </div>
                <div className="property-details-read__stat">
                  <div className="label">Hausgeld (monthly)</div>
                  <div className="property-details-read__stat-value">{fmt(property.effectiveMonthlyHausgeld, 'EUR')}</div>
                </div>
                <div className="property-details-read__stat">
                  <div className="label">Mortgage payment (monthly)</div>
                  <div className="property-details-read__stat-value">{mortgagePaymentReadLabel}</div>
                </div>
                <div className="property-details-read__stat property-details-read__stat--wide">
                  <div className="label">Net cashflow (monthly)</div>
                  <div
                    className={`property-details-read__stat-value property-details-read__stat-value--cashflow${
                      savedMonthlyCashflow != null && savedMonthlyCashflow >= 0 ? ' positive' : ''
                    }${savedMonthlyCashflow != null && savedMonthlyCashflow < 0 ? ' negative' : ''}`}
                  >
                    {savedMonthlyCashflow === null ? '—' : fmt(savedMonthlyCashflow, 'EUR')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="property-accordions" role="presentation">
        <details
          className="property-accordion"
          open={openAccordionSection === 'charts'}
          onToggle={(e) => onAccordionToggle('charts', e)}
        >
          <summary className="property-accordion__summary">
            <span className="property-accordion__title">Charts</span>
          </summary>
          <div className="property-accordion__body">
            {propertyChartsTimeline.length === 0 && propertyCashflowTimeline.length === 0 ? (
              <div className="empty-state">No historical data available.</div>
            ) : (
              <div className="panel-grid">
                {propertyChartsTimeline.length > 0 ? (
                  <div className="panel">
                    <h2 style={{ marginTop: 0 }}>Gross value, liabilities, and net worth</h2>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={propertyChartsTimeline}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(Number(v), latestValuation?.currency ?? 'EUR')} width={90} />
                        <Tooltip formatter={(v, name) => [fmt(Number(v), latestValuation?.currency ?? 'EUR'), String(name)]} labelStyle={{ fontWeight: 600 }} />
                        <Legend />
                        <Line type="monotone" dataKey="gross" name="Gross value" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
                        <Line type="monotone" dataKey="liabilities" name="Liabilities" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls />
                        <Line type="monotone" dataKey="netWorth" name="Net worth" stroke="#10b981" strokeWidth={2} dot={false} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : null}

                {propertyCashflowTimeline.length > 0 ? (
                  <>
                    <div className="panel">
                      <h2 style={{ marginTop: 0 }}>Cumulative income and expenses</h2>
                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={propertyCashflowTimeline}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(Number(v), 'EUR')} width={90} />
                          <Tooltip formatter={(v, name) => [fmt(Number(v), 'EUR'), String(name)]} labelStyle={{ fontWeight: 600 }} />
                          <Legend />
                          <Line type="monotone" dataKey="cumulativeIncome" name="Income" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
                          <Line type="monotone" dataKey="cumulativeExpenses" name="Expenses" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="panel">
                      <h2 style={{ marginTop: 0 }}>Cumulative cashflow</h2>
                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={propertyCashflowTimeline}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(Number(v), 'EUR')} width={90} />
                          <Tooltip formatter={(v) => [fmt(Number(v), 'EUR'), 'Cashflow']} labelStyle={{ fontWeight: 600 }} />
                          <Legend />
                          <Line type="monotone" dataKey="cumulativeCashflow" name="Cashflow" stroke="#10b981" strokeWidth={2} dot={false} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </details>

        <details
          className="property-accordion"
          open={openAccordionSection === 'valuations'}
          onToggle={(e) => onAccordionToggle('valuations', e)}
        >
          <summary className="property-accordion__summary">
            <span className="property-accordion__title">Valuations over time</span>
          </summary>
          <div className="property-accordion__body stack">
        <p className="page-subtitle">Date and value for this property.</p>

        <div className="property-table-toolbar">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              setVEditing(null)
              setVForm(valuationEmpty)
              setSelectedValuationId(null)
              setValuationModalOpen(true)
            }}
          >
            Add valuation
          </button>
          {selectedValuationId ? (
            <div className="property-table-toolbar__actions">
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => {
                  const r = valuations.find((x) => x.id === selectedValuationId)
                  if (!r) return
                  setVEditing(r)
                  setVForm({
                    date: dateInputFromIso(r.date),
                    value: String(r.value),
                    currency: r.currency,
                  })
                  setValuationModalOpen(true)
                }}
              >
                Edit
              </button>
              <button className="btn btn-sm btn-danger" type="button" onClick={() => void delValuation(selectedValuationId)}>
                Delete
              </button>
            </div>
          ) : null}
        </div>

        {valuations.length === 0 ? (
          <div className="empty-state">No valuation rows yet.</div>
        ) : (
          <div className="property-table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Value</th>
                  <th>Property name</th>
                </tr>
              </thead>
              <tbody>
                {sortedValuations.map((r) => (
                  <tr
                    key={r.id}
                    className={`property-table-row--selectable${selectedValuationId === r.id ? ' property-table-row--selected' : ''}`}
                    tabIndex={0}
                    aria-selected={selectedValuationId === r.id}
                    onClick={() => setSelectedValuationId((prev) => (prev === r.id ? null : r.id))}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault()
                      setSelectedValuationId((prev) => (prev === r.id ? null : r.id))
                    }}
                  >
                    <td>{new Date(r.date).toLocaleDateString()}</td>
                    <td className="positive">{fmt(r.value, r.currency)}</td>
                    <td>{property.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
          </div>
        </details>

        <details
          className="property-accordion"
          open={openAccordionSection === 'expenses'}
          onToggle={(e) => onAccordionToggle('expenses', e)}
        >
          <summary className="property-accordion__summary">
            <span className="property-accordion__title">Expenses</span>
          </summary>
          <div className="property-accordion__body stack">
        <p className="page-subtitle">Recorded costs for this property (repairs, fees, insurance, etc.). Amounts in EUR.</p>

        <div className="property-table-toolbar">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              setEEditing(null)
              setEForm(expenseEmpty)
              setSelectedExpenseId(null)
              setExpenseModalOpen(true)
            }}
          >
            Add expense
          </button>
          {selectedExpenseId ? (
            <div className="property-table-toolbar__actions">
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => {
                  const r = expenses.find((x) => x.id === selectedExpenseId)
                  if (!r) return
                  setEEditing(r)
                  setEForm({
                    date: dateInputFromIso(r.date),
                    name: r.name,
                    description: r.description ?? '',
                    amount: String(r.amount),
                  })
                  setExpenseModalOpen(true)
                }}
              >
                Edit
              </button>
              <button className="btn btn-sm btn-danger" type="button" onClick={() => void delExpense(selectedExpenseId)}>
                Delete
              </button>
            </div>
          ) : null}
        </div>

        {expenses.length === 0 ? (
          <div className="empty-state">No expenses yet.</div>
        ) : (
          <>
            <div className="property-table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>Description</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedExpenses.map((r) => (
                    <tr
                      key={r.id}
                      className={`property-table-row--selectable${selectedExpenseId === r.id ? ' property-table-row--selected' : ''}`}
                      tabIndex={0}
                      aria-selected={selectedExpenseId === r.id}
                      onClick={() => setSelectedExpenseId((prev) => (prev === r.id ? null : r.id))}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return
                        e.preventDefault()
                        setSelectedExpenseId((prev) => (prev === r.id ? null : r.id))
                      }}
                    >
                      <td>{new Date(r.date).toLocaleDateString()}</td>
                      <td>{r.name}</td>
                      <td>{r.description?.trim() ? r.description : '—'}</td>
                      <td className="negative">{fmt(r.amount, 'EUR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
          </div>
        </details>

        <details
          className="property-accordion"
          open={openAccordionSection === 'mortgages'}
          onToggle={(e) => onAccordionToggle('mortgages', e)}
        >
          <summary className="property-accordion__summary">
            <span className="property-accordion__title">Loans & mortgage history</span>
          </summary>
          <div className="property-accordion__body stack">
            <div className="property-table-toolbar">
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  setLoanEditing(null)
                  setLForm(loanEmpty)
                  setLoanModalOpen(true)
                }}
              >
                Add loan
              </button>
              {selectedLoanId ? (
                <div className="property-table-toolbar__actions">
                  <button
                    className="btn btn-sm"
                    type="button"
                    onClick={() => {
                      const L = loans.find((x) => x.id === selectedLoanId)
                      if (!L) return
                      setLoanEditing(L)
                      setLForm({
                        name: L.name,
                        startDate: L.startDate ? dateInputFromIso(L.startDate) : '',
                        endDate: dateInputFromIso(L.endDate),
                        interestAnnualPercent:
                          L.interestAnnualPercent != null && !Number.isNaN(L.interestAnnualPercent)
                            ? String(L.interestAnnualPercent)
                            : '',
                        originalLoanAmount:
                          L.originalLoanAmount != null && !Number.isNaN(L.originalLoanAmount)
                            ? String(L.originalLoanAmount)
                            : '',
                        amortizationAnnualPercent:
                          L.amortizationAnnualPercent != null && !Number.isNaN(L.amortizationAnnualPercent)
                            ? String(L.amortizationAnnualPercent)
                            : '',
                        remainingDebtAfterFixedPeriod:
                          L.remainingDebtAfterFixedPeriod != null && !Number.isNaN(L.remainingDebtAfterFixedPeriod)
                            ? String(L.remainingDebtAfterFixedPeriod)
                            : '',
                      })
                      setLoanModalOpen(true)
                    }}
                  >
                    Edit loan
                  </button>
                  <button className="btn btn-sm btn-danger" type="button" onClick={() => void deleteLoan(selectedLoanId)}>
                    Remove loan
                  </button>
                </div>
              ) : null}
            </div>
            {loans.length === 0 ? (
              <div className="empty-state">No loans yet. Add a loan to attach mortgage history, or use legacy marks below.</div>
            ) : (
              <div className="property-loan-accordion-list">
                {loans.map((L) => {
                  const slice = mortgageFinanceRead.perLoan.find((x) => x.loan.id === L.id)?.slice ?? null
                  const rowsForLoan = sortedMortgages.filter((m) => m.loanId === L.id)
                  const debtLabel =
                    slice != null ? fmt(slice.outstandingBalance, slice.currency) : '—'
                  const isOpen = selectedLoanId === L.id
                  return (
                    <details
                      key={L.id}
                      className="property-accordion property-loan-accordion"
                      open={isOpen}
                      onToggle={(e) => {
                        const el = e.currentTarget
                        if (el.open) {
                          setSelectedLoanId(L.id)
                          setSelectedMortgageId(null)
                        } else {
                          setSelectedLoanId((prev) => (prev === L.id ? null : prev))
                        }
                      }}
                    >
                      <summary className="property-accordion__summary property-loan-accordion__summary">
                        <span className="property-loan-accordion__head">
                          <span className="property-accordion__title">{L.name}</span>
                          <span className="property-loan-accordion__debt" title="Latest outstanding (debt)">
                            {debtLabel}
                          </span>
                        </span>
                      </summary>
                      <div className="property-accordion__body stack">
                        <div className="property-loan-readonly">
                          <div className="property-loan-readonly__row">
                            <span className="property-loan-readonly__label">Start</span>
                            <span className="property-loan-readonly__value">
                              {L.startDate ? new Date(L.startDate + 'T12:00:00').toLocaleDateString() : '—'}
                            </span>
                          </div>
                          <div className="property-loan-readonly__row">
                            <span className="property-loan-readonly__label">End</span>
                            <span className="property-loan-readonly__value">
                              {new Date(L.endDate + 'T12:00:00').toLocaleDateString()}
                            </span>
                          </div>
                          <div className="property-loan-readonly__row">
                            <span className="property-loan-readonly__label">Interest</span>
                            <span className="property-loan-readonly__value">
                              {L.interestAnnualPercent != null && !Number.isNaN(L.interestAnnualPercent)
                                ? `${L.interestAnnualPercent}% p.a.`
                                : '—'}
                            </span>
                          </div>
                          <div className="property-loan-readonly__row">
                            <span className="property-loan-readonly__label">Original amount</span>
                            <span className="property-loan-readonly__value">
                              {L.originalLoanAmount != null && !Number.isNaN(L.originalLoanAmount)
                                ? fmt(L.originalLoanAmount, 'EUR')
                                : '—'}
                            </span>
                          </div>
                          <div className="property-loan-readonly__row">
                            <span className="property-loan-readonly__label">Amortization</span>
                            <span className="property-loan-readonly__value">
                              {L.amortizationAnnualPercent != null && !Number.isNaN(L.amortizationAnnualPercent)
                                ? `${L.amortizationAnnualPercent}% p.a.`
                                : '—'}
                            </span>
                          </div>
                          <div className="property-loan-readonly__row">
                            <span className="property-loan-readonly__label">Remaining after fixed period</span>
                            <span className="property-loan-readonly__value">
                              {L.remainingDebtAfterFixedPeriod != null && !Number.isNaN(L.remainingDebtAfterFixedPeriod)
                                ? fmt(L.remainingDebtAfterFixedPeriod, 'EUR')
                                : '—'}
                            </span>
                          </div>
                          <div className="property-loan-readonly__row">
                            <span className="property-loan-readonly__label">Latest debt (from marks)</span>
                            <span className="property-loan-readonly__value property-loan-readonly__value--emph">
                              {debtLabel}
                              {slice ? (
                                <span className="property-loan-readonly__asof">
                                  {' '}
                                  as of {slice.markDate.toLocaleDateString()}
                                </span>
                              ) : null}
                            </span>
                          </div>
                          {slice ? (
                            <div className="property-loan-readonly__row">
                              <span className="property-loan-readonly__label">Latest payment (P + I)</span>
                              <span className="property-loan-readonly__value">
                                {fmt(slice.principalMonthly + slice.interestMonthly, slice.currency)}
                                /mo (P {fmt(slice.principalMonthly, slice.currency)} + I{' '}
                                {fmt(slice.interestMonthly, slice.currency)})
                              </span>
                            </div>
                          ) : null}
                        </div>

                        <h4 className="property-subsection-title property-loan-marks-title">Mortgage marks</h4>
                        <div className="property-table-toolbar">
                          <button
                            className="btn btn-primary"
                            type="button"
                            onClick={() => {
                              setMEditing(null)
                              setMForm(mortgageEmpty)
                              setSelectedMortgageId(null)
                              setMortgageModalOpen(true)
                            }}
                          >
                            Add mark
                          </button>
                          {selectedMortgageId &&
                          rowsForLoan.some((x) => x.id === selectedMortgageId) ? (
                            <div className="property-table-toolbar__actions">
                              <button
                                className="btn btn-sm"
                                type="button"
                                onClick={() => {
                                  const r = rowsForLoan.find((x) => x.id === selectedMortgageId)
                                  if (!r) return
                                  setMEditing(r)
                                  setMForm({
                                    date: dateInputFromIso(r.date),
                                    outstandingBalance: String(r.outstandingBalance),
                                    currency: r.currency,
                                    loanName: r.loanName ?? '',
                                    paymentMonthly: String(
                                      (r.principalMonthlyPayment ?? 0) + (r.interestMonthlyPayment ?? 0),
                                    ),
                                    interestMonthly:
                                      r.interestMonthlyPayment != null && !Number.isNaN(r.interestMonthlyPayment)
                                        ? String(r.interestMonthlyPayment)
                                        : '',
                                  })
                                  setMortgageModalOpen(true)
                                }}
                              >
                                Edit
                              </button>
                              <button
                                className="btn btn-sm btn-danger"
                                type="button"
                                onClick={() => void delMortgage(selectedMortgageId)}
                              >
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </div>

                        {rowsForLoan.length === 0 ? (
                          <div className="empty-state">No marks for this loan yet.</div>
                        ) : (
                          <div className="property-table-scroll">
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>Date</th>
                                  <th>Outstanding (debt)</th>
                                  <th>Principal / mo</th>
                                  <th>Interest / mo</th>
                                  <th>Payment / mo</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rowsForLoan.map((r) => (
                                  <tr
                                    key={r.id}
                                    className={`property-table-row--selectable${selectedMortgageId === r.id ? ' property-table-row--selected' : ''}`}
                                    tabIndex={0}
                                    aria-selected={selectedMortgageId === r.id}
                                    onClick={() => setSelectedMortgageId((prev) => (prev === r.id ? null : r.id))}
                                    onKeyDown={(e) => {
                                      if (e.key !== 'Enter' && e.key !== ' ') return
                                      e.preventDefault()
                                      setSelectedMortgageId((prev) => (prev === r.id ? null : r.id))
                                    }}
                                  >
                                    <td>{new Date(r.date).toLocaleDateString()}</td>
                                    <td className="negative">{fmt(r.outstandingBalance, r.currency)}</td>
                                    <td>{fmt(r.principalMonthlyPayment ?? 0, r.currency)}</td>
                                    <td>{fmt(r.interestMonthlyPayment ?? 0, r.currency)}</td>
                                    <td>
                                      {fmt(
                                        (r.principalMonthlyPayment ?? 0) + (r.interestMonthlyPayment ?? 0),
                                        r.currency,
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </details>
                  )
                })}
              </div>
            )}

            {loans.length === 0 && legacyMortgageRows.length > 0 ? (
              <>
                <h3 className="property-subsection-title">Mortgage marks (legacy)</h3>
                <div className="property-table-toolbar">
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => {
                      setMEditing(null)
                      setMForm(mortgageEmpty)
                      setSelectedMortgageId(null)
                      setMortgageModalOpen(true)
                    }}
                  >
                    Add mark
                  </button>
                  {selectedMortgageId ? (
                    <div className="property-table-toolbar__actions">
                      <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() => {
                          const r = legacyMortgageRows.find((x) => x.id === selectedMortgageId)
                          if (!r) return
                          setMEditing(r)
                          setMForm({
                            date: dateInputFromIso(r.date),
                            outstandingBalance: String(r.outstandingBalance),
                            currency: r.currency,
                            loanName: r.loanName ?? '',
                            paymentMonthly: String(
                              (r.principalMonthlyPayment ?? 0) + (r.interestMonthlyPayment ?? 0),
                            ),
                            interestMonthly:
                              r.interestMonthlyPayment != null && !Number.isNaN(r.interestMonthlyPayment)
                                ? String(r.interestMonthlyPayment)
                                : '',
                          })
                          setMortgageModalOpen(true)
                        }}
                      >
                        Edit
                      </button>
                      <button className="btn btn-sm btn-danger" type="button" onClick={() => void delMortgage(selectedMortgageId)}>
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="property-table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Outstanding (debt)</th>
                        <th>Principal / mo</th>
                        <th>Interest / mo</th>
                        <th>Payment / mo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {legacyMortgageRows.map((r) => (
                        <tr
                          key={r.id}
                          className={`property-table-row--selectable${selectedMortgageId === r.id ? ' property-table-row--selected' : ''}`}
                          tabIndex={0}
                          aria-selected={selectedMortgageId === r.id}
                          onClick={() => setSelectedMortgageId((prev) => (prev === r.id ? null : r.id))}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return
                            e.preventDefault()
                            setSelectedMortgageId((prev) => (prev === r.id ? null : r.id))
                          }}
                        >
                          <td>{new Date(r.date).toLocaleDateString()}</td>
                          <td className="negative">{fmt(r.outstandingBalance, r.currency)}</td>
                          <td>{fmt(r.principalMonthlyPayment ?? 0, r.currency)}</td>
                          <td>{fmt(r.interestMonthlyPayment ?? 0, r.currency)}</td>
                          <td>
                            {fmt((r.principalMonthlyPayment ?? 0) + (r.interestMonthlyPayment ?? 0), r.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}

            {loans.length === 0 && legacyMortgageRows.length === 0 ? (
              <>
                <h3 className="property-subsection-title">Mortgage marks</h3>
                <div className="empty-state">Add a loan above, or legacy marks will appear here when present.</div>
              </>
            ) : null}

            {loans.length > 0 && legacyMortgageRows.length > 0 ? (
              <>
                <h3 className="property-subsection-title">Legacy marks (no loan)</h3>
                <p className="page-subtitle">Older rows not linked to a loan. Add marks under a loan when you can.</p>
                <div className="property-table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Outstanding (debt)</th>
                        <th>Loan name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {legacyMortgageRows.map((r) => (
                        <tr key={r.id}>
                          <td>{new Date(r.date).toLocaleDateString()}</td>
                          <td className="negative">{fmt(r.outstandingBalance, r.currency)}</td>
                          <td>{r.loanName?.trim() ? r.loanName : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        </details>

        <details
          className="property-accordion"
          open={openAccordionSection === 'rentPeriods'}
          onToggle={(e) => onAccordionToggle('rentPeriods', e)}
        >
          <summary className="property-accordion__summary">
            <span className="property-accordion__title">Rent periods</span>
          </summary>
          <div className="property-accordion__body stack">
            <p className="page-subtitle">
              Contract windows: base rent, Hausgeld, tenants, and optional end date. Open end = leave end date empty. If you add
              a period that starts after an existing open-ended one, the earlier period is ended the day before the new start so
              ranges stay sequential. The period that contains today drives the rent and Hausgeld shown in Details above.
            </p>

            <div className="property-table-toolbar">
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  setRentPeriodModalError(null)
                  setRpEditing(null)
                  setRpForm({ ...rentPeriodEmpty })
                  setSelectedRentPeriodId(null)
                  setRentPeriodModalOpen(true)
                }}
              >
                Add rent period
              </button>
              {selectedRentPeriodId ? (
                <div className="property-table-toolbar__actions">
                  <button
                    className="btn btn-sm"
                    type="button"
                    onClick={() => {
                      const r = rentPeriods.find((x) => x.id === selectedRentPeriodId)
                      if (!r) return
                      setRentPeriodModalError(null)
                      setRpEditing(r)
                      setRpForm({
                        startDate: dateInputFromIso(r.startDate),
                        endDate: r.endDate ? dateInputFromIso(r.endDate) : '',
                        rent: String(r.rent),
                        hausgeld: String(r.hausgeld),
                        tenantNames: tenantNamesToInput(r.tenantNames),
                        notes: r.notes ?? '',
                      })
                      setRentPeriodModalOpen(true)
                    }}
                  >
                    Edit
                  </button>
                  <button className="btn btn-sm btn-danger" type="button" onClick={() => void delRentPeriod(selectedRentPeriodId)}>
                    Delete
                  </button>
                </div>
              ) : null}
            </div>

            {rentPeriods.length === 0 ? (
              <div className="empty-state">No rent periods yet.</div>
            ) : (
              <>
                <div className="rent-period-cards" role="list" aria-label="Rent periods">
                  {sortedRentPeriods.map((r) => (
                    <article
                      key={r.id}
                      className={`rent-period-card${selectedRentPeriodId === r.id ? ' rent-period-card--selected' : ''}`}
                      role="listitem"
                      tabIndex={0}
                      onClick={() => setSelectedRentPeriodId((prev) => (prev === r.id ? null : r.id))}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return
                        e.preventDefault()
                        setSelectedRentPeriodId((prev) => (prev === r.id ? null : r.id))
                      }}
                    >
                      <div className="rent-period-card__head">
                        <span className="rent-period-card__dates">
                          {new Date(r.startDate).toLocaleDateString()}
                          {' → '}
                          {r.endDate ? new Date(r.endDate).toLocaleDateString() : 'Open'}
                        </span>
                      </div>
                      <dl className="rent-period-card__dl">
                        <dt className="rent-period-card__dt">Rent</dt>
                        <dd className="rent-period-card__dd">{fmt(r.rent, 'EUR')}</dd>
                        <dt className="rent-period-card__dt">Hausgeld</dt>
                        <dd className="rent-period-card__dd">{fmt(r.hausgeld, 'EUR')}</dd>
                        <dt className="rent-period-card__dt">Tenants</dt>
                        <dd className="rent-period-card__dd">{r.tenantNames.length ? r.tenantNames.join(', ') : '—'}</dd>
                        <dt className="rent-period-card__dt">Notes</dt>
                        <dd className="rent-period-card__dd">{r.notes?.trim() ? r.notes : '—'}</dd>
                      </dl>
                      {selectedRentPeriodId === r.id ? (
                        <div className="rent-period-card__actions">
                          <button
                            className="btn btn-sm"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedRentPeriodId(r.id)
                              setRpEditing(r)
                              setRentPeriodModalError(null)
                              setRpForm({
                                startDate: dateInputFromIso(r.startDate),
                                endDate: r.endDate ? dateInputFromIso(r.endDate) : '',
                                rent: String(r.rent),
                                hausgeld: String(r.hausgeld),
                                tenantNames: tenantNamesToInput(r.tenantNames),
                                notes: r.notes ?? '',
                              })
                              setRentPeriodModalOpen(true)
                            }}
                          >
                            Edit
                          </button>
                          <button className="btn btn-sm btn-danger" type="button" onClick={(e) => { e.stopPropagation(); void delRentPeriod(r.id) }}>
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>

                <div className="rent-period-table-wrap property-table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Start</th>
                        <th>End</th>
                        <th>Rent</th>
                        <th>Hausgeld</th>
                        <th>Tenants</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRentPeriods.map((r) => (
                        <tr
                          key={r.id}
                          className={`property-table-row--selectable${selectedRentPeriodId === r.id ? ' property-table-row--selected' : ''}`}
                          tabIndex={0}
                          aria-selected={selectedRentPeriodId === r.id}
                          onClick={() => setSelectedRentPeriodId((prev) => (prev === r.id ? null : r.id))}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return
                            e.preventDefault()
                            setSelectedRentPeriodId((prev) => (prev === r.id ? null : r.id))
                          }}
                        >
                          <td>{new Date(r.startDate).toLocaleDateString()}</td>
                          <td>{r.endDate ? new Date(r.endDate).toLocaleDateString() : 'Open'}</td>
                          <td className="positive">{fmt(r.rent, 'EUR')}</td>
                          <td>{fmt(r.hausgeld, 'EUR')}</td>
                          <td>{r.tenantNames.length ? r.tenantNames.join(', ') : '—'}</td>
                          <td>{notesPreview(r.notes, 48)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </details>
      </div>

      {valuationModalOpen ? (
        <div
          className="valuation-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeValuationModal()
          }}
        >
          <div className="valuation-modal" role="dialog" aria-modal="true" aria-labelledby="valuation-modal-title">
            <div className="valuation-modal__head">
              <h2 id="valuation-modal-title">{vEditing ? 'Edit valuation' : 'Add valuation'}</h2>
              <button className="btn btn-sm valuation-modal__close" type="button" onClick={closeValuationModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className="form-grid">
              <label>
                Date *
                <input
                  type="date"
                  value={vForm.date}
                  onChange={(e) => setVForm((f) => ({ ...f, date: e.target.value }))}
                />
              </label>
              <label>
                Value *
                <input type="number" step="0.01" value={vForm.value} onChange={(e) => setVForm((f) => ({ ...f, value: e.target.value }))} />
              </label>
              <label>
                Currency
                <input value={vForm.currency} maxLength={3} onChange={(e) => setVForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} />
              </label>
            </div>
            {vValidation ? <p className="inline-hint inline-error">{vValidation}</p> : null}
            <div className="form-actions">
              <button className="btn" type="button" onClick={closeValuationModal}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void saveValuation()} disabled={Boolean(vValidation) || vSaving}>
                {vSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {expenseModalOpen ? (
        <div
          className="valuation-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeExpenseModal()
          }}
        >
          <div className="valuation-modal" role="dialog" aria-modal="true" aria-labelledby="expense-modal-title">
            <div className="valuation-modal__head">
              <h2 id="expense-modal-title">{eEditing ? 'Edit expense' : 'Add expense'}</h2>
              <button className="btn btn-sm valuation-modal__close" type="button" onClick={closeExpenseModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className="form-grid">
              <label>
                Date *
                <input type="date" value={eForm.date} onChange={(ev) => setEForm((f) => ({ ...f, date: ev.target.value }))} />
              </label>
              <label>
                Name *
                <input value={eForm.name} onChange={(ev) => setEForm((f) => ({ ...f, name: ev.target.value }))} />
              </label>
              <label className="span-2">
                Description
                <input value={eForm.description} onChange={(ev) => setEForm((f) => ({ ...f, description: ev.target.value }))} />
              </label>
              <label>
                Amount *
                <input type="number" step="0.01" value={eForm.amount} onChange={(ev) => setEForm((f) => ({ ...f, amount: ev.target.value }))} />
              </label>
            </div>
            {eValidation ? <p className="inline-hint inline-error">{eValidation}</p> : null}
            <div className="form-actions">
              <button className="btn" type="button" onClick={closeExpenseModal}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void saveExpense()} disabled={Boolean(eValidation) || eSaving}>
                {eSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {mortgageModalOpen ? (
        <div
          className="valuation-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeMortgageModal()
          }}
        >
          <div className="valuation-modal" role="dialog" aria-modal="true" aria-labelledby="mortgage-modal-title">
            <div className="valuation-modal__head">
              <h2 id="mortgage-modal-title">
                {mEditing ? 'Edit mortgage mark' : 'Add mortgage mark'}
                {loans.length > 0 && selectedLoanId
                  ? ` — ${loans.find((l) => l.id === selectedLoanId)?.name ?? ''}`
                  : ''}
              </h2>
              <button className="btn btn-sm valuation-modal__close" type="button" onClick={closeMortgageModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className="form-grid">
              <label>
                Date *
                <input type="date" value={mForm.date} onChange={(e) => setMForm((f) => ({ ...f, date: e.target.value }))} />
              </label>
              <label>
                Outstanding balance (debt) *
                <input
                  type="number"
                  step="0.01"
                  value={mForm.outstandingBalance}
                  onChange={(e) => setMForm((f) => ({ ...f, outstandingBalance: e.target.value }))}
                />
              </label>
              <label>
                Currency
                <input value={mForm.currency} maxLength={3} onChange={(e) => setMForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} />
              </label>
              {loans.length === 0 ? (
                <label className="span-2">
                  Loan name (optional)
                  <input value={mForm.loanName} onChange={(e) => setMForm((f) => ({ ...f, loanName: e.target.value }))} />
                </label>
              ) : null}
              <label>
                Monthly payment
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={mForm.paymentMonthly}
                  onChange={(e) => setMForm((f) => ({ ...f, paymentMonthly: e.target.value }))}
                />
              </label>
              <label>
                Interest monthly
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={mForm.interestMonthly}
                  onChange={(e) => setMForm((f) => ({ ...f, interestMonthly: e.target.value }))}
                />
              </label>
              <div className="span-2">
                <div className="label">Calculated principal monthly</div>
                <div className="property-details-read__stat-value" style={{ fontSize: '1rem' }}>
                  {fmt(derivedMortgagePrincipalMonthly, mForm.currency.trim().toUpperCase() || 'EUR')}
                </div>
              </div>
            </div>
            {mValidation ? <p className="inline-hint inline-error">{mValidation}</p> : null}
            <div className="form-actions">
              <button className="btn" type="button" onClick={closeMortgageModal}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void saveMortgage()} disabled={Boolean(mValidation) || mSaving}>
                {mSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {loanModalOpen ? (
        <div
          className="valuation-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeLoanModal()
          }}
        >
          <div className="valuation-modal" role="dialog" aria-modal="true" aria-labelledby="loan-modal-title">
            <div className="valuation-modal__head">
              <h2 id="loan-modal-title">{loanEditing ? 'Edit loan' : 'Add loan'}</h2>
              <button className="btn btn-sm valuation-modal__close" type="button" onClick={closeLoanModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className="form-grid">
              <label className="span-2">
                Name *
                <input value={lForm.name} onChange={(e) => setLForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <label>
                Start date *
                <input type="date" value={lForm.startDate} onChange={(e) => setLForm((f) => ({ ...f, startDate: e.target.value }))} />
              </label>
              <label>
                End date *
                <input type="date" value={lForm.endDate} onChange={(e) => setLForm((f) => ({ ...f, endDate: e.target.value }))} />
              </label>
              <label>
                Original loan amount (optional)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={lForm.originalLoanAmount}
                  onChange={(e) => setLForm((f) => ({ ...f, originalLoanAmount: e.target.value }))}
                  placeholder="Principal at origination"
                />
              </label>
              <label>
                Amortization rate (% p.a. of principal, optional)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={lForm.amortizationAnnualPercent}
                  onChange={(e) => setLForm((f) => ({ ...f, amortizationAnnualPercent: e.target.value }))}
                  placeholder="e.g. 2"
                />
              </label>
              <label className="span-2">
                Remaining debt at end of fixed-rate period (optional)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={lForm.remainingDebtAfterFixedPeriod}
                  onChange={(e) => setLForm((f) => ({ ...f, remainingDebtAfterFixedPeriod: e.target.value }))}
                  placeholder="Expected balance when fixed interest ends"
                />
              </label>
              <label>
                Interest (% p.a., optional)
                <input
                  type="number"
                  step="0.01"
                  value={lForm.interestAnnualPercent}
                  onChange={(e) => setLForm((f) => ({ ...f, interestAnnualPercent: e.target.value }))}
                  placeholder="e.g. 3.5"
                />
              </label>
            </div>
            {lValidation ? <p className="inline-hint inline-error">{lValidation}</p> : null}
            <div className="form-actions">
              <button className="btn" type="button" onClick={closeLoanModal}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void saveLoan()} disabled={Boolean(lValidation) || lSaving}>
                {lSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rentPeriodModalOpen ? (
        <div
          className="valuation-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeRentPeriodModal()
          }}
        >
          <div className="valuation-modal" role="dialog" aria-modal="true" aria-labelledby="rent-period-modal-title">
            <div className="valuation-modal__head">
              <h2 id="rent-period-modal-title">{rpEditing ? 'Edit rent period' : 'Add rent period'}</h2>
              <button className="btn btn-sm valuation-modal__close" type="button" onClick={closeRentPeriodModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className="form-grid">
              <label>
                Start date *
                <input type="date" value={rpForm.startDate} onChange={(e) => setRpForm((f) => ({ ...f, startDate: e.target.value }))} />
              </label>
              <label>
                End date (optional)
                <input type="date" value={rpForm.endDate} onChange={(e) => setRpForm((f) => ({ ...f, endDate: e.target.value }))} />
              </label>
              <label>
                Rent (monthly) *
                <input type="number" step="0.01" value={rpForm.rent} onChange={(e) => setRpForm((f) => ({ ...f, rent: e.target.value }))} />
              </label>
              <label>
                Hausgeld (monthly)
                <input type="number" step="0.01" value={rpForm.hausgeld} onChange={(e) => setRpForm((f) => ({ ...f, hausgeld: e.target.value }))} />
              </label>
              <label className="span-2">
                Tenants (comma-separated names)
                <input value={rpForm.tenantNames} onChange={(e) => setRpForm((f) => ({ ...f, tenantNames: e.target.value }))} />
              </label>
              <label className="span-2">
                Notes
                <textarea rows={3} value={rpForm.notes} onChange={(e) => setRpForm((f) => ({ ...f, notes: e.target.value }))} />
              </label>
            </div>
            {(rpValidation || rentPeriodModalError) ? (
              <p className="inline-hint inline-error" role="alert">
                {rentPeriodModalError ?? rpValidation}
              </p>
            ) : null}
            <div className="form-actions">
              <button className="btn" type="button" onClick={closeRentPeriodModal}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void saveRentPeriod()} disabled={Boolean(rpValidation) || rpSaving}>
                {rpSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
