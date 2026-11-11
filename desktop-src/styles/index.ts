// Plugin sheets, in the order they enter the <style> (lib/style.ts swaps the PFX_ marker for the prefix).
// New sheet: create the .css here, import it below and add it to CSS_ORDER and CSS_SOURCES (the style test
// checks that every .css in this folder is included, in order).
//
// In plugin.js the text comes from the esbuild plugin (styles/esbuild-raw-css.mjs). In vitest, `.css?raw` comes out
// empty (vitest does not process CSS by default); the style tests read the sheets from disk through vi.mock.
import channel from './channel.css?raw'
import flows from './flows.css?raw'
import layout from './layout.css?raw'
import misc from './misc.css?raw'
import nav from './nav.css?raw'
import tokens from './tokens.css?raw'
import video from './video.css?raw'

export const CSS_ORDER = ['tokens', 'layout', 'video', 'nav', 'channel', 'flows', 'misc'] as const

export const CSS_SOURCES: readonly string[] = [tokens, layout, video, nav, channel, flows, misc]
