// Mascot (`ctx.pet`, Desktop JS only) with a chip fallback: if there is no visible mascot
// (or the host is old), the line goes to `$petFallback`, which the chip shows.
import { atom, type PetMessageTone } from '@hermes/plugin-sdk'
import type { StatusResponse } from '../../shared/api-types'
import { maybePluginContext } from './ctx'
import { onShellReset } from './lifecycle'

export interface MascotLine {
  /** Stable per subject: the same id replaces the line in the bubble. */
  id: string
  text: string
  tone?: PetMessageTone
  ttlMs?: number
}

/** Decides what the mascot says when `/status` changes (filled in by chat/mascot). */
export type MascotLinesFn = (prev: StatusResponse | null, next: StatusResponse) => MascotLine[]

export const $petFallback = atom<(MascotLine & { at: number }) | null>(null)

onShellReset(() => {
  $petFallback.set(null)
})

/** `true` if there is a mascot on screen to speak. */
export function petAvailable(): boolean {
  const pet = maybePluginContext()?.pet
  return !!pet && typeof pet.say === 'function' && pet.visible?.get?.() === true
}

/** Speaks through the mascot; without one, stores it in the chip fallback. Returns where it ended up. */
export function sayToPet(line: MascotLine): 'pet' | 'fallback' {
  const ctx = maybePluginContext()
  if (ctx && petAvailable()) {
    ctx.pet.say(line.text, {
      id: line.id,
      ...(line.tone ? { tone: line.tone } : {}),
      ...(line.ttlMs ? { ttlMs: line.ttlMs } : {})
    })
    return 'pet'
  }
  $petFallback.set({ ...line, at: Date.now() })
  return 'fallback'
}

export function clearPetFallback(): void {
  $petFallback.set(null)
}
