// What the Desktop hands to the system opener or loads as an image, whatever the database holds.
// The backend already keeps only YouTube links and images on new data (`safe_channel_url` / `safe_thumb_url` in
// plugin/core/importers.py, same host lists); rows written before that, or by a future path that forgets it, are
// checked again here: a `file:` link or an image from anywhere never leaves the plugin.

/** Channel pages: `https` on these hosts only (opened as `https://www.youtube.com/…`). */
const PAGE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
/** Image hosts YouTube serves avatars and thumbnails from (any subdomain). */
const IMAGE_HOST_SUFFIXES = ['ggpht.com', 'googleusercontent.com', 'ytimg.com']

function parse(url: string | null | undefined): URL | null {
  if (typeof url !== 'string' || !url.trim()) return null
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null
    return u
  } catch {
    return null
  }
}

export function youtubeChannelPage(channelId: string): string {
  return `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`
}

/** The channel link to open outside: the stored one if it is an https YouTube page, else the canonical page. */
export function safeChannelUrl(url: string | null | undefined, channelId: string): string {
  const u = parse(url)
  if (!u || !PAGE_HOSTS.has(u.hostname.toLowerCase())) return youtubeChannelPage(channelId)
  return `https://www.youtube.com${u.pathname}${u.search}`
}

/** Avatar/thumbnail source: https on a YouTube image host, else `null` (the caller draws its fallback). */
export function safeImageUrl(url: string | null | undefined): string | null {
  const u = parse(url)
  if (!u) return null
  const host = u.hostname.toLowerCase()
  return IMAGE_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`)) ? u.href : null
}
