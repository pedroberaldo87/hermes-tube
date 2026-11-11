// Leader election among mounted instances of the same component. The shell mounts the same host
// (dialogs, /status poll, mascot) in several permanent places — status bar chip,
// pane, pages — because the user can hide any of them. Only the first one mounted acts;
// when it unmounts, the next one takes over.
import { atom, useValue } from '@hermes/plugin-sdk'
import { useEffect, useId } from 'react'
import { onShellReset } from './lifecycle'

const groups = new Map<string, ReturnType<typeof atom<string[]>>>()

function group(name: string) {
  let g = groups.get(name)
  if (!g) {
    g = atom<string[]>([])
    groups.set(name, g)
  }
  return g
}

onShellReset(() => {
  for (const g of groups.values()) g.set([])
})

/** `true` only on the group's leader instance. */
export function useLeader(name: string): boolean {
  const id = useId()
  const g = group(name)
  const members = useValue(g)
  useEffect(() => {
    g.set([...g.get().filter((m) => m !== id), id])
    return () => {
      g.set(g.get().filter((m) => m !== id))
    }
  }, [g, id])
  return members[0] === id
}
