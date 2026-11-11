// Dialog registry: no screen imports a dialog. Whoever wants to open one calls
// `openDialog('<id>', props)` with the props typed by `DialogProps` (shared/ids.ts); main.tsx
// registers the components once; the `DialogHost` (leader, mounted with the shell) renders the top of the stack.
import { atom, useValue } from '@hermes/plugin-sdk'
import type { ComponentType } from 'react'
import type { DialogId, DialogProps } from '../../shared/ids'
import { useLeader } from './leader'
import { onShellReset } from './lifecycle'

/** What every dialog receives besides its own props. */
export interface DialogControls {
  /** Closes this dialog (back to the previous one on the stack, if any). */
  onClose: () => void
}

export type DialogComponent<K extends DialogId> = ComponentType<DialogProps[K] & DialogControls>

/** One component per id — the type forces the registry to cover every `DIALOG_IDS`. */
export type DialogRegistry = { [K in DialogId]: DialogComponent<K> }

export interface OpenDialog {
  id: DialogId
  props: DialogProps[DialogId]
  /** Changes on every open: remounts the dialog even with the same id. */
  seq: number
}

let registry: Partial<DialogRegistry> = {}
let seq = 0

export const $dialogStack = atom<OpenDialog[]>([])

onShellReset(() => {
  registry = {}
  $dialogStack.set([])
})

/** Registers the components of all dialogs (main.tsx). Returns the disposer. */
export function registerDialogs(map: DialogRegistry): () => void {
  registry = { ...map }
  return () => {
    registry = {}
    $dialogStack.set([])
  }
}

// `{} extends X` = all props optional
type PropsArg<K extends DialogId> = {} extends DialogProps[K] ? [props?: DialogProps[K]] : [props: DialogProps[K]]

/** Opens a dialog by id, on top of the current one. */
export function openDialog<K extends DialogId>(id: K, ...[props]: PropsArg<K>): void {
  seq += 1
  $dialogStack.set([...$dialogStack.get(), { id, props: (props ?? {}) as DialogProps[DialogId], seq }])
}

/** Closes the top dialog (or the one opened as `seqOf`, if still open). */
export function closeDialog(seqOf?: number): void {
  const stack = $dialogStack.get()
  if (!stack.length) return
  if (seqOf === undefined) $dialogStack.set(stack.slice(0, -1))
  else $dialogStack.set(stack.filter((d) => d.seq !== seqOf))
}

export function closeAllDialogs(): void {
  $dialogStack.set([])
}

/** Renders the top dialog. May be mounted in several places: only the leader renders. */
export function DialogHost() {
  const leader = useLeader('dialog-host')
  const stack = useValue($dialogStack)
  if (!leader) return null
  const top = stack[stack.length - 1]
  if (!top) return null
  const Component = registry[top.id] as DialogComponent<DialogId> | undefined
  if (!Component) {
    console.warn(`[dialogs] no component registered for "${top.id}"`)
    return null
  }
  return <Component key={top.seq} {...(top.props as DialogProps[DialogId])} onClose={() => closeDialog(top.seq)} />
}
