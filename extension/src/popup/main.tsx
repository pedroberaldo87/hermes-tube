// Popup entry. The stylesheet (popup.css) comes in through index.html.
// The same page also opens in a tab on the extension's first load (`?welcome=1`): it is then centered.
import { render } from 'preact'
import { isWelcomeSurface } from '../background/welcome'
import { App } from './App'

if (isWelcomeSurface(location.search)) document.documentElement.dataset.surface = 'tab'
const root = document.getElementById('app')
if (root) render(<App />, root)
