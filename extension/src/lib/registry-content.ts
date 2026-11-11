// Content feature modules (youtube.com), in start order. A new module = a new line here.
import { home } from '../content/home/index'
import { scraper } from '../content/scraper'
import { searchContent } from '../content/search'
import { sidebar } from '../content/sidebar/index'
import { thumbs } from '../content/thumbs'
import { tracker } from '../content/tracker'
import { unsubscribe } from '../content/unsubscribe'
import type { ContentModule } from './content'

export const CONTENT_MODULES: readonly ContentModule[] = [sidebar, thumbs, home, scraper, tracker, unsubscribe, searchContent]
