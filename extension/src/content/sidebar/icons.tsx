// content/sidebar — own icons, 24 × 24, 1.5 stroke in the style of the outline icons of YouTube's guide
// (no logo, no red). `currentColor`: they follow the text tone.
import type { JSX } from 'preact'

const stroke = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const

const svg = (children: JSX.Element | JSX.Element[], size = 24): JSX.Element => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
    {children}
  </svg>
)

/** Tab: stack of videos (related to the Subscriptions icon, without being identical). */
export const TabIcon = (): JSX.Element =>
  svg([
    <path key="a" d="M6.5 3.75h11" {...stroke} />,
    <rect key="b" x="3.75" y="6.75" width="16.5" height="13" rx="2.25" {...stroke} />,
    <path key="c" d="M10.25 10.6v5.3l4.4-2.65z" fill="currentColor" />
  ])

/** "All new": inbox tray (what arrived). */
export const NewIcon = (): JSX.Element =>
  svg([
    <path key="a" d="M5.6 6.4 3.75 13.5v4.25c0 1.1.9 2 2 2h12.5c1.1 0 2-.9 2-2V13.5L18.4 6.4c-.3-.85-1.1-1.4-2-1.4H7.6c-.9 0-1.7.55-2 1.4z" {...stroke} />,
    <path key="b" d="M3.75 13.5h4.5l1.5 2.25h4.5l1.5-2.25h4.5" {...stroke} />
  ])

/** "Favorites": outline star. */
export const StarIcon = (): JSX.Element =>
  svg(<path d="M12 3.9l2.47 5.01 5.53.8-4 3.9.94 5.5L12 16.53 7.06 19.1 8 13.6 4 9.7l5.53-.8z" {...stroke} />)

/** "Watch later": clock. */
export const LaterIcon = (): JSX.Element =>
  svg([<circle key="a" cx="12" cy="12" r="8.25" {...stroke} />, <path key="b" d="M12 7.75V12l2.75 2.75" {...stroke} />])

export const FolderIcon = (): JSX.Element =>
  svg(<path d="M3.75 7.25c0-1.1.9-2 2-2h3.6l2 2.25h6.9c1.1 0 2 .9 2 2v7.25c0 1.1-.9 2-2 2H5.75c-1.1 0-2-.9-2-2z" {...stroke} />)

/** Section mark in the mini-guide: stacked folders. */
export const HermesIcon = (): JSX.Element =>
  svg([
    <path key="a" d="M6.5 4.25h3l1.5 1.5h6.5c.97 0 1.75.78 1.75 1.75" {...stroke} />,
    <path key="b" d="M3.75 9.75c0-1.1.9-2 2-2h3.6l2 2h6.9c1.1 0 2 .9 2 2v6c0 1.1-.9 2-2 2H5.75c-1.1 0-2-.9-2-2z" {...stroke} />
  ])

/** HermesTube mark next to the section name: a wing (Hermes's), in the same outline style. */
export const WingIcon = (): JSX.Element =>
  svg(
    [
      <path
        key="a"
        d="M3.75 16.25C4 10 9.5 5.25 20.25 4.75c-.6 2.4-2.2 4-4.75 4.75h3.25c-.9 2.1-2.7 3.4-5.25 3.75h2.75c-1.3 2.4-3.7 3.75-6.75 3.75-2.2 0-4.1-.3-5.75-.75z"
        {...stroke}
      />,
      <path key="b" d="M8.5 12.25c1.6-1.6 3.9-2.6 7-2.75M8 15c1.3-1 3.1-1.6 5.5-1.75" {...stroke} />
    ]
  )

export const ChevronIcon = (): JSX.Element => svg(<path d="M9.5 6.5L15 12l-5.5 5.5" {...stroke} />, 16)

export const CloseIcon = (): JSX.Element => svg(<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" {...stroke} />)

export const BackIcon = (): JSX.Element => svg(<path d="M19 12H5.5M11 6.5L5.5 12l5.5 5.5" {...stroke} />)

export const CheckIcon = (): JSX.Element => svg(<path d="M5 12.5l4.5 4.5L19 7.5" {...stroke} />, 20)

export const InfoIcon = (): JSX.Element =>
  svg(
    [<circle key="a" cx="12" cy="12" r="8.25" {...stroke} />, <path key="b" d="M12 11v5M12 8v.01" {...stroke} />],
    16
  )

export const OffIcon = (): JSX.Element =>
  svg(
    [
      <path key="a" d="M8.5 8.5a5 5 0 0 0 7 7M10 6.3a5 5 0 0 1 7.7 7.7" {...stroke} />,
      <path key="b" d="M4.5 4.5l15 15M12 3v2M12 19v2" {...stroke} />
    ],
    16
  )

export const ViaIcon = (): JSX.Element =>
  svg(<path d="M3.75 7.25c0-1.1.9-2 2-2h3.6l2 2.25h6.9c1.1 0 2 .9 2 2v7.25c0 1.1-.9 2-2 2H5.75c-1.1 0-2-.9-2-2z" {...stroke} />, 14)
