// Preview bundle entry. The only file that talks to react-dom (the preview ships React;
// the real plugin.js never does). Stays .mjs: it is not in tsc nor in the screens' import rule.
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { PreviewApp, bootPreview } from './app'

const boot = bootPreview()
createRoot(document.getElementById('root')).render(createElement(PreviewApp, { boot }))
