// Playwright config for the public screenshot of the YouTube sidebar (docs/screenshots/youtube-sidebar.png).
// Same browser setup as the extension scenarios (extension/e2e/playwright.config.ts); only the test file differs.
//
//   source .unit-env    # or any TMPDIR
//   EXT_DIST_DIR=$TMPDIR/ext-docs npx playwright test -c scripts/docs-sidebar.config.ts
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import base from '../extension/e2e/playwright.config.ts'

export default {
  ...base,
  testDir: dirname(fileURLToPath(import.meta.url)),
  testMatch: 'docs-sidebar.spec.ts',
  outputDir: `${process.env.TMPDIR || '/tmp'}/docs-sidebar-results`
}
