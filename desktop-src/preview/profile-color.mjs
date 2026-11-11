// Faithful copy of apps/desktop/src/lib/profile-color.ts from Hermes (for the PREVIEW only): the tests' mock
// always returns the accent, and the preview needs the per-name stable hue the real app computes, so the
// avatar fallback comes out the same as the app's. Stays .mjs (the "no fixed color" rule applies to the UI
// in .ts/.tsx; here it is the app's function, which generates the color at runtime).
const PROFILE_TAG_SATURATION = 68
const PROFILE_TAG_LIGHTNESS = 58

function hashString(value) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  return hash
}

export function profileColor(name) {
  const key = (name ?? '').trim()
  if (!key || key === 'default') return null
  const hue = hashString(key) % 360
  return `hsl(${hue} ${PROFILE_TAG_SATURATION}% ${PROFILE_TAG_LIGHTNESS}%)`
}

export function profileColorSoft(color, percent = 16) {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}
