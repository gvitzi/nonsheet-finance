import { useCallback, useEffect, useState } from 'react'
import { convertAmountViaUsdFx, type FxRateRecord } from '@nonsheet-finance/core'
import { api } from './api'

/** Loads settings + FX rows so UI can convert instrument currencies to the user display currency. */
export function useDisplayMoney() {
  const [displayCurrency, setDisplayCurrency] = useState('EUR')
  const [fxRates, setFxRates] = useState<FxRateRecord[]>([])

  useEffect(() => {
    let cancelled = false
    Promise.all([api.settings.get(), api.fxRates.list()])
      .then(([s, fx]) => {
        if (cancelled) return
        setDisplayCurrency((s.displayCurrency ?? s.baseCurrency).trim().toUpperCase() || s.baseCurrency)
        setFxRates(fx as FxRateRecord[])
      })
      .catch(() => {
        if (!cancelled) setFxRates([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const convert = useCallback(
    (amount: number, fromCurrency: string) =>
      convertAmountViaUsdFx(amount, fromCurrency, displayCurrency, fxRates, undefined),
    [displayCurrency, fxRates],
  )

  return { displayCurrency, fxRates, convert }
}
