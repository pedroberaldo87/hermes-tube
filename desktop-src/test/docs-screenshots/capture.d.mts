// Types of capture.mjs (Node side of the public screenshots).
export interface SampleAvatar {
  bg: string
  fg: string
  monogram: string
}

export interface SampleAnswer {
  status?: number
  contentType?: string
  body?: Uint8Array
  /** File the image came from (thumbnails), else `null`. */
  file?: string | null
  /** Set when the request is refused: the reason and the URL. */
  blocked?: string
}

export declare const SAMPLE_DIR: string
export declare const SAMPLE_CATALOG: unknown
export declare const REAL_CHANNEL_TITLES: string[]
export declare function scanText(text: string, options?: { expect?: string[]; pluginId?: string }): string[]
export declare function sampleAvatarUrl(channelId: string): string
export declare function avatarSvg(avatar: SampleAvatar): string
export declare function sampleAnswer(url: string): SampleAnswer
