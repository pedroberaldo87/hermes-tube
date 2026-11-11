// Background feature modules, in registration order. A new module = a new line here.
import { history } from '../background/history'
import { pairing } from '../background/pairing'
import { queue } from '../background/queue'
import { search } from '../background/search'
import { sync } from '../background/sync'
import type { BackgroundModule } from './background'

export const BACKGROUND_MODULES: readonly BackgroundModule[] = [pairing, sync, history, queue, search]
