import { useEffect, useState } from 'react'
import type { JsonImportMode } from '../api'

export type ImportJsonModalProps = {
  open: boolean
  title: string
  pastedJson: string
  onPastedJsonChange: (value: string) => void
  importMode: JsonImportMode
  onImportModeChange: (mode: JsonImportMode) => void
  importing: boolean
  onClose: () => void
  onImport: () => void
  getAiPrompt: () => string
  /** Unique name for radio group (per page). */
  radioName: string
}

function IconCopy() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

export default function ImportJsonModal({
  open,
  title,
  pastedJson,
  onPastedJsonChange,
  importMode,
  onImportModeChange,
  importing,
  onClose,
  onImport,
  getAiPrompt,
  radioName,
}: ImportJsonModalProps) {
  const [aiVisible, setAiVisible] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [copyDone, setCopyDone] = useState(false)

  useEffect(() => {
    if (!open) {
      setAiVisible(false)
      setAiPrompt('')
      setCopyDone(false)
    }
  }, [open])

  useEffect(() => {
    if (!copyDone) return
    const t = window.setTimeout(() => setCopyDone(false), 2000)
    return () => window.clearTimeout(t)
  }, [copyDone])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(aiPrompt)
      setCopyDone(true)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = aiPrompt
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setCopyDone(true)
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <div
      className="import-json-modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="import-json-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-json-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="import-json-modal__head">
          <h2 id="import-json-modal-title">{title}</h2>
          <button type="button" className="import-json-modal__close btn btn-sm" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <fieldset className="import-json-mode import-json-modal__mode">
          <div className="import-json-mode__legend">Import mode</div>
          <div className="import-json-mode__options">
            <label>
              <input
                type="radio"
                name={radioName}
                checked={importMode === 'add'}
                onChange={() => onImportModeChange('add')}
              />
              Add to existing data
            </label>
            <label>
              <input
                type="radio"
                name={radioName}
                checked={importMode === 'replace'}
                onChange={() => onImportModeChange('replace')}
              />
              Replace existing data
            </label>
          </div>
        </fieldset>

        <label className="import-json-modal__json-label">
          JSON
          <textarea
            className="import-json-modal__textarea"
            rows={12}
            spellCheck={false}
            value={pastedJson}
            onChange={(e) => onPastedJsonChange(e.target.value)}
          />
        </label>

        <div className="import-json-modal__actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setAiPrompt(getAiPrompt())
              setAiVisible(true)
            }}
          >
            Get AI Prompt
          </button>
          <div className="import-json-modal__actions-spacer" />
          <button type="button" className="btn" disabled={importing} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={importing} onClick={onImport}>
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>

        {aiVisible ? (
          <div className="import-json-modal__ai-block">
            <div className="import-json-modal__ai-head">
              <span className="import-json-modal__ai-label">Prompt for your AI chat</span>
              <button
                type="button"
                className="import-json-modal__copy-btn"
                onClick={() => void copyPrompt()}
                title="Copy to clipboard"
                aria-label="Copy prompt to clipboard"
              >
                <IconCopy />
                {copyDone ? <span className="import-json-modal__copied">Copied</span> : null}
              </button>
            </div>
            <pre className="import-json-modal__ai-pre">{aiPrompt}</pre>
          </div>
        ) : null}
      </div>
    </div>
  )
}
