// Dialog frame over the SDK's `Dialog*`: always open while mounted; closing (Esc, ×,
// click outside) calls `onClose` (which pops the dialog off the lib/dialogs stack). The body scrolls INSIDE
// (header and footer with the buttons stay fixed) and shows a shadow on the top/bottom edge when there is more
// content to scroll. The body is a container (the content responds to the dialog width, not the window's).
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@hermes/plugin-sdk'
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../lib/style'
import { withClass } from './kit'

export interface DialogFrameProps {
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  footer?: ReactNode
  children?: ReactNode
  className?: string
  /** Width: sm 420 · md 560 (default) · lg 760 · xl 980 (always fits the window). */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /**
   * Passed to `DialogContent` (Radix listens for Esc on the document, before the focused field). `preventDefault()`
   * keeps the dialog open — e.g. Esc in an inline edit field only cancels the edit.
   */
  onEscapeKeyDown?: (event: KeyboardEvent) => void
}

type Overflow = 'none' | 'top' | 'bottom' | 'both'

export function DialogFrame({ title, description, onClose, footer, children, className, size = 'md', onEscapeKeyDown }: DialogFrameProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState<Overflow>('none')
  const measure = useCallback(() => {
    const el = bodyRef.current
    if (!el) return
    const top = el.scrollTop > 1
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setOverflow(top && bottom ? 'both' : top ? 'top' : bottom ? 'bottom' : 'none')
  }, [])
  useLayoutEffect(() => {
    measure()
    const el = bodyRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const child of el.children) ro.observe(child)
    return () => ro.disconnect()
  }, [measure, children])
  return (
    <Dialog
      open
      onOpenChange={(open: boolean) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className={withClass(cx('dialog'), className)} data-size={size} {...(onEscapeKeyDown ? { onEscapeKeyDown } : {})}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className={cx('dialog-scroll')} data-part="dialog-scroll" data-overflow={overflow}>
          <div className={cx('dialog-body')} data-part="dialog-body" ref={bodyRef} onScroll={measure}>
            {children}
          </div>
        </div>
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  )
}
