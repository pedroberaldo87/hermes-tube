// Shell module state and how to reset it. The Desktop reloads plugin.js in the same realm (hot
// reload, disable/enable): ES modules do not unload, so all shell module state
// registers here and is reset on unload (ctx.onDispose in main.tsx) and between tests.

const resets = new Set<() => void>()

/** Registers a function that returns a module's state to its initial value. */
export function onShellReset(fn: () => void): void {
  resets.add(fn)
}

/** Resets all registered module state (plugin unload, tests). */
export function resetShellState(): void {
  for (const fn of resets) {
    try {
      fn()
    } catch {
      // a reset that fails must not stop the others
    }
  }
}
