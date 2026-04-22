import { useCallback, useEffect, useState } from 'react'

/** Chromium’s deferred install prompt (not in all TypeScript DOM libs). */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true
}

function isIosTouchDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

function isAndroidMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  return /android/i.test(navigator.userAgent)
}

/**
 * Home-screen hints only (manifest + meta). No service worker.
 * `beforeinstallprompt` is still listened for in case a future browser fires it without a SW.
 */
export function usePwaInstall() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null)

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferred(e as InstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])

  const standalone = isStandaloneDisplay()
  const showChromeInstall = Boolean(deferred)
  const showIosInstallHint = isIosTouchDevice() && !standalone && !deferred
  const showAndroidBrowserHint =
    isAndroidMobile() && !isIosTouchDevice() && !standalone && !deferred
  const showDesktopHomeScreenHint =
    !standalone && !deferred && !isIosTouchDevice() && !isAndroidMobile()

  const triggerInstallFromPrompt = useCallback(async () => {
    if (!deferred) return
    try {
      await deferred.prompt()
      await deferred.userChoice
    } finally {
      setDeferred(null)
    }
  }, [deferred])

  return {
    standalone,
    showChromeInstall,
    showIosInstallHint,
    showAndroidBrowserHint,
    showDesktopHomeScreenHint,
    triggerInstallFromPrompt,
  }
}
