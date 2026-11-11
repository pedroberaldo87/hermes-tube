// Content script — `content.js` output (IIFE) on https://www.youtube.com/*. Attaches the feature modules according to the
// URL and the ExtState (lib/content.ts). Does not talk to the plugin server (only the background does).
import { startContent } from '../lib/content'
import { CONTENT_MODULES } from '../lib/registry-content'

startContent({ modules: CONTENT_MODULES }).catch((e) => console.warn('[tube] content bootstrap failed', e))
