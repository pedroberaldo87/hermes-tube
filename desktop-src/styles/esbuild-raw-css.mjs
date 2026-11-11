// esbuild plugin for `import css from './x.css?raw'`: returns the CSS text as an array of
// lines joined by \n — plugin.js stays readable (one CSS line per JS line; a single string
// would become one giant line and the bundle would look minified). No @import, no url(): the text goes in as is.
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

export function rawCssPlugin() {
  return {
    name: 'raw-css',
    setup(build) {
      // The module path goes into the bundle in a comment (`// raw-css:<path>`). Relative to the build root:
      // absolute, the published plugin.js carried the directory (and the user) of whoever built it, and the artifact changed
      // from machine to machine.
      const root = build.initialOptions.absWorkingDir || process.cwd()
      build.onResolve({ filter: /\.css\?raw$/ }, (args) => ({
        path: relative(root, resolve(dirname(args.importer), args.path.replace(/\?raw$/, ''))).split(sep).join('/'),
        namespace: 'raw-css'
      }))
      build.onLoad({ filter: /.*/, namespace: 'raw-css' }, (args) => {
        const file = resolve(root, args.path)
        const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')
        const body = lines.map((l) => `  ${JSON.stringify(l)}`).join(',\n')
        return { contents: `export default [\n${body}\n].join("\\n");\n`, loader: 'js', watchFiles: [file] }
      })
    }
  }
}
