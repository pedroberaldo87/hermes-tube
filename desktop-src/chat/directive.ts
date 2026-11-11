// Strict validation of the `::tube-video{id="…"}` directive. The attributes are model output — UNTRUSTED
// data. Only a plain object with exactly ONE own attribute, `id`, an 11-character string from the
// YouTube alphabet (A–Z a–z 0–9 - _), passes. Anything else (extra attribute, invalid id, HTML, URL,
// look-alike unicode) does not become a card: the chat shows the original text as plain text (React escapes).
import { isVideoId } from '../lib/format'

/** The video id, or `null` if the directive is not exactly `{id: "<11 characters>"}`. */
export function parseVideoDirective(attrs: unknown): string | null {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return null
  const proto = Object.getPrototypeOf(attrs)
  if (proto !== Object.prototype && proto !== null) return null
  const keys = Reflect.ownKeys(attrs)
  if (keys.length !== 1 || keys[0] !== 'id') return null
  const desc = Object.getOwnPropertyDescriptor(attrs, 'id')
  if (!desc || !('value' in desc)) return null // getter: runs nothing from the model
  const id: unknown = desc.value
  return isVideoId(id) ? id : null
}

/** Max length of the fallback text (the host accepts bodies up to 2048). */
export const FALLBACK_MAX = 240

/** Original text of a rejected directive, one line and short. Text only: never becomes HTML. */
export function fallbackText(source: unknown): string {
  if (typeof source !== 'string') return ''
  const flat = source.replace(/\s+/g, ' ').trim()
  return flat.length > FALLBACK_MAX ? `${flat.slice(0, FALLBACK_MAX)}…` : flat
}
