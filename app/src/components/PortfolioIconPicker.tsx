import { useEffect, useId, useRef, useState } from 'react'
import { GROUP_NAV_ICON_IDS, GroupNavGlyph, type GroupNavIconId } from '../groupNavIcons'

type Props = {
  value: GroupNavIconId
  onChange: (id: GroupNavIconId) => void
}

export default function PortfolioIconPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  const pick = (id: GroupNavIconId) => {
    onChange(id)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="portfolio-icon-picker">
      <button
        type="button"
        className="portfolio-icon-picker__trigger"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
        aria-label={open ? 'Portfolio icon menu open' : 'Choose portfolio icon'}
        onClick={() => setOpen((v) => !v)}
      >
        <GroupNavGlyph iconId={value} title="Selected portfolio icon" />
      </button>
      {open ? (
        <div id={listId} className="portfolio-icon-picker__popover" role="listbox" aria-label="Portfolio icons">
          {GROUP_NAV_ICON_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={id === value}
              className={`portfolio-icon-picker__option${id === value ? ' portfolio-icon-picker__option--selected' : ''}`}
              title={id}
              onClick={() => pick(id)}
            >
              <GroupNavGlyph iconId={id} title={id} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
