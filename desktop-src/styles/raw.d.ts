// Plugin stylesheets imported as text (`import css from './x.css?raw'`): Vite/vitest understand `?raw`
// natively; esbuild uses the plugin in desktop-src/styles/esbuild-raw-css.mjs.
declare module '*.css?raw' {
  const css: string
  export default css
}
