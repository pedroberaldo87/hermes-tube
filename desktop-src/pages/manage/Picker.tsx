// Manage in-place picker: a filtering field + list (role=listbox), opened anchored to the trigger (folder/tags
// cell, bar filter, batch action). One or many: `single` picks and closes; `multi` checks/unchecks and saves
// with Enter (empty field) or "Apply". Typing filters; ↑/↓ move; Enter confirms; Esc gives up (without saving). With
// `onCreate`, text without an exact match offers "New folder/tag “X”". Own markup (not the SDK's Select/Popover): the
// same design and keyboard across the whole screen, and no portal inside the virtualized table.
import { Button, Codicon } from '@hermes/plugin-sdk'
import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import { cssVar, cx } from '../../lib/style'
import { normalize } from './model'

export interface PickerOption {
  value: string
  label: string
  /** Codicon before the label. */
  icon?: string
  /** Indent (nested folders). */
  level?: number
  /** Small text on the right (count). */
  hint?: string
}

export interface PickerProps {
  label: string
  options: readonly PickerOption[]
  mode?: 'single' | 'multi'
  /** single: current value (checked). */
  value?: string | null
  /** multi: values checked on open. */
  values?: readonly string[]
  onPick?: (value: string) => void
  onCommit?: (values: string[]) => void
  /** Create from the text; in `multi` mode it also receives what is checked. */
  onCreate?: (text: string, marked?: string[]) => void
  createLabel?: (text: string) => string
  onClose: () => void
  /** Filter field (default: yes when there are many options or creation). */
  searchable?: boolean
  align?: 'start' | 'end'
  footer?: ReactNode
}

export function Picker({
  label,
  options,
  mode = 'single',
  value,
  values,
  onPick,
  onCommit,
  onCreate,
  createLabel,
  onClose,
  searchable,
  align = 'start',
  footer
}: PickerProps) {
  const t = useT('manage')
  const base = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [marked, setMarked] = useState<string[]>(() => [...(values ?? [])])
  const [active, setActive] = useState(0)
  const [flip, setFlip] = useState(false)
  const showSearch = searchable ?? (options.length > 6 || !!onCreate)

  const shown = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean)
    if (!words.length) return options
    return options.filter((o) => {
      const hay = normalize(o.label)
      return words.every((w) => hay.includes(w))
    })
  }, [options, query])

  const text = query.trim()
  const canCreate = !!onCreate && !!text && !options.some((o) => normalize(o.label) === normalize(text))

  useEffect(() => setActive(0), [query])

  // focus on the field (or the list) on open; closes on outside click
  useEffect(() => {
    ;(inputRef.current ?? listRef.current)?.focus()
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // near the end of the window, opens upward
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el || typeof window === 'undefined') return
    const r = el.getBoundingClientRect()
    if (r.height && r.bottom > window.innerHeight - 8 && r.top - r.height > 48) setFlip(true)
  }, [])

  // the active option stays in view
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const toggle = (v: string) => setMarked((m) => (m.includes(v) ? m.filter((x) => x !== v) : [...m, v]))

  const choose = (o: PickerOption) => {
    if (mode === 'multi') {
      toggle(o.value)
      return
    }
    onPick?.(o.value)
    onClose()
  }

  const create = () => {
    if (!canCreate) return
    onCreate?.(text, mode === 'multi' ? marked : undefined)
    onClose()
  }

  const commit = () => {
    onCommit?.(marked)
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation() // the table does not react to the keyboard from inside the picker
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, Math.max(0, shown.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = shown[active]
      if (mode === 'multi') {
        // with text: checks the match (or creates) and clears the field; empty: saves
        if (text && hit) {
          toggle(hit.value)
          setQuery('')
        } else if (canCreate) create()
        else commit()
      } else if (hit) choose(hit)
      else create()
    }
  }

  const isMarked = (o: PickerOption) => (mode === 'multi' ? marked.includes(o.value) : (value ?? '') === o.value)

  return (
    <div
      ref={rootRef}
      className={cx('mpicker')}
      data-part="manage-picker"
      data-align={align}
      data-flip={flip ? 'true' : undefined}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {showSearch ? (
        <input
          ref={inputRef}
          type="text"
          className={cx('mpicker-input t-body')}
          data-part="picker-input"
          value={query}
          placeholder={t('picker.filter')}
          aria-label={label}
          aria-controls={`${base}-list`}
          aria-activedescendant={shown[active] ? `${base}-${active}` : undefined}
          onChange={(e) => setQuery(e.target.value)}
        />
      ) : null}
      <div
        ref={listRef}
        id={`${base}-list`}
        role="listbox"
        aria-label={label}
        aria-multiselectable={mode === 'multi' ? true : undefined}
        tabIndex={showSearch ? -1 : 0}
        className={cx('mpicker-list')}
        aria-activedescendant={!showSearch && shown[active] ? `${base}-${active}` : undefined}
      >
        {shown.map((o, i) => (
          <div
            key={o.value || '∅'}
            id={`${base}-${i}`}
            role="option"
            data-value={o.value}
            aria-selected={isMarked(o)}
            data-active={i === active ? 'true' : undefined}
            className={cx('mpicker-option t-body')}
            style={o.level && o.level > 1 ? ({ [cssVar('level')]: o.level } as CSSProperties) : undefined}
            onMouseEnter={() => setActive(i)}
            onClick={() => choose(o)}
          >
            <span className={cx('mpicker-check')} aria-hidden="true">
              {isMarked(o) ? <Codicon name="check" size={13} /> : null}
            </span>
            {o.icon ? <Codicon name={o.icon} size={13} className={cx('mpicker-icon')} /> : null}
            <span className={cx('mpicker-label truncate')}>{o.label}</span>
            {o.hint ? <span className={cx('mpicker-hint t-label')}>{o.hint}</span> : null}
          </div>
        ))}
        {!shown.length && !canCreate ? <div className={cx('mpicker-empty t-label')}>{t('picker.empty')}</div> : null}
      </div>
      {canCreate ? (
        <button type="button" className={cx('bare mpicker-create t-body')} data-part="picker-create" onClick={create}>
          <Codicon name="add" size={13} />
          <span className={cx('truncate')}>{createLabel ? createLabel(text) : text}</span>
        </button>
      ) : null}
      {mode === 'multi' ? (
        <div className={cx('mpicker-foot')}>
          <Button variant="outline" size="xs" data-part="picker-apply" onClick={commit}>
            {t('picker.apply')}
          </Button>
        </div>
      ) : null}
      {footer}
    </div>
  )
}
