import type { ReactNode } from 'react'

export const GROUP_NAV_ICON_IDS = [
  'folder',
  'layers',
  'building',
  'wallet',
  'home',
  'briefcase',
  'landmark',
  'chart',
] as const

export type GroupNavIconId = (typeof GROUP_NAV_ICON_IDS)[number]

export function defaultGroupNavIconId(kind: string): GroupNavIconId {
  if (kind === 'investments') return 'layers'
  if (kind === 'real_estate') return 'building'
  return 'folder'
}

/** Sidebar / UI icon for an asset group — always from `kind`, never from stored `icon`. */
export function resolveGroupNavIconId(kind: string): GroupNavIconId {
  return defaultGroupNavIconId(kind)
}

const ICON_ID_SET = new Set<string>(GROUP_NAV_ICON_IDS)

/** Sidebar / form icon for a portfolio from stored `icon`; invalid or missing → folder. */
export function resolvePortfolioNavIconId(stored: string | null | undefined): GroupNavIconId {
  if (stored && ICON_ID_SET.has(stored)) return stored as GroupNavIconId
  return 'folder'
}

function Svg({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

function path(d: string) {
  return (
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      d={d}
    />
  )
}

export function GroupNavGlyph({ iconId, title }: { iconId: GroupNavIconId; title?: string }) {
  switch (iconId) {
    case 'folder':
      return <Svg title={title}>{path('M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z')}</Svg>
    case 'layers':
      return <Svg title={title}>{path('M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5')}</Svg>
    case 'building':
      return (
        <Svg title={title}>
          {path(
            'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M6 12H4a2 2 0 0 0-2 2v8h20v-8a2 2 0 0 0-2-2h-2M10 6h4M10 10h4M10 14h4M10 18h4',
          )}
        </Svg>
      )
    case 'wallet':
      return <Svg title={title}>{path('M4 9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9Z M2 12h20')}</Svg>
    case 'home':
      return <Svg title={title}>{path('M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10')}</Svg>
    case 'briefcase':
      return (
        <Svg title={title}>
          {path('M4 11V9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2M4 11h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8z M9 11V7a3 3 0 0 1 6 0v4')}
        </Svg>
      )
    case 'landmark':
      return <Svg title={title}>{path('M3 22h18M6 22v-9a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v9M15 22v-5a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v5M10 6V4a2 2 0 1 1 4 0v2')}</Svg>
    case 'chart':
      return <Svg title={title}>{path('M3 3v18h18M7 16l4-6 4 3 5-8')}</Svg>
    default:
      return <Svg title={title}>{path('M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z')}</Svg>
  }
}

