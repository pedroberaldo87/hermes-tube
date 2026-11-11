// HermesTube v0.1.0. Built from desktop-src/ by desktop-src/esbuild.config.mjs. Do not edit by hand.

// desktop-src/main.tsx
import {
  PALETTE_AREA as PALETTE_AREA2,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  STATUSBAR_AREAS,
  TRANSCRIPT_DIRECTIVE_AREA
} from "@hermes/plugin-sdk";

// shared/ids.ts
var PLUGIN_ID = "hermes-tube";
var API_PREFIX = `/api/plugins/${PLUGIN_ID}`;
function rpcMethod(name) {
  return `plugin.${PLUGIN_ID}.${name}`;
}
function eventType(name) {
  return `plugin.${PLUGIN_ID}.${name}`;
}
var RPC_CAPABILITY = "plugin-rpc-v1";
var RPC_UNAVAILABLE_CODE = -32601;
var DESKTOP_ROUTES = {
  home: `/${PLUGIN_ID}`,
  manage: `/${PLUGIN_ID}/manage`,
  cleanup: `/${PLUGIN_ID}/cleanup`,
  extras: `/${PLUGIN_ID}/extras`
};
var DIALOG_IDS = {
  onboarding: "onboarding",
  tabEditor: "tab-editor",
  organize: "organize",
  theme: "theme",
  listImport: "list-import",
  history: "history",
  createTab: "create-tab"
};
var PANE_ID = "subscriptions";
var STATUS_CHIP_ID = "new-count";
var PALETTE_COMMANDS = {
  openHome: "open-home",
  organize: "organize",
  cleanup: "cleanup",
  newThemeTab: "new-theme-tab",
  refreshNow: "refresh-now",
  openExtras: "open-extras"
};
var CHAT_DIRECTIVE = "tube-video";
var MESSAGE_KEYS = {
  /** No RPC on this backend (`-32601`/no `plugin-rpc-v1`): `{message}` fallback of the rpc.yaml methods. */
  openDesktopBackend: "open_desktop_backend",
  /** `ext_endpoint_up` false / the extension cannot find the server: "open Hermes to reconnect". */
  reconnectOpenHermes: "reconnect_open_hermes",
  /** Undo refused with reason `already_executed`. */
  alreadyExecuted: "already_executed",
  /** `llm_unavailable`: set a model for the `curator` task (Settings → Models). */
  noModel: "no_model"
};
var STATUS_POLL_MS = 5e3;
var JOB_POLL_MS = 2e3;
var RPC_TIMEOUT_MS = 3e4;
var EXT_PORT_BASE = 47615;
var EXT_PORT_SPAN = 10;
var EXT_PORTS = Array.from({ length: EXT_PORT_SPAN }, (_, i) => EXT_PORT_BASE + i);

// desktop-src/chat/index.tsx
import { Button as Button9, Codicon as Codicon16 } from "@hermes/plugin-sdk";
import { useInsertionEffect } from "react";

// desktop-src/components/Page.tsx
import { Button, Codicon } from "@hermes/plugin-sdk";

// desktop-src/lib/i18n.ts
import { usePluginI18n } from "@hermes/plugin-sdk";
import { useCallback } from "react";

// desktop-src/lib/lifecycle.ts
var resets = /* @__PURE__ */ new Set();
function onShellReset(fn) {
  resets.add(fn);
}
function resetShellState() {
  for (const fn of resets) {
    try {
      fn();
    } catch {
    }
  }
}

// desktop-src/lib/ctx.ts
var current = null;
function setPluginContext(ctx) {
  current = ctx;
}
function getPluginContext() {
  if (!current) throw new Error(`${PLUGIN_ID}: plugin context not registered`);
  return current;
}
function maybePluginContext() {
  return current;
}
onShellReset(() => {
  current = null;
});

// desktop-src/locales/en/chat.json
var chat_default = {
  card: {
    label: "Video: {title}",
    loading: "Loading video details",
    unknown_title: "Watch on YouTube",
    unknown_note: "Not in your library yet",
    error: "Couldn't load the details",
    retry: "Try again"
  },
  actions: {
    label: "Video actions",
    later: "Later",
    watched: "Watched",
    open: "Open on YouTube"
  },
  toast: {
    later: "Saved for later",
    unlater: "Removed from Later",
    watched: "Marked as watched",
    unwatched: "Marked as not watched",
    undo: "Undo",
    failed: "Couldn't save: {error}",
    undo_failed: "Couldn't undo: {error}"
  },
  mascot: {
    published: "⭐ {channel}: {title}",
    published_untitled: "⭐ {channel} just posted a new video",
    more: "⭐ {count} more favorites posted new videos",
    setting: {
      title: "Mascot announces favorites",
      description: "A short note from the mascot when a ⭐ channel posts, at most once per channel per day."
    }
  }
};

// desktop-src/locales/en/chrome.json
var chrome_default = {
  locale: "en",
  chip: {
    new_one: "new",
    new_other: "new",
    none: "Nothing new",
    refreshing: "refreshing…",
    loading: "Subscriptions",
    unavailable_label: "Subscriptions unavailable",
    title_new: "{count} new videos — open your subscriptions",
    title_none: "You're all caught up — open your subscriptions",
    title_refreshing: "Looking for new videos… — open your subscriptions",
    title_loading: "Reading your subscriptions…",
    reason_unavailable: "HermesTube isn't on in the “{profile}” profile. Go back to the profile where you installed it, or turn it on in Capabilities → Plugins.",
    reason_offline: "Can't reach Hermes right now. It will try again on its own.",
    reason_error: "Couldn't read your new videos: {error}",
    updated: "updated {when}",
    pet: "Hermes says: {text}"
  },
  palette: {
    "open-home": {
      label: "Subscriptions: open",
      keywords: "youtube subscriptions home feed videos new"
    },
    "refresh-now": {
      label: "Subscriptions: refresh now",
      keywords: "youtube subscriptions refresh update rss fetch reload"
    },
    "new-theme-tab": {
      label: "Subscriptions: new topic tab",
      keywords: "youtube subscriptions theme tab topic new create"
    },
    organize: {
      label: "Subscriptions: organize with Hermes",
      keywords: "youtube subscriptions organize folders sort ai"
    },
    cleanup: {
      label: "Subscriptions: clean up",
      keywords: "youtube subscriptions cleanup unsubscribe tidy inactive"
    },
    "open-extras": {
      label: "Subscriptions: extras",
      keywords: "youtube subscriptions extras hackertube hn thumbnails lists"
    },
    connect: {
      label: "HermesTube: Connect a browser or add a channel",
      keywords: "youtube subscriptions extension browser chrome connect pair code channel add link welcome setup"
    }
  },
  refresh: {
    started: "Looking for new videos…",
    running: "Already looking for new videos",
    skipped: "Your subscriptions are up to date",
    failed: "Couldn't refresh: {error}"
  },
  detail: {
    refreshing: "refreshing…",
    new_one: "{count} new",
    new_other: "{count} new",
    none: "nothing new",
    updated: "updated {when}"
  },
  gate: {
    title: "The plugin isn't on in “{profile}”",
    hint: "You're in the “{profile}” profile. Go back to the profile where you installed it, or turn it on here: Capabilities → Plugins → HermesTube.",
    remote: "You're connected to {name}, not this computer. Switch to {local} to use HermesTube with the Hermes on this computer.",
    local_default: "This device"
  }
};

// desktop-src/locales/en/cleanup.json
var cleanup_default = {
  title: "Cleanup",
  subtitle: {
    last_scan: "Last scan {when}",
    by_model: "reasons by {model}",
    by_rule: "reasons by rule",
    never: "Not scanned yet",
    scanning: "Scanning your subscriptions…",
    error: "Couldn't read the last scan"
  },
  actions: {
    scan: "Scan again",
    scan_first: "Scan now",
    home: "Go to Subscriptions",
    connect: "Connect the extension"
  },
  groups: {
    label: "{group} channels",
    loading: "Loading the cleanup",
    select_all: "Select all {count}",
    clear: "Unselect",
    stale: {
      title: "Inactive",
      rule: "No new video in 180 days or more."
    },
    ignored: {
      title: "Not watched",
      rule: "8 or more videos in the last 90 days, none of them watched.",
      needs_history: "Needs the watch history from the browser extension to find these."
    },
    off_profile: {
      title: "Off your profile",
      rule: "Far from the folders and favorites you use most, according to Hermes."
    },
    manual: {
      title: "Marked by you",
      rule: "You marked these to cancel in Manage."
    }
  },
  row: {
    select: "Select {name}",
    keep: "Keep",
    keep_label: "Keep {name}",
    last_video: "last video {when}",
    no_videos: "no videos known",
    watched: "{count} watched in 90 days",
    per_week: "{count} a week"
  },
  selection: {
    label: "Selection",
    none: "Pick channels or a whole group. Nothing is cancelled until you confirm.",
    count_one: "{count} channel selected",
    count_other: "{count} channels selected",
    clear: "Clear",
    review_none: "Review cancellation",
    review_one: "Review cancellation ({count})",
    review_other: "Review cancellation ({count})"
  },
  approve: {
    title_one: "Cancel {count} subscription?",
    title_other: "Cancel {count} subscriptions?",
    description: "Nothing happens until you confirm here.",
    effect_one: "The browser extension will cancel {count} subscription on YouTube, in your browser.",
    effect_other: "The browser extension will cancel {count} subscriptions on YouTube, in your browser, one at a time.",
    effect_resubscribe: "You can resubscribe for {days} days from Ex-subscriptions.",
    effect_undo: "Until it runs, you can undo it in the queue.",
    effect_offline: "The extension is offline: it stays in the queue until your browser opens.",
    confirm_one: "Cancel {count} subscription",
    confirm_other: "Cancel {count} subscriptions",
    more: "+{count} more",
    refused: "Approval refused: only a click here, in Hermes Desktop, approves a cancellation.",
    failed: "Couldn't queue it: {error}",
    show_all: "See all {count}",
    show_less: "Show less",
    list_label: "Channels to cancel"
  },
  resub: {
    title: "Resubscribe to {name}?",
    description: "It goes through the same queue as cancellations.",
    effect: "The browser extension will subscribe to {name} again on YouTube, in your browser.",
    effect_undo: "Until it runs, you can undo it in the queue.",
    confirm: "Resubscribe to {name}"
  },
  queue: {
    title: "Queue",
    description: "The browser extension runs one at a time, with a short pause between them.",
    label: "Cancellation queue",
    unknown_channel: "Channel {id}",
    undo: "Undo",
    undo_label: "Undo {name}",
    undo_all_one: "Undo {count} pending",
    undo_all_other: "Undo {count} pending",
    action: {
      unsubscribe: "cancel subscription",
      resubscribe: "resubscribe"
    },
    status: {
      approved: "approved · waiting for the extension",
      approved_offline: "approved · waits until your browser opens",
      running: "in progress in your browser",
      done: "done {when}",
      failed: "failed: {reason}",
      failed_unknown: "failed (the extension didn't say why)"
    },
    note: {
      not_subscribed: "Already unsubscribed on YouTube; nothing was clicked.",
      already_subscribed: "Already subscribed on YouTube; nothing was clicked."
    }
  },
  ex: {
    title: "Ex-subscriptions",
    description: "Cancelled through the queue. You can resubscribe for {days} days.",
    label: "Ex-subscriptions",
    cancelled: "cancelled {when}",
    until: "resubscribe until {date}",
    resubscribe: "Resubscribe",
    resubscribe_label: "Resubscribe to {name}",
    queued: "In the queue",
    empty: "No ex-subscriptions. Channels you cancel here stay for {days} days, ready to come back.",
    error: "Couldn't load the ex-subscriptions"
  },
  banner: {
    scanning: "Scanning your subscriptions…",
    scanning_progress: "Scanning your subscriptions… {done} of {total}",
    scan_failed: "The scan didn't finish: {error}",
    server_down: "Can't reach the plugin's server — the queue waits until it's back.",
    ext_endpoint_down: "The extension's local server is off — the queue waits until Hermes turns it back on.",
    ext_disconnected: "Browser extension disconnected — approvals stay in the queue until your browser opens.",
    no_model: "No AI model: reasons come from the rules and the Off-your-profile group is off. Pick a model and sign in under Settings → Models.",
    provider_unavailable: "Hermes couldn't reach your AI model ({route}): reasons come from the rules and the Off-your-profile group is off. Sign in to it again, or pick another model for “YouTube curator” in Settings → Model → Auxiliary models.",
    provider_unavailable_plain: "Hermes couldn't reach your AI model: reasons come from the rules and the Off-your-profile group is off. Sign in to it again, or pick another model for “YouTube curator” in Settings → Model → Auxiliary models.",
    provider_unavailable_action: "Open model settings",
    retry: "Try again",
    connect: "Connect",
    ext_not_paired: "Connect the browser extension to bring in your subscriptions",
    reconnect: "Reconnect"
  },
  empty: {
    never_title: "Let's tidy up your subscriptions",
    never_desc: "Hermes looks for three kinds of channel. Nothing is cancelled without your click.",
    clean_title: "All tidy",
    clean_desc: "No inactive, unwatched or off-profile channels in the last scan ({when}).",
    criteria: {
      label: "What the scan looks for",
      stale: "Inactive: no new video in 180 days",
      ignored: "Not watched: no video watched in 90 days",
      off_profile: "Off your profile: far from your folders and favorites"
    }
  },
  toast: {
    queued_one: "{count} subscription queued to cancel",
    queued_other: "{count} subscriptions queued to cancel",
    resub_queued: "{name} queued to resubscribe",
    undo: "Undo",
    undone_one: "Approval undone",
    undone_other: "{count} approvals undone",
    undo_failed: "Couldn't undo: {error}",
    kept: "{name} stays — removed from the suggestions",
    keep_failed: "Couldn't remove the suggestion: {error}",
    scan_done: "Scan finished",
    scan_unavailable: "Scanning needs Hermes' AI from the Desktop backend."
  }
};

// desktop-src/locales/en/common.json
var common_default = {
  plugin_name: "HermesTube",
  loading: "Loading…",
  empty: "Nothing here yet",
  retry: "Try again",
  close: "Close",
  error_title: "Something went wrong",
  open_desktop_backend: "This needs Hermes' AI. Open it from the Hermes Desktop app with its local backend (or use /tube in the chat).",
  reconnect_open_hermes: "Open Hermes to reconnect the browser extension.",
  already_executed: "Already executed — use Resubscribe in Cleanup → Ex-subscriptions.",
  no_model: "No AI model is available. Pick one and sign in under Settings → Models.",
  provider_unavailable: "Hermes couldn't reach your AI model ({route}). Sign in to it again, or pick another model for “YouTube curator” in Settings → Model → Auxiliary models.",
  provider_unavailable_plain: "Hermes couldn't reach your AI model. Sign in to it again, or pick another model for “YouTube curator” in Settings → Model → Auxiliary models.",
  nav: {
    home: "Subscriptions",
    manage: "Manage subscriptions",
    cleanup: "Cleanup",
    extras: "Extras"
  },
  routes: {
    home: "Subscriptions",
    manage: "Manage",
    cleanup: "Cleanup",
    extras: "Extras",
    watch: "Watch"
  },
  pane: {
    title: "Subscriptions",
    open_page: "Open HermesTube",
    open_page_short: "Open",
    open_page_tip: "Open HermesTube in the center"
  },
  chip: {
    new: "▶ {count} new",
    title: "Open Subscriptions",
    refreshing: "refreshing…"
  },
  palette: {
    "open-home": "Subscriptions: open",
    organize: "Subscriptions: organize with Hermes",
    cleanup: "Subscriptions: cleanup",
    "new-theme-tab": "Subscriptions: new topic tab",
    "refresh-now": "Subscriptions: refresh now",
    "open-extras": "Subscriptions: extras"
  },
  refresh: {
    started: "Refreshing subscriptions…",
    running: "A refresh is already running",
    skipped: "Subscriptions are up to date"
  },
  dialogs: {
    onboarding: "Welcome",
    "tab-editor": "Tab",
    organize: "Organize with Hermes",
    theme: "New topic tab",
    "list-import": "Import a list",
    history: "History",
    "create-tab": "Create a tab from the selection"
  },
  placeholder: {
    title: "Coming soon",
    description: "This screen is still being built."
  },
  video: {
    new: "New",
    open: "Open on YouTube",
    short: "Short",
    live: "Live",
    premiere: "Premiere",
    kind: {
      video: "Video"
    },
    duration: {
      h: "{count} h",
      m: "{count} min",
      s: "{count} s"
    },
    views: "{count} views",
    why: {
      folder: "Folder",
      tag: "Tag",
      channel: "Channel",
      theme: "Topic",
      hn: "Hacker News",
      list: "List"
    },
    badge: {
      hn: "HN recommends"
    }
  },
  errors: {
    not_found: "Not found.",
    conflict: "That conflicts with something that already exists.",
    invalid: "Some of the information is invalid.",
    unauthorized: "Not authorized.",
    undo_refused: "This change can't be undone.",
    approval_refused: "This approval was refused.",
    timeout: "It took too long. Try again.",
    busy: "Hermes is busy with another task. Try again in a moment.",
    llm_unavailable: "No AI model is available. Pick one and sign in under Settings → Models.",
    llm_invalid: "The AI answered in an unexpected format. Try again.",
    youtube_error: "YouTube didn't answer as expected.",
    http_error: "A network request failed.",
    origin_forbidden: "This origin is not allowed.",
    origin_required: "The request is missing its origin.",
    origin_mismatch: "The request came from a different origin.",
    host_forbidden: "This host is not allowed.",
    plugin_disabled: "The plugin is off in this profile. Turn it on in Capabilities → Plugins.",
    no_active_code: "There is no active pairing code.",
    invalid_code: "Wrong pairing code.",
    expired: "The pairing code expired.",
    used: "The pairing code was already used.",
    locked: "Too many attempts. Generate a new code.",
    ext_endpoint_down: "The extension endpoint is down. Open Hermes to reconnect.",
    internal: "Unexpected error."
  },
  kit: {
    shortcut_label: "{label} ({key})",
    actions: {
      label: "Quick actions",
      watched: "Watched",
      later: "Later",
      archive: "Archive",
      up: "Like",
      down: "Not for me",
      open: "Open",
      watched_do: "Mark as watched",
      watched_undo: "Undo watched",
      later_do: "Save to Watch later",
      later_undo: "Remove from Watch later",
      archive_do: "Archive",
      archive_undo: "Unarchive",
      up_do: "Like",
      up_undo: "Remove like",
      down_do: "Not for me",
      down_undo: "Undo not for me"
    },
    density: {
      label: "Density",
      comfortable: "Comfortable",
      compact: "Compact",
      list: "List"
    },
    tabs: {
      label: "Tabs",
      add: "New tab",
      new_count: "{count} new",
      menu: "Options for the {name} tab"
    },
    filter: {
      search: "Search",
      clear: "Clear filters",
      results: "{count} results"
    },
    thumb: {
      watched: "Watched",
      new: "New",
      progress: "Watched {percent}%",
      unavailable: "Thumbnail unavailable"
    },
    why: {
      label: "Why it's here"
    },
    channel: {
      favorite: "Favorite",
      no_folder: "No folder",
      no_videos: "No videos yet",
      select: "Select {name}",
      columns: {
        channel: "Channel",
        folder: "Folder",
        tags: "Tags",
        new: "New",
        last: "Last video",
        actions: "Actions"
      }
    },
    tree: {
      expand: "Expand",
      collapse: "Collapse",
      drop: "Drop here to move",
      new_count: "{count} new"
    },
    steps: {
      waiting: "Waiting",
      running: "In progress",
      done: "Done",
      failed: "Failed"
    },
    suggest: {
      accept: "Accept",
      reject: "Reject",
      accept_all: "Accept group",
      reject_all: "Reject group",
      by_model: "by {model}",
      confidence: "{percent}% sure",
      accepted: "Accepted",
      rejected: "Rejected",
      count: "{count} suggestions",
      count_one: "{count} suggestion"
    },
    approval: {
      what: "What will happen",
      cancel: "Cancel",
      not_now: "Not now"
    },
    pairing: {
      label: "Pairing code",
      expires: "Expires in {time}",
      expired: "Code expired",
      regenerate: "New code",
      copy: "Copy code",
      steps_label: "How to pair",
      step_open: "Open the extension",
      step_open_hint: "Click its icon in your browser's toolbar.",
      step_code: "Type this code",
      step_done: "Done",
      waiting: "Waiting for the extension…",
      paired: "Connected. Bringing in your subscriptions.",
      done_hint: "Your subscriptions show up here as soon as it connects."
    },
    banner: {
      dismiss: "Dismiss"
    },
    chip: {
      remove: "Remove {name}"
    },
    path: {
      recommended: "Recommended"
    },
    welcome: {
      title: "Welcome",
      tagline: "Your subscriptions. Your way."
    },
    dialog: {
      more_above: "More above",
      more_below: "More below"
    }
  },
  sections: {
    label: "HermesTube sections",
    menu: "Section: {section}",
    back: "Back",
    close_video: "Close video"
  },
  playlists: {
    add: "Add to playlist",
    count: "{count} videos",
    count_one: "1 video",
    saved: "Saved to {name}",
    removed: "Removed from {name}",
    failed: "Couldn't save the playlist: {error}",
    picker: {
      title: "Add to playlist",
      description: "Your playlists stay in HermesTube, on this computer. Nothing changes on YouTube.",
      loading: "Loading your playlists…",
      empty: "No playlists yet. Create the first one below.",
      new: "New playlist…",
      name_label: "Playlist name",
      name_placeholder: "e.g. Physics",
      create: "Create",
      cancel: "Cancel",
      done: "Done"
    }
  }
};

// desktop-src/locales/en/extras.json
var extras_default = {};

// desktop-src/locales/en/history.json
var history_default = {};

// desktop-src/locales/en/home.json
var home_default = {
  title: "Subscriptions",
  subtitle: {
    new: "{count} new",
    updated: "updated {when}",
    never: "not refreshed yet",
    refreshing: "refreshing…",
    status_error: "Couldn't read the latest status"
  },
  actions: {
    extras: "Extras",
    refresh: "Refresh",
    new_tab: "New tab",
    mark_read: "Mark as read"
  },
  new_tab: {
    category: "Category",
    category_desc: "Folders and tags you already use",
    channels: "Channels",
    channels_desc: "Hand-pick the channels",
    theme: "Topic",
    theme_desc: "Hermes searches YouTube for a topic",
    mixed: "Mixed",
    mixed_desc: "Combine folders, tags, channels and topics"
  },
  theme_build: {
    button: "New topic tab",
    button_tip: "Hermes searches YouTube and curates a tab about any topic",
    no_ai: "Topic tabs need an AI model to plan the searches and curate. Pick one in Settings → Models first.",
    building: "Building “{name}”…",
    building_unnamed: "Building a topic tab…",
    building_tip: "Hermes is still working on it. Click to see the progress.",
    ready: "Topic tab “{name}” is ready",
    ready_unnamed: "Your topic tab is ready",
    open_preview: "Open preview",
    failed: "Couldn't build “{name}”: {error}",
    failed_unnamed: "Couldn't build the topic tab: {error}",
    retry: "Try again"
  },
  tabs: {
    label: "Feed tabs",
    "all-new": "All new",
    favorites: "Favorites",
    later: "Watch later",
    playlists: "Playlists"
  },
  filters: {
    search: "Search this tab",
    new_only: "New only",
    no_shorts: "Hide Shorts",
    show_seen: "Show watched"
  },
  sections: {
    featured: "Featured"
  },
  feed: {
    label: "{tab} videos",
    count: "{count} videos",
    loading: "Loading videos",
    loading_more: "Loading more videos",
    searching: "Searching…",
    load_more: "Load more",
    more_error: "Couldn't load more videos",
    reordering: "Sorting…",
    group_label: "{tab} videos — {group}"
  },
  toast: {
    watched: "Marked as watched",
    unwatched: "Marked as not watched",
    later: "Saved to Watch later",
    unlater: "Removed from Watch later",
    archived: "Archived",
    up: "Liked",
    down: "Marked as not for me",
    reaction_cleared: "Reaction removed",
    undo: "Undo",
    failed: "Couldn't save that: {error}",
    undo_failed: "Couldn't undo: {error}",
    read: "{tab} marked as read",
    read_nothing: "Nothing new to mark as read",
    refresh_skipped: "Already up to date",
    refresh_failed: "Couldn't start the refresh: {error}",
    unarchived: "Back in the list",
    tab_deleted: "“{name}” tab deleted",
    reorder_failed: "Couldn't save the tab order: {error}"
  },
  banner: {
    demo_arriving: "Loading the demo: {count} videos from {channels} channels so far…",
    channel_arriving: "Fetching the latest videos from {title}…",
    rss_down: "YouTube's feed has been unstable since {time}. Your videos keep arriving another way.",
    rss_down_stale: "YouTube's feed has been unstable since {time}. Showing what we already have.",
    rss_fallback: "{count} channels updated from the channel page",
    retry: "Try again",
    ext_disconnected: "Browser extension disconnected — new subscriptions and watch history won't sync.",
    reconnect: "Reconnect",
    ext_not_paired: "Connect the browser extension to bring in your subscriptions",
    connect: "Connect"
  },
  empty: {
    tab_title: "You're all caught up",
    tab_desc: "Nothing new in {tab}. New videos show up here as soon as the channels post.",
    refreshing_title: "Looking for new videos…",
    see_all: "See all tabs",
    show_seen: "Show watched",
    search_title: "Nothing found for “{query}”",
    search_desc: "Search looks at video titles and channel names across this whole tab.",
    search_loaded_desc: "Nothing among the loaded videos matches “{query}”.",
    filter_title: "No matches",
    filter_desc: "No loaded video passes these filters.",
    clear: "Clear search and filters",
    clear_search: "Clear search",
    clear_filters: "Clear filters",
    later_title: "Nothing saved for later",
    later_desc: "Press L on any video (or the clock button) to keep it here."
  },
  welcome: {
    lead: "Pick a way to start. You can add the others later.",
    group: "How to start",
    pair_title: "Connect the browser extension",
    pair_desc: "Brings in all your subscriptions and watch history from your browser — no password, nothing leaves your machine.",
    pair_action: "Pair now",
    pair_hint: "About 1 min",
    link_title: "Paste a channel",
    link_desc: "Paste a channel link or an @handle to follow it here without subscribing on YouTube.",
    link_action: "Paste a link",
    demo_title: "Try the demo",
    demo_desc: "40 real public channels in 6 folders, to explore before connecting anything.",
    demo_action: "Load the demo",
    demo_hint: "Removable any time",
    demo_loading: "Loading…",
    demo_failed: "Couldn't load the demo: {error}",
    link_label: "Channel link or @handle",
    link_placeholder: "youtube.com/@channel or @handle",
    link_hint: "Channel or video link, @handle or channel id (UC…). Press Enter to follow.",
    link_submit: "Follow",
    link_added: "Now following {title}",
    errors: {
      empty: "Paste a channel link or @handle first.",
      invalid: "That doesn't look like a YouTube channel link or @handle.",
      conflict: "{title} is already in your list.",
      conflict_generic: "That channel is already in your list.",
      youtube_error: "YouTube couldn't find that channel. Check the link and try again.",
      timeout: "YouTube took too long to answer. Try again in a moment."
    }
  },
  pane_filter: {
    label: "Filtering by: {name}",
    clear: "Stop filtering",
    create_tab: "Create a tab with this"
  },
  gone: {
    archived: "Archived",
    undo: "Undo"
  },
  tab_menu: {
    edit: "Edit…",
    move_left: "Move left",
    move_right: "Move right",
    delete: "Delete…",
    delete_title: "Delete the “{name}” tab?",
    delete_desc: "Its channels, folders and videos stay as they are — only the tab goes away.",
    delete_confirm: "Delete tab",
    delete_cancel: "Not now",
    delete_failed: "Couldn't delete the tab: {error}"
  },
  view: {
    label: "View",
    menu_label: "View: {sort}, {group}",
    sort_title: "Sort",
    group_title: "Group",
    sort_label: "Sort: {value}",
    group_label: "Group: {value}",
    sort: {
      newest: "Newest",
      oldest: "Oldest",
      longest: "Longest",
      shortest: "Shortest",
      views: "Most viewed"
    },
    group: {
      none: "None",
      channel: "Channel",
      folder: "Folder",
      day: "Day",
      kind: "Type"
    },
    group_trigger: {
      none: "Not grouped",
      channel: "By channel",
      folder: "By folder",
      day: "By day",
      kind: "By type"
    }
  },
  group: {
    today: "Today",
    yesterday: "Yesterday",
    no_date: "No date",
    no_folder: "No folder",
    no_channel: "Unknown channel",
    kind: {
      video: "Videos",
      short: "Shorts",
      unknown: "Type not known yet"
    },
    count_more: "{count}+",
    count_hint: "{count} loaded so far"
  },
  playlists: {
    label: "Your playlists",
    count: "{count} videos",
    count_one: "1 video",
    open: "Open {name}",
    empty_title: "No playlists yet",
    empty_desc: "Use Add to playlist on any video to start one.",
    empty_action: "See all tabs",
    back: "All playlists",
    play_all: "Play all",
    rename: "Rename",
    rename_label: "New name",
    rename_save: "Save",
    rename_cancel: "Cancel",
    delete: "Delete",
    delete_title: "Delete “{name}”?",
    delete_desc: "Only the playlist goes away. Its videos stay in your subscriptions and in any other playlist.",
    delete_confirm: "Delete playlist",
    delete_cancel: "Keep",
    deleted: "Deleted {name}",
    renamed: "Renamed to {name}",
    failed: "Couldn't change the playlist: {error}",
    remove: "Remove from playlist",
    removed: "Removed from {name}",
    items_label: "Videos in {name}",
    playlist_empty_title: "This playlist is empty",
    playlist_empty_desc: "Use Add to playlist on any video to put it here.",
    local_note: "Kept in HermesTube on this computer, not on your YouTube account."
  }
};

// desktop-src/locales/en/list-import.json
var list_import_default = {};

// desktop-src/locales/en/manage.json
var manage_default = {
  title: "Manage",
  subtitle: "{subscribed} subscribed · {followed} following",
  count: "{shown} of {total} channels",
  table_label: "Channels",
  loading: "Loading channels",
  select_all: "Select all {count} filtered channels",
  select_row: "Select {name}",
  sort_by: "Sort by {name}",
  columns: {
    select: "Selection",
    name: "Channel",
    folder: "Folder",
    tags: "Tags",
    last: "Last video",
    rhythm: "Pace",
    shorts: "Shorts",
    watched: "Watched",
    relation: "Relation"
  },
  column_hints: {
    last: "When the latest video came out",
    rhythm: "Videos per week",
    shorts: "Share of Shorts among recent videos",
    watched: "Videos you watched in the last 90 days"
  },
  rhythm_value: "{n}/wk",
  no_folder: "No folder",
  add_tags: "Add tags",
  edit_folder: "Change folder of {name}",
  edit_tags: "Change tags of {name}",
  favorite: "Favorite",
  muted: "Muted",
  relation: {
    active: "Subscribed + following",
    subscribed: "Subscribed",
    followed: "Following",
    ex: "Former subscription",
    ignored: "Ignored"
  },
  filters: {
    search: "Search name or @handle",
    folder: "Folder",
    folder_all: "All folders",
    tag: "Tag",
    tag_all: "Any tag",
    relation: "Relation",
    favorite: "Favorites",
    muted: "Muted",
    stale: "Inactive",
    stale_any: "Any time",
    stale_option: "No video in {count} months"
  },
  chips: {
    folder: "Folder: {name}",
    tag: "#{name}",
    stale: "No video in {count}+ months",
    remove: "Remove filter: {name}"
  },
  rail: {
    label: "Folders",
    all: "All channels",
    none: "No folder",
    new: "New folder",
    placeholder: "Folder name",
    rename: "Rename {name}",
    drop: "Drop to move here"
  },
  picker: {
    filter: "Type to filter",
    create_folder: "New folder “{name}”",
    create_tag: "New tag “{name}”",
    apply: "Apply",
    empty: "Nothing matches",
    move: "Move to folder",
    tag: "Add tag",
    untag: "Remove tag"
  },
  batch: {
    label: "Selection actions",
    selected_one: "{count} selected",
    selected_other: "{count} selected",
    hidden_one: "{count} hidden by filters",
    hidden_other: "{count} hidden by filters",
    move: "Move to…",
    tag: "Add tag",
    untag: "Remove tag",
    favorite: "Favorite",
    unfavorite: "Unfavorite",
    mute: "Mute",
    unmute: "Unmute",
    read: "Mark as read",
    organize: "Organize with Hermes",
    clear: "Clear selection"
  },
  toast: {
    move_one: "{name} moved to {folder}",
    move_other: "{count} channels moved to {folder}",
    move_none_one: "{name} taken out of its folder",
    move_none_other: "{count} channels taken out of their folders",
    tag_one: "#{tag} added to {name}",
    tag_other: "#{tag} added to {count} channels",
    untag_one: "#{tag} removed from {name}",
    untag_other: "#{tag} removed from {count} channels",
    favorite_one: "{name} added to favorites",
    favorite_other: "{count} channels added to favorites",
    unfavorite_one: "{name} removed from favorites",
    unfavorite_other: "{count} channels removed from favorites",
    mute_one: "{name} muted",
    mute_other: "{count} channels muted",
    unmute_one: "{name} unmuted",
    unmute_other: "{count} channels unmuted",
    read_one: "{name} marked as read",
    read_other: "{count} channels marked as read",
    read_nothing: "Nothing new to mark as read",
    read_partial: "{count} channels couldn't be marked: {error}",
    tags_set: "Tags of {name} updated",
    nothing: "Nothing changed",
    folder_created: "Folder “{name}” created",
    folder_renamed: "Folder renamed to “{name}”",
    undo: "Undo",
    undone: "Undone",
    undo_failed: "Couldn't undo: {error}",
    failed: "Couldn't save: {error}"
  },
  row_error: "Not saved: {error}",
  banner: {
    ext_disconnected: "Browser extension disconnected — new subscriptions won't sync.",
    reconnect: "Reconnect",
    ext_not_paired: "Connect the browser extension to bring in your subscriptions",
    connect: "Connect"
  },
  empty: {
    title: "No channels yet",
    description: "Connect the browser extension, paste a channel link or load the demo.",
    action: "Get started"
  },
  no_results: {
    title: "No channel matches these filters",
    description: "Loosen a filter or clear them all.",
    action: "Clear filters"
  },
  error: {
    title: "Couldn't load your channels"
  },
  actions: {
    organize: "Organize with Hermes",
    cleanup: "Cleanup",
    connect: "Connect a browser",
    connect_hint: "Connect a browser or add a channel",
    connected: "Browser connected",
    connected_hint: "See connected browsers or add a channel"
  }
};

// desktop-src/locales/en/onboarding.json
var onboarding_default = {
  title: "Welcome",
  hero: {
    tagline: "Your subscriptions. Your way.",
    lead: "Bring your YouTube subscriptions into Hermes and organize them however you like. Pick a way to start — the others stay here for later."
  },
  paths: {
    label: "How to start",
    key_hint: "Press {key}",
    pair: {
      title: "Connect the browser extension",
      desc: "Brings all your subscriptions and what you watch, straight from your browser. No password.",
      action: "Connect",
      hint: "Recommended"
    },
    link: {
      title: "Paste a channel",
      desc: "Paste a channel link or an @handle to follow it here, without the extension.",
      action: "Paste a link",
      hint: "No extension"
    },
    demo: {
      title: "Try the demo",
      desc: "40 real public channels in 6 folders, to explore before connecting anything.",
      action: "Load the demo",
      hint: "One click",
      loaded_desc: "The demo is loaded. Clear it whenever you like — what you added stays.",
      loaded_action: "Manage the demo"
    }
  },
  back: "All options",
  plural: {
    channels_one: "{count} channel",
    channels_other: "{count} channels",
    folders_one: "{count} folder",
    folders_other: "{count} folders",
    videos_one: "{count} video",
    videos_other: "{count} videos"
  },
  pair: {
    title: "Connect the browser extension",
    desc: "Type this code in the extension to link your browser to Hermes.",
    desc_syncing: "Connected. Reading your subscriptions…",
    desc_done: "Connected. You're all set.",
    code_label: "Your code",
    steps_label: "Steps to connect",
    step_open: "Open the extension in Chrome and type the code",
    step_open_detail: "Click the extension icon in the browser toolbar",
    step_read: "Reading your subscriptions",
    step_read_detail: "The extension opens your subscriptions page in a tab for a few seconds; nothing in your account is changed",
    step_ready: "Ready",
    waiting: "Waiting for the extension…",
    expired_hint: "This code expired. Create another one — it takes a second.",
    connected_title: "{name} connected",
    connected_desc: "This fills in by itself; it usually takes a few seconds.",
    done_title: "Your subscriptions are here",
    slow: "The first read can take a few minutes when you follow many channels. You can close this — channels show up on their own.",
    close: "Close",
    unnamed: "Your browser",
    endpoint_down: "The extension talks to Hermes only while Hermes is open. Keep it open (in the background is fine) and the extension reconnects by itself.",
    install: {
      title: "Don't have the extension yet?",
      body: "In Chrome, open the Extensions page, turn on Developer mode and choose “Load unpacked” with the extension folder. Then pin it to the toolbar.",
      store_url: "",
      store_link: "Get the extension"
    },
    setup: {
      title: "Set up the extension",
      desc: "Hermes puts the HermesTube extension in a folder in your home folder and opens {browser}'s Extensions page. The browser then needs two clicks from you.",
      action: "Set up the extension",
      busy: "Setting up…",
      choose_browser: "Browser",
      browser_generic: "your browser",
      no_browser_found: "Hermes didn't find Chrome, Edge, Brave, Chromium, Vivaldi or Opera on the computer where it runs. It can still prepare the folder; then open your browser's Extensions page yourself.",
      update_title: "A new version of the extension is ready",
      update_desc: "Hermes replaces the files in the same folder (version {version}). Then press Reload on the extension's card in the browser.",
      update_action: "Update the extension",
      ready_title: "The extension folder is ready",
      reopen: "Open the Extensions page",
      steps_label: "Steps to install the extension",
      step_folder: "Hermes put the extension in a folder",
      step_updated: "Hermes updated the extension to version {version}",
      step_dev: "Turn on “{dev}”",
      step_drag: "Drag the “HermesTube Extension” folder onto that page",
      step_drag_detail: "Or click “{load}” and choose the folder — its path can be copied above",
      step_reload: "Press Reload on the HermesTube card in {browser}",
      step_reload_detail: "On the browser's Extensions page. The extension stays connected to Hermes.",
      step_code: "Type the code below in the extension",
      step_code_detail: "The extension opens a tab by itself and asks for the code",
      copy_path: "Copy the folder path",
      opened: "{browser}'s Extensions page and the folder are open.",
      opened_page_only: "{browser}'s Extensions page is open. Use the path below to find the folder.",
      not_opened_title: "Hermes couldn't open {browser}",
      open_yourself: "Extensions page:",
      copy_url: "Copy the address",
      other_computer: "If Hermes runs on another computer, the folder was created there, not on this one. The extension only talks to a Hermes on the same computer, so follow the install guide on the computer where Hermes runs.",
      problem: {
        no_browser: "{browser} wasn't found on the computer where Hermes runs.",
        no_display: "The computer where Hermes runs has no screen to open {browser} on.",
        failed: "{browser} didn't start on the computer where Hermes runs.",
        unsupported: "Hermes can't open a browser on this system."
      },
      manual_title: "Or do it by hand",
      manual_open: "In {browser}, open",
      manual_dev: "Turn on “{dev}”",
      manual_load: "Click “{load}” and choose this folder:",
      manual_load_above: "Click “{load}” and choose the folder above.",
      manual_folder_later: "Hermes creates this folder when you press “Set up the extension”.",
      manual_code: "Type the code below in the tab the extension opens (or click its icon in the toolbar).",
      browsers: {
        chrome: {
          dev: "Developer mode",
          load: "Load unpacked",
          where: "The switch is at the top right of the Extensions page."
        },
        chromium: {
          dev: "Developer mode",
          load: "Load unpacked",
          where: "The switch is at the top right of the Extensions page."
        },
        edge: {
          dev: "Developer mode",
          load: "Load unpacked",
          where: "The switch is in the left-hand panel of the Extensions page (if the panel is hidden, open it with the menu button at the top left)."
        },
        brave: {
          dev: "Developer mode",
          load: "Load unpacked",
          where: "The switch is at the top right of the Extensions page."
        },
        vivaldi: {
          dev: "Developer mode",
          load: "Load unpacked",
          where: "The switch is at the top right of the Extensions page."
        },
        opera: {
          dev: "Developer mode",
          load: "Load unpacked",
          where: "The switch is at the top right of the Extensions page."
        },
        arc: {
          dev: "Developer mode",
          load: "Load unpacked",
          where: "The switch is at the top right of the Extensions page."
        },
        generic: {
          dev: "Developer mode",
          load: "Load unpacked",
          where: "The switch is on the browser's Extensions page, usually at the top right."
        }
      },
      sandbox: {
        flatpak_title: "{browser} is a Flatpak and can't see this folder yet",
        flatpak_body: "Give it read access to the folder once — run this in a terminal, then close and reopen the browser:",
        copy_command: "Copy the command",
        snap_title: "{browser} is a snap and can't see this folder",
        snap_body: "Snap browsers only see folders under /home. Use a version of the browser that is not a snap, or another browser."
      },
      ask: {
        title: "Stuck? Hermes can help",
        desc: "Opens a new chat with a ready request: your system, the folder, the browser and the steps. Nothing is sent until you press Send, and the request tells Hermes not to touch the browser's profile, not to skip the browser's own steps and not to install anything without asking.",
        action: "Ask Hermes to help",
        busy: "Opening a chat…",
        sent: "A new chat has the request. Read it and press Send.",
        failed: "Hermes couldn't open a chat. Copy the request and paste it into a chat with Hermes:",
        copy_title: "Copy a request for Hermes",
        copy_desc: "A ready request with your system, the folder, the browser and the steps, for a chat with Hermes. It tells Hermes not to touch the browser's profile, not to skip the browser's own steps and not to install anything without asking.",
        copy_label: "Copy a request for Hermes"
      },
      remote_title: "Hermes runs on another computer ({name})",
      remote_body: "This button sets up the extension on that computer. The extension only talks to a Hermes on the same computer, so use the browser there.",
      wsl: {
        title: "Hermes runs inside WSL",
        localhost: "The browser runs on Windows and reaches Hermes inside WSL through WSL's localhost forwarding, which is on by default. If the code never connects, use “{ask}” below.",
        no_interop: "Hermes runs inside WSL with interop off: open the browser yourself.",
        wsl_disk: "The folder is on the WSL disk: copy it to your Windows user folder if the browser refuses this path."
      },
      not_ours_title: "There's already a folder named “HermesTube Extension”",
      not_ours_body: "Hermes didn't create it, so it won't touch it. Rename or move that folder, then check again.",
      check_again: "Check again",
      error_title: "Hermes couldn't set up the extension",
      error_body: "Try again, or follow the steps by hand below.",
      read_failed: "Couldn't check the extension folder yet — trying again on its own. The button works anyway.",
      show_folder: "Show the folder"
    },
    errors: {
      ext_endpoint_down: {
        title: "Hermes couldn't open the connection to your browser",
        body: "Close and reopen Hermes, then try again. If it keeps happening, another app may be in the way."
      },
      timeout: {
        title: "Hermes took too long to answer",
        body: "It may still be starting up. Try again in a moment."
      },
      generic: {
        title: "We couldn't create a code",
        body: "Hermes didn't answer as expected. Try again."
      }
    }
  },
  done: {
    closing: "Opening your subscriptions in {seconds} s",
    stay: "Stay here",
    open_now: "See my subscriptions"
  },
  link: {
    title: "Paste a channel",
    desc: "A channel link, a video link or an @handle. You follow it here — nothing changes on YouTube.",
    label: "Channel link or @handle",
    placeholder: "@veritasium or youtube.com/@veritasium",
    examples: "For example @mkbhd, youtube.com/@3blue1brown or a video link",
    submit: "Add",
    list_title: "Added here",
    undo: "Undo",
    retry: "Try again",
    dismiss: "Dismiss",
    add_again: "Add again",
    done: "Done",
    status: {
      pending: "Looking it up on YouTube…",
      added: "Following · {handle}",
      added_plain: "Following",
      exists: "Already in your list",
      late: "YouTube is slow — it shows up in your list in a moment",
      undoing: "Undoing…",
      undone: "Removed from your list"
    },
    errors: {
      empty: "Paste a channel link or an @handle.",
      format: "That doesn't look like a YouTube channel. Use an @handle, a channel link or a video link.",
      not_found: "We couldn't find this channel on YouTube. Check the link or the @handle.",
      rate_limited: "YouTube is limiting requests right now. Try again in a few minutes.",
      youtube_down: "YouTube isn't answering right now. Try again in a moment.",
      timeout: "YouTube took too long to answer. Try again.",
      generic: "We couldn't add this channel. Try again.",
      undo_failed: "We couldn't undo it. Try again."
    }
  },
  demo: {
    title: "Demo mode",
    desc: "40 real public channels in 6 folders, a few favorites and a topic tab. Nothing touches your YouTube account.",
    steps_label: "Loading the demo",
    step_channels: "Adding channels and folders",
    step_videos: "Fetching the latest videos",
    step_ready: "Ready to explore",
    load: "Load the demo",
    loaded_title: "The demo is loaded",
    loaded_desc: "Demo channels are in your list. Clearing removes only them — anything you added stays.",
    clear: "Clear the demo",
    cleared_title: "Demo cleared",
    cleared_desc: "Only the demo channels were removed.",
    load_again: "Load it again",
    skipped: "{count} of the demo channels were already yours and stayed as they were",
    videos_later: "Videos keep arriving in the background.",
    rss_down: "YouTube's feed is unstable right now — videos arrive little by little.",
    errors: {
      load: "We couldn't load the demo. Try again.",
      clear: "We couldn't clear the demo. Try again."
    }
  },
  devices: {
    title: "Connected browsers",
    desc: "Browsers linked to Hermes through the extension.",
    seen: "Active {when}",
    never_seen: "Not seen yet",
    online: "Online now",
    revoke: "Disconnect",
    revoke_label: "Disconnect {name}",
    revoke_title: "Disconnect {name}?",
    revoke_desc: "Your subscriptions and folders stay here.",
    revoke_effect_stop: "The extension in this browser stops syncing with Hermes",
    revoke_effect_again: "To connect it again, create a new code here",
    revoke_confirm: "Disconnect {name}",
    revoke_cancel: "Not now",
    revoke_failed: "We couldn't disconnect {name}. Try again.",
    error: "We couldn't load your connected browsers."
  },
  reach: {
    remote_title: "You're connected to {name}, not this computer",
    remote_body: "The extension talks to the Hermes on the computer where your browser is. Switch to {local} to set it up.",
    local_default: "This device",
    anyway: "My browser is on {name}",
    off_title: "The plugin isn't on in “{profile}”",
    off_body: "You're in the “{profile}” profile. Go back to the profile where you installed it, or turn it on here: Capabilities → Plugins → HermesTube."
  }
};

// desktop-src/locales/en/organize.json
var organize_default = {
  title: "Organize with Hermes",
  intro: {
    lead: "Hermes reads each channel's name and latest videos and suggests a folder.",
    count_none: "Channels without a folder",
    count_selection: "Selected channels",
    model_exact: "Uses {model}",
    model_last: "Last suggestions by {model}",
    model_main: "Uses your Hermes model ({model}), or the one you pick for this task",
    model_unknown: "Uses the model you set up in Hermes",
    choose_model: "Choose model",
    start: "Suggest folders",
    not_now: "Not now",
    steps_label: "What happens next"
  },
  steps: {
    read: "Hermes reads names and recent videos",
    suggest: "It suggests a folder (and tags) for each channel",
    review: "You review: nothing changes until you accept"
  },
  progress: {
    label: "Organizing",
    channels: "{done} of {total} channels",
    percent: "{percent}%",
    preparing: "Getting started…",
    arriving: "More suggestions on the way",
    accept_ready_one: "Accept {count} ready",
    accept_ready_other: "Accept {count} ready",
    cancel: "Cancel",
    background: "Keep going in the background"
  },
  review: {
    suggestions_one: "{count} suggestion",
    suggestions_other: "{count} suggestions",
    folders_one: "{count} folder",
    folders_other: "{count} folders",
    new_folders_one: "{count} new",
    new_folders_other: "{count} new",
    by_model: "by {model}",
    nothing_changes: "Nothing changes until you accept.",
    accept_all: "Accept all ({count})",
    shortcut_mac: "⌘↵ accepts all",
    shortcut_other: "Ctrl+Enter accepts all",
    done: "Done",
    close: "Close",
    suggest_again: "Suggest again",
    list_label: "Suggested folders"
  },
  group: {
    new: "new folder",
    tags_only: "New tags (the folder stays the same)"
  },
  row: {
    change_folder: "Change folder for {channel}",
    folder_input: "Folder for {channel}",
    folder_hint: "Enter to keep · Esc to give up",
    edited: "changed by you",
    from: "now in {folder}",
    add_tags_one: "add tag {tags}",
    add_tags_other: "add tags {tags}"
  },
  undo: {
    organized_one: "{count} channel organized",
    organized_other: "{count} channels organized",
    action: "Undo organization",
    undoing: "Undoing…"
  },
  reject: {
    pending_one: "{count} suggestion rejected",
    pending_other: "{count} suggestions rejected",
    undo: "Undo"
  },
  partial: {
    title_one: "{count} channel got no suggestion",
    title_other: "{count} channels got no suggestion",
    timeout: "Time ran out before the end.",
    batch: "A batch didn't come back from the model, or Hermes wasn't sure.",
    retry: "Try those again"
  },
  uncovered: {
    title_one: "{count} channel without a folder isn't in these suggestions",
    title_other: "{count} channels without a folder aren't in these suggestions",
    desc: "They arrived after these suggestions were made, or the last run did not reach them.",
    action: "Suggest for them"
  },
  notice: {
    busy: "An organization was already running, so you're following it.",
    cancelled: "Cancelled. Nothing was applied; suggestions that already arrived stay here for you to review.",
    cancel_failed: "Couldn't cancel; the work will finish on its own. Nothing changes until you accept."
  },
  nothing: {
    title: "Every channel already has a folder",
    desc: "New subscriptions without a folder will show up here.",
    action: "See channels"
  },
  empty: {
    title: "No suggestions this time",
    desc: "Hermes didn't find a good folder for these channels.",
    retry: "Try again"
  },
  no_model: {
    title: "Choose a model so Hermes can organize",
    desc: "Hermes needs an AI model for this task. Pick one and sign in under Settings → Models, then come back and try again.",
    action: "Choose model",
    retry: "Try again"
  },
  provider_unavailable: {
    title: "Hermes couldn't reach your AI model",
    action: "Open model settings",
    retry: "Try again"
  },
  error: {
    title: "Couldn't suggest folders",
    accept: "Couldn't apply",
    reject: "Couldn't reject",
    undo: "Couldn't undo",
    retry: "Try again"
  },
  ai: {
    no_model_title: "No AI model is available",
    no_model_desc: "Hermes needs an AI model to suggest folders. Pick one and sign in under Settings → Models first.",
    choose_model: "Choose model",
    provider_unavailable_title: "Hermes couldn't reach your AI model"
  }
};

// desktop-src/locales/en/panes.json
var panes_default = {
  tree: {
    label: "Subscriptions",
    all: "All",
    later: "Watch later",
    unfiled: "No folder"
  },
  row: {
    menu: "More actions for {name}",
    favorite: "Favorite",
    muted: "Muted"
  },
  search: {
    placeholder: "Find a channel or folder",
    empty_title: "Nothing matches “{query}”",
    empty_desc: "Try part of a channel name, a @handle or a folder.",
    clear: "Clear search"
  },
  empty: {
    title: "No subscriptions yet",
    description: "Connect the browser extension, paste a channel link or try the demo — it takes a minute.",
    action: "Get started"
  },
  error: {
    title: "Couldn't load your subscriptions",
    unavailable: "The plugin isn't on in “{profile}”",
    offline: "Can't reach Hermes right now",
    unavailable_hint: "You're in the “{profile}” profile. Go back to the profile where you installed it, or turn it on here: Capabilities → Plugins → HermesTube.",
    offline_hint: "Check that Hermes is running, then try again."
  },
  banner: {
    counts_failed: "Couldn't read the new-video counts.",
    retry: "Try again",
    ext_disconnected: "Browser extension disconnected.",
    reconnect: "Reconnect",
    rss_down: "YouTube's feed is down — showing what we already have."
  },
  menu: {
    open_home: "Open in Subscriptions",
    mark_read: "Mark as read",
    mark_all_read: "Mark all as read",
    favorite: "Add to favorites",
    unfavorite: "Remove from favorites",
    mute: "Mute",
    unmute: "Unmute",
    move: "Move to…",
    new_tab: "New tab with this folder",
    open_youtube: "Open on YouTube"
  },
  move: {
    title: "Move “{name}” to…",
    description_channel: "Pick the folder for this channel.",
    description_folder: "Pick where this folder goes.",
    no_folder: "No folder",
    top_level: "Top level",
    cancel: "Cancel"
  },
  nav: {
    no_tab: "Subscriptions has no tab for {name} yet.",
    create_tab: "Create tab"
  },
  toast: {
    moved_channel: "Moved {name} to {folder}",
    moved_channel_none: "Took {name} out of its folder",
    moved_folder: "Moved {name} into {folder}",
    moved_folder_root: "Moved {name} to the top level",
    favorite_on: "Added {name} to favorites",
    favorite_off: "Removed {name} from favorites",
    muted_on: "Muted {name}",
    muted_off: "Unmuted {name}",
    read: "Marked {name} as read",
    read_all: "Marked everything as read",
    read_nothing: "Nothing new in {name}",
    read_nothing_all: "Nothing new to mark",
    cycle: "A folder can't go inside itself",
    undo: "Undo",
    failed: "Couldn't save: {error}",
    undo_failed: "Couldn't undo: {error}"
  },
  palette: {
    show: {
      label: "HermesTube: Show channels panel",
      keywords: "youtube subscriptions channels panel sidebar show open tab"
    }
  },
  toggle: {
    show: "Show channels panel",
    hide: "Hide channels panel",
    elsewhere: "The channels panel isn't in the right sidebar. To hide it, right-click its tab and choose Hide."
  }
};

// desktop-src/locales/en/tab-editor.json
var tab_editor_default = {
  title_create: "New tab",
  title_edit: "Edit “{name}”",
  title_edit_loading: "Edit tab",
  subtitle_create: "Pick what goes in. The preview changes as you choose.",
  subtitle_edit: "Change what goes in and the filters. Nothing changes until you save.",
  subtitle_builtin: "Built-in tab: its sources stay the same. You can change the filters.",
  name: {
    label: "Name",
    placeholder: "Tab name",
    suggested: "Suggested from your choices. Type to change it.",
    empty: "The tab needs a name.",
    empty_no_suggestion: "Give the tab a name.",
    use: "Use “{name}”",
    long: "Up to {max} characters.",
    duplicate: "The tab “{name}” already uses this name.",
    builtin: "Built-in tabs keep their name."
  },
  icon: {
    label: "Icon",
    placeholder: "🙂",
    hint: "Optional"
  },
  sources: {
    title: "What goes in",
    desc: "Folders include their subfolders. Pick as many as you like.",
    folders: "Folders",
    tags: "Tags",
    channels: "Channels",
    chosen_one: "{count} chosen",
    chosen_other: "{count} chosen",
    none: "None",
    folders_empty: "No folders yet. Create them in Manage.",
    tags_empty: "No tags yet. Create them in Manage.",
    covered: "Included with “{name}”",
    need: "Pick at least one folder, tag or channel.",
    builtin_all: "Everything new from the channels you follow. The sources of a built-in tab don't change.",
    builtin_favorites: "Every ⭐ favorite channel. The sources of a built-in tab don't change."
  },
  channels: {
    search: "Search channels by name",
    search_placeholder: "Search a channel…",
    results: "Matches",
    suggestions: "Your channels",
    no_match: "No channel called “{query}”.",
    add: "Add {name}",
    leave_out: "Leave out {name}",
    remove: "Remove {name}",
    chosen: "Chosen channels"
  },
  filters: {
    title: "What stays out and filters",
    exclude: "Leave out channels",
    exclude_placeholder: "Search a channel to leave out…",
    excluded: "Left out",
    no_shorts: "No Shorts",
    only_new: "Only unwatched",
    only_new_desc: "Hides what you've already seen",
    per_channel: "At most per channel",
    per_channel_desc: "So one channel doesn't take over",
    per_channel_value: "Videos per channel",
    duration: "Duration",
    duration_desc: "In minutes, empty means any",
    min: "Minimum duration (minutes)",
    max: "Maximum duration (minutes)",
    min_short: "min",
    max_short: "max",
    shortcuts: "Duration shortcuts",
    short: "Short · under 10 min",
    long: "Long · 20 min or more",
    duration_bad: "The minimum duration is longer than the maximum.",
    mode: "Mode",
    mode_fresh: "Recent",
    mode_fresh_desc: "Last 30 days",
    mode_long: "Long",
    mode_long_desc: "20 min or more",
    mode_classics: "Classics",
    mode_classics_desc: "Most watched of all time"
  },
  chips: {
    label: "Active filters",
    exclude_one: "Without {name}",
    exclude_other: "Without {count} channels",
    no_shorts: "No Shorts",
    only_new: "Only unwatched",
    per_channel: "Up to {count} per channel",
    min: "{min} min or more",
    max: "Up to {max} min",
    range: "{min}–{max} min",
    mode_fresh: "Recent",
    mode_long: "Long mode",
    mode_classics: "Classics",
    remove: "Remove “{label}”"
  },
  preview: {
    title: "Preview",
    loading: "Loading…",
    videos_one: "{count} video",
    videos_other: "{count} videos",
    channels_one: "{count} channel",
    channels_other: "{count} channels",
    grid_label: "Preview of the tab",
    need_title: "Pick what goes in",
    need_desc: "Choose a folder, a tag or a channel and the videos show up here.",
    need_action: "Choose sources",
    invalid_title: "These filters don't fit together",
    error_title: "Couldn't load the preview",
    empty_title: "No videos with these filters",
    empty_desc: "Remove “{filter}” to see more.",
    empty_action: "Remove “{filter}”",
    empty_sources_title: "These sources have no videos yet",
    empty_sources_desc: "New videos show up here when the channels post. You can also add other sources.",
    empty_sources_action: "Choose other sources"
  },
  footer: {
    cancel: "Cancel",
    create: "Create tab",
    save: "Save",
    saving: "Saving…",
    unsaved: "Unsaved changes",
    no_changes: "No changes yet",
    hint: "⌘Enter creates the tab",
    shortcut: "⌘Enter / Ctrl+Enter",
    delete: "Delete tab",
    error: "Not saved: {error}"
  },
  confirm: {
    discard_title: "Discard your changes?",
    discard_desc: "What you chose here will be lost.",
    discard: "Discard",
    keep: "Keep editing",
    delete_title: "Delete the tab “{name}”?",
    delete_desc: "Channels, folders and videos stay as they are.",
    delete: "Delete tab",
    not_now: "Not now"
  },
  toast: {
    created: "Tab “{name}” created",
    saved: "Tab “{name}” saved",
    deleted: "Tab “{name}” deleted",
    undo: "Undo",
    undone: "“{name}” is back as it was",
    undo_failed: "Couldn't undo: {error}"
  },
  load: {
    missing_title: "This tab doesn't exist anymore",
    missing_desc: "It may have been deleted somewhere else.",
    close: "Close"
  }
};

// desktop-src/locales/en/theme.json
var theme_default = {
  title: "New topic tab",
  description: "Hermes searches YouTube, curates with AI and shows a preview. Nothing is saved until you say so.",
  field: {
    label: "What do you want a tab about?",
    placeholder: "e.g. AI agents, sourdough bread, Roman history",
    hint: "A few words are enough. Hermes plans the searches.",
    too_short: "Type at least 2 characters.",
    invalid: "Hermes couldn't use this text. Try other words."
  },
  examples: {
    label: "Try one",
    ex1: "AI agents",
    ex2: "Sourdough bread",
    ex3: "Roman history",
    ex4: "Espresso at home",
    ex5: "Learning Rust"
  },
  options: {
    label: "Options",
    language: "Videos in",
    lang_any: "Any language",
    lang_pt: "Portuguese",
    lang_en: "English",
    classics: "Include classics",
    classics_hint: "older, well-known videos too"
  },
  hints: {
    lang_pt: "(videos in Portuguese)",
    lang_en: "(videos in English)",
    classics: "(include classics: older, well-known videos)"
  },
  steps: {
    label: "Progress",
    expand: "Expanding the topic",
    search: "Searching YouTube",
    curate: "Curating with AI",
    preview: "Building the preview",
    expand_running: "reading the topic…",
    searches_one: "{count} search",
    searches_other: "{count} searches",
    search_running_one: "{count} search on YouTube…",
    search_running_other: "{count} searches on YouTube…",
    found_one: "{count} video",
    found_other: "{count} videos",
    rating_one: "rating {count} video…",
    rating_other: "rating {count} videos…",
    rated_progress: "{done} of {total} rated",
    rated_one: "{count} rated",
    rated_other: "{count} rated",
    kept_one: "{count} kept",
    kept_other: "{count} kept",
    channels_one: "{count} channel",
    channels_other: "{count} channels"
  },
  progress: {
    lead: "This usually takes 1–3 minutes: Hermes is reading the candidates one by one.",
    background: "Closing this window doesn't stop it: the tab keeps building and Subscriptions tells you when it's ready.",
    elapsed: "Elapsed time {time}",
    coming: "Preview",
    coming_desc: "The videos Hermes keeps show up here.",
    cancel_failed: "Couldn't cancel; the search will finish on its own. Nothing is saved until you confirm."
  },
  preview: {
    name_label: "Tab name",
    name_empty: "Give the tab a name.",
    name_long: "Up to {max} characters.",
    about: "About “{query}”",
    videos: "Videos",
    videos_desc: "Drop what doesn't fit with 👎 (or D on a focused video). Hermes learns from it.",
    grid_label: "Preview videos",
    down: "Not for me",
    reason_search: "found by search",
    reason_classics: "classic",
    reason_rss: "from a seed channel",
    seeds: "Seed channels",
    seeds_desc: "Channels with 3 or more kept videos. Following them keeps this tab fresh.",
    seeds_empty: "No channel showed up 3 or more times, so the tab will rely on search.",
    seed_kept_one: "{count} kept video",
    seed_kept_other: "{count} kept videos",
    seed_choice: "What to do with {name}",
    follow: "Follow",
    ignore: "Ignore",
    follow_all: "Follow all",
    ignore_all: "Ignore all",
    in_list: "Already in your list",
    folder: "Also create the folder “{name}”",
    folder_plain: "Also create a folder",
    partial_title: "Partial preview",
    partial: "Time ran out before Hermes rated everything. You can save what is here or try again.",
    saved_title: "This topic is already a tab",
    saved: "Open it in Subscriptions, or start a new topic.",
    all_removed_title: "You dropped every video",
    all_removed: "Bring them back, or rephrase the topic."
  },
  footer: {
    not_now: "Not now",
    start: "Build preview",
    cancel: "Cancel",
    background: "Continue in background",
    discard: "Discard",
    save: "Save tab",
    save_folder: "Save tab and folder",
    open_home: "Open in Subscriptions",
    rephrase: "Rephrase",
    new_theme: "New topic",
    save_shortcut: "⌘Enter saves"
  },
  empty: {
    title: "Nothing found for “{query}”",
    desc: "Try fewer or broader words, or a related topic.",
    restore: "Bring them back"
  },
  ai: {
    no_model_title: "No AI model is available",
    no_model_desc: "Topic tabs need an AI model to plan the searches and curate. Pick one and sign in under Settings → Models first.",
    open_settings: "Open Settings",
    provider_unavailable_title: "Hermes couldn't reach your AI model",
    provider_unavailable_action: "Open model settings"
  },
  no_model: {
    title: "Pick an AI model first",
    desc: "Topic tabs need a model to plan the searches and curate. Pick one and sign in under Settings → Models.",
    action: "Open Settings"
  },
  provider_unavailable: {
    title: "Hermes couldn't reach your AI model",
    action: "Open model settings",
    retry: "Try again"
  },
  busy: {
    title: "A topic tab is already being built",
    desc: "Hermes builds one topic tab at a time. Follow it, or try again when it finishes.",
    follow: "Follow it",
    retry: "Try again"
  },
  error: {
    title: "Couldn't build the preview",
    load_title: "Couldn't open this preview",
    expired_title: "That search is gone",
    expired: "Previews are kept for 7 days. Start a new one.",
    save_title: "Couldn't save",
    conflict: "This topic was already saved as a tab."
  },
  toast: {
    saved: "Tab “{name}” created",
    undo: "Undo",
    undone: "Tab “{name}” removed",
    reopen: "Reopen preview",
    undo_failed: "Couldn't undo: {error}",
    removed: "Dropped “{title}”",
    down_failed: "Couldn't drop it: {error}"
  }
};

// desktop-src/locales/en/watch.json
var watch_default = {
  tab: {
    title: "Watching"
  },
  label: "Watching: {title}",
  player: {
    label: "Hermes player",
    note: "Some channels only allow playing on YouTube. If the player says so, use Open on YouTube.",
    larger: "Larger player",
    larger_hint: "Scale the player up (less sharp). The app gives it up to 640 × 360.",
    larger_off_hint: "Back to the player at its own size (sharper)"
  },
  tip: {
    always_allow: 'Tip: click the ▾ next to "Load YouTube" and pick "Always allow YouTube". From then on videos open straight in the player.',
    dismiss: "Got it"
  },
  meta: {
    published: "Published {date}",
    views: "{count} views",
    duration: "Duration {duration}"
  },
  description: {
    label: "Description",
    more: "Show more",
    less: "Show less"
  },
  actions: {
    label: "Video actions",
    mark_watched: "Mark as watched",
    watched: "Watched",
    open: "Open on YouTube"
  },
  next: {
    title: "Up next",
    from: "Up next · {source}",
    label: "Queue: up next in this list",
    list: "Queue",
    previous: "Previous",
    next: "Next",
    position: "{index} of {total}",
    end: "That's the end of the queue.",
    keys: "N / P to move · the next video doesn't start by itself",
    edit_keys: "Drag by the handle or use Alt+↑ / Alt+↓ to reorder · Delete removes from the queue",
    now_playing: "Now playing",
    remove: "Remove from queue",
    play_next: "Play next",
    drag: "Drag to reorder",
    removed: "Removed from the queue: {title}",
    restored: "Back in the queue: {title}",
    moved: "{title}: position {index} of {total}",
    queued_next: "{title} plays next",
    empty: "The queue is empty.",
    empty_hint: "The video stays here. Open another one from Subscriptions to start a new queue."
  },
  state: {
    loading: "Loading the video details…",
    unknown_title: "Not in your library",
    unknown_desc: "We don't have the details of this video. It can still play here, or you can open it on YouTube.",
    error: "Couldn't load the details: {error}",
    retry: "Try again",
    empty_title: "Nothing playing",
    empty_desc: "Click a video in Subscriptions to watch it here.",
    empty_action: "Go to Subscriptions"
  },
  open_mode: {
    label: "Open videos",
    hermes: "In Hermes",
    youtube: "On YouTube",
    hermes_hint: "Videos play here in HermesTube, with the Hermes player",
    youtube_hint: "Videos open on YouTube, in your browser"
  },
  toast: {
    watched: "Marked as watched",
    unwatched: "Marked as not watched",
    later: "Saved to Watch later",
    unlater: "Removed from Watch later",
    archived: "Archived",
    unarchived: "Back in the list",
    up: "Liked",
    down: "Marked as not for me",
    reaction_cleared: "Reaction removed",
    undo: "Undo",
    failed: "Couldn't save that: {error}",
    undo_failed: "Couldn't undo: {error}"
  }
};

// desktop-src/locales/pt-BR/chat.json
var chat_default2 = {
  card: {
    label: "Vídeo: {title}",
    loading: "Carregando os detalhes do vídeo",
    unknown_title: "Ver no YouTube",
    unknown_note: "Ainda não está na sua biblioteca",
    error: "Não deu para carregar os detalhes",
    retry: "Tentar de novo"
  },
  actions: {
    label: "Ações do vídeo",
    later: "Depois",
    watched: "Visto",
    open: "Abrir no YouTube"
  },
  toast: {
    later: "Guardado para depois",
    unlater: "Tirado de Depois",
    watched: "Marcado como visto",
    unwatched: "Marcado como não visto",
    undo: "Desfazer",
    failed: "Não deu para salvar: {error}",
    undo_failed: "Não deu para desfazer: {error}"
  },
  mascot: {
    published: "⭐ {channel}: {title}",
    published_untitled: "⭐ {channel} acabou de postar um vídeo",
    more: "⭐ Mais {count} favoritos postaram vídeos novos",
    setting: {
      title: "Mascote avisa dos favoritos",
      description: "Um recado curto do mascote quando um canal ⭐ posta, no máximo uma vez por canal por dia."
    }
  }
};

// desktop-src/locales/pt-BR/chrome.json
var chrome_default2 = {
  locale: "pt-BR",
  chip: {
    new_one: "novo",
    new_other: "novos",
    none: "Nada novo",
    refreshing: "atualizando…",
    loading: "Inscrições",
    unavailable_label: "Inscrições indisponíveis",
    title_new: "{count} vídeos novos — abrir suas inscrições",
    title_none: "Você está em dia — abrir suas inscrições",
    title_refreshing: "Procurando vídeos novos… — abrir suas inscrições",
    title_loading: "Lendo suas inscrições…",
    reason_unavailable: "O HermesTube não está ligado no perfil “{profile}”. Volte ao perfil onde instalou, ou ligue em Capabilities → Plugins.",
    reason_offline: "Sem conexão com o Hermes agora. Ele tenta de novo sozinho.",
    reason_error: "Não deu para ler os vídeos novos: {error}",
    updated: "atualizado {when}",
    pet: "O Hermes diz: {text}"
  },
  palette: {
    "open-home": {
      label: "Inscrições: abrir",
      keywords: "youtube inscrições início feed vídeos novos"
    },
    "refresh-now": {
      label: "Inscrições: atualizar agora",
      keywords: "youtube inscrições atualizar buscar rss recarregar"
    },
    "new-theme-tab": {
      label: "Inscrições: nova aba por assunto",
      keywords: "youtube inscrições tema aba assunto nova criar"
    },
    organize: {
      label: "Inscrições: organizar com o Hermes",
      keywords: "youtube inscrições organizar pastas ordenar ia"
    },
    cleanup: {
      label: "Inscrições: faxina",
      keywords: "youtube inscrições faxina cancelar limpar inativos"
    },
    "open-extras": {
      label: "Inscrições: extras",
      keywords: "youtube inscrições extras hackertube hn miniaturas listas"
    },
    connect: {
      label: "HermesTube: Conectar um navegador ou adicionar um canal",
      keywords: "youtube inscrições extensão navegador conectar parear código canal adicionar link boas-vindas configurar"
    }
  },
  refresh: {
    started: "Procurando vídeos novos…",
    running: "Já estou procurando vídeos novos",
    skipped: "Suas inscrições já estão em dia",
    failed: "Não deu para atualizar: {error}"
  },
  detail: {
    refreshing: "atualizando…",
    new_one: "{count} novo",
    new_other: "{count} novos",
    none: "nada novo",
    updated: "atualizado {when}"
  },
  gate: {
    title: "O plugin não está ligado em “{profile}”",
    hint: "Você está no perfil “{profile}”. Volte ao perfil onde instalou o plugin, ou ligue aqui: Capabilities → Plugins → HermesTube.",
    remote: "Você está conectado a {name}, não a este computador. Troque para {local} para usar o HermesTube com o Hermes deste computador.",
    local_default: "This device"
  }
};

// desktop-src/locales/pt-BR/cleanup.json
var cleanup_default2 = {
  title: "Faxina",
  subtitle: {
    last_scan: "Última varredura {when}",
    by_model: "motivos por {model}",
    by_rule: "motivos por regra",
    never: "Ainda não varrida",
    scanning: "Procurando nas suas inscrições…",
    error: "Não deu para ler a última varredura"
  },
  actions: {
    scan: "Procurar de novo",
    scan_first: "Procurar agora",
    home: "Ir para Inscrições",
    connect: "Conectar a extensão"
  },
  groups: {
    label: "Canais: {group}",
    loading: "Carregando a faxina",
    select_all: "Selecionar os {count}",
    clear: "Desmarcar",
    stale: {
      title: "Parados",
      rule: "Sem vídeo novo há 180 dias ou mais."
    },
    ignored: {
      title: "Você não assiste",
      rule: "8 ou mais vídeos nos últimos 90 dias e nenhum assistido.",
      needs_history: "Precisa do histórico da extensão do navegador para achar estes."
    },
    off_profile: {
      title: "Fora do seu perfil",
      rule: "Longe das pastas e favoritos que você mais usa, segundo o Hermes."
    },
    manual: {
      title: "Marcados por você",
      rule: "Você marcou estes para cancelar em Gerenciar."
    }
  },
  row: {
    select: "Selecionar {name}",
    keep: "Manter",
    keep_label: "Manter {name}",
    last_video: "último vídeo {when}",
    no_videos: "nenhum vídeo conhecido",
    watched: "{count} assistidos em 90 dias",
    per_week: "{count} por semana"
  },
  selection: {
    label: "Seleção",
    none: "Escolha canais ou um grupo inteiro. Nada é cancelado até você confirmar.",
    count_one: "{count} canal selecionado",
    count_other: "{count} canais selecionados",
    clear: "Limpar",
    review_none: "Revisar cancelamento",
    review_one: "Revisar cancelamento ({count})",
    review_other: "Revisar cancelamento ({count})"
  },
  approve: {
    title_one: "Cancelar {count} inscrição?",
    title_other: "Cancelar {count} inscrições?",
    description: "Nada acontece até você confirmar aqui.",
    effect_one: "A extensão vai cancelar {count} inscrição no YouTube, no seu navegador.",
    effect_other: "A extensão vai cancelar {count} inscrições no YouTube, no seu navegador, uma por vez.",
    effect_resubscribe: "Dá para reinscrever por {days} dias em Ex-inscrições.",
    effect_undo: "Enquanto não executar, dá para desfazer na fila.",
    effect_offline: "A extensão está desconectada: fica na fila até o navegador abrir.",
    confirm_one: "Cancelar {count} inscrição",
    confirm_other: "Cancelar {count} inscrições",
    more: "+{count}",
    refused: "Aprovação recusada: só um clique aqui, no Hermes Desktop, aprova um cancelamento.",
    failed: "Não deu para pôr na fila: {error}",
    show_all: "Ver todos os {count}",
    show_less: "Ver menos",
    list_label: "Canais a cancelar"
  },
  resub: {
    title: "Reinscrever em {name}?",
    description: "Passa pela mesma fila dos cancelamentos.",
    effect: "A extensão vai se inscrever de novo em {name} no YouTube, no seu navegador.",
    effect_undo: "Enquanto não executar, dá para desfazer na fila.",
    confirm: "Reinscrever em {name}"
  },
  queue: {
    title: "Fila",
    description: "A extensão executa um por vez, com uma pausa curta entre eles.",
    label: "Fila de cancelamento",
    unknown_channel: "Canal {id}",
    undo: "Desfazer",
    undo_label: "Desfazer {name}",
    undo_all_one: "Desfazer {count} pendente",
    undo_all_other: "Desfazer {count} pendentes",
    action: {
      unsubscribe: "cancelar inscrição",
      resubscribe: "reinscrever"
    },
    status: {
      approved: "aprovado · esperando a extensão",
      approved_offline: "aprovado · espera o navegador abrir",
      running: "em andamento no seu navegador",
      done: "feito {when}",
      failed: "falhou: {reason}",
      failed_unknown: "falhou (a extensão não disse o motivo)"
    },
    note: {
      not_subscribed: "Já não havia inscrição no YouTube; nada foi clicado.",
      already_subscribed: "A inscrição no YouTube já existia; nada foi clicado."
    }
  },
  ex: {
    title: "Ex-inscrições",
    description: "Canceladas pela fila. Dá para reinscrever por {days} dias.",
    label: "Ex-inscrições",
    cancelled: "cancelada {when}",
    until: "reinscrever até {date}",
    resubscribe: "Reinscrever",
    resubscribe_label: "Reinscrever em {name}",
    queued: "Na fila",
    empty: "Nenhuma ex-inscrição. Os canais que você cancelar aqui ficam {days} dias, prontos para voltar.",
    error: "Não deu para carregar as ex-inscrições"
  },
  banner: {
    scanning: "Procurando nas suas inscrições…",
    scanning_progress: "Procurando nas suas inscrições… {done} de {total}",
    scan_failed: "A varredura não terminou: {error}",
    server_down: "Sem contato com o servidor do plugin — a fila espera até ele voltar.",
    ext_endpoint_down: "O servidor local da extensão está parado — a fila espera o Hermes ligá-lo de novo.",
    ext_disconnected: "Extensão desconectada — as aprovações ficam na fila até o navegador abrir.",
    no_model: "Sem modelo de IA: os motivos vêm das regras e o grupo Fora do seu perfil fica desligado. Escolha um modelo e entre na conta em Ajustes → Modelos.",
    provider_unavailable: "O Hermes não conseguiu acessar seu modelo de IA ({route}): os motivos vêm das regras e o grupo Fora do seu perfil fica desligado. Entre na conta de novo ou escolha outro modelo para “YouTube curator” em Settings → Model → Auxiliary models.",
    provider_unavailable_plain: "O Hermes não conseguiu acessar seu modelo de IA: os motivos vêm das regras e o grupo Fora do seu perfil fica desligado. Entre na conta de novo ou escolha outro modelo para “YouTube curator” em Settings → Model → Auxiliary models.",
    provider_unavailable_action: "Abrir ajustes do modelo",
    retry: "Tentar de novo",
    connect: "Conectar",
    ext_not_paired: "Conecte a extensão do navegador para trazer suas inscrições",
    reconnect: "Reconectar"
  },
  empty: {
    never_title: "Vamos arrumar suas inscrições",
    never_desc: "O Hermes procura três tipos de canal. Nada é cancelado sem o seu clique.",
    clean_title: "Lista em dia",
    clean_desc: "Nenhum canal parado, ignorado ou fora do perfil na última varredura ({when}).",
    criteria: {
      label: "O que a varredura procura",
      stale: "Parados: sem vídeo novo há 180 dias",
      ignored: "Você não assiste: nenhum vídeo visto em 90 dias",
      off_profile: "Fora do seu perfil: longe das suas pastas e favoritos"
    }
  },
  toast: {
    queued_one: "{count} inscrição na fila para cancelar",
    queued_other: "{count} inscrições na fila para cancelar",
    resub_queued: "{name} na fila para reinscrever",
    undo: "Desfazer",
    undone_one: "Aprovação desfeita",
    undone_other: "{count} aprovações desfeitas",
    undo_failed: "Não deu para desfazer: {error}",
    kept: "{name} fica — saiu das sugestões",
    keep_failed: "Não deu para tirar a sugestão: {error}",
    scan_done: "Varredura concluída",
    scan_unavailable: "A varredura precisa da IA do Hermes pelo backend do Desktop."
  }
};

// desktop-src/locales/pt-BR/common.json
var common_default2 = {
  plugin_name: "HermesTube",
  loading: "Carregando…",
  empty: "Nada por aqui ainda",
  retry: "Tentar de novo",
  close: "Fechar",
  error_title: "Algo deu errado",
  open_desktop_backend: "Isto precisa da IA do Hermes. Abra pelo app Hermes Desktop com o backend local (ou use /tube no chat).",
  reconnect_open_hermes: "Abra o Hermes para reconectar a extensão do navegador.",
  already_executed: "Já executado — use Reinscrever em Faxina → Ex-inscrições.",
  no_model: "Nenhum modelo de IA disponível. Escolha um e entre na conta em Ajustes → Modelos.",
  provider_unavailable: "O Hermes não conseguiu acessar seu modelo de IA ({route}). Entre na conta de novo ou escolha outro modelo para “YouTube curator” em Settings → Model → Auxiliary models.",
  provider_unavailable_plain: "O Hermes não conseguiu acessar seu modelo de IA. Entre na conta de novo ou escolha outro modelo para “YouTube curator” em Settings → Model → Auxiliary models.",
  nav: {
    home: "Inscrições",
    manage: "Gerenciar inscrições",
    cleanup: "Faxina",
    extras: "Extras"
  },
  routes: {
    home: "Inscrições",
    manage: "Gerenciar",
    cleanup: "Faxina",
    extras: "Extras",
    watch: "Assistindo"
  },
  pane: {
    title: "Inscrições",
    open_page: "Abrir o HermesTube",
    open_page_short: "Abrir",
    open_page_tip: "Abrir o HermesTube no centro"
  },
  chip: {
    new: "▶ {count} novos",
    title: "Abrir Inscrições",
    refreshing: "atualizando…"
  },
  palette: {
    "open-home": "Inscrições: abrir",
    organize: "Inscrições: organizar com o Hermes",
    cleanup: "Inscrições: faxina",
    "new-theme-tab": "Inscrições: nova aba por assunto",
    "refresh-now": "Inscrições: atualizar agora",
    "open-extras": "Inscrições: extras"
  },
  refresh: {
    started: "Atualizando as inscrições…",
    running: "Já existe uma atualização em andamento",
    skipped: "As inscrições já estão em dia"
  },
  dialogs: {
    onboarding: "Boas-vindas",
    "tab-editor": "Aba",
    organize: "Organizar com o Hermes",
    theme: "Nova aba por assunto",
    "list-import": "Importar uma lista",
    history: "Histórico",
    "create-tab": "Criar aba com a seleção"
  },
  placeholder: {
    title: "Em breve",
    description: "Esta tela ainda está sendo construída."
  },
  video: {
    new: "Novo",
    open: "Abrir no YouTube",
    short: "Short",
    live: "Ao vivo",
    premiere: "Estreia",
    kind: {
      video: "Vídeo"
    },
    duration: {
      h: "{count} h",
      m: "{count} min",
      s: "{count} s"
    },
    views: "{count} visualizações",
    why: {
      folder: "Pasta",
      tag: "Tag",
      channel: "Canal",
      theme: "Assunto",
      hn: "Hacker News",
      list: "Lista"
    },
    badge: {
      hn: "HN recomenda"
    }
  },
  errors: {
    not_found: "Não encontrado.",
    conflict: "Isso conflita com algo que já existe.",
    invalid: "Alguma informação está inválida.",
    unauthorized: "Não autorizado.",
    undo_refused: "Esta mudança não pode ser desfeita.",
    approval_refused: "Esta aprovação foi recusada.",
    timeout: "Demorou demais. Tente de novo.",
    busy: "O Hermes está ocupado com outra tarefa. Tente daqui a pouco.",
    llm_unavailable: "Nenhum modelo de IA disponível. Escolha um e entre na conta em Ajustes → Modelos.",
    llm_invalid: "A IA respondeu num formato inesperado. Tente de novo.",
    youtube_error: "O YouTube não respondeu como esperado.",
    http_error: "Uma requisição de rede falhou.",
    origin_forbidden: "Esta origem não é permitida.",
    origin_required: "A requisição veio sem origem.",
    origin_mismatch: "A requisição veio de outra origem.",
    host_forbidden: "Este host não é permitido.",
    plugin_disabled: "O plugin está desligado neste perfil. Ligue em Capabilities → Plugins.",
    no_active_code: "Não há código de pareamento ativo.",
    invalid_code: "Código de pareamento errado.",
    expired: "O código de pareamento expirou.",
    used: "O código de pareamento já foi usado.",
    locked: "Tentativas demais. Gere um código novo.",
    ext_endpoint_down: "O endereço da extensão está fora do ar. Abra o Hermes para reconectar.",
    internal: "Erro inesperado."
  },
  kit: {
    shortcut_label: "{label} ({key})",
    actions: {
      label: "Ações rápidas",
      watched: "Visto",
      later: "Depois",
      archive: "Arquivar",
      up: "Gostei",
      down: "Não curti",
      open: "Abrir",
      watched_do: "Marcar como visto",
      watched_undo: "Desfazer visto",
      later_do: "Guardar em Ver depois",
      later_undo: "Tirar de Ver depois",
      archive_do: "Arquivar",
      archive_undo: "Desarquivar",
      up_do: "Gostei",
      up_undo: "Tirar o gostei",
      down_do: "Não curti",
      down_undo: "Desfazer não curti"
    },
    density: {
      label: "Densidade",
      comfortable: "Confortável",
      compact: "Compacta",
      list: "Lista"
    },
    tabs: {
      label: "Abas",
      add: "Nova aba",
      new_count: "{count} novos",
      menu: "Opções da aba {name}"
    },
    filter: {
      search: "Buscar",
      clear: "Limpar filtros",
      results: "{count} resultados"
    },
    thumb: {
      watched: "Visto",
      new: "Novo",
      progress: "Assistido {percent}%",
      unavailable: "Miniatura indisponível"
    },
    why: {
      label: "Por que está aqui"
    },
    channel: {
      favorite: "Favorito",
      no_folder: "Sem pasta",
      no_videos: "Sem vídeos ainda",
      select: "Selecionar {name}",
      columns: {
        channel: "Canal",
        folder: "Pasta",
        tags: "Tags",
        new: "Novos",
        last: "Último vídeo",
        actions: "Ações"
      }
    },
    tree: {
      expand: "Expandir",
      collapse: "Recolher",
      drop: "Solte aqui para mover",
      new_count: "{count} novos"
    },
    steps: {
      waiting: "Esperando",
      running: "Em andamento",
      done: "Feito",
      failed: "Falhou"
    },
    suggest: {
      accept: "Aceitar",
      reject: "Recusar",
      accept_all: "Aceitar grupo",
      reject_all: "Recusar grupo",
      by_model: "por {model}",
      confidence: "{percent}% de certeza",
      accepted: "Aceita",
      rejected: "Recusada",
      count: "{count} sugestões",
      count_one: "{count} sugestão"
    },
    approval: {
      what: "O que vai acontecer",
      cancel: "Cancelar",
      not_now: "Agora não"
    },
    pairing: {
      label: "Código de pareamento",
      expires: "Expira em {time}",
      expired: "O código expirou",
      regenerate: "Gerar outro",
      copy: "Copiar código",
      steps_label: "Como parear",
      step_open: "Abra a extensão",
      step_open_hint: "Clique no ícone dela na barra do navegador.",
      step_code: "Digite este código",
      step_done: "Pronto",
      waiting: "Aguardando a extensão…",
      paired: "Conectada. Trazendo suas inscrições.",
      done_hint: "Suas inscrições aparecem aqui assim que ela conectar."
    },
    banner: {
      dismiss: "Dispensar"
    },
    chip: {
      remove: "Remover {name}"
    },
    path: {
      recommended: "Recomendado"
    },
    welcome: {
      title: "Boas-vindas",
      tagline: "Suas inscrições. Do seu jeito."
    },
    dialog: {
      more_above: "Há mais acima",
      more_below: "Há mais abaixo"
    }
  },
  sections: {
    label: "Seções do HermesTube",
    menu: "Seção: {section}",
    back: "Voltar",
    close_video: "Fechar vídeo"
  },
  playlists: {
    add: "Adicionar à playlist",
    count: "{count} vídeos",
    count_one: "1 vídeo",
    saved: "Salvo em {name}",
    removed: "Removido de {name}",
    failed: "Não deu para salvar a playlist: {error}",
    picker: {
      title: "Adicionar à playlist",
      description: "Suas playlists ficam no HermesTube, neste computador. Nada muda no YouTube.",
      loading: "Carregando suas playlists…",
      empty: "Nenhuma playlist ainda. Crie a primeira aqui embaixo.",
      new: "Nova playlist…",
      name_label: "Nome da playlist",
      name_placeholder: "ex.: Física",
      create: "Criar",
      cancel: "Cancelar",
      done: "Pronto"
    }
  }
};

// desktop-src/locales/pt-BR/extras.json
var extras_default2 = {};

// desktop-src/locales/pt-BR/history.json
var history_default2 = {};

// desktop-src/locales/pt-BR/home.json
var home_default2 = {
  title: "Inscrições",
  subtitle: {
    new: "{count} novos",
    updated: "atualizado {when}",
    never: "ainda não atualizado",
    refreshing: "atualizando…",
    status_error: "Não deu para ler o estado mais recente"
  },
  actions: {
    extras: "Extras",
    refresh: "Atualizar",
    new_tab: "Nova aba",
    mark_read: "Marcar como lido"
  },
  new_tab: {
    category: "Categoria",
    category_desc: "Pastas e tags que você já usa",
    channels: "Canais",
    channels_desc: "Escolha os canais a dedo",
    theme: "Assunto",
    theme_desc: "O Hermes pesquisa um assunto no YouTube",
    mixed: "Mista",
    mixed_desc: "Combine pastas, tags, canais e assuntos"
  },
  theme_build: {
    button: "Nova aba por assunto",
    button_tip: "O Hermes pesquisa no YouTube e monta uma aba sobre qualquer assunto",
    no_ai: "As abas por assunto precisam de um modelo para planejar as buscas e fazer a curadoria. Escolha um em Ajustes → Modelos antes.",
    building: "Montando “{name}”…",
    building_unnamed: "Montando uma aba por assunto…",
    building_tip: "O Hermes ainda está trabalhando nele. Clique para ver o andamento.",
    ready: "A aba “{name}” está pronta",
    ready_unnamed: "Sua aba por assunto está pronta",
    open_preview: "Abrir prévia",
    failed: "Não deu para montar “{name}”: {error}",
    failed_unnamed: "Não deu para montar a aba: {error}",
    retry: "Tentar de novo"
  },
  tabs: {
    label: "Abas do feed",
    "all-new": "Tudo novo",
    favorites: "Favoritos",
    later: "Ver depois",
    playlists: "Playlists"
  },
  filters: {
    search: "Buscar nesta aba",
    new_only: "Só novos",
    no_shorts: "Sem Shorts",
    show_seen: "Mostrar vistos"
  },
  sections: {
    featured: "Em destaque"
  },
  feed: {
    label: "Vídeos de {tab}",
    count: "{count} vídeos",
    loading: "Carregando vídeos",
    loading_more: "Carregando mais vídeos",
    searching: "Buscando…",
    load_more: "Carregar mais",
    more_error: "Não deu para carregar mais vídeos",
    reordering: "Reordenando…",
    group_label: "Vídeos de {tab} — {group}"
  },
  toast: {
    watched: "Marcado como visto",
    unwatched: "Marcado como não visto",
    later: "Guardado em Ver depois",
    unlater: "Tirado de Ver depois",
    archived: "Arquivado",
    up: "Curtido",
    down: "Marcado como não é pra mim",
    reaction_cleared: "Reação removida",
    undo: "Desfazer",
    failed: "Não deu para salvar: {error}",
    undo_failed: "Não deu para desfazer: {error}",
    read: "{tab} marcada como lida",
    read_nothing: "Nada novo para marcar como lido",
    refresh_skipped: "Já está tudo atualizado",
    refresh_failed: "Não deu para começar a atualização: {error}",
    unarchived: "De volta à lista",
    tab_deleted: "Aba “{name}” excluída",
    reorder_failed: "Não deu para salvar a ordem das abas: {error}"
  },
  banner: {
    demo_arriving: "Carregando a demonstração: {count} vídeos de {channels} canais até agora…",
    channel_arriving: "Buscando os vídeos mais recentes de {title}…",
    rss_down: "O feed do YouTube está instável desde {time}. Seus vídeos continuam chegando por outro caminho.",
    rss_down_stale: "O feed do YouTube está instável desde {time}. Mostrando o que já chegou.",
    rss_fallback: "{count} canais atualizados pela página do canal",
    retry: "Tentar de novo",
    ext_disconnected: "Extensão do navegador desconectada — inscrições novas e histórico não sincronizam.",
    reconnect: "Reconectar",
    ext_not_paired: "Conecte a extensão do navegador para trazer suas inscrições",
    connect: "Conectar"
  },
  empty: {
    tab_title: "Tudo em dia",
    tab_desc: "Nada novo em {tab}. Os vídeos novos aparecem aqui assim que os canais publicarem.",
    refreshing_title: "Procurando vídeos novos…",
    see_all: "Ver todas as abas",
    show_seen: "Mostrar vistos",
    search_title: "Nada encontrado para «{query}»",
    search_desc: "A busca olha o título e o nome do canal de todos os vídeos desta aba.",
    search_loaded_desc: "Nenhum dos vídeos carregados combina com «{query}».",
    filter_title: "Nenhum resultado",
    filter_desc: "Nenhum vídeo carregado passa por esses filtros.",
    clear: "Limpar busca e filtros",
    clear_search: "Limpar busca",
    clear_filters: "Limpar filtros",
    later_title: "Nada guardado para depois",
    later_desc: "Aperte L em qualquer vídeo (ou o botão do relógio) para guardar aqui."
  },
  welcome: {
    lead: "Escolha um caminho para começar. Dá para somar os outros depois.",
    group: "Como começar",
    pair_title: "Conectar a extensão do navegador",
    pair_desc: "Traz todas as suas inscrições e o histórico do navegador — sem senha, nada sai da sua máquina.",
    pair_action: "Parear agora",
    pair_hint: "Cerca de 1 min",
    link_title: "Colar um canal",
    link_desc: "Cole o link de um canal ou um @handle para seguir aqui sem se inscrever no YouTube.",
    link_action: "Colar link",
    demo_title: "Experimentar a demonstração",
    demo_desc: "40 canais públicos reais em 6 pastas, para explorar antes de conectar qualquer coisa.",
    demo_action: "Carregar demo",
    demo_hint: "Dá para remover quando quiser",
    demo_loading: "Carregando…",
    demo_failed: "Não deu para carregar a demonstração: {error}",
    link_label: "Link do canal ou @handle",
    link_placeholder: "youtube.com/@canal ou @handle",
    link_hint: "Link do canal ou de um vídeo, @handle ou id do canal (UC…). Enter para seguir.",
    link_submit: "Seguir",
    link_added: "Agora você segue {title}",
    errors: {
      empty: "Cole primeiro o link de um canal ou um @handle.",
      invalid: "Isso não parece um link de canal do YouTube nem um @handle.",
      conflict: "{title} já está na sua lista.",
      conflict_generic: "Esse canal já está na sua lista.",
      youtube_error: "O YouTube não achou esse canal. Confira o link e tente de novo.",
      timeout: "O YouTube demorou demais para responder. Tente de novo daqui a pouco."
    }
  },
  pane_filter: {
    label: "Filtrando por: {name}",
    clear: "Parar de filtrar",
    create_tab: "Criar aba com isto"
  },
  gone: {
    archived: "Arquivado",
    undo: "Desfazer"
  },
  tab_menu: {
    edit: "Editar…",
    move_left: "Mover para a esquerda",
    move_right: "Mover para a direita",
    delete: "Excluir…",
    delete_title: "Excluir a aba “{name}”?",
    delete_desc: "Os canais, pastas e vídeos continuam como estão — só a aba sai.",
    delete_confirm: "Excluir aba",
    delete_cancel: "Agora não",
    delete_failed: "Não deu para excluir a aba: {error}"
  },
  view: {
    label: "Exibir",
    menu_label: "Exibir: {sort}, {group}",
    sort_title: "Ordenar",
    group_title: "Agrupar",
    sort_label: "Ordenar: {value}",
    group_label: "Agrupar: {value}",
    sort: {
      newest: "Mais novos",
      oldest: "Mais antigos",
      longest: "Mais longos",
      shortest: "Mais curtos",
      views: "Mais vistos"
    },
    group: {
      none: "Nenhum",
      channel: "Canal",
      folder: "Pasta",
      day: "Dia",
      kind: "Tipo"
    },
    group_trigger: {
      none: "Sem grupos",
      channel: "Por canal",
      folder: "Por pasta",
      day: "Por dia",
      kind: "Por tipo"
    }
  },
  group: {
    today: "Hoje",
    yesterday: "Ontem",
    no_date: "Sem data",
    no_folder: "Sem pasta",
    no_channel: "Canal desconhecido",
    kind: {
      video: "Vídeos",
      short: "Shorts",
      unknown: "Tipo ainda desconhecido"
    },
    count_more: "{count}+",
    count_hint: "{count} carregados até agora"
  },
  playlists: {
    label: "Suas playlists",
    count: "{count} vídeos",
    count_one: "1 vídeo",
    open: "Abrir {name}",
    empty_title: "Nenhuma playlist ainda",
    empty_desc: "Use Adicionar à playlist em qualquer vídeo para começar uma.",
    empty_action: "Ver todas as abas",
    back: "Todas as playlists",
    play_all: "Tocar tudo",
    rename: "Renomear",
    rename_label: "Novo nome",
    rename_save: "Salvar",
    rename_cancel: "Cancelar",
    delete: "Apagar",
    delete_title: "Apagar “{name}”?",
    delete_desc: "Só a playlist some. Os vídeos continuam nas suas inscrições e em qualquer outra playlist.",
    delete_confirm: "Apagar playlist",
    delete_cancel: "Manter",
    deleted: "{name} apagada",
    renamed: "Renomeada para {name}",
    failed: "Não deu para mudar a playlist: {error}",
    remove: "Tirar da playlist",
    removed: "Removido de {name}",
    items_label: "Vídeos em {name}",
    playlist_empty_title: "Esta playlist está vazia",
    playlist_empty_desc: "Use Adicionar à playlist em qualquer vídeo para colocá-lo aqui.",
    local_note: "Guardada no HermesTube neste computador, não na sua conta do YouTube."
  }
};

// desktop-src/locales/pt-BR/list-import.json
var list_import_default2 = {};

// desktop-src/locales/pt-BR/manage.json
var manage_default2 = {
  title: "Gerenciar",
  subtitle: "{subscribed} inscritos · {followed} seguidos",
  count: "{shown} de {total} canais",
  table_label: "Canais",
  loading: "Carregando canais",
  select_all: "Selecionar os {count} canais filtrados",
  select_row: "Selecionar {name}",
  sort_by: "Ordenar por {name}",
  columns: {
    select: "Seleção",
    name: "Canal",
    folder: "Pasta",
    tags: "Tags",
    last: "Último vídeo",
    rhythm: "Ritmo",
    shorts: "Shorts",
    watched: "Assistidos",
    relation: "Relação"
  },
  column_hints: {
    last: "Quando saiu o vídeo mais recente",
    rhythm: "Vídeos por semana",
    shorts: "Parte de Shorts entre os vídeos recentes",
    watched: "Vídeos que você assistiu nos últimos 90 dias"
  },
  rhythm_value: "{n}/sem",
  no_folder: "Sem pasta",
  add_tags: "Pôr tags",
  edit_folder: "Trocar a pasta de {name}",
  edit_tags: "Trocar as tags de {name}",
  favorite: "Favorito",
  muted: "Silenciado",
  relation: {
    active: "Inscritos + seguidos",
    subscribed: "Inscrito",
    followed: "Seguido",
    ex: "Ex-inscrição",
    ignored: "Ignorado"
  },
  filters: {
    search: "Buscar nome ou @handle",
    folder: "Pasta",
    folder_all: "Todas as pastas",
    tag: "Tag",
    tag_all: "Qualquer tag",
    relation: "Relação",
    favorite: "Favoritos",
    muted: "Silenciados",
    stale: "Parados",
    stale_any: "Qualquer data",
    stale_option: "Sem vídeo há {count} meses"
  },
  chips: {
    folder: "Pasta: {name}",
    tag: "#{name}",
    stale: "Sem vídeo há {count}+ meses",
    remove: "Tirar o filtro: {name}"
  },
  rail: {
    label: "Pastas",
    all: "Todos os canais",
    none: "Sem pasta",
    new: "Nova pasta",
    placeholder: "Nome da pasta",
    rename: "Renomear {name}",
    drop: "Solte para mover para cá"
  },
  picker: {
    filter: "Digite para filtrar",
    create_folder: "Nova pasta “{name}”",
    create_tag: "Nova tag “{name}”",
    apply: "Aplicar",
    empty: "Nada encontrado",
    move: "Mover para a pasta",
    tag: "Pôr tag",
    untag: "Tirar tag"
  },
  batch: {
    label: "Ações da seleção",
    selected_one: "{count} selecionado",
    selected_other: "{count} selecionados",
    hidden_one: "{count} escondido pelos filtros",
    hidden_other: "{count} escondidos pelos filtros",
    move: "Mover para…",
    tag: "Pôr tag",
    untag: "Tirar tag",
    favorite: "Favoritar",
    unfavorite: "Desfavoritar",
    mute: "Silenciar",
    unmute: "Reativar",
    read: "Marcar como lido",
    organize: "Organizar com Hermes",
    clear: "Limpar seleção"
  },
  toast: {
    move_one: "{name} movido para {folder}",
    move_other: "{count} canais movidos para {folder}",
    move_none_one: "{name} tirado da pasta",
    move_none_other: "{count} canais tirados das pastas",
    tag_one: "#{tag} posta em {name}",
    tag_other: "#{tag} posta em {count} canais",
    untag_one: "#{tag} tirada de {name}",
    untag_other: "#{tag} tirada de {count} canais",
    favorite_one: "{name} nos favoritos",
    favorite_other: "{count} canais nos favoritos",
    unfavorite_one: "{name} fora dos favoritos",
    unfavorite_other: "{count} canais fora dos favoritos",
    mute_one: "{name} silenciado",
    mute_other: "{count} canais silenciados",
    unmute_one: "{name} reativado",
    unmute_other: "{count} canais reativados",
    read_one: "{name} marcado como lido",
    read_other: "{count} canais marcados como lidos",
    read_nothing: "Nada novo para marcar como lido",
    read_partial: "{count} canais não foram marcados: {error}",
    tags_set: "Tags de {name} atualizadas",
    nothing: "Nada mudou",
    folder_created: "Pasta “{name}” criada",
    folder_renamed: "Pasta renomeada para “{name}”",
    undo: "Desfazer",
    undone: "Desfeito",
    undo_failed: "Não deu para desfazer: {error}",
    failed: "Não deu para salvar: {error}"
  },
  row_error: "Não salvou: {error}",
  banner: {
    ext_disconnected: "Extensão do navegador desconectada — inscrições novas não sincronizam.",
    reconnect: "Reconectar",
    ext_not_paired: "Conecte a extensão do navegador para trazer suas inscrições",
    connect: "Conectar"
  },
  empty: {
    title: "Nenhum canal ainda",
    description: "Conecte a extensão do navegador, cole o link de um canal ou carregue a demo.",
    action: "Começar"
  },
  no_results: {
    title: "Nenhum canal com esses filtros",
    description: "Afrouxe um filtro ou limpe todos.",
    action: "Limpar filtros"
  },
  error: {
    title: "Não deu para carregar seus canais"
  },
  actions: {
    organize: "Organizar com Hermes",
    cleanup: "Faxina",
    connect: "Conectar um navegador",
    connect_hint: "Conectar um navegador ou adicionar um canal",
    connected: "Navegador conectado",
    connected_hint: "Ver navegadores conectados ou adicionar um canal"
  }
};

// desktop-src/locales/pt-BR/onboarding.json
var onboarding_default2 = {
  title: "Boas-vindas",
  hero: {
    tagline: "Suas inscrições. Do seu jeito.",
    lead: "Traga suas inscrições do YouTube para o Hermes e organize do jeito que quiser. Escolha um caminho para começar — os outros continuam aqui depois."
  },
  paths: {
    label: "Como começar",
    key_hint: "Tecle {key}",
    pair: {
      title: "Conectar a extensão do navegador",
      desc: "Traz todas as suas inscrições e o que você assiste, direto do navegador. Sem senha.",
      action: "Conectar",
      hint: "Recomendado"
    },
    link: {
      title: "Colar um canal",
      desc: "Cole o link de um canal ou um @handle para seguir aqui, sem a extensão.",
      action: "Colar link",
      hint: "Sem extensão"
    },
    demo: {
      title: "Experimentar a demonstração",
      desc: "40 canais públicos reais em 6 pastas, para explorar antes de conectar qualquer coisa.",
      action: "Carregar demonstração",
      hint: "Um clique",
      loaded_desc: "A demonstração está carregada. Limpe quando quiser — o que você adicionou fica.",
      loaded_action: "Gerenciar demonstração"
    }
  },
  back: "Todos os caminhos",
  plural: {
    channels_one: "{count} canal",
    channels_other: "{count} canais",
    folders_one: "{count} pasta",
    folders_other: "{count} pastas",
    videos_one: "{count} vídeo",
    videos_other: "{count} vídeos"
  },
  pair: {
    title: "Conectar a extensão do navegador",
    desc: "Digite este código na extensão para ligar o seu navegador ao Hermes.",
    desc_syncing: "Conectado. Lendo suas inscrições…",
    desc_done: "Conectado. Tudo pronto.",
    code_label: "Seu código",
    steps_label: "Passos para conectar",
    step_open: "Abra a extensão no Chrome e digite o código",
    step_open_detail: "Clique no ícone da extensão na barra do navegador",
    step_read: "Lendo suas inscrições",
    step_read_detail: "A extensão abre a sua página de inscrições numa aba por alguns segundos; nada é alterado na sua conta",
    step_ready: "Pronto",
    waiting: "Aguardando a extensão…",
    expired_hint: "Este código venceu. Gere outro — leva um segundo.",
    connected_title: "{name} conectado",
    connected_desc: "Isto se preenche sozinho; costuma levar alguns segundos.",
    done_title: "Suas inscrições chegaram",
    slow: "A primeira leitura pode levar alguns minutos quando você segue muitos canais. Pode fechar — os canais aparecem sozinhos.",
    close: "Fechar",
    unnamed: "Seu navegador",
    endpoint_down: "A extensão só conversa com o Hermes enquanto ele está aberto. Deixe o Hermes aberto (pode ser em segundo plano) e a extensão se reconecta sozinha.",
    install: {
      title: "Ainda não tem a extensão?",
      body: "No Chrome, abra a página Extensões, ligue o Modo do desenvolvedor e escolha “Carregar sem compactação” com a pasta da extensão. Depois fixe o ícone na barra.",
      store_url: "",
      store_link: "Baixar a extensão"
    },
    setup: {
      title: "Configurar a extensão",
      desc: "O Hermes coloca a extensão HermesTube numa pasta da sua pasta pessoal e abre a página Extensões do {browser}. Depois o navegador só precisa de dois cliques seus.",
      action: "Configurar a extensão",
      busy: "Configurando…",
      choose_browser: "Navegador",
      browser_generic: "seu navegador",
      no_browser_found: "O Hermes não encontrou Chrome, Edge, Brave, Chromium, Vivaldi nem Opera no computador onde ele roda. Ele ainda pode preparar a pasta; depois abra você mesmo a página Extensões do seu navegador.",
      update_title: "Uma versão nova da extensão está pronta",
      update_desc: "O Hermes troca os arquivos na mesma pasta (versão {version}). Depois aperte Recarregar no cartão da extensão no navegador.",
      update_action: "Atualizar a extensão",
      ready_title: "A pasta da extensão está pronta",
      reopen: "Abrir a página Extensões",
      steps_label: "Passos para instalar a extensão",
      step_folder: "O Hermes colocou a extensão numa pasta",
      step_updated: "O Hermes atualizou a extensão para a versão {version}",
      step_dev: "Ligue o “{dev}”",
      step_drag: "Arraste a pasta “HermesTube Extension” para essa página",
      step_drag_detail: "Ou clique em “{load}” e escolha a pasta — o caminho pode ser copiado acima",
      step_reload: "Aperte Recarregar no cartão do HermesTube no {browser}",
      step_reload_detail: "Na página Extensões do navegador. A extensão continua conectada ao Hermes.",
      step_code: "Digite o código abaixo na extensão",
      step_code_detail: "A extensão abre uma aba sozinha e pede o código",
      copy_path: "Copiar o caminho da pasta",
      opened: "A página Extensões do {browser} e a pasta estão abertas.",
      opened_page_only: "A página Extensões do {browser} está aberta. Use o caminho abaixo para achar a pasta.",
      not_opened_title: "O Hermes não conseguiu abrir o {browser}",
      open_yourself: "Página Extensões:",
      copy_url: "Copiar o endereço",
      other_computer: "Se o Hermes roda em outro computador, a pasta foi criada lá, não neste. A extensão só conversa com um Hermes no mesmo computador, então siga o guia de instalação no computador onde o Hermes roda.",
      problem: {
        no_browser: "O {browser} não foi encontrado no computador onde o Hermes roda.",
        no_display: "O computador onde o Hermes roda não tem tela para abrir o {browser}.",
        failed: "O {browser} não abriu no computador onde o Hermes roda.",
        unsupported: "O Hermes não consegue abrir um navegador neste sistema."
      },
      manual_title: "Ou faça à mão",
      manual_open: "No {browser}, abra",
      manual_dev: "Ligue o “{dev}”",
      manual_load: "Clique em “{load}” e escolha esta pasta:",
      manual_load_above: "Clique em “{load}” e escolha a pasta acima.",
      manual_folder_later: "O Hermes cria esta pasta quando você aperta “Configurar a extensão”.",
      manual_code: "Digite o código abaixo na aba que a extensão abre (ou clique no ícone dela na barra).",
      browsers: {
        chrome: {
          dev: "Modo do desenvolvedor",
          load: "Carregar sem compactação",
          where: "A chave fica no canto superior direito da página Extensões."
        },
        chromium: {
          dev: "Modo do desenvolvedor",
          load: "Carregar sem compactação",
          where: "A chave fica no canto superior direito da página Extensões."
        },
        edge: {
          dev: "Modo de desenvolvedor (Developer mode)",
          load: "Carregar sem pacote (Load unpacked)",
          where: "A chave fica no painel da esquerda da página Extensões (se o painel estiver escondido, abra-o pelo botão de menu no canto superior esquerdo)."
        },
        brave: {
          dev: "Modo do desenvolvedor",
          load: "Carregar sem compactação",
          where: "A chave fica no canto superior direito da página Extensões."
        },
        vivaldi: {
          dev: "Modo do desenvolvedor",
          load: "Carregar sem compactação",
          where: "A chave fica no canto superior direito da página Extensões."
        },
        opera: {
          dev: "Modo de desenvolvedor (Developer mode)",
          load: "Carregar sem compactação (Load unpacked)",
          where: "A chave fica no canto superior direito da página Extensões."
        },
        arc: {
          dev: "Modo do desenvolvedor",
          load: "Carregar sem compactação",
          where: "A chave fica no canto superior direito da página Extensões."
        },
        generic: {
          dev: "Modo do desenvolvedor (Developer mode)",
          load: "Carregar sem compactação (Load unpacked)",
          where: "A chave fica na página Extensões do navegador, em geral no canto superior direito."
        }
      },
      sandbox: {
        flatpak_title: "O {browser} é um Flatpak e ainda não enxerga esta pasta",
        flatpak_body: "Dê a ele acesso de leitura à pasta uma vez — rode isto num terminal e depois feche e abra o navegador:",
        copy_command: "Copiar o comando",
        snap_title: "O {browser} é um snap e não enxerga esta pasta",
        snap_body: "Navegadores em snap só enxergam pastas dentro de /home. Use uma versão do navegador que não seja snap, ou outro navegador."
      },
      ask: {
        title: "Travou? O Hermes pode ajudar",
        desc: "Abre uma conversa nova com um pedido pronto: seu sistema, a pasta, o navegador e os passos. Nada é enviado até você apertar Enviar, e o pedido diz ao Hermes para não mexer no perfil do navegador, não pular os passos do próprio navegador e não instalar nada sem perguntar.",
        action: "Pedir ajuda ao Hermes",
        busy: "Abrindo uma conversa…",
        sent: "Uma conversa nova tem o pedido. Leia e aperte Enviar.",
        failed: "O Hermes não conseguiu abrir uma conversa. Copie o pedido e cole numa conversa com o Hermes:",
        copy_title: "Copiar um pedido para o Hermes",
        copy_desc: "Um pedido pronto com seu sistema, a pasta, o navegador e os passos, para uma conversa com o Hermes. Ele diz ao Hermes para não mexer no perfil do navegador, não pular os passos do próprio navegador e não instalar nada sem perguntar. O pedido vai em inglês.",
        copy_label: "Copiar um pedido para o Hermes"
      },
      remote_title: "O Hermes roda em outro computador ({name})",
      remote_body: "Este botão configura a extensão naquele computador. A extensão só conversa com um Hermes no mesmo computador, então use o navegador de lá.",
      wsl: {
        title: "O Hermes roda dentro do WSL",
        localhost: "O navegador roda no Windows e chega ao Hermes dentro do WSL pelo encaminhamento de localhost do WSL, que vem ligado. Se o código nunca conectar, use “{ask}” abaixo.",
        no_interop: "O Hermes roda dentro do WSL com o interop desligado: abra o navegador você mesmo.",
        wsl_disk: "A pasta está no disco do WSL: copie-a para a sua pasta de usuário do Windows se o navegador recusar este caminho."
      },
      not_ours_title: "Já existe uma pasta chamada “HermesTube Extension”",
      not_ours_body: "O Hermes não a criou, então não vai mexer nela. Renomeie ou mova essa pasta e verifique de novo.",
      check_again: "Verificar de novo",
      error_title: "O Hermes não conseguiu configurar a extensão",
      error_body: "Tente de novo, ou siga os passos à mão logo abaixo.",
      read_failed: "Ainda não deu para conferir a pasta da extensão — tentando de novo sozinho. O botão funciona mesmo assim.",
      show_folder: "Mostrar a pasta"
    },
    errors: {
      ext_endpoint_down: {
        title: "O Hermes não conseguiu abrir a conexão com o navegador",
        body: "Feche e abra o Hermes de novo e tente outra vez. Se continuar, outro aplicativo pode estar atrapalhando."
      },
      timeout: {
        title: "O Hermes demorou para responder",
        body: "Ele ainda pode estar iniciando. Tente de novo em instantes."
      },
      generic: {
        title: "Não conseguimos criar um código",
        body: "O Hermes não respondeu como esperado. Tente de novo."
      }
    }
  },
  done: {
    closing: "Abrindo suas inscrições em {seconds} s",
    stay: "Ficar aqui",
    open_now: "Ver minhas inscrições"
  },
  link: {
    title: "Colar um canal",
    desc: "Link de canal, link de vídeo ou @handle. Você segue aqui — nada muda no YouTube.",
    label: "Link do canal ou @handle",
    placeholder: "@veritasium ou youtube.com/@veritasium",
    examples: "Por exemplo @mkbhd, youtube.com/@3blue1brown ou o link de um vídeo",
    submit: "Adicionar",
    list_title: "Adicionados aqui",
    undo: "Desfazer",
    retry: "Tentar de novo",
    dismiss: "Dispensar",
    add_again: "Adicionar de novo",
    done: "Concluir",
    status: {
      pending: "Procurando no YouTube…",
      added: "Seguindo · {handle}",
      added_plain: "Seguindo",
      exists: "Já está na sua lista",
      late: "O YouTube está lento — o canal aparece na sua lista em instantes",
      undoing: "Desfazendo…",
      undone: "Tirado da sua lista"
    },
    errors: {
      empty: "Cole o link de um canal ou um @handle.",
      format: "Isso não parece um canal do YouTube. Use um @handle, o link do canal ou o link de um vídeo.",
      not_found: "Não encontramos este canal no YouTube. Confira o link ou o @handle.",
      rate_limited: "O YouTube está limitando os pedidos agora. Tente de novo em alguns minutos.",
      youtube_down: "O YouTube não está respondendo agora. Tente de novo em instantes.",
      timeout: "O YouTube demorou para responder. Tente de novo.",
      generic: "Não conseguimos adicionar este canal. Tente de novo.",
      undo_failed: "Não conseguimos desfazer. Tente de novo."
    }
  },
  demo: {
    title: "Modo demonstração",
    desc: "40 canais públicos reais em 6 pastas, alguns favoritos e uma aba por assunto. Nada mexe na sua conta do YouTube.",
    steps_label: "Carregando a demonstração",
    step_channels: "Adicionando canais e pastas",
    step_videos: "Buscando os vídeos mais recentes",
    step_ready: "Pronto para explorar",
    load: "Carregar demonstração",
    loaded_title: "A demonstração está carregada",
    loaded_desc: "Os canais da demonstração estão na sua lista. Limpar tira só eles — o que você adicionou fica.",
    clear: "Limpar demonstração",
    cleared_title: "Demonstração limpa",
    cleared_desc: "Só os canais da demonstração foram tirados.",
    load_again: "Carregar de novo",
    skipped: "{count} canais da demonstração já eram seus e ficaram como estavam",
    videos_later: "Os vídeos continuam chegando em segundo plano.",
    rss_down: "O feed do YouTube está instável agora — os vídeos chegam aos poucos.",
    errors: {
      load: "Não conseguimos carregar a demonstração. Tente de novo.",
      clear: "Não conseguimos limpar a demonstração. Tente de novo."
    }
  },
  devices: {
    title: "Navegadores conectados",
    desc: "Navegadores ligados ao Hermes pela extensão.",
    seen: "Ativo {when}",
    never_seen: "Ainda não apareceu",
    online: "Conectado agora",
    revoke: "Desconectar",
    revoke_label: "Desconectar {name}",
    revoke_title: "Desconectar {name}?",
    revoke_desc: "Suas inscrições e pastas continuam aqui.",
    revoke_effect_stop: "A extensão neste navegador para de sincronizar com o Hermes",
    revoke_effect_again: "Para conectar de novo, gere um novo código aqui",
    revoke_confirm: "Desconectar {name}",
    revoke_cancel: "Agora não",
    revoke_failed: "Não conseguimos desconectar {name}. Tente de novo.",
    error: "Não conseguimos carregar os navegadores conectados."
  },
  reach: {
    remote_title: "Você está conectado a {name}, não a este computador",
    remote_body: "A extensão conversa com o Hermes do computador onde está o seu navegador. Troque para {local} para configurar.",
    local_default: "This device",
    anyway: "Meu navegador está em {name}",
    off_title: "O plugin não está ligado em “{profile}”",
    off_body: "Você está no perfil “{profile}”. Volte ao perfil onde instalou o plugin, ou ligue aqui: Capabilities → Plugins → HermesTube."
  }
};

// desktop-src/locales/pt-BR/organize.json
var organize_default2 = {
  title: "Organizar com Hermes",
  intro: {
    lead: "O Hermes lê o nome e os vídeos recentes de cada canal e sugere uma pasta.",
    count_none: "Canais sem pasta",
    count_selection: "Canais selecionados",
    model_exact: "Usa {model}",
    model_last: "Últimas sugestões por {model}",
    model_main: "Usa o modelo do Hermes ({model}), ou o que você escolher para esta tarefa",
    model_unknown: "Usa o modelo configurado no Hermes",
    choose_model: "Escolher modelo",
    start: "Sugerir pastas",
    not_now: "Agora não",
    steps_label: "O que vai acontecer"
  },
  steps: {
    read: "O Hermes lê os nomes e os vídeos recentes",
    suggest: "Sugere uma pasta (e tags) para cada canal",
    review: "Você revisa: nada muda até você aceitar"
  },
  progress: {
    label: "Organizando",
    channels: "{done} de {total} canais",
    percent: "{percent}%",
    preparing: "Começando…",
    arriving: "Mais sugestões a caminho",
    accept_ready_one: "Aceitar {count} pronta",
    accept_ready_other: "Aceitar {count} prontas",
    cancel: "Cancelar",
    background: "Continuar em segundo plano"
  },
  review: {
    suggestions_one: "{count} sugestão",
    suggestions_other: "{count} sugestões",
    folders_one: "{count} pasta",
    folders_other: "{count} pastas",
    new_folders_one: "{count} nova",
    new_folders_other: "{count} novas",
    by_model: "por {model}",
    nothing_changes: "Nada muda até você aceitar.",
    accept_all: "Aceitar tudo ({count})",
    shortcut_mac: "⌘↵ aceita tudo",
    shortcut_other: "Ctrl+Enter aceita tudo",
    done: "Concluir",
    close: "Fechar",
    suggest_again: "Sugerir de novo",
    list_label: "Pastas sugeridas"
  },
  group: {
    new: "pasta nova",
    tags_only: "Tags novas (a pasta continua a mesma)"
  },
  row: {
    change_folder: "Trocar a pasta de {channel}",
    folder_input: "Pasta de {channel}",
    folder_hint: "Enter confirma · Esc desiste",
    edited: "trocada por você",
    from: "hoje em {folder}",
    add_tags_one: "adicionar tag {tags}",
    add_tags_other: "adicionar tags {tags}"
  },
  undo: {
    organized_one: "{count} canal organizado",
    organized_other: "{count} canais organizados",
    action: "Desfazer organização",
    undoing: "Desfazendo…"
  },
  reject: {
    pending_one: "{count} sugestão recusada",
    pending_other: "{count} sugestões recusadas",
    undo: "Desfazer"
  },
  partial: {
    title_one: "{count} canal ficou sem sugestão",
    title_other: "{count} canais ficaram sem sugestão",
    timeout: "O tempo acabou antes do fim.",
    batch: "Um lote não voltou do modelo, ou o Hermes não teve certeza.",
    retry: "Tentar esses de novo"
  },
  uncovered: {
    title_one: "{count} canal sem pasta não está nestas sugestões",
    title_other: "{count} canais sem pasta não estão nestas sugestões",
    desc: "Eles chegaram depois que estas sugestões foram feitas, ou a última rodada não chegou até eles.",
    action: "Sugerir para eles"
  },
  notice: {
    busy: "Já havia uma organização em andamento; você está acompanhando ela.",
    cancelled: "Cancelado. Nada foi aplicado; as sugestões que já chegaram ficam aqui para você revisar.",
    cancel_failed: "Não deu para cancelar; o trabalho termina sozinho. Nada muda até você aceitar."
  },
  nothing: {
    title: "Todos os canais já estão em pastas",
    desc: "Inscrições novas sem pasta vão aparecer aqui.",
    action: "Ver canais"
  },
  empty: {
    title: "Nenhuma sugestão desta vez",
    desc: "O Hermes não achou uma boa pasta para esses canais.",
    retry: "Tentar de novo"
  },
  no_model: {
    title: "Escolha um modelo para o Hermes organizar",
    desc: "O Hermes precisa de um modelo de IA para esta tarefa. Escolha um e entre na conta em Ajustes → Modelos e depois tente de novo.",
    action: "Escolher modelo",
    retry: "Tentar de novo"
  },
  provider_unavailable: {
    title: "O Hermes não conseguiu acessar seu modelo de IA",
    action: "Abrir ajustes do modelo",
    retry: "Tentar de novo"
  },
  error: {
    title: "Não deu para sugerir pastas",
    accept: "Não deu para aplicar",
    reject: "Não deu para recusar",
    undo: "Não deu para desfazer",
    retry: "Tentar de novo"
  },
  ai: {
    no_model_title: "Nenhum modelo de IA disponível",
    no_model_desc: "O Hermes precisa de um modelo de IA para sugerir pastas. Escolha um e entre na conta em Ajustes → Modelos antes.",
    choose_model: "Escolher modelo",
    provider_unavailable_title: "O Hermes não conseguiu acessar seu modelo de IA"
  }
};

// desktop-src/locales/pt-BR/panes.json
var panes_default2 = {
  tree: {
    label: "Inscrições",
    all: "Tudo",
    later: "Ver depois",
    unfiled: "Sem pasta"
  },
  row: {
    menu: "Mais ações para {name}",
    favorite: "Favorito",
    muted: "Silenciado"
  },
  search: {
    placeholder: "Achar um canal ou pasta",
    empty_title: "Nada com “{query}”",
    empty_desc: "Tente parte do nome do canal, um @handle ou uma pasta.",
    clear: "Limpar a busca"
  },
  empty: {
    title: "Nenhuma inscrição ainda",
    description: "Conecte a extensão do navegador, cole o link de um canal ou experimente a demonstração — leva um minuto.",
    action: "Começar"
  },
  error: {
    title: "Não deu para carregar suas inscrições",
    unavailable: "O plugin não está ligado em “{profile}”",
    offline: "Sem conexão com o Hermes agora",
    unavailable_hint: "Você está no perfil “{profile}”. Volte ao perfil onde instalou o plugin, ou ligue aqui: Capabilities → Plugins → HermesTube.",
    offline_hint: "Veja se o Hermes está rodando e tente de novo."
  },
  banner: {
    counts_failed: "Não deu para ler quantos vídeos novos há.",
    retry: "Tentar de novo",
    ext_disconnected: "Extensão do navegador desconectada.",
    reconnect: "Reconectar",
    rss_down: "O feed do YouTube está fora do ar — mostrando o que já temos."
  },
  menu: {
    open_home: "Abrir em Inscrições",
    mark_read: "Marcar como lido",
    mark_all_read: "Marcar tudo como lido",
    favorite: "Favoritar",
    unfavorite: "Tirar dos favoritos",
    mute: "Silenciar",
    unmute: "Reativar",
    move: "Mover para…",
    new_tab: "Nova aba com esta pasta",
    open_youtube: "Abrir no YouTube"
  },
  move: {
    title: "Mover “{name}” para…",
    description_channel: "Escolha a pasta deste canal.",
    description_folder: "Escolha onde esta pasta fica.",
    no_folder: "Sem pasta",
    top_level: "Nível principal",
    cancel: "Cancelar"
  },
  nav: {
    no_tab: "Inscrições ainda não tem uma aba para {name}.",
    create_tab: "Criar aba"
  },
  toast: {
    moved_channel: "{name} foi para {folder}",
    moved_channel_none: "{name} saiu da pasta",
    moved_folder: "{name} agora está dentro de {folder}",
    moved_folder_root: "{name} foi para o nível principal",
    favorite_on: "{name} entrou nos favoritos",
    favorite_off: "{name} saiu dos favoritos",
    muted_on: "{name} silenciado",
    muted_off: "{name} reativado",
    read: "{name} marcado como lido",
    read_all: "Tudo marcado como lido",
    read_nothing: "Nada novo em {name}",
    read_nothing_all: "Nada novo para marcar",
    cycle: "Uma pasta não pode ir para dentro dela mesma",
    undo: "Desfazer",
    failed: "Não deu para salvar: {error}",
    undo_failed: "Não deu para desfazer: {error}"
  },
  palette: {
    show: {
      label: "HermesTube: mostrar o painel de canais",
      keywords: "youtube inscrições canais painel lateral mostrar abrir aba"
    }
  },
  toggle: {
    show: "Mostrar o painel de canais",
    hide: "Esconder o painel de canais",
    elsewhere: "O painel de canais não está na barra lateral direita. Para escondê-lo, clique com o botão direito na aba dele e escolha Hide (Ocultar)."
  }
};

// desktop-src/locales/pt-BR/tab-editor.json
var tab_editor_default2 = {
  title_create: "Nova aba",
  title_edit: "Editar “{name}”",
  title_edit_loading: "Editar aba",
  subtitle_create: "Escolha o que entra. A prévia muda enquanto você escolhe.",
  subtitle_edit: "Mude o que entra e os filtros. Nada muda até você salvar.",
  subtitle_builtin: "Aba padrão: as fontes ficam como estão. Os filtros você pode mudar.",
  name: {
    label: "Nome",
    placeholder: "Nome da aba",
    suggested: "Sugerido pelas suas escolhas. Digite para trocar.",
    empty: "A aba precisa de um nome.",
    empty_no_suggestion: "Dê um nome à aba.",
    use: "Usar “{name}”",
    long: "Até {max} caracteres.",
    duplicate: "A aba “{name}” já usa esse nome.",
    builtin: "Abas padrão mantêm o nome."
  },
  icon: {
    label: "Ícone",
    placeholder: "🙂",
    hint: "Opcional"
  },
  sources: {
    title: "O que entra",
    desc: "Pastas incluem as subpastas. Escolha quantas quiser.",
    folders: "Pastas",
    tags: "Tags",
    channels: "Canais",
    chosen_one: "{count} escolhida",
    chosen_other: "{count} escolhidas",
    none: "Nenhuma",
    folders_empty: "Ainda não há pastas. Crie em Gerenciar.",
    tags_empty: "Ainda não há tags. Crie em Gerenciar.",
    covered: "Já entra com “{name}”",
    need: "Escolha ao menos uma pasta, tag ou canal.",
    builtin_all: "Tudo o que há de novo nos canais que você segue. As fontes de uma aba padrão não mudam.",
    builtin_favorites: "Todos os canais ⭐ favoritos. As fontes de uma aba padrão não mudam."
  },
  channels: {
    search: "Buscar canais pelo nome",
    search_placeholder: "Buscar um canal…",
    results: "Encontrados",
    suggestions: "Seus canais",
    no_match: "Nenhum canal chamado “{query}”.",
    add: "Adicionar {name}",
    leave_out: "Deixar {name} de fora",
    remove: "Tirar {name}",
    chosen: "Canais escolhidos"
  },
  filters: {
    title: "O que sai e filtros",
    exclude: "Deixar canais de fora",
    exclude_placeholder: "Buscar um canal para deixar de fora…",
    excluded: "De fora",
    no_shorts: "Sem Shorts",
    only_new: "Só não vistos",
    only_new_desc: "Esconde o que você já viu",
    per_channel: "No máximo por canal",
    per_channel_desc: "Para um canal não tomar conta",
    per_channel_value: "Vídeos por canal",
    duration: "Duração",
    duration_desc: "Em minutos; vazio é qualquer uma",
    min: "Duração mínima (minutos)",
    max: "Duração máxima (minutos)",
    min_short: "mín.",
    max_short: "máx.",
    shortcuts: "Atalhos de duração",
    short: "Curtos · menos de 10 min",
    long: "Longos · 20 min ou mais",
    duration_bad: "A duração mínima passa da máxima.",
    mode: "Modo",
    mode_fresh: "Recentes",
    mode_fresh_desc: "Últimos 30 dias",
    mode_long: "Longos",
    mode_long_desc: "20 min ou mais",
    mode_classics: "Clássicos",
    mode_classics_desc: "Os mais vistos de sempre"
  },
  chips: {
    label: "Filtros ligados",
    exclude_one: "Sem {name}",
    exclude_other: "Sem {count} canais",
    no_shorts: "Sem Shorts",
    only_new: "Só não vistos",
    per_channel: "Até {count} por canal",
    min: "{min} min ou mais",
    max: "Até {max} min",
    range: "{min}–{max} min",
    mode_fresh: "Recentes",
    mode_long: "Modo longos",
    mode_classics: "Clássicos",
    remove: "Tirar “{label}”"
  },
  preview: {
    title: "Prévia",
    loading: "Carregando…",
    videos_one: "{count} vídeo",
    videos_other: "{count} vídeos",
    channels_one: "{count} canal",
    channels_other: "{count} canais",
    grid_label: "Prévia da aba",
    need_title: "Escolha o que entra",
    need_desc: "Escolha uma pasta, uma tag ou um canal e os vídeos aparecem aqui.",
    need_action: "Escolher fontes",
    invalid_title: "Esses filtros não combinam",
    error_title: "Não deu para carregar a prévia",
    empty_title: "Nenhum vídeo com esses filtros",
    empty_desc: "Tire “{filter}” para ver mais.",
    empty_action: "Tirar “{filter}”",
    empty_sources_title: "Essas fontes ainda não têm vídeos",
    empty_sources_desc: "Os vídeos novos aparecem aqui quando os canais publicarem. Você também pode juntar outras fontes.",
    empty_sources_action: "Escolher outras fontes"
  },
  footer: {
    cancel: "Cancelar",
    create: "Criar aba",
    save: "Salvar",
    saving: "Salvando…",
    unsaved: "Alterações não salvas",
    no_changes: "Nenhuma alteração ainda",
    hint: "⌘Enter cria a aba",
    shortcut: "⌘Enter / Ctrl+Enter",
    delete: "Excluir aba",
    error: "Não salvou: {error}"
  },
  confirm: {
    discard_title: "Descartar as alterações?",
    discard_desc: "O que você escolheu aqui vai se perder.",
    discard: "Descartar",
    keep: "Continuar editando",
    delete_title: "Excluir a aba “{name}”?",
    delete_desc: "Canais, pastas e vídeos continuam como estão.",
    delete: "Excluir aba",
    not_now: "Agora não"
  },
  toast: {
    created: "Aba “{name}” criada",
    saved: "Aba “{name}” salva",
    deleted: "Aba “{name}” excluída",
    undo: "Desfazer",
    undone: "“{name}” voltou ao que era",
    undo_failed: "Não deu para desfazer: {error}"
  },
  load: {
    missing_title: "Esta aba não existe mais",
    missing_desc: "Ela pode ter sido excluída em outro lugar.",
    close: "Fechar"
  }
};

// desktop-src/locales/pt-BR/theme.json
var theme_default2 = {
  title: "Nova aba por assunto",
  description: "O Hermes pesquisa no YouTube, faz a curadoria com IA e mostra uma prévia. Nada é salvo antes de você confirmar.",
  field: {
    label: "Sobre o que você quer uma aba?",
    placeholder: "ex.: agentes de IA, pão de fermentação natural, história de Roma",
    hint: "Poucas palavras bastam. O Hermes planeja as buscas.",
    too_short: "Digite pelo menos 2 caracteres.",
    invalid: "O Hermes não conseguiu usar este texto. Tente outras palavras."
  },
  examples: {
    label: "Experimente",
    ex1: "agentes de IA",
    ex2: "pão de fermentação natural",
    ex3: "história de Roma",
    ex4: "café espresso em casa",
    ex5: "aprender Rust"
  },
  options: {
    label: "Opções",
    language: "Vídeos em",
    lang_any: "Qualquer idioma",
    lang_pt: "Português",
    lang_en: "Inglês",
    classics: "Incluir clássicos",
    classics_hint: "vídeos antigos e consagrados também"
  },
  hints: {
    lang_pt: "(vídeos em português)",
    lang_en: "(vídeos em inglês)",
    classics: "(incluir clássicos: vídeos antigos e consagrados)"
  },
  steps: {
    label: "Progresso",
    expand: "Expandindo o assunto",
    search: "Pesquisando no YouTube",
    curate: "Curando com a IA",
    preview: "Montando a prévia",
    expand_running: "lendo o assunto…",
    searches_one: "{count} busca",
    searches_other: "{count} buscas",
    search_running_one: "{count} busca no YouTube…",
    search_running_other: "{count} buscas no YouTube…",
    found_one: "{count} vídeo",
    found_other: "{count} vídeos",
    rating_one: "avaliando {count} vídeo…",
    rating_other: "avaliando {count} vídeos…",
    rated_progress: "{done} de {total} avaliados",
    rated_one: "{count} avaliado",
    rated_other: "{count} avaliados",
    kept_one: "{count} mantido",
    kept_other: "{count} mantidos",
    channels_one: "{count} canal",
    channels_other: "{count} canais"
  },
  progress: {
    lead: "Costuma levar de 1 a 3 minutos: o Hermes lê os candidatos um por um.",
    background: "Fechar esta janela não interrompe: a aba continua sendo montada e Inscrições avisa quando ficar pronta.",
    elapsed: "Tempo decorrido {time}",
    coming: "Prévia",
    coming_desc: "Os vídeos que o Hermes mantiver aparecem aqui.",
    cancel_failed: "Não deu para cancelar; a busca termina sozinha. Nada é salvo antes de você confirmar."
  },
  preview: {
    name_label: "Nome da aba",
    name_empty: "Dê um nome à aba.",
    name_long: "Até {max} caracteres.",
    about: "Sobre “{query}”",
    videos: "Vídeos",
    videos_desc: "Tire o que não combina com 👎 (ou D no vídeo em foco). O Hermes aprende com isso.",
    grid_label: "Vídeos da prévia",
    down: "Não é pra mim",
    reason_search: "achado na busca",
    reason_classics: "clássico",
    reason_rss: "de um canal-semente",
    seeds: "Canais-semente",
    seeds_desc: "Canais com 3 ou mais vídeos mantidos. Segui-los mantém a aba sempre nova.",
    seeds_empty: "Nenhum canal apareceu 3 vezes ou mais; a aba vai depender da busca.",
    seed_kept_one: "{count} vídeo mantido",
    seed_kept_other: "{count} vídeos mantidos",
    seed_choice: "O que fazer com {name}",
    follow: "Seguir",
    ignore: "Ignorar",
    follow_all: "Seguir todos",
    ignore_all: "Ignorar todos",
    in_list: "Já está na sua lista",
    folder: "Também criar a pasta “{name}”",
    folder_plain: "Também criar uma pasta",
    partial_title: "Prévia parcial",
    partial: "O tempo acabou antes de o Hermes avaliar tudo. Dá para salvar o que já está aqui ou tentar de novo.",
    saved_title: "Este assunto já virou uma aba",
    saved: "Abra em Inscrições ou comece um assunto novo.",
    all_removed_title: "Você tirou todos os vídeos",
    all_removed: "Traga de volta ou reformule o assunto."
  },
  footer: {
    not_now: "Agora não",
    start: "Montar prévia",
    cancel: "Cancelar",
    background: "Continuar em segundo plano",
    discard: "Descartar",
    save: "Salvar aba",
    save_folder: "Salvar aba e pasta",
    open_home: "Abrir em Inscrições",
    rephrase: "Reformular",
    new_theme: "Novo assunto",
    save_shortcut: "⌘Enter salva"
  },
  empty: {
    title: "Nada encontrado sobre “{query}”",
    desc: "Tente menos palavras, termos mais amplos ou um assunto vizinho.",
    restore: "Trazer de volta"
  },
  ai: {
    no_model_title: "Nenhum modelo de IA disponível",
    no_model_desc: "As abas por assunto precisam de um modelo para planejar as buscas e fazer a curadoria. Escolha um e entre na conta em Ajustes → Modelos antes.",
    open_settings: "Abrir Ajustes",
    provider_unavailable_title: "O Hermes não conseguiu acessar seu modelo de IA",
    provider_unavailable_action: "Abrir ajustes do modelo"
  },
  no_model: {
    title: "Escolha um modelo de IA primeiro",
    desc: "As abas por assunto precisam de um modelo para planejar as buscas e fazer a curadoria. Escolha um e entre na conta em Ajustes → Modelos.",
    action: "Abrir Ajustes"
  },
  provider_unavailable: {
    title: "O Hermes não conseguiu acessar seu modelo de IA",
    action: "Abrir ajustes do modelo",
    retry: "Tentar de novo"
  },
  busy: {
    title: "Já tem uma aba por assunto sendo montada",
    desc: "O Hermes monta uma aba por assunto por vez. Acompanhe essa ou tente de novo quando ela terminar.",
    follow: "Acompanhar",
    retry: "Tentar de novo"
  },
  error: {
    title: "Não deu para montar a prévia",
    load_title: "Não deu para abrir esta prévia",
    expired_title: "Essa busca não existe mais",
    expired: "As prévias ficam guardadas por 7 dias. Comece uma nova.",
    save_title: "Não deu para salvar",
    conflict: "Este assunto já foi salvo como aba."
  },
  toast: {
    saved: "Aba “{name}” criada",
    undo: "Desfazer",
    undone: "Aba “{name}” removida",
    reopen: "Reabrir a prévia",
    undo_failed: "Não deu para desfazer: {error}",
    removed: "“{title}” saiu da prévia",
    down_failed: "Não deu para tirar: {error}"
  }
};

// desktop-src/locales/pt-BR/watch.json
var watch_default2 = {
  tab: {
    title: "Assistindo"
  },
  label: "Assistindo: {title}",
  player: {
    label: "Player do Hermes",
    note: "Alguns canais só deixam tocar no YouTube. Se o player avisar, use Abrir no YouTube.",
    larger: "Player maior",
    larger_hint: "Amplia o player (fica menos nítido). O app o desenha com até 640 × 360.",
    larger_off_hint: "Volta ao player no tamanho dele (mais nítido)"
  },
  tip: {
    always_allow: 'Dica: clique no ▾ ao lado de "Load YouTube" e escolha "Always allow YouTube". Daí em diante os vídeos abrem direto no player.',
    dismiss: "Entendi"
  },
  meta: {
    published: "Publicado {date}",
    views: "{count} visualizações",
    duration: "Duração {duration}"
  },
  description: {
    label: "Descrição",
    more: "Mostrar mais",
    less: "Mostrar menos"
  },
  actions: {
    label: "Ações do vídeo",
    mark_watched: "Marcar como visto",
    watched: "Visto",
    open: "Abrir no YouTube"
  },
  next: {
    title: "A seguir",
    from: "A seguir · {source}",
    label: "Fila: a seguir nesta lista",
    list: "Fila",
    previous: "Anterior",
    next: "Próximo",
    position: "{index} de {total}",
    end: "Fim da fila.",
    keys: "N / P para andar · o próximo não começa sozinho",
    edit_keys: "Arraste pela alça ou use Alt+↑ / Alt+↓ para mudar a ordem · Delete tira da fila",
    now_playing: "Tocando agora",
    remove: "Tirar da fila",
    play_next: "Tocar em seguida",
    drag: "Arraste para mudar a ordem",
    removed: "Saiu da fila: {title}",
    restored: "De volta à fila: {title}",
    moved: "{title}: posição {index} de {total}",
    queued_next: "{title} toca em seguida",
    empty: "A fila está vazia.",
    empty_hint: "O vídeo continua aqui. Abra outro vídeo em Inscrições para começar uma fila nova."
  },
  state: {
    loading: "Carregando os detalhes do vídeo…",
    unknown_title: "Fora da sua biblioteca",
    unknown_desc: "Não temos os detalhes deste vídeo. Ele ainda pode tocar aqui, ou você pode abrir no YouTube.",
    error: "Não deu para carregar os detalhes: {error}",
    retry: "Tentar de novo",
    empty_title: "Nada tocando",
    empty_desc: "Clique num vídeo em Inscrições para assistir aqui.",
    empty_action: "Ir para Inscrições"
  },
  open_mode: {
    label: "Abrir vídeos",
    hermes: "No Hermes",
    youtube: "No YouTube",
    hermes_hint: "Os vídeos tocam aqui no HermesTube, com o player do Hermes",
    youtube_hint: "Os vídeos abrem no YouTube, no navegador"
  },
  toast: {
    watched: "Marcado como visto",
    unwatched: "Marcado como não visto",
    later: "Salvo em Ver depois",
    unlater: "Tirado de Ver depois",
    archived: "Arquivado",
    unarchived: "De volta à lista",
    up: "Gostei",
    down: "Marcado como não curti",
    reaction_cleared: "Reação removida",
    undo: "Desfazer",
    failed: "Não deu para salvar: {error}",
    undo_failed: "Não deu para desfazer: {error}"
  }
};

// desktop-src/lib/i18n.ts
var LOCALES = ["en", "pt-BR"];
var PT_LOCALE_IDS = ["pt-br", "pt-BR", "pt"];
var asMessages = (v) => v;
var BUNDLES = {
  en: {
    common: asMessages(common_default),
    home: asMessages(home_default),
    manage: asMessages(manage_default),
    history: asMessages(history_default),
    cleanup: asMessages(cleanup_default),
    extras: asMessages(extras_default),
    panes: asMessages(panes_default),
    chrome: asMessages(chrome_default),
    "tab-editor": asMessages(tab_editor_default),
    onboarding: asMessages(onboarding_default),
    organize: asMessages(organize_default),
    theme: asMessages(theme_default),
    "list-import": asMessages(list_import_default),
    chat: asMessages(chat_default),
    watch: asMessages(watch_default)
  },
  "pt-BR": {
    common: asMessages(common_default2),
    home: asMessages(home_default2),
    manage: asMessages(manage_default2),
    history: asMessages(history_default2),
    cleanup: asMessages(cleanup_default2),
    extras: asMessages(extras_default2),
    panes: asMessages(panes_default2),
    chrome: asMessages(chrome_default2),
    "tab-editor": asMessages(tab_editor_default2),
    onboarding: asMessages(onboarding_default2),
    organize: asMessages(organize_default2),
    theme: asMessages(theme_default2),
    "list-import": asMessages(list_import_default2),
    chat: asMessages(chat_default2),
    watch: asMessages(watch_default2)
  }
};
function registerLocales(ctx) {
  if (typeof ctx.i18n?.register !== "function") return () => void 0;
  const pt = BUNDLES["pt-BR"];
  const bundles = { en: BUNDLES.en };
  for (const id of PT_LOCALE_IDS) bundles[id] = pt;
  return ctx.i18n.register(bundles);
}
function interpolate(text, vars2) {
  if (!vars2) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => name in vars2 ? String(vars2[name]) : m);
}
function useT(ns = "common") {
  const pt = usePluginI18n(PLUGIN_ID);
  return useCallback((key, vars2) => interpolate(pt(`${ns}.${key}`), vars2), [pt, ns]);
}
function lookup(tree, path) {
  let node = tree;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return void 0;
    node = node[part];
  }
  return typeof node === "string" ? node : void 0;
}
function tNow(ns, key, vars2) {
  const full = `${ns}.${key}`;
  const t = maybePluginContext()?.i18n?.t;
  const hit = typeof t === "function" ? t(full) : full;
  return interpolate(hit !== full ? hit : lookup(BUNDLES.en[ns], key) ?? full, vars2);
}
function errorText(t, error) {
  const key = `errors.${error.code}`;
  const text = t(key);
  return text === `common.${key}` || text === key ? error.message : text;
}

// raw-css:desktop-src/styles/channel.css
var channel_default = [
  "/* Channel: ChannelAvatar, FolderChip/TagChip, ChannelTable/ChannelRow, Tree/TreeItem. */",
  "",
  "/* --------------------------------------------------------------- Avatar */",
  "",
  ".PFX_avatar {",
  "  display: inline-grid;",
  "  flex: none;",
  "  place-items: center;",
  "  overflow: hidden;",
  "  border-radius: 999px;",
  "  object-fit: cover;",
  "  background: var(--ui-bg-tertiary);",
  "  box-shadow: inset 0 0 0 1px var(--ui-stroke-quaternary);",
  "  color: var(--ui-text-secondary);",
  "  font-weight: 600;",
  "  line-height: 1;",
  "  user-select: none;",
  "}",
  "",
  "/* fallback (no photo or the photo failed): stable tone derived from the name (the SDK's profileColor), soft on the background",
  "   and mixed with the theme text on the letter — legible in light and dark */",
  ".PFX_avatar-fallback {",
  "  background: var(--PFX_avatar-soft, var(--ui-bg-tertiary));",
  "  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--PFX_avatar-tone, var(--ui-text-secondary)) 22%, transparent);",
  "  color: color-mix(in srgb, var(--PFX_avatar-tone, var(--ui-text-secondary)) 52%, var(--ui-text-primary));",
  "  font-weight: 600;",
  "  letter-spacing: -0.02em;",
  "  text-transform: none;",
  "}",
  "",
  "img.PFX_avatar {",
  "  background: var(--ui-bg-quaternary);",
  "}",
  "",
  "/* --------------------------------------------------------------- Chips (folder, tag) */",
  "",
  ".PFX_chip {",
  "  display: inline-flex;",
  "  align-items: center;",
  "  gap: 4px;",
  "  max-width: 12rem;",
  "  height: 22px;",
  "  padding: 0 8px;",
  "  border: 1px solid var(--ui-stroke-tertiary);",
  "  border-radius: 999px;",
  "  background: transparent;",
  "  color: var(--ui-text-secondary);",
  "  font-size: var(--PFX_fs-label);",
  "  line-height: var(--PFX_lh-label);",
  "  font-weight: 450;",
  "  white-space: nowrap;",
  "  transition:",
  "    border-color var(--PFX_dur) var(--PFX_ease),",
  "    background-color var(--PFX_dur) var(--PFX_ease);",
  "}",
  "",
  "button.PFX_chip:hover {",
  "  border-color: var(--ui-stroke-secondary);",
  "  background: var(--ui-bg-quinary);",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_chip[data-active='true'] {",
  "  border-color: var(--ui-text-quaternary);",
  "  background: var(--ui-bg-quaternary);",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_chip-icon {",
  "  flex: none;",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  ".PFX_chip-hash {",
  "  color: var(--ui-text-quaternary);",
  "}",
  "",
  ".PFX_chip-label {",
  "  min-width: 0;",
  "  overflow: hidden;",
  "  text-overflow: ellipsis;",
  "}",
  "",
  ".PFX_chip-count {",
  "  color: var(--PFX_fg3);",
  "  font-variant-numeric: tabular-nums;",
  "}",
  "",
  ".PFX_chip-remove {",
  "  display: inline-grid;",
  "  place-items: center;",
  "  width: 14px;",
  "  height: 14px;",
  "  margin-right: -4px;",
  "  border-radius: 999px;",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  ".PFX_chip-remove:hover {",
  "  background: var(--ui-control-hover-background);",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_chip[data-skeleton] {",
  "  width: 72px;",
  "}",
  "",
  "/* --------------------------------------------------------------- ChannelTable / ChannelRow */",
  "",
  ".PFX_table {",
  "  display: flex;",
  "  flex-direction: column;",
  "  min-width: 0;",
  "  container-type: inline-size;",
  "  container-name: PFX_table;",
  "}",
  "",
  ".PFX_crow {",
  "  --PFX_cols: minmax(200px, 2.4fr) minmax(108px, 1fr) minmax(120px, 1.2fr) 56px minmax(150px, 1.6fr) 32px;",
  "  position: relative;",
  "  display: grid;",
  "  grid-template-columns: var(--PFX_cols);",
  "  align-items: center;",
  "  column-gap: var(--PFX_s3);",
  "  min-height: 52px;",
  "  padding: 6px var(--PFX_s3);",
  "  border-bottom: 1px solid var(--ui-stroke-quaternary);",
  "  color: var(--ui-text-primary);",
  "  transition: background-color var(--PFX_dur) var(--PFX_ease);",
  "}",
  "",
  ".PFX_table[data-selectable='true'] .PFX_crow {",
  "  --PFX_cols: 20px minmax(200px, 2.4fr) minmax(108px, 1fr) minmax(120px, 1.2fr) 56px minmax(150px, 1.6fr) 32px;",
  "}",
  "",
  ".PFX_crow[data-head='true'] {",
  "  min-height: 32px;",
  "  padding-top: 0;",
  "  padding-bottom: 0;",
  "  border-bottom-color: var(--ui-stroke-tertiary);",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  ".PFX_crow:not([data-head='true']):hover {",
  "  background: var(--ui-row-hover-background);",
  "}",
  "",
  ".PFX_crow[aria-selected='true'] {",
  "  background: var(--ui-row-active-background);",
  "}",
  "",
  ".PFX_ccell {",
  "  display: flex;",
  "  align-items: center;",
  "  gap: var(--PFX_s2);",
  "  min-width: 0;",
  "}",
  "",
  ".PFX_ccell[data-col='new'] {",
  "  justify-content: flex-end;",
  "}",
  "",
  ".PFX_ccell[data-col='tags'],",
  ".PFX_ccell[data-col='folder'] {",
  "  flex-wrap: nowrap;",
  "  overflow: hidden;",
  "}",
  "",
  ".PFX_chead {",
  "  font-size: var(--PFX_fs-label);",
  "  line-height: var(--PFX_lh-label);",
  "  font-weight: 500;",
  "  letter-spacing: 0.04em;",
  "}",
  "",
  ".PFX_cname {",
  "  display: flex;",
  "  flex-direction: column;",
  "  min-width: 0;",
  "}",
  "",
  ".PFX_cname-title {",
  "  display: flex;",
  "  align-items: center;",
  "  gap: 6px;",
  "  min-width: 0;",
  "  font-weight: 550;",
  "}",
  "",
  ".PFX_cname-sub {",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  ".PFX_clast {",
  "  display: flex;",
  "  flex-direction: column;",
  "  min-width: 0;",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_clast-when {",
  "  color: var(--PFX_fg3);",
  "  font-variant-numeric: tabular-nums;",
  "}",
  "",
  ".PFX_cnone {",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  ".PFX_fav {",
  "  display: inline-grid;",
  "  place-items: center;",
  "  width: 20px;",
  "  height: 20px;",
  "  border-radius: 5px;",
  "  color: var(--ui-text-tertiary);",
  "}",
  "",
  ".PFX_fav:hover {",
  "  background: var(--ui-control-hover-background);",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_fav[aria-pressed='true'] {",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  "@container PFX_table (max-width: 860px) {",
  "  .PFX_crow,",
  "  .PFX_table[data-selectable='true'] .PFX_crow {",
  "    --PFX_cols: minmax(180px, 2fr) minmax(100px, 1fr) 48px minmax(130px, 1.4fr) 32px;",
  "  }",
  "",
  "  .PFX_table[data-selectable='true'] .PFX_crow {",
  "    --PFX_cols: 20px minmax(180px, 2fr) minmax(100px, 1fr) 48px minmax(130px, 1.4fr) 32px;",
  "  }",
  "",
  "  .PFX_ccell[data-col='tags'] {",
  "    display: none;",
  "  }",
  "}",
  "",
  "@container PFX_table (max-width: 600px) {",
  "  .PFX_crow {",
  "    --PFX_cols: minmax(0, 1fr) 40px 28px;",
  "  }",
  "",
  "  .PFX_table[data-selectable='true'] .PFX_crow {",
  "    --PFX_cols: 20px minmax(0, 1fr) 40px 28px;",
  "  }",
  "",
  "  .PFX_ccell[data-col='folder'],",
  "  .PFX_ccell[data-col='last'] {",
  "    display: none;",
  "  }",
  "",
  "  .PFX_crow {",
  "    padding-left: var(--PFX_s2);",
  "    padding-right: var(--PFX_s2);",
  "  }",
  "}",
  "",
  "/* --------------------------------------------------------------- Tree / TreeItem (side pane) */",
  "",
  ".PFX_tree {",
  "  display: flex;",
  "  flex-direction: column;",
  "  gap: 1px;",
  "  margin: 0;",
  "  padding: var(--PFX_s1);",
  "  list-style: none;",
  "}",
  "",
  ".PFX_tree-item {",
  "  list-style: none;",
  "  outline: none;",
  "}",
  "",
  ".PFX_tree-group {",
  "  display: flex;",
  "  flex-direction: column;",
  "  gap: 1px;",
  "  margin: 1px 0 0;",
  "  padding: 0;",
  "  list-style: none;",
  "}",
  "",
  ".PFX_tree-row {",
  "  display: flex;",
  "  align-items: center;",
  "  gap: 6px;",
  "  height: 28px;",
  "  padding: 0 var(--PFX_s2) 0 calc(4px + (var(--PFX_level, 1) - 1) * 16px);",
  "  border-radius: var(--PFX_r-control);",
  "  color: var(--ui-text-secondary);",
  "  font-size: var(--PFX_fs-body);",
  "  line-height: var(--PFX_lh-body);",
  "  cursor: default;",
  "  user-select: none;",
  "  transition: background-color 120ms var(--PFX_ease);",
  "}",
  "",
  ".PFX_tree-row:hover {",
  "  background: var(--ui-row-hover-background);",
  "}",
  "",
  ".PFX_tree-item[aria-selected='true'] > .PFX_tree-row {",
  "  background: var(--ui-row-active-background);",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_tree-item:focus-visible > .PFX_tree-row {",
  "  outline: 2px solid var(--PFX_ring);",
  "  outline-offset: -2px;",
  "}",
  "",
  ".PFX_tree-row[data-drop='true'] {",
  "  background: var(--ui-bg-quaternary);",
  "  box-shadow: inset 0 0 0 1px var(--ui-text-quaternary);",
  "}",
  "",
  ".PFX_tree-caret {",
  "  display: inline-grid;",
  "  flex: none;",
  "  place-items: center;",
  "  width: 16px;",
  "  height: 16px;",
  "  border-radius: 4px;",
  "  color: var(--PFX_fg3);",
  "  transition: transform var(--PFX_dur) var(--PFX_ease);",
  "}",
  "",
  ".PFX_tree-caret:hover {",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_tree-item[aria-expanded='true'] > .PFX_tree-row .PFX_tree-caret {",
  "  transform: rotate(90deg);",
  "}",
  "",
  ".PFX_tree-spacer {",
  "  flex: none;",
  "  width: 16px;",
  "}",
  "",
  ".PFX_tree-icon {",
  "  flex: none;",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  ".PFX_tree-label {",
  "  flex: 1 1 auto;",
  "  min-width: 0;",
  "  overflow: hidden;",
  "  white-space: nowrap;",
  "  text-overflow: ellipsis;",
  "}",
  "",
  ".PFX_tree-count {",
  "  flex: none;",
  "  color: var(--ui-accent);",
  "  font-size: var(--PFX_fs-label);",
  "  line-height: var(--PFX_lh-label);",
  "  font-weight: 550;",
  "  font-variant-numeric: tabular-nums;",
  "}",
  "",
  ".PFX_tree-actions {",
  "  display: none;",
  "  flex: none;",
  "  align-items: center;",
  "}",
  "",
  ".PFX_tree-row:hover .PFX_tree-actions,",
  ".PFX_tree-item:focus-within > .PFX_tree-row .PFX_tree-actions {",
  "  display: inline-flex;",
  "}",
  ""
].join("\n");

// raw-css:desktop-src/styles/flows.css
var flows_default = [
  "/* AI and welcome flows: StepProgress, SuggestionGroup/Row, ApprovalCard, PathCard, PairingCode. */",
  "",
  "/* --------------------------------------------------------------- StepProgress */",
  "",
  ".PFX_steps {",
  "  display: flex;",
  "  flex-direction: column;",
  "  margin: 0;",
  "  padding: 0;",
  "  list-style: none;",
  "}",
  "",
  ".PFX_step {",
  "  position: relative;",
  "  display: grid;",
  "  grid-template-columns: 20px minmax(0, 1fr);",
  "  column-gap: 10px;",
  "  padding-bottom: 14px;",
  "}",
  "",
  ".PFX_step:last-child {",
  "  padding-bottom: 0;",
  "}",
  "",
  ".PFX_step:not(:last-child)::before {",
  "  content: '';",
  "  position: absolute;",
  "  left: 9.5px;",
  "  top: 23px;",
  "  bottom: 3px;",
  "  width: 1px;",
  "  background: var(--ui-stroke-tertiary);",
  "}",
  "",
  ".PFX_step[data-status='done']:not(:last-child)::before {",
  "  background: var(--ui-text-quaternary);",
  "}",
  "",
  ".PFX_step-icon {",
  "  display: grid;",
  "  place-items: center;",
  "  width: 20px;",
  "  height: 20px;",
  "  color: var(--ui-text-quaternary);",
  "}",
  "",
  ".PFX_step[data-status='running'] .PFX_step-icon {",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_step[data-status='done'] .PFX_step-icon {",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_step[data-status='failed'] .PFX_step-icon {",
  "  color: var(--ui-red);",
  "}",
  "",
  ".PFX_step-text {",
  "  display: flex;",
  "  flex-direction: column;",
  "  min-width: 0;",
  "  padding-top: 1px;",
  "}",
  "",
  ".PFX_step-label {",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  ".PFX_step[data-status='running'] .PFX_step-label {",
  "  color: var(--ui-text-primary);",
  "  font-weight: 550;",
  "}",
  "",
  ".PFX_step[data-status='done'] .PFX_step-label {",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_step[data-status='failed'] .PFX_step-label {",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_step-detail {",
  "  color: var(--PFX_fg3);",
  "  font-variant-numeric: tabular-nums;",
  "}",
  "",
  "/* --------------------------------------------------------------- SuggestionGroup / SuggestionRow */",
  "",
  ".PFX_sgroup {",
  "  display: flex;",
  "  flex-direction: column;",
  "  min-width: 0;",
  "  border: 1px solid var(--ui-stroke-tertiary);",
  "  border-radius: var(--PFX_r-card);",
  "  overflow: hidden;",
  "}",
  "",
  ".PFX_sgroup-head {",
  "  display: flex;",
  "  align-items: center;",
  "  flex-wrap: wrap;",
  "  gap: 6px var(--PFX_s2);",
  "  padding: 10px var(--PFX_s3);",
  "  border-bottom: 1px solid var(--ui-stroke-quaternary);",
  "  background: var(--ui-bg-quinary);",
  "}",
  "",
  ".PFX_sgroup-title {",
  "  display: flex;",
  "  align-items: baseline;",
  "  gap: var(--PFX_s2);",
  "  flex: 1 1 auto;",
  "  min-width: 0;",
  "  margin: 0;",
  "}",
  "",
  ".PFX_sgroup-meta {",
  "  color: var(--PFX_fg3);",
  "  font-weight: 450;",
  "}",
  "",
  ".PFX_sgroup-actions {",
  "  display: flex;",
  "  align-items: center;",
  "  gap: 6px;",
  "  margin-left: auto;",
  "}",
  "",
  ".PFX_srow {",
  "  display: grid;",
  "  grid-template-columns: 28px minmax(0, 1fr) auto;",
  "  align-items: center;",
  "  column-gap: 10px;",
  "  padding: 10px var(--PFX_s3);",
  "  transition:",
  "    background-color var(--PFX_dur) var(--PFX_ease),",
  "    opacity var(--PFX_dur) var(--PFX_ease);",
  "}",
  "",
  ".PFX_srow + .PFX_srow {",
  "  border-top: 1px solid var(--ui-stroke-quaternary);",
  "}",
  "",
  ".PFX_srow:hover {",
  "  background: var(--ui-row-hover-background);",
  "}",
  "",
  ".PFX_srow[data-status='rejected'] {",
  "  opacity: 0.55;",
  "}",
  "",
  ".PFX_srow[data-status='rejected'] .PFX_srow-subject {",
  "  text-decoration: line-through;",
  "  text-decoration-color: var(--ui-text-quaternary);",
  "}",
  "",
  ".PFX_srow-main {",
  "  display: flex;",
  "  flex-direction: column;",
  "  gap: 1px;",
  "  min-width: 0;",
  "}",
  "",
  ".PFX_srow-line {",
  "  display: flex;",
  "  align-items: center;",
  "  gap: 6px;",
  "  min-width: 0;",
  "  height: 22px;",
  "}",
  "",
  ".PFX_srow-subject {",
  "  min-width: 0;",
  "  overflow: hidden;",
  "  white-space: nowrap;",
  "  text-overflow: ellipsis;",
  "  font-weight: 550;",
  "}",
  "",
  ".PFX_srow-arrow {",
  "  flex: none;",
  "  color: var(--ui-text-quaternary);",
  "}",
  "",
  ".PFX_srow-reason {",
  "  height: var(--PFX_lh-label);",
  "  color: var(--PFX_fg3);",
  "  overflow: hidden;",
  "  white-space: nowrap;",
  "  text-overflow: ellipsis;",
  "}",
  "",
  ".PFX_srow-actions {",
  "  display: flex;",
  "  align-items: center;",
  "  gap: 2px;",
  "}",
  "",
  ".PFX_srow-status {",
  "  display: inline-flex;",
  "  align-items: center;",
  "  gap: 4px;",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  "/* Row with selection: checkbox · 28 avatar · title + reason. The checkbox, avatar and actions stay",
  "   centered on the height of the first two text lines (title 22 + reason 16); a reason that wraps",
  "   grows downward without moving anything. */",
  ".PFX_srow[data-selectable] {",
  "  grid-template-columns: 16px 28px minmax(0, 1fr) auto;",
  "  align-items: start;",
  "}",
  "",
  ".PFX_srow-lead {",
  "  display: grid;",
  "  place-items: center;",
  "  height: calc(22px + 1px + var(--PFX_lh-label));",
  "}",
  "",
  ".PFX_srow[data-selectable] > .PFX_srow-actions {",
  "  min-height: calc(22px + 1px + var(--PFX_lh-label));",
  "}",
  "",
  '/* Reason that justifies an action: wraps to up to 3 lines instead of cutting with "…". */',
  ".PFX_srow-reason-wrap {",
  "  display: -webkit-box;",
  "  height: auto;",
  "  white-space: normal;",
  "  overflow-wrap: anywhere;",
  "  -webkit-box-orient: vertical;",
  "  -webkit-line-clamp: 3;",
  "  line-clamp: 3;",
  "}",
  "",
  "/* --------------------------------------------------------------- ApprovalCard */",
  "",
  ".PFX_approval {",
  "  display: flex;",
  "  flex-direction: column;",
  "  gap: var(--PFX_s3);",
  "  min-width: 0;",
  "  padding: var(--PFX_s4);",
  "  border: 1px solid var(--ui-stroke-secondary);",
  "  border-radius: var(--PFX_r-card);",
  "  background: var(--ui-bg-quinary);",
  "}",
  "",
  ".PFX_approval-head {",
  "  display: flex;",
  "  align-items: flex-start;",
  "  gap: 10px;",
  "}",
  "",
  ".PFX_approval-icon {",
  "  display: grid;",
  "  flex: none;",
  "  place-items: center;",
  "  width: 28px;",
  "  height: 28px;",
  "  border-radius: 8px;",
  "  background: var(--ui-bg-tertiary);",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_approval-titles {",
  "  display: flex;",
  "  flex-direction: column;",
  "  gap: 2px;",
  "  min-width: 0;",
  "}",
  "",
  ".PFX_approval-title {",
  "  margin: 0;",
  "}",
  "",
  ".PFX_approval-desc {",
  "  margin: 0;",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_approval-label {",
  "  margin: 0;",
  "  color: var(--PFX_fg3);",
  "  letter-spacing: 0.04em;",
  "}",
  "",
  ".PFX_approval-effects {",
  "  display: flex;",
  "  flex-direction: column;",
  "  gap: 4px;",
  "  margin: 0;",
  "  padding: 0;",
  "  list-style: none;",
  "  counter-reset: PFX_effect;",
  "}",
  "",
  ".PFX_approval-effects > li {",
  "  display: grid;",
  "  grid-template-columns: 22px minmax(0, 1fr);",
  "  counter-increment: PFX_effect;",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_approval-effects > li::before {",
  "  content: counter(PFX_effect);",
  "  color: var(--ui-text-quaternary);",
  "  font-variant-numeric: tabular-nums;",
  "}",
  "",
  ".PFX_approval-foot {",
  "  display: flex;",
  "  align-items: center;",
  "  justify-content: flex-end;",
  "  flex-wrap: wrap;",
  "  gap: var(--PFX_s2);",
  "  padding-top: var(--PFX_s1);",
  "}",
  "",
  "/* --------------------------------------------------------------- Hero (welcome opening) */",
  "",
  ".PFX_hero {",
  "  display: flex;",
  "  flex-direction: column;",
  "  align-items: center;",
  "  gap: var(--PFX_s2);",
  "  padding: var(--PFX_s4) 0 var(--PFX_s2);",
  "  text-align: center;",
  "}",
  "",
  ".PFX_hero-mark {",
  "  display: grid;",
  "  place-items: center;",
  "  width: 48px;",
  "  height: 48px;",
  "  margin-bottom: var(--PFX_s2);",
  "  border-radius: 14px;",
  "  background: var(--ui-bg-quinary);",
  "  box-shadow: inset 0 0 0 1px var(--ui-stroke-secondary);",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_hero-title {",
  "  margin: 0;",
  "  color: var(--ui-text-primary);",
  "  text-wrap: balance;",
  "}",
  "",
  ".PFX_hero-tagline {",
  "  margin: 0;",
  "  color: var(--ui-text-secondary);",
  "  text-wrap: balance;",
  "}",
  "",
  ".PFX_hero-desc {",
  "  max-width: 52ch;",
  "  margin: var(--PFX_s1) 0 0;",
  "  color: var(--PFX_fg3);",
  "  text-wrap: pretty;",
  "}",
  "",
  "/* --------------------------------------------------------------- PathCard (the 3 paths of the empty state) */",
  "",
  ".PFX_paths {",
  "  display: grid;",
  "  /* 3 paths side by side or stacked: never 2 + 1 orphan */",
  "  grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));",
  "  gap: var(--PFX_s4);",
  "  min-width: 0;",
  "}",
  "",
  ".PFX_path {",
  "  display: flex;",
  "  flex-direction: column;",
  "  gap: var(--PFX_s3);",
  "  min-width: 0;",
  "  height: 100%;",
  "  padding: var(--PFX_s5) var(--PFX_s5) var(--PFX_s4);",
  "  border: 1px solid var(--ui-stroke-tertiary);",
  "  border-radius: var(--PFX_r-card);",
  "  transition:",
  "    transform var(--PFX_dur) var(--PFX_ease),",
  "    border-color var(--PFX_dur) var(--PFX_ease),",
  "    background-color var(--PFX_dur) var(--PFX_ease);",
  "}",
  "",
  ".PFX_path:hover,",
  ".PFX_path:focus-within {",
  "  transform: translateY(-1px);",
  "  border-color: var(--ui-stroke-secondary);",
  "  background: var(--ui-bg-quinary);",
  "}",
  "",
  "/* the recommended one: stronger line, slightly raised surface and visible label */",
  ".PFX_path[data-primary='true'] {",
  "  border-color: color-mix(in srgb, var(--ui-accent) 36%, var(--ui-stroke-tertiary));",
  "  background: var(--ui-bg-quinary);",
  "}",
  "",
  ".PFX_path-top {",
  "  display: flex;",
  "  align-items: flex-start;",
  "  justify-content: space-between;",
  "  gap: var(--PFX_s2);",
  "  min-height: 40px;",
  "}",
  "",
  ".PFX_path-icon {",
  "  display: grid;",
  "  flex: none;",
  "  place-items: center;",
  "  width: 40px;",
  "  height: 40px;",
  "  border-radius: 10px;",
  "  background: var(--ui-bg-quaternary);",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_path[data-primary='true'] .PFX_path-icon {",
  "  background: var(--PFX_accent-soft);",
  "  color: var(--ui-accent);",
  "}",
  "",
  ".PFX_path-badge {",
  "  display: inline-flex;",
  "  align-items: center;",
  "  gap: 4px;",
  "  height: 22px;",
  "  padding: 0 8px;",
  "  border-radius: 999px;",
  "  box-shadow: inset 0 0 0 1px var(--ui-stroke-secondary);",
  "  background: var(--ui-bg-elevated);",
  "  color: var(--ui-text-primary);",
  "  white-space: nowrap;",
  "}",
  "",
  ".PFX_path-badge-icon {",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_path-title {",
  "  margin: var(--PFX_s1) 0 0;",
  "}",
  "",
  ".PFX_path-desc {",
  "  flex: 1 1 auto;",
  "  margin: 0;",
  "  min-height: calc(2 * var(--PFX_lh-body));",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_path-foot {",
  "  display: flex;",
  "  align-items: center;",
  "  justify-content: space-between;",
  "  gap: var(--PFX_s2);",
  "  min-height: 28px;",
  "  flex-wrap: wrap;",
  "  row-gap: var(--PFX_s2);",
  "}",
  "",
  ".PFX_path-hint {",
  "  color: var(--PFX_fg3);",
  "  white-space: nowrap;",
  "}",
  "",
  "/* --------------------------------------------------------------- PairingCode */",
  "",
  ".PFX_pairing {",
  "  display: flex;",
  "  flex-direction: column;",
  "  align-items: center;",
  "  gap: var(--PFX_s3);",
  "  /* a size container has no width of its own: inside a centering parent, it would shrink",
  "     until the label broke word by word */",
  "  width: 100%;",
  "  align-self: stretch;",
  "  min-width: 0;",
  "  container-type: inline-size;",
  "  container-name: PFX_pairing;",
  "}",
  "",
  ".PFX_pairing-label {",
  "  margin: 0;",
  "  color: var(--PFX_fg3);",
  "  letter-spacing: 0.04em;",
  "}",
  "",
  ".PFX_code {",
  "  display: flex;",
  "  align-items: center;",
  "  gap: 6px;",
  "}",
  "",
  ".PFX_code-digit {",
  "  display: grid;",
  "  place-items: center;",
  "  width: 44px;",
  "  height: 56px;",
  "  border: 1px solid var(--ui-stroke-secondary);",
  "  border-radius: 8px;",
  "  background: var(--ui-bg-quinary);",
  "  color: var(--ui-text-primary);",
  "  font-family: var(--dt-font-mono);",
  "  font-size: 28px;",
  "  line-height: 1;",
  "  font-weight: 600;",
  "  font-variant-numeric: tabular-nums;",
  "  transition: opacity var(--PFX_dur) var(--PFX_ease);",
  "}",
  "",
  ".PFX_code-sep {",
  "  width: 10px;",
  "  height: 2px;",
  "  border-radius: 2px;",
  "  background: var(--ui-text-quaternary);",
  "}",
  "",
  ".PFX_pairing[data-expired='true'] .PFX_code-digit {",
  "  opacity: 0.35;",
  "}",
  "",
  ".PFX_pairing-foot {",
  "  display: flex;",
  "  align-items: center;",
  "  justify-content: center;",
  "  flex-wrap: wrap;",
  "  gap: var(--PFX_s1) var(--PFX_s2);",
  "  max-width: 100%;",
  "  color: var(--PFX_fg3);",
  "  font-variant-numeric: tabular-nums;",
  "}",
  "",
  ".PFX_pstep .PFX_pairing-foot {",
  "  justify-content: flex-start;",
  "}",
  "",
  ".PFX_pairing-bar {",
  "  flex: 0 1 180px;",
  "  min-width: 64px;",
  "  height: 2px;",
  "  border-radius: 2px;",
  "  background: var(--ui-stroke-tertiary);",
  "  overflow: hidden;",
  "}",
  "",
  ".PFX_pairing-bar-fill {",
  "  display: block;",
  "  height: 100%;",
  "  width: var(--PFX_left, 100%);",
  "  background: var(--ui-text-tertiary);",
  "  transition: width 1s linear;",
  "}",
  "",
  "/* --------------------------------------------------------------- PairingSteps (1 open · 2 code · 3 done) */",
  "",
  ".PFX_psteps {",
  "  display: flex;",
  "  flex-direction: column;",
  "  min-width: 0;",
  "  margin: 0;",
  "  padding: var(--PFX_s5);",
  "  list-style: none;",
  "  border: 1px solid var(--ui-stroke-tertiary);",
  "  border-radius: var(--PFX_r-card);",
  "}",
  "",
  ".PFX_pstep {",
  "  position: relative;",
  "  display: grid;",
  "  grid-template-columns: 28px minmax(0, 1fr);",
  "  column-gap: var(--PFX_s4);",
  "  padding-bottom: var(--PFX_s5);",
  "}",
  "",
  ".PFX_pstep:last-child {",
  "  padding-bottom: 0;",
  "}",
  "",
  "/* track between the numbers */",
  ".PFX_pstep:not(:last-child)::before {",
  "  content: '';",
  "  position: absolute;",
  "  left: 13.5px;",
  "  top: 32px;",
  "  bottom: 4px;",
  "  width: 1px;",
  "  background: var(--ui-stroke-tertiary);",
  "}",
  "",
  ".PFX_pstep-num {",
  "  display: grid;",
  "  place-items: center;",
  "  width: 28px;",
  "  height: 28px;",
  "  border-radius: 999px;",
  "  box-shadow: inset 0 0 0 1px var(--ui-stroke-secondary);",
  "  color: var(--ui-text-secondary);",
  "  font-size: var(--PFX_fs-label);",
  "  line-height: 1;",
  "  font-weight: 600;",
  "  transition:",
  "    background-color var(--PFX_dur-slow) var(--PFX_ease),",
  "    color var(--PFX_dur-slow) var(--PFX_ease);",
  "}",
  "",
  ".PFX_pstep[data-state='current'] .PFX_pstep-num {",
  "  background: var(--ui-bg-quaternary);",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_pstep[data-state='done'] .PFX_pstep-num {",
  "  background: var(--ui-text-primary);",
  "  box-shadow: none;",
  "  color: var(--ui-bg-editor);",
  "  animation: PFX_pop var(--PFX_dur-slow) var(--PFX_ease) both;",
  "}",
  "",
  ".PFX_pstep-body {",
  "  display: flex;",
  "  flex-direction: column;",
  "  align-items: flex-start;",
  "  gap: var(--PFX_s2);",
  "  min-width: 0;",
  "  padding-top: 4px;",
  "}",
  "",
  ".PFX_pstep-title {",
  "  margin: 0;",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_pstep[data-state='todo'] .PFX_pstep-title {",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_pstep-hint {",
  "  margin: 0;",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  "/* the code stays left-aligned, next to the step */",
  ".PFX_pstep .PFX_pairing {",
  "  align-items: flex-start;",
  "}",
  "",
  ".PFX_pstep-status {",
  "  display: grid;",
  "  grid-template-columns: auto minmax(0, 1fr);",
  "  align-items: center;",
  "  column-gap: var(--PFX_s2);",
  "  row-gap: 2px;",
  "  min-width: 0;",
  "}",
  "",
  ".PFX_pstep-status .PFX_pstep-hint {",
  "  grid-column: 2;",
  "}",
  "",
  ".PFX_pstep-status-text {",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_pstep-dots {",
  "  display: inline-flex;",
  "  align-items: center;",
  "  gap: 3px;",
  "  width: 22px;",
  "  height: 18px;",
  "}",
  "",
  ".PFX_pstep-dot {",
  "  width: 5px;",
  "  height: 5px;",
  "  border-radius: 999px;",
  "  background: var(--ui-text-secondary);",
  "  animation: PFX_breathe 1.2s ease-in-out infinite;",
  "}",
  "",
  ".PFX_pstep-dot:nth-child(2) {",
  "  animation-delay: 160ms;",
  "}",
  "",
  ".PFX_pstep-dot:nth-child(3) {",
  "  animation-delay: 320ms;",
  "}",
  "",
  ".PFX_pstep-ok {",
  "  display: grid;",
  "  place-items: center;",
  "  width: 22px;",
  "  height: 22px;",
  "  border-radius: 999px;",
  "  background: color-mix(in srgb, var(--ui-green) 16%, transparent);",
  "  color: var(--ui-green);",
  "  animation: PFX_pop var(--PFX_dur-slow) var(--PFX_ease) both;",
  "}",
  "",
  "@container PFX_page (max-width: 480px) {",
  "  .PFX_psteps {",
  "    padding: var(--PFX_s4) var(--PFX_s3);",
  "  }",
  "",
  "  .PFX_pstep {",
  "    column-gap: var(--PFX_s3);",
  "  }",
  "}",
  "",
  "@container PFX_pairing (max-width: 360px) {",
  "  .PFX_code {",
  "    gap: 4px;",
  "  }",
  "",
  "  .PFX_code-digit {",
  "    width: 34px;",
  "    height: 46px;",
  "    font-size: 22px;",
  "  }",
  "",
  "  .PFX_code-sep {",
  "    width: 6px;",
  "  }",
  "}",
  ""
].join("\n");

// raw-css:desktop-src/styles/layout.css
var layout_default = [
  "/* Structure: Page, Section, Toolbar, Banner, Stack, Grid. Responsive to the container (the page and the panes",
  "   go from ~260 px to ~1800 px and resize all the time), never to the window. */",
  "",
  "/* --------------------------------------------------------------- Page */",
  "",
  ".PFX_page {",
  "  display: flex;",
  "  flex-direction: column;",
  "  height: 100%;",
  "  min-height: 0;",
  "  min-width: 0;",
  "  color: var(--ui-text-primary);",
  "  container-type: inline-size;",
  "  container-name: PFX_page;",
  "}",
  "",
  ".PFX_page > * {",
  "  --PFX_pad: var(--PFX_s5);",
  "}",
  "",
  ".PFX_page-head {",
  "  display: flex;",
  "  align-items: flex-end;",
  "  gap: var(--PFX_s3);",
  "  padding: 20px var(--PFX_pad) var(--PFX_s3);",
  "}",
  "",
  ".PFX_page-titles {",
  "  flex: 1 1 auto;",
  "  min-width: 0;",
  "}",
  "",
  ".PFX_page-title {",
  "  margin: 0;",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_page-sub {",
  "  margin: 2px 0 0;",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  ".PFX_page-actions {",
  "  display: flex;",
  "  flex: none;",
  "  align-items: center;",
  "  gap: 6px;",
  "}",
  "",
  ".PFX_page-toolbar {",
  "  padding: 0 var(--PFX_pad);",
  "}",
  "",
  ".PFX_page-banner {",
  "  padding: var(--PFX_s2) var(--PFX_pad) 0;",
  "}",
  "",
  ".PFX_page-body {",
  "  flex: 1 1 auto;",
  "  min-height: 0;",
  "  overflow: auto;",
  "  overscroll-behavior: contain;",
  "}",
  "",
  ".PFX_page-inner {",
  "  display: flex;",
  "  flex-direction: column;",
  "  gap: var(--PFX_s5);",
  "  padding: var(--PFX_s4) var(--PFX_pad) var(--PFX_s6);",
  "}",
  "",
  "/* centered composition (welcome): comfortable max width and more room between blocks */",
  ".PFX_page[data-narrow='true'] .PFX_page-inner {",
  "  width: 100%;",
  "  max-width: 920px;",
  "  margin-inline: auto;",
  "  gap: var(--PFX_s6);",
  "  padding-top: var(--PFX_s6);",
  "  padding-bottom: calc(2 * var(--PFX_s6));",
  "}",
  "",
  "@container PFX_page (max-width: 560px) {",
  "  .PFX_page > * {",
  "    --PFX_pad: var(--PFX_s3);",
  "  }",
  "",
  "  .PFX_page-head {",
  "    flex-wrap: wrap;",
  "    align-items: center;",
  "    padding-top: 14px;",
  "  }",
  "",
  "  .PFX_page-actions {",
  "    flex-wrap: wrap;",
  "  }",
  "}",
  "",
  "/* --------------------------------------------------------------- Section */",
  "",
  ".PFX_section {",
  "  display: flex;",
  "  flex-direction: column;",
  "  gap: var(--PFX_s3);",
  "  min-width: 0;",
  "}",
  "",
  ".PFX_section-head {",
  "  display: flex;",
  "  align-items: baseline;",
  "  gap: var(--PFX_s2);",
  "  min-width: 0;",
  "}",
  "",
  ".PFX_section-titles {",
  "  display: flex;",
  "  flex-direction: column;",
  "  gap: 2px;",
  "  min-width: 0;",
  "  flex: 1 1 auto;",
  "}",
  "",
  ".PFX_section-title {",
  "  display: flex;",
  "  align-items: baseline;",
  "  gap: var(--PFX_s2);",
  "  margin: 0;",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_section-count {",
  "  color: var(--PFX_fg3);",
  "  font-weight: 450;",
  "}",
  "",
  ".PFX_section-desc {",
  "  margin: 0;",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  ".PFX_section-actions {",
  "  display: flex;",
  "  flex: none;",
  "  align-items: center;",
  "  gap: 6px;",
  "}",
  "",
  "/* --------------------------------------------------------------- Toolbar */",
  "",
  ".PFX_toolbar {",
  "  display: flex;",
  "  align-items: center;",
  "  flex-wrap: wrap;",
  "  gap: var(--PFX_s2) var(--PFX_s3);",
  "  min-height: 36px;",
  "  min-width: 0;",
  "}",
  "",
  ".PFX_toolbar-start {",
  "  display: flex;",
  "  align-items: center;",
  "  flex-wrap: wrap;",
  "  gap: var(--PFX_s2);",
  "  flex: 1 1 auto;",
  "  min-width: 0;",
  "}",
  "",
  ".PFX_toolbar-end {",
  "  display: flex;",
  "  align-items: center;",
  "  justify-content: flex-end;",
  "  flex-wrap: wrap;",
  "  gap: var(--PFX_s2);",
  "  flex: 0 1 auto;",
  "  min-width: 0;",
  "  margin-left: auto;",
  "}",
  "",
  "/* --------------------------------------------------------------- Banner (info / warning / error; strip at the top) */",
  "",
  ".PFX_banner {",
  "  display: flex;",
  "  align-items: flex-start;",
  "  gap: 10px;",
  "  padding: 10px var(--PFX_s3);",
  "  border: 1px solid var(--ui-stroke-tertiary);",
  "  border-radius: var(--PFX_r-control);",
  "  background: var(--ui-bg-quinary);",
  "  color: var(--ui-text-secondary);",
  "  animation: PFX_fade-in 180ms var(--PFX_ease);",
  "}",
  "",
  ".PFX_banner-icon {",
  "  display: inline-flex;",
  "  flex: none;",
  "  height: var(--PFX_lh-body);",
  "  align-items: center;",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  ".PFX_banner[data-tone='warning'] .PFX_banner-icon {",
  "  color: var(--ui-yellow);",
  "}",
  "",
  ".PFX_banner[data-tone='error'] {",
  "  border-color: color-mix(in srgb, var(--ui-red) 28%, var(--ui-stroke-tertiary));",
  "}",
  "",
  ".PFX_banner[data-tone='error'] .PFX_banner-icon {",
  "  color: var(--ui-red);",
  "}",
  "",
  ".PFX_banner-text {",
  "  flex: 1 1 auto;",
  "  min-width: 0;",
  "}",
  "",
  ".PFX_banner-title {",
  "  color: var(--ui-text-primary);",
  "  font-weight: 550;",
  "  margin-right: 6px;",
  "}",
  "",
  ".PFX_banner-actions {",
  "  display: flex;",
  "  flex: none;",
  "  align-items: center;",
  "  gap: var(--PFX_s1);",
  "  margin: -2px -4px -2px 0;",
  "}",
  "",
  "/* inside the page strip: subtle, flush with the edges */",
  ".PFX_page-banner > .PFX_banner {",
  "  padding: 7px var(--PFX_s3);",
  "}",
  "",
  "/* --------------------------------------------------------------- Stack */",
  "",
  ".PFX_stack {",
  "  display: flex;",
  "  flex-direction: column;",
  "  gap: var(--PFX_s2);",
  "  min-width: 0;",
  "}",
  "",
  ".PFX_stack[data-direction='row'] {",
  "  flex-direction: row;",
  "  align-items: center;",
  "}",
  "",
  ".PFX_stack[data-wrap='true'] {",
  "  flex-wrap: wrap;",
  "}",
  "",
  ".PFX_stack[data-align='start'] {",
  "  align-items: flex-start;",
  "}",
  "",
  ".PFX_stack[data-align='center'] {",
  "  align-items: center;",
  "}",
  "",
  ".PFX_stack[data-align='end'] {",
  "  align-items: flex-end;",
  "}",
  "",
  ".PFX_stack[data-align='stretch'] {",
  "  align-items: stretch;",
  "}",
  "",
  ".PFX_stack[data-justify='between'] {",
  "  justify-content: space-between;",
  "}",
  "",
  ".PFX_stack[data-justify='end'] {",
  "  justify-content: flex-end;",
  "}",
  "",
  ".PFX_stack[data-gap='0'] {",
  "  gap: 0;",
  "}",
  "",
  ".PFX_stack[data-gap='1'] {",
  "  gap: var(--PFX_s1);",
  "}",
  "",
  ".PFX_stack[data-gap='3'] {",
  "  gap: var(--PFX_s3);",
  "}",
  "",
  ".PFX_stack[data-gap='4'] {",
  "  gap: var(--PFX_s4);",
  "}",
  "",
  ".PFX_stack[data-gap='5'] {",
  "  gap: var(--PFX_s5);",
  "}",
  "",
  ".PFX_stack[data-gap='6'] {",
  "  gap: var(--PFX_s6);",
  "}",
  "",
  "/* --------------------------------------------------------------- Grid (auto-fill + 3 densities) */",
  "",
  ".PFX_grid {",
  "  --PFX_col: 264px;",
  "  display: grid;",
  "  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--PFX_col)), 1fr));",
  "  gap: var(--PFX_s5) var(--PFX_s3);",
  "  min-width: 0;",
  "  outline: none;",
  "}",
  "",
  ".PFX_grid[data-density='compact'] {",
  "  --PFX_col: 184px;",
  "  gap: var(--PFX_s4) var(--PFX_s2);",
  "}",
  "",
  ".PFX_grid[data-density='list'] {",
  "  grid-template-columns: minmax(0, 1fr);",
  "  gap: 0;",
  "}",
  "",
  "/* slight cascade on load (only rows that mount; archiving an item does not re-animate the others) */",
  ".PFX_grid-row {",
  "  min-width: 0;",
  "  animation: PFX_rise var(--PFX_dur-slow) var(--PFX_ease) both;",
  "  animation-delay: calc(min(var(--PFX_i, 0), 14) * var(--PFX_stagger));",
  "}",
  "",
  ".PFX_grid-cell {",
  "  height: 100%;",
  "  min-width: 0;",
  "  border-radius: var(--PFX_r-card);",
  "  outline: none;",
  "}",
  "",
  ".PFX_grid-cell:focus-visible {",
  "  outline: 2px solid var(--PFX_ring);",
  "  outline-offset: 2px;",
  "}",
  "",
  ".PFX_grid[data-density='list'] .PFX_grid-cell:focus-visible {",
  "  outline-offset: -2px;",
  "}",
  ""
].join("\n");

// raw-css:desktop-src/styles/misc.css
var misc_default = [
  "/* Small pieces and states: Why, Stat, Count, Dot, EmptyView/ErrorView/LoadingState, RpcUnavailableNotice, DialogFrame. */",
  "",
  '/* --------------------------------------------------------------- Why ("why is this here") */',
  "",
  ".PFX_why {",
  "  display: flex;",
  "  align-items: center;",
  "  gap: 5px;",
  "  min-width: 0;",
  "  min-height: var(--PFX_lh-label);",
  "  margin: 0;",
  "  color: var(--PFX_fg3);",
  "  white-space: nowrap;",
  "}",
  "",
  ".PFX_why-icon {",
  "  flex: none;",
  "  color: var(--ui-text-quaternary);",
  "}",
  "",
  ".PFX_why-label {",
  "  flex: 0 1 auto;",
  "  min-width: 0;",
  "  overflow: hidden;",
  "  text-overflow: ellipsis;",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_why-detail {",
  "  flex: 0 10 auto;",
  "  min-width: 0;",
  "  overflow: hidden;",
  "  text-overflow: ellipsis;",
  "}",
  "",
  "/* --------------------------------------------------------------- Stat / Count / Dot */",
  "",
  ".PFX_stat {",
  "  display: flex;",
  "  flex-direction: column;",
  "  gap: 2px;",
  "  min-width: 0;",
  "}",
  "",
  ".PFX_stat-label {",
  "  color: var(--PFX_fg3);",
  "  letter-spacing: 0.04em;",
  "}",
  "",
  ".PFX_stat-value {",
  "  color: var(--ui-text-primary);",
  "  font-variant-numeric: tabular-nums;",
  "}",
  "",
  ".PFX_stat-hint {",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  ".PFX_count {",
  "  display: inline-flex;",
  "  overflow: hidden;",
  "  font-variant-numeric: tabular-nums;",
  "  vertical-align: bottom;",
  "}",
  "",
  ".PFX_count[data-tone='new'] {",
  "  color: var(--ui-accent);",
  "  font-weight: 550;",
  "}",
  "",
  ".PFX_count-value {",
  "  display: inline-block;",
  "  animation: PFX_count-in 180ms var(--PFX_ease);",
  "}",
  "",
  ".PFX_dot {",
  "  display: inline-block;",
  "  flex: none;",
  "  width: 6px;",
  "  height: 6px;",
  "  border-radius: 999px;",
  "  background: var(--ui-text-quaternary);",
  "}",
  "",
  ".PFX_dot[data-tone='new'] {",
  "  background: var(--ui-accent);",
  "}",
  "",
  ".PFX_dot[data-tone='success'] {",
  "  background: var(--ui-green);",
  "}",
  "",
  ".PFX_dot[data-tone='warning'] {",
  "  background: var(--ui-yellow);",
  "}",
  "",
  ".PFX_dot[data-tone='error'] {",
  "  background: var(--ui-red);",
  "}",
  "",
  "/* --------------------------------------------------------------- States (empty, error, loading, no RPC) */",
  "",
  ".PFX_state {",
  "  display: flex;",
  "  flex-direction: column;",
  "  align-items: center;",
  "  justify-content: center;",
  "  gap: var(--PFX_s3);",
  "  min-height: 200px;",
  "  padding: var(--PFX_s6) var(--PFX_s4);",
  "  text-align: center;",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_state[data-compact='true'] {",
  "  min-height: 0;",
  "  padding: var(--PFX_s4);",
  "}",
  "",
  ".PFX_state-icon {",
  "  display: grid;",
  "  place-items: center;",
  "  width: 44px;",
  "  height: 44px;",
  "  border-radius: 999px;",
  "  background: var(--ui-bg-tertiary);",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  ".PFX_state[data-tone='error'] .PFX_state-icon {",
  "  color: var(--ui-red);",
  "}",
  "",
  "/* title + text of the state: kit markup (not the SDK's EmptyState/ErrorState, see components/states.tsx) */",
  ".PFX_state-copy {",
  "  display: flex;",
  "  flex-direction: column;",
  "  align-items: center;",
  "  gap: var(--PFX_s1);",
  "  min-width: 0;",
  "  max-width: 44ch;",
  "}",
  "",
  ".PFX_state-title {",
  "  margin: 0;",
  "  font-size: var(--PFX_fs-head);",
  "  line-height: var(--PFX_lh-head);",
  "  font-weight: 600;",
  "  color: var(--ui-text-primary);",
  "  text-wrap: balance;",
  "}",
  "",
  ".PFX_state[data-compact='true'] .PFX_state-title {",
  "  font-size: var(--PFX_fs-body);",
  "  line-height: var(--PFX_lh-body);",
  "}",
  "",
  ".PFX_state-desc {",
  "  margin: 0;",
  "  font-size: var(--PFX_fs-label);",
  "  line-height: var(--PFX_lh-label);",
  "  color: var(--PFX_fg3);",
  "  text-wrap: pretty;",
  "}",
  "",
  ".PFX_state-actions {",
  "  display: flex;",
  "  align-items: center;",
  "  justify-content: center;",
  "  flex-wrap: wrap;",
  "  gap: var(--PFX_s2);",
  "}",
  "",
  "/* --------------------------------------------------------------- DialogFrame */",
  "",
  ".PFX_dialog {",
  "  width: min(100% - 32px, 560px);",
  "  max-width: none;",
  "}",
  "",
  ".PFX_dialog[data-size='sm'] {",
  "  width: min(100% - 32px, 420px);",
  "}",
  "",
  ".PFX_dialog[data-size='lg'] {",
  "  width: min(100% - 32px, 760px);",
  "}",
  "",
  ".PFX_dialog[data-size='xl'] {",
  "  width: min(100% - 32px, 980px);",
  "}",
  "",
  "/* the body scrolls inside; header and footer (buttons) stay fixed. The edge shadow says there is more. */",
  ".PFX_dialog-scroll {",
  "  position: relative;",
  "  min-width: 0;",
  "  min-height: 0;",
  "  margin: 0 calc(-1 * var(--PFX_s2));",
  "}",
  "",
  ".PFX_dialog-scroll::before,",
  ".PFX_dialog-scroll::after {",
  "  content: '';",
  "  position: absolute;",
  "  left: 0;",
  "  right: 0;",
  "  z-index: 2;",
  "  height: 14px;",
  "  pointer-events: none;",
  "  opacity: 0;",
  "  transition: opacity var(--PFX_dur) var(--PFX_ease);",
  "}",
  "",
  ".PFX_dialog-scroll::before {",
  "  top: 0;",
  "  border-top: 1px solid var(--ui-stroke-tertiary);",
  "  background: linear-gradient(to bottom, color-mix(in srgb, var(--ui-base) 9%, transparent), transparent);",
  "}",
  "",
  ".PFX_dialog-scroll::after {",
  "  bottom: 0;",
  "  border-bottom: 1px solid var(--ui-stroke-tertiary);",
  "  background: linear-gradient(to top, color-mix(in srgb, var(--ui-base) 9%, transparent), transparent);",
  "}",
  "",
  ".PFX_dialog-scroll[data-overflow='top']::before,",
  ".PFX_dialog-scroll[data-overflow='both']::before,",
  ".PFX_dialog-scroll[data-overflow='bottom']::after,",
  ".PFX_dialog-scroll[data-overflow='both']::after {",
  "  opacity: 1;",
  "}",
  "",
  ".PFX_dialog-body {",
  "  display: flex;",
  "  flex-direction: column;",
  "  gap: var(--PFX_s4);",
  "  min-width: 0;",
  "  max-height: min(62vh, 620px);",
  "  padding: var(--PFX_s1) var(--PFX_s2) var(--PFX_s2);",
  "  overflow: auto;",
  "  overscroll-behavior: contain;",
  "  container-type: inline-size;",
  "  container-name: PFX_dialog;",
  "}",
  "",
  "/* Pane's own header when the app zone does not show the tab strip (pane alone in the zone).",
  "   Same typography as the app's pane strips/labels: small uppercase, spaced, secondary color; the total of",
  `   new ones like the app label's "meta" (no uppercase, tabular figures, text tone — the accent stays on the`,
  "   tree counters, right below). Never a big title. */",
  ".PFX_pane-head {",
  "  display: flex;",
  "  flex: none;",
  "  align-items: center;",
  "  gap: var(--PFX_s2);",
  "  min-width: 0;",
  "  padding: var(--PFX_s3) var(--PFX_pad) var(--PFX_s1);",
  "  font-size: 0.64rem;",
  "  font-weight: 600;",
  "  line-height: 1;",
  "  letter-spacing: 0.16em;",
  "  text-transform: uppercase;",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_pane-head-title {",
  "  min-width: 0;",
  "  overflow: hidden;",
  "  text-overflow: ellipsis;",
  "  white-space: nowrap;",
  "}",
  "",
  ".PFX_pane-head-count {",
  "  flex: none;",
  "  font-size: 0.6875rem;",
  "  font-weight: 500;",
  "  letter-spacing: normal;",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  "/* Opens the page in the center. Pushed to the right edge of the header; reads as a quiet link until hovered. */",
  ".PFX_pane-head-open {",
  "  display: inline-flex;",
  "  flex: none;",
  "  align-items: center;",
  "  gap: 5px;",
  "  margin-left: auto;",
  "  padding: 4px 8px;",
  "  border: 1px solid var(--ui-stroke-secondary);",
  "  border-radius: 6px;",
  "  background: transparent;",
  "  font: inherit;",
  "  font-size: 0.6875rem;",
  "  font-weight: 500;",
  "  letter-spacing: normal;",
  "  text-transform: none;",
  "  color: var(--ui-text-secondary);",
  "  cursor: pointer;",
  "}",
  "",
  ".PFX_pane-head-open:hover,",
  ".PFX_pane-head-open:focus-visible {",
  "  border-color: var(--ui-accent);",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_pane-head-open:focus-visible {",
  "  outline: 2px solid var(--ui-accent);",
  "  outline-offset: 1px;",
  "}",
  ""
].join("\n");

// raw-css:desktop-src/styles/nav.css
var nav_default = [
  "/* Navigation: TabBar (over the SDK's Tabs*), ModeSwitch (the SDK's SegmentedControl), FilterBar (the SDK's SearchField).",
  "   The SDK look is adjusted only through the plugin's classes (unlayered CSS beats the host's utilities). */",
  "",
  "/* --------------------------------------------------------------- TabBar */",
  "",
  ".PFX_tabbar {",
  "  display: flex;",
  "  align-items: flex-end;",
  "  gap: var(--PFX_s1);",
  "  min-width: 0;",
  "  border-bottom: 1px solid var(--ui-stroke-tertiary);",
  "  container-type: inline-size;",
  "  container-name: PFX_tabbar;",
  "}",
  "",
  ".PFX_tabbar-root {",
  "  display: block;",
  "  flex: 1 1 auto;",
  "  min-width: 0;",
  "  gap: 0;",
  "}",
  "",
  ".PFX_tabbar-scroll {",
  "  position: relative;",
  "  min-width: 0;",
  "  overflow-x: auto;",
  "  overflow-y: hidden;",
  "  scrollbar-width: none;",
  "  overscroll-behavior-x: contain;",
  "}",
  "",
  ".PFX_tabbar-scroll::-webkit-scrollbar {",
  "  display: none;",
  "}",
  "",
  "/* edge shadow: the list fades out where there are still tabs to scroll */",
  ".PFX_tabbar[data-overflow='end'] .PFX_tabbar-scroll {",
  "  mask-image: linear-gradient(to right, currentColor calc(100% - 32px), transparent);",
  "}",
  "",
  ".PFX_tabbar[data-overflow='start'] .PFX_tabbar-scroll {",
  "  mask-image: linear-gradient(to right, transparent, currentColor 32px);",
  "}",
  "",
  ".PFX_tabbar[data-overflow='both'] .PFX_tabbar-scroll {",
  "  mask-image: linear-gradient(to right, transparent, currentColor 32px, currentColor calc(100% - 32px), transparent);",
  "}",
  "",
  ".PFX_tabbar-list {",
  "  display: flex;",
  "  width: max-content;",
  "  height: auto;",
  "  align-items: stretch;",
  "  justify-content: flex-start;",
  "  gap: 2px;",
  "  padding: 0;",
  "  border-radius: 0;",
  "  background: transparent;",
  "}",
  "",
  ".PFX_tab {",
  "  position: relative;",
  "  display: inline-flex;",
  "  align-items: center;",
  "  gap: 6px;",
  "  height: auto;",
  "  padding: 8px 10px 10px;",
  "  border-radius: 0;",
  "  background: transparent;",
  "  box-shadow: none;",
  "  color: var(--PFX_fg3);",
  "  font-size: var(--PFX_fs-body);",
  "  line-height: var(--PFX_lh-body);",
  "  font-weight: 500;",
  "  white-space: nowrap;",
  "  cursor: pointer;",
  "  transition: color var(--PFX_dur) var(--PFX_ease);",
  "}",
  "",
  ".PFX_tab:hover {",
  "  color: var(--ui-text-secondary);",
  "  background: transparent;",
  "}",
  "",
  ".PFX_tab[data-state='active'],",
  ".PFX_tab[aria-selected='true'] {",
  "  color: var(--ui-text-primary);",
  "  background: transparent;",
  "  box-shadow: none;",
  "}",
  "",
  ".PFX_tab::after {",
  "  content: '';",
  "  position: absolute;",
  "  left: 10px;",
  "  right: 10px;",
  "  bottom: -1px;",
  "  height: 2px;",
  "  border-radius: 2px;",
  "  background: var(--ui-text-primary);",
  "  transform: scaleX(0);",
  "  transition: transform var(--PFX_dur) var(--PFX_ease);",
  "}",
  "",
  ".PFX_tab[data-state='active']::after,",
  ".PFX_tab[aria-selected='true']::after {",
  "  transform: scaleX(1);",
  "}",
  "",
  "/* single indicator: slides (position and width) to the active tab; replaces each tab's underline once measured */",
  ".PFX_tab-ink {",
  "  position: absolute;",
  "  left: 0;",
  "  bottom: 0;",
  "  z-index: 1;",
  "  display: none;",
  "  width: var(--PFX_ink-w, 0);",
  "  height: 2px;",
  "  border-radius: 2px;",
  "  background: var(--ui-text-primary);",
  "  transform: translateX(var(--PFX_ink-x, 0));",
  "  pointer-events: none;",
  "}",
  "",
  ".PFX_tabbar[data-ink='true'] .PFX_tab-ink {",
  "  display: block;",
  "}",
  "",
  ".PFX_tab-ink[data-moved='true'] {",
  "  transition:",
  "    transform var(--PFX_dur-slow) var(--PFX_ease),",
  "    width var(--PFX_dur-slow) var(--PFX_ease);",
  "}",
  "",
  ".PFX_tabbar[data-ink='true'] .PFX_tab::after {",
  "  display: none;",
  "}",
  "",
  ".PFX_tab:focus-visible {",
  "  outline: 2px solid var(--PFX_ring);",
  "  outline-offset: -4px;",
  "  border-radius: var(--PFX_r-control);",
  "  box-shadow: none;",
  "}",
  "",
  ".PFX_tab-icon {",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  ".PFX_tab-count {",
  "  color: var(--ui-accent);",
  "  font-size: var(--PFX_fs-label);",
  "  line-height: var(--PFX_lh-label);",
  "  font-weight: 550;",
  "  font-variant-numeric: tabular-nums;",
  "}",
  "",
  ".PFX_tab-add {",
  "  flex: none;",
  "  margin-bottom: 5px;",
  "  /* own outline and readable text: as a light-gray ghost action nobody found the button.",
  "     The outline lives here (not only in the app's variant) so it looks the same in any theme. */",
  "  border: 1px solid var(--ui-stroke-secondary);",
  "  border-radius: 6px;",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_tab-add:hover {",
  "  border-color: var(--ui-stroke-primary, var(--ui-stroke-secondary));",
  "  background: var(--ui-bg-quinary);",
  "}",
  "",
  '/* each tab in a cell: the tab, the subtle "⋯" (active tab only) and the anchor of the right-click menu */',
  ".PFX_tab-cell {",
  "  position: relative;",
  "  display: inline-flex;",
  "  align-items: center;",
  "  flex: none;",
  "  transition: opacity var(--PFX_dur) var(--PFX_ease);",
  "}",
  "",
  ".PFX_tab-more {",
  "  flex: none;",
  "  margin: 0 2px 2px -6px;",
  "  color: var(--PFX_fg3);",
  "  opacity: 0.7;",
  "}",
  "",
  ".PFX_tab-cell:hover .PFX_tab-more,",
  ".PFX_tab-more:focus-visible,",
  ".PFX_tab-more[data-state='open'],",
  ".PFX_tab-more[aria-expanded='true'] {",
  "  opacity: 1;",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_tab-menu-anchor {",
  "  position: absolute;",
  "  left: 8px;",
  "  bottom: 0;",
  "  width: 1px;",
  "  height: 1px;",
  "  pointer-events: none;",
  "}",
  "",
  "/* dragging: the dragged tab fades a little; the vertical mark shows where it lands */",
  ".PFX_tab-cell[data-dragging='true'] {",
  "  opacity: 0.45;",
  "}",
  "",
  ".PFX_tab-cell[data-drop]::before {",
  "  content: '';",
  "  position: absolute;",
  "  top: 6px;",
  "  bottom: 6px;",
  "  width: 2px;",
  "  border-radius: 2px;",
  "  background: var(--ui-text-secondary);",
  "  pointer-events: none;",
  "}",
  "",
  ".PFX_tab-cell[data-drop='before']::before {",
  "  left: -2px;",
  "}",
  "",
  ".PFX_tab-cell[data-drop='after']::before {",
  "  right: -2px;",
  "}",
  "",
  ".PFX_tab[draggable='true'] {",
  "  -webkit-user-drag: element;",
  "}",
  "",
  '/* `addSlot`: what the screen puts in place of the "+" (e.g. a menu trigger); menu anchor, outside the scroller */',
  ".PFX_tab-add-slot {",
  "  position: relative;",
  "  display: flex;",
  "  flex: none;",
  "  align-items: center;",
  "  gap: 6px;",
  "}",
  "",
  '/* "New theme" (AI) next to "+ New tab": same outline, the wand in the accent color to invite a click */',
  ".PFX_tab-theme {",
  "  flex: none;",
  "  margin-bottom: 5px;",
  "  border: 1px solid var(--ui-stroke-secondary);",
  "  border-radius: 6px;",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_tab-theme:hover:not(:disabled) {",
  "  border-color: var(--ui-stroke-primary, var(--ui-stroke-secondary));",
  "  background: var(--ui-bg-quinary);",
  "}",
  "",
  ".PFX_tab-theme .PFX_tab-theme-icon {",
  "  color: var(--ui-accent);",
  "}",
  "",
  ".PFX_tab-theme:disabled .PFX_tab-theme-icon {",
  "  color: inherit;",
  "}",
  "",
  "/* no AI model: the disabled button sits in a focusable wrapper that carries the reason (tip) */",
  ".PFX_tab-theme-off {",
  "  display: inline-flex;",
  "  border-radius: 6px;",
  "}",
  "",
  ".PFX_tab-theme-off:focus-visible {",
  "  outline: 2px solid var(--PFX_ring);",
  "  outline-offset: 1px;",
  "}",
  "",
  "/* a theme building in the background: a quiet notice with the elapsed time (click = its progress) */",
  ".PFX_tab-building {",
  "  flex: none;",
  "  max-width: 280px;",
  "  margin-bottom: 5px;",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_tab-building-label {",
  "  min-width: 0;",
  "  overflow: hidden;",
  "  text-overflow: ellipsis;",
  "  white-space: nowrap;",
  "}",
  "",
  ".PFX_tab-building-time {",
  "  color: var(--PFX_fg3);",
  "  font-variant-numeric: tabular-nums;",
  "}",
  "",
  ".PFX_tab-skeleton {",
  "  display: inline-flex;",
  "  align-items: center;",
  "  height: 36px;",
  "  padding: 0 10px;",
  "}",
  "",
  "@container PFX_tabbar (max-width: 420px) {",
  "  .PFX_tab-add-label,",
  "  .PFX_tab-theme-label,",
  "  .PFX_tab-building-label {",
  "    display: none;",
  "  }",
  "}",
  "",
  "/* --------------------------------------------------------------- StatusBarItem (the app's status bar) */",
  "",
  ".PFX_baritem {",
  "  display: inline-flex;",
  "  align-items: center;",
  "  gap: 4px;",
  "  height: 100%;",
  "  padding: 0 6px;",
  "  border-radius: 4px;",
  "  color: var(--PFX_fg3);",
  "  font-size: inherit;",
  "  line-height: 1;",
  "  white-space: nowrap;",
  "  transition: color var(--PFX_dur) var(--PFX_ease);",
  "}",
  "",
  ".PFX_baritem:hover {",
  "  color: var(--ui-text-primary);",
  "  background: var(--ui-control-hover-background);",
  "}",
  "",
  ".PFX_baritem-count {",
  "  color: var(--ui-accent);",
  "  font-weight: 600;",
  "  font-variant-numeric: tabular-nums;",
  "}",
  "",
  ".PFX_baritem-note {",
  "  color: var(--PFX_fg3); /* the app's quaternary gives 2.2–3:1: unreadable on the bar */",
  "}",
  "",
  "/* --------------------------------------------------------------- ModeSwitch */",
  "",
  ".PFX_mode {",
  "  flex: none;",
  "}",
  "",
  "/* --------------------------------------------------------------- FilterBar */",
  "",
  ".PFX_filterbar {",
  "  display: flex;",
  "  align-items: center;",
  "  flex-wrap: wrap;",
  "  gap: var(--PFX_s2);",
  "  min-width: 0;",
  "  flex: 1 1 auto;",
  "}",
  "",
  ".PFX_filterbar-search {",
  "  flex: 1 1 200px;",
  "  min-width: 160px;",
  "  max-width: 340px;",
  "}",
  "",
  ".PFX_filterbar-filters {",
  "  display: flex;",
  "  align-items: center;",
  "  flex-wrap: wrap;",
  "  gap: 6px;",
  "  min-width: 0;",
  "}",
  "",
  `/* filter chip on: besides the kit chip's subtle background, the weight says "on" without relying on color */`,
  ".PFX_filterbar-filters .PFX_chip[data-active='true'] {",
  "  font-weight: 600;",
  "}",
  "",
  ".PFX_filterbar-count {",
  "  color: var(--PFX_fg3);",
  "  font-variant-numeric: tabular-nums;",
  "  white-space: nowrap;",
  "}",
  "",
  "/* --------------------------------------------------------------- Sort / group (Subscriptions filter bar) */",
  "",
  ".PFX_view-controls {",
  "  display: inline-flex;",
  "  flex: none;",
  "  align-items: center;",
  "  gap: 2px;",
  "}",
  "",
  ".PFX_view-trigger {",
  "  gap: 5px;",
  "  max-width: 200px;",
  "  color: var(--ui-text-secondary);",
  "  font-weight: 450;",
  "}",
  "",
  ".PFX_view-trigger:hover,",
  ".PFX_view-trigger[data-open='true'] {",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_view-trigger-text {",
  "  min-width: 0;",
  "  overflow: hidden;",
  "  text-overflow: ellipsis;",
  "  white-space: nowrap;",
  "}",
  "",
  ".PFX_view-trigger-caret {",
  "  flex: none;",
  "  color: var(--ui-text-quaternary);",
  "}",
  "",
  "/* choice item: the ✓ shows only on the chosen one, but keeps its place on all (aligned text) */",
  ".PFX_view-check {",
  "  flex: none;",
  "}",
  "",
  ".PFX_view-check-off {",
  "  visibility: hidden;",
  "}",
  "",
  '/* section label in the single "View" menu (narrow bar) */',
  ".PFX_view-menu-label {",
  "  padding: 4px 8px 2px;",
  "  color: var(--PFX_fg3);",
  "  letter-spacing: 0.04em;",
  "}",
  "",
  "/* --------------------------------------------------------------- SectionNav + the single page */",
  "",
  "/* Frame: the header above the page; the page takes the rest of the height and scrolls inside. The single page",
  "   (ShellPage) uses the same frame with one section box per visited section (only the current one shown). */",
  ".PFX_sections {",
  "  display: flex;",
  "  flex-direction: column;",
  "  height: 100%;",
  "  min-height: 0;",
  "  min-width: 0;",
  "  container-type: inline-size;",
  "  container-name: PFX_sections;",
  "}",
  "",
  ".PFX_sections > .PFX_page {",
  "  flex: 1 1 auto;",
  "  height: auto;",
  "}",
  "",
  ".PFX_shell-section {",
  "  display: flex;",
  "  flex: 1 1 auto;",
  "  flex-direction: column;",
  "  min-height: 0;",
  "  min-width: 0;",
  "}",
  "",
  "/* (the class above sets display: the hidden sections must still go away) */",
  ".PFX_shell-section[hidden] {",
  "  display: none;",
  "}",
  "",
  ".PFX_shell-section > * {",
  "  flex: 1 1 auto;",
  "  min-height: 0;",
  "}",
  "",
  ".PFX_shell-section > .PFX_page {",
  "  height: auto;",
  "}",
  "",
  ".PFX_secnav-back {",
  "  flex: none;",
  "  margin-right: -4px;",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_secnav-back:disabled {",
  "  color: var(--ui-text-quaternary);",
  "}",
  "",
  ".PFX_secnav {",
  "  display: flex;",
  "  flex: none;",
  "  align-items: center;",
  "  gap: var(--PFX_s3);",
  "  min-width: 0;",
  "  padding: 14px var(--PFX_s5) 0;",
  "}",
  "",
  ".PFX_secnav-brand {",
  "  display: inline-flex;",
  "  flex: none;",
  "  align-items: center;",
  "  gap: 6px;",
  "  color: var(--ui-text-primary);",
  "  white-space: nowrap;",
  "}",
  "",
  ".PFX_secnav-brand-icon {",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  "/* segmented strip: tinted track, current item raised (the same language as the app's SegmentedControl) */",
  ".PFX_secnav-track {",
  "  display: inline-flex;",
  "  flex: 0 1 auto;",
  "  min-width: 0;",
  "  align-items: center;",
  "  gap: 2px;",
  "  padding: 2px;",
  "  border-radius: var(--PFX_r-control);",
  "  background: var(--ui-bg-tertiary);",
  "}",
  "",
  ".PFX_secnav-item {",
  "  padding: 3px 10px;",
  "  border-radius: 4px;",
  "  color: var(--PFX_fg3);",
  "  white-space: nowrap;",
  "  transition:",
  "    color var(--PFX_dur) var(--PFX_ease),",
  "    background-color var(--PFX_dur) var(--PFX_ease);",
  "}",
  "",
  ".PFX_secnav-item:hover {",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_secnav-item[aria-current='page'] {",
  "  color: var(--ui-text-primary);",
  "  background: var(--ui-bg-editor);",
  "  box-shadow: 0 1px 2px color-mix(in srgb, var(--ui-base) 14%, transparent);",
  "  font-weight: 550;",
  "  cursor: default;",
  "}",
  "",
  ".PFX_secnav-compact {",
  "  flex: none;",
  "  min-width: 0;",
  "}",
  "",
  "/* the Watch tab: one more item in the strip, with the short video title and its own ✕ */",
  ".PFX_secnav-watch {",
  "  display: inline-flex;",
  "  align-items: center;",
  "  min-width: 0;",
  "  max-width: 260px;",
  "  border-radius: 4px;",
  "}",
  "",
  ".PFX_secnav-watch[data-current='true'] {",
  "  background: var(--ui-bg-editor);",
  "  box-shadow: 0 1px 2px color-mix(in srgb, var(--ui-base) 14%, transparent);",
  "}",
  "",
  ".PFX_secnav-watch .PFX_secnav-item[aria-current='page'] {",
  "  background: transparent;",
  "  box-shadow: none;",
  "}",
  "",
  ".PFX_secnav-watch-item {",
  "  display: inline-flex;",
  "  align-items: center;",
  "  gap: 5px;",
  "  min-width: 0;",
  "  padding-right: 4px;",
  "}",
  "",
  ".PFX_secnav-watch-icon {",
  "  flex: none;",
  "}",
  "",
  ".PFX_secnav-watch-close {",
  "  display: inline-grid;",
  "  flex: none;",
  "  place-items: center;",
  "  width: 18px;",
  "  height: 18px;",
  "  margin-right: 3px;",
  "  border-radius: 3px;",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  ".PFX_secnav-watch-close:hover {",
  "  background: color-mix(in srgb, var(--ui-base) 10%, transparent);",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  ".PFX_secnav-watch-close:focus-visible {",
  "  outline: 2px solid var(--PFX_ring);",
  "  outline-offset: 1px;",
  "}",
  "",
  "/* narrow width: the strip gives way to the compact menu (each query hides only one of the forms) */",
  "@container PFX_sections (max-width: 479px) {",
  "  .PFX_secnav-track {",
  "    display: none;",
  "  }",
  "",
  "  .PFX_secnav {",
  "    padding-inline: var(--PFX_s3);",
  "  }",
  "}",
  "",
  "@container PFX_sections (min-width: 480px) {",
  "  .PFX_secnav-compact {",
  "    display: none;",
  "  }",
  "}",
  ""
].join("\n");

// raw-css:desktop-src/styles/tokens.css
var tokens_default = [
  "/* Plugin visual language — tokens and base. Normative: docs/design/DESIGN.md.",
  "   Everything here derives from the host theme variables (var(--ui-*), --dt-*); no fixed color.",
  "   `PFX_` is swapped for the plugin prefix in lib/style.ts (derived from PLUGIN_ID). */",
  "",
  ":root {",
  "  /* 4/8 px rhythm */",
  "  --PFX_s1: 4px;",
  "  --PFX_s2: 8px;",
  "  --PFX_s3: 12px;",
  "  --PFX_s4: 16px;",
  "  --PFX_s5: 24px;",
  "  --PFX_s6: 32px;",
  "",
  "  /* typography: 4 levels and only 4 */",
  "  --PFX_fs-title: 17px;",
  "  --PFX_lh-title: 24px;",
  "  --PFX_fs-head: 14px;",
  "  --PFX_lh-head: 20px;",
  "  --PFX_fs-body: 13px;",
  "  --PFX_lh-body: 18px;",
  "  --PFX_fs-label: 12px;",
  "  --PFX_lh-label: 16px;",
  "",
  "  /* one radius for the card, another for the thumbnail */",
  "  --PFX_r-card: 10px;",
  "  --PFX_r-thumb: 6px;",
  "  --PFX_r-control: 6px;",
  "",
  "  /* motion: elevation only on hover/focus */",
  "  --PFX_dur: 160ms;",
  "  --PFX_dur-slow: 180ms;",
  "  --PFX_ease: cubic-bezier(0.2, 0.7, 0.3, 1);",
  "  --PFX_stagger: 28ms;",
  "",
  "  /* theme-derived tones. Text in 3 tones: --ui-text-primary, --ui-text-secondary and --PFX_fg3",
  "     (66% of --ui-base: the host's --ui-text-tertiary, 54%, sits at ~3.5:1 on light; 66% passes 4.5:1",
  "     also on the theme's tinted surfaces). The",
  "     --ui-text-quaternary is decorative only (separators, supporting icons). */",
  "  --PFX_fg3: color-mix(in srgb, var(--ui-base) 66%, transparent);",
  "  --PFX_ring: color-mix(in srgb, var(--ui-base) 52%, transparent);",
  "  --PFX_scrim: color-mix(in srgb, var(--ui-bg-editor) 84%, transparent);",
  "  --PFX_veil: color-mix(in srgb, var(--ui-bg-editor) 58%, transparent);",
  "  --PFX_accent-soft: color-mix(in srgb, var(--ui-accent) 12%, transparent);",
  "}",
  "",
  "/* --------------------------------------------------------------- typography (4 levels) */",
  "",
  ".PFX_t-title {",
  "  font-size: var(--PFX_fs-title);",
  "  line-height: var(--PFX_lh-title);",
  "  font-weight: 600;",
  "  letter-spacing: -0.012em;",
  "}",
  "",
  ".PFX_t-head {",
  "  font-size: var(--PFX_fs-head);",
  "  line-height: var(--PFX_lh-head);",
  "  font-weight: 600;",
  "  letter-spacing: -0.004em;",
  "}",
  "",
  ".PFX_t-body {",
  "  font-size: var(--PFX_fs-body);",
  "  line-height: var(--PFX_lh-body);",
  "  font-weight: 400;",
  "}",
  "",
  ".PFX_t-label {",
  "  font-size: var(--PFX_fs-label);",
  "  line-height: var(--PFX_lh-label);",
  "  font-weight: 450;",
  "  letter-spacing: 0.012em;",
  "}",
  "",
  ".PFX_num {",
  "  font-variant-numeric: tabular-nums;",
  "}",
  "",
  ".PFX_truncate {",
  "  min-width: 0;",
  "  overflow: hidden;",
  "  white-space: nowrap;",
  "  text-overflow: ellipsis;",
  "}",
  "",
  ".PFX_sr {",
  "  position: absolute;",
  "  width: 1px;",
  "  height: 1px;",
  "  padding: 0;",
  "  margin: -1px;",
  "  overflow: hidden;",
  "  clip: rect(0 0 0 0);",
  "  white-space: nowrap;",
  "  border: 0;",
  "}",
  "",
  "/* native button with no appearance (the look comes from the class that uses it) */",
  ".PFX_bare {",
  "  appearance: none;",
  "  margin: 0;",
  "  padding: 0;",
  "  border: 0;",
  "  background: none;",
  "  color: inherit;",
  "  font: inherit;",
  "  text-align: inherit;",
  "  cursor: pointer;",
  "}",
  "",
  ".PFX_bare:focus-visible,",
  ".PFX_focus:focus-visible {",
  "  outline: 2px solid var(--PFX_ring);",
  "  outline-offset: 2px;",
  "  border-radius: var(--PFX_r-control);",
  "}",
  "",
  "/* --------------------------------------------------------------- skeleton (bar in place of text) */",
  "",
  "/* The skeleton line inherits the real line's box (same typography class); the bar takes the glyph height,",
  "   centered — which is why the skeleton has exactly the final geometry. */",
  ".PFX_sk-line {",
  "  display: flex;",
  "  align-items: center;",
  "  min-width: 0;",
  "  height: 1lh;",
  "}",
  "",
  "/* Almost imperceptible tone, derived from the theme line (not from the accent-tinted fill), with a soft",
  "   shimmer that passes slowly. The SDK's Skeleton brings `animate-pulse` + its own background: the plugin class",
  "   (unlayered) beats both. `prefers-reduced-motion` turns the shimmer off (global rule at the end). */",
  ".PFX_sk {",
  "  display: block;",
  "  flex: none;",
  "  height: 0.7em;",
  "  width: var(--PFX_sk-w, 72%);",
  "  border-radius: 3px;",
  "  background-color: color-mix(in srgb, var(--ui-stroke-quaternary) 70%, color-mix(in srgb, var(--ui-base) 3%, transparent));",
  "  background-image: linear-gradient(",
  "    100deg,",
  "    transparent 30%,",
  "    color-mix(in srgb, var(--ui-bg-elevated) 55%, transparent) 50%,",
  "    transparent 70%",
  "  );",
  "  background-size: 220% 100%;",
  "  background-repeat: no-repeat;",
  "  opacity: 1;",
  "  animation: PFX_shimmer 1.8s ease-in-out infinite;",
  "}",
  "",
  "@keyframes PFX_shimmer {",
  "  from {",
  "    background-position: 140% 0;",
  "  }",
  "",
  "  to {",
  "    background-position: -40% 0;",
  "  }",
  "}",
  "",
  ".PFX_sk[data-shape='block'] {",
  "  width: 100%;",
  "  height: 100%;",
  "  border-radius: inherit;",
  "}",
  "",
  ".PFX_sk[data-shape='round'] {",
  "  width: 100%;",
  "  height: 100%;",
  "  border-radius: 999px;",
  "}",
  "",
  "@keyframes PFX_fade-in {",
  "  from {",
  "    opacity: 0;",
  "  }",
  "}",
  "",
  "@keyframes PFX_count-in {",
  "  from {",
  "    opacity: 0;",
  "    transform: translateY(45%);",
  "  }",
  "}",
  "",
  "/* cards enter on load: rise 4 px and appear, in a light cascade (--PFX_i = order) */",
  "@keyframes PFX_rise {",
  "  from {",
  "    opacity: 0;",
  "    transform: translateY(4px);",
  "  }",
  "}",
  "",
  '/* "waiting…": three dots that breathe */',
  "@keyframes PFX_breathe {",
  "  0%,",
  "  100% {",
  "    opacity: 0.25;",
  "  }",
  "",
  "  50% {",
  "    opacity: 1;",
  "  }",
  "}",
  "",
  "/* success: the badge enters with a slight growth */",
  "@keyframes PFX_pop {",
  "  from {",
  "    opacity: 0;",
  "    transform: scale(0.86);",
  "  }",
  "}",
  "",
  "/* --------------------------------------------------------------- reduced motion */",
  "",
  "@media (prefers-reduced-motion: reduce) {",
  "  [class*='PFX_'],",
  "  [class*='PFX_']::before,",
  "  [class*='PFX_']::after {",
  "    transition: none !important;",
  "    animation: none !important;",
  "  }",
  "}",
  ""
].join("\n");

// raw-css:desktop-src/styles/video.css
var video_default = [
  "/* Video: Thumb, VideoCard (grid | compact | row | featured), QuickActions.",
  "   The thumbnail is the only color on the screen: everything around it is monochrome from the theme.",
  "   Font weights on a card: 600 (title) and 450 (everything else) — never more than two. */",
  "",
  "/* --------------------------------------------------------------- Thumb (16:9) */",
  "",
  ".PFX_thumb {",
  "  position: relative;",
  "  display: block;",
  "  width: 100%;",
  "  aspect-ratio: 16 / 9;",
  "  overflow: hidden;",
  "  isolation: isolate;",
  "  border-radius: var(--PFX_r-thumb);",
  "  background: var(--ui-bg-quaternary);",
  "}",
  "",
  "/* inner line: a light thumbnail does not bleed into the light background */",
  ".PFX_thumb::after {",
  "  content: '';",
  "  position: absolute;",
  "  inset: 0;",
  "  z-index: 3;",
  "  border-radius: inherit;",
  "  box-shadow: inset 0 0 0 1px var(--ui-stroke-quaternary);",
  "  pointer-events: none;",
  "}",
  "",
  ".PFX_thumb-img {",
  "  position: absolute;",
  "  inset: 0;",
  "  width: 100%;",
  "  height: 100%;",
  "  max-width: none;",
  "  object-fit: cover;",
  "  opacity: 0;",
  "  transform: scale(1.001);",
  "  transition:",
  "    opacity 220ms ease-out,",
  "    transform var(--PFX_dur-slow) var(--PFX_ease),",
  "    filter var(--PFX_dur-slow) ease-out;",
  "}",
  "",
  ".PFX_thumb-img[data-loaded='true'] {",
  "  opacity: 1;",
  "}",
  "",
  ".PFX_thumb[data-watched='true'] .PFX_thumb-img {",
  "  filter: saturate(0.5);",
  "}",
  "",
  "/* drawn fallback when the image fails */",
  ".PFX_thumb-fallback {",
  "  position: absolute;",
  "  inset: 0;",
  "  display: grid;",
  "  place-items: center;",
  "  color: var(--ui-text-quaternary);",
  "  background:",
  "    repeating-linear-gradient(",
  "      -45deg,",
  "      transparent 0 9px,",
  "      var(--ui-stroke-quaternary) 9px 10px",
  "    ),",
  "    var(--ui-bg-quaternary);",
  "}",
  "",
  '/* "watched" veil: enters fading (no flicker) */',
  ".PFX_thumb-veil {",
  "  position: absolute;",
  "  inset: 0;",
  "  z-index: 1;",
  "  display: flex;",
  "  align-items: flex-start;",
  "  padding: 6px;",
  "  background: var(--PFX_veil);",
  "  animation: PFX_fade-in var(--PFX_dur-slow) var(--PFX_ease) both;",
  "}",
  "",
  ".PFX_thumb-pill {",
  "  display: inline-flex;",
  "  align-items: center;",
  "  gap: 3px;",
  "  height: 18px;",
  "  padding: 0 5px;",
  "  border-radius: 4px;",
  "  background: var(--PFX_scrim);",
  "  color: var(--ui-text-primary);",
  "  font-size: 11px;",
  "  line-height: 18px;",
  "  font-weight: 450;",
  "  letter-spacing: 0.01em;",
  "  font-variant-numeric: tabular-nums;",
  "  white-space: nowrap;",
  "  -webkit-backdrop-filter: blur(6px);",
  "  backdrop-filter: blur(6px);",
  "}",
  "",
  "/* Type mark + duration: ONE only, in the BOTTOM-right corner, always visible — where YouTube puts the",
  "   duration. Quick actions appear at the TOP of the thumbnail (hover/focus), so the two",
  "   never fight for the same corner (not even at 420 px). */",
  ".PFX_thumb-mark {",
  "  position: absolute;",
  "  right: 6px;",
  "  bottom: 6px;",
  "  z-index: 2;",
  "  gap: 4px;",
  "  max-width: calc(100% - 12px);",
  "}",
  "",
  ".PFX_thumb[data-has-progress='true'] .PFX_thumb-mark {",
  "  bottom: 9px;",
  "}",
  "",
  ".PFX_mark-icon {",
  "  flex: none;",
  "}",
  "",
  ".PFX_mark-kind,",
  ".PFX_mark-duration {",
  "  white-space: nowrap;",
  "}",
  "",
  ".PFX_mark-duration {",
  "  font-variant-numeric: tabular-nums;",
  "}",
  "",
  "/* in the list (small thumbnail) the mark is text in the metadata line, without a pill */",
  ".PFX_card-mark {",
  "  display: inline-flex;",
  "  flex: none;",
  "  align-items: center;",
  "  gap: 4px;",
  "  color: var(--PFX_fg3);",
  "  font-variant-numeric: tabular-nums;",
  "  white-space: nowrap;",
  "}",
  "",
  ".PFX_card-mark .PFX_mark-icon {",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_thumb-badges {",
  "  position: absolute;",
  "  left: 6px;",
  "  bottom: 6px;",
  "  z-index: 2;",
  "  display: flex;",
  "  gap: 4px;",
  '  /* the bottom right belongs to the type mark + duration ("Short 0:47" with icon ≈ 84 px) */',
  "  max-width: calc(100% - 102px);",
  "  transition: opacity var(--PFX_dur) var(--PFX_ease);",
  "}",
  "",
  ".PFX_thumb[data-has-progress='true'] .PFX_thumb-badges {",
  "  bottom: 9px;",
  "}",
  "",
  ".PFX_thumb-new {",
  "  position: absolute;",
  "  top: 8px;",
  "  left: 8px;",
  "  z-index: 2;",
  "  width: 8px;",
  "  height: 8px;",
  "  border-radius: 999px;",
  "  background: var(--ui-accent);",
  "  box-shadow: 0 0 0 2px var(--PFX_scrim);",
  "}",
  "",
  ".PFX_thumb-progress {",
  "  position: absolute;",
  "  left: 0;",
  "  right: 0;",
  "  bottom: 0;",
  "  z-index: 2;",
  "  height: 3px;",
  "  background: color-mix(in srgb, var(--ui-bg-editor) 55%, transparent);",
  "}",
  "",
  ".PFX_thumb-progress-fill {",
  "  display: block;",
  "  height: 100%;",
  "  width: var(--PFX_progress, 0%);",
  "  background: var(--ui-text-primary);",
  "}",
  "",
  "/* --------------------------------------------------------------- VideoCard */",
  "",
  ".PFX_card {",
  "  position: relative;",
  "  display: block;",
  "  min-width: 0;",
  "  height: 100%;",
  "  padding: var(--PFX_s1) var(--PFX_s1) var(--PFX_s2);",
  "  border: 1px solid transparent;",
  "  border-radius: var(--PFX_r-card);",
  "  color: var(--ui-text-primary);",
  "  container-type: inline-size;",
  "  container-name: PFX_card;",
  "  transition:",
  "    transform var(--PFX_dur) var(--PFX_ease),",
  "    border-color var(--PFX_dur) var(--PFX_ease),",
  "    background-color var(--PFX_dur) var(--PFX_ease);",
  "}",
  "",
  ".PFX_card:hover,",
  ".PFX_card:focus-within,",
  ".PFX_grid-cell:focus-visible > .PFX_card {",
  "  transform: translateY(-1px);",
  "  border-color: var(--ui-stroke-secondary);",
  "  background: var(--ui-bg-quinary);",
  "}",
  "",
  "/* minimal thumbnail zoom on hover, inside the clip (.thumb crops) */",
  ".PFX_card:hover .PFX_thumb-img[data-loaded='true'] {",
  "  transform: scale(1.03);",
  "}",
  "",
  "/* outside a Grid (chat, running text), the grid card does not exceed ~360 px */",
  ".PFX_card[data-variant='grid']:not(.PFX_grid *) {",
  "  max-width: 360px;",
  "}",
  "",
  ".PFX_card-media {",
  "  position: relative;",
  "  flex: none;",
  "  min-width: 0;",
  "  transition: opacity var(--PFX_dur-slow) var(--PFX_ease);",
  "}",
  "",
  "/* watched / archived: the card fades (thumbnail and title), no flicker; the text stays legible */",
  ".PFX_card[data-state='watched'] .PFX_card-media,",
  ".PFX_card[data-state='archived'] .PFX_card-media,",
  ".PFX_card[data-state='hidden'] .PFX_card-media {",
  "  opacity: 0.78;",
  "}",
  "",
  ".PFX_card[data-state='watched'] .PFX_card-title,",
  ".PFX_card[data-state='archived'] .PFX_card-title,",
  ".PFX_card[data-state='hidden'] .PFX_card-title {",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_card-body {",
  "  display: flex;",
  "  flex-direction: column;",
  "  gap: 4px;",
  "  min-width: 0;",
  "  padding: 0 var(--PFX_s1);",
  "  container-type: inline-size;",
  "  container-name: PFX_cardbody;",
  "}",
  "",
  "/* the title flows (1 or 2 lines); only the Grid reserves the 2 lines (grid rows aligned, skeleton without a jump) */",
  ".PFX_card-title {",
  "  margin: 0;",
  "  color: var(--ui-text-primary);",
  "  display: -webkit-box;",
  "  -webkit-box-orient: vertical;",
  "  -webkit-line-clamp: 2;",
  "  line-clamp: 2;",
  "  overflow: hidden;",
  "  overflow-wrap: anywhere;",
  "  transition: color var(--PFX_dur-slow) var(--PFX_ease);",
  "}",
  "",
  ".PFX_grid .PFX_card-title {",
  "  min-height: calc(2 * var(--PFX_lh-head));",
  "}",
  "",
  ".PFX_grid .PFX_card[data-variant='compact'] .PFX_card-title {",
  "  min-height: calc(2 * var(--PFX_lh-body));",
  "}",
  "",
  "/* the frame is the container; the arrangement (column, row, side by side) lives in the frame */",
  ".PFX_card-frame {",
  "  display: flex;",
  "  flex-direction: column;",
  "  gap: 10px;",
  "  min-width: 0;",
  "  height: 100%;",
  "}",
  "",
  "/* skeleton: the lines stack inside the same box */",
  ".PFX_card-title[data-skeleton],",
  ".PFX_card-excerpt[data-skeleton] {",
  "  display: flex;",
  "  flex-direction: column;",
  "}",
  "",
  "/* the title is the open target (a link: inline, so the 2-line cut applies); the ::after stretches the",
  "   click to the whole card */",
  ".PFX_card-open {",
  "  position: static;",
  "  color: inherit;",
  "  text-decoration: none;",
  "}",
  "",
  ".PFX_card-open::after {",
  "  content: '';",
  "  position: absolute;",
  "  inset: 0;",
  "  z-index: 1;",
  "  border-radius: var(--PFX_r-card);",
  "}",
  "",
  ".PFX_card-open:focus-visible {",
  "  outline: none;",
  "}",
  "",
  ".PFX_card-open:focus-visible::after {",
  "  outline: 2px solid var(--PFX_ring);",
  "  outline-offset: 2px;",
  "}",
  "",
  ".PFX_card-meta {",
  "  display: flex;",
  "  align-items: center;",
  "  gap: 6px;",
  "  min-width: 0;",
  "  height: var(--PFX_lh-label);",
  "  overflow: hidden;",
  "  color: var(--ui-text-secondary);",
  "  white-space: nowrap;",
  "}",
  "",
  ".PFX_card-meta .PFX_avatar-fallback {",
  "  font-weight: 600;",
  "}",
  "",
  ".PFX_card-channel {",
  "  flex: 0 1 auto;",
  "  min-width: 0;",
  "  overflow: hidden;",
  "  text-overflow: ellipsis;",
  "}",
  "",
  ".PFX_card-sep {",
  "  flex: none;",
  "  color: var(--ui-text-quaternary);",
  "}",
  "",
  ".PFX_card-stat {",
  "  flex: none;",
  "  color: var(--PFX_fg3);",
  "  font-variant-numeric: tabular-nums;",
  "}",
  "",
  ".PFX_card-excerpt {",
  "  margin: 0;",
  "  color: var(--ui-text-secondary);",
  "  font-weight: 450;",
  "  display: -webkit-box;",
  "  -webkit-box-orient: vertical;",
  "  -webkit-line-clamp: 3;",
  "  line-clamp: 3;",
  "  overflow: hidden;",
  "}",
  "",
  "/* quick actions: appear on hover and focus, at the top of the thumbnail (the bottom belongs to the type mark + duration) */",
  ".PFX_card-actions {",
  "  position: absolute;",
  "  left: 6px;",
  "  top: 6px;",
  "  z-index: 4;",
  "  max-width: calc(100% - 12px);",
  "  opacity: 0;",
  "  transform: translateY(-3px);",
  "  pointer-events: none;",
  "  transition:",
  "    opacity var(--PFX_dur) var(--PFX_ease),",
  "    transform var(--PFX_dur) var(--PFX_ease);",
  "}",
  "",
  ".PFX_card:hover .PFX_card-actions,",
  ".PFX_card:focus-within .PFX_card-actions,",
  ".PFX_grid-cell:focus-visible .PFX_card-actions {",
  "  opacity: 1;",
  "  transform: none;",
  "  pointer-events: auto;",
  "}",
  "",
  "/* actions appear at the top: the bottom (badges on the left, type mark + duration on the right) does not move */",
  "",
  "/* actions always in view (featured): in the body, with label, outside the thumbnail */",
  ".PFX_card-actions[data-persistent='true'] {",
  "  position: relative;",
  "  left: auto;",
  "  top: auto;",
  "  max-width: none;",
  "  margin-top: var(--PFX_s2);",
  "  opacity: 1;",
  "  transform: none;",
  "  pointer-events: auto;",
  "}",
  "",
  ".PFX_card[data-variant='featured'] .PFX_card-media .PFX_thumb-badges {",
  "  opacity: 1;",
  "}",
  "",
  ".PFX_card-actions-sk {",
  "  display: block;",
  "  width: 228px;",
  "  max-width: 100%;",
  "  height: 28px;",
  "  border-radius: var(--PFX_r-control);",
  "}",
  "",
  "/* ---- compact: dense grid */",
  "",
  ".PFX_card[data-variant='compact'] {",
  "  padding: 3px 3px 6px;",
  "}",
  "",
  ".PFX_card[data-variant='compact'] .PFX_card-frame {",
  "  gap: var(--PFX_s2);",
  "}",
  "",
  ".PFX_card[data-variant='compact'] .PFX_card-title {",
  "  font-size: var(--PFX_fs-body);",
  "  line-height: var(--PFX_lh-body);",
  "}",
  "",
  ".PFX_card[data-variant='compact'] .PFX_card-meta .PFX_avatar,",
  ".PFX_card[data-variant='compact'] .PFX_card-stat[data-kind='views'],",
  ".PFX_card[data-variant='compact'] .PFX_card-sep[data-kind='views'] {",
  "  display: none;",
  "}",
  "",
  "/* ---- row: list with small thumbnail (default in chat) */",
  "",
  ".PFX_card[data-variant='row'] {",
  "  padding: 6px;",
  "}",
  "",
  ".PFX_card[data-variant='row'] .PFX_card-frame {",
  "  flex-direction: row;",
  "  align-items: center;",
  "  gap: var(--PFX_s3);",
  "}",
  "",
  ".PFX_grid[data-density='list'] .PFX_grid-row + .PFX_grid-row .PFX_card[data-variant='row']::before {",
  "  content: '';",
  "  position: absolute;",
  "  left: 6px;",
  "  right: 6px;",
  "  top: -1px;",
  "  height: 1px;",
  "  background: var(--ui-stroke-quaternary);",
  "}",
  "",
  ".PFX_card[data-variant='row']:hover::before,",
  ".PFX_card[data-variant='row']:focus-within::before {",
  "  opacity: 0;",
  "}",
  "",
  ".PFX_card[data-variant='row'] .PFX_card-media {",
  "  width: clamp(112px, 24cqi, 176px);",
  "}",
  "",
  ".PFX_card[data-variant='row'] .PFX_card-body {",
  "  flex: 1 1 auto;",
  "  padding: 0;",
  "}",
  "",
  ".PFX_card[data-variant='row'] .PFX_card-actions {",
  "  position: static;",
  "  flex: none;",
  "  max-width: none;",
  "  transform: none;",
  "}",
  "",
  "/* ---- featured: the main piece of Home. Large 16:9 thumbnail; beside it, overline (why it is here),",
  "   level-1 title, description in up to 3 lines, ONE channel line and the actions with label. Narrow: stacks. */",
  "",
  ".PFX_card[data-variant='featured'] {",
  "  padding: var(--PFX_s3);",
  "  border-color: var(--ui-stroke-tertiary);",
  "  background: var(--ui-bg-quinary);",
  "}",
  "",
  ".PFX_card[data-variant='featured']:hover,",
  ".PFX_card[data-variant='featured']:focus-within {",
  "  transform: none;",
  "}",
  "",
  "/* Always a grid: narrow = 1 column; wide = 2 (below). DO NOT switch `display` inside `@container`: the",
  "   card body is itself a query container, and in Chromium (seen in the real app, 145) switching the",
  "   parent's `display` when crossing the threshold leaves the nested container's children without a box (title, description and",
  "   actions vanish until the tree is rebuilt). `test/css-container.test.ts` guards the rule. */",
  ".PFX_card[data-variant='featured'] .PFX_card-frame {",
  "  display: grid;",
  "  grid-template-columns: minmax(0, 1fr);",
  "  gap: var(--PFX_s4);",
  "}",
  "",
  ".PFX_card[data-variant='featured'] .PFX_thumb {",
  "  border-radius: calc(var(--PFX_r-card) - 2px);",
  "}",
  "",
  ".PFX_card[data-variant='featured'] .PFX_card-body {",
  "  gap: var(--PFX_s2);",
  "  padding: 0 var(--PFX_s1) var(--PFX_s1);",
  "}",
  "",
  ".PFX_card[data-variant='featured'] .PFX_card-title {",
  "  font-size: var(--PFX_fs-title);",
  "  line-height: var(--PFX_lh-title);",
  "  text-wrap: pretty;",
  "}",
  "",
  ".PFX_card[data-variant='featured'] .PFX_card-meta {",
  "  gap: 8px;",
  "  height: 20px;",
  "  margin-top: 2px;",
  "}",
  "",
  ".PFX_card[data-variant='featured'] .PFX_card-channel {",
  "  color: var(--ui-text-primary);",
  "}",
  "",
  "@container PFX_card (min-width: 620px) {",
  "  .PFX_card[data-variant='featured'] .PFX_card-frame {",
  "    grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);",
  "    gap: var(--PFX_s5);",
  "    align-items: center;",
  "  }",
  "",
  "  .PFX_card[data-variant='featured'] .PFX_card-body {",
  "    max-width: 52ch;",
  "    padding: var(--PFX_s2) var(--PFX_s4) var(--PFX_s2) 0;",
  "    gap: 10px;",
  "  }",
  "}",
  "",
  "@container PFX_card (min-width: 1100px) {",
  "  .PFX_card[data-variant='featured'] .PFX_card-frame {",
  "    grid-template-columns: minmax(0, 640px) minmax(0, 1fr);",
  "    gap: var(--PFX_s6);",
  "  }",
  "}",
  "",
  "@container PFX_card (max-width: 230px) {",
  "  .PFX_card-meta .PFX_avatar,",
  "  .PFX_quick-kbd {",
  "    display: none;",
  "  }",
  "}",
  "",
  "/* the metadata line never overflows: with no room, the views go first */",
  "@container PFX_cardbody (max-width: 260px) {",
  "  .PFX_card-stat[data-kind='views'],",
  "  .PFX_card-sep[data-kind='views'] {",
  "    display: none;",
  "  }",
  "}",
  "",
  "@container PFX_card (max-width: 360px) {",
  "  .PFX_card[data-variant='row'] .PFX_card-actions {",
  "    display: none;",
  "  }",
  "}",
  "",
  "/* --------------------------------------------------------------- QuickActions */",
  "",
  ".PFX_quick {",
  "  display: inline-flex;",
  "  align-items: center;",
  "  gap: 2px;",
  "  padding: 2px;",
  "  border-radius: 7px;",
  "  background: var(--PFX_scrim);",
  "  box-shadow: inset 0 0 0 1px var(--ui-stroke-tertiary);",
  "  -webkit-backdrop-filter: blur(8px);",
  "  backdrop-filter: blur(8px);",
  "}",
  "",
  ".PFX_quick-btn {",
  "  gap: 5px;",
  "  height: 24px;",
  "  padding: 0 6px;",
  "  border-radius: 5px;",
  "  color: var(--ui-text-secondary);",
  "  font-weight: 450;",
  "}",
  "",
  ".PFX_quick-btn:hover,",
  ".PFX_quick-btn[aria-pressed='true'] {",
  "  color: var(--ui-text-primary);",
  "  background: var(--ui-control-hover-background);",
  "}",
  "",
  ".PFX_quick-kbd {",
  "  min-width: 16px;",
  "  height: 16px;",
  "  padding: 0 3px;",
  "  font-weight: 450;",
  "}",
  "",
  ".PFX_quick-label {",
  "  white-space: nowrap;",
  "}",
  "",
  ".PFX_card[data-variant='row'] .PFX_quick {",
  "  background: transparent;",
  "  box-shadow: none;",
  "  -webkit-backdrop-filter: none;",
  "  backdrop-filter: none;",
  "}",
  "",
  "/* with label (featured, or `showLabels`): calm bar, no veil; taller buttons */",
  ".PFX_quick[data-labels='true'] {",
  "  flex-wrap: wrap;",
  "  gap: var(--PFX_s1);",
  "  padding: 0;",
  "  background: transparent;",
  "  box-shadow: none;",
  "  -webkit-backdrop-filter: none;",
  "  backdrop-filter: none;",
  "}",
  "",
  ".PFX_quick[data-labels='true'] .PFX_quick-btn {",
  "  height: 28px;",
  "  padding: 0 10px 0 8px;",
  "  border-radius: var(--PFX_r-control);",
  "  box-shadow: inset 0 0 0 1px var(--ui-stroke-tertiary);",
  "  color: var(--ui-text-primary);",
  "  font-size: var(--PFX_fs-label);",
  "}",
  "",
  ".PFX_quick[data-labels='true'] .PFX_quick-btn:hover {",
  "  box-shadow: inset 0 0 0 1px var(--ui-stroke-secondary);",
  "}",
  "",
  ".PFX_quick[data-labels='true'] .PFX_quick-kbd {",
  "  margin-left: 2px;",
  "}",
  "",
  "/* Placeholder of a video archived by click: the card disappears (invisible and inert, only to hold the",
  '   geometry) and the space shows "Archived · Undo" until the list changes; the neighbor does not move up. */',
  ".PFX_card-gone {",
  "  position: relative;",
  "}",
  "",
  ".PFX_card-gone-ghost {",
  "  visibility: hidden;",
  "}",
  "",
  ".PFX_card-gone-note {",
  "  position: absolute;",
  "  inset: 0;",
  "  display: flex;",
  "  align-items: center;",
  "  justify-content: center;",
  "  gap: var(--PFX_s2);",
  "  padding: var(--PFX_s2);",
  "  border: 1px dashed var(--ui-stroke-tertiary);",
  "  border-radius: var(--PFX_r-card);",
  "  color: var(--ui-text-secondary);",
  "  animation: PFX_gone-in var(--PFX_dur-slow) var(--PFX_ease);",
  "}",
  "",
  "@keyframes PFX_gone-in {",
  "  from {",
  "    opacity: 0;",
  "  }",
  "}",
  "",
  "/* Grouped list (GET /feed?group=…): header per group (name, count of the loaded ones, collapse/expand),",
  "   stuck to the top of the scrolling area (the tab bar is outside it, so they do not fight) — each header only holds",
  "   inside its own group: the next one pushes the previous one. */",
  ".PFX_feed-groups {",
  "  display: flex;",
  "  flex-direction: column;",
  "  gap: var(--PFX_s4);",
  "  min-width: 0;",
  "}",
  "",
  ".PFX_feed-group {",
  "  display: flex;",
  "  flex-direction: column;",
  "  gap: var(--PFX_s2);",
  "  min-width: 0;",
  "}",
  "",
  ".PFX_feed-group-head {",
  "  position: sticky;",
  "  top: 0;",
  "  z-index: 6;",
  "  margin: 0 calc(-1 * var(--PFX_s1));",
  "  padding: 2px var(--PFX_s1);",
  "  background: var(--ui-editor-surface-background, var(--ui-bg-editor));",
  "}",
  "",
  ".PFX_feed-group-toggle {",
  "  display: flex;",
  "  align-items: center;",
  "  gap: var(--PFX_s2);",
  "  width: 100%;",
  "  min-width: 0;",
  "  min-height: 32px;",
  "  padding: 4px 6px;",
  "  border-radius: var(--PFX_r-control);",
  "  color: var(--ui-text-primary);",
  "  text-align: left;",
  "  transition: background-color var(--PFX_dur) var(--PFX_ease);",
  "}",
  "",
  ".PFX_feed-group-toggle:hover {",
  "  background: var(--ui-control-hover-background);",
  "}",
  "",
  ".PFX_feed-group-toggle:focus-visible {",
  "  outline: 2px solid var(--PFX_ring);",
  "  outline-offset: 1px;",
  "}",
  "",
  ".PFX_feed-group-caret {",
  "  flex: none;",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  ".PFX_feed-group-lead {",
  "  display: inline-flex;",
  "  flex: none;",
  "  align-items: center;",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_feed-group-name {",
  "  min-width: 0;",
  "  overflow: hidden;",
  "  text-overflow: ellipsis;",
  "  white-space: nowrap;",
  "}",
  "",
  ".PFX_feed-group-count {",
  "  flex: none;",
  "  color: var(--PFX_fg3);",
  "  font-variant-numeric: tabular-nums;",
  "}",
  ""
].join("\n");

// desktop-src/styles/index.ts
var CSS_SOURCES = [tokens_default, layout_default, video_default, nav_default, channel_default, flows_default, misc_default];

// desktop-src/lib/style.ts
var CSS_TOKEN = "PFX_";
var CLASS_PREFIX = `${PLUGIN_ID.toLowerCase().replace(/[^a-z0-9-]/g, "-")}-`;
var STYLE_ATTR = `data-${CLASS_PREFIX}styles`;
function cx(...names) {
  const out = [];
  for (const n of names) {
    if (!n) continue;
    for (const token of n.split(/\s+/)) if (token) out.push(CLASS_PREFIX + token);
  }
  return out.join(" ");
}
function cssVar(name) {
  return `--${CLASS_PREFIX}${name}`;
}
function resolveCss(source) {
  return source.split(CSS_TOKEN).join(CLASS_PREFIX);
}
var resolved = null;
function cssText() {
  if (resolved === null) resolved = resolveCss(CSS_SOURCES.join("\n"));
  return resolved;
}
var tokenSeq = 0;
function mountStyles(doc = globalThis.document) {
  if (!doc?.head) return () => void 0;
  const found = [...doc.head.querySelectorAll(`style[${STYLE_ATTR}]`)];
  for (const extra of found.slice(1)) extra.remove();
  let el = found[0];
  if (!el) {
    el = doc.createElement("style");
    el.setAttribute(STYLE_ATTR, "");
    doc.head.appendChild(el);
  }
  const css = cssText();
  if (el.textContent !== css) el.textContent = css;
  const token = `${Date.now().toString(36)}-${++tokenSeq}`;
  el.setAttribute(STYLE_ATTR, token);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (el.isConnected && el.getAttribute(STYLE_ATTR) === token) el.remove();
  };
}

// desktop-src/components/kit.tsx
import { Skeleton, useI18n } from "@hermes/plugin-sdk";
import { createContext, useContext } from "react";

// desktop-src/lib/format.ts
import { host } from "@hermes/plugin-sdk";
var VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
function isVideoId(value) {
  return typeof value === "string" && VIDEO_ID.test(value);
}
function youtubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}
function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s % 3600 / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}
var numberFormats = /* @__PURE__ */ new Map();
function numberFormat(locale, key, options) {
  const id = `${locale}|${key}`;
  let fmt = numberFormats.get(id);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(locale || "en", options);
    } catch {
      fmt = new Intl.NumberFormat("en", options);
    }
    numberFormats.set(id, fmt);
  }
  return fmt;
}
var COMPACT = {
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 1,
  maximumSignificantDigits: 3,
  roundingPriority: "lessPrecision"
};
function formatCompact(value, locale) {
  if (value == null || !Number.isFinite(value)) return "";
  return numberFormat(locale, "compact", COMPACT).format(value);
}
function formatCount(value, locale) {
  if (!Number.isFinite(value)) return String(value);
  return numberFormat(locale, "count", {}).format(value);
}
var RELATIVE_UNITS = [
  ["year", 365 * 86400],
  ["month", 30 * 86400],
  ["week", 7 * 86400],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60]
];
function formatRelativeTime(tsSeconds, nowMs, locale) {
  if (tsSeconds == null || !Number.isFinite(tsSeconds)) return "";
  const diff = tsSeconds - nowMs / 1e3;
  const abs = Math.abs(diff);
  let fmt;
  try {
    fmt = new Intl.RelativeTimeFormat(locale || "en", { numeric: "auto", style: "short" });
  } catch {
    fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });
  }
  for (const [unit, size] of RELATIVE_UNITS) if (abs >= size) return fmt.format(Math.round(diff / size), unit);
  return fmt.format(0, "minute");
}
function openExternal(url) {
  const os = maybePluginContext()?.os;
  if (os?.openExternal) {
    void os.openExternal(url).then((ok) => {
      if (!ok) host.notify({ kind: "info", message: url });
    });
    return;
  }
  host.notify({ kind: "info", message: url });
}
var videoOpener = null;
function setVideoOpener(opener) {
  videoOpener = opener;
}
function openVideo(videoId, from = {}) {
  if (videoOpener?.(videoId, from)) return;
  openOnYouTube(videoId);
}
function openOnYouTube(videoId) {
  openExternal(youtubeWatchUrl(videoId));
}
function wantsYouTube(e) {
  return !!(e.metaKey || e.ctrlKey);
}

// desktop-src/components/kit.tsx
import { Fragment, jsx } from "react/jsx-runtime";
function withClass(base, extra) {
  return extra ? `${base} ${extra}` : base;
}
function vars(values) {
  const out = {};
  for (const [k, v] of Object.entries(values)) out[cssVar(k)] = v;
  return out;
}
function SkBar({ width = "72%", shape }) {
  return /* @__PURE__ */ jsx(Skeleton, { className: cx("sk"), "data-shape": shape, style: shape ? void 0 : vars({ "sk-w": width }) });
}
function SkLines({ widths }) {
  return /* @__PURE__ */ jsx(Fragment, { children: widths.map((w, i) => /* @__PURE__ */ jsx("span", { className: cx("sk-line"), children: /* @__PURE__ */ jsx(SkBar, { width: w }) }, i)) });
}
function useLocale() {
  try {
    const value = useI18n();
    return typeof value?.locale === "string" && value.locale ? value.locale : "en";
  } catch {
    return "en";
  }
}
function useUiLocale() {
  return useLocale().toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}
function formatRelative(tsSeconds, nowMs, locale) {
  return formatRelativeTime(tsSeconds, nowMs, locale);
}
function formatNumber(value, locale) {
  return formatCount(value, locale);
}
function useFormatCount() {
  const locale = useLocale();
  return (value) => formatCount(value, locale);
}
var PersistentActionsContext = createContext(false);
var GridContext = createContext(false);
function useInGrid() {
  return useContext(GridContext);
}

// desktop-src/components/Page.tsx
import { jsx as jsx2, jsxs } from "react/jsx-runtime";
function Page({ title, subtitle, actions, toolbar, banner, narrow, children }) {
  return /* @__PURE__ */ jsxs("div", { className: cx("page"), "data-part": "page", "data-narrow": narrow ? "true" : void 0, children: [
    title || actions ? /* @__PURE__ */ jsxs("header", { className: cx("page-head"), "data-part": "page-head", children: [
      /* @__PURE__ */ jsxs("div", { className: cx("page-titles"), children: [
        title ? /* @__PURE__ */ jsx2("h1", { className: cx("page-title t-title truncate"), children: title }) : null,
        subtitle ? /* @__PURE__ */ jsx2("p", { className: cx("page-sub t-body truncate"), children: subtitle }) : null
      ] }),
      actions ? /* @__PURE__ */ jsx2("div", { className: cx("page-actions"), children: actions }) : null
    ] }) : null,
    toolbar ? /* @__PURE__ */ jsx2("div", { className: cx("page-toolbar"), "data-part": "page-toolbar", children: toolbar }) : null,
    banner ? /* @__PURE__ */ jsx2("div", { className: cx("page-banner"), "data-part": "page-banner", children: banner }) : null,
    /* @__PURE__ */ jsx2("div", { className: cx("page-body"), "data-part": "page-body", children: /* @__PURE__ */ jsx2("div", { className: cx("page-inner"), children }) })
  ] });
}
function Section({ title, count: count2, description, actions, children, id }) {
  const fmt = useFormatCount();
  const head = title || description || actions;
  return /* @__PURE__ */ jsxs("section", { className: cx("section"), "data-part": "section", id, children: [
    head ? /* @__PURE__ */ jsxs("div", { className: cx("section-head"), children: [
      /* @__PURE__ */ jsxs("div", { className: cx("section-titles"), children: [
        title ? /* @__PURE__ */ jsxs("h2", { className: cx("section-title t-head"), children: [
          /* @__PURE__ */ jsx2("span", { className: cx("truncate"), children: title }),
          count2 != null ? /* @__PURE__ */ jsx2("span", { className: cx("section-count t-label num"), children: fmt(count2) }) : null
        ] }) : null,
        description ? /* @__PURE__ */ jsx2("p", { className: cx("section-desc t-body"), children: description }) : null
      ] }),
      actions ? /* @__PURE__ */ jsx2("div", { className: cx("section-actions"), children: actions }) : null
    ] }) : null,
    children
  ] });
}
function Toolbar({ children, end }) {
  return /* @__PURE__ */ jsxs("div", { className: cx("toolbar"), "data-part": "toolbar", children: [
    /* @__PURE__ */ jsx2("div", { className: cx("toolbar-start"), children }),
    end ? /* @__PURE__ */ jsx2("div", { className: cx("toolbar-end"), children: end }) : null
  ] });
}
var BANNER_ICON = { info: "info", warning: "warning", error: "error" };
function Banner({ tone = "info", title, children, action, onDismiss, icon }) {
  const t = useT();
  return /* @__PURE__ */ jsxs("div", { className: cx("banner t-body"), "data-part": "banner", "data-tone": tone, role: tone === "error" ? "alert" : "status", children: [
    /* @__PURE__ */ jsx2("span", { className: cx("banner-icon"), "aria-hidden": "true", children: /* @__PURE__ */ jsx2(Codicon, { name: icon ?? BANNER_ICON[tone], size: 15 }) }),
    /* @__PURE__ */ jsxs("div", { className: cx("banner-text"), children: [
      title ? /* @__PURE__ */ jsx2("strong", { className: cx("banner-title"), children: title }) : null,
      children
    ] }),
    action || onDismiss ? /* @__PURE__ */ jsxs("div", { className: cx("banner-actions"), children: [
      action ? /* @__PURE__ */ jsx2(Button, { variant: "ghost", size: "xs", "data-part": "banner-action", onClick: action.onClick, children: action.label }) : null,
      onDismiss ? /* @__PURE__ */ jsx2(Button, { variant: "ghost", size: "icon-xs", "data-part": "banner-dismiss", "aria-label": t("kit.banner.dismiss"), onClick: onDismiss, children: /* @__PURE__ */ jsx2(Codicon, { name: "close", size: 14 }) }) : null
    ] }) : null
  ] });
}
function Stack({ children, direction = "column", gap = 2, align, justify, wrap }) {
  return /* @__PURE__ */ jsx2(
    "div",
    {
      className: cx("stack"),
      "data-part": "stack",
      "data-direction": direction,
      "data-gap": gap,
      "data-align": align,
      "data-justify": justify,
      "data-wrap": wrap ? "true" : void 0,
      children
    }
  );
}

// desktop-src/components/DialogFrame.tsx
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@hermes/plugin-sdk";
import { useCallback as useCallback2, useLayoutEffect, useRef, useState } from "react";
import { jsx as jsx3, jsxs as jsxs2 } from "react/jsx-runtime";
function DialogFrame({ title, description, onClose, footer, children, className, size = "md", onEscapeKeyDown }) {
  const bodyRef = useRef(null);
  const [overflow, setOverflow] = useState("none");
  const measure2 = useCallback2(() => {
    const el = bodyRef.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setOverflow(top && bottom ? "both" : top ? "top" : bottom ? "bottom" : "none");
  }, []);
  useLayoutEffect(() => {
    measure2();
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure2);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => ro.disconnect();
  }, [measure2, children]);
  return /* @__PURE__ */ jsx3(
    Dialog,
    {
      open: true,
      onOpenChange: (open) => {
        if (!open) onClose();
      },
      children: /* @__PURE__ */ jsxs2(DialogContent, { className: withClass(cx("dialog"), className), "data-size": size, ...onEscapeKeyDown ? { onEscapeKeyDown } : {}, children: [
        /* @__PURE__ */ jsxs2(DialogHeader, { children: [
          /* @__PURE__ */ jsx3(DialogTitle, { children: title }),
          description ? /* @__PURE__ */ jsx3(DialogDescription, { children: description }) : null
        ] }),
        /* @__PURE__ */ jsx3("div", { className: cx("dialog-scroll"), "data-part": "dialog-scroll", "data-overflow": overflow, children: /* @__PURE__ */ jsx3("div", { className: cx("dialog-body"), "data-part": "dialog-body", ref: bodyRef, onScroll: measure2, children }) }),
        footer ? /* @__PURE__ */ jsx3(DialogFooter, { children: footer }) : null
      ] })
    }
  );
}

// desktop-src/components/Grid.tsx
import { useEffect as useEffect2, useLayoutEffect as useLayoutEffect2, useRef as useRef3, useState as useState4 } from "react";

// desktop-src/components/ChannelAvatar.tsx
import { profileColor, profileColorSoft } from "@hermes/plugin-sdk";
import { useState as useState2 } from "react";

// desktop-src/lib/safe-url.ts
var PAGE_HOSTS = /* @__PURE__ */ new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
var IMAGE_HOST_SUFFIXES = ["ggpht.com", "googleusercontent.com", "ytimg.com"];
function parse(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:" || u.username || u.password || u.port && u.port !== "443") return null;
    return u;
  } catch {
    return null;
  }
}
function youtubeChannelPage(channelId) {
  return `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`;
}
function safeChannelUrl(url, channelId) {
  const u = parse(url);
  if (!u || !PAGE_HOSTS.has(u.hostname.toLowerCase())) return youtubeChannelPage(channelId);
  return `https://www.youtube.com${u.pathname}${u.search}`;
}
function safeImageUrl(url) {
  const u = parse(url);
  if (!u) return null;
  const host28 = u.hostname.toLowerCase();
  return IMAGE_HOST_SUFFIXES.some((s) => host28 === s || host28.endsWith(`.${s}`)) ? u.href : null;
}

// desktop-src/components/ChannelAvatar.tsx
import { jsx as jsx4 } from "react/jsx-runtime";
function initialOf(title) {
  return (title.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toLocaleUpperCase();
}
function toneOf(title) {
  try {
    return profileColor(title.trim() || null) ?? "var(--ui-text-secondary)";
  } catch {
    return "var(--ui-text-secondary)";
  }
}
function softOf(tone) {
  try {
    return profileColorSoft(tone, 18);
  } catch {
    return "var(--ui-bg-tertiary)";
  }
}
function ChannelAvatar({ title, thumb: raw, size = 28, className }) {
  const thumb = safeImageUrl(raw);
  const [broken, setBroken] = useState2(null);
  const style = { width: size, height: size, minWidth: size };
  const classes = withClass(cx("avatar"), className);
  if (thumb && broken !== thumb) {
    return /* @__PURE__ */ jsx4(
      "img",
      {
        src: thumb,
        alt: "",
        "data-part": "avatar",
        "data-avatar": true,
        loading: "lazy",
        decoding: "async",
        referrerPolicy: "no-referrer",
        onError: () => setBroken(thumb),
        style,
        className: classes
      }
    );
  }
  const tone = toneOf(title);
  return /* @__PURE__ */ jsx4(
    "span",
    {
      "aria-hidden": "true",
      "data-part": "avatar",
      "data-fallback": "true",
      style: { ...style, fontSize: Math.max(9, Math.round(size * 0.44)), ...vars({ "avatar-tone": tone, "avatar-soft": softOf(tone) }) },
      className: withClass(cx("avatar avatar-fallback"), className),
      children: initialOf(title)
    }
  );
}
function ChannelAvatarSkeleton({ size = 28 }) {
  return /* @__PURE__ */ jsx4("span", { "aria-hidden": "true", "data-part": "avatar", "data-skeleton": true, style: { width: size, height: size, minWidth: size }, className: cx("avatar"), children: /* @__PURE__ */ jsx4(SkBar, { shape: "round" }) });
}

// desktop-src/components/misc.tsx
import { Codicon as Codicon2 } from "@hermes/plugin-sdk";
import { jsx as jsx5, jsxs as jsxs3 } from "react/jsx-runtime";
var WHY_ICON = {
  folder: "folder",
  tag: "tag",
  channel: "account",
  theme: "sparkle",
  hn: "flame",
  list: "list-unordered"
};
function Why({ why, subject }) {
  const t = useT();
  if (!why) return /* @__PURE__ */ jsx5("p", { className: cx("why t-label"), "data-part": "why", "aria-hidden": "true" });
  const repeats = !!subject && why.via === "channel" && why.label.trim().toLocaleLowerCase() === subject.trim().toLocaleLowerCase();
  if (repeats && !why.detail) return /* @__PURE__ */ jsx5("p", { className: cx("why t-label"), "data-part": "why", "data-via": why.via, "aria-hidden": "true" });
  const label = repeats ? why.detail ?? "" : why.label;
  const detail = repeats ? null : why.detail;
  return /* @__PURE__ */ jsxs3("p", { className: cx("why t-label"), "data-part": "why", "data-via": why.via, children: [
    /* @__PURE__ */ jsx5("span", { className: cx("sr"), children: t("kit.why.label") }),
    /* @__PURE__ */ jsx5(Codicon2, { name: WHY_ICON[why.via] ?? "info", size: 12, className: cx("why-icon") }),
    /* @__PURE__ */ jsx5("span", { className: cx("why-label"), children: label }),
    detail ? /* @__PURE__ */ jsxs3("span", { className: cx("why-detail"), children: [
      "· ",
      detail
    ] }) : null
  ] });
}
function Count({ value, tone = "neutral", label }) {
  const locale = useLocale();
  return /* @__PURE__ */ jsx5("span", { className: cx("count num"), "data-part": "count", "data-tone": tone, "aria-label": label, children: /* @__PURE__ */ jsx5("span", { className: cx("count-value"), "data-part": "count-value", children: formatNumber(value, locale) }, value) });
}
function Stat({ label, value, hint }) {
  return /* @__PURE__ */ jsxs3("div", { className: cx("stat"), "data-part": "stat", children: [
    /* @__PURE__ */ jsx5("span", { className: cx("stat-label t-label"), children: label }),
    /* @__PURE__ */ jsx5("span", { className: cx("stat-value t-title"), children: typeof value === "number" ? /* @__PURE__ */ jsx5(Count, { value }) : value }),
    hint ? /* @__PURE__ */ jsx5("span", { className: cx("stat-hint t-label"), children: hint }) : null
  ] });
}
function StatSkeleton() {
  return /* @__PURE__ */ jsxs3("div", { className: cx("stat"), "data-part": "stat", "data-skeleton": true, "aria-hidden": "true", children: [
    /* @__PURE__ */ jsx5("span", { className: cx("stat-label t-label"), children: /* @__PURE__ */ jsx5(SkLines, { widths: ["48px"] }) }),
    /* @__PURE__ */ jsx5("span", { className: cx("stat-value t-title"), children: /* @__PURE__ */ jsx5(SkLines, { widths: ["36px"] }) })
  ] });
}
function Dot({ tone = "neutral", label }) {
  return /* @__PURE__ */ jsx5(
    "span",
    {
      className: cx("dot"),
      "data-part": "dot",
      "data-tone": tone,
      role: label ? "img" : void 0,
      "aria-label": label,
      "aria-hidden": label ? void 0 : true
    }
  );
}

// desktop-src/components/Thumb.tsx
import { Badge, Codicon as Codicon3 } from "@hermes/plugin-sdk";
import { useEffect, useRef as useRef2, useState as useState3 } from "react";

// desktop-src/lib/extras.ts
import { atom, useValue } from "@hermes/plugin-sdk";
var $extras = atom(null);
var EXTRAS_PAGE_READY = false;
onShellReset(() => {
  $extras.set(null);
});
function setExtras(next) {
  $extras.set(next);
}
function useExtras() {
  return useValue($extras);
}
var EXTRAS_REFRESH_MS = 6e4;
function thumbnailUrl(videoId, extras, size = "mq") {
  const id = encodeURIComponent(videoId);
  if (extras?.honest_thumbnails) return `https://i.ytimg.com/vi/${id}/hq2.jpg`;
  return `https://i.ytimg.com/vi/${id}/${size}default.jpg`;
}

// desktop-src/components/Thumb.tsx
import { jsx as jsx6, jsxs as jsxs4 } from "react/jsx-runtime";
var MARK_BADGES = { live: "live", premiere: "premiere", upcoming: "premiere" };
var MARK_ICON = {
  video: "device-camera-video",
  short: "device-mobile",
  live: "broadcast",
  premiere: "calendar"
};
var MARK_KEY = {
  video: "video.kind.video",
  short: "video.short",
  live: "video.live",
  premiere: "video.premiere"
};
function videoMarkKind(isShort, badges) {
  for (const b of badges ?? []) if (MARK_BADGES[b]) return MARK_BADGES[b];
  return isShort === true ? "short" : isShort === false ? "video" : "unknown";
}
function hasVideoMark(durationS, isShort, badges) {
  return videoMarkKind(isShort, badges) !== "unknown" || !!formatDuration(durationS);
}
function spokenDuration(seconds, t, locale) {
  if (!formatDuration(seconds)) return "";
  const s = Math.floor(seconds);
  const parts = [
    ["video.duration.h", Math.floor(s / 3600)],
    ["video.duration.m", Math.floor(s % 3600 / 60)],
    ["video.duration.s", s % 60]
  ];
  const out = parts.filter(([, n]) => n > 0).map(([key, n]) => t(key, { count: formatNumber(n, locale) }));
  return out.length ? out.join(" ") : t("video.duration.s", { count: formatNumber(0, locale) });
}
function VideoMark({ durationS, isShort, badges, placement = "thumb" }) {
  const t = useT();
  const locale = useLocale();
  const kind = videoMarkKind(isShort, badges);
  const duration = formatDuration(durationS);
  if (kind === "unknown" && !duration) return null;
  const name = kind === "unknown" ? "" : t(MARK_KEY[kind]);
  const label = [name, spokenDuration(durationS, t, locale)].filter(Boolean).join(" · ");
  return /* @__PURE__ */ jsxs4(
    "span",
    {
      className: cx(placement === "thumb" ? "thumb-pill thumb-mark" : "card-mark"),
      "data-part": "thumb-mark",
      "data-kind": kind,
      "data-placement": placement,
      role: "img",
      "aria-label": label,
      title: label,
      children: [
        kind !== "unknown" ? /* @__PURE__ */ jsx6(Codicon3, { name: MARK_ICON[kind], size: 12, className: cx("mark-icon") }) : null,
        kind !== "unknown" && kind !== "video" ? /* @__PURE__ */ jsx6("span", { className: cx("mark-kind"), children: name }) : null,
        duration ? /* @__PURE__ */ jsx6("span", { className: cx("mark-duration"), "data-part": "thumb-duration", children: duration }) : null
      ]
    }
  );
}
var BADGE_ICON = { hn: "flame" };
var BADGE_KEY = { hn: "video.badge.hn" };
function fallbackFor(primary, videoId) {
  const id = encodeURIComponent(videoId);
  return primary.includes("/mqdefault.jpg") ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}
function Thumb({ videoId, title, durationS, progress, watched, isNew, isShort, badges, src, size = "mq", mark: mark2 = true, children }) {
  const t = useT();
  const extras = useExtras();
  const primary = src ?? thumbnailUrl(videoId, extras, size);
  const candidates = [primary, fallbackFor(primary, videoId)];
  const [state, setState] = useState3({ primary, attempt: 0, loaded: false });
  const current2 = state.primary === primary ? state : { primary, attempt: 0, loaded: false };
  const imgRef = useRef2(null);
  const url = candidates[current2.attempt];
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setState({ primary, attempt: current2.attempt, loaded: true });
  }, [url, primary, current2.attempt]);
  const shownBadges = badges?.filter((b) => !MARK_BADGES[b]) ?? [];
  const pct = progress != null && progress > 0 ? Math.round(Math.min(1, progress) * 100) : null;
  return /* @__PURE__ */ jsxs4(
    "div",
    {
      className: cx("thumb"),
      "data-part": "thumb",
      "data-watched": watched ? "true" : void 0,
      "data-has-progress": pct != null ? "true" : void 0,
      children: [
        url ? /* @__PURE__ */ jsx6(
          "img",
          {
            ref: imgRef,
            "data-thumb": true,
            className: cx("thumb-img"),
            src: url,
            alt: "",
            loading: "lazy",
            decoding: "async",
            referrerPolicy: "no-referrer",
            "data-loaded": current2.loaded ? "true" : "false",
            onLoad: () => setState({ primary, attempt: current2.attempt, loaded: true }),
            onError: () => setState({ primary, attempt: current2.attempt + 1, loaded: false })
          },
          url
        ) : /* @__PURE__ */ jsx6("div", { className: cx("thumb-fallback"), "data-part": "thumb-fallback", role: "img", "aria-label": title || t("kit.thumb.unavailable"), children: /* @__PURE__ */ jsx6(Codicon3, { name: "play", size: 22 }) }),
        watched ? /* @__PURE__ */ jsx6("div", { className: cx("thumb-veil"), "data-part": "thumb-veil", children: /* @__PURE__ */ jsxs4("span", { className: cx("thumb-pill"), children: [
          /* @__PURE__ */ jsx6(Codicon3, { name: "check", size: 11 }),
          t("kit.thumb.watched")
        ] }) }) : null,
        isNew ? /* @__PURE__ */ jsx6("span", { className: cx("thumb-new"), "data-part": "thumb-new", role: "img", "aria-label": t("kit.thumb.new") }) : null,
        mark2 ? /* @__PURE__ */ jsx6(VideoMark, { durationS, isShort, badges }) : null,
        shownBadges.length ? /* @__PURE__ */ jsx6("span", { className: cx("thumb-badges"), "data-part": "thumb-badges", children: shownBadges.map((b) => /* @__PURE__ */ jsxs4(Badge, { size: "xs", variant: "muted", className: cx("thumb-pill"), "data-badge": b, children: [
          BADGE_ICON[b] ? /* @__PURE__ */ jsx6(Codicon3, { name: BADGE_ICON[b], size: 11 }) : null,
          BADGE_KEY[b] ? t(BADGE_KEY[b]) : b
        ] }, b)) }) : null,
        pct != null ? /* @__PURE__ */ jsx6(
          "div",
          {
            className: cx("thumb-progress"),
            "data-part": "thumb-progress",
            role: "progressbar",
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": pct,
            "aria-label": t("kit.thumb.progress", { percent: pct }),
            children: /* @__PURE__ */ jsx6("span", { className: cx("thumb-progress-fill"), style: vars({ progress: `${pct}%` }) })
          }
        ) : null,
        children
      ]
    }
  );
}
function ThumbSkeleton() {
  return /* @__PURE__ */ jsx6("div", { className: cx("thumb"), "data-part": "thumb", "data-skeleton": true, "aria-hidden": "true", children: /* @__PURE__ */ jsx6(SkBar, { shape: "block" }) });
}

// desktop-src/components/VideoCard.tsx
import { Fragment as Fragment2, jsx as jsx7, jsxs as jsxs5 } from "react/jsx-runtime";
function VideoCard({ item, variant, layout, actions, onOpen, progress, now, className }) {
  const t = useT();
  const locale = useLocale();
  const inGrid = useInGrid();
  const kind = variant ?? (layout === "row" ? "row" : "grid");
  const featured = kind === "featured";
  const row = kind === "row";
  const { video, channel, why, badges, is_new } = item;
  const metaMark = row && hasVideoMark(video.duration_s, video.is_short, badges);
  const channelTitle = channel?.title ?? video.channel_title ?? "";
  const open = () => onOpen ? onOpen(video.id) : openVideo(video.id, { item: item.state !== void 0 ? item : null });
  const when = formatRelative(video.published_at, now ?? Date.now(), locale);
  const actionsBox = actions ? /* @__PURE__ */ jsx7("div", { className: cx("card-actions"), "data-part": "actions", "data-persistent": featured ? "true" : void 0, children: featured ? /* @__PURE__ */ jsx7(PersistentActionsContext.Provider, { value: true, children: actions }) : actions }) : null;
  return /* @__PURE__ */ jsx7(
    "article",
    {
      className: withClass(cx("card"), className),
      "data-part": "card",
      "data-variant": kind,
      "data-video": video.id,
      "data-new": is_new ? "true" : "false",
      "data-state": item.state ?? void 0,
      children: /* @__PURE__ */ jsxs5("div", { className: cx("card-frame"), children: [
        /* @__PURE__ */ jsxs5("div", { className: cx("card-media"), "data-part": "media", children: [
          /* @__PURE__ */ jsx7(
            Thumb,
            {
              videoId: video.id,
              title: video.title,
              durationS: video.duration_s,
              progress,
              watched: item.state === "watched",
              isNew: is_new,
              isShort: video.is_short,
              badges,
              size: featured ? "hq" : "mq",
              mark: !row
            }
          ),
          kind === "grid" || kind === "compact" ? actionsBox : null
        ] }),
        /* @__PURE__ */ jsxs5("div", { className: cx("card-body"), "data-part": "body", children: [
          /* @__PURE__ */ jsx7(Why, { why, subject: channelTitle }),
          /* @__PURE__ */ jsx7("h3", { className: cx("card-title", featured ? "t-title" : "t-head"), "data-part": "title", children: /* @__PURE__ */ jsx7(
            "a",
            {
              href: youtubeWatchUrl(video.id),
              className: cx("bare card-open"),
              "data-open-video": true,
              onClick: (e) => {
                e.preventDefault();
                if (wantsYouTube(e)) openOnYouTube(video.id);
                else open();
              },
              onAuxClick: (e) => {
                e.preventDefault();
                if (e.button === 1) openOnYouTube(video.id);
              },
              tabIndex: inGrid ? -1 : void 0,
              children: video.title
            }
          ) }),
          featured && video.description ? /* @__PURE__ */ jsx7("p", { className: cx("card-excerpt t-body"), "data-part": "excerpt", children: video.description }) : null,
          /* @__PURE__ */ jsxs5("div", { className: cx("card-meta t-label"), "data-part": "meta", children: [
            /* @__PURE__ */ jsx7(ChannelAvatar, { title: channelTitle, thumb: channel?.thumb, size: featured ? 20 : 16 }),
            /* @__PURE__ */ jsx7("span", { className: cx("card-channel"), children: channelTitle }),
            video.views != null ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
              /* @__PURE__ */ jsx7("span", { className: cx("card-sep"), "data-kind": "views", "aria-hidden": "true", children: "·" }),
              /* @__PURE__ */ jsx7("span", { className: cx("card-stat"), "data-kind": "views", children: t("video.views", { count: formatCompact(video.views, locale) }) })
            ] }) : null,
            when ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
              /* @__PURE__ */ jsx7("span", { className: cx("card-sep"), "aria-hidden": "true", children: "·" }),
              /* @__PURE__ */ jsx7("span", { className: cx("card-stat"), "data-kind": "time", children: /* @__PURE__ */ jsx7("time", { dateTime: video.published_at ? new Date(video.published_at * 1e3).toISOString() : void 0, children: when }) })
            ] }) : null,
            metaMark ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
              /* @__PURE__ */ jsx7("span", { className: cx("card-sep"), "data-kind": "mark", "aria-hidden": "true", children: "·" }),
              /* @__PURE__ */ jsx7(VideoMark, { durationS: video.duration_s, isShort: video.is_short, badges, placement: "meta" })
            ] }) : null
          ] }),
          featured ? actionsBox : null
        ] }),
        kind === "row" ? actionsBox : null
      ] })
    }
  );
}
function VideoCardSkeleton({ variant = "grid", actions = false }) {
  const featured = variant === "featured";
  return /* @__PURE__ */ jsx7("article", { className: cx("card"), "data-part": "card", "data-variant": variant, "data-skeleton": true, "aria-busy": "true", children: /* @__PURE__ */ jsxs5("div", { className: cx("card-frame"), "aria-hidden": "true", children: [
    /* @__PURE__ */ jsx7("div", { className: cx("card-media"), "data-part": "media", children: /* @__PURE__ */ jsx7(ThumbSkeleton, {}) }),
    /* @__PURE__ */ jsxs5("div", { className: cx("card-body"), "data-part": "body", children: [
      /* @__PURE__ */ jsx7("div", { className: cx("why t-label"), "data-part": "why", children: /* @__PURE__ */ jsx7(SkBar, { width: "38%" }) }),
      /* @__PURE__ */ jsx7("div", { className: cx("card-title", featured ? "t-title" : "t-head"), "data-part": "title", "data-skeleton": true, children: /* @__PURE__ */ jsx7(SkLines, { widths: variant === "row" ? ["78%"] : ["94%", "58%"] }) }),
      featured ? /* @__PURE__ */ jsx7("div", { className: cx("card-excerpt t-body"), "data-part": "excerpt", "data-skeleton": true, children: /* @__PURE__ */ jsx7(SkLines, { widths: ["100%", "82%"] }) }) : null,
      /* @__PURE__ */ jsxs5("div", { className: cx("card-meta t-label"), "data-part": "meta", children: [
        /* @__PURE__ */ jsx7(ChannelAvatarSkeleton, { size: featured ? 20 : 16 }),
        /* @__PURE__ */ jsx7(SkBar, { width: "46%" })
      ] }),
      featured && actions ? /* @__PURE__ */ jsx7("div", { className: cx("card-actions"), "data-part": "actions", "data-persistent": "true", children: /* @__PURE__ */ jsx7("span", { className: cx("card-actions-sk"), children: /* @__PURE__ */ jsx7(SkBar, { shape: "block" }) }) }) : null
    ] })
  ] }) });
}

// desktop-src/components/Grid.tsx
import { Fragment as Fragment3, jsx as jsx8 } from "react/jsx-runtime";
var DENSITIES = ["comfortable", "compact", "list"];
var GRID_SHORTCUTS = { w: "watched", l: "later", e: "archive" };
function cardVariantFor(density) {
  return density === "list" ? "row" : density === "compact" ? "compact" : "grid";
}
function measureColumns(root) {
  const rows = root ? [...root.querySelectorAll(':scope > [role="row"]')] : [];
  if (!rows.length) return 1;
  const first = rows[0].getBoundingClientRect();
  if (first.width === 0 && first.height === 0) return 1;
  let n = 0;
  for (const r of rows) {
    if (Math.abs(r.getBoundingClientRect().top - first.top) > 2) break;
    n++;
  }
  return Math.max(1, n);
}
function isTextField(el) {
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}
function Grid(props) {
  const {
    items,
    getKey,
    renderItem,
    label,
    density = "comfortable",
    columns,
    onOpen,
    onAction,
    onSearch,
    shortcuts = GRID_SHORTCUTS,
    loading,
    skeletonCount,
    empty
  } = props;
  const ref = useRef3(null);
  const [activeKey, setActiveKey] = useState4(null);
  const lastIndex = useRef3(0);
  const keys = items.map((it, i) => getKey(it, i));
  let activeIndex = activeKey === null ? -1 : keys.indexOf(activeKey);
  if (activeIndex < 0) activeIndex = Math.max(0, Math.min(lastIndex.current, items.length - 1));
  useEffect2(() => {
    lastIndex.current = activeIndex;
  });
  const hadFocus = useRef3(false);
  useEffect2(() => {
    if (!hadFocus.current) return;
    const root = ref.current;
    if (root && !root.contains(document.activeElement)) root.querySelector(`[data-index="${activeIndex}"]`)?.focus();
  }, [items.length, activeIndex]);
  if (loading) return /* @__PURE__ */ jsx8(GridSkeleton, { density, count: skeletonCount, label });
  if (!items.length) return /* @__PURE__ */ jsx8(Fragment3, { children: empty ?? null });
  const focusIndex = (i) => {
    const n = Math.max(0, Math.min(items.length - 1, i));
    setActiveKey(keys[n]);
    const el = ref.current?.querySelector(`[data-index="${n}"]`);
    el?.focus();
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };
  const onKeyDown = (e) => {
    const target = e.target;
    const cell = target.closest('[role="gridcell"]');
    if (!cell || !ref.current?.contains(cell) || isTextField(target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const idx = Number(cell.getAttribute("data-index"));
    const cols = columns ?? measureColumns(ref.current);
    const onCell = target === cell;
    switch (e.key) {
      case "ArrowRight":
      case "j":
        focusIndex(idx + 1);
        break;
      case "ArrowLeft":
      case "k":
        focusIndex(idx - 1);
        break;
      case "ArrowDown":
        if (idx + cols < items.length) focusIndex(idx + cols);
        break;
      case "ArrowUp":
        if (idx - cols >= 0) focusIndex(idx - cols);
        break;
      case "Home":
        focusIndex(0);
        break;
      case "End":
        focusIndex(items.length - 1);
        break;
      case "Enter":
        if (!onCell) return;
        onOpen?.(items[idx], idx);
        break;
      case "/":
        if (!onSearch) return;
        onSearch();
        break;
      default: {
        const action = shortcuts[e.key];
        if (!action || !onAction) return;
        onAction(action, items[idx], idx);
      }
    }
    e.preventDefault();
    e.stopPropagation();
  };
  const onFocus = (e) => {
    hadFocus.current = true;
    const cell = e.target.closest('[role="gridcell"]');
    const key = cell?.getAttribute("data-key");
    if (key != null && key !== activeKey) setActiveKey(key);
  };
  return /* @__PURE__ */ jsx8(GridContext.Provider, { value: true, children: /* @__PURE__ */ jsx8(
    "div",
    {
      ref,
      role: "grid",
      "aria-label": label,
      "aria-rowcount": items.length,
      className: cx("grid"),
      "data-part": "grid",
      "data-density": density,
      onKeyDown,
      onFocus,
      onBlur: (e) => {
        if (!ref.current?.contains(e.relatedTarget)) hadFocus.current = false;
      },
      children: items.map((item, i) => /* @__PURE__ */ jsx8("div", { role: "row", "aria-rowindex": i + 1, className: cx("grid-row"), style: vars({ i }), children: /* @__PURE__ */ jsx8(
        "div",
        {
          role: "gridcell",
          className: cx("grid-cell"),
          tabIndex: i === activeIndex ? 0 : -1,
          "data-index": i,
          "data-key": keys[i],
          children: renderItem(item, { index: i, active: i === activeIndex })
        }
      ) }, keys[i]))
    }
  ) });
}
function resolvedColumns(el) {
  if (!el || typeof getComputedStyle !== "function") return null;
  const tracks = getComputedStyle(el).gridTemplateColumns;
  if (!tracks || tracks === "none") return null;
  const n = tracks.trim().split(/\s+/).filter((t) => /px$/.test(t)).length;
  return n > 0 ? n : null;
}
function GridSkeleton({ density = "comfortable", count: count2 = 8, rows, columns, label }) {
  const variant = cardVariantFor(density);
  const ref = useRef3(null);
  const [measured, setMeasured] = useState4(null);
  useLayoutEffect2(() => {
    if (columns != null) return;
    const read2 = () => setMeasured(resolvedColumns(ref.current));
    read2();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read2);
    ro.observe(el);
    return () => ro.disconnect();
  }, [columns, density]);
  const cols = density === "list" ? 1 : Math.max(1, columns ?? measured ?? 1);
  const total = rows != null ? Math.max(1, rows) * cols : Math.ceil(Math.max(1, count2) / cols) * cols;
  return /* @__PURE__ */ jsx8("div", { ref, className: cx("grid"), "data-part": "grid", "data-density": density, "aria-busy": "true", "aria-label": label, children: Array.from({ length: total }, (_, i) => /* @__PURE__ */ jsx8("div", { className: cx("grid-row"), style: vars({ i }), children: /* @__PURE__ */ jsx8(VideoCardSkeleton, { variant }) }, i)) });
}

// desktop-src/components/QuickActions.tsx
import { Button as Button2, Codicon as Codicon4, Kbd, Tip } from "@hermes/plugin-sdk";
import { useContext as useContext2 } from "react";
import { jsx as jsx9, jsxs as jsxs6 } from "react/jsx-runtime";
var TIP_DELAY_MS = 150;
function tipText(name, shortcut) {
  return shortcut ? `${name} · ${shortcut.toUpperCase()}` : name;
}
function QuickActions({ actions, label, showLabels }) {
  const t = useT();
  const inGrid = useInGrid();
  const persistent = useContext2(PersistentActionsContext);
  const labels = showLabels ?? persistent;
  return /* @__PURE__ */ jsx9("div", { className: cx("quick"), role: "group", "aria-label": label ?? t("kit.actions.label"), "data-part": "quick", "data-labels": labels ? "true" : void 0, children: actions.map((a) => {
    const name = a.hint ?? a.label;
    const btn = /* @__PURE__ */ jsxs6(
      Button2,
      {
        variant: "ghost",
        size: "xs",
        className: cx("quick-btn"),
        "data-action": a.id,
        "aria-label": a.shortcut ? t("kit.shortcut_label", { label: name, key: a.shortcut }) : name,
        "aria-pressed": a.pressed === void 0 ? void 0 : a.pressed,
        tabIndex: inGrid ? -1 : void 0,
        onClick: (e) => {
          e.stopPropagation();
          a.onSelect();
        },
        children: [
          /* @__PURE__ */ jsx9(Codicon4, { name: a.icon, size: 14 }),
          labels ? /* @__PURE__ */ jsx9("span", { className: cx("quick-label"), "data-part": "quick-label", children: a.label }) : null,
          a.shortcut ? /* @__PURE__ */ jsx9(Kbd, { size: "sm", className: cx("quick-kbd"), children: a.shortcut }) : null
        ]
      },
      a.id
    );
    return labels ? btn : /* @__PURE__ */ jsx9(Tip, { label: tipText(name, a.shortcut), delayDuration: TIP_DELAY_MS, side: "top", children: btn }, a.id);
  }) });
}
function useStandardQuickActions(h) {
  const t = useT();
  const out = [];
  if (h.watched) {
    const on = h.state === "watched";
    out.push({ id: "watched", label: t("kit.actions.watched"), hint: t(on ? "kit.actions.watched_undo" : "kit.actions.watched_do"), icon: "eye", shortcut: "w", onSelect: h.watched, pressed: on });
  }
  if (h.later) {
    const on = h.state === "later";
    out.push({ id: "later", label: t("kit.actions.later"), hint: t(on ? "kit.actions.later_undo" : "kit.actions.later_do"), icon: "clock", shortcut: "l", onSelect: h.later, pressed: on });
  }
  if (h.archive) out.push({ id: "archive", label: t("kit.actions.archive"), hint: t("kit.actions.archive_do"), icon: "archive", shortcut: "e", onSelect: h.archive });
  return out;
}

// desktop-src/components/nav.tsx
import {
  Button as Button3,
  Codicon as Codicon5,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SearchField,
  SegmentedControl,
  Tabs,
  TabsList,
  TabsTrigger,
  Tip as Tip2
} from "@hermes/plugin-sdk";
import {
  useCallback as useCallback3,
  useEffect as useEffect3,
  useLayoutEffect as useLayoutEffect3,
  useRef as useRef4,
  useState as useState5
} from "react";
import { jsx as jsx10, jsxs as jsxs7 } from "react/jsx-runtime";
var TAB_INK_INSET = 10;
var DRAG_EDGE_PX = 32;
var DRAG_SCROLL_STEP = 16;
var TAB_DRAG_TYPE = `application/x-${CLASS_PREFIX}tab`;
function reorderIds(ids, from, to, side) {
  const rest = ids.filter((id) => id !== from);
  const at = rest.indexOf(to);
  if (at < 0 || !ids.includes(from)) return [...ids];
  rest.splice(side === "after" ? at + 1 : at, 0, from);
  return rest;
}
function TabBar({ tabs, value, onChange, onAdd, addLabel, label, addSlot, onReorder, reorderable, menu, menuLabel, defaultMenuTab }) {
  const t = useT();
  const fmt = useFormatCount();
  const scrollRef = useRef4(null);
  const [overflow, setOverflow] = useState5("none");
  const [menuTab, setMenuTab] = useState5(defaultMenuTab ?? null);
  const dragId = useRef4(null);
  const [dragging, setDragging] = useState5(null);
  const [over, setOver] = useState5(null);
  const refocus = useRef4(null);
  const canMove = (id) => !!onReorder && (reorderable ? reorderable(id) : true);
  const movable = tabs.filter((x) => canMove(x.id)).map((x) => x.id);
  useLayoutEffect3(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    const el = [...scrollRef.current?.querySelectorAll("[data-tab-id]") ?? []].find((n) => n.getAttribute("data-tab-id") === id);
    if (el && document.activeElement !== el) el.focus();
  }, [tabs]);
  const endDrag = () => {
    dragId.current = null;
    setDragging(null);
    setOver(null);
  };
  const sideFor = (target) => {
    const from = dragId.current;
    if (!from || from === target || !canMove(target)) return null;
    return movable.indexOf(from) < movable.indexOf(target) ? "after" : "before";
  };
  const dragProps = (id) => onReorder ? {
    draggable: canMove(id),
    onDragStart: (e) => {
      if (!canMove(id)) {
        e.preventDefault();
        return;
      }
      dragId.current = id;
      setDragging(id);
      setMenuTab(null);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(TAB_DRAG_TYPE, id);
      }
    },
    onDragEnter: (e) => {
      if (sideFor(id)) e.preventDefault();
    },
    onDragOver: (e) => {
      const side = sideFor(id);
      if (!side) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      setOver((o) => o && o.id === id && o.side === side ? o : { id, side });
    },
    onDrop: (e) => {
      const side = sideFor(id);
      const from = dragId.current;
      if (side && from) {
        e.preventDefault();
        const next = reorderIds(movable, from, id, side);
        if (next.join("\n") !== movable.join("\n")) onReorder(next);
      }
      endDrag();
    },
    onDragEnd: endDrag
  } : {};
  const onScrollDragOver = (e) => {
    const el = scrollRef.current;
    if (!dragId.current || !el) return;
    const r = el.getBoundingClientRect();
    if (e.clientX > r.right - DRAG_EDGE_PX) el.scrollLeft = Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + DRAG_SCROLL_STEP);
    else if (e.clientX < r.left + DRAG_EDGE_PX) el.scrollLeft = Math.max(0, el.scrollLeft - DRAG_SCROLL_STEP);
  };
  const moveBy2 = (id, delta) => {
    const i = movable.indexOf(id);
    const j = i + delta;
    if (!onReorder || i < 0 || j < 0 || j >= movable.length) return;
    const next = [...movable];
    next.splice(i, 1);
    next.splice(j, 0, id);
    refocus.current = id;
    onReorder(next);
  };
  const onTabKeyDown = (id) => (e) => {
    if (e.altKey && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      if (!canMove(id)) return;
      e.preventDefault();
      moveBy2(id, e.key === "ArrowLeft" ? -1 : 1);
    } else if (e.key === "ContextMenu" || e.key === "F10" && e.shiftKey) {
      if (!menu?.(id)?.length) return;
      e.preventDefault();
      setMenuTab(id);
    }
  };
  const onTabContextMenu = (id) => (e) => {
    if (!menu) return;
    e.preventDefault();
    setMenuTab(menu(id)?.length ? id : null);
  };
  const measure2 = useCallback3(() => {
    const el = scrollRef.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setOverflow(start && end ? "both" : start ? "start" : end ? "end" : "none");
  }, []);
  useEffect3(() => {
    measure2();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure2);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure2, tabs.length]);
  useEffect3(() => {
    const tabs2 = scrollRef.current?.querySelectorAll("[data-tab-id]") ?? [];
    const active = [...tabs2].find((el) => el.getAttribute("data-tab-id") === value);
    active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [value]);
  const [ink, setInk] = useState5(null);
  const placeInk = useCallback3(() => {
    const box = scrollRef.current;
    const el = box ? [...box.querySelectorAll("[data-tab-id]")].find((n) => n.getAttribute("data-tab-id") === value) : null;
    if (!box || !el) return setInk(null);
    const a = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (a.width === 0) return setInk(null);
    const x = Math.round(a.left - b.left + box.scrollLeft + TAB_INK_INSET);
    const w = Math.max(0, Math.round(a.width - 2 * TAB_INK_INSET));
    setInk((prev) => prev && prev.x === x && prev.w === w ? prev : { x, w, moved: prev != null });
  }, [value]);
  useLayoutEffect3(() => {
    placeInk();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(placeInk);
    ro.observe(el);
    return () => ro.disconnect();
  }, [placeInk, tabs]);
  const select = (id) => {
    if (id !== value) onChange(id);
  };
  return /* @__PURE__ */ jsxs7("div", { className: cx("tabbar"), "data-part": "tabbar", "data-overflow": overflow, "data-ink": ink ? "true" : void 0, children: [
    /* @__PURE__ */ jsx10(Tabs, { value, onValueChange: select, className: cx("tabbar-root"), children: /* @__PURE__ */ jsxs7("div", { className: cx("tabbar-scroll"), "data-part": "tabbar-scroll", ref: scrollRef, onScroll: measure2, onDragOver: onScrollDragOver, children: [
      /* @__PURE__ */ jsx10(
        "span",
        {
          className: cx("tab-ink"),
          "data-part": "tab-ink",
          "data-moved": ink?.moved ? "true" : void 0,
          "aria-hidden": "true",
          style: ink ? vars({ "ink-x": `${ink.x}px`, "ink-w": `${ink.w}px` }) : void 0
        }
      ),
      /* @__PURE__ */ jsx10(TabsList, { "aria-label": label ?? t("kit.tabs.label"), className: cx("tabbar-list"), children: tabs.map((tab) => {
        const entries = menu?.(tab.id) ?? null;
        const hasMenu = !!entries?.length;
        const open = hasMenu && menuTab === tab.id;
        const active = tab.id === value;
        const moreLabel = menuLabel ? menuLabel(tab.label) : t("kit.tabs.menu", { name: tab.label });
        const anchor = hasMenu && active ? /* @__PURE__ */ jsx10(Tip2, { label: moreLabel, delayDuration: TIP_DELAY_MS, side: "top", children: /* @__PURE__ */ jsx10(DropdownMenuTrigger, { asChild: true, children: /* @__PURE__ */ jsx10(Button3, { variant: "ghost", size: "icon-xs", className: cx("tab-more"), "data-part": "tab-more", tabIndex: -1, "aria-label": moreLabel, children: /* @__PURE__ */ jsx10(Codicon5, { name: "ellipsis", size: 14 }) }) }) }) : open ? /* @__PURE__ */ jsx10(DropdownMenuTrigger, { asChild: true, children: /* @__PURE__ */ jsx10("span", { className: cx("tab-menu-anchor"), "aria-hidden": "true" }) }) : null;
        return /* @__PURE__ */ jsxs7(
          "span",
          {
            className: cx("tab-cell"),
            "data-tab-cell": tab.id,
            "data-drop": over?.id === tab.id ? over.side : void 0,
            "data-dragging": dragging === tab.id ? "true" : void 0,
            children: [
              /* @__PURE__ */ jsxs7(
                TabsTrigger,
                {
                  value: tab.id,
                  className: cx("tab"),
                  "data-tab-id": tab.id,
                  onClick: () => select(tab.id),
                  onKeyDown: onTabKeyDown(tab.id),
                  onContextMenu: onTabContextMenu(tab.id),
                  ...dragProps(tab.id),
                  children: [
                    tab.icon ? /* @__PURE__ */ jsx10(Codicon5, { name: tab.icon, size: 14, className: cx("tab-icon") }) : null,
                    /* @__PURE__ */ jsx10("span", { children: tab.label }),
                    tab.count ? /* @__PURE__ */ jsx10("span", { className: cx("tab-count"), "data-part": "tab-count", "aria-label": t("kit.tabs.new_count", { count: fmt(tab.count) }), children: fmt(tab.count) }) : null
                  ]
                }
              ),
              anchor ? /* @__PURE__ */ jsxs7(DropdownMenu, { open, onOpenChange: (o) => setMenuTab(o ? tab.id : null), children: [
                anchor,
                /* @__PURE__ */ jsx10(DropdownMenuContent, { align: "start", children: open && entries ? entries.flatMap((entry, i) => [
                  entry.destructive && i > 0 ? /* @__PURE__ */ jsx10(DropdownMenuSeparator, {}, `sep-${entry.id}`) : null,
                  /* @__PURE__ */ jsxs7(
                    DropdownMenuItem,
                    {
                      "data-menu": entry.id,
                      disabled: entry.disabled,
                      variant: entry.destructive ? "destructive" : void 0,
                      onSelect: () => {
                        setMenuTab(null);
                        if (!entry.disabled) entry.onSelect();
                      },
                      children: [
                        entry.icon ? /* @__PURE__ */ jsx10(Codicon5, { name: entry.icon, size: 14 }) : null,
                        entry.label
                      ]
                    },
                    entry.id
                  )
                ]) : null })
              ] }) : null
            ]
          },
          tab.id
        );
      }) })
    ] }) }),
    addSlot != null && addSlot !== false ? /* @__PURE__ */ jsx10("div", { className: cx("tab-add-slot"), "data-part": "tab-add-slot", children: addSlot }) : onAdd ? /* @__PURE__ */ jsxs7(Button3, { variant: "ghost", size: "xs", className: cx("tab-add"), "data-part": "tab-add", onClick: onAdd, children: [
      /* @__PURE__ */ jsx10(Codicon5, { name: "add", size: 14 }),
      /* @__PURE__ */ jsx10("span", { className: cx("tab-add-label"), children: addLabel ?? t("kit.tabs.add") })
    ] }) : null
  ] });
}
var TAB_SKELETON_WIDTHS = ["44px", "72px", "56px", "88px", "64px", "52px"];
function TabBarSkeleton({ count: count2 = 4 }) {
  return /* @__PURE__ */ jsx10("div", { className: cx("tabbar"), "data-part": "tabbar", "data-skeleton": true, "aria-busy": "true", children: /* @__PURE__ */ jsx10("div", { className: cx("tabbar-list"), "aria-hidden": "true", children: Array.from({ length: count2 }, (_, i) => /* @__PURE__ */ jsx10("span", { className: cx("tab-skeleton"), style: { width: TAB_SKELETON_WIDTHS[i % TAB_SKELETON_WIDTHS.length] }, children: /* @__PURE__ */ jsx10(SkBar, { width: "100%" }) }, i)) }) });
}
function ModeSwitch({ value, onChange }) {
  const t = useT();
  const options = DENSITIES.map((id) => ({ id, label: t(`kit.density.${id}`) }));
  return /* @__PURE__ */ jsx10("div", { className: cx("mode"), "data-part": "mode", role: "group", "aria-label": t("kit.density.label"), children: /* @__PURE__ */ jsx10(SegmentedControl, { options, value, onChange, sizing: "content" }) });
}
function StatusBarItem({ label, count: count2, icon, note, title, onClick }) {
  const fmt = useFormatCount();
  return /* @__PURE__ */ jsxs7("button", { type: "button", className: cx("bare baritem"), "data-part": "baritem", title, onClick, children: [
    icon ? /* @__PURE__ */ jsx10(Codicon5, { name: icon, size: 12 }) : null,
    count2 ? /* @__PURE__ */ jsx10("span", { className: cx("baritem-count"), children: fmt(count2) }) : null,
    /* @__PURE__ */ jsx10("span", { children: label }),
    note ? /* @__PURE__ */ jsx10("span", { className: cx("baritem-note"), children: note }) : null
  ] });
}
function FilterBar({ query, onQueryChange, placeholder, children, resultCount, onClear, searchRef }) {
  const t = useT();
  const fmt = useFormatCount();
  const text = placeholder ?? t("kit.filter.search");
  return /* @__PURE__ */ jsxs7("div", { className: cx("filterbar"), "data-part": "filterbar", children: [
    onQueryChange ? /* @__PURE__ */ jsx10("div", { className: cx("filterbar-search"), children: /* @__PURE__ */ jsx10(
      SearchField,
      {
        value: query ?? "",
        onChange: (next) => onQueryChange(next),
        placeholder: text,
        "aria-label": text,
        ...searchRef ? { inputRef: searchRef } : {},
        ...query ? { onClear: () => onQueryChange("") } : {}
      }
    ) }) : null,
    children ? /* @__PURE__ */ jsx10("div", { className: cx("filterbar-filters"), children }) : null,
    resultCount != null ? /* @__PURE__ */ jsx10("span", { className: cx("filterbar-count t-label"), "aria-live": "polite", children: t("kit.filter.results", { count: fmt(resultCount) }) }) : null,
    onClear ? /* @__PURE__ */ jsx10(Button3, { variant: "text", size: "xs", "data-part": "filter-clear", onClick: onClear, children: t("kit.filter.clear") }) : null
  ] });
}

// desktop-src/components/SectionNav.tsx
import { Button as Button5, Codicon as Codicon7, DropdownMenu as DropdownMenu2, DropdownMenuContent as DropdownMenuContent2, DropdownMenuItem as DropdownMenuItem2, DropdownMenuSeparator as DropdownMenuSeparator2, DropdownMenuTrigger as DropdownMenuTrigger2, Tip as Tip3, useValue as useValue7 } from "@hermes/plugin-sdk";
import { useRef as useRef6 } from "react";

// desktop-src/lib/nav.ts
import { atom as atom2, host as host2, useValue as useValue2 } from "@hermes/plugin-sdk";
import { createContext as createContext2, useContext as useContext3, useEffect as useEffect4, useRef as useRef5 } from "react";
var PAGE_SECTIONS = ["home", "manage", "cleanup", ...EXTRAS_PAGE_READY ? ["extras"] : []];
var START = [{ section: "home", detail: null }];
var $nav = atom2(START);
var $navRestore = atom2(null);
var guards = /* @__PURE__ */ new Map();
var restoreSeq = 0;
onShellReset(() => {
  $nav.set(START);
  $navRestore.set(null);
});
function setSectionGuard(section, guard) {
  if (guard) guards.set(section, guard);
  else guards.delete(section);
}
function isSectionAvailable(section) {
  if (section === "extras" && !EXTRAS_PAGE_READY) return false;
  if (section !== "watch" && !PAGE_SECTIONS.includes(section)) return false;
  const guard = guards.get(section);
  if (section === "watch" && !guard) return false;
  try {
    return guard ? guard() : true;
  } catch {
    return false;
  }
}
function valid(stack) {
  const out = stack.filter((e) => isSectionAvailable(e.section));
  return out.length ? out : [...START];
}
function currentEntry(stack = $nav.get()) {
  const v = valid(stack);
  return v[v.length - 1];
}
function currentSection(stack = $nav.get()) {
  return currentEntry(stack).section;
}
function canGoBack(stack = $nav.get()) {
  return valid(stack).length > 1;
}
function showSection(section, detail) {
  if (!isSectionAvailable(section)) return;
  const stack = valid($nav.get());
  const top = stack[stack.length - 1];
  if (top.section === section) {
    if (detail !== void 0 && detail !== top.detail) $nav.set([...stack.slice(0, -1), { section, detail }]);
    else if (stack.length !== $nav.get().length) $nav.set(stack);
    return;
  }
  const old = stack.find((e) => e.section === section);
  const rest = stack.filter((e) => e.section !== section);
  $nav.set([...rest, { section, detail: detail !== void 0 ? detail : old?.detail ?? null }]);
}
function frontPage() {
  try {
    host2.navigate(DESKTOP_ROUTES.home);
  } catch {
  }
}
function openSection(section, detail) {
  showSection(section, detail);
  frontPage();
}
function goBack() {
  const stack = valid($nav.get());
  if (stack.length <= 1) {
    if (stack.length !== $nav.get().length) $nav.set(stack);
    return false;
  }
  const next = stack.slice(0, -1);
  $nav.set(next);
  const target = next[next.length - 1];
  if (target.detail != null) $navRestore.set({ section: target.section, detail: target.detail, seq: ++restoreSeq });
  return true;
}
function noteDetail(section, detail) {
  const stack = $nav.get();
  let at = -1;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].section === section) {
      at = i;
      break;
    }
  }
  if (at < 0 || stack[at].detail === detail) return;
  const next = [...stack];
  next[at] = { section, detail };
  $nav.set(next);
}
function dropSection(section) {
  const stack = $nav.get();
  if (!stack.some((e) => e.section === section)) return;
  const next = stack.filter((e) => e.section !== section);
  $nav.set(next.length ? next : START);
}
var watchCloser = null;
function setWatchCloser(fn) {
  watchCloser = fn;
}
function closeWatch() {
  try {
    watchCloser?.();
  } finally {
    dropSection("watch");
  }
}
function useNav() {
  const stack = useValue2($nav);
  return { stack, current: currentSection(stack), canBack: canGoBack(stack) };
}
function useNavDetail(section, detail) {
  useEffect4(() => {
    if (detail !== void 0) noteDetail(section, detail);
  }, [section, detail]);
}
function useNavRestore(section, onRestore) {
  const restore = useValue2($navRestore);
  const seen = useRef5(restore?.seq ?? 0);
  const cb = useRef5(onRestore);
  cb.current = onRestore;
  useEffect4(() => {
    if (!restore || restore.seq <= seen.current) return;
    seen.current = restore.seq;
    if (restore.section === section) cb.current(restore.detail);
  }, [restore, section]);
}
var InShellContext = createContext2(false);
function useInShell() {
  return useContext3(InShellContext);
}
function isMacLike() {
  try {
    const nav = globalThis.navigator;
    const platform = nav?.userAgentData?.platform || nav?.platform || "";
    return /mac|iphone|ipad/i.test(platform);
  } catch {
    return false;
  }
}
function backShortcutLabel() {
  return isMacLike() ? "⌘[" : "Ctrl+[";
}
function backAriaShortcut() {
  return isMacLike() ? "Meta+BracketLeft Alt+ArrowLeft" : "Control+BracketLeft Alt+ArrowLeft";
}
function isTextField2(target) {
  const el = target;
  if (!el || typeof el.tagName !== "string") return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}
function isBackShortcut(e) {
  if (isTextField2(e.target) || e.shiftKey) return false;
  const bracket = e.key === "[" || e.code === "BracketLeft";
  if (bracket && !e.altKey && e.metaKey !== e.ctrlKey) return true;
  return e.key === "ArrowLeft" && e.altKey && !e.metaKey && !e.ctrlKey;
}

// desktop-src/lib/player.ts
import { Button as Button4, Codicon as Codicon6, atom as atom6, useValue as useValue6 } from "@hermes/plugin-sdk";
import { createElement } from "react";

// desktop-src/lib/dialogs.tsx
import { atom as atom4, useValue as useValue4 } from "@hermes/plugin-sdk";

// desktop-src/lib/leader.ts
import { atom as atom3, useValue as useValue3 } from "@hermes/plugin-sdk";
import { useEffect as useEffect5, useId } from "react";
var groups = /* @__PURE__ */ new Map();
function group(name) {
  let g = groups.get(name);
  if (!g) {
    g = atom3([]);
    groups.set(name, g);
  }
  return g;
}
onShellReset(() => {
  for (const g of groups.values()) g.set([]);
});
function useLeader(name) {
  const id = useId();
  const g = group(name);
  const members = useValue3(g);
  useEffect5(() => {
    g.set([...g.get().filter((m) => m !== id), id]);
    return () => {
      g.set(g.get().filter((m) => m !== id));
    };
  }, [g, id]);
  return members[0] === id;
}

// desktop-src/lib/dialogs.tsx
import { jsx as jsx11 } from "react/jsx-runtime";
var registry = {};
var seq = 0;
var $dialogStack = atom4([]);
onShellReset(() => {
  registry = {};
  $dialogStack.set([]);
});
function registerDialogs(map) {
  registry = { ...map };
  return () => {
    registry = {};
    $dialogStack.set([]);
  };
}
function openDialog(id, ...[props]) {
  seq += 1;
  $dialogStack.set([...$dialogStack.get(), { id, props: props ?? {}, seq }]);
}
function closeDialog(seqOf) {
  const stack = $dialogStack.get();
  if (!stack.length) return;
  if (seqOf === void 0) $dialogStack.set(stack.slice(0, -1));
  else $dialogStack.set(stack.filter((d) => d.seq !== seqOf));
}
function DialogHost() {
  const leader = useLeader("dialog-host");
  const stack = useValue4($dialogStack);
  if (!leader) return null;
  const top = stack[stack.length - 1];
  if (!top) return null;
  const Component = registry[top.id];
  if (!Component) {
    console.warn(`[dialogs] no component registered for "${top.id}"`);
    return null;
  }
  return /* @__PURE__ */ jsx11(Component, { ...top.props, onClose: () => closeDialog(top.seq) }, top.seq);
}

// desktop-src/lib/queue.ts
import { atom as atom5, useValue as useValue5 } from "@hermes/plugin-sdk";
var serials = 0;
var idOf = (it) => it.video.id;
function createQueue(origin, items, current2) {
  const seen = /* @__PURE__ */ new Set();
  const copy = [];
  for (const it of items) {
    const id = idOf(it);
    if (seen.has(id)) continue;
    seen.add(id);
    copy.push(it);
  }
  return { origin, items: copy, current: current2 && seen.has(current2) ? current2 : null, serial: ++serials };
}
function indexOf(q, id) {
  return q.items.findIndex((it) => idOf(it) === id);
}
function queueIndex(q) {
  return q.current ? indexOf(q, q.current) : -1;
}
function nextOf(q) {
  return q.items[queueIndex(q) + 1] ?? null;
}
function prevOf(q) {
  const i = queueIndex(q);
  return i > 0 ? q.items[i - 1] : null;
}
function setCurrent(q, id) {
  if (q.current === id || indexOf(q, id) < 0) return q;
  return { ...q, current: id };
}
function removeItem(q, id) {
  const index = indexOf(q, id);
  if (index < 0) return { queue: q, removed: null };
  const items = q.items.filter((_, i) => i !== index);
  const wasCurrent = q.current === id;
  const current2 = wasCurrent ? items[index] ?? items[index - 1] ?? null : null;
  return {
    queue: { ...q, items, current: wasCurrent ? current2 ? idOf(current2) : null : q.current },
    removed: { item: q.items[index], index, wasCurrent, serial: q.serial }
  };
}
function restoreItem(q, removed) {
  const id = idOf(removed.item);
  if (indexOf(q, id) >= 0) return q;
  const items = [...q.items];
  items.splice(Math.min(Math.max(0, removed.index), items.length), 0, removed.item);
  return { ...q, items, current: removed.wasCurrent ? id : q.current };
}
function moveItem(q, from, to) {
  const n = q.items.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return q;
  const items = [...q.items];
  const [it] = items.splice(from, 1);
  items.splice(to, 0, it);
  return { ...q, items };
}
function moveBy(q, id, delta) {
  const from = indexOf(q, id);
  if (from < 0) return q;
  return moveItem(q, from, from + delta);
}
function playNext(q, id) {
  const cur = queueIndex(q);
  const from = indexOf(q, id);
  if (cur < 0 || from < 0 || from === cur || from === cur + 1) return q;
  return moveItem(q, from, from < cur ? cur : cur + 1);
}
function sameOrigin(a, b) {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}
function queueOriginOf(from) {
  if (from.origin) return from.origin;
  if (!from.list?.length) return null;
  const label = from.source ?? null;
  return { kind: "list", id: label ?? "", label };
}
var $queue = atom5(null);
onShellReset(() => {
  $queue.set(null);
});
function getQueue() {
  return $queue.get();
}
function setQueue(q) {
  if ($queue.get() !== q) $queue.set(q);
}
function useQueue() {
  return useValue5($queue);
}
function openInQueue(id, from) {
  const cur = $queue.get();
  const origin = queueOriginOf(from);
  const queued = !!cur && indexOf(cur, id) >= 0;
  if (origin && from.list?.length) {
    if (cur && queued && sameOrigin(cur.origin, origin)) setQueue(setCurrent(cur, id));
    else setQueue(createQueue(origin, from.list, id));
    return;
  }
  setQueue(cur && queued ? setCurrent(cur, id) : null);
}

// desktop-src/lib/player.ts
var TAB_TITLE_MAX = 40;
var $watch = atom6(null);
var renderer = null;
onShellReset(() => {
  renderer = null;
  $watch.set(null);
});
setSectionGuard("watch", () => !!renderer && $watch.get() !== null);
setWatchCloser(() => $watch.set(null));
function setWatchRenderer(render) {
  renderer = render;
  return () => {
    if (renderer === render) renderer = null;
  };
}
function canWatchInHermes() {
  return !!renderer;
}
function tabTitle(title, fallback, max = TAB_TITLE_MAX) {
  const text = (title ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  if (text.length <= max) return text;
  const room = text.slice(0, max - 1);
  const space = room.lastIndexOf(" ");
  return `${(space > max / 2 ? room.slice(0, space) : room).trimEnd()}…`;
}
function watchVideo(id, from = {}) {
  if (!isVideoId(id) || !canWatchInHermes()) return false;
  const list = from.list ? [...from.list] : [];
  const item = from.item ?? list.find((it) => it.video.id === id) ?? null;
  openInQueue(id, from);
  show(id, item, list, from.source ?? null);
  return true;
}
function playQueued(id) {
  const q = getQueue();
  const item = q?.items.find((it) => it.video.id === id);
  if (!q || !item || !canWatchInHermes()) return false;
  setQueue(setCurrent(q, id));
  const prev = $watch.get();
  show(id, item, prev?.list ?? [], prev?.source ?? null);
  return true;
}
function show(id, item, list, source) {
  const prev = $watch.get();
  $watch.set({ id, item, list, source, seq: (prev?.seq ?? 0) + 1 });
  if (currentSection() === "watch") noteDetail("watch", id);
  else showSection("watch", id);
  frontPage();
}
function setWatchItem(item) {
  const cur = $watch.get();
  if (!cur || cur.id !== item.video.id || cur.item === item) return;
  $watch.set({ ...cur, item });
}
var LARGE_PLAYER_KEY = "player.large";
var TIP_DISMISSED_KEY = "player.always_allow_tip_dismissed";
var $flags = atom6({});
onShellReset(() => {
  $flags.set({});
});
function storedFlag(key) {
  try {
    return maybePluginContext()?.storage?.get(key, false) === true;
  } catch {
    return false;
  }
}
function setPlayerFlag(key, value) {
  $flags.set({ ...$flags.get(), [key]: value });
  try {
    maybePluginContext()?.storage?.set(key, value);
  } catch {
  }
}
function usePlayerFlag(key) {
  const v = useValue6($flags)[key];
  return v ?? storedFlag(key);
}
var OPEN_MODES = ["hermes", "youtube"];
var OPEN_MODE_KEY = "player.open";
var $openMode = atom6(null);
onShellReset(() => {
  $openMode.set(null);
});
var isOpenMode = (v) => v === "hermes" || v === "youtube";
function storedOpenMode() {
  try {
    const v = maybePluginContext()?.storage?.get(OPEN_MODE_KEY, "hermes");
    return isOpenMode(v) ? v : "hermes";
  } catch {
    return "hermes";
  }
}
function getOpenMode() {
  return $openMode.get() ?? storedOpenMode();
}
function setOpenMode(mode) {
  $openMode.set(mode);
  try {
    maybePluginContext()?.storage?.set(OPEN_MODE_KEY, mode);
  } catch {
  }
}
function useOpenMode() {
  return useValue6($openMode) ?? storedOpenMode();
}
function playVideo(id, from = {}) {
  if (getOpenMode() !== "hermes" || $dialogStack.get().length > 0) return false;
  return watchVideo(id, from);
}
setVideoOpener(playVideo);
var MODE_ICON = { hermes: "play-circle", youtube: "link-external" };
function OpenModeSwitch({ compact = false }) {
  const t = useT("watch");
  const mode = useOpenMode();
  if (!canWatchInHermes()) return null;
  return createElement(
    "div",
    { className: cx("mode"), "data-part": "open-mode", role: "group", "aria-label": t("open_mode.label") },
    createElement(
      "div",
      { className: cx("stack"), "data-direction": "row", "data-gap": 1, "data-align": "center" },
      OPEN_MODES.map((m) => {
        const props = {
          key: m,
          variant: mode === m ? "secondary" : "ghost",
          size: compact ? "icon-xs" : "xs",
          "data-mode": m,
          "aria-pressed": mode === m,
          "aria-label": compact ? `${t("open_mode.label")}: ${t(`open_mode.${m}`)}` : void 0,
          title: t(`open_mode.${m}_hint`),
          onClick: () => setOpenMode(m)
        };
        return createElement(Button4, props, createElement(Codicon6, { name: MODE_ICON[m], size: 14 }), compact ? null : t(`open_mode.${m}`));
      })
    )
  );
}

// desktop-src/components/SectionNav.tsx
import { Fragment as Fragment4, jsx as jsx12, jsxs as jsxs8 } from "react/jsx-runtime";
var SECTION_KEYS = PAGE_SECTIONS;
var WATCH_TAB_MAX = 28;
var SECTION_ICON = {
  home: "play-circle",
  manage: "list-flat",
  cleanup: "trash",
  extras: "sparkle",
  watch: "play"
};
function BackButton() {
  const t = useT();
  const { canBack } = useNav();
  const label = t("sections.back");
  return /* @__PURE__ */ jsx12(Tip3, { label: `${label} · ${backShortcutLabel()}`, children: /* @__PURE__ */ jsx12(
    Button5,
    {
      variant: "ghost",
      size: "icon-sm",
      className: cx("secnav-back"),
      "data-part": "nav-back",
      "aria-label": label,
      "aria-keyshortcuts": backAriaShortcut(),
      disabled: !canBack,
      onClick: () => goBack(),
      children: /* @__PURE__ */ jsx12(Codicon7, { name: "arrow-left", size: 15 })
    }
  ) });
}
function SectionNav({ current: forced }) {
  const t = useT();
  const nav = useNav();
  const watch = useValue7($watch);
  const current2 = forced ?? nav.current;
  const trackRef = useRef6(null);
  const label = (k) => t(`routes.${k}`);
  const hasWatch = !!watch && isSectionAvailable("watch");
  const watchTitle = hasWatch ? tabTitle(watch?.item?.video.title, t("routes.watch"), WATCH_TAB_MAX) : "";
  const go = (k) => showSection(k);
  const onKeyDown = (e) => {
    const buttons = [...trackRef.current?.querySelectorAll("button[data-section]") ?? []];
    const at = buttons.indexOf(e.target);
    if (at < 0) return;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (at + 1) % buttons.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (at - 1 + buttons.length) % buttons.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = buttons.length - 1;
    if (next < 0) return;
    e.preventDefault();
    buttons[next]?.focus();
  };
  const watchCurrent = current2 === "watch";
  return /* @__PURE__ */ jsxs8("nav", { className: cx("secnav"), "data-part": "section-nav", "aria-label": t("sections.label"), children: [
    /* @__PURE__ */ jsx12(BackButton, {}),
    /* @__PURE__ */ jsxs8("span", { className: cx("secnav-brand t-head"), "data-part": "section-brand", children: [
      /* @__PURE__ */ jsx12(Codicon7, { name: "play-circle", size: 15, className: cx("secnav-brand-icon") }),
      t("plugin_name")
    ] }),
    /* @__PURE__ */ jsxs8("div", { className: cx("secnav-track"), "data-part": "section-tabs", ref: trackRef, onKeyDown, children: [
      SECTION_KEYS.map((k) => /* @__PURE__ */ jsx12(
        "button",
        {
          type: "button",
          className: cx("bare secnav-item t-label"),
          "data-section": k,
          "aria-current": k === current2 ? "page" : void 0,
          tabIndex: k === current2 ? 0 : -1,
          onClick: () => go(k),
          children: label(k)
        },
        k
      )),
      hasWatch ? /* @__PURE__ */ jsxs8("span", { className: cx("secnav-watch"), "data-part": "section-watch", "data-current": watchCurrent ? "true" : void 0, children: [
        /* @__PURE__ */ jsxs8(
          "button",
          {
            type: "button",
            className: cx("bare secnav-item secnav-watch-item t-label"),
            "data-section": "watch",
            "aria-current": watchCurrent ? "page" : void 0,
            tabIndex: watchCurrent ? 0 : -1,
            title: watch?.item?.video.title ?? void 0,
            onClick: () => go("watch"),
            children: [
              /* @__PURE__ */ jsx12(Codicon7, { name: SECTION_ICON.watch, size: 11, className: cx("secnav-watch-icon") }),
              /* @__PURE__ */ jsx12("span", { className: cx("truncate"), children: watchTitle })
            ]
          }
        ),
        /* @__PURE__ */ jsx12("button", { type: "button", className: cx("bare secnav-watch-close"), "data-part": "watch-close", "aria-label": t("sections.close_video"), title: t("sections.close_video"), onClick: () => closeWatch(), children: /* @__PURE__ */ jsx12(Codicon7, { name: "close", size: 12 }) })
      ] }) : null
    ] }),
    /* @__PURE__ */ jsx12("div", { className: cx("secnav-compact"), "data-part": "section-menu", children: /* @__PURE__ */ jsxs8(DropdownMenu2, { children: [
      /* @__PURE__ */ jsx12(DropdownMenuTrigger2, { asChild: true, children: /* @__PURE__ */ jsxs8(
        Button5,
        {
          variant: "ghost",
          size: "sm",
          "data-part": "section-menu-trigger",
          "aria-label": t("sections.menu", { section: current2 === "watch" ? watchTitle : label(current2) }),
          children: [
            /* @__PURE__ */ jsx12(Codicon7, { name: SECTION_ICON[current2], size: 14 }),
            /* @__PURE__ */ jsx12("span", { className: cx("truncate"), children: current2 === "watch" ? watchTitle : label(current2) }),
            /* @__PURE__ */ jsx12(Codicon7, { name: "chevron-down", size: 12 })
          ]
        }
      ) }),
      /* @__PURE__ */ jsxs8(DropdownMenuContent2, { align: "start", children: [
        SECTION_KEYS.map((k) => /* @__PURE__ */ jsxs8(DropdownMenuItem2, { "data-section": k, "aria-current": k === current2 ? "page" : void 0, onSelect: () => go(k), children: [
          /* @__PURE__ */ jsx12(Codicon7, { name: k === current2 ? "check" : SECTION_ICON[k], size: 14 }),
          label(k)
        ] }, k)),
        hasWatch ? /* @__PURE__ */ jsxs8(Fragment4, { children: [
          /* @__PURE__ */ jsxs8(DropdownMenuItem2, { "data-section": "watch", "aria-current": watchCurrent ? "page" : void 0, onSelect: () => go("watch"), children: [
            /* @__PURE__ */ jsx12(Codicon7, { name: watchCurrent ? "check" : SECTION_ICON.watch, size: 14 }),
            watchTitle
          ] }),
          /* @__PURE__ */ jsx12(DropdownMenuSeparator2, {}),
          /* @__PURE__ */ jsxs8(DropdownMenuItem2, { "data-part": "watch-close-menu", onSelect: () => closeWatch(), children: [
            /* @__PURE__ */ jsx12(Codicon7, { name: "close", size: 14 }),
            t("sections.close_video")
          ] })
        ] }) : null
      ] })
    ] }) })
  ] });
}
function SectionFrame({ current: current2, children }) {
  const inShell = useInShell();
  if (inShell) return /* @__PURE__ */ jsx12(Fragment4, { children });
  return /* @__PURE__ */ jsxs8("div", { className: cx("sections"), "data-part": "sections", children: [
    /* @__PURE__ */ jsx12(SectionNav, { current: current2 }),
    children
  ] });
}
var MOUSE_BACK = 3;
function ShellPage({ sections }) {
  const { current: current2 } = useNav();
  const visited = useRef6(/* @__PURE__ */ new Set());
  if (current2 !== "watch") visited.current.add(current2);
  const onKeyDown = (e) => {
    if (e.defaultPrevented || !isBackShortcut(e)) return;
    if (goBack()) e.preventDefault();
  };
  const onMouseUp = (e) => {
    if (e.button === MOUSE_BACK && goBack()) e.preventDefault();
  };
  const Watch = sections.watch;
  return /* @__PURE__ */ jsx12(InShellContext.Provider, { value: true, children: /* @__PURE__ */ jsxs8("div", { className: cx("sections shell"), "data-part": "shell", "data-section": current2, onKeyDown, onMouseUp, children: [
    /* @__PURE__ */ jsx12(SectionNav, { current: current2 }),
    PAGE_SECTIONS.filter((k) => visited.current.has(k)).map((k) => {
      const Screen = sections[k];
      return /* @__PURE__ */ jsx12("div", { className: cx("shell-section"), "data-part": "shell-section", "data-section": k, hidden: k !== current2, children: Screen ? /* @__PURE__ */ jsx12(Screen, {}) : null }, k);
    }),
    current2 === "watch" && Watch ? /* @__PURE__ */ jsx12("div", { className: cx("shell-section"), "data-part": "shell-section", "data-section": "watch", children: /* @__PURE__ */ jsx12(Watch, {}) }, "watch") : null
  ] }) });
}

// desktop-src/components/ChannelRow.tsx
import { Checkbox, Codicon as Codicon9 } from "@hermes/plugin-sdk";
import { createContext as createContext3, useContext as useContext4 } from "react";

// desktop-src/components/FolderChip.tsx
import { Codicon as Codicon8 } from "@hermes/plugin-sdk";
import { Fragment as Fragment5, jsx as jsx13, jsxs as jsxs9 } from "react/jsx-runtime";
function FolderChip({ folder, count: count2, active, onClick, className }) {
  const fmt = useFormatCount();
  const classes = withClass(cx("chip t-label"), className);
  const body = /* @__PURE__ */ jsxs9(Fragment5, { children: [
    /* @__PURE__ */ jsx13(Codicon8, { name: "folder", size: 12, className: cx("chip-icon") }),
    /* @__PURE__ */ jsx13("span", { className: cx("chip-label"), children: folder.name }),
    count2 ? /* @__PURE__ */ jsx13("span", { className: cx("chip-count"), children: fmt(count2) }) : null
  ] });
  if (!onClick) {
    return /* @__PURE__ */ jsx13("span", { className: classes, "data-folder": folder.id, "data-active": active ? "true" : void 0, children: body });
  }
  return /* @__PURE__ */ jsx13(
    "button",
    {
      type: "button",
      className: withClass(cx("bare"), classes),
      "data-folder": folder.id,
      "data-active": active ? "true" : void 0,
      "aria-pressed": !!active,
      onClick: () => onClick(folder),
      children: body
    }
  );
}
function TagChip({ tag, active, onClick, onRemove }) {
  const t = useT();
  const label = /* @__PURE__ */ jsxs9(Fragment5, { children: [
    /* @__PURE__ */ jsx13("span", { className: cx("chip-hash"), "aria-hidden": "true", children: "#" }),
    /* @__PURE__ */ jsx13("span", { className: cx("chip-label"), children: tag.name })
  ] });
  return /* @__PURE__ */ jsxs9("span", { className: cx("chip t-label"), "data-tag": tag.id, "data-active": active ? "true" : void 0, children: [
    onClick ? /* @__PURE__ */ jsx13("button", { type: "button", className: cx("bare chip-label"), "aria-pressed": !!active, onClick: () => onClick(tag), children: label }) : label,
    onRemove ? /* @__PURE__ */ jsx13(
      "button",
      {
        type: "button",
        className: cx("bare chip-remove"),
        "data-part": "chip-remove",
        "aria-label": t("kit.chip.remove", { name: tag.name }),
        onClick: (e) => {
          e.stopPropagation();
          onRemove(tag);
        },
        children: /* @__PURE__ */ jsx13(Codicon8, { name: "close", size: 10 })
      }
    ) : null
  ] });
}
function ChipSkeleton({ width = "64px" }) {
  return /* @__PURE__ */ jsx13("span", { className: cx("chip t-label"), "data-skeleton": true, "aria-hidden": "true", style: { width }, children: /* @__PURE__ */ jsx13(SkBar, { width: "100%" }) });
}

// desktop-src/components/ChannelRow.tsx
import { jsx as jsx14, jsxs as jsxs10 } from "react/jsx-runtime";
var TableContext = createContext3({ selectable: false });

// desktop-src/components/Tree.tsx
import { Codicon as Codicon10 } from "@hermes/plugin-sdk";
import { useEffect as useEffect6, useRef as useRef7, useState as useState6 } from "react";
import { jsx as jsx15, jsxs as jsxs11 } from "react/jsx-runtime";
var ITEM = '[role="treeitem"]';
function visibleItems(root) {
  if (!root) return [];
  return [...root.querySelectorAll(ITEM)].filter(
    (el) => !el.parentElement?.closest('[role="treeitem"][aria-expanded="false"]') && !el.hasAttribute("data-skeleton")
  );
}
function focusItem(items, el) {
  if (!el) return;
  for (const it of items) it.tabIndex = it === el ? 0 : -1;
  el.focus();
}
function Tree({ label, children }) {
  const ref = useRef7(null);
  useEffect6(() => {
    const items = visibleItems(ref.current);
    if (!items.length || items.some((i) => i.tabIndex === 0)) return;
    const pick = items.find((i) => i.getAttribute("aria-selected") === "true") ?? items[0];
    pick.tabIndex = 0;
  });
  const onKeyDown = (e) => {
    const items = visibleItems(ref.current);
    const current2 = e.target.closest(ITEM);
    const i = current2 ? items.indexOf(current2) : -1;
    if (i < 0) return;
    let next;
    if (e.key === "ArrowDown") next = items[i + 1];
    else if (e.key === "ArrowUp") next = items[i - 1];
    else if (e.key === "Home") next = items[0];
    else if (e.key === "End") next = items[items.length - 1];
    else return;
    e.preventDefault();
    focusItem(items, next ?? current2 ?? void 0);
  };
  const onFocus = (e) => {
    const item = e.target.closest(ITEM);
    if (!item) return;
    for (const it of visibleItems(ref.current)) it.tabIndex = it === item ? 0 : -1;
  };
  return /* @__PURE__ */ jsx15("ul", { ref, role: "tree", "aria-label": label, className: cx("tree"), "data-part": "tree", onKeyDown, onFocus, children });
}
function TreeItem({
  id,
  label,
  level = 1,
  icon,
  avatar,
  count: count2,
  expanded,
  onToggle,
  selected,
  onSelect,
  onDropItem,
  dropType = "text/plain",
  dragData: dragData2,
  actions,
  children
}) {
  const t = useT();
  const fmt = useFormatCount();
  const [over, setOver] = useState6(false);
  const expandable = !!onToggle || !!children;
  const isOpen = expandable ? !!expanded : void 0;
  const onKeyDown = (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      onSelect?.();
    } else if (e.key === "ArrowRight") {
      if (expandable && !expanded) onToggle?.();
      else if (expanded) (e.currentTarget.querySelector(`:scope > [role="group"] > ${ITEM}`) ?? void 0)?.focus();
      else return;
    } else if (e.key === "ArrowLeft") {
      if (expandable && expanded) onToggle?.();
      else e.currentTarget.parentElement?.closest(ITEM)?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const dropHandlers = onDropItem ? {
    onDragOver: (e) => {
      e.preventDefault();
      if (!over) setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e) => {
      e.preventDefault();
      setOver(false);
      const data = e.dataTransfer?.getData(dropType);
      if (data) onDropItem(data);
    }
  } : {};
  return /* @__PURE__ */ jsxs11(
    "li",
    {
      role: "treeitem",
      "aria-level": level,
      "aria-expanded": isOpen,
      "aria-selected": !!selected,
      tabIndex: -1,
      className: cx("tree-item"),
      "data-part": "tree-item",
      "data-id": id,
      style: vars({ level }),
      onKeyDown,
      children: [
        /* @__PURE__ */ jsxs11(
          "div",
          {
            className: cx("tree-row"),
            "data-part": "tree-row",
            "data-drop": over ? "true" : void 0,
            title: onDropItem && over ? t("kit.tree.drop") : void 0,
            onClick: onSelect,
            draggable: dragData2 ? true : void 0,
            onDragStart: dragData2 ? (e) => e.dataTransfer?.setData(dropType, dragData2) : void 0,
            ...dropHandlers,
            children: [
              expandable ? /* @__PURE__ */ jsx15(
                "button",
                {
                  type: "button",
                  className: cx("bare tree-caret"),
                  tabIndex: -1,
                  "aria-label": expanded ? t("kit.tree.collapse") : t("kit.tree.expand"),
                  onClick: (e) => {
                    e.stopPropagation();
                    onToggle?.();
                  },
                  children: /* @__PURE__ */ jsx15(Codicon10, { name: "chevron-right", size: 12 })
                }
              ) : /* @__PURE__ */ jsx15("span", { className: cx("tree-spacer") }),
              avatar ? /* @__PURE__ */ jsx15(ChannelAvatar, { title: avatar.title, thumb: avatar.thumb, size: 18 }) : icon ? /* @__PURE__ */ jsx15(Codicon10, { name: icon, size: 14, className: cx("tree-icon") }) : null,
              /* @__PURE__ */ jsx15("span", { className: cx("tree-label"), children: label }),
              actions ? /* @__PURE__ */ jsx15("span", { className: cx("tree-actions"), children: actions }) : null,
              count2 ? /* @__PURE__ */ jsx15("span", { className: cx("tree-count"), "aria-label": t("kit.tree.new_count", { count: fmt(count2) }), children: fmt(count2) }) : null
            ]
          }
        ),
        expandable && expanded && children ? /* @__PURE__ */ jsx15("ul", { role: "group", className: cx("tree-group"), children }) : null
      ]
    }
  );
}
function TreeItemSkeleton({ level = 1, avatar }) {
  return /* @__PURE__ */ jsx15("li", { className: cx("tree-item"), "data-skeleton": true, "aria-hidden": "true", style: vars({ level }), children: /* @__PURE__ */ jsxs11("div", { className: cx("tree-row"), children: [
    /* @__PURE__ */ jsx15("span", { className: cx("tree-spacer") }),
    avatar ? /* @__PURE__ */ jsx15(ChannelAvatarSkeleton, { size: 18 }) : null,
    /* @__PURE__ */ jsx15("span", { className: cx("tree-label"), children: /* @__PURE__ */ jsx15(SkLines, { widths: [level > 1 ? "64%" : "48%"] }) })
  ] }) });
}

// desktop-src/components/flows.tsx
import { Button as Button6, Checkbox as Checkbox2, Codicon as Codicon11 } from "@hermes/plugin-sdk";
import { useEffect as useEffect7, useId as useId2, useRef as useRef8 } from "react";
import { Fragment as Fragment6, jsx as jsx16, jsxs as jsxs12 } from "react/jsx-runtime";
var STEP_ICON = {
  waiting: "circle-large-outline",
  running: "loading",
  done: "pass-filled",
  failed: "error"
};
function StepProgress({ steps, label }) {
  const t = useT();
  return /* @__PURE__ */ jsx16("ol", { className: cx("steps"), "aria-label": label, "data-part": "steps", children: steps.map((s) => /* @__PURE__ */ jsxs12("li", { className: cx("step"), "data-status": s.status, "aria-current": s.status === "running" ? "step" : void 0, children: [
    /* @__PURE__ */ jsx16("span", { className: cx("step-icon"), "aria-hidden": "true", children: /* @__PURE__ */ jsx16(Codicon11, { name: STEP_ICON[s.status], size: s.status === "running" ? 14 : 15, spinning: s.status === "running" }) }),
    /* @__PURE__ */ jsxs12("span", { className: cx("step-text"), children: [
      /* @__PURE__ */ jsxs12("span", { className: cx("step-label t-body"), children: [
        s.label,
        /* @__PURE__ */ jsx16("span", { className: cx("sr"), children: t(`kit.steps.${s.status}`) })
      ] }),
      s.detail ? /* @__PURE__ */ jsx16("span", { className: cx("step-detail t-label"), children: s.detail }) : null
    ] })
  ] }, s.id)) });
}
function StepProgressSkeleton({ count: count2 = 3 }) {
  return /* @__PURE__ */ jsx16("ol", { className: cx("steps"), "data-part": "steps", "data-skeleton": true, "aria-busy": "true", children: Array.from({ length: count2 }, (_, i) => /* @__PURE__ */ jsxs12("li", { className: cx("step"), "data-status": "waiting", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsx16("span", { className: cx("step-icon"), children: /* @__PURE__ */ jsx16(Codicon11, { name: STEP_ICON.waiting, size: 15 }) }),
    /* @__PURE__ */ jsx16("span", { className: cx("step-text"), children: /* @__PURE__ */ jsx16("span", { className: cx("step-label t-body"), children: /* @__PURE__ */ jsx16(SkLines, { widths: [`${40 + i * 17 % 35}%`] }) }) })
  ] }, i)) });
}
function suggestCountKey(count2, locale) {
  let rule = count2 === 1 ? "one" : "other";
  try {
    rule = new Intl.PluralRules(locale).select(count2);
  } catch {
  }
  return rule === "one" ? "kit.suggest.count_one" : "kit.suggest.count";
}
function SuggestionGroup({ title, count: count2, model, onAcceptAll, onRejectAll, children }) {
  const t = useT();
  const fmt = useFormatCount();
  const locale = useLocale();
  return /* @__PURE__ */ jsxs12("section", { className: cx("sgroup"), "data-part": "sgroup", children: [
    /* @__PURE__ */ jsxs12("header", { className: cx("sgroup-head"), children: [
      /* @__PURE__ */ jsxs12("h3", { className: cx("sgroup-title t-head"), children: [
        /* @__PURE__ */ jsx16("span", { className: cx("truncate"), children: title }),
        count2 != null ? /* @__PURE__ */ jsx16("span", { className: cx("sgroup-meta t-label num"), children: t(suggestCountKey(count2, locale), { count: fmt(count2) }) }) : null
      ] }),
      model ? /* @__PURE__ */ jsx16("span", { className: cx("sgroup-meta t-label"), children: t("kit.suggest.by_model", { model }) }) : null,
      onAcceptAll || onRejectAll ? /* @__PURE__ */ jsxs12("div", { className: cx("sgroup-actions"), children: [
        onRejectAll ? /* @__PURE__ */ jsx16(Button6, { variant: "ghost", size: "xs", "data-part": "group-reject", onClick: onRejectAll, children: t("kit.suggest.reject_all") }) : null,
        onAcceptAll ? /* @__PURE__ */ jsxs12(Button6, { variant: "secondary", size: "xs", "data-part": "group-accept", onClick: onAcceptAll, children: [
          /* @__PURE__ */ jsx16(Codicon11, { name: "check-all", size: 14 }),
          t("kit.suggest.accept_all")
        ] }) : null
      ] }) : null
    ] }),
    /* @__PURE__ */ jsx16("div", { role: "list", children })
  ] });
}
function SuggestionRow({
  subject,
  avatar,
  target,
  reason,
  model,
  confidence,
  status = "pending",
  onAccept,
  onReject,
  selected,
  onSelectedChange,
  selectLabel
}) {
  const t = useT();
  const meta = [
    model ? t("kit.suggest.by_model", { model }) : null,
    confidence != null ? t("kit.suggest.confidence", { percent: Math.round(confidence * 100) }) : null
  ].filter(Boolean);
  const selectable = !!onSelectedChange;
  const avatarNode = avatar ? /* @__PURE__ */ jsx16(ChannelAvatar, { title: avatar.title, thumb: avatar.thumb, size: 28 }) : null;
  return /* @__PURE__ */ jsxs12("div", { role: "listitem", className: cx("srow"), "data-part": "suggestion-row", "data-status": status, "data-selectable": selectable ? "true" : void 0, children: [
    selectable ? /* @__PURE__ */ jsxs12(Fragment6, { children: [
      /* @__PURE__ */ jsx16("span", { className: cx("srow-lead"), children: /* @__PURE__ */ jsx16(
        Checkbox2,
        {
          checked: !!selected,
          onCheckedChange: (v) => onSelectedChange?.(v === true),
          "aria-label": selectLabel ?? (typeof subject === "string" ? subject : void 0)
        }
      ) }),
      /* @__PURE__ */ jsx16("span", { className: cx("srow-lead"), children: avatarNode })
    ] }) : avatarNode ?? /* @__PURE__ */ jsx16("span", {}),
    /* @__PURE__ */ jsxs12("div", { className: cx("srow-main"), children: [
      /* @__PURE__ */ jsxs12("div", { className: cx("srow-line t-body"), children: [
        /* @__PURE__ */ jsx16("span", { className: cx("srow-subject"), children: subject }),
        /* @__PURE__ */ jsx16(Codicon11, { name: "arrow-right", size: 12, className: cx("srow-arrow") }),
        typeof target === "string" ? /* @__PURE__ */ jsx16(FolderChip, { folder: { id: target, name: target } }) : target
      ] }),
      /* @__PURE__ */ jsxs12("div", { className: cx("srow-reason t-label"), children: [
        reason,
        meta.length ? /* @__PURE__ */ jsxs12(Fragment6, { children: [
          " · ",
          meta.join(" · ")
        ] }) : null
      ] })
    ] }),
    /* @__PURE__ */ jsx16("div", { className: cx("srow-actions"), children: status === "pending" ? /* @__PURE__ */ jsxs12(Fragment6, { children: [
      onReject ? /* @__PURE__ */ jsx16(Button6, { variant: "ghost", size: "icon-xs", "data-part": "suggestion-reject", "aria-label": t("kit.suggest.reject"), onClick: onReject, children: /* @__PURE__ */ jsx16(Codicon11, { name: "close", size: 14 }) }) : null,
      onAccept ? /* @__PURE__ */ jsx16(Button6, { variant: "secondary", size: "icon-xs", "data-part": "suggestion-accept", "aria-label": t("kit.suggest.accept"), onClick: onAccept, children: /* @__PURE__ */ jsx16(Codicon11, { name: "check", size: 14 }) }) : null
    ] }) : /* @__PURE__ */ jsxs12("span", { className: cx("srow-status t-label"), children: [
      /* @__PURE__ */ jsx16(Codicon11, { name: status === "accepted" ? "check" : "close", size: 12 }),
      t(`kit.suggest.${status}`)
    ] }) })
  ] });
}
function SuggestionRowSkeleton({ selectable } = {}) {
  return /* @__PURE__ */ jsxs12("div", { className: cx("srow"), "data-part": "suggestion-row", "data-skeleton": true, "aria-hidden": "true", "data-selectable": selectable ? "true" : void 0, children: [
    selectable ? /* @__PURE__ */ jsxs12(Fragment6, { children: [
      /* @__PURE__ */ jsx16("span", { className: cx("srow-lead") }),
      /* @__PURE__ */ jsx16("span", { className: cx("srow-lead"), children: /* @__PURE__ */ jsx16(ChannelAvatarSkeleton, { size: 28 }) })
    ] }) : /* @__PURE__ */ jsx16(ChannelAvatarSkeleton, { size: 28 }),
    /* @__PURE__ */ jsxs12("div", { className: cx("srow-main"), children: [
      /* @__PURE__ */ jsxs12("div", { className: cx("srow-line t-body"), children: [
        /* @__PURE__ */ jsx16(SkLines, { widths: ["96px"] }),
        /* @__PURE__ */ jsx16(ChipSkeleton, { width: "72px" })
      ] }),
      /* @__PURE__ */ jsx16("div", { className: cx("srow-reason t-label"), children: /* @__PURE__ */ jsx16(SkLines, { widths: ["62%"] }) })
    ] }),
    /* @__PURE__ */ jsx16("div", { className: cx("srow-actions") })
  ] });
}
function ApprovalCard({
  title,
  description,
  effects,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel,
  busy,
  tone = "destructive",
  autoFocus
}) {
  const t = useT();
  const titleId = useId2();
  const cancelRef = useRef8(null);
  useEffect7(() => {
    if (autoFocus) cancelRef.current?.focus();
  }, [autoFocus]);
  return /* @__PURE__ */ jsxs12("section", { className: cx("approval"), "data-part": "approval", "aria-labelledby": titleId, children: [
    /* @__PURE__ */ jsxs12("div", { className: cx("approval-head"), children: [
      /* @__PURE__ */ jsx16("span", { className: cx("approval-icon"), "aria-hidden": "true", children: /* @__PURE__ */ jsx16(Codicon11, { name: "shield", size: 15 }) }),
      /* @__PURE__ */ jsxs12("div", { className: cx("approval-titles"), children: [
        /* @__PURE__ */ jsx16("h3", { id: titleId, className: cx("approval-title t-head"), children: title }),
        description ? /* @__PURE__ */ jsx16("p", { className: cx("approval-desc t-body"), children: description }) : null
      ] })
    ] }),
    /* @__PURE__ */ jsx16("p", { className: cx("approval-label t-label"), children: t("kit.approval.what") }),
    /* @__PURE__ */ jsx16("ol", { className: cx("approval-effects t-body"), "data-part": "approval-effects", children: effects.map((e, i) => /* @__PURE__ */ jsx16("li", { children: e }, i)) }),
    children,
    /* @__PURE__ */ jsxs12("div", { className: cx("approval-foot"), children: [
      /* @__PURE__ */ jsx16(Button6, { ref: cancelRef, variant: "outline", size: "sm", "data-part": "approval-cancel", onClick: onCancel, children: cancelLabel ?? t("kit.approval.not_now") }),
      /* @__PURE__ */ jsx16(
        Button6,
        {
          variant: tone === "destructive" ? "destructive" : "default",
          size: "sm",
          "data-part": "approval-confirm",
          loading: busy,
          disabled: busy,
          onClick: onConfirm,
          children: confirmLabel
        }
      )
    ] })
  ] });
}

// desktop-src/components/welcome.tsx
import { Button as Button7, Codicon as Codicon12, CopyButton } from "@hermes/plugin-sdk";
import { useEffect as useEffect8, useState as useState7 } from "react";
import { Fragment as Fragment7, jsx as jsx17, jsxs as jsxs13 } from "react/jsx-runtime";
function PathGroup({ children, label }) {
  return /* @__PURE__ */ jsx17("div", { className: cx("paths"), "data-part": "paths", role: "group", "aria-label": label, children });
}
function Hero({ icon, title, tagline, description }) {
  return /* @__PURE__ */ jsxs13("header", { className: cx("hero"), "data-part": "hero", children: [
    icon ? /* @__PURE__ */ jsx17("span", { className: cx("hero-mark"), "aria-hidden": "true", children: /* @__PURE__ */ jsx17(Codicon12, { name: icon, size: 22 }) }) : null,
    /* @__PURE__ */ jsx17("h1", { className: cx("hero-title t-title"), children: title }),
    tagline ? /* @__PURE__ */ jsx17("p", { className: cx("hero-tagline t-head"), children: tagline }) : null,
    description ? /* @__PURE__ */ jsx17("p", { className: cx("hero-desc t-body"), children: description }) : null
  ] });
}
function PathCard({ icon, title, description, actionLabel, onAction, primary, recommended, hint }) {
  const t = useT();
  return /* @__PURE__ */ jsxs13("article", { className: cx("path"), "data-part": "path-card", "data-primary": primary ? "true" : "false", "data-recommended": recommended ? "true" : void 0, children: [
    /* @__PURE__ */ jsxs13("div", { className: cx("path-top"), children: [
      /* @__PURE__ */ jsx17("span", { className: cx("path-icon"), "data-part": "path-icon", "aria-hidden": "true", children: /* @__PURE__ */ jsx17(Codicon12, { name: icon, size: 20 }) }),
      recommended ? /* @__PURE__ */ jsxs13("span", { className: cx("path-badge t-label"), "data-part": "path-badge", children: [
        /* @__PURE__ */ jsx17(Codicon12, { name: "star-full", size: 11, className: cx("path-badge-icon") }),
        t("kit.path.recommended")
      ] }) : null
    ] }),
    /* @__PURE__ */ jsx17("h3", { className: cx("path-title t-head"), "data-part": "path-title", children: title }),
    /* @__PURE__ */ jsx17("p", { className: cx("path-desc t-body"), "data-part": "path-desc", children: description }),
    /* @__PURE__ */ jsxs13("div", { className: cx("path-foot"), "data-part": "path-foot", children: [
      /* @__PURE__ */ jsx17(Button7, { variant: primary ? "default" : "outline", size: "sm", onClick: onAction, children: actionLabel }),
      hint ? /* @__PURE__ */ jsx17("span", { className: cx("path-hint t-label"), children: hint }) : null
    ] })
  ] });
}
function mmss(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function PairingCode({ code, expiresAt: expiresAt2, onRegenerate, label }) {
  const t = useT();
  const [now, setNow] = useState7(() => Date.now());
  const [total] = useState7(() => Math.max(1, expiresAt2 - Date.now()));
  useEffect8(() => {
    const timer = setInterval(() => setNow(Date.now()), 1e3);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((expiresAt2 - now) / 1e3));
  const expired = left <= 0;
  const digits = code.padEnd(6, " ").slice(0, 6).split("");
  const title = label ?? t("kit.pairing.label");
  const digit = (d, i) => /* @__PURE__ */ jsx17("span", { className: cx("code-digit"), "data-part": "code-digit", "aria-hidden": "true", children: d }, i);
  return /* @__PURE__ */ jsxs13("div", { className: cx("pairing"), "data-part": "pairing", "data-expired": expired ? "true" : "false", children: [
    /* @__PURE__ */ jsx17("p", { className: cx("pairing-label t-label"), children: title }),
    /* @__PURE__ */ jsxs13("div", { className: cx("code"), role: "img", "aria-label": `${title}: ${digits.join(" ")}`, children: [
      digits.slice(0, 3).map(digit),
      /* @__PURE__ */ jsx17("span", { className: cx("code-sep"), "aria-hidden": "true" }),
      digits.slice(3).map((d, i) => digit(d, i + 3))
    ] }),
    /* @__PURE__ */ jsx17("div", { className: cx("pairing-foot t-label"), children: expired ? /* @__PURE__ */ jsxs13(Fragment7, { children: [
      /* @__PURE__ */ jsx17("span", { children: t("kit.pairing.expired") }),
      onRegenerate ? /* @__PURE__ */ jsxs13(Button7, { variant: "outline", size: "xs", "data-part": "pairing-regenerate", onClick: onRegenerate, children: [
        /* @__PURE__ */ jsx17(Codicon12, { name: "refresh", size: 12 }),
        t("kit.pairing.regenerate")
      ] }) : null
    ] }) : /* @__PURE__ */ jsxs13(Fragment7, { children: [
      /* @__PURE__ */ jsx17("span", { className: cx("pairing-bar"), "aria-hidden": "true", children: /* @__PURE__ */ jsx17("span", { className: cx("pairing-bar-fill"), style: vars({ left: `${Math.round(left * 1e3 / total * 100)}%` }) }) }),
      /* @__PURE__ */ jsx17("span", { className: cx("num"), children: t("kit.pairing.expires", { time: mmss(left) }) }),
      /* @__PURE__ */ jsx17(CopyButton, { text: code, label: t("kit.pairing.copy") })
    ] }) })
  ] });
}
function PairingCodeSkeleton() {
  return /* @__PURE__ */ jsxs13("div", { className: cx("pairing"), "data-part": "pairing", "data-skeleton": true, "aria-busy": "true", children: [
    /* @__PURE__ */ jsx17("p", { className: cx("pairing-label t-label"), "aria-hidden": "true", children: /* @__PURE__ */ jsx17(SkLines, { widths: ["96px"] }) }),
    /* @__PURE__ */ jsxs13("div", { className: cx("code"), "aria-hidden": "true", children: [
      [0, 1, 2].map((i) => /* @__PURE__ */ jsx17("span", { className: cx("code-digit"), "data-part": "code-digit" }, i)),
      /* @__PURE__ */ jsx17("span", { className: cx("code-sep") }),
      [3, 4, 5].map((i) => /* @__PURE__ */ jsx17("span", { className: cx("code-digit"), "data-part": "code-digit" }, i))
    ] })
  ] });
}

// desktop-src/components/WhyBadge.tsx
import { Badge as Badge2, Codicon as Codicon13 } from "@hermes/plugin-sdk";
import { jsx as jsx18, jsxs as jsxs14 } from "react/jsx-runtime";

// desktop-src/components/states.tsx
import { Button as Button8, Codicon as Codicon14, Loader } from "@hermes/plugin-sdk";

// desktop-src/lib/rest.ts
import { atom as atom7, host as host3, useMutation, useQuery, useValue as useValue8, queryClient } from "@hermes/plugin-sdk";
import { useEffect as useEffect9, useRef as useRef9 } from "react";
var TubeApiError = class extends Error {
  code;
  reason;
  details;
  /** true = the call never reached an envelope (network, Desktop 4xx/5xx, plugin off). */
  transport;
  constructor(error, transport = false) {
    super(error.message);
    this.name = "TubeApiError";
    this.code = error.code;
    if (error.reason !== void 0) this.reason = error.reason;
    if (error.details !== void 0) this.details = error.details;
    this.transport = transport;
  }
  toApiError() {
    return {
      code: this.code,
      message: this.message,
      ...this.reason !== void 0 ? { reason: this.reason } : {},
      ...this.details !== void 0 ? { details: this.details } : {}
    };
  }
};
function toApiError(error) {
  if (error instanceof TubeApiError) return error.toApiError();
  if (isApiError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return { code: "internal", message };
}
function isApiError(value) {
  return !!value && typeof value === "object" && typeof value.code === "string" && typeof value.message === "string";
}
function unwrapEnvelope(value) {
  if (value && typeof value === "object" && "ok" in value) {
    const env = value;
    if (env.ok === true) return env.data;
    if (env.ok === false && isApiError(env.error)) throw new TubeApiError(env.error);
  }
  throw new TubeApiError({ code: "internal", message: "invalid response envelope" });
}
function buildRestRequest(key, args = {}) {
  const space = key.indexOf(" ");
  const method = key.slice(0, space);
  const template = key.slice(space + 1);
  const path = template.replace(/\{(\w+)\}/g, (_m, name) => {
    const v = args.path?.[name];
    if (v === void 0 || v === null || v === "") {
      throw new TubeApiError({ code: "invalid", message: `missing path parameter "${name}" for ${key}` });
    }
    return encodeURIComponent(String(v));
  });
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(args.query ?? {})) {
    if (v === void 0 || v === null || v === "") continue;
    qs.append(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const q = qs.toString();
  return { method, path: q ? `${path}?${q}` : path };
}
async function restLoose(key, args = {}) {
  const { method, path } = buildRestRequest(key, args);
  const opts = method === "GET" || args.body === void 0 ? { method } : { method, body: args.body };
  let raw;
  try {
    raw = await getPluginContext().rest(path, opts);
  } catch (error) {
    if (error instanceof TubeApiError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new TubeApiError({ code: "internal", message }, true);
  }
  return unwrapEnvelope(raw);
}
function restCall(key, ...[args]) {
  return restLoose(key, args);
}
function restCallLoose(key, args) {
  return restLoose(key, args);
}
var NO_CONNECTION = atom7(null);
var NO_PROFILE = atom7("default");
function activeConnectionId() {
  const stated = host3.state?.connectionId?.get?.();
  if (typeof stated === "string" && stated) return stated;
  try {
    const fn = host3.activeConnectionId;
    const id = typeof fn === "function" ? fn() : null;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}
function scopeOf(connection, profile) {
  return `${connection ?? ""}::${typeof profile === "string" && profile.trim() || "default"}`;
}
function restScope() {
  return scopeOf(activeConnectionId(), host3.state?.profile?.get?.());
}
function useRestScope() {
  const stated = useValue8(host3.state?.connectionId ?? NO_CONNECTION);
  const profile = useValue8(host3.state?.profile ?? NO_PROFILE);
  return scopeOf(typeof stated === "string" && stated || activeConnectionId(), profile);
}
function restQueryKey(key, args, scope = restScope()) {
  return [PLUGIN_ID, "rest", key, args?.path ?? null, args?.query ?? null, scope];
}
function retryPolicy(failureCount, error) {
  return error instanceof TubeApiError && error.transport && failureCount < 2;
}
function useRest(key, args, options = {}) {
  const loose = args;
  const ri = options.refetchInterval;
  const scope = useRestScope();
  return useQuery({
    queryKey: restQueryKey(key, loose, scope),
    queryFn: () => restLoose(key, loose),
    enabled: options.enabled ?? true,
    staleTime: options.staleTime,
    retry: retryPolicy,
    refetchInterval: typeof ri === "function" ? (query) => ri(query.state.data, query.state.error) : ri
  });
}
var RETRY_BASE_MS = 2e3;
var RETRY_MAX_MS = 3e4;
function retryDelay(attempt) {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempt), RETRY_MAX_MS);
}
function useRetryOnError(query, enabled = true) {
  const attempt = useRef9(0);
  const refetch = useRef9(query.refetch);
  refetch.current = query.refetch;
  if (!query.isError) attempt.current = 0;
  const waiting = enabled && query.isError && !query.isFetching;
  useEffect9(() => {
    if (!waiting) return void 0;
    const id = setTimeout(() => {
      attempt.current += 1;
      void refetch.current();
    }, retryDelay(attempt.current));
    return () => clearTimeout(id);
  }, [waiting]);
}
function invalidateRest(...keys) {
  if (!keys.length) return queryClient.invalidateQueries({ queryKey: [PLUGIN_ID] });
  return Promise.all(keys.map((k) => queryClient.invalidateQueries({ queryKey: [PLUGIN_ID, "rest", k] }))).then(
    () => void 0
  );
}
function invalidateRestExact(key, args) {
  return queryClient.invalidateQueries({ queryKey: restQueryKey(key, args) });
}

// desktop-src/components/states.tsx
import { Fragment as Fragment8, jsx as jsx19, jsxs as jsxs15 } from "react/jsx-runtime";
function StateCopy({ slot, title, description }) {
  return /* @__PURE__ */ jsxs15("div", { className: cx("state-copy"), "data-slot": `${slot}-state`, role: slot === "error" ? "alert" : void 0, children: [
    /* @__PURE__ */ jsx19("p", { className: cx("state-title"), "data-slot": `${slot}-title`, children: title }),
    description ? /* @__PURE__ */ jsx19("p", { className: cx("state-desc"), "data-slot": `${slot}-description`, children: description }) : null
  ] });
}
function EmptyView({ title, description, action, icon, compact }) {
  const t = useT();
  return /* @__PURE__ */ jsxs15("div", { className: cx("state"), "data-part": "empty", "data-compact": compact ? "true" : void 0, children: [
    icon ? /* @__PURE__ */ jsx19("span", { className: cx("state-icon"), "aria-hidden": "true", children: /* @__PURE__ */ jsx19(Codicon14, { name: icon, size: 20 }) }) : null,
    /* @__PURE__ */ jsx19(StateCopy, { slot: "empty", title: title ?? t("empty"), description }),
    action ? /* @__PURE__ */ jsx19("div", { className: cx("state-actions"), children: action }) : null
  ] });
}
function ErrorView({
  error,
  onRetry,
  title,
  description,
  compact
}) {
  const t = useT();
  const api = toApiError(error);
  return /* @__PURE__ */ jsxs15("div", { className: cx("state"), "data-part": "error", "data-tone": "error", "data-compact": compact ? "true" : void 0, children: [
    /* @__PURE__ */ jsx19("span", { className: cx("state-icon"), "aria-hidden": "true", children: /* @__PURE__ */ jsx19(Codicon14, { name: "error", size: 20 }) }),
    /* @__PURE__ */ jsx19(StateCopy, { slot: "error", title: title ?? t("error_title"), description: description ?? errorText(t, api) }),
    onRetry ? /* @__PURE__ */ jsx19("div", { className: cx("state-actions"), children: /* @__PURE__ */ jsx19(Button8, { variant: "outline", size: "sm", onClick: onRetry, children: t("retry") }) }) : null
  ] });
}
function RpcUnavailableNotice({ className }) {
  const t = useT();
  return /* @__PURE__ */ jsxs15("div", { className: withClass(cx("state"), className), "data-rpc-unavailable": true, "data-compact": "true", children: [
    /* @__PURE__ */ jsx19("span", { className: cx("state-icon"), "aria-hidden": "true", children: /* @__PURE__ */ jsx19(Codicon14, { name: "plug", size: 20 }) }),
    /* @__PURE__ */ jsx19(StateCopy, { slot: "empty", title: t(MESSAGE_KEYS.openDesktopBackend) })
  ] });
}

// desktop-src/chat/actions.ts
import { host as host4 } from "@hermes/plugin-sdk";

// desktop-src/lib/video-actions.ts
import { atom as atom8, useValue as useValue9 } from "@hermes/plugin-sdk";
var VIDEO_ACTIONS = ["watched", "later", "archive", "up", "down"];
var isVideoAction = (a) => VIDEO_ACTIONS.includes(a);
function changeFor(action, item, prior) {
  const back = (on) => prior && prior !== on ? prior : "seen";
  switch (action) {
    case "watched":
      return item.state === "watched" ? { change: { state: back("watched") }, toast: "toast.unwatched" } : { change: { state: "watched" }, toast: "toast.watched" };
    case "later":
      return item.state === "later" ? { change: { state: back("later") }, toast: "toast.unlater" } : { change: { state: "later" }, toast: "toast.later" };
    case "archive":
      return item.state === "archived" ? { change: { state: back("archived") }, toast: "toast.unarchived" } : { change: { state: "archived" }, toast: "toast.archived" };
    case "up":
      return item.reaction === "up" ? { change: { reaction: null }, toast: "toast.reaction_cleared" } : { change: { reaction: "up" }, toast: "toast.up" };
    case "down":
      return item.reaction === "down" ? { change: { reaction: null }, toast: "toast.reaction_cleared" } : { change: { reaction: "down" }, toast: "toast.down" };
  }
}
var STATE_OF = { watched: "watched", later: "later", archive: "archived" };
function inverseOf(change, before) {
  const out = {};
  if ("state" in change) out.state = before.state;
  if ("reaction" in change) out.reaction = before.reaction;
  return out;
}
function asLayer(change) {
  const l = {};
  if (change.state !== void 0) l.state = change.state;
  if ("reaction" in change) l.reaction = change.reaction ?? null;
  return l;
}
function planVideoAction(priors3, action, id, current2) {
  const memo2 = `${id}:${action}`;
  const prevPrior = priors3.get(memo2);
  const { change, toast } = changeFor(action, current2, prevPrior);
  if (change.state !== void 0) {
    if (change.state === STATE_OF[action]) priors3.set(memo2, current2.state);
    else priors3.delete(memo2);
  }
  return {
    change,
    toast,
    inverse: inverseOf(change, { state: current2.state, reaction: current2.reaction }),
    restore: () => {
      if (prevPrior === void 0) priors3.delete(memo2);
      else priors3.set(memo2, prevPrior);
    }
  };
}
var $playlistPick = atom8(null);
onShellReset(() => {
  $playlistPick.set(null);
});
function openPlaylistPicker(item) {
  $playlistPick.set({ item });
}
function closePlaylistPicker() {
  if ($playlistPick.get() !== null) $playlistPick.set(null);
}
function usePlaylistPick() {
  return useValue9($playlistPick);
}
var PLAYLIST_ORIGIN = "playlist";
function playAll(playlist, items) {
  const first = items[0];
  if (!first) return false;
  const origin = { kind: PLAYLIST_ORIGIN, id: playlist.id, label: playlist.name };
  if (!watchVideo(first.video.id, { item: first, list: items, source: playlist.name, origin })) openOnYouTube(first.video.id);
  return true;
}
function openFromPlaylist(playlist, items, item) {
  const from = { item, list: items, source: playlist.name, origin: { kind: PLAYLIST_ORIGIN, id: playlist.id, label: playlist.name } };
  openVideo(item.video.id, from);
}

// desktop-src/chat/videos.ts
import { atom as atom9, useValue as useValue10 } from "@hermes/plugin-sdk";
import { useEffect as useEffect10 } from "react";
var BATCH_MAX = 50;
var STALE_MS = 6e4;
var $chatVideos = atom9({});
var $chatOverlay = atom9({});
var pending = /* @__PURE__ */ new Set();
var inFlight = /* @__PURE__ */ new Set();
var scheduled = false;
var generation = 0;
onShellReset(() => {
  generation++;
  pending.clear();
  inFlight.clear();
  scheduled = false;
  $chatVideos.set({});
  $chatOverlay.set({});
});
function patch(next) {
  $chatVideos.set({ ...$chatVideos.get(), ...next });
}
async function fetchChunk(ids) {
  const gen = generation;
  const now = Date.now();
  try {
    const data = await restCall("GET /videos", { query: { ids: ids.join(",") } });
    if (gen !== generation) return;
    const found = /* @__PURE__ */ new Map();
    for (const it of data?.items ?? []) if (it?.video?.id) found.set(it.video.id, it);
    const next = {};
    for (const id of ids) {
      const it = found.get(id);
      next[id] = it ? { status: "ready", item: it, at: now } : { status: "unknown", at: now };
    }
    patch(next);
  } catch (error) {
    if (gen !== generation) return;
    const err = toApiError(error);
    const current2 = $chatVideos.get();
    const next = {};
    for (const id of ids) if (current2[id]?.status !== "ready") next[id] = { status: "error", error: err, at: now };
    patch(next);
  } finally {
    if (gen === generation) for (const id of ids) inFlight.delete(id);
  }
}
function flushPending() {
  scheduled = false;
  const ids = [...pending].filter((id) => !inFlight.has(id));
  pending.clear();
  for (const id of ids) inFlight.add(id);
  for (let i = 0; i < ids.length; i += BATCH_MAX) void fetchChunk(ids.slice(i, i + BATCH_MAX));
}
function requestChatVideos(ids, options = {}) {
  const fresh = ids.filter((id) => !inFlight.has(id) && !pending.has(id));
  if (!fresh.length) return;
  if (!options.silent) {
    const next = {};
    for (const id of fresh) next[id] = { status: "loading" };
    patch(next);
  }
  for (const id of fresh) pending.add(id);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flushPending);
  }
}
function retryFailedChatVideos() {
  const failed = Object.entries($chatVideos.get()).filter(([, e]) => e.status === "error").map(([id]) => id);
  requestChatVideos(failed);
}
function useChatVideo(id) {
  const all = useValue10($chatVideos);
  const entry = all[id];
  useEffect10(() => {
    const current2 = $chatVideos.get()[id];
    if (!current2) requestChatVideos([id]);
    else if (current2.status !== "loading" && Date.now() - current2.at > STALE_MS) requestChatVideos([id], { silent: current2.status === "ready" });
  }, [id]);
  return entry ?? { status: "loading" };
}
function setChatLayer(id, layer) {
  const next = { ...$chatOverlay.get() };
  if (layer && Object.keys(layer).length) next[id] = layer;
  else delete next[id];
  $chatOverlay.set(next);
}
function applyLayer(item, layer) {
  if (!layer) return item;
  const state = layer.state ?? item.state;
  return {
    ...item,
    state,
    reaction: layer.reaction !== void 0 ? layer.reaction : item.reaction,
    is_new: item.is_new && state === "new"
  };
}
function useChatLayer(id) {
  return useValue10($chatOverlay)[id];
}

// desktop-src/chat/actions.ts
var CHAT_SHORTCUTS = { l: "later", w: "watched", o: "open" };
var UNDO_MS = 7e3;
var priors = /* @__PURE__ */ new Map();
onShellReset(() => priors.clear());
var send = (id, change) => restCall("POST /videos/state", { body: { video_ids: [id], ...change } });
function runChatAction(action, raw, t, tc2) {
  const id = raw.video.id;
  if (action === "open") {
    openVideo(id);
    return;
  }
  const prevLayer = $chatOverlay.get()[id];
  const current2 = applyLayer(raw, prevLayer);
  const { change, toast, inverse, restore } = planVideoAction(priors, action, id, current2);
  const applied = { ...prevLayer, ...asLayer(change) };
  const fail = (key, error) => host4.notify({ kind: "error", message: t(key, { error: errorText(tc2, toApiError(error)) }) });
  setChatLayer(id, applied);
  send(id, change).then(
    () => {
      void invalidateRest("GET /status");
      host4.notify({
        kind: "success",
        message: t(toast),
        durationMs: UNDO_MS,
        action: {
          label: t("toast.undo"),
          onClick: () => {
            const undone = { ...applied, ...asLayer(inverse) };
            setChatLayer(id, undone);
            send(id, inverse).then(
              () => void invalidateRest("GET /status"),
              (error) => {
                setChatLayer(id, applied);
                fail("toast.undo_failed", error);
              }
            );
          }
        }
      });
    },
    (error) => {
      if ($chatOverlay.get()[id] === applied) {
        setChatLayer(id, prevLayer);
        restore();
      }
      fail("toast.failed", error);
    }
  );
}
function shortcutFor(e) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return null;
  const el = e.target;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return null;
  return CHAT_SHORTCUTS[e.key.toLowerCase()] ?? null;
}

// desktop-src/chat/directive.ts
function parseVideoDirective(attrs) {
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return null;
  const proto = Object.getPrototypeOf(attrs);
  if (proto !== Object.prototype && proto !== null) return null;
  const keys = Reflect.ownKeys(attrs);
  if (keys.length !== 1 || keys[0] !== "id") return null;
  const desc = Object.getOwnPropertyDescriptor(attrs, "id");
  if (!desc || !("value" in desc)) return null;
  const id = desc.value;
  return isVideoId(id) ? id : null;
}
var FALLBACK_MAX = 240;
function fallbackText(source) {
  if (typeof source !== "string") return "";
  const flat = source.replace(/\s+/g, " ").trim();
  return flat.length > FALLBACK_MAX ? `${flat.slice(0, FALLBACK_MAX)}…` : flat;
}

// desktop-src/chat/styles.ts
var CHAT_CSS = [
  "/* root of each directive: block in the reply flow, with the same spacing as a paragraph */",
  ".PFX_chat {",
  "  display: block;",
  "  max-width: 640px;",
  "  margin-block: var(--paragraph-gap, 0.7rem) 0;",
  "  animation: PFX_fade-in var(--PFX_dur-slow) var(--PFX_ease) both;",
  "}",
  "",
  ".PFX_chat:first-child {",
  "  margin-top: 0;",
  "}",
  "",
  "/* stack: consecutive cards touch and share the divider (a single block, corners only at the ends) */",
  ".PFX_chat > .PFX_card {",
  "  border-color: var(--ui-stroke-tertiary);",
  "}",
  "",
  ".PFX_chat + .PFX_chat {",
  "  margin-top: -1px;",
  "}",
  "",
  ".PFX_chat:has(+ .PFX_chat) > .PFX_card {",
  "  border-bottom-left-radius: 0;",
  "  border-bottom-right-radius: 0;",
  "}",
  "",
  ".PFX_chat + .PFX_chat > .PFX_card {",
  "  border-top-left-radius: 0;",
  "  border-top-right-radius: 0;",
  "}",
  "",
  "/* in the stack the card does not lift on hover (it would misalign the divider); the highlight is the surface and the divider on top */",
  ".PFX_chat > .PFX_card:hover,",
  ".PFX_chat > .PFX_card:focus-within {",
  "  z-index: 1;",
  "  transform: none;",
  "}",
  "",
  '/* the "why is this here" line does not exist in chat (the agent explains it itself): no empty line above */',
  ".PFX_chat [data-part='why'] {",
  "  display: none;",
  "}",
  "",
  ".PFX_chat .PFX_card[data-variant='row'] .PFX_card-body {",
  "  gap: 2px;",
  "}",
  "",
  "/* the root does not remount when data arrives, but the card does: the thumbnail (already cached) shows without",
  "   fading in again — the whole card already entered with a fade */",
  ".PFX_chat .PFX_thumb-img {",
  "  opacity: 1;",
  "}",
  "",
  "/* minimal card (unknown video): the bottom line says where it comes from, in a tertiary tone */",
  ".PFX_chat-note {",
  "  min-width: 0;",
  "  overflow: hidden;",
  "  color: var(--PFX_fg3);",
  "  text-overflow: ellipsis;",
  "}",
  "",
  "/* narrow: the kit hides the row actions; in chat they stay, over the corner, on hover/focus */",
  "@container PFX_card (max-width: 360px) {",
  "  .PFX_chat .PFX_card[data-variant='row'] .PFX_card-actions {",
  "    display: block;",
  "    position: absolute;",
  "    left: auto;",
  "    right: 6px;",
  "    bottom: 6px;",
  "  }",
  "",
  "  .PFX_chat .PFX_card[data-variant='row'] .PFX_quick {",
  "    background: var(--PFX_scrim);",
  "    box-shadow: inset 0 0 0 1px var(--ui-stroke-tertiary);",
  "    -webkit-backdrop-filter: blur(8px);",
  "    backdrop-filter: blur(8px);",
  "  }",
  "",
  "  .PFX_chat .PFX_quick-kbd {",
  "    display: none;",
  "  }",
  "",
  "  /* the metadata line keeps the channel and age (no avatar) — nothing cut without an ellipsis */",
  "  .PFX_chat .PFX_card-meta .PFX_avatar {",
  "    display: none;",
  "  }",
  "}",
  "",
  "/* error: a plain link (the video stays reachable) + discreet reason + retry */",
  ".PFX_chat-fallback {",
  "  display: flex;",
  "  flex-wrap: wrap;",
  "  align-items: center;",
  "  gap: 2px var(--PFX_s2);",
  "  min-height: var(--PFX_lh-body);",
  "  color: var(--ui-text-secondary);",
  "}",
  "",
  ".PFX_chat-link {",
  "  display: inline-flex;",
  "  align-items: center;",
  "  gap: var(--PFX_s1);",
  "  min-width: 0;",
  "  color: var(--ui-text-primary);",
  "  text-decoration: underline;",
  "  text-decoration-color: var(--ui-stroke-secondary);",
  "  text-underline-offset: 3px;",
  "  overflow-wrap: anywhere;",
  "}",
  "",
  ".PFX_chat-link:hover {",
  "  text-decoration-color: currentColor;",
  "}",
  "",
  ".PFX_chat-link:focus-visible {",
  "  outline: 2px solid var(--PFX_ring);",
  "  outline-offset: 2px;",
  "  border-radius: 2px;",
  "}",
  "",
  ".PFX_chat-why {",
  "  color: var(--PFX_fg3);",
  "}",
  "",
  "/* rejected directive: the text the model wrote, as prose (nothing clickable) */",
  ".PFX_chat-raw {",
  "  margin-block: var(--paragraph-gap, 0.7rem) 0;",
  "  overflow-wrap: anywhere;",
  "}"
].join("\n");
var CHAT_STYLE_ATTR = `data-${CLASS_PREFIX}chat-styles`;
var ownerCtx = null;
var tokenSeq2 = 0;
onShellReset(() => {
  ownerCtx = null;
});
function ensureChatStyles(doc = globalThis.document) {
  if (!doc?.head) return;
  const found = [...doc.head.querySelectorAll(`style[${CHAT_STYLE_ATTR}]`)];
  for (const extra of found.slice(1)) extra.remove();
  let el = found[0];
  if (!el) {
    el = doc.createElement("style");
    el.setAttribute(CHAT_STYLE_ATTR, "");
    doc.head.appendChild(el);
  }
  const css = resolveCss(CHAT_CSS);
  if (el.textContent !== css) el.textContent = css;
  const ctx = maybePluginContext();
  if (ctx && (ownerCtx !== ctx || el.getAttribute(CHAT_STYLE_ATTR) === "")) {
    ownerCtx = ctx;
    const token = `${Date.now().toString(36)}-${++tokenSeq2}`;
    el.setAttribute(CHAT_STYLE_ATTR, token);
    const style = el;
    ctx.onDispose(() => {
      if (style.isConnected && style.getAttribute(CHAT_STYLE_ATTR) === token) style.remove();
    });
  }
}

// desktop-src/chat/mascot.tsx
import { Codicon as Codicon15, Switch } from "@hermes/plugin-sdk";
import { useState as useState8 } from "react";
import { jsx as jsx20, jsxs as jsxs16 } from "react/jsx-runtime";
var MASCOT_KEYS = {
  enabled: "chat.mascot.enabled",
  /** channel_id → last `latest_video_id` seen. */
  seen: "chat.mascot.seen",
  /** channel_id → local day (YYYY-MM-DD) of the last bubble. */
  said: "chat.mascot.said"
};
var MASCOT_MAX_CHARS = 120;
var MASCOT_MAX_LINES = 2;
var memory = /* @__PURE__ */ new Map();
onShellReset(() => memory.clear());
function read(key, fallback) {
  const storage4 = maybePluginContext()?.storage;
  try {
    if (storage4) return storage4.get(key, fallback);
  } catch {
  }
  return memory.has(key) ? memory.get(key) : fallback;
}
function write(key, value) {
  const storage4 = maybePluginContext()?.storage;
  try {
    if (storage4) {
      storage4.set(key, value);
      return;
    }
  } catch {
  }
  memory.set(key, value);
}
function isRecord(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function isMascotEnabled() {
  return read(MASCOT_KEYS.enabled, true) !== false;
}
function today() {
  const d = /* @__PURE__ */ new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function clip(text, max) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
function lineFor(f) {
  const channel = clip(f.title || "", 48);
  if (!f.latest_title) return clip(tNow("chat", "mascot.published_untitled", { channel }), MASCOT_MAX_CHARS);
  const empty = tNow("chat", "mascot.published", { channel, title: "" });
  const room = Math.max(12, MASCOT_MAX_CHARS - empty.length);
  return clip(tNow("chat", "mascot.published", { channel, title: clip(f.latest_title, room) }), MASCOT_MAX_CHARS);
}
function mascotLines(prev, next) {
  void prev;
  const favs = (Array.isArray(next?.fav_new) ? next.fav_new : []).filter((f) => f && typeof f.channel_id === "string");
  const storedSeen = read(MASCOT_KEYS.seen, null);
  const firstEver = !isRecord(storedSeen);
  const seen = firstEver ? {} : { ...storedSeen };
  const day = today();
  const storedSaid = read(MASCOT_KEYS.said, {});
  const said = Object.fromEntries(Object.entries(isRecord(storedSaid) ? storedSaid : {}).filter(([, d]) => d === day));
  const fresh = [];
  for (const f of favs) {
    const vid = f.latest_video_id;
    if (!vid) continue;
    if (!firstEver && seen[f.channel_id] !== vid && said[f.channel_id] !== day) fresh.push(f);
    seen[f.channel_id] = vid;
  }
  const enabled = isMascotEnabled() && next.mascot_favorites !== false;
  const lines = [];
  if (enabled && fresh.length) {
    const shown = fresh.length > MASCOT_MAX_LINES + 1 ? fresh.slice(0, MASCOT_MAX_LINES) : fresh;
    for (const f of shown) lines.push({ id: `fav:${f.channel_id}`, text: lineFor(f) });
    const rest = fresh.length - shown.length;
    if (rest > 0) lines.push({ id: "fav:more", text: clip(tNow("chat", "mascot.more", { count: rest }), MASCOT_MAX_CHARS) });
    for (const f of fresh) said[f.channel_id] = day;
  }
  write(MASCOT_KEYS.seen, seen);
  write(MASCOT_KEYS.said, said);
  return lines;
}

// desktop-src/chat/index.tsx
import { jsx as jsx21, jsxs as jsxs17 } from "react/jsx-runtime";
function ChatVideoCard({ attrs, source }) {
  const id = parseVideoDirective(attrs);
  if (!id) {
    const text = fallbackText(source);
    return text ? /* @__PURE__ */ jsx21("p", { className: cx("chat-raw"), children: text }) : null;
  }
  return /* @__PURE__ */ jsx21(ChatVideo, { id });
}
function ChatVideo({ id }) {
  useInsertionEffect(() => ensureChatStyles(), []);
  const t = useT("chat");
  const tc2 = useT();
  const entry = useChatVideo(id);
  const layer = useChatLayer(id);
  const ready = entry.status === "ready" ? entry.item : null;
  const run = (action) => {
    if (action === "open") openOnYouTube(id);
    else if (ready) runChatAction(action, ready, t, tc2);
  };
  const onKeyDown = (e) => {
    const action = shortcutFor(e);
    if (!action || action !== "open" && !ready) return;
    e.preventDefault();
    e.stopPropagation();
    run(action);
  };
  let body;
  let label;
  if (entry.status === "ready" && ready) {
    const item = applyLayer(ready, layer);
    label = t("card.label", { title: item.video.title });
    body = /* @__PURE__ */ jsx21(VideoCard, { item, variant: "row", actions: /* @__PURE__ */ jsx21(ChatActions, { t, item, onAction: run }) });
  } else if (entry.status === "unknown") {
    label = t("card.unknown_title");
    body = /* @__PURE__ */ jsx21(MinimalCard, { id, t, onAction: run });
  } else if (entry.status === "error") {
    label = t("card.error");
    body = /* @__PURE__ */ jsx21(FallbackLink, { id, t, reason: errorText(tc2, entry.error) });
  } else {
    label = t("card.loading");
    body = /* @__PURE__ */ jsx21(LoadingCard, { id });
  }
  return /* @__PURE__ */ jsx21(
    "div",
    {
      className: cx("chat"),
      role: "group",
      "aria-label": label,
      "aria-busy": entry.status === "loading" ? "true" : void 0,
      "data-chat-video": id,
      "data-chat-status": entry.status,
      onKeyDown,
      children: body
    }
  );
}
function ChatActions({ t, item, onAction }) {
  const tc2 = useT();
  const actions = [];
  if (item) {
    const later = item.state === "later";
    const watched = item.state === "watched";
    actions.push(
      { id: "later", label: t("actions.later"), hint: tc2(later ? "kit.actions.later_undo" : "kit.actions.later_do"), icon: "clock", shortcut: "l", onSelect: () => onAction("later"), pressed: later },
      { id: "watched", label: t("actions.watched"), hint: tc2(watched ? "kit.actions.watched_undo" : "kit.actions.watched_do"), icon: "eye", shortcut: "w", onSelect: () => onAction("watched"), pressed: watched }
    );
  }
  actions.push({ id: "open", label: t("actions.open"), icon: "link-external", shortcut: "o", onSelect: () => onAction("open") });
  return /* @__PURE__ */ jsx21(QuickActions, { actions, label: t("actions.label") });
}
function LoadingCard({ id }) {
  return /* @__PURE__ */ jsx21("article", { className: cx("card"), "data-part": "card", "data-variant": "row", "data-skeleton": true, children: /* @__PURE__ */ jsxs17("div", { className: cx("card-frame"), children: [
    /* @__PURE__ */ jsx21("div", { className: cx("card-media"), "data-part": "media", children: /* @__PURE__ */ jsx21(Thumb, { videoId: id }) }),
    /* @__PURE__ */ jsxs17("div", { className: cx("card-body"), "data-part": "body", "aria-hidden": "true", children: [
      /* @__PURE__ */ jsx21("div", { className: cx("card-title t-head"), "data-part": "title", "data-skeleton": true, children: /* @__PURE__ */ jsx21(SkLines, { widths: ["78%"] }) }),
      /* @__PURE__ */ jsxs17("div", { className: cx("card-meta t-label"), "data-part": "meta", children: [
        /* @__PURE__ */ jsx21(ChannelAvatarSkeleton, { size: 16 }),
        /* @__PURE__ */ jsx21(SkBar, { width: "46%" })
      ] })
    ] })
  ] }) });
}
function MinimalCard({ id, t, onAction }) {
  return /* @__PURE__ */ jsx21("article", { className: cx("card"), "data-part": "card", "data-variant": "row", "data-video": id, children: /* @__PURE__ */ jsxs17("div", { className: cx("card-frame"), children: [
    /* @__PURE__ */ jsx21("div", { className: cx("card-media"), "data-part": "media", children: /* @__PURE__ */ jsx21(Thumb, { videoId: id }) }),
    /* @__PURE__ */ jsxs17("div", { className: cx("card-body"), "data-part": "body", children: [
      /* @__PURE__ */ jsx21("h3", { className: cx("card-title t-head"), "data-part": "title", children: /* @__PURE__ */ jsx21(
        "a",
        {
          href: youtubeWatchUrl(id),
          className: cx("bare card-open"),
          "data-open-video": true,
          onClick: (e) => {
            e.preventDefault();
            if (wantsYouTube(e)) onAction("open");
            else openVideo(id);
          },
          onAuxClick: (e) => {
            e.preventDefault();
            if (e.button === 1) onAction("open");
          },
          children: t("card.unknown_title")
        }
      ) }),
      /* @__PURE__ */ jsx21("div", { className: cx("card-meta t-label"), "data-part": "meta", children: /* @__PURE__ */ jsx21("span", { className: cx("chat-note"), children: t("card.unknown_note") }) })
    ] }),
    /* @__PURE__ */ jsx21("div", { className: cx("card-actions"), "data-part": "actions", children: /* @__PURE__ */ jsx21(ChatActions, { t, onAction }) })
  ] }) });
}
function FallbackLink({ id, t, reason }) {
  const url = youtubeWatchUrl(id);
  return /* @__PURE__ */ jsxs17("div", { className: cx("chat-fallback t-body"), children: [
    /* @__PURE__ */ jsxs17(
      "a",
      {
        href: url,
        className: cx("chat-link"),
        "data-open-video": true,
        onClick: (e) => {
          e.preventDefault();
          openVideo(id);
        },
        children: [
          /* @__PURE__ */ jsx21(Codicon16, { name: "play-circle", size: 14 }),
          url.replace(/^https:\/\/www\./, "")
        ]
      }
    ),
    /* @__PURE__ */ jsx21("span", { className: cx("chat-why t-label"), title: reason, children: t("card.error") }),
    /* @__PURE__ */ jsxs17(Button9, { variant: "ghost", size: "xs", "data-chat-retry": true, onClick: () => retryFailedChatVideos(), children: [
      /* @__PURE__ */ jsx21(Codicon16, { name: "refresh", size: 12 }),
      t("card.retry")
    ] })
  ] });
}

// desktop-src/chrome/index.tsx
import { atom as atom12, host as host6, icons, useValue as useValue12 } from "@hermes/plugin-sdk";

// desktop-src/lib/pet.ts
import { atom as atom10 } from "@hermes/plugin-sdk";
var $petFallback = atom10(null);
onShellReset(() => {
  $petFallback.set(null);
});
function petAvailable() {
  const pet = maybePluginContext()?.pet;
  return !!pet && typeof pet.say === "function" && pet.visible?.get?.() === true;
}
function sayToPet(line) {
  const ctx = maybePluginContext();
  if (ctx && petAvailable()) {
    ctx.pet.say(line.text, {
      id: line.id,
      ...line.tone ? { tone: line.tone } : {},
      ...line.ttlMs ? { ttlMs: line.ttlMs } : {}
    });
    return "pet";
  }
  $petFallback.set({ ...line, at: Date.now() });
  return "fallback";
}
function clearPetFallback() {
  $petFallback.set(null);
}

// desktop-src/lib/status.ts
import { atom as atom11, host as host5, useValue as useValue11 } from "@hermes/plugin-sdk";
import { useEffect as useEffect11, useState as useState9 } from "react";
function documentVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}
var $windowVisible = atom11(documentVisible());
var $status = atom11(null);
onShellReset(() => {
  $status.set(null);
  $windowVisible.set(documentVisible());
});
function bindWindowVisibility(ctx) {
  if (typeof document === "undefined") return;
  const update = () => $windowVisible.set(documentVisible());
  update();
  ctx.addEventListener(document, "visibilitychange", update);
}
function statusPollInterval(visible) {
  return visible ? STATUS_POLL_MS : false;
}
function useStatus(options = {}) {
  const visible = useValue11($windowVisible);
  return useRest("GET /status", {}, { refetchInterval: options.poll ? statusPollInterval(visible) : false });
}
var NOT_HERE = /\b404\b|not found|expected json|got html|plugin.*(disabled|not (installed|loaded|enabled))/i;
function pluginMissing(error, options = {}) {
  if (!error) return false;
  if (error instanceof TubeApiError) {
    if (error.code === "plugin_disabled") return options.disabled === true;
    return error.transport && NOT_HERE.test(error.message);
  }
  const api = toApiError(error);
  if (api.code === "plugin_disabled") return options.disabled === true;
  return api.code === "internal" && NOT_HERE.test(api.message);
}
var LOCAL_PLACE = { known: true, remote: false, name: null, local: null };
var UNKNOWN_PLACE = { known: false, remote: false, name: null, local: null };
var LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|::1|\[::1\])$/i;
function hostnameOf(c) {
  if (typeof c.host === "string" && c.host.trim()) return c.host.trim();
  if (typeof c.url !== "string" || !c.url) return null;
  try {
    return new URL(c.url).hostname || null;
  } catch {
    return null;
  }
}
function placeOf(list, id) {
  const items = list.filter((c) => !!c && typeof c === "object" && typeof c.id === "string");
  const local = items.find((c) => c.kind === "local")?.label?.trim() || null;
  const conn = id ? items.find((c) => c.id === id) : items.find((c) => c.primary);
  if (!conn || !conn.kind || conn.kind === "local") return { known: true, remote: false, name: null, local };
  const address = hostnameOf(conn);
  if (address && LOOPBACK.test(address)) return { known: true, remote: false, name: null, local };
  return { known: true, remote: true, name: conn.label?.trim() || address || conn.kind, local };
}
var NO_CONNECTION2 = atom11(null);
var NO_PROFILE2 = atom11("default");
function useGatewayPlace() {
  const connection = useValue11(host5.state?.connectionId ?? NO_CONNECTION2);
  const profile = useValue11(host5.state?.profile ?? NO_PROFILE2);
  const api = host5;
  const [place, setPlace] = useState9(() => typeof api.connections === "function" ? UNKNOWN_PLACE : LOCAL_PLACE);
  useEffect11(() => {
    if (typeof api.connections !== "function") {
      setPlace(LOCAL_PLACE);
      return void 0;
    }
    let alive = true;
    const id = activeConnectionId();
    let pending2;
    try {
      pending2 = Promise.resolve(api.connections());
    } catch (error) {
      pending2 = Promise.reject(error);
    }
    pending2.then(
      (list) => {
        if (alive) setPlace(placeOf(Array.isArray(list) ? list : [], id));
      },
      () => {
        if (alive) setPlace(LOCAL_PLACE);
      }
    );
    return () => {
      alive = false;
    };
  }, [api, connection, profile]);
  return place;
}

// desktop-src/chrome/index.tsx
import { Fragment as Fragment9, jsx as jsx22, jsxs as jsxs18 } from "react/jsx-runtime";
var NOT_HERE2 = /\b404\b|not found|expected json|got html|plugin.*(disabled|not (installed|loaded|enabled))/i;
function failureKind(error) {
  if (error instanceof TubeApiError) {
    if (error.code === "plugin_disabled") return "unavailable";
    if (error.transport) return NOT_HERE2.test(error.message) ? "unavailable" : "offline";
    return "error";
  }
  const api = toApiError(error);
  if (api.code === "plugin_disabled") return "unavailable";
  if (api.code !== "internal") return "error";
  return NOT_HERE2.test(api.message) ? "unavailable" : "offline";
}
function chipState(q) {
  if (q.error) return { kind: "error", reason: failureKind(q.error), error: toApiError(q.error) };
  const s = q.data;
  if (!s) return { kind: "loading" };
  const count2 = Math.max(0, s.new_total | 0);
  if (s.refresh_running) return { kind: "refreshing", count: count2, lastRssAt: s.last_rss_at };
  return count2 > 0 ? { kind: "new", count: count2, lastRssAt: s.last_rss_at } : { kind: "zero", lastRssAt: s.last_rss_at };
}
function plural(locale, n) {
  try {
    return new Intl.PluralRules(locale).select(n) === "one" ? "one" : "other";
  } catch {
    return n === 1 ? "one" : "other";
  }
}
var NO_PROFILE_ATOM = atom12("default");
function ChipView({ state, petText, onClick }) {
  const t = useT("chrome");
  const tc2 = useT();
  const locale = useLocale();
  const profile = useValue12(host6.state?.profile ?? NO_PROFILE_ATOM) || "default";
  const now = Date.now();
  const updated = (ts) => ts ? t("chip.updated", { when: formatRelative(ts, now, locale) }) : "";
  const withPet = (title2) => [title2, petText ? t("chip.pet", { text: petText }) : ""].filter(Boolean).join("\n");
  let label;
  let count2 = null;
  let note = null;
  let title;
  let reason;
  switch (state.kind) {
    case "loading":
      label = t("chip.loading");
      title = t("chip.title_loading");
      break;
    case "error": {
      reason = state.reason;
      const why = state.reason === "unavailable" ? t("chip.reason_unavailable", { profile }) : state.reason === "offline" ? t("chip.reason_offline") : t("chip.reason_error", { error: errorText(tc2, state.error) });
      label = /* @__PURE__ */ jsxs18(Fragment9, { children: [
        /* @__PURE__ */ jsx22("span", { "aria-hidden": "true", children: "—" }),
        /* @__PURE__ */ jsx22("span", { className: cx("sr"), children: t("chip.unavailable_label") })
      ] });
      title = why;
      break;
    }
    case "refreshing":
      count2 = state.count || null;
      note = t("chip.refreshing");
      label = state.count ? t(`chip.new_${plural(locale, state.count)}`) : "";
      title = [t("chip.title_refreshing"), updated(state.lastRssAt)].filter(Boolean).join(" · ");
      break;
    case "new":
      count2 = state.count;
      label = t(`chip.new_${plural(locale, state.count)}`);
      title = [t("chip.title_new", { count: formatNumber(state.count, locale) }), updated(state.lastRssAt)].filter(Boolean).join(" · ");
      break;
    case "zero":
      label = t("chip.none");
      title = [t("chip.title_none"), updated(state.lastRssAt)].filter(Boolean).join(" · ");
      break;
  }
  return (
    // wrapper without a box (display: contents) only to expose the state to the test and the preview
    /* @__PURE__ */ jsx22("span", { "data-status-chip": true, "data-state": state.kind, "data-reason": reason, style: { display: "contents" }, children: /* @__PURE__ */ jsx22(StatusBarItem, { icon: petText ? "star-full" : "play", count: count2, label, note, title: withPet(title), onClick }) })
  );
}
function StatusChip() {
  const q = useStatus();
  const fallback = useValue12($petFallback);
  const fresh = fallback && (!fallback.ttlMs || Date.now() - fallback.at < fallback.ttlMs) ? fallback : null;
  const state = chipState({ data: q.data, error: q.error });
  return /* @__PURE__ */ jsx22(
    ChipView,
    {
      state,
      petText: fresh?.text ?? null,
      onClick: () => {
        if (fallback) clearPetFallback();
        host6.navigate(DESKTOP_ROUTES.home);
      }
    }
  );
}
function PluginGate({ children }) {
  const t = useT("chrome");
  const status = useStatus();
  const extras = useRest("GET /extras", {});
  const place = useGatewayPlace();
  const profile = useValue12(host6.state?.profile ?? NO_PROFILE_ATOM) || "default";
  const missing = !status.data && !extras.data && pluginMissing(status.error) && pluginMissing(extras.error);
  if (!missing) return /* @__PURE__ */ jsx22(Fragment9, { children });
  const hint = place.remote && place.name ? t("gate.remote", { name: place.name, local: place.local || t("gate.local_default") }) : t("gate.hint", { profile });
  return /* @__PURE__ */ jsx22("div", { "data-part": "plugin-gate", children: /* @__PURE__ */ jsx22(
    ErrorView,
    {
      error: status.error,
      title: t("gate.title", { profile }),
      description: hint,
      onRetry: () => {
        void status.refetch();
        void extras.refetch();
      }
    }
  ) });
}
function keywordsOf(id) {
  const words = LOCALES.flatMap((loc) => (BUNDLES[loc].chrome.palette?.[id]?.keywords ?? "").split(/\s+/));
  return [...new Set(words.filter(Boolean))];
}
var tc = (key, vars2) => tNow("chrome", key, vars2);
function refreshDetail(status = $status.get()) {
  if (!status) return "";
  if (status.refresh_running) return tc("detail.refreshing");
  const locale = tc("locale");
  const n = Math.max(0, status.new_total | 0);
  const head = n > 0 ? tc(`detail.new_${plural(locale, n)}`, { count: formatNumber(n, locale) }) : tc("detail.none");
  const when = status.last_rss_at ? tc("detail.updated", { when: formatRelative(status.last_rss_at, Date.now(), locale) }) : "";
  return [head, when].filter(Boolean).join(" · ");
}
async function refreshNow() {
  try {
    const out = await restCall("POST /refresh", { body: { force: true } });
    host6.notify({ kind: out.result === "skipped" ? "success" : "info", message: tc(`refresh.${out.result}`) });
  } catch (error) {
    const translate = (key, vars2) => tNow("common", key, vars2);
    host6.notify({ kind: "error", message: tc("refresh.failed", { error: errorText(translate, toApiError(error)) }) });
  } finally {
    void invalidateRest("GET /status");
  }
}
function command(id, labelKey, icon, run, detail) {
  return { id, labelKey, label: () => tc(`palette.${id}.label`), icon, keywords: keywordsOf(id), run, ...detail ? { detail } : {} };
}
function paletteCommands() {
  return [
    command(PALETTE_COMMANDS.openHome, "palette.open-home", icons.MonitorPlay, () => host6.navigate(DESKTOP_ROUTES.home)),
    command(PALETTE_COMMANDS.refreshNow, "palette.refresh-now", icons.RefreshCw, () => void refreshNow(), () => refreshDetail()),
    command(PALETTE_COMMANDS.newThemeTab, "palette.new-theme-tab", icons.Plus, () => {
      host6.navigate(DESKTOP_ROUTES.home);
      openDialog(DIALOG_IDS.theme, {});
    }),
    command(PALETTE_COMMANDS.organize, "palette.organize", icons.FolderOpen, () => {
      host6.navigate(DESKTOP_ROUTES.manage);
      openDialog(DIALOG_IDS.organize, {});
    }),
    command(PALETTE_COMMANDS.cleanup, "palette.cleanup", icons.Archive, () => host6.navigate(DESKTOP_ROUTES.cleanup)),
    ...EXTRAS_PAGE_READY ? [command(PALETTE_COMMANDS.openExtras, "palette.open-extras", icons.Package, () => host6.navigate(DESKTOP_ROUTES.extras))] : []
  ];
}
var CONNECT_COMMAND = "connect";
function connectCommand(open = () => host6.navigate(DESKTOP_ROUTES.home)) {
  const words = LOCALES.flatMap((loc) => (BUNDLES[loc].chrome.palette?.[CONNECT_COMMAND]?.keywords ?? "").split(/\s+/));
  return {
    id: `${PLUGIN_ID}.${CONNECT_COMMAND}`,
    label: tc(`palette.${CONNECT_COMMAND}.label`),
    icon: icons.Plug,
    keywords: [...new Set(words.filter(Boolean))],
    run: () => {
      open();
      openDialog(DIALOG_IDS.onboarding, {});
    }
  };
}
function paletteContribution(c) {
  return {
    id: `${PLUGIN_ID}.${c.id}`,
    label: c.label(),
    icon: c.icon,
    keywords: c.keywords,
    run: c.run,
    ...c.detail ? { detail: c.detail, detailVariant: "state" } : {}
  };
}

// desktop-src/dialogs/list-import/index.tsx
import { jsx as jsx23 } from "react/jsx-runtime";
function ListImportDialog({ onClose }) {
  const t = useT();
  return /* @__PURE__ */ jsx23(DialogFrame, { title: t("dialogs.list-import"), onClose, children: /* @__PURE__ */ jsx23(EmptyView, { title: t("placeholder.title"), description: t("placeholder.description") }) });
}

// desktop-src/dialogs/onboarding/index.tsx
import { Button as Button17, Codicon as Codicon21, Kbd as Kbd2 } from "@hermes/plugin-sdk";
import { useCallback as useCallback7, useEffect as useEffect17, useRef as useRef15, useState as useState16 } from "react";

// desktop-src/dialogs/onboarding/demo.tsx
import { Button as Button11 } from "@hermes/plugin-sdk";
import { useCallback as useCallback5, useEffect as useEffect13, useRef as useRef11, useState as useState11 } from "react";

// desktop-src/dialogs/onboarding/model.ts
var LIVE_POLL_MS = 2e3;
var AUTO_CLOSE_S = 5;
var SYNC_PATIENCE_MS = 9e4;
var DEMO_PATIENCE_MS = 6e4;
var ONLINE_WINDOW_S = 120;
var AFTER_CHANNELS = ["GET /channels", "GET /tabs", "GET /status", "GET /feed", "GET /demo"];
var CHANNEL_ID = /^UC[0-9A-Za-z_-]{22}$/;
var VIDEO_ID2 = /^[0-9A-Za-z_-]{11}$/;
var HANDLE = /^@[\p{L}\p{M}\p{N}._\-·]{1,100}$/u;
var VANITY = /^[\p{L}\p{N}_.-]+$/u;
var YOUTUBE_HOSTS = /* @__PURE__ */ new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
var SHORT_HOSTS = /* @__PURE__ */ new Set(["youtu.be", "www.youtu.be"]);
var VIDEO_PREFIXES = /* @__PURE__ */ new Set(["shorts", "live", "embed", "v", "e"]);
var RESERVED = /* @__PURE__ */ new Set([
  "about",
  "account",
  "attribution_link",
  "c",
  "channel",
  "feed",
  "gaming",
  "hashtag",
  "howyoutubeworks",
  "kids",
  "logout",
  "music",
  "playlist",
  "post",
  "premium",
  "redirect",
  "results",
  "signin",
  "source",
  "t",
  "trending",
  "upload",
  "user",
  "watch"
]);
function segmentsOf(pathname) {
  return pathname.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
}
function parseChannelInput(raw) {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  if (CHANNEL_ID.test(value)) return "channel_id";
  if (value.startsWith("@")) return HANDLE.test(value) ? "handle" : null;
  let url;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host28 = url.hostname.toLowerCase();
  const segs = segmentsOf(url.pathname);
  if (SHORT_HOSTS.has(host28)) return segs[0] && VIDEO_ID2.test(segs[0]) ? "video_url" : null;
  if (!YOUTUBE_HOSTS.has(host28) || !segs.length) return null;
  const first = segs[0];
  const lower = first.toLowerCase();
  if (first.startsWith("@")) return HANDLE.test(first) ? "channel_url" : null;
  if (lower === "channel") return segs[1] && CHANNEL_ID.test(segs[1]) ? "channel_url" : null;
  if (lower === "c" || lower === "user") return segs[1] && VANITY.test(segs[1]) ? "channel_url" : null;
  if (lower === "watch") return VIDEO_ID2.test(url.searchParams.get("v") ?? "") ? "video_url" : null;
  if (VIDEO_PREFIXES.has(lower)) return segs[1] && VIDEO_ID2.test(segs[1]) ? "video_url" : null;
  if (RESERVED.has(lower)) return null;
  return VANITY.test(first) ? "channel_url" : null;
}
function pairErrorKind(error) {
  if (error?.code === "ext_endpoint_down") return "ext_endpoint_down";
  if (error?.code === "timeout") return "timeout";
  return "generic";
}
function addErrorOutcome(error) {
  const details = error.details ?? {};
  switch (error.code) {
    case "conflict": {
      const existing = details.channel && typeof details.channel === "object" ? details.channel : null;
      return { state: "exists", key: "link.status.exists", retryable: false, existing };
    }
    case "invalid":
      return { state: "error", key: "link.errors.format", retryable: false };
    case "youtube_error": {
      const status = Number(details.status);
      if (status === 404 || status === 410) return { state: "error", key: "link.errors.not_found", retryable: false };
      if (status === 429) return { state: "error", key: "link.errors.rate_limited", retryable: true };
      return { state: "error", key: "link.errors.youtube_down", retryable: true };
    }
    case "timeout":
      return details.pending === true ? { state: "late", key: "link.status.late", retryable: false } : { state: "error", key: "link.errors.timeout", retryable: true };
    default:
      return { state: "error", key: "link.errors.generic", retryable: true };
  }
}
function findNewDevice(items, baseline, issuedAtS) {
  const fresh = items.filter(
    (d) => d.revoked_at == null && (baseline ? !baseline.includes(d.id) : d.created_at >= issuedAtS - 30)
  );
  if (!fresh.length) return null;
  return fresh.reduce((a, b) => b.created_at > a.created_at ? b : a);
}
function pluralCategory(count2) {
  return count2 === 1 ? "one" : "other";
}
function isSafeExternalUrl(url) {
  return typeof url === "string" && /^https:\/\/[^\s]+$/.test(url);
}

// desktop-src/dialogs/onboarding/parts.tsx
import { Button as Button10, useValue as useValue13 } from "@hermes/plugin-sdk";
import { useCallback as useCallback4, useEffect as useEffect12, useRef as useRef10, useState as useState10 } from "react";
import { jsx as jsx24, jsxs as jsxs19 } from "react/jsx-runtime";
function usePlural() {
  const t = useT("onboarding");
  const locale = useLocale();
  return useCallback4(
    (what, count2) => t(`plural.${what}_${pluralCategory(count2)}`, { count: formatNumber(count2, locale) }),
    [t, locale]
  );
}
function useWindowVisible() {
  return useValue13($windowVisible);
}
function AutoClose({ onDone }) {
  const t = useT("onboarding");
  const locale = useLocale();
  const [left, setLeft] = useState10(AUTO_CLOSE_S);
  const [stayed, setStayed] = useState10(false);
  const fired = useRef10(false);
  const done = useCallback4(() => {
    if (fired.current) return;
    fired.current = true;
    onDone();
  }, [onDone]);
  useEffect12(() => {
    if (stayed) return void 0;
    const id = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1e3);
    return () => clearInterval(id);
  }, [stayed]);
  useEffect12(() => {
    if (!stayed && left <= 0) done();
  }, [left, stayed, done]);
  return /* @__PURE__ */ jsx24("div", { "data-part": "auto-close", children: /* @__PURE__ */ jsxs19(Stack, { direction: "row", gap: 2, justify: "between", wrap: true, children: [
    /* @__PURE__ */ jsx24("span", { className: cx("t-label num"), role: "status", "aria-live": "polite", children: stayed ? null : t("done.closing", { seconds: formatNumber(left, locale) }) }),
    /* @__PURE__ */ jsxs19(Stack, { direction: "row", gap: 2, children: [
      stayed ? null : /* @__PURE__ */ jsx24(Button10, { variant: "ghost", size: "sm", "data-part": "auto-close-stay", onClick: () => setStayed(true), children: t("done.stay") }),
      /* @__PURE__ */ jsx24(Button10, { size: "sm", "data-part": "auto-close-now", onClick: done, children: t("done.open_now") })
    ] })
  ] }) });
}

// desktop-src/dialogs/onboarding/demo.tsx
import { Fragment as Fragment10, jsx as jsx25, jsxs as jsxs20 } from "react/jsx-runtime";
function DemoPanel({ seed, autoLoad, onFinish, onDirty }) {
  const t = useT("onboarding");
  const tc2 = useT();
  const plural5 = usePlural();
  const visible = useWindowVisible();
  const [state, setState] = useState11(seed ?? { phase: "checking" });
  const { phase } = state;
  const live = phase === "arriving";
  const demo = useRest("GET /demo", {}, { enabled: !seed });
  const status = useRest("GET /status", {}, { refetchInterval: visible && live ? LIVE_POLL_MS : false });
  const uiLocale = useUiLocale();
  const load = useCallback5(() => {
    setState({ phase: "loading" });
    restCall("POST /demo/load", { body: { ui_locale: uiLocale } }).then(
      (report2) => {
        onDirty();
        setState({ phase: "arriving", report: report2, since: Date.now() });
        restCall("POST /refresh", { body: { force: true } }).catch(() => void 0);
        void invalidateRest(...AFTER_CHANNELS);
      },
      () => setState({ phase: "error", failed: "load" })
    );
  }, [onDirty, uiLocale]);
  const clear = () => {
    const before = state;
    setState({ phase: "cleared" });
    restCall("POST /demo/clear").then(
      () => {
        onDirty();
        void invalidateRest(...AFTER_CHANNELS);
      },
      () => setState({ ...before, failed: "clear" })
    );
  };
  const decided = useRef11(!!seed);
  useEffect13(() => {
    if (decided.current || phase !== "checking") return;
    if (demo.data !== void 0) {
      decided.current = true;
      if (demo.data.loaded) setState({ phase: "loaded" });
      else if (autoLoad) load();
      else setState({ phase: "idle" });
    } else if (demo.error) {
      decided.current = true;
      if (autoLoad) load();
      else setState({ phase: "idle" });
    }
  }, [demo.data, demo.error, phase, autoLoad, load]);
  const data = status.data;
  useEffect13(() => {
    if (phase !== "arriving" || !data || state.since === void 0 || seed) return;
    if (status.dataUpdatedAt < state.since) return;
    const videos2 = data.new_total;
    const finished = !data.refresh_running && (videos2 > 0 || (data.last_rss_at ?? 0) * 1e3 > state.since);
    setState((s) => s.phase !== "arriving" ? s : { ...s, videos: videos2, phase: finished ? "ready" : "arriving" });
  }, [data, status.dataUpdatedAt, phase, state.since, seed]);
  useEffect13(() => {
    if (phase !== "arriving" || seed) return void 0;
    const left = (state.since ?? Date.now()) + DEMO_PATIENCE_MS - Date.now();
    const ready = () => setState((s) => s.phase === "arriving" ? { ...s, phase: "ready", late: true } : s);
    if (left <= 0) {
      ready();
      return void 0;
    }
    const id = setTimeout(ready, left);
    return () => clearTimeout(id);
  }, [phase, state.since, seed]);
  const report = state.report;
  const videos = state.videos;
  const steps = [
    {
      id: "channels",
      label: t("demo.step_channels"),
      status: phase === "loading" ? "running" : "done",
      detail: report ? `${plural5("channels", report.channels)} · ${plural5("folders", report.folders)}` : void 0
    },
    {
      id: "videos",
      label: t("demo.step_videos"),
      status: phase === "loading" ? "waiting" : phase === "arriving" ? "running" : "done",
      detail: videos !== void 0 && videos > 0 ? plural5("videos", videos) : phase === "ready" && state.late ? t("demo.videos_later") : void 0
    },
    { id: "ready", label: t("demo.step_ready"), status: phase === "ready" ? "done" : "waiting" }
  ];
  const progress = phase === "loading" || phase === "arriving" || phase === "ready";
  const rssDown = progress && data?.rss_down_since != null;
  const clearButton = /* @__PURE__ */ jsx25(Button11, { variant: "outline", size: "sm", "data-part": "demo-clear", onClick: clear, children: t("demo.clear") });
  return /* @__PURE__ */ jsx25("div", { "data-part": "demo", "data-phase": phase, children: /* @__PURE__ */ jsxs20(Stack, { gap: 5, children: [
    state.failed === "clear" ? /* @__PURE__ */ jsx25(Banner, { tone: "error", action: { label: tc2("retry"), onClick: clear }, children: t("demo.errors.clear") }) : null,
    phase === "error" ? /* @__PURE__ */ jsx25(Banner, { tone: "error", action: { label: tc2("retry"), onClick: load }, children: t("demo.errors.load") }) : null,
    rssDown ? /* @__PURE__ */ jsx25(Banner, { tone: "warning", children: t("demo.rss_down") }) : null,
    phase === "checking" ? /* @__PURE__ */ jsx25(StepProgressSkeleton, { count: 3 }) : null,
    progress ? /* @__PURE__ */ jsx25(StepProgress, { steps, label: t("demo.steps_label") }) : null,
    progress && report && report.skipped > 0 ? /* @__PURE__ */ jsx25("p", { className: cx("section-desc t-label"), children: t("demo.skipped", { count: report.skipped }) }) : null,
    phase === "idle" || phase === "error" ? /* @__PURE__ */ jsx25(Stack, { direction: "row", justify: "end", children: /* @__PURE__ */ jsx25(Button11, { size: "sm", "data-part": "demo-load", onClick: load, children: t("demo.load") }) }) : null,
    phase === "loaded" ? /* @__PURE__ */ jsx25(
      EmptyView,
      {
        compact: true,
        icon: "beaker",
        title: t("demo.loaded_title"),
        description: t("demo.loaded_desc"),
        action: /* @__PURE__ */ jsxs20(Fragment10, { children: [
          clearButton,
          /* @__PURE__ */ jsx25(Button11, { size: "sm", "data-part": "demo-open", onClick: onFinish, children: t("done.open_now") })
        ] })
      }
    ) : null,
    phase === "cleared" ? /* @__PURE__ */ jsx25(
      EmptyView,
      {
        compact: true,
        icon: "check",
        title: t("demo.cleared_title"),
        description: t("demo.cleared_desc"),
        action: /* @__PURE__ */ jsx25(Button11, { variant: "outline", size: "sm", "data-part": "demo-load-again", onClick: load, children: t("demo.load_again") })
      }
    ) : null,
    phase === "arriving" ? /* @__PURE__ */ jsx25(Stack, { direction: "row", justify: "end", children: /* @__PURE__ */ jsx25(Button11, { variant: "outline", size: "sm", "data-part": "demo-open", onClick: onFinish, children: t("done.open_now") }) }) : null,
    phase === "ready" ? /* @__PURE__ */ jsxs20(Stack, { gap: 3, children: [
      /* @__PURE__ */ jsx25(Stack, { direction: "row", justify: "end", children: clearButton }),
      /* @__PURE__ */ jsx25(AutoClose, { onDone: onFinish })
    ] }) : null
  ] }) });
}

// desktop-src/dialogs/onboarding/devices.tsx
import { Button as Button12, Codicon as Codicon17 } from "@hermes/plugin-sdk";
import { useState as useState12 } from "react";
import { jsx as jsx26, jsxs as jsxs21 } from "react/jsx-runtime";
function DevicesSection() {
  const t = useT("onboarding");
  const tc2 = useT();
  const locale = useLocale();
  const query = useRest("GET /devices", {});
  useRetryOnError(query);
  const [removed, setRemoved] = useState12(/* @__PURE__ */ new Set());
  const [confirming, setConfirming] = useState12(null);
  const [failed, setFailed] = useState12(null);
  if (query.data === void 0) {
    if (!query.error) return null;
    return /* @__PURE__ */ jsx26("div", { "data-part": "devices", children: /* @__PURE__ */ jsx26(Banner, { tone: "error", icon: "plug", action: { label: tc2("retry"), onClick: () => void query.refetch() }, children: t("devices.error") }) });
  }
  const items = query.data.items.filter((d) => d.revoked_at == null && !removed.has(d.id));
  if (!items.length && !failed) return null;
  const nameOf = (d) => d.name?.trim() || t("pair.unnamed");
  const now = Date.now();
  const target = items.find((d) => d.id === confirming) ?? null;
  const revoke = (d) => {
    setConfirming(null);
    setFailed(null);
    setRemoved((s) => new Set(s).add(d.id));
    restCall("POST /devices/{id}/revoke", { path: { id: d.id } }).then(
      () => void invalidateRest("GET /devices", "GET /status"),
      () => {
        setRemoved((s) => {
          const next = new Set(s);
          next.delete(d.id);
          return next;
        });
        setFailed(nameOf(d));
      }
    );
  };
  return /* @__PURE__ */ jsx26("div", { "data-part": "devices", children: /* @__PURE__ */ jsxs21(Section, { title: t("devices.title"), count: items.length, description: t("devices.desc"), children: [
    failed ? /* @__PURE__ */ jsx26(Banner, { tone: "error", onDismiss: () => setFailed(null), children: t("devices.revoke_failed", { name: failed }) }) : null,
    items.length ? /* @__PURE__ */ jsx26("div", { className: cx("sgroup"), children: /* @__PURE__ */ jsx26("div", { role: "list", children: items.map((d) => {
      const name = nameOf(d);
      const online = d.last_seen != null && now / 1e3 - d.last_seen <= ONLINE_WINDOW_S;
      return /* @__PURE__ */ jsxs21("div", { role: "listitem", className: cx("srow"), "data-part": "device-row", "data-id": d.id, children: [
        /* @__PURE__ */ jsx26("span", { className: cx("approval-icon"), "aria-hidden": "true", children: /* @__PURE__ */ jsx26(Codicon17, { name: "browser", size: 15 }) }),
        /* @__PURE__ */ jsxs21("div", { className: cx("srow-main"), children: [
          /* @__PURE__ */ jsxs21("div", { className: cx("srow-line t-body"), children: [
            /* @__PURE__ */ jsx26("span", { className: cx("srow-subject"), title: name, children: name }),
            online ? /* @__PURE__ */ jsx26(Dot, { tone: "success", label: t("devices.online") }) : null
          ] }),
          /* @__PURE__ */ jsx26("div", { className: cx("srow-reason t-label num"), children: d.last_seen != null ? t("devices.seen", { when: formatRelative(d.last_seen, now, locale) }) : t("devices.never_seen") })
        ] }),
        /* @__PURE__ */ jsx26("div", { className: cx("srow-actions"), children: /* @__PURE__ */ jsx26(
          Button12,
          {
            variant: "ghost",
            size: "xs",
            "data-part": "device-revoke",
            "aria-label": t("devices.revoke_label", { name }),
            "aria-expanded": confirming === d.id,
            onClick: () => setConfirming(confirming === d.id ? null : d.id),
            children: t("devices.revoke")
          }
        ) })
      ] }, d.id);
    }) }) }) : null,
    target ? /* @__PURE__ */ jsx26(
      ApprovalCard,
      {
        autoFocus: true,
        title: t("devices.revoke_title", { name: nameOf(target) }),
        description: t("devices.revoke_desc"),
        effects: [t("devices.revoke_effect_stop"), t("devices.revoke_effect_again")],
        confirmLabel: t("devices.revoke_confirm", { name: nameOf(target) }),
        cancelLabel: t("devices.revoke_cancel"),
        onConfirm: () => revoke(target),
        onCancel: () => setConfirming(null)
      }
    ) : null
  ] }) });
}

// desktop-src/dialogs/onboarding/link.tsx
import { Button as Button13, Codicon as Codicon18, Input } from "@hermes/plugin-sdk";
import { useEffect as useEffect14, useId as useId3, useRef as useRef12, useState as useState13 } from "react";
import { jsx as jsx27, jsxs as jsxs22 } from "react/jsx-runtime";
var keySeq = 0;
var nextKey = () => `l${++keySeq}`;
function LinkPanel({ seed, onFinish, onDirty, autoFocus = true }) {
  const t = useT("onboarding");
  const errorId = useId3();
  const hintId = useId3();
  const inputRef = useRef12(null);
  const [draft, setDraft] = useState13(seed?.draft ?? "");
  const [fieldError, setFieldError] = useState13(seed?.fieldError ?? null);
  const [items, setItems] = useState13(seed?.items ?? []);
  useEffect14(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  const update = (key, patch2) => setItems((list) => list.map((i) => i.key === key ? { ...i, ...patch2 } : i));
  const add = (text, key = nextKey()) => {
    setItems((list) => {
      const fresh = { key, input: text, state: "pending" };
      return list.some((i) => i.key === key) ? list.map((i) => i.key === key ? fresh : i) : [fresh, ...list];
    });
    restCall("POST /channels/add", { body: { url_or_handle: text } }).then(
      (channel) => {
        onDirty();
        update(key, { state: "added", channel, errorKey: void 0, undoFailed: false });
        void invalidateRest(...AFTER_CHANNELS);
      },
      (error) => {
        const out = addErrorOutcome(toApiError(error));
        if (out.state === "late") onDirty();
        update(key, { state: out.state, errorKey: out.key, retryable: out.retryable, existing: out.existing ?? null });
      }
    );
  };
  const submit = (e) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) {
      setFieldError("empty");
      inputRef.current?.focus();
      return;
    }
    if (!parseChannelInput(text)) {
      setFieldError("format");
      inputRef.current?.focus();
      return;
    }
    setFieldError(null);
    setDraft("");
    add(text);
    inputRef.current?.focus();
  };
  const undo = async (item) => {
    const id = item.channel?.id;
    if (!id) return;
    update(item.key, { state: "undoing", undoFailed: false });
    try {
      const { items: changes } = await restCall("GET /changes", { query: { limit: 50 } });
      const entry = changes.find((c) => c.action === "channel_add" && c.payload?.channel_id === id && c.undone_at == null);
      if (!entry) throw new Error("change not found");
      await restCall("POST /changes/{id}/undo", { path: { id: entry.id } });
      update(item.key, { state: "undone" });
      onDirty();
      void invalidateRest(...AFTER_CHANNELS, "GET /changes");
    } catch {
      update(item.key, { state: "added", undoFailed: true });
    }
  };
  const dismiss = (key) => setItems((list) => list.filter((i) => i.key !== key));
  const anyKept = items.some((i) => i.state === "added" || i.state === "late" || i.state === "exists");
  return /* @__PURE__ */ jsx27("div", { "data-part": "link", children: /* @__PURE__ */ jsxs22(Stack, { gap: 5, children: [
    /* @__PURE__ */ jsx27("form", { onSubmit: submit, noValidate: true, "data-part": "link-form", children: /* @__PURE__ */ jsxs22(Stack, { gap: 2, children: [
      /* @__PURE__ */ jsxs22(Stack, { direction: "row", gap: 2, align: "center", children: [
        /* @__PURE__ */ jsx27(
          Input,
          {
            ref: inputRef,
            "data-part": "link-input",
            name: "channel",
            type: "text",
            inputMode: "url",
            autoComplete: "off",
            spellCheck: false,
            value: draft,
            placeholder: t("link.placeholder"),
            "aria-label": t("link.label"),
            "aria-invalid": fieldError ? true : void 0,
            "aria-describedby": fieldError ? errorId : hintId,
            onChange: (e) => {
              setDraft(e.target.value);
              if (fieldError) setFieldError(null);
            }
          }
        ),
        /* @__PURE__ */ jsxs22(Button13, { type: "submit", size: "sm", "data-part": "link-submit", children: [
          /* @__PURE__ */ jsx27(Codicon18, { name: "add", size: 14 }),
          t("link.submit")
        ] })
      ] }),
      fieldError ? /* @__PURE__ */ jsx27("p", { id: errorId, className: cx("t-label"), role: "alert", "data-part": "link-error", children: t(`link.errors.${fieldError}`) }) : /* @__PURE__ */ jsx27("p", { id: hintId, className: cx("section-desc t-label"), children: t("link.examples") })
    ] }) }),
    items.length ? /* @__PURE__ */ jsxs22("section", { className: cx("sgroup"), "data-part": "link-list", "aria-label": t("link.list_title"), children: [
      /* @__PURE__ */ jsx27("header", { className: cx("sgroup-head"), children: /* @__PURE__ */ jsx27("h3", { className: cx("sgroup-title t-head"), children: /* @__PURE__ */ jsx27("span", { className: cx("truncate"), children: t("link.list_title") }) }) }),
      /* @__PURE__ */ jsx27("div", { role: "list", children: items.map((item) => /* @__PURE__ */ jsx27(
        LinkRow,
        {
          item,
          onUndo: () => void undo(item),
          onRetry: () => add(item.input, item.key),
          onAddAgain: () => add(item.channel?.url ?? item.input, item.key),
          onDismiss: () => dismiss(item.key)
        },
        item.key
      )) })
    ] }) : null,
    anyKept ? /* @__PURE__ */ jsx27(Stack, { direction: "row", justify: "end", children: /* @__PURE__ */ jsx27(Button13, { variant: "outline", size: "sm", "data-part": "link-done", onClick: onFinish, children: t("link.done") }) }) : null
  ] }) });
}
function LinkRow({
  item,
  onUndo,
  onRetry,
  onAddAgain,
  onDismiss
}) {
  const t = useT("onboarding");
  const ch = item.channel ?? null;
  const shown = ch ?? item.existing ?? null;
  const title = shown?.title || item.input;
  const busy = item.state === "pending" || item.state === "undoing";
  let reason;
  switch (item.state) {
    case "pending":
      reason = t("link.status.pending");
      break;
    case "added":
      reason = item.undoFailed ? t("link.errors.undo_failed") : ch?.handle ? t("link.status.added", { handle: ch.handle }) : t("link.status.added_plain");
      break;
    case "undoing":
      reason = t("link.status.undoing");
      break;
    case "undone":
      reason = t("link.status.undone");
      break;
    default:
      reason = item.errorKey ? t(item.errorKey) : t("link.errors.generic");
  }
  const avatar = shown?.title && (item.state !== "pending" || ch) ? /* @__PURE__ */ jsx27(ChannelAvatar, { title: shown.title, thumb: shown.thumb ?? null, size: 28 }) : item.state === "error" || item.state === "late" ? /* @__PURE__ */ jsx27("span", { className: cx("approval-icon"), "aria-hidden": "true", children: /* @__PURE__ */ jsx27(Codicon18, { name: item.state === "late" ? "clock" : "warning", size: 14 }) }) : /* @__PURE__ */ jsx27(ChannelAvatarSkeleton, { size: 28 });
  return /* @__PURE__ */ jsxs22(
    "div",
    {
      role: "listitem",
      className: cx("srow"),
      "data-part": "link-row",
      "data-state": item.state,
      "data-status": item.state === "undone" ? "rejected" : "pending",
      "aria-busy": busy ? true : void 0,
      children: [
        avatar,
        /* @__PURE__ */ jsxs22("div", { className: cx("srow-main"), children: [
          /* @__PURE__ */ jsx27("div", { className: cx("srow-line t-body"), children: /* @__PURE__ */ jsx27("span", { className: cx("srow-subject"), title, children: title }) }),
          item.state === "error" || item.undoFailed ? /* @__PURE__ */ jsx27("p", { className: cx("t-label"), role: "alert", children: reason }) : /* @__PURE__ */ jsx27("div", { className: cx("srow-reason t-label"), title: reason, children: reason })
        ] }),
        /* @__PURE__ */ jsxs22("div", { className: cx("srow-actions"), children: [
          busy ? /* @__PURE__ */ jsx27(Codicon18, { name: "loading", size: 14, spinning: true }) : null,
          item.state === "added" ? /* @__PURE__ */ jsxs22(Button13, { variant: "ghost", size: "xs", "data-part": "link-undo", onClick: onUndo, children: [
            /* @__PURE__ */ jsx27(Codicon18, { name: "discard", size: 12 }),
            t("link.undo")
          ] }) : null,
          item.state === "undone" ? /* @__PURE__ */ jsx27(Button13, { variant: "ghost", size: "xs", "data-part": "link-add-again", onClick: onAddAgain, children: t("link.add_again") }) : null,
          item.state === "error" && item.retryable ? /* @__PURE__ */ jsx27(Button13, { variant: "ghost", size: "xs", "data-part": "link-retry", onClick: onRetry, children: t("link.retry") }) : null,
          item.state === "error" || item.state === "exists" || item.state === "late" ? /* @__PURE__ */ jsx27(Button13, { variant: "ghost", size: "icon-xs", "data-part": "link-dismiss", "aria-label": t("link.dismiss"), onClick: onDismiss, children: /* @__PURE__ */ jsx27(Codicon18, { name: "close", size: 14 }) }) : null
        ] })
      ]
    }
  );
}

// desktop-src/dialogs/onboarding/pair.tsx
import { Button as Button15, Codicon as Codicon20 } from "@hermes/plugin-sdk";
import { useCallback as useCallback6, useEffect as useEffect16, useRef as useRef14, useState as useState15 } from "react";

// desktop-src/lib/rpc.ts
import { gatewayActivationEpoch, host as host7 } from "@hermes/plugin-sdk";
var RPC_FALLBACK = {
  "job.cancel": { message: MESSAGE_KEYS.openDesktopBackend },
  "organize.run": { message: MESSAGE_KEYS.openDesktopBackend },
  "organize.accept": { message: MESSAGE_KEYS.openDesktopBackend },
  "organize.reject": { message: MESSAGE_KEYS.openDesktopBackend },
  "cleanup.scan": { message: MESSAGE_KEYS.openDesktopBackend },
  "cleanup.approve": { message: MESSAGE_KEYS.openDesktopBackend },
  "cleanup.resubscribe": { message: MESSAGE_KEYS.openDesktopBackend },
  "theme.create": { message: MESSAGE_KEYS.openDesktopBackend },
  "theme.save": { message: MESSAGE_KEYS.openDesktopBackend },
  "theme.refresh": { message: MESSAGE_KEYS.openDesktopBackend },
  "lists.import": { message: MESSAGE_KEYS.openDesktopBackend },
  "lists.to_tab": { message: MESSAGE_KEYS.openDesktopBackend },
  "pair.start": { rest: "POST /pair/start" }
};
var capability = null;
var routed = null;
onShellReset(() => {
  capability = null;
  routed = null;
});
function profileNameFromId(id) {
  if (typeof id !== "string" || !id.trim()) return null;
  const text = id.trim();
  const parts = text.split(/[\\/]+/).filter(Boolean);
  if (!/[\\/]/.test(text)) return parts[0] ?? null;
  const at = parts.lastIndexOf("profiles");
  return at >= 0 && at === parts.length - 2 ? parts[at + 1] : "default";
}
function rpcCode(error) {
  const code = error?.code;
  return typeof code === "number" ? code : void 0;
}
function isMethodNotFound(error) {
  return rpcCode(error) === RPC_UNAVAILABLE_CODE;
}
function isTimeout(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /time[d ]?\s*out/i.test(message);
}
function describeGateway() {
  const epoch = gatewayActivationEpoch();
  if (capability && capability.epoch === epoch) return capability.value;
  const value = host7.request("runtime.describe", {}, RPC_TIMEOUT_MS).then(
    (res) => ({
      rpc: Array.isArray(res?.capabilities) && res.capabilities.includes(RPC_CAPABILITY),
      profile: profileNameFromId(res?.profile_id)
    }),
    (error) => {
      if (isMethodNotFound(error)) return { rpc: false, profile: null };
      throw error;
    }
  );
  const entry = { epoch, value };
  capability = entry;
  value.catch(() => {
    if (capability === entry) capability = null;
  });
  return value;
}
function statedProfile() {
  const value = host7.state?.profile?.get?.();
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function selectedProfile() {
  return statedProfile() ?? "default";
}
async function profileCandidates(profile) {
  const out = [];
  if (typeof host7.profileRoutes === "function") {
    try {
      const routes = await host7.profileRoutes();
      const exact = routes.filter((r) => r.profile === profile);
      const target = routes.filter((r) => r.profile !== profile && r.targetProfile === profile);
      out.push(...exact, ...target);
    } catch {
    }
  }
  out.push(profile);
  return out;
}
function envelope(raw) {
  try {
    return { kind: "ok", data: unwrapEnvelope(raw) };
  } catch (error) {
    return { kind: "error", error: error instanceof TubeApiError ? error.toApiError() : toApiError(error) };
  }
}
function timeoutOutcome(error) {
  return { kind: "error", error: { code: "timeout", message: error instanceof Error ? error.message : "timeout" } };
}
async function viaProfileRoute(name, params) {
  if (typeof host7.requestProfile !== "function") return null;
  const epoch = gatewayActivationEpoch();
  const profile = selectedProfile();
  const known = routed && routed.epoch === epoch && routed.profile === profile ? routed.route : null;
  const candidates = known ? [known] : await profileCandidates(profile);
  let timedOut = null;
  for (const route of candidates) {
    try {
      const raw = await host7.requestProfile(route, rpcMethod(name), params, RPC_TIMEOUT_MS);
      routed = { epoch, profile, route };
      return envelope(raw);
    } catch (error) {
      if (isMethodNotFound(error)) continue;
      if (isTimeout(error)) timedOut = error;
      else if (rpcCode(error) !== void 0) return { kind: "error", error: toApiError(error) };
    }
  }
  routed = null;
  return timedOut ? timeoutOutcome(timedOut) : null;
}
async function viaFallback(name, params) {
  const fb = RPC_FALLBACK[name];
  if ("rest" in fb) {
    const body = params && typeof params === "object" && Object.keys(params).length ? params : void 0;
    try {
      const data = await restCallLoose(fb.rest, { body });
      return { kind: "ok", data };
    } catch (error) {
      return { kind: "error", error: toApiError(error) };
    }
  }
  return { kind: "unavailable", messageKey: fb.message };
}
async function callRpc(name, params) {
  if (routed && routed.epoch === gatewayActivationEpoch() && routed.profile === selectedProfile()) {
    const viaRoute = await viaProfileRoute(name, params);
    if (viaRoute) return viaRoute;
  }
  let gateway;
  try {
    gateway = await describeGateway();
  } catch (error) {
    return { kind: "error", error: toApiError(error) };
  }
  const selected = statedProfile();
  const elsewhere = gateway.profile !== null && selected !== null && gateway.profile !== selected;
  if (elsewhere || !gateway.rpc) return await viaProfileRoute(name, params) ?? viaFallback(name, params);
  let raw;
  try {
    raw = await host7.request(rpcMethod(name), params, RPC_TIMEOUT_MS);
  } catch (error) {
    if (isMethodNotFound(error)) return await viaProfileRoute(name, params) ?? viaFallback(name, params);
    if (isTimeout(error)) return timeoutOutcome(error);
    return { kind: "error", error: toApiError(error) };
  }
  return envelope(raw);
}

// desktop-src/dialogs/onboarding/setup.tsx
import { Button as Button14, Codicon as Codicon19, CopyButton as CopyButton2, host as host8 } from "@hermes/plugin-sdk";
import { useEffect as useEffect15, useRef as useRef13, useState as useState14 } from "react";

// desktop-src/dialogs/onboarding/setup-request.ts
var DEFAULT_EXTENSIONS_URL = "chrome://extensions/";
var OS_NAME = {
  macos: "macOS",
  linux: "Linux",
  windows: "Windows",
  other: "an operating system Hermes cannot open apps on"
};
function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
var SAFE_APP_ID = /^[A-Za-z0-9._-]{1,200}$/;
function flatpakAccessCommand(browser, path) {
  if (!browser || browser.sandbox !== "flatpak" || !browser.app_id || !SAFE_APP_ID.test(browser.app_id) || !path) return null;
  return `flatpak override --user --filesystem=${shellQuote(`${path}:ro`)} ${browser.app_id}`;
}
function buildHermesRequest({ platform, path, browser, folderReady, remote, wsl }) {
  const name = browser?.name ?? "a Chromium browser (Chrome, Edge, Brave, Chromium, Vivaldi or Opera)";
  const url = browser?.extensions_url ?? DEFAULT_EXTENSIONS_URL;
  const system = platform ? OS_NAME[platform] : "unknown";
  const lines = [
    "Please help me finish installing the HermesTube browser extension. Guide me step by step; I will do the clicks in the browser myself.",
    "",
    `- Computer where Hermes runs: ${wsl ? `Windows, with Hermes inside WSL${wsl.distro ? ` (${wsl.distro})` : ""}` : system}`,
    `- Extension folder: ${path || "(not known yet)"}${folderReady ? " (already prepared by the HermesTube plugin)" : ' (the HermesTube plugin creates it when I press "Set up the extension")'}`,
    `- Browser: ${name} (Extensions page: ${url})`
  ];
  if (browser?.sandbox) {
    lines.push(
      `- The browser is installed as a ${browser.sandbox === "flatpak" ? "Flatpak" : "snap"}${browser.app_id ? ` (${browser.app_id})` : ""}; ${browser.folder_visible ? "it should be able to read the folder." : "it may not be able to read the folder."}`
    );
  }
  if (remote) {
    lines.push("- I use the Hermes app from another computer. The extension only talks to a Hermes on the same computer as the browser.");
  }
  if (wsl) {
    lines.push(
      "- The browser runs on Windows; Hermes runs inside WSL. The extension reaches Hermes at 127.0.0.1 through WSL's localhost forwarding. If pairing never connects, I can turn on mirrored networking (networkingMode=mirrored under [wsl2] in %USERPROFILE%\\.wslconfig, then wsl --shutdown and start Hermes again)."
    );
    if (!wsl.interop) {
      lines.push("- WSL interop is off, so Hermes could not start Windows programs: I open the browser and the folder myself.");
    }
    if (!wsl.windows_folder) {
      lines.push(
        "- Hermes did not find my Windows user folder, so the extension folder is on WSL's disk. If the browser does not accept that path, I can copy the folder to my Windows user folder and load the copy."
      );
    }
  }
  lines.push(
    "",
    "What the browser needs from me:",
    `1. Open ${url} in ${browser?.name ?? "the browser"}.`,
    '2. Turn on "Developer mode".',
    '3. Click "Load unpacked" and choose the folder above (or drag the folder onto the page).',
    '4. The extension opens a tab that asks for a 6-digit code; HermesTube shows the code in its "Connect the browser extension" dialog.',
    "",
    "You may check that the folder exists, list its files and look at what is installed, and explain what you find. Rules:",
    "- Do not read, change or delete anything in the browser's profile or settings (Preferences, Secure Preferences, extension databases, cookies, history).",
    "- Do not try to get around the steps the browser requires: no command-line flags such as --load-extension, no browser policies, no automated clicks or keystrokes on my screen. I turn on Developer mode and load the folder myself.",
    "- Do not install, download, update or remove anything without first telling me what and why, and waiting for my OK.",
    '- Do not change or delete the extension folder. If it is missing or broken, tell me to press "Set up the extension" in HermesTube again.'
  );
  return lines.join("\n");
}
function canAskHermes(host28) {
  const h = host28;
  return typeof h?.newChat === "function" && typeof h?.composer?.setDraft === "function";
}
var ASK_ATTEMPTS = 8;
var ASK_RETRY_MS = 250;
var wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function askHermes(host28, text) {
  if (!canAskHermes(host28)) return false;
  const h = host28;
  try {
    h.newChat();
  } catch {
    return false;
  }
  for (let i = 0; i < ASK_ATTEMPTS; i += 1) {
    await wait(ASK_RETRY_MS);
    try {
      if (await h.composer.setDraft("new", text)) return true;
    } catch {
    }
  }
  return false;
}

// desktop-src/dialogs/onboarding/setup.tsx
import { Fragment as Fragment11, jsx as jsx28, jsxs as jsxs23 } from "react/jsx-runtime";
var EXTENSIONS_URL = DEFAULT_EXTENSIONS_URL;
var BROWSER_TEXT_KEYS = /* @__PURE__ */ new Set(["chrome", "chromium", "edge", "brave", "vivaldi", "opera", "arc"]);
function isOlderBackend(error) {
  const api = toApiError(error);
  return api.code === "not_found" && !error?.transport;
}
function ExtensionSetup({ connected, seedResult }) {
  const t = useT("onboarding");
  const tc2 = useT();
  const locale = useLocale();
  const status = useRest("GET /extension/setup", {});
  const olderBackend = status.isError && isOlderBackend(status.error);
  const readFailed = status.isError && !olderBackend;
  useRetryOnError(status, readFailed && !connected);
  const place = useGatewayPlace();
  const remote = place.remote ? place.name : null;
  const [busy, setBusy] = useState14(false);
  const [result, setResult] = useState14(seedResult ?? null);
  const [error, setError] = useState14(null);
  const [choice, setChoice] = useState14(null);
  const [ask, setAsk] = useState14("idle");
  const [manualToggled, setManualToggled] = useState14(null);
  const busyRef = useRef13(false);
  const mounted3 = useRef13(true);
  useEffect15(() => {
    mounted3.current = true;
    return () => {
      mounted3.current = false;
    };
  }, []);
  if (connected) return null;
  const data = status.data;
  const browsers = Array.isArray(data?.browsers) ? data.browsers : [];
  const selected = browsers.find((b) => b.key === choice) ?? browsers[0] ?? null;
  const browser = result ? result.browser ?? selected : selected;
  const browserName = browser?.name ?? t("pair.setup.browser_generic");
  const textKey = browser && BROWSER_TEXT_KEYS.has(browser.key) ? browser.key : "generic";
  const dev = t(`pair.setup.browsers.${textKey}.dev`);
  const load = t(`pair.setup.browsers.${textKey}.load`);
  const where = t(`pair.setup.browsers.${textKey}.where`);
  const url = browser?.extensions_url ?? EXTENSIONS_URL;
  const run = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const call = selected ? restCall("POST /extension/setup", { body: { browser: selected.key } }) : restCall("POST /extension/setup");
    call.then(
      (out) => {
        busyRef.current = false;
        if (!mounted3.current) return;
        setBusy(false);
        setResult(out);
        void invalidateRest("GET /extension/setup");
      },
      (err) => {
        busyRef.current = false;
        if (!mounted3.current) return;
        const api = toApiError(err);
        setBusy(false);
        setResult(null);
        setError(api.code === "conflict" && api.reason === "not_ours" ? "not_ours" : "generic");
        void invalidateRest("GET /extension/setup");
      }
    );
  };
  const recheck = () => {
    setError(null);
    void status.refetch();
  };
  const showFolder = (folder) => {
    const os = remote ? void 0 : maybePluginContext()?.os;
    if (!folder || !os || typeof os.revealPath !== "function") {
      run();
      return;
    }
    os.revealPath(folder).then(
      (ok) => {
        if (!ok && mounted3.current) run();
      },
      () => {
        if (mounted3.current) run();
      }
    );
  };
  const phase = busy ? "busy" : result ? "done" : error === "generic" ? "error" : error === "not_ours" || data?.state === "not_ours" ? "not_ours" : olderBackend ? "manual" : readFailed && !data ? "offer" : !data ? "loading" : data.state === "unavailable" ? "manual" : data.state === "update_available" ? "update" : data.state === "installed" ? "ready" : "offer";
  const n = (i) => `${formatNumber(i, locale)}.`;
  const path = result?.path ?? data?.path ?? "";
  const platform = result?.platform ?? data?.platform ?? null;
  const folderReady = Boolean(result) || data?.state === "installed" || data?.state === "update_available";
  const wsl = (result ? result.wsl : data?.wsl) ?? null;
  const pathRow = (part = "ext-setup-path") => path ? /* @__PURE__ */ jsx28("span", { className: cx("t-label"), "data-part": `${part}-row`, children: /* @__PURE__ */ jsxs23(Stack, { direction: "row", gap: 2, align: "center", wrap: true, children: [
    /* @__PURE__ */ jsx28("code", { className: cx("num"), "data-part": part, children: path }),
    /* @__PURE__ */ jsx28("span", { "data-part": `${part}-copy`, children: /* @__PURE__ */ jsx28(CopyButton2, { text: path, label: t("pair.setup.copy_path") }) })
  ] }) }) : null;
  const urlRow = /* @__PURE__ */ jsx28("span", { className: cx("t-label"), "data-part": "ext-setup-url-row", children: /* @__PURE__ */ jsxs23(Stack, { direction: "row", gap: 2, align: "center", wrap: true, children: [
    /* @__PURE__ */ jsx28("span", { children: t("pair.setup.open_yourself") }),
    /* @__PURE__ */ jsx28("code", { className: cx("num"), children: url }),
    /* @__PURE__ */ jsx28(CopyButton2, { text: url, label: t("pair.setup.copy_url") })
  ] }) });
  const remoteNotice = remote ? /* @__PURE__ */ jsx28("div", { "data-part": "ext-setup-remote", children: /* @__PURE__ */ jsx28(Banner, { tone: "info", icon: "remote", title: t("pair.setup.remote_title", { name: remote }), children: t("pair.setup.remote_body") }) }) : null;
  const showPicker = browsers.length > 1 && (phase === "offer" || phase === "update" || phase === "ready" || phase === "not_ours" || phase === "error");
  const picker = showPicker ? /* @__PURE__ */ jsxs23(Stack, { direction: "row", gap: 2, align: "center", wrap: true, children: [
    /* @__PURE__ */ jsx28("span", { className: cx("t-label"), id: "ext-setup-browser-label", children: t("pair.setup.choose_browser") }),
    /* @__PURE__ */ jsx28("div", { role: "radiogroup", "aria-labelledby": "ext-setup-browser-label", "data-part": "ext-setup-browsers", children: /* @__PURE__ */ jsx28(Stack, { direction: "row", gap: 1, wrap: true, children: browsers.map((b) => {
      const on = b.key === selected?.key;
      return /* @__PURE__ */ jsx28(
        Button14,
        {
          role: "radio",
          "aria-checked": on ? "true" : "false",
          "data-part": "ext-setup-browser",
          "data-key": b.key,
          variant: on ? "default" : "outline",
          size: "sm",
          onClick: () => setChoice(b.key),
          children: b.name
        },
        b.key
      );
    }) }) })
  ] }) : null;
  const noBrowser = Array.isArray(data?.browsers) && browsers.length === 0 && (phase === "offer" || phase === "update" || phase === "ready") ? /* @__PURE__ */ jsx28("p", { className: cx("t-label"), "data-part": "ext-setup-no-browser", children: t("pair.setup.no_browser_found") }) : null;
  const flatpakCommand = browser && !browser.folder_visible ? flatpakAccessCommand(browser, path) : null;
  const sandboxNotice = browser && browser.sandbox && !browser.folder_visible ? /* @__PURE__ */ jsx28("div", { "data-part": "ext-setup-sandbox", children: /* @__PURE__ */ jsx28(
    Banner,
    {
      tone: "warning",
      icon: "lock",
      title: t(browser.sandbox === "flatpak" ? "pair.setup.sandbox.flatpak_title" : "pair.setup.sandbox.snap_title", { browser: browser.name }),
      children: /* @__PURE__ */ jsxs23(Stack, { gap: 2, children: [
        /* @__PURE__ */ jsx28("span", { children: t(browser.sandbox === "flatpak" ? "pair.setup.sandbox.flatpak_body" : "pair.setup.sandbox.snap_body") }),
        flatpakCommand ? /* @__PURE__ */ jsx28("span", { className: cx("t-label"), children: /* @__PURE__ */ jsxs23(Stack, { direction: "row", gap: 2, align: "center", wrap: true, children: [
          /* @__PURE__ */ jsx28("code", { className: cx("num"), children: flatpakCommand }),
          /* @__PURE__ */ jsx28(CopyButton2, { text: flatpakCommand, label: t("pair.setup.sandbox.copy_command") })
        ] }) }) : null
      ] })
    }
  ) }) : null;
  const wslNotice = wsl ? /* @__PURE__ */ jsx28("div", { "data-part": "ext-setup-wsl", children: /* @__PURE__ */ jsx28(Banner, { tone: "info", icon: "remote", title: t("pair.setup.wsl.title"), children: /* @__PURE__ */ jsxs23(Stack, { gap: 2, children: [
    wsl.interop ? null : /* @__PURE__ */ jsx28("span", { "data-part": "ext-setup-wsl-interop", children: t("pair.setup.wsl.no_interop") }),
    wsl.windows_folder ? null : /* @__PURE__ */ jsx28("span", { "data-part": "ext-setup-wsl-disk", children: t("pair.setup.wsl.wsl_disk") }),
    /* @__PURE__ */ jsx28("span", { children: t("pair.setup.wsl.localhost", { ask: t("pair.setup.ask.action") }) })
  ] }) }) }) : null;
  const pathAbove = Boolean(path) && (phase === "ready" || phase === "not_ours");
  const manualOpen = manualToggled ?? phase === "error";
  const manual = /* @__PURE__ */ jsxs23(
    "details",
    {
      "data-part": "ext-setup-manual",
      className: cx("t-body obmanual"),
      open: manualOpen,
      onToggle: (e) => {
        const open = e.currentTarget.open;
        if (open !== manualOpen) setManualToggled(open);
      },
      children: [
        /* @__PURE__ */ jsxs23("summary", { "data-part": "ext-setup-manual-toggle", className: cx("t-label"), children: [
          /* @__PURE__ */ jsx28(Codicon19, { name: "chevron-right", size: 12, className: cx("obmanual-caret") }),
          /* @__PURE__ */ jsx28("span", { children: t("pair.setup.manual_title") })
        ] }),
        /* @__PURE__ */ jsxs23("ol", { children: [
          /* @__PURE__ */ jsx28("li", { children: /* @__PURE__ */ jsxs23(Stack, { direction: "row", gap: 2, align: "center", wrap: true, children: [
            /* @__PURE__ */ jsx28("span", { children: t("pair.setup.manual_open", { browser: browserName }) }),
            /* @__PURE__ */ jsx28("code", { className: cx("num"), children: url }),
            /* @__PURE__ */ jsx28(CopyButton2, { text: url, label: t("pair.setup.copy_url") })
          ] }) }),
          /* @__PURE__ */ jsxs23("li", { children: [
            t("pair.setup.manual_dev", { dev }),
            " ",
            /* @__PURE__ */ jsx28("span", { className: cx("t-label"), children: where })
          ] }),
          /* @__PURE__ */ jsx28("li", { children: pathAbove ? /* @__PURE__ */ jsx28("span", { "data-part": "ext-setup-manual-load", children: t("pair.setup.manual_load_above", { load }) }) : /* @__PURE__ */ jsxs23(Stack, { gap: 1, children: [
            /* @__PURE__ */ jsx28("span", { "data-part": "ext-setup-manual-load", children: t("pair.setup.manual_load", { load }) }),
            pathRow("ext-setup-manual-path"),
            folderReady ? null : /* @__PURE__ */ jsx28("span", { className: cx("t-label"), children: t("pair.setup.manual_folder_later") })
          ] }) }),
          /* @__PURE__ */ jsx28("li", { children: t("pair.setup.manual_code") })
        ] })
      ]
    }
  );
  const requestText = buildHermesRequest({ platform, path, browser, folderReady, remote: Boolean(remote), ...wsl ? { wsl } : {} });
  const canAsk = canAskHermes(host8);
  const startAsk = () => {
    if (ask === "busy") return;
    setAsk("busy");
    void askHermes(host8, requestText).then((ok) => {
      if (mounted3.current) setAsk(ok ? "sent" : "failed");
    });
  };
  const askDesc = canAsk ? t("pair.setup.ask.desc") : t("pair.setup.ask.copy_desc");
  const askBox = /* @__PURE__ */ jsxs23("div", { "data-part": "ext-setup-ask", className: cx("t-body obask"), title: askDesc, children: [
    /* @__PURE__ */ jsxs23("span", { className: cx("t-label"), children: [
      /* @__PURE__ */ jsx28(Codicon19, { name: "comment-discussion", size: 12 }),
      " ",
      canAsk ? t("pair.setup.ask.title") : t("pair.setup.ask.copy_title")
    ] }),
    !canAsk ? /* @__PURE__ */ jsx28(CopyButton2, { text: requestText, label: t("pair.setup.ask.copy_label"), title: askDesc }) : ask === "sent" ? /* @__PURE__ */ jsxs23("span", { className: cx("t-label"), role: "status", children: [
      /* @__PURE__ */ jsx28(Codicon19, { name: "pass", size: 12 }),
      " ",
      t("pair.setup.ask.sent")
    ] }) : ask === "failed" ? /* @__PURE__ */ jsxs23(Fragment11, { children: [
      /* @__PURE__ */ jsx28("span", { className: cx("t-label"), children: t("pair.setup.ask.failed") }),
      /* @__PURE__ */ jsx28(CopyButton2, { text: requestText, label: t("pair.setup.ask.copy_label") })
    ] }) : /* @__PURE__ */ jsx28(
      Button14,
      {
        variant: "outline",
        size: "xs",
        "data-part": "ext-setup-ask-action",
        title: askDesc,
        "aria-describedby": "ext-setup-ask-desc",
        loading: ask === "busy",
        disabled: ask === "busy",
        onClick: startAsk,
        children: ask === "busy" ? t("pair.setup.ask.busy") : t("pair.setup.ask.action")
      }
    ),
    /* @__PURE__ */ jsx28("span", { id: "ext-setup-ask-desc", className: cx("obsr"), "data-part": "ext-setup-ask-desc", children: askDesc })
  ] });
  let body = null;
  if (phase === "loading") {
    body = null;
  } else if (phase === "manual") {
    const storeUrl = t("pair.install.store_url");
    body = /* @__PURE__ */ jsx28(
      Banner,
      {
        tone: "info",
        icon: "extensions",
        title: t("pair.install.title"),
        action: isSafeExternalUrl(storeUrl) ? { label: t("pair.install.store_link"), onClick: () => void maybePluginContext()?.os.openExternal(storeUrl) } : void 0,
        children: t("pair.install.body")
      }
    );
  } else if (phase === "not_ours") {
    body = /* @__PURE__ */ jsx28(Banner, { tone: "warning", icon: "folder", title: t("pair.setup.not_ours_title"), action: { label: t("pair.setup.check_again"), onClick: recheck }, children: /* @__PURE__ */ jsxs23(Stack, { gap: 2, children: [
      /* @__PURE__ */ jsx28("span", { children: t("pair.setup.not_ours_body") }),
      pathRow()
    ] }) });
  } else if (phase === "error") {
    body = /* @__PURE__ */ jsx28(Banner, { tone: "error", title: t("pair.setup.error_title"), action: { label: tc2("retry"), onClick: run }, children: t("pair.setup.error_body") });
  } else if (phase === "offer" || phase === "update" || phase === "busy") {
    const update = phase === "update" || phase === "busy" && data?.state === "update_available";
    body = /* @__PURE__ */ jsxs23(Stack, { gap: 3, children: [
      remoteNotice,
      /* @__PURE__ */ jsxs23("div", { className: cx("t-body"), children: [
        /* @__PURE__ */ jsx28("strong", { className: cx("t-head"), children: update ? t("pair.setup.update_title") : t("pair.setup.title") }),
        /* @__PURE__ */ jsx28("p", { className: cx("t-label"), children: update ? t("pair.setup.update_desc", { version: data?.bundled_version ?? "" }) : t("pair.setup.desc", { browser: browserName }) })
      ] }),
      picker,
      noBrowser,
      /* @__PURE__ */ jsx28(Stack, { direction: "row", gap: 2, align: "center", wrap: true, children: /* @__PURE__ */ jsxs23(Button14, { "data-part": "ext-setup-action", loading: busy, disabled: busy, onClick: run, children: [
        /* @__PURE__ */ jsx28(Codicon19, { name: update ? "sync" : "extensions", size: 14 }),
        busy ? t("pair.setup.busy") : update ? t("pair.setup.update_action") : t("pair.setup.action")
      ] }) }),
      readFailed && !data ? /* @__PURE__ */ jsx28("p", { className: cx("t-label"), role: "status", "data-part": "ext-setup-read-failed", children: t("pair.setup.read_failed") }) : null
    ] });
  } else if (phase === "ready") {
    body = /* @__PURE__ */ jsxs23(Stack, { gap: 2, children: [
      remoteNotice,
      /* @__PURE__ */ jsxs23(Stack, { direction: "row", gap: 3, justify: "between", align: "center", wrap: true, children: [
        /* @__PURE__ */ jsxs23(Stack, { gap: 1, children: [
          /* @__PURE__ */ jsxs23("span", { className: cx("t-body"), children: [
            /* @__PURE__ */ jsx28(Codicon19, { name: "pass", size: 14 }),
            " ",
            t("pair.setup.ready_title")
          ] }),
          pathRow()
        ] }),
        /* @__PURE__ */ jsxs23(Stack, { direction: "row", gap: 2, align: "center", wrap: true, children: [
          /* @__PURE__ */ jsxs23(Button14, { variant: "outline", size: "sm", "data-part": "ext-setup-action", onClick: run, children: [
            /* @__PURE__ */ jsx28(Codicon19, { name: "extensions", size: 14 }),
            t("pair.setup.reopen")
          ] }),
          /* @__PURE__ */ jsxs23(Button14, { variant: "outline", size: "sm", "data-part": "ext-setup-show-folder", onClick: () => showFolder(path), children: [
            /* @__PURE__ */ jsx28(Codicon19, { name: "folder-opened", size: 14 }),
            t("pair.setup.show_folder")
          ] })
        ] })
      ] }),
      picker,
      noBrowser
    ] });
  } else if (phase === "done" && result) {
    const updated = result.action === "updated";
    const steps = updated ? [
      { id: "folder", label: `${n(1)} ${t("pair.setup.step_updated", { version: result.version })}`, status: "done", detail: pathRow() },
      {
        id: "reload",
        label: `${n(2)} ${t("pair.setup.step_reload", { browser: browserName })}`,
        status: "running",
        detail: t("pair.setup.step_reload_detail")
      }
    ] : [
      { id: "folder", label: `${n(1)} ${t("pair.setup.step_folder")}`, status: "done", detail: pathRow() },
      { id: "dev", label: `${n(2)} ${t("pair.setup.step_dev", { dev })}`, status: "running", detail: where },
      { id: "drag", label: `${n(3)} ${t("pair.setup.step_drag")}`, status: "waiting", detail: t("pair.setup.step_drag_detail", { load }) },
      { id: "code", label: `${n(4)} ${t("pair.setup.step_code")}`, status: "waiting", detail: t("pair.setup.step_code_detail") }
    ];
    const problem = result.open_problem && result.open_problem !== "disabled" ? result.open_problem : "failed";
    body = /* @__PURE__ */ jsxs23(Stack, { gap: 3, children: [
      result.opened.extensions_page ? /* @__PURE__ */ jsxs23(Stack, { gap: 1, children: [
        /* @__PURE__ */ jsx28("p", { className: cx("t-label"), role: "status", "data-part": "ext-setup-opened", children: result.opened.folder ? t("pair.setup.opened", { browser: browserName }) : t("pair.setup.opened_page_only", { browser: browserName }) }),
        urlRow
      ] }) : /* @__PURE__ */ jsx28("div", { "data-part": "ext-setup-not-opened", children: /* @__PURE__ */ jsx28(Banner, { tone: "warning", icon: "browser", title: t("pair.setup.not_opened_title", { browser: browserName }), children: /* @__PURE__ */ jsxs23(Stack, { gap: 2, children: [
        /* @__PURE__ */ jsx28("span", { children: wsl && !wsl.interop && problem === "unsupported" ? t("pair.setup.wsl.no_interop") : t(`pair.setup.problem.${problem}`, { browser: browserName }) }),
        urlRow,
        /* @__PURE__ */ jsx28("span", { children: t("pair.setup.other_computer") })
      ] }) }) }),
      /* @__PURE__ */ jsxs23(Stack, { direction: "row", gap: 2, align: "center", wrap: true, children: [
        /* @__PURE__ */ jsxs23(Button14, { variant: "outline", size: "sm", "data-part": "ext-setup-open-page", onClick: run, children: [
          /* @__PURE__ */ jsx28(Codicon19, { name: "extensions", size: 14 }),
          t("pair.setup.reopen")
        ] }),
        /* @__PURE__ */ jsxs23(Button14, { variant: "outline", size: "sm", "data-part": "ext-setup-show-folder", onClick: () => showFolder(result.path), children: [
          /* @__PURE__ */ jsx28(Codicon19, { name: "folder-opened", size: 14 }),
          t("pair.setup.show_folder")
        ] })
      ] }),
      /* @__PURE__ */ jsx28(StepProgress, { steps, label: t("pair.setup.steps_label") })
    ] });
  }
  const withExtras = phase !== "loading" && phase !== "manual";
  const showManual = withExtras && phase !== "done";
  return /* @__PURE__ */ jsx28("div", { "data-part": "ext-setup", "data-phase": phase, "aria-busy": phase === "loading" || phase === "busy" ? true : void 0, children: withExtras ? /* @__PURE__ */ jsxs23(Stack, { gap: 3, children: [
    body,
    wslNotice,
    sandboxNotice,
    showManual ? manual : null,
    askBox
  ] }) : body });
}

// desktop-src/dialogs/onboarding/pair.tsx
import { jsx as jsx29, jsxs as jsxs24 } from "react/jsx-runtime";
function lastSyncAt(status) {
  if (!status || !("ext_last_sync_at" in status)) return void 0;
  return typeof status.ext_last_sync_at === "number" ? status.ext_last_sync_at : null;
}
function readArrived(at, before, device) {
  if (typeof at !== "number") return false;
  if (typeof before === "number") return at > before;
  if (before === null) return true;
  return device !== void 0 && at >= device.created_at;
}
function PairPanel({ seed, onFinish, onDirty, onPhase, aside }) {
  const t = useT("onboarding");
  const tc2 = useT();
  const locale = useLocale();
  const plural5 = usePlural();
  const visible = useWindowVisible();
  const [state, setState] = useState15(seed ?? { phase: "starting" });
  const [slow, setSlow] = useState15(false);
  const { phase } = state;
  const waiting = phase === "waiting" || phase === "expired";
  const syncing = phase === "syncing";
  useEffect16(() => {
    onPhase?.(phase);
  }, [phase, onPhase]);
  const devices = useRest("GET /devices", {}, { refetchInterval: visible && waiting ? LIVE_POLL_MS : false });
  const channels = useRest("GET /channels", { query: { limit: 1 } }, { refetchInterval: visible && syncing ? LIVE_POLL_MS : false });
  const status = useRest("GET /status", {}, { refetchInterval: visible && (waiting || syncing) ? STATUS_POLL_MS : false });
  const devicesRef = useRef14(devices.data);
  devicesRef.current = devices.data;
  const channelsRef = useRef14(channels.data);
  channelsRef.current = channels.data;
  const statusRef = useRef14(status.data);
  statusRef.current = status.data;
  const request = useRef14(0);
  const mounted3 = useRef14(true);
  const start = useCallback6(() => {
    const token = ++request.current;
    setSlow(false);
    setState({ phase: "starting" });
    void callRpc("pair.start", {}).then((out) => {
      if (!mounted3.current || token !== request.current) return;
      if (out.kind === "ok") {
        setState({
          phase: "waiting",
          code: out.data.code,
          expiresAt: out.data.expires_at * 1e3,
          issuedAt: Date.now(),
          baseline: devicesRef.current ? devicesRef.current.items.map((d) => d.id) : null,
          channelsBefore: channelsRef.current ? channelsRef.current.total : null,
          syncBefore: lastSyncAt(statusRef.current)
        });
      } else {
        setState({ phase: "error", error: out.kind === "error" ? pairErrorKind(out.error) : "generic" });
      }
    });
  }, []);
  useEffect16(() => {
    mounted3.current = true;
    if (!seed) start();
    return () => {
      mounted3.current = false;
    };
  }, []);
  useEffect16(() => {
    if (phase !== "waiting" || state.expiresAt === void 0) return void 0;
    const expire = () => setState((s) => s.phase === "waiting" ? { ...s, phase: "expired" } : s);
    const ms = state.expiresAt - Date.now();
    if (ms <= 0) {
      expire();
      return void 0;
    }
    const id = setTimeout(expire, ms);
    return () => clearTimeout(id);
  }, [phase, state.expiresAt]);
  useEffect16(() => {
    if (!waiting || seed) return;
    const total = channels.data?.total;
    const synced = lastSyncAt(status.data);
    setState((s) => {
      if (s.phase !== "waiting" && s.phase !== "expired") return s;
      let next = s;
      if (s.channelsBefore == null && total !== void 0) next = { ...next, channelsBefore: total };
      if (s.syncBefore === void 0 && synced !== void 0) next = { ...next, syncBefore: synced };
      return next;
    });
  }, [waiting, channels.data, status.data, seed]);
  useEffect16(() => {
    if (!waiting || !devices.data || seed) return;
    const found = findNewDevice(devices.data.items, state.baseline ?? null, (state.issuedAt ?? Date.now()) / 1e3);
    if (!found) return;
    onDirty();
    setState((s) => ({ ...s, phase: "syncing", device: found, syncSince: Date.now() }));
    void invalidateRest("GET /channels", "GET /status");
  }, [devices.data, waiting, state.baseline, state.issuedAt, seed, onDirty]);
  useEffect16(() => {
    if (!syncing || seed || state.syncSeenAt !== void 0) return;
    if (!readArrived(lastSyncAt(status.data), state.syncBefore, state.device)) return;
    setState((s) => s.phase === "syncing" && s.syncSeenAt === void 0 ? { ...s, syncSeenAt: Date.now() } : s);
    void invalidateRest("GET /channels");
  }, [status.data, syncing, state.syncSeenAt, state.syncBefore, state.device, seed]);
  useEffect16(() => {
    if (!syncing || !channels.data || seed) return;
    const total = channels.data.total;
    const grew = total > (state.channelsBefore ?? 0);
    const read2 = state.syncSeenAt !== void 0 && channels.dataUpdatedAt >= state.syncSeenAt;
    if (grew || read2) {
      setState((s) => ({ ...s, phase: "done", total }));
      void invalidateRest("GET /tabs", "GET /feed", "GET /status");
    }
  }, [channels.data, channels.dataUpdatedAt, syncing, state.channelsBefore, state.syncSeenAt, seed]);
  useEffect16(() => {
    if (!syncing) return void 0;
    const left = (state.syncSince ?? Date.now()) + SYNC_PATIENCE_MS - Date.now();
    if (left <= 0) {
      setSlow(true);
      return void 0;
    }
    const id = setTimeout(() => setSlow(true), left);
    return () => clearTimeout(id);
  }, [syncing, state.syncSince]);
  const n = (i) => `${formatNumber(i, locale)}.`;
  const name = state.device?.name?.trim() || t("pair.unnamed");
  const connected = phase === "syncing" || phase === "done";
  const steps = [
    {
      id: "open",
      label: `${n(1)} ${t("pair.step_open")}`,
      status: connected ? "done" : phase === "waiting" ? "running" : "waiting",
      // connected: the device name is already in the success message just above (nothing repeated)
      detail: connected ? void 0 : t("pair.step_open_detail")
    },
    {
      id: "read",
      label: `${n(2)} ${t("pair.step_read")}`,
      status: phase === "syncing" ? "running" : phase === "done" ? "done" : "waiting",
      detail: t("pair.step_read_detail")
    },
    {
      id: "ready",
      label: `${n(3)} ${t("pair.step_ready")}`,
      status: phase === "done" ? "done" : "waiting"
    }
  ];
  const endpointDown = status.data?.ext_endpoint_up === false && !(phase === "error" && state.error === "ext_endpoint_down");
  const columns = connected ? "1" : "2";
  return /* @__PURE__ */ jsxs24("div", { "data-part": "pair", "data-phase": phase, "data-columns": columns, className: cx("obpair"), children: [
    connected ? null : /* @__PURE__ */ jsxs24("div", { "data-part": "pair-side", className: cx("obpair-side"), children: [
      /* @__PURE__ */ jsx29(ExtensionSetup, { connected, seedResult: seed?.setup }),
      aside
    ] }),
    /* @__PURE__ */ jsxs24("div", { "data-part": "pair-main", className: cx("obpair-main"), children: [
      endpointDown ? /* @__PURE__ */ jsx29(Banner, { tone: "warning", icon: "debug-disconnect", title: tc2(MESSAGE_KEYS.reconnectOpenHermes), children: t("pair.endpoint_down") }) : null,
      phase === "error" && state.error ? /* @__PURE__ */ jsx29(Banner, { tone: "error", title: t(`pair.errors.${state.error}.title`), action: { label: tc2("retry"), onClick: start }, children: t(`pair.errors.${state.error}.body`) }) : null,
      phase === "starting" ? /* @__PURE__ */ jsx29(PairingCodeSkeleton, {}) : null,
      (phase === "waiting" || phase === "expired") && state.code && state.expiresAt !== void 0 ? /* @__PURE__ */ jsxs24(Stack, { gap: 3, align: "center", children: [
        /* @__PURE__ */ jsx29(
          PairingCode,
          {
            code: state.code,
            expiresAt: state.expiresAt,
            onRegenerate: start,
            label: t("pair.code_label")
          },
          `${state.code}:${state.expiresAt}`
        ),
        /* @__PURE__ */ jsx29("div", { className: cx("t-label"), role: "status", "aria-live": "polite", "data-part": "pair-live", children: phase === "waiting" ? /* @__PURE__ */ jsxs24(Stack, { direction: "row", gap: 2, align: "center", children: [
          /* @__PURE__ */ jsx29(Codicon20, { name: "loading", size: 12, spinning: true }),
          /* @__PURE__ */ jsx29("span", { children: t("pair.waiting") })
        ] }) : t("pair.expired_hint") })
      ] }) : null,
      connected ? /* @__PURE__ */ jsx29("div", { role: "status", "aria-live": "polite", "data-part": "pair-success", children: /* @__PURE__ */ jsx29(
        EmptyView,
        {
          compact: true,
          icon: phase === "done" ? "pass-filled" : "plug",
          title: phase === "done" ? t("pair.done_title") : t("pair.connected_title", { name }),
          description: phase === "done" && state.total !== void 0 ? plural5("channels", state.total) : t("pair.connected_desc")
        }
      ) }) : null,
      phase === "starting" ? /* @__PURE__ */ jsx29(StepProgressSkeleton, { count: 3 }) : phase === "error" ? null : /* @__PURE__ */ jsx29(StepProgress, { steps, label: t("pair.steps_label") }),
      phase === "syncing" && slow ? /* @__PURE__ */ jsxs24(Stack, { direction: "row", gap: 3, justify: "between", align: "center", wrap: true, children: [
        /* @__PURE__ */ jsx29("p", { className: cx("t-label"), children: t("pair.slow") }),
        /* @__PURE__ */ jsx29(Button15, { variant: "outline", size: "sm", "data-part": "pair-close", onClick: onFinish, children: t("pair.close") })
      ] }) : null,
      phase === "done" ? /* @__PURE__ */ jsx29(AutoClose, { onDone: onFinish }) : null
    ] }),
    connected ? aside : null
  ] });
}

// desktop-src/dialogs/onboarding/reach.tsx
import { Button as Button16, atom as atom13, host as host9, useValue as useValue14 } from "@hermes/plugin-sdk";
import { jsx as jsx30, jsxs as jsxs25 } from "react/jsx-runtime";
var NO_PROFILE3 = atom13("default");
function usePairReach() {
  const place = useGatewayPlace();
  const status = useStatus();
  const profile = useValue14(host9.state?.profile ?? NO_PROFILE3) || "default";
  if (!place.known) return { kind: "checking" };
  if (place.remote) return { kind: "remote", name: place.name ?? "", local: place.local };
  if (!status.data && pluginMissing(status.error, { disabled: true })) return { kind: "off", profile, retry: () => void status.refetch() };
  return { kind: "ok" };
}
function RemoteNotice({ name, local, onAnyway }) {
  const t = useT("onboarding");
  return /* @__PURE__ */ jsx30("div", { "data-part": "pair-remote", children: /* @__PURE__ */ jsx30(Banner, { tone: "warning", icon: "remote", title: t("reach.remote_title", { name }), children: /* @__PURE__ */ jsxs25(Stack, { gap: 2, children: [
    /* @__PURE__ */ jsx30("span", { children: t("reach.remote_body", { local: local || t("reach.local_default") }) }),
    /* @__PURE__ */ jsx30(Stack, { direction: "row", children: /* @__PURE__ */ jsx30(Button16, { variant: "ghost", size: "sm", "data-part": "pair-remote-anyway", onClick: onAnyway, children: t("reach.anyway", { name }) }) })
  ] }) }) });
}
function PluginOffNotice({ profile, onRetry }) {
  const t = useT("onboarding");
  const tc2 = useT();
  return /* @__PURE__ */ jsx30("div", { "data-part": "pair-off", children: /* @__PURE__ */ jsx30(Banner, { tone: "warning", icon: "plug", title: t("reach.off_title", { profile }), action: { label: tc2("retry"), onClick: onRetry }, children: t("reach.off_body", { profile }) }) });
}

// desktop-src/dialogs/onboarding/style.ts
import { useLayoutEffect as useLayoutEffect4 } from "react";
var ONBOARDING_STYLE_ATTR = `data-${CLASS_PREFIX}onboarding`;
var ONBOARDING_CSS = `
/* ------------------------------------------------ the dialog body: up to the app's own dialog limit */

.PFX_obdialog .PFX_dialog-body {
  max-height: min(calc(85vh - 5rem), 760px);
}

/* ------------------------------------------------ pairing step: one column, or two when there is room */

.PFX_obpair {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s4);
  min-width: 0;
}

.PFX_obpair-side,
.PFX_obpair-main {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s3);
  min-width: 0;
}

@container PFX_dialog (min-width: 820px) {
  .PFX_obpair[data-columns='2'] {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    align-items: start;
    column-gap: var(--PFX_s5);
  }

  .PFX_obpair[data-columns='2'] .PFX_obpair-main {
    padding-left: var(--PFX_s5);
    border-left: 1px solid var(--ui-stroke-tertiary);
  }
}

/* the code: smaller boxes, still big enough to read out loud */
.PFX_obpair .PFX_pairing {
  gap: var(--PFX_s2);
}

.PFX_obpair .PFX_code-digit {
  width: 36px;
  height: 44px;
  font-size: 22px;
  border-radius: 7px;
}

/* ------------------------------------------------ "Or do it by hand" (disclosure) */

.PFX_obmanual {
  min-width: 0;
}

.PFX_obmanual > summary {
  display: inline-flex;
  align-items: center;
  gap: var(--PFX_s1);
  color: var(--ui-text-secondary);
  cursor: pointer;
  list-style: none;
  border-radius: 4px;
}

.PFX_obmanual > summary::-webkit-details-marker {
  display: none;
}

.PFX_obmanual > summary:hover {
  color: var(--ui-text-primary);
}

.PFX_obmanual > summary:focus-visible {
  outline: 2px solid var(--PFX_ring);
  outline-offset: 2px;
}

.PFX_obmanual-caret {
  transition: transform var(--PFX_dur) var(--PFX_ease);
}

.PFX_obmanual[open] .PFX_obmanual-caret {
  transform: rotate(90deg);
}

.PFX_obmanual > ol {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s1);
  margin: var(--PFX_s2) 0 0;
  padding-left: 1.4em;
}

/* ------------------------------------------------ "Stuck? Hermes can help": one line */

.PFX_obask {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--PFX_s1) var(--PFX_s2);
  min-width: 0;
}

/* read by screen readers, not drawn (the same text is the button's tooltip) */
.PFX_obsr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .PFX_obmanual-caret {
    transition: none;
  }
}
`;
var users = 0;
var mounted = null;
function useOnboardingStyles() {
  useLayoutEffect4(() => {
    if (typeof document === "undefined" || !document.head) return;
    users++;
    if (!mounted || !mounted.isConnected) {
      mounted = document.head.querySelector(`style[${ONBOARDING_STYLE_ATTR}]`);
      if (!mounted) {
        mounted = document.createElement("style");
        mounted.setAttribute(ONBOARDING_STYLE_ATTR, "");
        document.head.appendChild(mounted);
      }
      mounted.textContent = resolveCss(ONBOARDING_CSS);
    }
    return () => {
      users = Math.max(0, users - 1);
      if (!users && mounted) {
        mounted.remove();
        mounted = null;
      }
    };
  }, []);
}

// desktop-src/dialogs/onboarding/index.tsx
import { Fragment as Fragment12, jsx as jsx31, jsxs as jsxs26 } from "react/jsx-runtime";
var PAIR_DESC = { syncing: "pair.desc_syncing", done: "pair.desc_done" };
var KEY_TO_CARD = { "1": 0, "2": 1, "3": 2 };
function isTypingTarget(target) {
  const el = target;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}
function OnboardingDialog({ step, onClose, initial }) {
  const t = useT("onboarding");
  useOnboardingStyles();
  const [view, setView] = useState16(initial?.view ?? step ?? "paths");
  const [autoLoadDemo, setAutoLoadDemo] = useState16(!initial && step === "demo");
  const [pairPhase, setPairPhase] = useState16(initial?.pair?.phase ?? null);
  const reach = usePairReach();
  const [anyway, setAnyway] = useState16(false);
  const backRef = useRef15(null);
  const rootRef = useRef15(null);
  const chosen = useRef15(false);
  const dirty = useRef15(false);
  const markDirty = useCallback7(() => {
    dirty.current = true;
  }, []);
  const finish = useCallback7(() => {
    dirty.current = false;
    void invalidateRest();
    onClose();
  }, [onClose]);
  useEffect17(
    () => () => {
      if (dirty.current) void invalidateRest();
    },
    []
  );
  const choose = useCallback7((next) => {
    chosen.current = true;
    if (next === "demo") setAutoLoadDemo(true);
    setView(next);
  }, []);
  useEffect17(() => {
    if (!chosen.current) return;
    if (view === "paths") rootRef.current?.focus();
    else if (view !== "link") backRef.current?.focus();
  }, [view]);
  useEffect17(() => {
    if (view !== "paths" || typeof document === "undefined") return void 0;
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const index = KEY_TO_CARD[e.key];
      if (index === void 0) return;
      const cards = rootRef.current?.querySelectorAll('[data-part="path-card"]');
      const button = cards?.[index]?.querySelector('[data-part="path-foot"] button');
      if (!button) return;
      e.preventDefault();
      button.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view]);
  const back = /* @__PURE__ */ jsx31(Stack, { direction: "row", children: /* @__PURE__ */ jsxs26(Button17, { ref: backRef, variant: "ghost", size: "sm", "data-part": "onboarding-back", onClick: () => choose("paths"), children: [
    /* @__PURE__ */ jsx31(Codicon21, { name: "arrow-left", size: 14 }),
    t("back")
  ] }) });
  let body;
  if (view === "pair") {
    const blocked = initial ? null : reach.kind === "remote" && !anyway ? reach : reach.kind === "off" ? reach : null;
    const checking = !initial && reach.kind === "checking";
    body = /* @__PURE__ */ jsxs26(Fragment12, { children: [
      back,
      /* @__PURE__ */ jsx31(Section, { title: t("pair.title"), description: blocked ? void 0 : t(pairPhase && PAIR_DESC[pairPhase] || "pair.desc"), children: blocked?.kind === "remote" ? /* @__PURE__ */ jsx31(RemoteNotice, { name: blocked.name, local: blocked.local, onAnyway: () => setAnyway(true) }) : blocked?.kind === "off" ? /* @__PURE__ */ jsx31(PluginOffNotice, { profile: blocked.profile, onRetry: blocked.retry }) : checking ? null : /* @__PURE__ */ jsx31(
        PairPanel,
        {
          seed: initial?.view === "pair" ? initial.pair : void 0,
          onFinish: finish,
          onDirty: markDirty,
          onPhase: setPairPhase,
          aside: /* @__PURE__ */ jsx31(DevicesSection, {})
        }
      ) }),
      blocked || !checking ? null : /* @__PURE__ */ jsx31(DevicesSection, {})
    ] });
  } else if (view === "link") {
    body = /* @__PURE__ */ jsxs26(Fragment12, { children: [
      back,
      /* @__PURE__ */ jsx31(Section, { title: t("link.title"), description: t("link.desc"), children: /* @__PURE__ */ jsx31(LinkPanel, { seed: initial?.view === "link" ? initial.link : void 0, onFinish: finish, onDirty: markDirty, autoFocus: !initial }) })
    ] });
  } else if (view === "demo") {
    body = /* @__PURE__ */ jsxs26(Fragment12, { children: [
      back,
      /* @__PURE__ */ jsx31(Section, { title: t("demo.title"), description: t("demo.desc"), children: /* @__PURE__ */ jsx31(DemoPanel, { seed: initial?.view === "demo" ? initial.demo : void 0, autoLoad: autoLoadDemo, onFinish: finish, onDirty: markDirty }) })
    ] });
  } else {
    body = /* @__PURE__ */ jsx31(PathsView, { onChoose: choose });
  }
  const pairing = view === "pair";
  return /* @__PURE__ */ jsx31(DialogFrame, { title: t("title"), onClose, size: pairing ? "xl" : "lg", className: cx("obdialog"), children: /* @__PURE__ */ jsx31("div", { ref: rootRef, tabIndex: -1, "data-part": "onboarding", "data-view": view, children: /* @__PURE__ */ jsx31(Stack, { gap: pairing ? 3 : 5, children: body }) }) });
}
function PathsView({ onChoose }) {
  const t = useT("onboarding");
  const demo = useRest("GET /demo", {});
  const demoLoaded = demo.data?.loaded === true;
  const hint = (label, key) => /* @__PURE__ */ jsxs26("span", { title: t("paths.key_hint", { key }), children: [
    label,
    " · ",
    /* @__PURE__ */ jsx31(Kbd2, { children: key })
  ] });
  return /* @__PURE__ */ jsxs26(Fragment12, { children: [
    /* @__PURE__ */ jsx31(Hero, { icon: "play-circle", title: t("hero.tagline"), description: t("hero.lead") }),
    /* @__PURE__ */ jsxs26(PathGroup, { label: t("paths.label"), children: [
      /* @__PURE__ */ jsx31(
        PathCard,
        {
          primary: true,
          icon: "plug",
          title: t("paths.pair.title"),
          description: t("paths.pair.desc"),
          actionLabel: t("paths.pair.action"),
          onAction: () => onChoose("pair"),
          hint: hint(t("paths.pair.hint"), "1")
        }
      ),
      /* @__PURE__ */ jsx31(
        PathCard,
        {
          icon: "link",
          title: t("paths.link.title"),
          description: t("paths.link.desc"),
          actionLabel: t("paths.link.action"),
          onAction: () => onChoose("link"),
          hint: hint(t("paths.link.hint"), "2")
        }
      ),
      /* @__PURE__ */ jsx31(
        PathCard,
        {
          icon: "beaker",
          title: t("paths.demo.title"),
          description: demoLoaded ? t("paths.demo.loaded_desc") : t("paths.demo.desc"),
          actionLabel: demoLoaded ? t("paths.demo.loaded_action") : t("paths.demo.action"),
          onAction: () => onChoose("demo"),
          hint: hint(t("paths.demo.hint"), "3")
        }
      )
    ] }),
    /* @__PURE__ */ jsx31(DevicesSection, {})
  ] });
}

// desktop-src/dialogs/organize/index.tsx
import { Button as Button19, Codicon as Codicon23, atom as atom15, host as host11, useValue as useValue16 } from "@hermes/plugin-sdk";
import { useCallback as useCallback9, useEffect as useEffect21, useMemo as useMemo2, useRef as useRef19, useState as useState20 } from "react";

// desktop-src/lib/jobs.ts
import { atom as atom14, useValue as useValue15 } from "@hermes/plugin-sdk";
import { useCallback as useCallback8, useEffect as useEffect19, useMemo, useRef as useRef17, useState as useState17 } from "react";

// desktop-src/lib/events.ts
import { host as host10 } from "@hermes/plugin-sdk";
import { useEffect as useEffect18, useRef as useRef16 } from "react";
function pluginEventType(name) {
  return `plugin.${PLUGIN_ID}.${name}`;
}
function subscribe(type, listener) {
  const handler = (event) => {
    try {
      listener(event?.payload);
    } catch {
    }
  };
  const ctx = maybePluginContext();
  if (ctx) return ctx.onEvent(type, handler);
  return host10.onEvent(type, handler);
}
function onTubeEvent(name, listener) {
  return subscribe(eventType(name), listener);
}
function onRawEvent(type, listener) {
  return subscribe(type, listener);
}
function useTubeEvents(names, listener, enabled = true) {
  const ref = useRef16(listener);
  ref.current = listener;
  const key = names.join("|");
  useEffect18(() => {
    if (!enabled) return;
    const offs = (key ? key.split("|") : []).map((n) => onTubeEvent(n, (p) => ref.current(n, p)));
    return () => {
      for (const off of offs) off();
    };
  }, [key, enabled]);
}

// desktop-src/lib/jobs.ts
var JOB_EVENTS = ["organize.done", "theme.progress", "theme.ready", "lists.ready", "cleanup.scanned"];
function isJobActive(job) {
  return !!job && (job.status === "queued" || job.status === "running");
}
function jobPollInterval(job, error) {
  if (error instanceof TubeApiError && !error.transport) return false;
  if (!job) return JOB_POLL_MS;
  return isJobActive(job) ? JOB_POLL_MS : false;
}
function useJob(jobId, events = JOB_EVENTS) {
  const id = jobId ?? "";
  const query = useRest("GET /jobs/{id}", { path: { id } }, { enabled: !!jobId, refetchInterval: jobPollInterval });
  useTubeEvents(
    events,
    (_name, payload) => {
      const p = payload;
      if (jobId && p && p.job === jobId) void invalidateRestExact("GET /jobs/{id}", { path: { id: jobId } });
    },
    !!jobId
  );
  return query;
}
var IDLE = { phase: "idle", jobId: null, error: null };
function useRpcJob(name, initialJobId) {
  const [local, setLocal] = useState17(
    initialJobId ? { phase: "tracking", jobId: initialJobId, error: null } : IDLE
  );
  const query = useJob(local.phase === "tracking" ? local.jobId : null);
  const job = query.data ?? null;
  const start = useCallback8(
    async (params) => {
      setLocal({ phase: "starting", jobId: null, error: null });
      const out = await callRpc(name, params);
      if (out.kind === "ok") {
        const accepted = out.data;
        if (accepted?.job?.id) setLocal({ phase: "tracking", jobId: accepted.job.id, error: null });
        else setLocal({ phase: "error", jobId: null, error: { code: "internal", message: "RPC returned no job" } });
      } else if (out.kind === "error") setLocal({ phase: "error", jobId: null, error: out.error });
      else setLocal({ phase: "unavailable", jobId: null, error: null });
    },
    [name]
  );
  const resume = useCallback8((jobId) => setLocal({ phase: "tracking", jobId, error: null }), []);
  const reset = useCallback8(() => setLocal(IDLE), []);
  useEffect19(() => {
    if (initialJobId) resume(initialJobId);
  }, [initialJobId, resume]);
  return useMemo(() => {
    const base = {
      jobId: local.jobId,
      job: local.phase === "tracking" ? job : null,
      progress: local.phase === "tracking" ? job?.progress ?? null : null,
      result: null,
      error: local.error,
      messageKey: null,
      start,
      resume,
      reset
    };
    if (local.phase === "unavailable") return { ...base, phase: "unavailable", messageKey: MESSAGE_KEYS.openDesktopBackend };
    if (local.phase !== "tracking") return { ...base, phase: local.phase };
    if (query.error && !(query.error instanceof TubeApiError && query.error.transport)) {
      return { ...base, phase: "error", error: toError(query.error) };
    }
    if (!job || isJobActive(job)) return { ...base, phase: "running" };
    if (job.status === "done") return { ...base, phase: "done", result: job.result };
    const err = job.error ?? {};
    return {
      ...base,
      phase: "error",
      error: { code: err.code ?? "internal", message: err.message ?? "job failed" }
    };
  }, [local, job, query.error, start, resume, reset]);
}
function toError(error) {
  return error instanceof TubeApiError ? error.toApiError() : { code: "internal", message: String(error) };
}
function jobError(job) {
  const err = job.error ?? {};
  return { code: err.code ?? "internal", message: err.message ?? "job failed" };
}
function useNowTicker(enabled, ms = 1e3) {
  const [now, setNow] = useState17(() => Date.now());
  useEffect19(() => {
    if (!enabled) return void 0;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [enabled, ms]);
  return now;
}
function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1e3));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total % 3600 / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
var AI_STATUS_DEADLINE_MS = 4e3;
function isAiStatus(value) {
  return !!value && typeof value === "object" && typeof value.available === "boolean";
}
function useAiStatus(enabled = true) {
  const [status, setStatus] = useState17(null);
  useEffect19(() => {
    if (!enabled) return void 0;
    let alive = true;
    const deadline = setTimeout(() => {
      alive = false;
    }, AI_STATUS_DEADLINE_MS);
    restCall("GET /ai/status").then(
      (data) => {
        if (alive && isAiStatus(data)) setStatus(data);
      },
      () => void 0
      // 404, network, error envelope: "unknown"
    );
    return () => {
      alive = false;
      clearTimeout(deadline);
    };
  }, [enabled]);
  return status;
}
var THEME_PENDING_KEY = "theme.pending";
var THEME_PENDING_MAX_AGE_MS = 7 * 864e5;
var $themePendingRev = atom14(0);
function themeStorage() {
  try {
    return maybePluginContext()?.storage ?? null;
  } catch {
    return null;
  }
}
function readThemePending(now = Date.now()) {
  try {
    const v = themeStorage()?.get(THEME_PENDING_KEY, null);
    if (!v || typeof v !== "object" || typeof v.jobId !== "string" || !v.jobId) return null;
    if (typeof v.at !== "number" || now - v.at > THEME_PENDING_MAX_AGE_MS) return null;
    return {
      jobId: v.jobId,
      query: typeof v.query === "string" ? v.query : "",
      at: v.at,
      counts: v.counts && typeof v.counts === "object" ? v.counts : void 0,
      params: v.params && typeof v.params === "object" && typeof v.params.query === "string" ? v.params : void 0,
      seen: v.seen === true ? true : void 0
    };
  } catch {
    return null;
  }
}
function writeThemePending(p) {
  try {
    themeStorage()?.set(THEME_PENDING_KEY, p);
  } catch {
  }
  $themePendingRev.set($themePendingRev.get() + 1);
}
function clearThemePending() {
  try {
    themeStorage()?.remove(THEME_PENDING_KEY);
  } catch {
  }
  $themePendingRev.set($themePendingRev.get() + 1);
}
var announced = /* @__PURE__ */ new Set();
onShellReset(() => announced.clear());
function useThemeBuild(onEnd) {
  const rev = useValue15($themePendingRev);
  const pending2 = useMemo(() => readThemePending(), [rev]);
  const activeQ = useRest("GET /jobs", { query: { kind: "theme" } });
  const active = (activeQ.data?.items ?? []).find((j) => isJobActive(j)) ?? null;
  const trackedId = pending2 && !pending2.seen ? pending2.jobId : active?.id ?? null;
  const jobQ = useJob(trackedId);
  const polled = jobQ.data ?? null;
  const job = polled && polled.id === trackedId ? polled : active && active.id === trackedId ? active : null;
  const endRef = useRef17(onEnd);
  endRef.current = onEnd;
  const gone = jobQ.error instanceof TubeApiError && !jobQ.error.transport;
  useEffect19(() => {
    if (!trackedId) return;
    const mine2 = pending2?.jobId === trackedId ? pending2 : null;
    if (gone) {
      if (mine2) writeThemePending({ ...mine2, seen: true });
      return;
    }
    if (!job || isJobActive(job) || announced.has(job.id)) return;
    announced.add(job.id);
    const dialogOpen = $dialogStack.get().some((d) => d.id === "theme");
    const query = mine2?.query ?? "";
    if (job.status === "done") {
      if (mine2) writeThemePending({ ...mine2, seen: true });
      if (!dialogOpen) endRef.current?.({ kind: "ready", jobId: job.id, query });
      return;
    }
    const error = jobError(job);
    if (mine2) clearThemePending();
    if (!dialogOpen && error.code !== "cancelled") endRef.current?.({ kind: "failed", jobId: job.id, query, error, params: mine2?.params ?? null });
  }, [trackedId, job, gone, pending2]);
  if (!trackedId || !job || !isJobActive(job)) return null;
  const mine = pending2?.jobId === job.id ? pending2 : null;
  return {
    jobId: job.id,
    query: mine?.query ?? "",
    startedAt: mine?.at ?? job.created_at * 1e3,
    progress: job.progress ?? null
  };
}
async function retryThemeBuild(params, query) {
  const out = await callRpc("theme.create", params).catch(() => null);
  const id = out && out.kind === "ok" ? out.data?.job?.id : null;
  if (!id) return false;
  writeThemePending({ jobId: id, query, at: Date.now(), counts: {}, params });
  void invalidateRestExact("GET /jobs", { query: { kind: "theme" } });
  return true;
}

// desktop-src/dialogs/organize/ai.ts
import { useEffect as useEffect20, useState as useState18 } from "react";
var JOB_CANCELLED_CODE = "cancelled";
var AI_STATUS_DEADLINE_MS2 = 4e3;
function isCancelledError(error) {
  return error?.code === JOB_CANCELLED_CODE;
}
function isJobCancelled(job) {
  return !!job && job.status === "error" && isCancelledError(job.error);
}
function isAiStatus2(value) {
  return !!value && typeof value === "object" && typeof value.available === "boolean";
}
function useAiStatus2(enabled = true) {
  const [status, setStatus] = useState18(null);
  useEffect20(() => {
    if (!enabled) return void 0;
    let alive = true;
    const deadline = setTimeout(() => {
      alive = false;
    }, AI_STATUS_DEADLINE_MS2);
    restCall("GET /ai/status").then(
      (data) => {
        if (alive && isAiStatus2(data)) setStatus(data);
      },
      () => void 0
      // 404, network, error envelope: "unknown"
    );
    return () => {
      alive = false;
      clearTimeout(deadline);
    };
  }, [enabled]);
  return status;
}
var NO_MODEL_REASON = "no_model";
var PROVIDER_UNAVAILABLE_REASON = "provider_unavailable";
var ROUTE_PART_CHARS = 80;
function routePart(value) {
  if (typeof value !== "string") return "";
  let text = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").trim();
  if (/^([/~\\]|[A-Za-z]:[\\/])/.test(text)) text = text.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  return text.length <= ROUTE_PART_CHARS ? text : `${text.slice(0, ROUTE_PART_CHARS - 1)}…`;
}
function providerRoute(provider, model) {
  return [routePart(provider), routePart(model)].filter(Boolean).join(" · ");
}
function statusProblem(status) {
  if (!status || status.available !== false) return null;
  if (status.reason === PROVIDER_UNAVAILABLE_REASON) return { kind: "provider_unavailable", route: providerRoute(status.provider, status.model) };
  return { kind: "no_model" };
}
function errorProblem(error) {
  if (!error || error.code !== "llm_unavailable") return null;
  const details = error.details && typeof error.details === "object" ? error.details : {};
  const reason = error.reason ?? details.reason;
  if (reason === PROVIDER_UNAVAILABLE_REASON) return { kind: "provider_unavailable", route: providerRoute(details.provider, details.model) };
  if (reason === NO_MODEL_REASON) return { kind: "no_model" };
  return null;
}
function afterFailure(status) {
  if (status?.available === true) return { kind: "other" };
  return statusProblem(status) ?? { kind: "no_model" };
}
function useAiProblem(error) {
  const direct = errorProblem(error);
  const needsStatus = !!error && error.code === "llm_unavailable" && !direct;
  const [read2, setRead] = useState18(null);
  useEffect20(() => {
    if (!needsStatus) return void 0;
    let alive = true;
    const settle = (status) => {
      if (!alive) return;
      alive = false;
      setRead({ error, problem: afterFailure(status) });
    };
    const deadline = setTimeout(() => settle(null), AI_STATUS_DEADLINE_MS2);
    restCall("GET /ai/status").then(
      (data) => settle(isAiStatus2(data) ? data : null),
      () => settle(null)
    );
    return () => {
      alive = false;
      clearTimeout(deadline);
    };
  }, [error, needsStatus]);
  if (!error || error.code !== "llm_unavailable") return { problem: null, pending: false };
  if (direct) return { problem: direct, pending: false };
  if (read2 && read2.error === error) return { problem: read2.problem, pending: false };
  return { problem: null, pending: true };
}
async function cancelJob(jobId) {
  const out = await callRpc("job.cancel", { job_id: jobId }).catch(() => null);
  if (!out || out.kind !== "ok") return "failed";
  const job = out.data?.job ?? null;
  if (out.data?.cancelled || !job || isJobCancelled(job)) return "cancelled";
  void invalidateRestExact("GET /jobs/{id}", { path: { id: jobId } });
  return "finished";
}

// desktop-src/dialogs/organize/model.ts
var REJECT_GRACE_MS = 5e3;
var CHANNEL_LIST_LIMIT = 2e3;
var ORGANIZABLE_RELATIONS = "subscribed,followed";
var CHANGES_LOOKUP_LIMIT = 200;
function curatorTask() {
  return `${PLUGIN_ID.replace(/-/g, "_")}_curator`;
}
function modelSettingsPath() {
  return `/settings?tab=config:model&aux=${encodeURIComponent(curatorTask())}`;
}
var str = (v) => typeof v === "string" && v.trim() ? v : null;
var strings = (v) => Array.isArray(v) ? v.filter((t) => typeof t === "string" && !!t.trim()) : [];
function proposalOf(s) {
  const p = s.payload ?? {};
  const channelId = str(p.channel_id) ?? str(s.channel_id);
  const folder = str(p.folder);
  if (!channelId || !folder) return null;
  const conf = typeof p.confidence === "number" && Number.isFinite(p.confidence) ? Math.min(1, Math.max(0, p.confidence)) : null;
  const tags = strings(p.tags);
  const fromFolder = str(p.from_folder);
  const sameFolder = typeof p.same_folder === "boolean" ? p.same_folder : fromFolder !== null && folderKey(fromFolder) === folderKey(folder);
  return {
    channelId,
    channelTitle: str(p.channel_title),
    folder: folder.trim(),
    newFolder: p.new_folder === true,
    tags,
    confidence: conf,
    why: typeof p.why === "string" ? p.why : "",
    fromFolder,
    sameFolder,
    newTags: Array.isArray(p.new_tags) ? strings(p.new_tags) : tags
  };
}
function changesNothing(p) {
  return p.sameFolder && p.newTags.length === 0;
}
function rankOf(p) {
  return p.sameFolder ? 2 : p.fromFolder === null ? 0 : 1;
}
var TAGS_GROUP_KEY = "\0tags";
function folderKey(name) {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
function groupItems(items) {
  const groups2 = /* @__PURE__ */ new Map();
  const order = /* @__PURE__ */ new Map();
  items.forEach((item, index) => {
    const r = rankOf(item.proposal);
    const tagsOnly = r === 2;
    const key = tagsOnly ? TAGS_GROUP_KEY : folderKey(item.proposal.folder);
    let g = groups2.get(key);
    if (!g) {
      g = { key, kind: tagsOnly ? "tags" : "folder", folder: tagsOnly ? "" : item.proposal.folder, isNew: false, items: [] };
      groups2.set(key, g);
    }
    g.items.push(item);
    const best = order.get(key);
    if (!best || r < best[0]) order.set(key, [r, index]);
    if (item.proposal.newFolder && !tagsOnly) g.isNew = true;
  });
  const byRank = (a, b) => rankOf(a.proposal) - rankOf(b.proposal);
  const pos = (g) => order.get(g.key) ?? [0, 0];
  return [...groups2.values()].map((g) => ({ ...g, items: [...g.items].sort(byRank) })).sort((a, b) => pos(a)[0] - pos(b)[0] || pos(a)[1] - pos(b)[1]);
}
function mergeSuggestions(prev, incoming, keep, prune) {
  const fresh = /* @__PURE__ */ new Map();
  for (const s of incoming) {
    if (s.kind !== "organize") continue;
    const proposal = proposalOf(s);
    if (proposal && !changesNothing(proposal)) fresh.set(s.id, { suggestion: s, proposal });
  }
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of prev) {
    const id = item.suggestion.id;
    seen.add(id);
    const next = fresh.get(id);
    if (next) out.push(next);
    else if (!prune || keep(id)) out.push(item);
  }
  for (const [id, item] of fresh) if (!seen.has(id)) out.push(item);
  return out;
}
function missingChannels(targets, items) {
  const covered = new Set(items.map((i) => i.proposal.channelId));
  return [...new Set(targets)].filter((id) => !covered.has(id));
}
function folderPaths(folders) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (f, depth = 0) => {
    const parent = f.parent_id ? byId.get(f.parent_id) : void 0;
    return parent && depth < 8 ? `${pathOf(parent, depth + 1)}/${f.name}` : f.name;
  };
  return folders.map((f) => pathOf(f)).sort((a, b) => a.localeCompare(b));
}
function pluralKey(base, count2, locale) {
  let rule = "other";
  try {
    rule = new Intl.PluralRules(locale).select(count2);
  } catch {
    rule = count2 === 1 ? "one" : "other";
  }
  return `${base}_${rule === "one" ? "one" : "other"}`;
}

// desktop-src/dialogs/organize/parts.tsx
import { Button as Button18, Codicon as Codicon22, Input as Input2 } from "@hermes/plugin-sdk";
import { useId as useId4, useRef as useRef18, useState as useState19 } from "react";
import { Fragment as Fragment13, jsx as jsx32, jsxs as jsxs27 } from "react/jsx-runtime";
function usePlural2() {
  const t = useT("organize");
  const locale = useLocale();
  const fmt = useFormatCount();
  return (base, count2, extra) => t(pluralKey(base, count2, locale), { count: fmt(count2), ...extra });
}
var STEP_IDS = ["read", "suggest", "review"];
function introSteps(t) {
  return STEP_IDS.map((id) => ({ id, label: t(`steps.${id}`), status: "waiting" }));
}
function IntroBody({
  count: count2,
  selection,
  modelLine,
  onChooseModel
}) {
  const t = useT("organize");
  return /* @__PURE__ */ jsxs27(Stack, { gap: 5, children: [
    /* @__PURE__ */ jsxs27(Stack, { gap: 2, children: [
      /* @__PURE__ */ jsx32("div", { "data-part": "organize-count", children: /* @__PURE__ */ jsx32(Stat, { label: selection ? t("intro.count_selection") : t("intro.count_none"), value: count2 }) }),
      /* @__PURE__ */ jsx32("p", { className: cx("section-desc t-body"), children: t("intro.lead") })
    ] }),
    /* @__PURE__ */ jsx32(Section, { title: t("intro.steps_label"), children: /* @__PURE__ */ jsx32(StepProgress, { steps: introSteps(t), label: t("intro.steps_label") }) }),
    modelLine !== null ? /* @__PURE__ */ jsx32(ModelLine, { text: modelLine, onChooseModel }) : null
  ] });
}
function ModelLine({ text, onChooseModel }) {
  const t = useT("organize");
  return /* @__PURE__ */ jsxs27(Stack, { direction: "row", gap: 2, align: "center", wrap: true, children: [
    /* @__PURE__ */ jsxs27("span", { className: cx("stat-label t-label"), "data-part": "organize-model", children: [
      /* @__PURE__ */ jsx32(Codicon22, { name: "sparkle", size: 12 }),
      " ",
      text
    ] }),
    /* @__PURE__ */ jsx32(Button18, { variant: "ghost", size: "xs", "data-part": "organize-model-settings", onClick: onChooseModel, children: t("intro.choose_model") })
  ] });
}
function IntroSkeleton() {
  const t = useT("organize");
  return /* @__PURE__ */ jsxs27(Stack, { gap: 5, children: [
    /* @__PURE__ */ jsxs27(Stack, { gap: 2, children: [
      /* @__PURE__ */ jsx32(StatSkeleton, {}),
      /* @__PURE__ */ jsx32("div", { className: cx("section-desc t-body"), "aria-hidden": "true", children: /* @__PURE__ */ jsx32(SkLines, { widths: ["92%", "58%"] }) })
    ] }),
    /* @__PURE__ */ jsx32(Section, { title: t("intro.steps_label"), children: /* @__PURE__ */ jsx32(StepProgressSkeleton, { count: 3 }) }),
    /* @__PURE__ */ jsx32("span", { className: cx("stat-label t-label"), "aria-hidden": "true", children: /* @__PURE__ */ jsx32(SkLines, { widths: ["220px"] }) })
  ] });
}
function ProgressPanel({ progress }) {
  const t = useT("organize");
  const fmt = useFormatCount();
  const total = progress?.total ?? null;
  const done = Math.max(0, progress?.done ?? 0);
  const pct = total && total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;
  const channels = total != null ? t("progress.channels", { done: fmt(done), total: fmt(total) }) : t("progress.preparing");
  const started = !!progress;
  const steps = [
    { id: "read", label: t("steps.read"), status: started ? "done" : "running" },
    { id: "suggest", label: t("steps.suggest"), status: started ? "running" : "waiting" },
    { id: "review", label: t("steps.review"), status: "waiting" }
  ];
  return /* @__PURE__ */ jsxs27(Stack, { gap: 3, children: [
    /* @__PURE__ */ jsx32(StepProgress, { steps, label: t("progress.label") }),
    /* @__PURE__ */ jsxs27(Stack, { direction: "row", gap: 3, align: "center", children: [
      /* @__PURE__ */ jsx32(
        "span",
        {
          className: cx("pairing-bar"),
          role: "progressbar",
          "aria-label": t("progress.label"),
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": pct,
          "aria-valuetext": channels,
          "data-part": "organize-progress",
          children: /* @__PURE__ */ jsx32("span", { className: cx("pairing-bar-fill"), style: vars({ left: `${pct}%` }) })
        }
      ),
      /* @__PURE__ */ jsxs27("span", { className: cx("stat-label t-label num"), "aria-hidden": "true", children: [
        channels,
        total ? /* @__PURE__ */ jsxs27(Fragment13, { children: [
          " · ",
          t("progress.percent", { percent: fmt(pct) })
        ] }) : null
      ] })
    ] })
  ] });
}
function statusOf(decision) {
  return decision === "accepted" ? "accepted" : decision === "rejected" ? "rejected" : "pending";
}
function SuggestionList({
  groups: groups2,
  decisions,
  edits,
  channels,
  folderOptions,
  showModelPerGroup,
  arriving,
  onAccept,
  onReject,
  onEdit
}) {
  const t = useT("organize");
  const listId = useId4();
  const pendingOf = (items) => items.filter((i) => statusOf(decisions[i.suggestion.id]) === "pending");
  return /* @__PURE__ */ jsxs27("div", { role: "group", "aria-label": t("review.list_label"), "data-part": "organize-groups", children: [
    /* @__PURE__ */ jsxs27(Stack, { gap: 3, children: [
      groups2.map((g) => {
        const pending2 = pendingOf(g.items);
        const model = showModelPerGroup ? g.items.find((i) => i.suggestion.model)?.suggestion.model ?? null : null;
        return /* @__PURE__ */ jsx32(
          SuggestionGroup,
          {
            title: /* @__PURE__ */ jsx32(GroupTitle, { group: g }),
            count: null,
            model,
            onAcceptAll: pending2.length ? () => onAccept(pending2) : void 0,
            onRejectAll: pending2.length ? () => onReject(pending2) : void 0,
            children: g.items.map((item) => /* @__PURE__ */ jsx32(
              Row,
              {
                item,
                decision: decisions[item.suggestion.id],
                edit: edits[item.proposal.channelId],
                channel: channels.get(item.proposal.channelId),
                listId,
                onAccept,
                onReject,
                onEdit
              },
              item.suggestion.id
            ))
          },
          g.key
        );
      }),
      arriving ? /* @__PURE__ */ jsx32(ArrivingGroup, {}) : null
    ] }),
    /* @__PURE__ */ jsx32("datalist", { id: listId, children: folderOptions.map((f) => /* @__PURE__ */ jsx32("option", { value: f }, f)) })
  ] });
}
function GroupTitle({ group: group2 }) {
  const t = useT("organize");
  const tp = usePlural2();
  return /* @__PURE__ */ jsxs27(Fragment13, { children: [
    group2.kind === "tags" ? t("group.tags_only") : group2.folder,
    group2.isNew ? /* @__PURE__ */ jsxs27(Fragment13, { children: [
      " ",
      /* @__PURE__ */ jsxs27("span", { className: cx("sgroup-meta t-label"), "data-part": "organize-new-folder", children: [
        /* @__PURE__ */ jsx32(Dot, { tone: "new" }),
        " ",
        t("group.new")
      ] })
    ] }) : null,
    " ",
    /* @__PURE__ */ jsx32("span", { className: cx("sgroup-meta t-label num"), "data-part": "organize-group-count", children: tp("review.suggestions", group2.items.length) })
  ] });
}
function Row({
  item,
  decision,
  edit,
  channel,
  listId,
  onAccept,
  onReject,
  onEdit
}) {
  const t = useT("organize");
  const tp = usePlural2();
  const p = item.proposal;
  const title = channel?.title ?? p.channelTitle ?? p.channelId;
  const status = statusOf(decision);
  const folder = edit ?? p.folder;
  const edited = edit !== void 0 && folderKey(edit) !== folderKey(p.folder);
  const hashtags = (tags) => tags.map((tag) => `#${tag}`).join(" ");
  if (p.sameFolder) {
    return /* @__PURE__ */ jsx32(
      SuggestionRow,
      {
        subject: title,
        avatar: { title, thumb: channel?.thumb ?? null },
        target: /* @__PURE__ */ jsx32("span", { className: cx("t-label"), "data-part": "organize-add-tags", children: tp("row.add_tags", p.newTags.length, { tags: hashtags(p.newTags) }) }),
        reason: [p.fromFolder ? t("row.from", { folder: p.fromFolder }) : null, p.why || null].filter(Boolean).join(" · "),
        confidence: p.confidence,
        status,
        onAccept: () => onAccept([item]),
        onReject: () => onReject([item])
      }
    );
  }
  const reason = [p.fromFolder ? t("row.from", { folder: p.fromFolder }) : null, p.why || null, p.tags.length ? hashtags(p.tags) : null].filter(Boolean).join(" · ");
  const target = /* @__PURE__ */ jsxs27(Fragment13, { children: [
    status === "pending" ? /* @__PURE__ */ jsx32(FolderPick, { channelTitle: title, folder, listId, onCommit: (next) => onEdit(p.channelId, next) }) : folder,
    edited ? /* @__PURE__ */ jsx32("span", { className: cx("sgroup-meta t-label"), children: t("row.edited") }) : null
  ] });
  return /* @__PURE__ */ jsx32(
    SuggestionRow,
    {
      subject: title,
      avatar: { title, thumb: channel?.thumb ?? null },
      target,
      reason,
      confidence: p.confidence,
      status,
      onAccept: () => onAccept([item]),
      onReject: () => onReject([item])
    }
  );
}
function FolderPick({
  channelTitle,
  folder,
  listId,
  onCommit
}) {
  const t = useT("organize");
  const [editing, setEditing] = useState19(false);
  const [draft, setDraft] = useState19(folder);
  const settled = useRef18(false);
  const pickRef = useRef18(null);
  const open = () => {
    settled.current = false;
    setDraft(folder);
    setEditing(true);
  };
  const close = (commit) => {
    if (settled.current) return;
    settled.current = true;
    if (commit) onCommit(cleanFolder(draft));
    setEditing(false);
    queueMicrotask(() => pickRef.current?.focus());
  };
  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(false);
    }
  };
  if (editing) {
    return /* @__PURE__ */ jsx32(
      Input2,
      {
        "data-part": "organize-folder-input",
        "aria-label": t("row.folder_input", { channel: channelTitle }),
        title: t("row.folder_hint"),
        list: listId,
        value: draft,
        autoFocus: true,
        spellCheck: false,
        autoComplete: "off",
        onChange: (e) => setDraft(e.target.value),
        onKeyDown,
        onBlur: () => close(true)
      }
    );
  }
  return /* @__PURE__ */ jsxs27(
    "button",
    {
      ref: pickRef,
      type: "button",
      className: cx("bare chip t-label"),
      "data-part": "organize-folder-pick",
      "aria-label": t("row.change_folder", { channel: channelTitle }),
      title: t("row.change_folder", { channel: channelTitle }),
      onClick: open,
      children: [
        /* @__PURE__ */ jsx32(Codicon22, { name: "folder", size: 12, className: cx("chip-icon") }),
        /* @__PURE__ */ jsx32("span", { className: cx("chip-label"), children: folder }),
        /* @__PURE__ */ jsx32(Codicon22, { name: "edit", size: 10, className: cx("chip-icon") })
      ]
    }
  );
}
function cleanFolder(value) {
  const parts = value.split("/").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
  return parts.length ? parts.join("/") : null;
}
function ArrivingGroup() {
  const t = useT("organize");
  return /* @__PURE__ */ jsxs27("section", { className: cx("sgroup"), "data-part": "organize-arriving", "data-skeleton": true, "aria-busy": "true", children: [
    /* @__PURE__ */ jsxs27("header", { className: cx("sgroup-head"), children: [
      /* @__PURE__ */ jsx32("span", { className: cx("sgroup-title t-head"), "aria-hidden": "true", children: /* @__PURE__ */ jsx32(SkLines, { widths: ["140px"] }) }),
      /* @__PURE__ */ jsx32("span", { className: cx("sgroup-meta t-label"), children: t("progress.arriving") })
    ] }),
    /* @__PURE__ */ jsxs27("div", { "aria-hidden": "true", children: [
      /* @__PURE__ */ jsx32(SuggestionRowSkeleton, {}),
      /* @__PURE__ */ jsx32(SuggestionRowSkeleton, {})
    ] })
  ] });
}
function Notice({
  part,
  tone = "info",
  title,
  children,
  action,
  icon
}) {
  return /* @__PURE__ */ jsx32("div", { "data-part": part, children: /* @__PURE__ */ jsx32(Banner, { tone, title, action, icon, children }) });
}

// desktop-src/dialogs/organize/index.tsx
import { Fragment as Fragment14, jsx as jsx33, jsxs as jsxs28 } from "react/jsx-runtime";
function isMac() {
  return typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || "");
}
var NO_MODEL_ATOM = atom15("");
function omit(map, ids, only) {
  const out = { ...map };
  for (const id of ids) if (only === void 0 || out[id] === only) delete out[id];
  return out;
}
function mark(map, ids, value) {
  const out = { ...map };
  for (const id of ids) out[id] = value;
  return out;
}
function OrganizeDialog({ channelIds, jobId, onClose, initial }) {
  const t = useT("organize");
  const tc2 = useT();
  const tp = usePlural2();
  const selection = useMemo2(() => channelIds && channelIds.length ? [...new Set(channelIds)] : null, [channelIds]);
  const job = useRpcJob("organize.run", jobId ?? null);
  const { start, resume, reset } = job;
  const channelsQ = useRest(
    "GET /channels",
    selection ? { query: { ids: selection.join(","), limit: CHANNEL_LIST_LIMIT } } : { query: { folder: "none", relation: ORGANIZABLE_RELATIONS, limit: CHANNEL_LIST_LIMIT } }
  );
  const suggestionsQ = useRest("GET /suggestions", {});
  const jobsQ = useRest("GET /jobs", { query: { kind: "organize" } }, { enabled: !jobId });
  const foldersQ = useRest("GET /folders", {});
  const mainModel = useValue16(host11.state?.model ?? NO_MODEL_ATOM);
  const ai = useAiStatus2();
  const [items, setItems] = useState20(() => mergeSuggestions([], initial?.items ?? [], () => true, false));
  const [decisions, setDecisionsState] = useState20(initial?.decisions ?? {});
  const decisionsRef = useRef19(decisions);
  const setDecisions = useCallback9((fn) => {
    const next = fn(decisionsRef.current);
    if (next === decisionsRef.current) return;
    decisionsRef.current = next;
    setDecisionsState(next);
  }, []);
  const [edits, setEdits] = useState20(initial?.edits ?? {});
  const editsRef = useRef19(edits);
  editsRef.current = edits;
  const [session, setSession] = useState20(initial?.sessionGroups ?? []);
  const sessionRef = useRef19(session);
  sessionRef.current = session;
  const [notice, setNotice] = useState20(initial?.notice ?? null);
  const [forced, setForced] = useState20(initial?.view ?? null);
  const [busyFailed, setBusyFailed] = useState20(null);
  const [actionError, setActionError] = useState20(null);
  const [undoing, setUndoing] = useState20(false);
  const [cancelling, setCancelling] = useState20(false);
  const [rejectCount, setRejectCount] = useState20(0);
  const pendingRejects = useRef19([]);
  const rejectTimer = useRef19(null);
  const lastRun = useRef19(null);
  const autoResumed = useRef19(!!jobId || !!initial);
  const rootRef = useRef19(null);
  const focusAfter = useRef19(null);
  const channelMap = useRef19(/* @__PURE__ */ new Map());
  if (channelsQ.data) for (const r of channelsQ.data.items) channelMap.current.set(r.channel.id, r.channel);
  useEffect21(() => {
    const data = suggestionsQ.data;
    if (!data) return;
    setItems((prev) => mergeSuggestions(prev, data.items, (id) => id in decisionsRef.current, true));
    const present = new Set(data.items.map((s) => s.id));
    setDecisions((d) => {
      const back = Object.keys(d).filter((id) => d[id] === "restoring" && present.has(id));
      return back.length ? omit(d, back) : d;
    });
  }, [suggestionsQ.data, setDecisions]);
  const result = job.phase === "done" ? job.result : null;
  useEffect21(() => {
    const list2 = result?.suggestions;
    if (!list2?.length) return;
    setItems((prev) => mergeSuggestions(prev, list2.filter((s) => s.status === "pending"), () => true, false));
  }, [result]);
  const progressDone = job.progress?.done ?? -1;
  useEffect21(() => {
    if (job.phase === "running") void invalidateRest("GET /suggestions");
    else if (job.phase === "done") void invalidateRest("GET /suggestions", "GET /channels");
  }, [progressDone, job.phase]);
  const activeJob = jobsQ.data?.items.find((j) => isJobActive(j)) ?? null;
  useEffect21(() => {
    if (autoResumed.current || !jobsQ.data) return;
    autoResumed.current = true;
    if (job.phase === "idle" && activeJob) resume(activeJob.id);
  }, [jobsQ.data, activeJob, job.phase, resume]);
  const cancelledJob = job.phase === "error" && isCancelledError(job.error);
  useEffect21(() => {
    if (!cancelledJob) return;
    reset();
    setNotice("cancelled");
    void invalidateRest("GET /suggestions");
  }, [cancelledJob, reset]);
  const jobPhase = cancelledJob ? "idle" : job.phase;
  const aiFailure = useAiProblem(jobPhase === "error" ? job.error : null);
  const busy = job.phase === "error" && job.error?.code === "busy" ? job.error : null;
  useEffect21(() => {
    if (!busy) return;
    let alive = true;
    restCall("GET /jobs", { query: { kind: "organize" } }).then(
      (data) => {
        if (!alive) return;
        const running = data.items.find((j) => isJobActive(j));
        if (running) {
          setNotice("busy");
          resume(running.id);
        } else setBusyFailed(busy);
      },
      () => {
        if (alive) setBusyFailed(busy);
      }
    );
    return () => {
      alive = false;
    };
  }, [busy, resume]);
  const flushRejects = useCallback9(() => {
    if (rejectTimer.current) clearTimeout(rejectTimer.current);
    rejectTimer.current = null;
    const ids = pendingRejects.current;
    pendingRejects.current = [];
    setRejectCount(0);
    if (ids.length) sendReject(ids);
  }, []);
  const sendReject = (ids) => {
    void callRpc("organize.reject", { suggestion_ids: ids }).then((out) => {
      if (out.kind === "ok") return;
      setDecisions((d) => omit(d, ids, "rejected"));
      setActionError({
        kind: "reject",
        error: out.kind === "error" ? out.error : null,
        retry: () => {
          setActionError(null);
          setDecisions((d) => mark(d, ids, "rejected"));
          sendReject(ids);
        }
      });
    });
  };
  const reject = useCallback9(
    (target) => {
      const ids = target.map((i) => i.suggestion.id).filter((id) => statusOf(decisionsRef.current[id]) === "pending");
      if (!ids.length) return;
      setActionError(null);
      setDecisions((d) => mark(d, ids, "rejected"));
      pendingRejects.current = [...pendingRejects.current, ...ids];
      setRejectCount(pendingRejects.current.length);
      if (rejectTimer.current) clearTimeout(rejectTimer.current);
      rejectTimer.current = setTimeout(flushRejects, REJECT_GRACE_MS);
    },
    [flushRejects, setDecisions]
  );
  const undoReject = useCallback9(() => {
    if (rejectTimer.current) clearTimeout(rejectTimer.current);
    rejectTimer.current = null;
    const ids = pendingRejects.current;
    pendingRejects.current = [];
    setRejectCount(0);
    setDecisions((d) => omit(d, ids, "rejected"));
  }, [setDecisions]);
  useEffect21(() => () => flushRejects(), [flushRejects]);
  const acceptRef = useRef19(() => void 0);
  acceptRef.current = (target) => {
    const chosen = target.filter((i) => statusOf(decisionsRef.current[i.suggestion.id]) === "pending");
    const ids = chosen.map((i) => i.suggestion.id);
    if (!ids.length) return;
    const changed = {};
    for (const i of chosen) {
      const edit2 = editsRef.current[i.proposal.channelId];
      if (edit2 !== void 0 && folderKey(edit2) !== folderKey(i.proposal.folder)) changed[i.proposal.channelId] = { folder: edit2 };
    }
    const params = { suggestion_ids: ids, ...Object.keys(changed).length ? { edits: changed } : {} };
    setActionError(null);
    setDecisions((d) => mark(d, ids, "accepted"));
    void callRpc("organize.accept", params).then((out) => {
      if (out.kind === "ok") {
        const group2 = out.data?.change_group ?? null;
        const changeIds = Array.isArray(out.data?.change_ids) ? out.data.change_ids.filter((n) => Number.isInteger(n)) : void 0;
        if (group2 || changeIds?.length) setSession((s) => [...s, { group: group2 ?? "", ids, ...changeIds ? { changeIds } : {} }]);
        void invalidateRest();
        return;
      }
      setDecisions((d) => omit(d, ids, "accepted"));
      setActionError({ kind: "accept", error: out.kind === "error" ? out.error : null, retry: () => acceptRef.current(chosen) });
    });
  };
  const accept = useCallback9((target) => acceptRef.current(target), []);
  const edit = useCallback9((channelId, folder) => {
    setEdits((e) => {
      const next = { ...e };
      if (folder === null) delete next[channelId];
      else next[channelId] = folder;
      return next;
    });
  }, []);
  const undoAll = useCallback9(async () => {
    const groups3 = sessionRef.current;
    if (!groups3.length) return;
    setUndoing(true);
    setActionError(null);
    setDecisions((d) => mark(d, groups3.flatMap((g) => g.ids), "restoring"));
    const failed = [];
    let error = null;
    try {
      const changes = groups3.some((g) => !g.changeIds) ? await restCall("GET /changes", { query: { limit: CHANGES_LOOKUP_LIMIT } }) : null;
      for (const g of [...groups3].reverse()) {
        let id;
        if (g.changeIds) {
          if (!g.changeIds.length) continue;
          id = g.changeIds[0];
        } else {
          const items2 = changes?.items ?? [];
          const rec = items2.find((c) => c.group_id === g.group && c.undone_at === null) ?? items2.find((c) => c.group_id === g.group);
          if (rec && rec.undone_at !== null) continue;
          if (!rec) {
            failed.push(g);
            error = error ?? toApiError(new TubeApiError({ code: "not_found", message: g.group }));
            continue;
          }
          id = rec.id;
        }
        try {
          await restCall("POST /changes/{id}/undo", { path: { id } });
        } catch (e) {
          const api = toApiError(e);
          if (api.code === "undo_refused" && api.reason === "already_undone") continue;
          failed.push(g);
          error = error ?? api;
        }
      }
    } catch (e) {
      failed.push(...groups3.filter((g) => !failed.includes(g)));
      error = toApiError(e);
    }
    if (failed.length) setDecisions((d) => mark(d, failed.flatMap((g) => g.ids), "accepted"));
    setSession(failed);
    if (error) setActionError({ kind: "undo", error, retry: () => void undoAll() });
    setUndoing(false);
    void invalidateRest();
  }, [setDecisions]);
  const run = useCallback9(
    (ids) => {
      flushRejects();
      setNotice(null);
      setBusyFailed(null);
      setForced(null);
      setActionError(null);
      autoResumed.current = true;
      const list2 = ids ?? selection;
      lastRun.current = ids ?? null;
      void start(list2 ? { channel_ids: list2 } : {});
    },
    [flushRejects, start, selection]
  );
  const cancel = useCallback9(async () => {
    const id = job.jobId;
    if (!id) return;
    setCancelling(true);
    setNotice(null);
    const outcome = await cancelJob(id);
    setCancelling(false);
    if (outcome === "cancelled") {
      reset();
      setNotice("cancelled");
      void invalidateRest("GET /suggestions");
    } else if (outcome === "failed") setNotice("cancel_failed");
  }, [job.jobId, reset]);
  const keepOpenOnFieldEscape = useCallback9((e) => {
    const target = e.target instanceof Element ? e.target : typeof document !== "undefined" ? document.activeElement : null;
    if (target?.closest('[data-part="organize-folder-input"]')) e.preventDefault();
  }, []);
  const chooseModel = useCallback9(() => {
    onClose();
    host11.navigate(modelSettingsPath());
  }, [onClose]);
  const groups2 = useMemo2(() => groupItems(items), [items]);
  const pending2 = useMemo2(() => items.filter((i) => statusOf(decisions[i.suggestion.id]) === "pending"), [items, decisions]);
  const models = useMemo2(() => [...new Set(items.map((i) => i.suggestion.model).filter((m) => !!m))], [items]);
  const suggester = result?.model ?? models[0] ?? null;
  const tracked = job.jobId !== null;
  const countError = !selection && channelsQ.data === void 0 && channelsQ.error ? channelsQ.error : null;
  const count2 = selection ? selection.length : channelsQ.data?.total ?? null;
  let view;
  if (forced) view = forced;
  else if (jobPhase === "unavailable") view = "unavailable";
  else if (jobPhase === "error" && job.error?.code === "llm_unavailable" && aiFailure.problem?.kind !== "other")
    view = aiFailure.pending ? "boot" : aiFailure.problem?.kind === "provider_unavailable" ? "provider_unavailable" : "no_model";
  else if (busy && !busyFailed) view = "running";
  else if (jobPhase === "error") view = "error";
  else if (jobPhase === "starting" || jobPhase === "running") view = "running";
  else if (jobPhase === "done") view = "review";
  else if (!autoResumed.current && !jobsQ.error && (jobsQ.data === void 0 || activeJob)) view = activeJob ? "running" : "boot";
  else if (items.length) view = "review";
  else if (suggestionsQ.data === void 0 && suggestionsQ.error) view = "error";
  else if (suggestionsQ.data === void 0) view = "boot";
  else if (countError) view = "error";
  else if (count2 === null) view = "boot";
  else if (count2 === 0) view = "nothing";
  else view = "intro";
  const targets = selection ?? channelsQ.data?.items.map((r) => r.channel.id) ?? null;
  const missing = view === "review" && tracked && job.phase === "done" && targets ? missingChannels(targets, items) : [];
  const uncovered = view === "review" && !tracked && !selection && channelsQ.data ? missingChannels(channelsQ.data.items.map((r) => r.channel.id), items) : [];
  const timedOut = !!job.progress && job.progress.total != null && job.progress.done < job.progress.total;
  const acceptAll = useCallback9(() => accept(pending2), [accept, pending2]);
  const onKeyDown = (e) => {
    if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.altKey) return;
    if (view !== "review" && view !== "running" || !pending2.length) return;
    e.preventDefault();
    acceptAll();
  };
  const actOn = useCallback9(
    (fn) => (target) => {
      const flat = groupItems(items).flatMap((g) => g.items);
      const last = Math.max(...target.map((i) => flat.indexOf(i)));
      const root = rootRef.current;
      focusAfter.current = root && root.contains(document.activeElement) ? last : null;
      fn(target);
    },
    [items]
  );
  useEffect21(() => {
    const idx = focusAfter.current;
    focusAfter.current = null;
    const root = rootRef.current;
    if (idx === null || !root) return;
    const rows = [...root.querySelectorAll('[data-part="suggestion-row"]:not([data-skeleton])')];
    const next = rows.slice(idx + 1).find((r) => r.getAttribute("data-status") === "pending") ?? rows.find((r) => r.getAttribute("data-status") === "pending");
    const target = next?.querySelector('[data-part="suggestion-accept"]');
    if (target) target.focus();
  }, [decisions]);
  const folderOptions = useMemo2(() => {
    const own = foldersQ.data ? folderPaths(foldersQ.data.items) : [];
    const suggested = groups2.map((g) => g.folder);
    return [.../* @__PURE__ */ new Set([...own, ...suggested])];
  }, [foldersQ.data, groups2]);
  const modelText = ai?.available && ai.model ? t("intro.model_exact", { model: ai.model }) : suggester ? t("intro.model_last", { model: suggester }) : mainModel ? t("intro.model_main", { model: mainModel }) : t("intro.model_unknown");
  const unreachable = (route) => route ? tc2("provider_unavailable", { route }) : tc2("provider_unavailable_plain");
  const before = statusProblem(ai);
  const aiWarning = before?.kind === "provider_unavailable" ? /* @__PURE__ */ jsx33(
    Notice,
    {
      part: "organize-ai-warning",
      tone: "warning",
      title: t("ai.provider_unavailable_title"),
      action: { label: t("provider_unavailable.action"), onClick: chooseModel },
      children: unreachable(before.route)
    },
    "ai"
  ) : before ? /* @__PURE__ */ jsx33(
    Notice,
    {
      part: "organize-ai-warning",
      tone: "warning",
      title: t("ai.no_model_title"),
      action: { label: t("ai.choose_model"), onClick: chooseModel },
      children: t("ai.no_model_desc")
    },
    "ai"
  ) : null;
  const list = (arriving) => groups2.length || arriving ? /* @__PURE__ */ jsx33(
    SuggestionList,
    {
      groups: groups2,
      decisions,
      edits,
      channels: channelMap.current,
      folderOptions,
      showModelPerGroup: models.length > 1,
      arriving,
      onAccept: actOn(accept),
      onReject: actOn(reject),
      onEdit: edit
    }
  ) : null;
  const sessionChannels = new Set(session.flatMap((g) => g.ids)).size;
  const banners = [];
  if (notice) banners.push(/* @__PURE__ */ jsx33(Notice, { part: "organize-notice", children: t(`notice.${notice}`) }, "notice"));
  if (actionError)
    banners.push(
      /* @__PURE__ */ jsx33(
        Notice,
        {
          part: "organize-action-error",
          tone: "error",
          title: t(`error.${actionError.kind}`),
          action: { label: t("error.retry"), onClick: actionError.retry },
          children: actionError.error ? errorText(tc2, actionError.error) : tc2(MESSAGE_KEYS.openDesktopBackend)
        },
        "action-error"
      )
    );
  if (missing.length)
    banners.push(
      /* @__PURE__ */ jsx33(
        Notice,
        {
          part: "organize-partial",
          tone: "warning",
          title: tp("partial.title", missing.length),
          action: { label: t("partial.retry"), onClick: () => run(missing) },
          children: timedOut ? t("partial.timeout") : t("partial.batch")
        },
        "partial"
      )
    );
  if (uncovered.length)
    banners.push(
      /* @__PURE__ */ jsx33(
        Notice,
        {
          part: "organize-uncovered",
          tone: "warning",
          title: tp("uncovered.title", uncovered.length),
          action: { label: t("uncovered.action"), onClick: () => run(uncovered) },
          children: t("uncovered.desc")
        },
        "uncovered"
      )
    );
  if (suggestionsQ.error && (view === "review" || view === "running"))
    banners.push(
      /* @__PURE__ */ jsx33(
        Notice,
        {
          part: "organize-read-error",
          tone: "warning",
          action: { label: t("error.retry"), onClick: () => void suggestionsQ.refetch() },
          children: errorText(tc2, toApiError(suggestionsQ.error))
        },
        "read-error"
      )
    );
  if (session.length && (view === "review" || view === "running"))
    banners.push(
      /* @__PURE__ */ jsx33(
        Notice,
        {
          part: "organize-undo",
          icon: "pass",
          title: tp("undo.organized", sessionChannels),
          action: undoing ? void 0 : { label: t("undo.action"), onClick: () => void undoAll() },
          children: undoing ? t("undo.undoing") : null
        },
        "undo"
      )
    );
  if (rejectCount)
    banners.push(
      /* @__PURE__ */ jsx33(Notice, { part: "organize-reject-undo", icon: "close", title: tp("reject.pending", rejectCount), action: { label: t("reject.undo"), onClick: undoReject } }, "reject")
    );
  let body;
  let footer;
  const closeBtn = (part = "organize-close") => /* @__PURE__ */ jsx33(Button19, { variant: "outline", size: "sm", "data-part": part, onClick: onClose, children: t("review.close") });
  if (view === "boot" || view === "intro") {
    body = view === "intro" && count2 !== null ? /* @__PURE__ */ jsxs28(Fragment14, { children: [
      notice ? /* @__PURE__ */ jsx33(Notice, { part: "organize-notice", children: t(`notice.${notice}`) }, "notice") : null,
      aiWarning,
      /* @__PURE__ */ jsx33(IntroBody, { count: count2, selection: !!selection, modelLine: aiWarning ? null : modelText, onChooseModel: chooseModel })
    ] }) : /* @__PURE__ */ jsx33(IntroSkeleton, {});
    footer = /* @__PURE__ */ jsxs28(Fragment14, { children: [
      /* @__PURE__ */ jsx33(Button19, { variant: "outline", size: "sm", "data-part": "organize-not-now", onClick: onClose, children: t("intro.not_now") }),
      /* @__PURE__ */ jsxs28(
        Button19,
        {
          size: "sm",
          variant: aiWarning ? "outline" : void 0,
          "data-part": "organize-start",
          disabled: view !== "intro",
          onClick: () => run(),
          children: [
            /* @__PURE__ */ jsx33(Codicon23, { name: "sparkle", size: 14 }),
            t("intro.start")
          ]
        }
      )
    ] });
  } else if (view === "nothing") {
    body = /* @__PURE__ */ jsx33(
      EmptyView,
      {
        icon: "pass",
        title: t("nothing.title"),
        description: t("nothing.desc"),
        action: /* @__PURE__ */ jsx33(
          Button19,
          {
            variant: "outline",
            size: "sm",
            "data-part": "organize-open-manage",
            onClick: () => {
              onClose();
              openSection("manage");
            },
            children: t("nothing.action")
          }
        )
      }
    );
    footer = closeBtn();
  } else if (view === "no_model") {
    body = /* @__PURE__ */ jsx33(
      EmptyView,
      {
        icon: "sparkle",
        title: t("no_model.title"),
        description: t("no_model.desc"),
        action: /* @__PURE__ */ jsx33(Button19, { variant: "outline", size: "sm", "data-part": "organize-retry", onClick: () => run(lastRun.current), children: t("no_model.retry") })
      }
    );
    footer = /* @__PURE__ */ jsxs28(Fragment14, { children: [
      closeBtn(),
      /* @__PURE__ */ jsx33(Button19, { size: "sm", "data-part": "organize-choose-model", onClick: chooseModel, children: t("no_model.action") })
    ] });
  } else if (view === "provider_unavailable") {
    const route = forced === "provider_unavailable" ? initial?.aiRoute ?? "" : aiFailure.problem?.kind === "provider_unavailable" ? aiFailure.problem.route : "";
    body = /* @__PURE__ */ jsx33(
      EmptyView,
      {
        icon: "sparkle",
        title: t("provider_unavailable.title"),
        description: unreachable(route),
        action: /* @__PURE__ */ jsx33(Button19, { variant: "outline", size: "sm", "data-part": "organize-retry", onClick: () => run(lastRun.current), children: t("provider_unavailable.retry") })
      }
    );
    footer = /* @__PURE__ */ jsxs28(Fragment14, { children: [
      closeBtn(),
      /* @__PURE__ */ jsx33(Button19, { size: "sm", "data-part": "organize-open-model", onClick: chooseModel, children: t("provider_unavailable.action") })
    ] });
  } else if (view === "unavailable") {
    body = /* @__PURE__ */ jsx33(RpcUnavailableNotice, {});
    footer = closeBtn();
  } else if (view === "error") {
    const err = countError ?? (suggestionsQ.data === void 0 && !tracked ? suggestionsQ.error : null) ?? busyFailed ?? job.error;
    const retry3 = countError ? () => void channelsQ.refetch() : suggestionsQ.data === void 0 && !tracked && suggestionsQ.error ? () => void suggestionsQ.refetch() : () => run(lastRun.current);
    const aiOther = err === job.error && aiFailure.problem?.kind === "other" ? job.error?.message : void 0;
    body = /* @__PURE__ */ jsx33(ErrorView, { error: err, title: t("error.title"), description: aiOther, onRetry: retry3 });
    footer = closeBtn();
  } else if (view === "running") {
    body = /* @__PURE__ */ jsxs28(Fragment14, { children: [
      banners,
      /* @__PURE__ */ jsx33(ProgressPanel, { progress: job.progress }),
      list(true)
    ] });
    footer = /* @__PURE__ */ jsxs28(Fragment14, { children: [
      /* @__PURE__ */ jsx33(Button19, { variant: "ghost", size: "sm", "data-part": "organize-cancel", loading: cancelling, disabled: cancelling || !job.jobId, onClick: () => void cancel(), children: t("progress.cancel") }),
      /* @__PURE__ */ jsx33(Button19, { variant: "outline", size: "sm", "data-part": "organize-background", onClick: onClose, children: t("progress.background") }),
      pending2.length ? /* @__PURE__ */ jsxs28(Button19, { size: "sm", "data-part": "organize-accept-all", onClick: acceptAll, children: [
        /* @__PURE__ */ jsx33(Codicon23, { name: "check-all", size: 14 }),
        tp("progress.accept_ready", pending2.length)
      ] }) : null
    ] });
  } else {
    const newFolders = groups2.filter((g) => g.isNew).length;
    const folderGroups = groups2.filter((g) => g.kind === "folder").length;
    body = items.length ? /* @__PURE__ */ jsxs28(Fragment14, { children: [
      banners,
      /* @__PURE__ */ jsxs28(Stack, { gap: 1, children: [
        /* @__PURE__ */ jsxs28("p", { className: cx("t-head"), "data-part": "organize-summary", children: [
          tp("review.suggestions", items.length),
          folderGroups ? /* @__PURE__ */ jsxs28(Fragment14, { children: [
            " · ",
            tp("review.folders", folderGroups)
          ] }) : null,
          newFolders ? /* @__PURE__ */ jsxs28(Fragment14, { children: [
            " · ",
            tp("review.new_folders", newFolders)
          ] }) : null,
          suggester && models.length <= 1 ? /* @__PURE__ */ jsxs28("span", { className: cx("sgroup-meta t-label"), children: [
            " · ",
            t("review.by_model", { model: suggester })
          ] }) : null
        ] }),
        pending2.length ? /* @__PURE__ */ jsxs28("p", { className: cx("section-desc t-body"), "data-part": "organize-hint", children: [
          t("review.nothing_changes"),
          " ",
          /* @__PURE__ */ jsx33("span", { className: cx("stat-label t-label"), children: isMac() ? t("review.shortcut_mac") : t("review.shortcut_other") })
        ] }) : null
      ] }),
      list(false),
      !tracked ? /* @__PURE__ */ jsx33(ModelLine, { text: modelText, onChooseModel: chooseModel }) : null
    ] }) : /* @__PURE__ */ jsxs28(Fragment14, { children: [
      banners,
      /* @__PURE__ */ jsx33(
        EmptyView,
        {
          icon: "search",
          title: t("empty.title"),
          description: t("empty.desc"),
          action: /* @__PURE__ */ jsx33(Button19, { variant: "outline", size: "sm", "data-part": "organize-retry", onClick: () => run(lastRun.current), children: t("empty.retry") })
        }
      )
    ] });
    footer = /* @__PURE__ */ jsxs28(Fragment14, { children: [
      items.length && !tracked && !session.length ? /* @__PURE__ */ jsxs28(Button19, { variant: "ghost", size: "sm", "data-part": "organize-again", onClick: () => run(), children: [
        /* @__PURE__ */ jsx33(Codicon23, { name: "refresh", size: 14 }),
        t("review.suggest_again")
      ] }) : null,
      pending2.length ? closeBtn() : null,
      pending2.length ? /* @__PURE__ */ jsxs28(Button19, { size: "sm", "data-part": "organize-accept-all", onClick: acceptAll, children: [
        /* @__PURE__ */ jsx33(Codicon23, { name: "check-all", size: 14 }),
        t("review.accept_all", { count: pending2.length })
      ] }) : /* @__PURE__ */ jsx33(Button19, { size: "sm", "data-part": "organize-done", onClick: onClose, children: t("review.done") })
    ] });
  }
  return /* @__PURE__ */ jsx33(DialogFrame, { title: t("title"), onClose, size: "lg", footer, onEscapeKeyDown: keepOpenOnFieldEscape, children: /* @__PURE__ */ jsx33("div", { ref: rootRef, "data-part": "organize", "data-view": view, onKeyDown, children: /* @__PURE__ */ jsx33(Stack, { gap: 4, children: body }) }) });
}

// desktop-src/dialogs/tab-editor/index.tsx
import { Button as Button21, Codicon as Codicon25, Input as Input4, host as host12 } from "@hermes/plugin-sdk";
import { useCallback as useCallback11, useEffect as useEffect24, useLayoutEffect as useLayoutEffect5, useMemo as useMemo4, useRef as useRef22, useState as useState23 } from "react";

// desktop-src/dialogs/tab-editor/live.ts
import { useCallback as useCallback10, useEffect as useEffect22, useRef as useRef20, useState as useState21 } from "react";

// desktop-src/dialogs/tab-editor/model.ts
var HOME_TAB_KEY = "home.tab";
var PREVIEW_DEBOUNCE_MS = 300;
var PREVIEW_LIMIT = 6;
var NAME_MAX = 40;
var ICON_MAX = 8;
var SHORT_MAX_S = 600;
var LONG_MIN_S = 1200;
var MODES = ["fresh", "long", "classics"];
var NO_KEEP = { themes: [], lenses: [], all: false, favorites: false, excludeFolders: [], excludeTags: [] };
var uniq = (ids) => [...new Set((ids ?? []).filter((x) => typeof x === "string" && x))];
function draftFromPreset(preset) {
  const r = preset?.rules ?? {};
  const name = (preset?.name ?? "").trim();
  return {
    name,
    nameTouched: false,
    icon: "",
    folders: uniq(r.include?.folders),
    tags: uniq(r.include?.tags),
    channels: uniq(r.include?.channels),
    excludeChannels: uniq(r.exclude?.channels),
    noShorts: !!r.exclude?.shorts,
    onlyNew: !!r.filters?.only_new,
    perChannel: r.filters?.per_channel ?? null,
    minS: r.filters?.min_s ?? null,
    maxS: r.filters?.max_s ?? null,
    mode: r.mode ?? "fresh",
    keep: {
      ...NO_KEEP,
      themes: uniq(r.include?.themes),
      lenses: uniq(r.include?.lenses),
      all: !!r.include?.all,
      favorites: !!r.include?.favorites,
      excludeFolders: uniq(r.exclude?.folders),
      excludeTags: uniq(r.exclude?.tags)
    }
  };
}
function draftFromTab(tab) {
  return { ...draftFromPreset({ name: tab.name, rules: tab.rules }), name: tab.name, nameTouched: true, icon: tab.icon ?? "" };
}
function rulesOf(d) {
  return {
    include: {
      folders: [...d.folders],
      tags: [...d.tags],
      channels: [...d.channels],
      themes: [...d.keep.themes],
      lenses: [...d.keep.lenses],
      all: d.keep.all,
      favorites: d.keep.favorites
    },
    exclude: { folders: [...d.keep.excludeFolders], tags: [...d.keep.excludeTags], channels: [...d.excludeChannels], shorts: d.noShorts },
    filters: { only_new: d.onlyNew, per_channel: d.perChannel, min_s: d.minS, max_s: d.maxS },
    mode: d.mode
  };
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value;
    return `{${Object.keys(o).filter((k) => o[k] !== void 0).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
function sameRules(a, b) {
  return canonical(rulesOf(draftFromPreset({ rules: a }))) === canonical(rulesOf(draftFromPreset({ rules: b })));
}
function rulesKey(r) {
  return canonical(r);
}
function hasSource(d) {
  return !!(d.folders.length || d.tags.length || d.channels.length || d.keep.themes.length || d.keep.lenses.length || d.keep.all || d.keep.favorites);
}
function deriveKind(d, original) {
  if (original === "theme" || d.keep.themes.length && !d.folders.length && !d.tags.length && !d.channels.length) return original ?? "theme";
  const cat = d.folders.length + d.tags.length > 0 || d.keep.all || d.keep.favorites;
  const ch = d.channels.length > 0;
  if (cat && ch) return "mixed";
  if (ch) return "channels";
  if (cat) return "category";
  return original ?? "category";
}
function openGroups(kind, d) {
  if (kind === "channels") return ["channels"];
  if (kind === "mixed") return ["folders", "tags", "channels"];
  if (kind === "category") return d.channels.length ? ["folders", "tags", "channels"] : ["folders", "tags"];
  const open = [];
  if (d.folders.length) open.push("folders");
  if (d.tags.length) open.push("tags");
  if (d.channels.length) open.push("channels");
  return open.length ? open : ["folders", "tags", "channels"];
}
function childrenOf(folders) {
  const ids = new Set(folders.map((f) => f.id));
  const map = /* @__PURE__ */ new Map();
  for (const f of folders) {
    const parent = f.parent_id && ids.has(f.parent_id) ? f.parent_id : null;
    const list = map.get(parent) ?? [];
    list.push(f);
    map.set(parent, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  return map;
}
function descendants(folders, id) {
  const kids = childrenOf(folders);
  const out = /* @__PURE__ */ new Set();
  const walk = (p) => {
    for (const c of kids.get(p) ?? []) {
      if (out.has(c.id)) continue;
      out.add(c.id);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}
function ancestors(folders, id) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out = [];
  let cur = byId.get(id)?.parent_id ?? null;
  while (cur && byId.has(cur) && !out.includes(cur)) {
    out.push(cur);
    cur = byId.get(cur)?.parent_id ?? null;
  }
  return out;
}
function coveredBy(selected, id, folders) {
  for (const a of ancestors(folders, id)) if (selected.includes(a)) return a;
  return null;
}
function toggleFolder(selected, id, folders) {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  const cover = coveredBy(selected, id, folders);
  if (cover) {
    const kids = childrenOf(folders);
    const path = [id, ...ancestors(folders, id)];
    const upTo = path.indexOf(cover);
    const replacement = [];
    for (let i = upTo - 1; i >= 0; i--) {
      const node = path[i];
      const parent = path[i + 1];
      for (const sib of kids.get(parent) ?? []) if (sib.id !== node) replacement.push(sib.id);
    }
    const at = selected.indexOf(cover);
    return [...selected.slice(0, at), ...replacement, ...selected.slice(at + 1)];
  }
  const under = descendants(folders, id);
  return [...selected.filter((x) => !under.has(x)), id];
}
function suggestName(labels) {
  const clean = labels.map((l) => l.trim()).filter(Boolean);
  if (!clean.length) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} + ${clean[1]}`;
  return `${clean[0]} + ${clean[1]} +${clean.length - 2}`;
}
function normName(s) {
  return s.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
function nameProblem(name, tabs, selfId) {
  const clean = name.trim();
  if (!clean) return { kind: "empty" };
  if ([...clean].length > NAME_MAX) return { kind: "long" };
  const n = normName(clean);
  const other = (tabs ?? []).find((t) => t.id !== selfId && normName(t.name) === n);
  return other ? { kind: "duplicate", name: other.name } : null;
}
function durationProblem(d) {
  return d.minS != null && d.maxS != null && d.minS > d.maxS;
}
function filterChips(d) {
  const out = [];
  if (d.excludeChannels.length) out.push("exclude");
  if (d.noShorts) out.push("shorts");
  if (d.onlyNew) out.push("only_new");
  if (d.perChannel != null) out.push("per_channel");
  if (d.minS != null || d.maxS != null) out.push("duration");
  if (d.mode !== "fresh") out.push("mode");
  return out;
}
function clearFilter(d, id) {
  switch (id) {
    case "exclude":
      return { ...d, excludeChannels: [] };
    case "shorts":
      return { ...d, noShorts: false };
    case "only_new":
      return { ...d, onlyNew: false };
    case "per_channel":
      return { ...d, perChannel: null };
    case "duration":
      return { ...d, minS: null, maxS: null };
    case "mode":
      return { ...d, mode: "fresh" };
  }
}
function emptySuggestion(d) {
  const order = ["only_new", "duration", "mode", "shorts", "exclude", "per_channel"];
  const on = new Set(filterChips(d));
  return order.find((f) => on.has(f)) ?? null;
}
var ACTIVE = /* @__PURE__ */ new Set(["subscribed", "followed"]);
function isActive(c) {
  return ACTIVE.has(c.relation);
}
function coveredChannels(d, channels, folders) {
  const folderSet = /* @__PURE__ */ new Set();
  for (const f of d.folders) {
    folderSet.add(f);
    for (const x of descendants(folders, f)) folderSet.add(x);
  }
  const tagSet = new Set(d.tags);
  const explicit = new Set(d.channels);
  const excluded = new Set(d.excludeChannels);
  const out = [];
  for (const c of channels) {
    if (excluded.has(c.id)) continue;
    const open = ACTIVE.has(c.relation) && !c.muted;
    const inside = explicit.has(c.id) || open && (d.keep.all || d.keep.favorites && c.favorite || c.folder_id != null && folderSet.has(c.folder_id) || c.tag_ids.some((t) => tagSet.has(t)));
    if (inside) out.push(c);
  }
  return out;
}
function fold(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}
function searchChannels(channels, query, skip, limit) {
  const qf = fold(query);
  const pool2 = channels.filter((c) => !skip.has(c.id));
  if (!qf) {
    return [...pool2].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title)).slice(0, limit);
  }
  const scored = pool2.map((c) => {
    const t = fold(c.title);
    const h = fold(c.handle ?? "");
    const at = t.indexOf(qf);
    const score = at === 0 ? 0 : t.split(/\s+/).some((w) => w.startsWith(qf)) ? 1 : at > 0 ? 2 : h.includes(qf) ? 3 : -1;
    return { c, score };
  }).filter((x) => x.score >= 0);
  scored.sort((a, b) => a.score - b.score || a.c.title.localeCompare(b.c.title));
  return scored.slice(0, limit).map((x) => x.c);
}
function cleanIcon(icon) {
  const v = icon.trim();
  return v ? v : null;
}
function buildCreate(d, name) {
  const icon = cleanIcon(d.icon);
  return { name: name.trim(), kind: deriveKind(d), ...icon ? { icon } : {}, rules: rulesOf(d) };
}
function buildPatch(original, d) {
  const out = {};
  const name = d.name.trim();
  if (name !== original.name) out.name = name;
  const icon = cleanIcon(d.icon);
  if (icon !== (original.icon ?? null)) out.icon = icon;
  const r = rulesOf(d);
  if (!sameRules(r, original.rules)) {
    const kind = deriveKind(d, original.kind);
    if (kind !== original.kind) out.kind = kind;
    out.rules = r;
  }
  return out;
}
function rememberHomeTab(tabId) {
  try {
    maybePluginContext()?.storage?.set(HOME_TAB_KEY, tabId);
  } catch {
  }
}
function changeIdOf(data) {
  const v = data && typeof data === "object" ? data.change_id : null;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// desktop-src/dialogs/tab-editor/live.ts
function useLivePreview(rules) {
  const key = rules ? rulesKey(rules) : null;
  const rulesRef = useRef20(rules);
  rulesRef.current = rules;
  const seq2 = useRef20(0);
  const immediate = useRef20(true);
  const [nonce, setNonce] = useState21(0);
  const [state, setState] = useState21({ page: null, error: null, pending: false });
  useEffect22(() => {
    seq2.current += 1;
    if (!key) {
      setState((s) => s.pending ? { ...s, pending: false } : s);
      return;
    }
    setState((s) => s.pending ? s : { ...s, pending: true });
    const run = () => {
      const current2 = rulesRef.current;
      if (!current2) return;
      const my = ++seq2.current;
      restCall("POST /feed/preview", { body: { rules: current2, limit: PREVIEW_LIMIT } }).then(
        (page) => {
          if (my === seq2.current) setState({ page, error: null, pending: false });
        },
        (error) => {
          if (my === seq2.current) setState((s) => ({ page: s.page, error, pending: false }));
        }
      );
    };
    if (immediate.current) {
      immediate.current = false;
      run();
      return;
    }
    const timer = setTimeout(run, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key, nonce]);
  const retry3 = useCallback10(() => {
    immediate.current = true;
    setNonce((n) => n + 1);
  }, []);
  let status;
  if (!key) status = "idle";
  else if (state.error && !state.pending) status = "error";
  else if (state.page) status = "ready";
  else status = "loading";
  return { status, page: state.page, stale: !!key && state.pending && !!state.page, error: state.error, retry: retry3 };
}

// desktop-src/dialogs/tab-editor/parts.tsx
import { Button as Button20, Codicon as Codicon24, Input as Input3, Switch as Switch2 } from "@hermes/plugin-sdk";
import { useEffect as useEffect23, useMemo as useMemo3, useRef as useRef21, useState as useState22 } from "react";
import { Fragment as Fragment15, jsx as jsx34, jsxs as jsxs29 } from "react/jsx-runtime";
function plural2(t, base, count2, fmt, vars2 = {}) {
  return t(`${base}_${count2 === 1 ? "one" : "other"}`, { ...vars2, count: fmt(count2) });
}
var minutes = (s) => Math.round(s / 60);
function moveFocus(e, selector, horizontal = true) {
  const root = e.currentTarget;
  const items = [...root.querySelectorAll(selector)];
  const i = items.indexOf(e.target);
  if (i < 0) return false;
  const next = e.key === "ArrowDown" || horizontal && e.key === "ArrowRight" ? items[i + 1] : e.key === "ArrowUp" || horizontal && e.key === "ArrowLeft" ? items[i - 1] : e.key === "Home" ? items[0] : e.key === "End" ? items[items.length - 1] : void 0;
  const handled = ["ArrowDown", "ArrowUp", "Home", "End", ...horizontal ? ["ArrowLeft", "ArrowRight"] : []].includes(e.key);
  if (!handled) return false;
  e.preventDefault();
  next?.focus();
  return true;
}
function blurOnEscape(e) {
  if (e.key === "Escape") e.currentTarget.blur();
}
function Group({
  id,
  title,
  summary,
  open,
  onToggle,
  children
}) {
  const bodyId = `te-group-${id}`;
  return /* @__PURE__ */ jsxs29("div", { className: cx("te-group"), "data-part": "te-group", "data-group": id, children: [
    /* @__PURE__ */ jsxs29("button", { type: "button", className: cx("bare te-group-toggle"), "data-part": "te-group-toggle", "aria-expanded": open, "aria-controls": bodyId, onClick: onToggle, children: [
      /* @__PURE__ */ jsx34(Codicon24, { name: "chevron-right", size: 12, className: cx("te-caret") }),
      /* @__PURE__ */ jsx34("span", { className: cx("te-group-title t-head"), children: title }),
      summary ? /* @__PURE__ */ jsx34("span", { className: cx("te-group-sum t-label"), children: summary }) : null
    ] }),
    open ? /* @__PURE__ */ jsx34("div", { id: bodyId, className: cx("te-group-body"), "data-part": "te-group-body", children }) : null
  ] });
}
function FolderTree({ t, folders, selected, onToggle }) {
  const kids = useMemo3(() => childrenOf(folders), [folders]);
  const byId = useMemo3(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const [collapsed, setCollapsed] = useState22(() => /* @__PURE__ */ new Set());
  if (!folders.length) return /* @__PURE__ */ jsx34("p", { className: cx("te-note t-label"), children: t("sources.folders_empty") });
  const level = (parent, depth) => (kids.get(parent) ?? []).map((f) => {
    const cover = selected.includes(f.id) ? null : coveredBy(selected, f.id, folders);
    const state = selected.includes(f.id) ? "checked" : cover ? "covered" : "unchecked";
    const hasKids = (kids.get(f.id) ?? []).length > 0;
    const open = hasKids && !collapsed.has(f.id);
    return /* @__PURE__ */ jsx34(
      TreeItem,
      {
        id: f.id,
        level: depth,
        selected: state !== "unchecked",
        onSelect: () => onToggle(f.id),
        expanded: hasKids ? open : void 0,
        onToggle: hasKids ? () => setCollapsed((c) => {
          const n = new Set(c);
          if (n.has(f.id)) n.delete(f.id);
          else n.add(f.id);
          return n;
        }) : void 0,
        label: /* @__PURE__ */ jsxs29("span", { className: cx("te-folder"), "data-state": state, title: cover ? t("sources.covered", { name: byId.get(cover)?.name ?? "" }) : void 0, children: [
          /* @__PURE__ */ jsx34("span", { className: cx("te-check"), "data-part": "te-check", "data-state": state, "aria-hidden": "true", children: state !== "unchecked" ? /* @__PURE__ */ jsx34(Codicon24, { name: "check", size: 10 }) : null }),
          /* @__PURE__ */ jsx34("span", { className: cx("te-folder-name"), children: f.name })
        ] }),
        children: hasKids ? level(f.id, depth + 1) : null
      },
      f.id
    );
  });
  return /* @__PURE__ */ jsx34("div", { className: cx("te-tree"), children: /* @__PURE__ */ jsx34(Tree, { label: t("sources.folders"), children: level(null, 1) }) });
}
function TagList({ t, tags, selected, onToggle, disabled }) {
  if (!tags.length) return /* @__PURE__ */ jsx34("p", { className: cx("te-note t-label"), children: t("sources.tags_empty") });
  return /* @__PURE__ */ jsx34("div", { className: cx("te-tags"), role: "group", "aria-label": t("sources.tags"), onKeyDown: (e) => moveFocus(e, '[data-part="te-tag"]'), children: tags.map((tag) => {
    const on = selected.includes(tag.id);
    return /* @__PURE__ */ jsxs29(
      "button",
      {
        type: "button",
        className: cx("bare chip t-label te-tag"),
        "data-part": "te-tag",
        "data-id": tag.id,
        "data-active": on ? "true" : void 0,
        "aria-pressed": on,
        disabled,
        onClick: () => onToggle(tag.id),
        children: [
          /* @__PURE__ */ jsx34("span", { className: cx("chip-hash"), "aria-hidden": "true", children: "#" }),
          /* @__PURE__ */ jsx34("span", { className: cx("chip-label"), children: tag.name })
        ]
      },
      tag.id
    );
  }) });
}
function ChannelPicker({ t, which, label, placeholder, chosenLabel, pool: pool2, chosen, resolve, onAdd, onRemove, inputRef, disabled }) {
  const [query, setQuery] = useState22("");
  const ownRef = useRef21(null);
  const ref = inputRef ?? ownRef;
  const listRef = useRef21(null);
  const skip = useMemo3(() => new Set(chosen), [chosen]);
  const options = useMemo3(() => searchChannels(pool2, query, skip, query.trim() ? 8 : 5), [pool2, query, skip]);
  const optionEls = () => [...listRef.current?.querySelectorAll('[data-part="te-picker-option"]') ?? []];
  const add = (id, index) => {
    onAdd(id);
    queueMicrotask(() => {
      const els = optionEls();
      (els[Math.min(index, els.length - 1)] ?? ref.current)?.focus();
    });
  };
  const onSearchKey = (e) => {
    if (e.key === "ArrowDown") {
      const first = optionEls()[0];
      if (first) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === "Escape") {
      if (query) setQuery("");
      else e.currentTarget.blur();
    } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && options.length === 1) {
      e.preventDefault();
      add(options[0].id, 0);
    }
  };
  const onOptionKey = (e) => {
    const els = optionEls();
    const i = els.indexOf(e.target);
    if (i < 0) return;
    if (e.key === "ArrowUp" && i === 0) {
      e.preventDefault();
      ref.current?.focus();
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const id = els[i].getAttribute("data-id");
      if (id) add(id, i);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      ref.current?.focus();
      return;
    }
    moveFocus(e, '[data-part="te-picker-option"]', false);
  };
  const onChosenKey = (e) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      const id = e.target.closest('[data-part="te-picker-chosen"]')?.getAttribute("data-id");
      if (id) {
        e.preventDefault();
        onRemove(id);
        queueMicrotask(() => ref.current?.focus());
      }
      return;
    }
    moveFocus(e, '[data-part="te-picker-remove"]', false);
  };
  return /* @__PURE__ */ jsxs29("div", { className: cx("te-picker"), "data-part": "te-picker", "data-picker": which, children: [
    /* @__PURE__ */ jsxs29("div", { className: cx("te-search"), children: [
      /* @__PURE__ */ jsx34(Codicon24, { name: "search", size: 13, className: cx("te-search-icon") }),
      /* @__PURE__ */ jsx34(
        Input3,
        {
          ref,
          type: "search",
          className: cx("te-search-input"),
          "data-part": "te-picker-search",
          value: query,
          placeholder,
          "aria-label": label,
          autoComplete: "off",
          spellCheck: false,
          disabled,
          onChange: (e) => setQuery(e.target.value),
          onKeyDown: onSearchKey
        }
      )
    ] }),
    options.length ? /* @__PURE__ */ jsxs29(Fragment15, { children: [
      /* @__PURE__ */ jsx34("p", { className: cx("te-list-label t-label"), children: query.trim() ? t("channels.results") : t("channels.suggestions") }),
      /* @__PURE__ */ jsx34("ul", { ref: listRef, className: cx("te-options"), role: "listbox", "aria-label": label, onKeyDown: onOptionKey, children: options.map((c, i) => /* @__PURE__ */ jsx34("li", { role: "presentation", children: /* @__PURE__ */ jsxs29(
        "button",
        {
          type: "button",
          role: "option",
          "aria-selected": false,
          tabIndex: -1,
          className: cx("bare te-option"),
          "data-part": "te-picker-option",
          "data-id": c.id,
          "aria-label": t(which === "include" ? "channels.add" : "channels.leave_out", { name: c.title }),
          disabled,
          onClick: () => add(c.id, i),
          children: [
            /* @__PURE__ */ jsx34(ChannelAvatar, { title: c.title, thumb: c.thumb, size: 24 }),
            /* @__PURE__ */ jsxs29("span", { className: cx("te-option-text"), children: [
              /* @__PURE__ */ jsx34("span", { className: cx("te-option-title t-body"), children: c.title }),
              c.handle ? /* @__PURE__ */ jsx34("span", { className: cx("te-option-sub t-label"), children: c.handle }) : null
            ] }),
            /* @__PURE__ */ jsx34(Codicon24, { name: which === "include" ? "add" : "circle-slash", size: 14, className: cx("te-option-add") })
          ]
        }
      ) }, c.id)) })
    ] }) : query.trim() ? /* @__PURE__ */ jsx34("p", { className: cx("te-note t-label"), "data-part": "te-picker-none", children: t("channels.no_match", { query: query.trim() }) }) : null,
    chosen.length ? /* @__PURE__ */ jsxs29(Fragment15, { children: [
      /* @__PURE__ */ jsx34("p", { className: cx("te-list-label t-label"), children: chosenLabel }),
      /* @__PURE__ */ jsx34("ul", { className: cx("te-chosen"), "aria-label": chosenLabel, onKeyDown: onChosenKey, children: chosen.map((id) => {
        const c = resolve(id);
        const title = c?.title ?? id;
        return /* @__PURE__ */ jsxs29("li", { className: cx("te-chosen-row"), "data-part": "te-picker-chosen", "data-id": id, children: [
          /* @__PURE__ */ jsx34(ChannelAvatar, { title, thumb: c?.thumb, size: 22 }),
          /* @__PURE__ */ jsx34("span", { className: cx("te-option-text"), children: /* @__PURE__ */ jsx34("span", { className: cx("te-option-title t-body"), children: title }) }),
          /* @__PURE__ */ jsx34(
            "button",
            {
              type: "button",
              className: cx("bare te-remove"),
              "data-part": "te-picker-remove",
              "aria-label": t("channels.remove", { name: title }),
              title: t("channels.remove", { name: title }),
              disabled,
              onClick: () => onRemove(id),
              children: /* @__PURE__ */ jsx34(Codicon24, { name: "close", size: 12 })
            }
          )
        ] }, id);
      }) })
    ] }) : null
  ] });
}
function NumberField({
  value,
  onValue,
  part,
  label,
  placeholder,
  disabled,
  min = 0
}) {
  const [text, setText] = useState22(value == null ? "" : String(value));
  useEffect23(() => {
    const parsed = text === "" ? null : Number(text);
    if (parsed !== value) setText(value == null ? "" : String(value));
  }, [value]);
  return /* @__PURE__ */ jsx34(
    Input3,
    {
      type: "text",
      inputMode: "numeric",
      className: cx("te-num"),
      "data-part": part,
      value: text,
      "aria-label": label,
      placeholder,
      disabled,
      onChange: (e) => {
        const v = e.target.value.replace(/\D/g, "").slice(0, 4);
        setText(v);
        if (v === "") onValue(null);
        else if (Number(v) >= min) onValue(Number(v));
      },
      onKeyDown: blurOnEscape
    }
  );
}
function FilterRows({ t, draft, onChange, disabled }) {
  const shortOn = draft.minS == null && draft.maxS === SHORT_MAX_S;
  const longOn = draft.minS === LONG_MIN_S && draft.maxS == null;
  return /* @__PURE__ */ jsxs29("div", { className: cx("te-rows"), children: [
    /* @__PURE__ */ jsxs29("label", { className: cx("te-row"), children: [
      /* @__PURE__ */ jsx34("span", { className: cx("te-row-text"), children: /* @__PURE__ */ jsx34("span", { className: cx("t-body"), children: t("filters.no_shorts") }) }),
      /* @__PURE__ */ jsx34(Switch2, { "data-part": "te-no-shorts", checked: draft.noShorts, disabled, "aria-label": t("filters.no_shorts"), onCheckedChange: (v) => onChange({ noShorts: v }) })
    ] }),
    /* @__PURE__ */ jsxs29("label", { className: cx("te-row"), children: [
      /* @__PURE__ */ jsxs29("span", { className: cx("te-row-text"), children: [
        /* @__PURE__ */ jsx34("span", { className: cx("t-body"), children: t("filters.only_new") }),
        /* @__PURE__ */ jsx34("span", { className: cx("te-row-desc t-label"), children: t("filters.only_new_desc") })
      ] }),
      /* @__PURE__ */ jsx34(Switch2, { "data-part": "te-only-new", checked: draft.onlyNew, disabled, "aria-label": t("filters.only_new"), onCheckedChange: (v) => onChange({ onlyNew: v }) })
    ] }),
    /* @__PURE__ */ jsxs29("div", { className: cx("te-row"), children: [
      /* @__PURE__ */ jsxs29("span", { className: cx("te-row-text"), children: [
        /* @__PURE__ */ jsx34("span", { className: cx("t-body"), children: t("filters.per_channel") }),
        /* @__PURE__ */ jsx34("span", { className: cx("te-row-desc t-label"), children: t("filters.per_channel_desc") })
      ] }),
      /* @__PURE__ */ jsx34(
        NumberField,
        {
          part: "te-per-channel-value",
          value: draft.perChannel,
          min: 1,
          label: t("filters.per_channel_value"),
          placeholder: "3",
          disabled: disabled || draft.perChannel == null,
          onValue: (n) => n != null && onChange({ perChannel: n })
        }
      ),
      /* @__PURE__ */ jsx34(
        Switch2,
        {
          "data-part": "te-per-channel",
          checked: draft.perChannel != null,
          disabled,
          "aria-label": t("filters.per_channel"),
          onCheckedChange: (v) => onChange({ perChannel: v ? 3 : null })
        }
      )
    ] }),
    /* @__PURE__ */ jsxs29("div", { className: cx("te-row"), children: [
      /* @__PURE__ */ jsxs29("span", { className: cx("te-row-text"), children: [
        /* @__PURE__ */ jsx34("span", { className: cx("t-body"), children: t("filters.duration") }),
        /* @__PURE__ */ jsx34("span", { className: cx("te-row-desc t-label"), children: t("filters.duration_desc") })
      ] }),
      /* @__PURE__ */ jsxs29("div", { className: cx("te-duration"), children: [
        /* @__PURE__ */ jsx34(NumberField, { part: "te-min", value: draft.minS == null ? null : minutes(draft.minS), label: t("filters.min"), placeholder: t("filters.min_short"), disabled, onValue: (n) => onChange({ minS: n == null ? null : n * 60 }) }),
        /* @__PURE__ */ jsx34("span", { className: cx("te-dash"), "aria-hidden": "true", children: "–" }),
        /* @__PURE__ */ jsx34(NumberField, { part: "te-max", value: draft.maxS == null ? null : minutes(draft.maxS), label: t("filters.max"), placeholder: t("filters.max_short"), disabled, onValue: (n) => onChange({ maxS: n == null ? null : n * 60 }) })
      ] }),
      /* @__PURE__ */ jsxs29("div", { className: cx("te-duration"), role: "group", "aria-label": t("filters.shortcuts"), children: [
        /* @__PURE__ */ jsx34("button", { type: "button", className: cx("bare chip t-label"), "data-part": "te-short", "data-active": shortOn ? "true" : void 0, "aria-pressed": shortOn, disabled, onClick: () => onChange(shortOn ? { minS: null, maxS: null } : { minS: null, maxS: SHORT_MAX_S }), children: t("filters.short") }),
        /* @__PURE__ */ jsx34("button", { type: "button", className: cx("bare chip t-label"), "data-part": "te-long", "data-active": longOn ? "true" : void 0, "aria-pressed": longOn, disabled, onClick: () => onChange(longOn ? { minS: null, maxS: null } : { minS: LONG_MIN_S, maxS: null }), children: t("filters.long") })
      ] })
    ] }),
    /* @__PURE__ */ jsxs29("div", { className: cx("te-row"), children: [
      /* @__PURE__ */ jsx34("span", { className: cx("te-row-text"), children: /* @__PURE__ */ jsx34("span", { className: cx("t-body"), children: t("filters.mode") }) }),
      /* @__PURE__ */ jsx34("div", { className: cx("te-modes"), role: "group", "aria-label": t("filters.mode"), onKeyDown: (e) => moveFocus(e, '[data-part="te-mode"]'), children: MODES.map((m) => /* @__PURE__ */ jsxs29(
        "button",
        {
          type: "button",
          className: cx("bare te-mode"),
          "data-part": "te-mode",
          "data-mode": m,
          "aria-pressed": draft.mode === m,
          disabled,
          onClick: () => onChange({ mode: m }),
          children: [
            /* @__PURE__ */ jsx34("span", { className: cx("t-body"), children: t(`filters.mode_${m}`) }),
            /* @__PURE__ */ jsx34("span", { className: cx("te-mode-desc t-label"), children: t(`filters.mode_${m}_desc`) })
          ]
        },
        m
      )) })
    ] })
  ] });
}
function chipLabel(t, id, d, fmt, nameOf) {
  switch (id) {
    case "exclude":
      return d.excludeChannels.length === 1 ? t("chips.exclude_one", { name: nameOf(d.excludeChannels[0]) }) : t("chips.exclude_other", { count: fmt(d.excludeChannels.length) });
    case "shorts":
      return t("chips.no_shorts");
    case "only_new":
      return t("chips.only_new");
    case "per_channel":
      return t("chips.per_channel", { count: fmt(d.perChannel ?? 0) });
    case "duration":
      if (d.minS != null && d.maxS != null) return t("chips.range", { min: fmt(minutes(d.minS)), max: fmt(minutes(d.maxS)) });
      if (d.minS != null) return t("chips.min", { min: fmt(minutes(d.minS)) });
      return t("chips.max", { max: fmt(minutes(d.maxS ?? 0)) });
    case "mode":
      return t(`chips.mode_${d.mode}`);
  }
}
function FilterChips({ t, chips, onRemove }) {
  if (!chips.length) return null;
  return /* @__PURE__ */ jsx34("div", { className: cx("te-chips"), "data-part": "te-chips", role: "group", "aria-label": t("chips.label"), children: chips.map((c) => /* @__PURE__ */ jsxs29("span", { className: cx("chip t-label"), "data-part": "te-chip", "data-filter": c.id, "data-active": "true", children: [
    /* @__PURE__ */ jsx34("span", { className: cx("chip-label"), children: c.label }),
    /* @__PURE__ */ jsx34(
      "button",
      {
        type: "button",
        className: cx("bare chip-remove"),
        "data-part": "te-chip-remove",
        "aria-label": t("chips.remove", { label: c.label }),
        title: t("chips.remove", { label: c.label }),
        onClick: () => onRemove(c.id),
        children: /* @__PURE__ */ jsx34(Codicon24, { name: "close", size: 10 })
      }
    )
  ] }, c.id)) });
}
function PreviewPane({
  t,
  live,
  state,
  channels,
  chips,
  onRemoveChip,
  suggestion,
  onClearSuggestion,
  onPickSources
}) {
  const fmt = useFormatCount();
  const page = live.page;
  const items = page?.items ?? [];
  const videos = page?.counts.total ?? items.length;
  const distinct = new Set(items.map((i) => i.video.channel_id)).size;
  const showCounts = state === "ready" || state === "empty";
  let body;
  if (state === "need") {
    body = /* @__PURE__ */ jsx34(
      EmptyView,
      {
        compact: true,
        icon: "layers",
        title: t("preview.need_title"),
        description: t("preview.need_desc"),
        action: /* @__PURE__ */ jsx34(Button20, { variant: "outline", size: "sm", "data-part": "te-empty-action", onClick: onPickSources, children: t("preview.need_action") })
      }
    );
  } else if (state === "invalid") {
    body = /* @__PURE__ */ jsx34(EmptyView, { compact: true, icon: "warning", title: t("preview.invalid_title"), description: t("filters.duration_bad"), action: /* @__PURE__ */ jsx34("span", {}) });
  } else if (state === "loading") {
    body = /* @__PURE__ */ jsx34(GridSkeleton, { density: "compact", count: PREVIEW_LIMIT, label: t("preview.grid_label") });
  } else if (state === "error") {
    body = /* @__PURE__ */ jsx34(ErrorView, { compact: true, error: live.error, title: t("preview.error_title"), onRetry: live.retry });
  } else if (state === "empty") {
    body = suggestion ? /* @__PURE__ */ jsx34(
      EmptyView,
      {
        compact: true,
        icon: "filter",
        title: t("preview.empty_title"),
        description: t("preview.empty_desc", { filter: suggestion.label }),
        action: /* @__PURE__ */ jsx34(Button20, { variant: "outline", size: "sm", "data-part": "te-empty-action", onClick: onClearSuggestion, children: t("preview.empty_action", { filter: suggestion.label }) })
      }
    ) : /* @__PURE__ */ jsx34(
      EmptyView,
      {
        compact: true,
        icon: "inbox",
        title: t("preview.empty_sources_title"),
        description: t("preview.empty_sources_desc"),
        action: /* @__PURE__ */ jsx34(Button20, { variant: "outline", size: "sm", "data-part": "te-empty-action", onClick: onPickSources, children: t("preview.empty_sources_action") })
      }
    );
  } else {
    body = /* @__PURE__ */ jsx34(
      Grid,
      {
        items,
        getKey: (it) => it.video.id,
        label: t("preview.grid_label"),
        density: "compact",
        shortcuts: {},
        renderItem: (it) => /* @__PURE__ */ jsx34(VideoCard, { item: it, variant: "compact" })
      }
    );
  }
  return /* @__PURE__ */ jsxs29("section", { className: cx("te-preview"), "data-part": "te-preview", "data-state": state, "data-stale": live.stale && (state === "ready" || state === "empty") ? "true" : void 0, "aria-busy": state === "loading" || live.stale, children: [
    /* @__PURE__ */ jsxs29("div", { className: cx("te-preview-head"), children: [
      /* @__PURE__ */ jsx34("h3", { className: cx("t-head"), children: t("preview.title") }),
      /* @__PURE__ */ jsx34("span", { className: cx("te-counts t-label"), "data-part": "te-counts", "aria-live": "polite", children: showCounts ? `${plural2(t, "preview.videos", videos, fmt)} · ${plural2(t, "preview.channels", channels ?? distinct, fmt)}` : state === "loading" ? t("preview.loading") : "" })
    ] }),
    /* @__PURE__ */ jsx34(FilterChips, { t, chips, onRemove: onRemoveChip }),
    /* @__PURE__ */ jsx34("div", { className: cx("te-grid"), "data-part": "te-grid", children: body })
  ] });
}
function ConfirmStrip({
  kind,
  title,
  description,
  yes,
  no,
  onYes,
  onNo,
  busy
}) {
  const noRef = useRef21(null);
  useEffect23(() => {
    noRef.current?.focus();
  }, []);
  return /* @__PURE__ */ jsxs29("div", { className: cx("te-confirm"), "data-part": "te-confirm", "data-kind": kind, role: "alertdialog", "aria-label": title, children: [
    /* @__PURE__ */ jsxs29("span", { className: cx("te-confirm-text"), children: [
      /* @__PURE__ */ jsx34("span", { className: cx("t-body"), children: title }),
      description ? /* @__PURE__ */ jsx34("span", { className: cx("te-confirm-desc t-label"), children: description }) : null
    ] }),
    /* @__PURE__ */ jsxs29("div", { className: cx("te-foot-end"), children: [
      /* @__PURE__ */ jsx34(Button20, { ref: noRef, variant: "outline", size: "sm", "data-part": "te-confirm-no", onClick: onNo, children: no }),
      /* @__PURE__ */ jsx34(Button20, { variant: "destructive", size: "sm", "data-part": "te-confirm-yes", loading: busy, disabled: busy, onClick: onYes, children: yes })
    ] })
  ] });
}

// desktop-src/dialogs/tab-editor/styles.ts
var TAB_EDITOR_CSS = `
/* two panes: choices on the left, live preview on the right (the preview sticks to the top while scrolling) */
.PFX_te {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--PFX_s5);
  align-items: start;
  min-width: 0;
}

@container PFX_dialog (min-width: 720px) {
  .PFX_te {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.08fr);
  }

  .PFX_te-side {
    position: sticky;
    top: 0;
  }
}

.PFX_te-main,
.PFX_te-side {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s5);
  min-width: 0;
}

/* --------------------------------------------------------------- fields */

.PFX_te-field {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s1);
  min-width: 0;
}

.PFX_te-label {
  color: var(--ui-text-secondary);
}

.PFX_te-name-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 72px;
  gap: var(--PFX_s3);
  align-items: start;
}

.PFX_te-hint {
  min-height: var(--PFX_lh-label);
  color: var(--PFX_fg3);
}

.PFX_te-hint[data-tone='error'] {
  color: var(--ui-text-primary);
}

.PFX_te-hint-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--PFX_s1) var(--PFX_s2);
}

.PFX_te-icon-input {
  text-align: center;
}

/* --------------------------------------------------------------- sections and groups */

.PFX_te-section {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s2);
  min-width: 0;
}

.PFX_te-section-title {
  color: var(--ui-text-primary);
}

.PFX_te-group {
  border: 1px solid var(--ui-stroke-tertiary);
  border-radius: var(--PFX_r-card);
  min-width: 0;
}

.PFX_te-group + .PFX_te-group {
  margin-top: calc(-1 * var(--PFX_s1));
}

.PFX_te-group-toggle {
  display: flex;
  align-items: center;
  gap: var(--PFX_s2);
  width: 100%;
  min-height: 36px;
  padding: 0 var(--PFX_s3);
  border-radius: var(--PFX_r-card);
  color: var(--ui-text-primary);
  text-align: left;
}

.PFX_te-group-toggle:hover {
  background: var(--ui-row-hover-background);
}

.PFX_te-group-toggle:focus-visible {
  outline: 2px solid var(--PFX_ring);
  outline-offset: -2px;
}

.PFX_te-caret {
  flex: none;
  color: var(--PFX_fg3);
  transition: transform var(--PFX_dur) var(--PFX_ease);
}

.PFX_te-group-toggle[aria-expanded='true'] .PFX_te-caret {
  transform: rotate(90deg);
}

.PFX_te-group-title {
  flex: 1 1 auto;
  min-width: 0;
}

.PFX_te-group-sum {
  flex: none;
  color: var(--PFX_fg3);
  font-variant-numeric: tabular-nums;
}

.PFX_te-group-body {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s2);
  padding: 0 var(--PFX_s3) var(--PFX_s3);
  min-width: 0;
}

.PFX_te-note {
  color: var(--PFX_fg3);
}

/* folder tree with checkboxes (the box is drawing; the tree item does the checking) */
.PFX_te-tree {
  max-height: 248px;
  overflow: auto;
  margin: 0 calc(-1 * var(--PFX_s1));
}

.PFX_te-check {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 14px;
  height: 14px;
  margin-right: var(--PFX_s2);
  border: 1px solid var(--ui-stroke-secondary);
  border-radius: 3px;
  background: var(--ui-bg-editor);
  color: var(--ui-bg-editor);
  vertical-align: -2px;
}

.PFX_te-check[data-state='checked'] {
  border-color: var(--ui-text-primary);
  background: var(--ui-text-primary);
}

.PFX_te-check[data-state='covered'] {
  border-color: color-mix(in srgb, var(--ui-text-primary) 40%, transparent);
  background: color-mix(in srgb, var(--ui-text-primary) 40%, transparent);
}

.PFX_te-folder {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.PFX_te-folder-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.PFX_te-folder[data-state='covered'] .PFX_te-folder-name {
  color: var(--ui-text-secondary);
}

/* tags: kit chips that toggle */
.PFX_te-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--PFX_s2);
}

.PFX_te-tag:focus-visible {
  outline: 2px solid var(--PFX_ring);
  outline-offset: 1px;
}

/* --------------------------------------------------------------- channel search */

.PFX_te-picker {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s2);
  min-width: 0;
}

.PFX_te-search {
  position: relative;
  min-width: 0;
}

.PFX_te-search-icon {
  position: absolute;
  top: 50%;
  left: 9px;
  transform: translateY(-50%);
  color: var(--PFX_fg3);
  pointer-events: none;
}

.PFX_te-search-input {
  padding-left: 28px;
}

.PFX_te-list-label {
  color: var(--PFX_fg3);
}

.PFX_te-options,
.PFX_te-chosen {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.PFX_te-option,
.PFX_te-chosen-row {
  display: flex;
  align-items: center;
  gap: var(--PFX_s2);
  width: 100%;
  min-height: 32px;
  padding: 2px var(--PFX_s2);
  border-radius: var(--PFX_r-control);
  color: var(--ui-text-primary);
  text-align: left;
}

.PFX_te-option:hover,
.PFX_te-option:focus-visible {
  background: var(--ui-row-hover-background);
}

.PFX_te-option:focus-visible,
.PFX_te-remove:focus-visible {
  outline: 2px solid var(--PFX_ring);
  outline-offset: -2px;
}

/* a single row: name and @handle side by side (the action icon sits in the middle of the row) */
.PFX_te-option-text {
  display: flex;
  flex: 1 1 auto;
  align-items: baseline;
  gap: var(--PFX_s2);
  min-width: 0;
}

.PFX_te-option-title {
  flex: 0 1 auto;
}

.PFX_te-option-sub {
  flex: 1 1 0;
}

.PFX_te-option-title,
.PFX_te-option-sub {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.PFX_te-option-sub {
  color: var(--PFX_fg3);
}

.PFX_te-option-add {
  flex: none;
  color: var(--PFX_fg3);
}

.PFX_te-chosen-row {
  border: 1px solid var(--ui-stroke-quaternary);
}

.PFX_te-chosen-row + .PFX_te-chosen-row {
  margin-top: var(--PFX_s1);
}

.PFX_te-remove {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  color: var(--PFX_fg3);
}

.PFX_te-remove:hover {
  background: var(--ui-control-hover-background);
  color: var(--ui-text-primary);
}

/* --------------------------------------------------------------- filters */

.PFX_te-rows {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ui-stroke-tertiary);
  border-radius: var(--PFX_r-card);
  min-width: 0;
}

.PFX_te-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--PFX_s2) var(--PFX_s3);
  min-height: 40px;
  padding: var(--PFX_s2) var(--PFX_s3);
  min-width: 0;
}

.PFX_te-row + .PFX_te-row {
  border-top: 1px solid var(--ui-stroke-quaternary);
}

.PFX_te-row-text {
  display: flex;
  flex: 1 1 160px;
  flex-direction: column;
  min-width: 0;
}

.PFX_te-row-desc {
  color: var(--PFX_fg3);
}

.PFX_te-num {
  width: 72px;
  font-variant-numeric: tabular-nums;
}

.PFX_te-duration {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--PFX_s2);
}

.PFX_te-dash {
  color: var(--ui-text-quaternary);
}

.PFX_te-modes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--PFX_s2);
  width: 100%;
}

.PFX_te-mode {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--PFX_s2) var(--PFX_s3);
  border: 1px solid var(--ui-stroke-tertiary);
  border-radius: var(--PFX_r-control);
  color: var(--ui-text-secondary);
  text-align: left;
  transition:
    border-color var(--PFX_dur) var(--PFX_ease),
    background-color var(--PFX_dur) var(--PFX_ease);
}

.PFX_te-mode:hover {
  border-color: var(--ui-stroke-secondary);
  background: var(--ui-bg-quinary);
}

.PFX_te-mode[aria-pressed='true'] {
  border-color: var(--ui-text-quaternary);
  background: var(--ui-bg-quaternary);
  color: var(--ui-text-primary);
}

.PFX_te-mode:focus-visible {
  outline: 2px solid var(--PFX_ring);
  outline-offset: 1px;
}

.PFX_te-mode-desc {
  color: var(--PFX_fg3);
}

/* --------------------------------------------------------------- preview */

.PFX_te-preview {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s3);
  min-width: 0;
  padding: var(--PFX_s3);
  border: 1px solid var(--ui-stroke-tertiary);
  border-radius: var(--PFX_r-card);
  background: color-mix(in srgb, var(--ui-bg-quinary) 60%, transparent);
}

.PFX_te-preview-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--PFX_s1) var(--PFX_s3);
}

.PFX_te-counts {
  color: var(--ui-text-secondary);
  font-variant-numeric: tabular-nums;
}

.PFX_te-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--PFX_s1) var(--PFX_s2);
}

.PFX_te-chips .PFX_chip {
  max-width: 16rem;
}

.PFX_te-grid {
  min-width: 0;
  transition: opacity var(--PFX_dur-slow) var(--PFX_ease);
}

.PFX_te-preview[data-stale='true'] .PFX_te-grid {
  opacity: 0.45;
}

/* --------------------------------------------------------------- footer */

.PFX_te-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--PFX_s2);
  width: 100%;
}

.PFX_te-foot-status {
  flex: 1 1 180px;
  min-width: 0;
  color: var(--PFX_fg3);
}

.PFX_te-foot-status[data-tone='warn'] {
  color: var(--ui-text-secondary);
}

.PFX_te-error {
  display: flex;
  align-items: flex-start;
  gap: var(--PFX_s2);
  color: var(--ui-text-primary);
}

.PFX_te-error-icon {
  flex: none;
  margin-top: 1px;
  color: var(--ui-red);
}

.PFX_te-foot-end {
  display: flex;
  flex-wrap: wrap;
  gap: var(--PFX_s2);
  margin-left: auto;
}

.PFX_te-confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--PFX_s2) var(--PFX_s3);
  width: 100%;
}

.PFX_te-confirm-text {
  display: flex;
  flex: 1 1 220px;
  flex-direction: column;
  min-width: 0;
}

.PFX_te-confirm-desc {
  color: var(--PFX_fg3);
}

@media (prefers-reduced-motion: reduce) {
  .PFX_te-caret,
  .PFX_te-mode,
  .PFX_te-grid {
    transition: none;
  }
}
`;
var TAB_EDITOR_STYLE_ATTR = `data-${CLASS_PREFIX}tab-editor-styles`;
var ownerCtx2 = null;
var tokenSeq3 = 0;
onShellReset(() => {
  ownerCtx2 = null;
});
function ensureTabEditorStyles(doc = globalThis.document) {
  if (!doc?.head) return;
  const found = [...doc.head.querySelectorAll(`style[${TAB_EDITOR_STYLE_ATTR}]`)];
  for (const extra of found.slice(1)) extra.remove();
  let el = found[0];
  if (!el) {
    el = doc.createElement("style");
    el.setAttribute(TAB_EDITOR_STYLE_ATTR, "");
    doc.head.appendChild(el);
  }
  const css = resolveCss(TAB_EDITOR_CSS);
  if (el.textContent !== css) el.textContent = css;
  const ctx = maybePluginContext();
  if (ctx && (ownerCtx2 !== ctx || el.getAttribute(TAB_EDITOR_STYLE_ATTR) === "")) {
    ownerCtx2 = ctx;
    const token = `${Date.now().toString(36)}-${++tokenSeq3}`;
    el.setAttribute(TAB_EDITOR_STYLE_ATTR, token);
    const style = el;
    ctx.onDispose(() => {
      if (style.isConnected && style.getAttribute(TAB_EDITOR_STYLE_ATTR) === token) style.remove();
    });
  }
}

// desktop-src/dialogs/tab-editor/index.tsx
import { Fragment as Fragment16, jsx as jsx35, jsxs as jsxs30 } from "react/jsx-runtime";
var CHANGED = ["GET /tabs", "GET /status", "GET /feed"];
var withSeed = (d, seed) => seed ? { ...d, ...seed, keep: { ...d.keep, ...seed.keep } } : d;
var FIRST_SOURCE = '[role="treeitem"][tabindex="0"], [data-part="te-tag"], [data-part="te-picker-search"]';
function TabEditorDialog({ tabId, preset, onClose, initial }) {
  const t = useT("tab-editor");
  const tc2 = useT();
  const fmt = useFormatCount();
  useLayoutEffect5(() => ensureTabEditorStyles(), []);
  const editing = !!tabId;
  const tabsQ = useRest("GET /tabs", {});
  const foldersQ = useRest("GET /folders", {});
  const tagsQ = useRest("GET /tags", {});
  const channelsQ = useRest("GET /channels", { query: { limit: 2e3 } });
  const tabs = tabsQ.data?.items;
  const original = editing ? tabs?.find((x) => x.id === tabId) ?? null : null;
  const missing = editing && !!tabs && !original;
  const builtin = !!original?.builtin;
  const folders = useMemo4(() => foldersQ.data?.items ?? [], [foldersQ.data]);
  const tags = useMemo4(() => tagsQ.data?.items ?? [], [tagsQ.data]);
  const [draft, setDraft] = useState23(() => editing ? null : withSeed(draftFromPreset(preset), initial?.draft));
  const baseline = useRef22(editing ? null : draftFromPreset(preset));
  const [open, setOpen] = useState23(() => new Set(editing ? [] : openGroups(preset?.kind, draft ?? draftFromPreset(preset))));
  useEffect24(() => {
    if (!editing || !original || draft) return;
    const d = draftFromTab(original);
    baseline.current = d;
    setDraft(withSeed(d, initial?.draft));
    setOpen(new Set(openGroups(void 0, d)));
  }, [editing, original, draft, initial]);
  const change = useCallback11((patch3) => setDraft((d) => d ? { ...d, ...patch3 } : d), []);
  const listed = useMemo4(() => (channelsQ.data?.items ?? []).map((r) => r.channel), [channelsQ.data]);
  const listedIds = useMemo4(() => new Set(listed.map((c) => c.id)), [listed]);
  const outside = draft ? [...draft.channels, ...draft.excludeChannels].filter((id) => !listedIds.has(id)) : [];
  const extraQ = useRest("GET /channels", { query: { ids: outside.join(","), limit: 200 } }, { enabled: !!channelsQ.data && outside.length > 0 });
  const allChannels = useMemo4(() => {
    const extra = (extraQ.data?.items ?? []).map((r) => r.channel).filter((c) => !listedIds.has(c.id));
    return [...listed, ...extra];
  }, [listed, listedIds, extraQ.data]);
  const byChannel = useMemo4(() => new Map(allChannels.map((c) => [c.id, c])), [allChannels]);
  const activeChannels2 = useMemo4(() => listed.filter(isActive), [listed]);
  const resolve = useCallback11((id) => byChannel.get(id), [byChannel]);
  const labels = useMemo4(() => {
    if (!draft) return [];
    const fById = new Map(folders.map((f) => [f.id, f.name]));
    const tById = new Map(tags.map((x) => [x.id, x.name]));
    return [
      ...draft.folders.map((id) => fById.get(id)),
      ...draft.tags.map((id) => tById.get(id)),
      ...draft.channels.map((id) => byChannel.get(id)?.title)
    ].filter((x) => !!x);
  }, [draft, folders, tags, byChannel]);
  const suggestion = suggestName(labels) || (preset?.name ?? "").trim();
  const nameValue = draft ? draft.nameTouched ? draft.name : suggestion || draft.name : "";
  const nameProb = draft ? nameProblem(nameValue, tabs, tabId) : null;
  const noSource = !!draft && !hasSource(draft);
  const durBad = !!draft && durationProblem(draft);
  const rules = draft ? rulesOf(draft) : null;
  const live = useLivePreview(draft && !noSource && !durBad ? rules : null);
  const effective = draft ? { ...draft, name: nameValue } : null;
  const patch2 = original && effective ? buildPatch(original, effective) : null;
  const dirty = (() => {
    if (!draft) return false;
    if (editing) return !!patch2 && Object.keys(patch2).length > 0;
    const base = baseline.current ?? draftFromPreset(preset);
    return rulesKey(rulesOf(draft)) !== rulesKey(rulesOf(base)) || draft.icon.trim() !== "" || draft.nameTouched && draft.name.trim() !== (preset?.name ?? "").trim() && draft.name.trim() !== suggestion;
  })();
  const [saving, setSaving] = useState23(false);
  const [deleting, setDeleting] = useState23(false);
  const [saveError, setSaveError] = useState23(initial?.saveError ?? null);
  const [confirm, setConfirm] = useState23(initial?.confirm ?? null);
  const canSave = !!draft && !missing && !noSource && !durBad && !nameProb && !saving && !deleting && (!editing || dirty);
  const rootRef = useRef22(null);
  const sourcesRef = useRef22(null);
  const includeSearch = useRef22(null);
  useEffect24(() => {
    if (!editing && preset?.kind === "channels") includeSearch.current?.focus();
  }, []);
  const focusSources = useCallback11(() => {
    const rootEl = rootRef.current;
    if (!rootEl) return;
    if (builtin) {
      rootEl.querySelector('[data-part="te-no-shorts"]')?.focus();
      return;
    }
    const box = sourcesRef.current;
    const first = box?.querySelector(`[data-part="te-group-body"] :is(${FIRST_SOURCE})`);
    if (first) {
      first.focus();
      return;
    }
    if (open.size === 0) setOpen(/* @__PURE__ */ new Set(["folders"]));
    box?.querySelector('[data-part="te-group-toggle"]')?.focus();
  }, [builtin, open]);
  const undoAction = useCallback11(
    (changeId, name) => changeId == null ? {} : {
      action: {
        label: t("toast.undo"),
        onClick: () => {
          restCall("POST /changes/{id}/undo", { path: { id: changeId } }).then(
            () => {
              void invalidateRest(...CHANGED);
              host12.notify({ kind: "success", message: t("toast.undone", { name }) });
            },
            (error) => host12.notify({ kind: "error", message: t("toast.undo_failed", { error: errorText(tc2, toApiError(error)) }) })
          );
        }
      }
    },
    [t, tc2]
  );
  const save = useCallback11(async () => {
    if (!canSave || !draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editing && original) {
        const body2 = buildPatch(original, { ...draft, name: nameValue });
        const saved = await restCall("PATCH /tabs/{id}", { path: { id: original.id }, body: body2 });
        void invalidateRest(...CHANGED);
        const name = saved?.name ?? nameValue.trim();
        host12.notify({ kind: "success", message: t("toast.saved", { name }), ...undoAction(changeIdOf(saved), name) });
        onClose();
      } else {
        const created = await restCall("POST /tabs", { body: buildCreate(draft, nameValue) });
        const name = created?.name ?? nameValue.trim();
        if (created?.id) rememberHomeTab(created.id);
        void invalidateRest(...CHANGED);
        openSection("home");
        host12.notify({ kind: "success", message: t("toast.created", { name }), ...undoAction(changeIdOf(created), name) });
        onClose();
      }
    } catch (error) {
      setSaveError(toApiError(error));
      setSaving(false);
    }
  }, [canSave, draft, editing, original, nameValue, onClose, t, undoAction]);
  const remove = useCallback11(async () => {
    if (!original || original.builtin) return;
    setDeleting(true);
    setSaveError(null);
    try {
      const out = await restCall("DELETE /tabs/{id}", { path: { id: original.id } });
      void invalidateRest(...CHANGED);
      host12.notify({ kind: "success", message: t("toast.deleted", { name: original.name }), ...undoAction(changeIdOf(out), original.name) });
      onClose();
    } catch (error) {
      setDeleting(false);
      setConfirm(null);
      setSaveError(toApiError(error));
    }
  }, [original, onClose, t, undoAction]);
  const requestClose = useCallback11(() => {
    if (saving || deleting) return;
    if (dirty) setConfirm("discard");
    else onClose();
  }, [saving, deleting, dirty, onClose]);
  const onEscapeKeyDown = useCallback11((e) => {
    const target = e.target instanceof Element ? e.target : typeof document !== "undefined" ? document.activeElement : null;
    if (target && rootRef.current?.contains(target) && target.closest('input, textarea, [role="listbox"]')) e.preventDefault();
  }, []);
  const onRootKey = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    }
  };
  const chips = draft ? filterChips(draft).map((id) => ({ id, label: chipLabel(t, id, draft, fmt, (cid) => byChannel.get(cid)?.title ?? cid) })) : [];
  const suggestionId = draft ? emptySuggestion(draft) : null;
  const suggestionChip = suggestionId ? chips.find((c) => c.id === suggestionId) ?? null : null;
  const covered = draft && channelsQ.data ? coveredChannels(draft, allChannels, folders) : null;
  let previewState;
  if (!draft || noSource) previewState = "need";
  else if (durBad) previewState = "invalid";
  else if (live.status === "idle") previewState = "need";
  else if (live.status === "loading") previewState = "loading";
  else if (live.status === "error") previewState = "error";
  else previewState = live.page && live.page.items.length ? "ready" : "empty";
  const statusText = noSource ? t("sources.need") : durBad ? t("filters.duration_bad") : editing ? dirty ? t("footer.unsaved") : t("footer.no_changes") : t("footer.hint");
  const statusTone = noSource || durBad || editing && dirty ? "warn" : void 0;
  const title = editing ? original ? t("title_edit", { name: original.name }) : t("title_edit_loading") : t("title_create");
  const description = missing ? void 0 : editing ? builtin ? t("subtitle_builtin") : t("subtitle_edit") : t("subtitle_create");
  let body;
  let footer;
  const cancelButton = /* @__PURE__ */ jsx35(Button21, { variant: "outline", size: "sm", "data-part": "te-cancel", onClick: requestClose, children: t("footer.cancel") });
  if (missing) {
    body = /* @__PURE__ */ jsx35("div", { "data-part": "tab-editor", "data-mode": "edit", children: /* @__PURE__ */ jsx35("div", { "data-part": "te-missing", children: /* @__PURE__ */ jsx35(
      EmptyView,
      {
        icon: "search",
        title: t("load.missing_title"),
        description: t("load.missing_desc"),
        action: /* @__PURE__ */ jsx35(Button21, { variant: "outline", size: "sm", onClick: onClose, children: t("load.close") })
      }
    ) }) });
    footer = null;
  } else if (!draft) {
    body = /* @__PURE__ */ jsx35(EditorSkeleton, { t });
    footer = /* @__PURE__ */ jsx35("div", { className: cx("te-foot"), children: /* @__PURE__ */ jsx35("div", { className: cx("te-foot-end"), children: cancelButton }) });
  } else {
    const toggleGroup = (g) => setOpen((s) => {
      const n = new Set(s);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });
    const chosenSum = (n) => n ? plural2(t, "sources.chosen", n, fmt) : t("sources.none");
    const excludePool = coveredChannels({ ...draft, excludeChannels: [] }, allChannels, folders);
    body = /* @__PURE__ */ jsxs30("div", { ref: rootRef, className: cx("te"), "data-part": "tab-editor", "data-mode": editing ? "edit" : "create", "data-builtin": builtin ? "true" : void 0, onKeyDown: onRootKey, children: [
      /* @__PURE__ */ jsxs30("div", { className: cx("te-main"), children: [
        /* @__PURE__ */ jsxs30("div", { className: cx("te-name-row"), children: [
          /* @__PURE__ */ jsxs30("div", { className: cx("te-field"), children: [
            /* @__PURE__ */ jsx35("label", { className: cx("te-label t-label"), htmlFor: "te-name", children: t("name.label") }),
            /* @__PURE__ */ jsx35(
              Input4,
              {
                id: "te-name",
                "data-part": "te-name",
                value: nameValue,
                placeholder: t("name.placeholder"),
                maxLength: NAME_MAX + 20,
                autoComplete: "off",
                disabled: builtin || saving,
                "aria-invalid": nameProb && nameProb.kind !== "empty" ? true : void 0,
                "aria-describedby": "te-name-hint",
                onChange: (e) => change({ name: e.target.value, nameTouched: true }),
                onKeyDown: (e) => {
                  if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    focusSources();
                  } else if (e.key === "Escape") e.currentTarget.blur();
                }
              }
            ),
            /* @__PURE__ */ jsxs30("div", { className: cx("te-hint-row"), children: [
              /* @__PURE__ */ jsx35("p", { id: "te-name-hint", className: cx("te-hint t-label"), "data-part": "te-name-hint", "data-tone": nameProb ? "error" : void 0, role: nameProb && nameProb.kind !== "empty" ? "alert" : void 0, children: nameProb?.kind === "duplicate" ? t("name.duplicate", { name: nameProb.name }) : nameProb?.kind === "long" ? t("name.long", { max: fmt(NAME_MAX) }) : nameProb?.kind === "empty" ? suggestion ? t("name.empty") : t("name.empty_no_suggestion") : builtin ? t("name.builtin") : !draft.nameTouched && suggestion ? t("name.suggested") : "" }),
              nameProb?.kind === "empty" && suggestion ? /* @__PURE__ */ jsx35(Button21, { variant: "ghost", size: "xs", "data-part": "te-name-use", onClick: () => change({ name: suggestion, nameTouched: true }), children: t("name.use", { name: suggestion }) }) : null
            ] })
          ] }),
          /* @__PURE__ */ jsxs30("div", { className: cx("te-field"), children: [
            /* @__PURE__ */ jsx35("label", { className: cx("te-label t-label"), htmlFor: "te-icon", children: t("icon.label") }),
            /* @__PURE__ */ jsx35(
              Input4,
              {
                id: "te-icon",
                className: cx("te-icon-input"),
                "data-part": "te-icon",
                value: draft.icon,
                placeholder: t("icon.placeholder"),
                maxLength: ICON_MAX,
                autoComplete: "off",
                disabled: builtin || saving,
                "aria-describedby": "te-icon-hint",
                onChange: (e) => change({ icon: e.target.value }),
                onKeyDown: (e) => {
                  if (e.key === "Escape") e.currentTarget.blur();
                }
              }
            ),
            /* @__PURE__ */ jsx35("p", { id: "te-icon-hint", className: cx("te-hint t-label"), children: t("icon.hint") })
          ] })
        ] }),
        /* @__PURE__ */ jsxs30("section", { ref: sourcesRef, className: cx("te-section"), "data-part": "te-sources", "aria-labelledby": "te-sources-title", children: [
          /* @__PURE__ */ jsx35("h3", { id: "te-sources-title", className: cx("te-section-title t-head"), children: t("sources.title") }),
          builtin ? /* @__PURE__ */ jsx35("p", { className: cx("te-note t-body"), "data-part": "te-builtin-note", children: t(original?.rules.include.favorites ? "sources.builtin_favorites" : "sources.builtin_all") }) : /* @__PURE__ */ jsxs30(Fragment16, { children: [
            /* @__PURE__ */ jsx35("p", { className: cx("te-note t-label"), children: t("sources.desc") }),
            /* @__PURE__ */ jsx35(Group, { id: "folders", title: t("sources.folders"), summary: chosenSum(draft.folders.length), open: open.has("folders"), onToggle: () => toggleGroup("folders"), children: /* @__PURE__ */ jsx35(FolderTree, { t, folders, selected: draft.folders, onToggle: (id) => change({ folders: toggleFolder(draft.folders, id, folders) }) }) }),
            /* @__PURE__ */ jsx35(Group, { id: "tags", title: t("sources.tags"), summary: chosenSum(draft.tags.length), open: open.has("tags"), onToggle: () => toggleGroup("tags"), children: /* @__PURE__ */ jsx35(
              TagList,
              {
                t,
                tags,
                selected: draft.tags,
                onToggle: (id) => change({ tags: draft.tags.includes(id) ? draft.tags.filter((x) => x !== id) : [...draft.tags, id] })
              }
            ) }),
            /* @__PURE__ */ jsx35(Group, { id: "channels", title: t("sources.channels"), summary: chosenSum(draft.channels.length), open: open.has("channels"), onToggle: () => toggleGroup("channels"), children: /* @__PURE__ */ jsx35(
              ChannelPicker,
              {
                t,
                which: "include",
                label: t("channels.search"),
                placeholder: t("channels.search_placeholder"),
                chosenLabel: t("channels.chosen"),
                pool: activeChannels2,
                chosen: draft.channels,
                resolve,
                inputRef: includeSearch,
                onAdd: (id) => setDraft((d) => d && !d.channels.includes(id) ? { ...d, channels: [...d.channels, id], excludeChannels: d.excludeChannels.filter((x) => x !== id) } : d),
                onRemove: (id) => setDraft((d) => d ? { ...d, channels: d.channels.filter((x) => x !== id) } : d)
              }
            ) })
          ] })
        ] }),
        /* @__PURE__ */ jsxs30("section", { className: cx("te-section"), "data-part": "te-filters", "aria-labelledby": "te-filters-title", children: [
          /* @__PURE__ */ jsx35("h3", { id: "te-filters-title", className: cx("te-section-title t-head"), children: t("filters.title") }),
          /* @__PURE__ */ jsxs30("div", { className: cx("te-field"), children: [
            /* @__PURE__ */ jsx35("span", { className: cx("te-label t-label"), children: t("filters.exclude") }),
            /* @__PURE__ */ jsx35(
              ChannelPicker,
              {
                t,
                which: "exclude",
                label: t("filters.exclude"),
                placeholder: t("filters.exclude_placeholder"),
                chosenLabel: t("filters.excluded"),
                pool: excludePool,
                chosen: draft.excludeChannels,
                resolve,
                onAdd: (id) => setDraft((d) => d && !d.excludeChannels.includes(id) ? { ...d, excludeChannels: [...d.excludeChannels, id], channels: d.channels.filter((x) => x !== id) } : d),
                onRemove: (id) => setDraft((d) => d ? { ...d, excludeChannels: d.excludeChannels.filter((x) => x !== id) } : d)
              }
            )
          ] }),
          /* @__PURE__ */ jsx35(FilterRows, { t, draft, onChange: change, disabled: saving })
        ] })
      ] }),
      /* @__PURE__ */ jsx35("div", { className: cx("te-side"), children: /* @__PURE__ */ jsx35(
        PreviewPane,
        {
          t,
          live,
          state: previewState,
          channels: covered ? covered.length : null,
          chips,
          onRemoveChip: (id) => setDraft((d) => d ? clearFilter(d, id) : d),
          suggestion: suggestionChip,
          onClearSuggestion: () => suggestionId && setDraft((d) => d ? clearFilter(d, suggestionId) : d),
          onPickSources: focusSources
        }
      ) })
    ] });
    if (confirm === "discard") {
      footer = /* @__PURE__ */ jsx35(ConfirmStrip, { kind: "discard", title: t("confirm.discard_title"), description: t("confirm.discard_desc"), yes: t("confirm.discard"), no: t("confirm.keep"), onYes: onClose, onNo: () => setConfirm(null) });
    } else if (confirm === "delete" && original) {
      footer = /* @__PURE__ */ jsx35(
        ConfirmStrip,
        {
          kind: "delete",
          title: t("confirm.delete_title", { name: original.name }),
          description: t("confirm.delete_desc"),
          yes: t("confirm.delete"),
          no: t("confirm.not_now"),
          busy: deleting,
          onYes: () => void remove(),
          onNo: () => setConfirm(null)
        }
      );
    } else {
      footer = /* @__PURE__ */ jsxs30("div", { className: cx("te-foot"), children: [
        editing && original && !builtin ? /* @__PURE__ */ jsxs30(Button21, { variant: "ghost", size: "sm", "data-part": "te-delete", disabled: saving, onClick: () => setConfirm("delete"), children: [
          /* @__PURE__ */ jsx35(Codicon25, { name: "trash", size: 13 }),
          t("footer.delete")
        ] }) : null,
        saveError ? /* @__PURE__ */ jsxs30("p", { className: cx("te-foot-status te-error t-label"), "data-part": "te-error", role: "alert", children: [
          /* @__PURE__ */ jsx35(Codicon25, { name: "error", size: 13, className: cx("te-error-icon") }),
          /* @__PURE__ */ jsx35("span", { children: t("footer.error", { error: saveErrorText(tc2, saveError) }) })
        ] }) : /* @__PURE__ */ jsx35("p", { className: cx("te-foot-status t-label"), "data-part": "te-status", "data-tone": statusTone, "aria-live": "polite", children: statusText }),
        /* @__PURE__ */ jsxs30("div", { className: cx("te-foot-end"), children: [
          cancelButton,
          /* @__PURE__ */ jsx35(Button21, { size: "sm", "data-part": "te-primary", disabled: !canSave, loading: saving, title: t("footer.shortcut"), onClick: () => void save(), children: saving ? t("footer.saving") : editing ? t("footer.save") : t("footer.create") })
        ] })
      ] });
    }
  }
  return /* @__PURE__ */ jsx35(DialogFrame, { title, description, onClose: requestClose, size: "xl", footer, onEscapeKeyDown, children: body });
}
var DETAILED_CODES = /* @__PURE__ */ new Set(["invalid", "conflict"]);
function saveErrorText(tc2, error) {
  const text = errorText(tc2, error);
  if (!DETAILED_CODES.has(error.code)) return text;
  return error.message && text !== error.message ? `${text} (${error.message})` : text;
}
function EditorSkeleton({ t }) {
  return /* @__PURE__ */ jsxs30("div", { className: cx("te"), "data-part": "tab-editor", "data-mode": "edit", "aria-busy": "true", children: [
    /* @__PURE__ */ jsxs30("div", { className: cx("te-main"), children: [
      /* @__PURE__ */ jsxs30("div", { className: cx("te-name-row"), children: [
        /* @__PURE__ */ jsxs30("div", { className: cx("te-field"), children: [
          /* @__PURE__ */ jsx35("span", { className: cx("te-label t-label"), children: t("name.label") }),
          /* @__PURE__ */ jsx35(Input4, { value: "", disabled: true, readOnly: true, "aria-busy": "true", "aria-label": t("name.label") })
        ] }),
        /* @__PURE__ */ jsxs30("div", { className: cx("te-field"), children: [
          /* @__PURE__ */ jsx35("span", { className: cx("te-label t-label"), children: t("icon.label") }),
          /* @__PURE__ */ jsx35(Input4, { value: "", disabled: true, readOnly: true, "aria-busy": "true", "aria-label": t("icon.label") })
        ] })
      ] }),
      /* @__PURE__ */ jsxs30("section", { className: cx("te-section"), children: [
        /* @__PURE__ */ jsx35("h3", { className: cx("te-section-title t-head"), children: t("sources.title") }),
        /* @__PURE__ */ jsxs30("ul", { className: cx("tree"), "aria-hidden": "true", children: [
          /* @__PURE__ */ jsx35(TreeItemSkeleton, {}),
          /* @__PURE__ */ jsx35(TreeItemSkeleton, { level: 2 }),
          /* @__PURE__ */ jsx35(TreeItemSkeleton, { level: 2 }),
          /* @__PURE__ */ jsx35(TreeItemSkeleton, {})
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsx35("div", { className: cx("te-side"), children: /* @__PURE__ */ jsxs30("section", { className: cx("te-preview"), "data-part": "te-preview", "data-state": "loading", "aria-busy": "true", children: [
      /* @__PURE__ */ jsx35("div", { className: cx("te-preview-head"), children: /* @__PURE__ */ jsx35("h3", { className: cx("t-head"), children: t("preview.title") }) }),
      /* @__PURE__ */ jsx35(GridSkeleton, { density: "compact", count: PREVIEW_LIMIT, label: t("preview.grid_label") })
    ] }) })
  ] });
}

// desktop-src/dialogs/theme/index.tsx
import { Button as Button23, Codicon as Codicon27, host as host13 } from "@hermes/plugin-sdk";
import { useCallback as useCallback12, useEffect as useEffect26, useMemo as useMemo5, useRef as useRef24, useState as useState25 } from "react";

// desktop-src/dialogs/theme/ai.ts
import { useEffect as useEffect25, useState as useState24 } from "react";
var JOB_CANCELLED_CODE2 = "cancelled";
function isCancelledError2(error) {
  return error?.code === JOB_CANCELLED_CODE2;
}
function isJobCancelled2(job) {
  return !!job && job.status === "error" && isCancelledError2(job.error);
}
function isAiStatus3(value) {
  return !!value && typeof value === "object" && typeof value.available === "boolean";
}
function modelSettingsPath2() {
  return `/settings?tab=config:model&aux=${encodeURIComponent(`${PLUGIN_ID.replace(/-/g, "_")}_curator`)}`;
}
var NO_MODEL_REASON2 = "no_model";
var PROVIDER_UNAVAILABLE_REASON2 = "provider_unavailable";
var ROUTE_PART_CHARS2 = 80;
function routePart2(value) {
  if (typeof value !== "string") return "";
  let text = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").trim();
  if (/^([/~\\]|[A-Za-z]:[\\/])/.test(text)) text = text.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  return text.length <= ROUTE_PART_CHARS2 ? text : `${text.slice(0, ROUTE_PART_CHARS2 - 1)}…`;
}
function providerRoute2(provider, model) {
  return [routePart2(provider), routePart2(model)].filter(Boolean).join(" · ");
}
function statusProblem2(status) {
  if (!status || status.available !== false) return null;
  if (status.reason === PROVIDER_UNAVAILABLE_REASON2) return { kind: "provider_unavailable", route: providerRoute2(status.provider, status.model) };
  return { kind: "no_model" };
}
function errorProblem2(error) {
  if (!error || error.code !== "llm_unavailable") return null;
  const details = error.details && typeof error.details === "object" ? error.details : {};
  const reason = error.reason ?? details.reason;
  if (reason === PROVIDER_UNAVAILABLE_REASON2) return { kind: "provider_unavailable", route: providerRoute2(details.provider, details.model) };
  if (reason === NO_MODEL_REASON2) return { kind: "no_model" };
  return null;
}
function afterFailure2(status) {
  if (status?.available === true) return { kind: "other" };
  return statusProblem2(status) ?? { kind: "no_model" };
}
function useAiProblem2(error) {
  const direct = errorProblem2(error);
  const needsStatus = !!error && error.code === "llm_unavailable" && !direct;
  const [read2, setRead] = useState24(null);
  useEffect25(() => {
    if (!needsStatus) return void 0;
    let alive = true;
    const settle = (status) => {
      if (!alive) return;
      alive = false;
      setRead({ error, problem: afterFailure2(status) });
    };
    const deadline = setTimeout(() => settle(null), AI_STATUS_DEADLINE_MS);
    restCall("GET /ai/status").then(
      (data) => settle(isAiStatus3(data) ? data : null),
      () => settle(null)
    );
    return () => {
      alive = false;
      clearTimeout(deadline);
    };
  }, [error, needsStatus]);
  if (!error || error.code !== "llm_unavailable") return { problem: null, pending: false };
  if (direct) return { problem: direct, pending: false };
  if (read2 && read2.error === error) return { problem: read2.problem, pending: false };
  return { problem: null, pending: true };
}
async function cancelJob2(jobId) {
  const out = await callRpc("job.cancel", { job_id: jobId }).catch(() => null);
  if (!out || out.kind !== "ok") return "failed";
  const job = out.data?.job ?? null;
  if (out.data?.cancelled || !job || isJobCancelled2(job)) return "cancelled";
  void invalidateRestExact("GET /jobs/{id}", { path: { id: jobId } });
  return "finished";
}

// desktop-src/dialogs/theme/model.ts
var STAGES = ["expand", "search", "curate", "preview"];
var QUERY_MIN = 2;
var QUERY_MAX = 200;
var NAME_MAX2 = 40;
var HOME_TAB_KEY2 = "home.tab";
var SETTINGS_PATH = "/settings";
var LANGUAGES = ["any", "pt", "en"];
var DEFAULT_OPTIONS = { language: "any", classics: false };
function cleanText(text) {
  return text.replace(/\s+/g, " ").trim();
}
function createParams(text, options) {
  const params = { query: cleanText(text).slice(0, QUERY_MAX).trimEnd() };
  if (options.language !== "any") params.language = options.language;
  if (options.classics) params.classics = true;
  return params;
}
function stripHints(query, t) {
  let out = cleanText(query);
  const hints = [t("hints.classics"), ...LANGUAGES.filter((l) => l !== "any").map((l) => t(`hints.lang_${l}`))];
  for (let changed = true; changed; ) {
    changed = false;
    for (const h of hints)
      if (h && out.endsWith(h) && out.length > h.length) {
        out = out.slice(0, -h.length).trimEnd();
        changed = true;
      }
  }
  return out;
}
var count = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : void 0;
function absorbProgress(prev, p) {
  const s = p?.step;
  if (!s) return prev;
  const done = count(s.done);
  const total = s.total == null ? void 0 : count(s.total);
  const next = { ...prev };
  if (s.name === "expand") {
    if (total !== void 0) next.searches = total;
  } else if (s.name === "search") {
    if (total !== void 0) next.found = total;
  } else if (s.name === "curate") {
    if (done !== void 0) next.rated = done;
    if (total !== void 0) next.found = total;
  } else if (s.name === "preview") {
    if (done !== void 0) next.kept = done;
    if (total !== void 0) next.rated = total;
  }
  return next;
}
function sameCounts(a, b) {
  return a.searches === b.searches && a.found === b.found && a.rated === b.rated && a.kept === b.kept;
}
function stageOf(p) {
  return p?.step?.name ?? p?.stage ?? null;
}
function stepStates(stage, phase) {
  if (phase === "done") return STAGES.map(() => "done");
  const at = Math.max(0, stage ? STAGES.indexOf(stage) : 0);
  return STAGES.map((_, i) => i < at ? "done" : i > at ? "waiting" : phase === "error" ? "failed" : "running");
}
var plural3 = (base, count2) => ({ key: `${base}_${count2 === 1 ? "one" : "other"}`, vars: { count: count2 } });
function stepDetails(states, counts, progress) {
  const legacy = !!progress && !progress.step;
  return STAGES.map((stage, i) => {
    const state = states[i];
    if (state === "waiting") return null;
    const running = state === "running";
    if (running && legacy) return progress?.message?.trim() ? { key: "", text: progress.message.trim() } : null;
    if (stage === "expand") return counts.searches != null ? plural3("steps.searches", counts.searches) : running ? { key: "steps.expand_running" } : null;
    if (stage === "search") {
      if (counts.found != null) return plural3("steps.found", counts.found);
      return running && counts.searches != null ? plural3("steps.search_running", counts.searches) : null;
    }
    if (stage === "curate") {
      if (counts.rated != null && counts.found != null && running) return { key: "steps.rated_progress", vars: { done: counts.rated, total: counts.found } };
      if (counts.rated != null) return plural3("steps.rated", counts.rated);
      if (running && counts.found != null) return plural3("steps.rating", counts.found);
      return null;
    }
    return counts.kept != null ? plural3("steps.kept", counts.kept) : null;
  });
}
function isThemePreview(value) {
  const v = value;
  return !!v && typeof v === "object" && !!v.theme && typeof v.theme.id === "string" && Array.isArray(v.items) && !!v.videos && typeof v.videos === "object" && Array.isArray(v.seeds);
}
function feedItemOf(item, preview, sourceLabel) {
  const video = preview.videos[item.video_id];
  if (!video) return null;
  return {
    video,
    channel: null,
    state: "new",
    reaction: null,
    is_new: false,
    why: { via: "theme", label: item.reason?.trim() || sourceLabel(item.source), detail: null },
    badges: []
  };
}
function nameProblem2(name) {
  const n = cleanText(name);
  if (!n) return "empty";
  return [...n].length > NAME_MAX2 ? "long" : null;
}
function defaultChoices(preview) {
  return Object.fromEntries(preview.seeds.map((s) => [s.channel_id, "follow"]));
}
function buildEdits({ preview, name, createFolder, choices, inList, removed }) {
  const clean = cleanText(name);
  const seedActions = {};
  for (const s of preview.seeds) {
    const choice = choices[s.channel_id];
    if (choice && !inList.has(s.channel_id)) seedActions[s.channel_id] = choice;
  }
  const kept = new Set(preview.items.map((i) => i.video_id));
  const edits = { name: clean };
  if (preview.theme.icon) edits.icon = preview.theme.icon;
  edits.create_folder = createFolder;
  if (createFolder) edits.folder_name = clean;
  edits.seed_actions = seedActions;
  edits.removed_video_ids = removed.filter((id) => kept.has(id));
  return edits;
}
var readPending = readThemePending;
var writePending = writeThemePending;
var clearPending = clearThemePending;
function storage() {
  try {
    return maybePluginContext()?.storage ?? null;
  } catch {
    return null;
  }
}
function rememberHomeTab2(tabId) {
  try {
    storage()?.set(HOME_TAB_KEY2, tabId);
  } catch {
  }
}

// desktop-src/dialogs/theme/parts.tsx
import { Button as Button22, Checkbox as Checkbox3, Codicon as Codicon26, Input as Input5, Switch as Switch3 } from "@hermes/plugin-sdk";
import { useId as useId5, useLayoutEffect as useLayoutEffect6, useRef as useRef23 } from "react";
import { Fragment as Fragment17, jsx as jsx36, jsxs as jsxs31 } from "react/jsx-runtime";
var EXAMPLE_KEYS = ["ex1", "ex2", "ex3", "ex4", "ex5"];
var DOWN_KEY = "d";
function FormView({ t, draft, onDraft, options, onOptions, fieldError, onSubmit, inputRef, banner }) {
  const id = useId5();
  const hintId = `${id}-hint`;
  const onKey = (e) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    onSubmit();
  };
  return /* @__PURE__ */ jsxs31(Stack, { gap: 5, children: [
    banner,
    /* @__PURE__ */ jsxs31(Stack, { gap: 2, children: [
      /* @__PURE__ */ jsx36("label", { htmlFor: id, className: cx("t-head"), children: t("field.label") }),
      /* @__PURE__ */ jsx36(
        Input5,
        {
          ref: inputRef,
          id,
          "data-part": "theme-query",
          value: draft,
          placeholder: t("field.placeholder"),
          maxLength: QUERY_MAX,
          autoComplete: "off",
          spellCheck: false,
          "aria-invalid": fieldError ? true : void 0,
          "aria-describedby": hintId,
          onChange: (e) => onDraft(e.target.value),
          onKeyDown: onKey
        }
      ),
      /* @__PURE__ */ jsx36("p", { id: hintId, className: cx("t-label"), "data-part": "theme-field-hint", "data-tone": fieldError ? "error" : void 0, role: fieldError ? "alert" : void 0, children: fieldError ? t(`field.${fieldError}`) : t("field.hint") })
    ] }),
    /* @__PURE__ */ jsxs31(Stack, { gap: 2, children: [
      /* @__PURE__ */ jsx36("span", { className: cx("t-label"), children: t("examples.label") }),
      /* @__PURE__ */ jsx36(Stack, { direction: "row", gap: 2, wrap: true, children: EXAMPLE_KEYS.map((k) => /* @__PURE__ */ jsxs31(
        "button",
        {
          type: "button",
          className: cx("bare chip t-label"),
          "data-part": "theme-example",
          onClick: () => {
            onDraft(t(`examples.${k}`));
            inputRef.current?.focus();
          },
          children: [
            /* @__PURE__ */ jsx36(Codicon26, { name: "sparkle", size: 12, className: cx("chip-icon") }),
            /* @__PURE__ */ jsx36("span", { className: cx("chip-label"), children: t(`examples.${k}`) })
          ]
        },
        k
      )) })
    ] }),
    /* @__PURE__ */ jsxs31(Stack, { gap: 2, children: [
      /* @__PURE__ */ jsx36("span", { className: cx("t-label"), children: t("options.label") }),
      /* @__PURE__ */ jsxs31(Stack, { direction: "row", gap: 4, wrap: true, align: "center", children: [
        /* @__PURE__ */ jsxs31(Stack, { direction: "row", gap: 1, align: "center", wrap: true, children: [
          /* @__PURE__ */ jsx36("span", { className: cx("t-label"), id: `${id}-lang`, children: t("options.language") }),
          /* @__PURE__ */ jsx36("div", { role: "group", "aria-labelledby": `${id}-lang`, className: cx("stack"), "data-direction": "row", "data-gap": "1", children: LANGUAGES.map((l) => /* @__PURE__ */ jsx36(
            Button22,
            {
              variant: options.language === l ? "secondary" : "ghost",
              size: "xs",
              "data-part": "theme-lang",
              "data-value": l,
              "aria-pressed": options.language === l,
              onClick: () => onOptions({ ...options, language: l }),
              children: t(`options.lang_${l}`)
            },
            l
          )) })
        ] }),
        /* @__PURE__ */ jsxs31("label", { className: cx("stack"), "data-direction": "row", "data-gap": "2", "data-align": "center", children: [
          /* @__PURE__ */ jsx36(Switch3, { "data-part": "theme-classics", checked: options.classics, onCheckedChange: (v) => onOptions({ ...options, classics: v }) }),
          /* @__PURE__ */ jsx36("span", { className: cx("t-body"), children: t("options.classics") }),
          /* @__PURE__ */ jsxs31("span", { className: cx("t-label"), children: [
            "· ",
            t("options.classics_hint")
          ] })
        ] })
      ] })
    ] })
  ] });
}
function detailText(t, fmt, d) {
  if (!d) return void 0;
  if (d.text !== void 0) return d.text;
  const vars2 = {};
  for (const [k, v] of Object.entries(d.vars ?? {})) vars2[k] = fmt(v);
  return t(d.key, vars2);
}
function ProgressSteps({ t, states, details }) {
  const fmt = useFormatCount();
  const steps = STAGES.map((stage, i) => ({ id: stage, label: t(`steps.${stage}`), status: states[i], detail: detailText(t, fmt, details[i]) }));
  return /* @__PURE__ */ jsx36(StepProgress, { steps, label: t("steps.label") });
}
function ProgressView({
  t,
  query,
  states,
  details,
  elapsed,
  banner,
  children
}) {
  return /* @__PURE__ */ jsxs31(Stack, { gap: 5, children: [
    banner,
    /* @__PURE__ */ jsxs31(Stack, { gap: 1, children: [
      /* @__PURE__ */ jsxs31(Stack, { direction: "row", gap: 3, align: "center", justify: "between", children: [
        /* @__PURE__ */ jsx36("p", { className: cx("t-head"), "data-part": "theme-asked", children: query ? `“${query}”` : t("title") }),
        elapsed ? /* @__PURE__ */ jsxs31("span", { className: cx("t-label"), "data-part": "theme-elapsed", role: "timer", "aria-label": t("progress.elapsed", { time: elapsed }), children: [
          /* @__PURE__ */ jsx36(Codicon26, { name: "watch", size: 12 }),
          " ",
          elapsed
        ] }) : null
      ] }),
      /* @__PURE__ */ jsx36("p", { className: cx("section-desc t-body"), "data-part": "theme-lead", children: t("progress.lead") }),
      /* @__PURE__ */ jsx36("p", { className: cx("t-label"), "data-part": "theme-background-hint", children: t("progress.background") })
    ] }),
    /* @__PURE__ */ jsx36(ProgressSteps, { t, states, details }),
    children ?? /* @__PURE__ */ jsx36(Section, { title: t("progress.coming"), description: t("progress.coming_desc"), children: /* @__PURE__ */ jsx36(GridSkeleton, { density: "compact", rows: 1, label: t("progress.coming") }) })
  ] });
}
function useTwoLineWhy(ref) {
  useLayoutEffect6(() => {
    const root = ref.current;
    if (!root) return;
    for (const why of root.querySelectorAll('[data-part="card"] [data-part="why"]')) {
      if (why.getAttribute("data-lines") === "2") continue;
      why.setAttribute("data-lines", "2");
      why.style.whiteSpace = "normal";
      why.style.alignItems = "flex-start";
      why.style.minHeight = `calc(2 * var(${cssVar("lh-label")}))`;
      const label = why.querySelector(`.${cx("why-label")}`);
      if (label) {
        label.style.whiteSpace = "normal";
        label.style.overflowWrap = "anywhere";
        label.style.display = "-webkit-box";
        label.style.setProperty("-webkit-box-orient", "vertical");
        label.style.setProperty("-webkit-line-clamp", "2");
      }
      const icon = why.querySelector(`.${cx("why-icon")}`);
      if (icon) icon.style.marginTop = "2px";
    }
  });
}
function PreviewBody(props) {
  const { t, preview, about, name, onName, problem, createFolder, onCreateFolder, choices, onChoice, onChoiceAll, inList, thumbs, removed, onDown, banner, empty, disabled, readOnly } = props;
  const fmt = useFormatCount();
  const nameId = useId5();
  const gridRef = useRef23(null);
  useTwoLineWhy(gridRef);
  const gone = new Set(removed);
  const sourceLabel = (s) => t(`preview.reason_${s}`);
  const items = preview.items.filter((i) => !gone.has(i.video_id)).map((i) => feedItemOf(i, preview, sourceLabel)).filter((i) => i !== null);
  const meta = [
    t("preview.about", { query: about }),
    t(`steps.found_${items.length === 1 ? "one" : "other"}`, { count: fmt(items.length) }),
    t(`steps.channels_${preview.channel_count === 1 ? "one" : "other"}`, { count: fmt(preview.channel_count) })
  ];
  const editable = preview.seeds.filter((s) => !inList.has(s.channel_id));
  return /* @__PURE__ */ jsxs31(Stack, { gap: 5, children: [
    banner,
    /* @__PURE__ */ jsxs31(Stack, { gap: 2, children: [
      /* @__PURE__ */ jsxs31("label", { htmlFor: nameId, className: cx("t-label"), children: [
        preview.theme.icon ? /* @__PURE__ */ jsxs31("span", { "aria-hidden": "true", children: [
          preview.theme.icon,
          " "
        ] }) : null,
        t("preview.name_label")
      ] }),
      /* @__PURE__ */ jsx36(
        Input5,
        {
          id: nameId,
          "data-part": "theme-name",
          value: name,
          disabled: disabled || readOnly,
          maxLength: NAME_MAX2 + 20,
          "aria-invalid": problem ? true : void 0,
          onChange: (e) => onName(e.target.value)
        }
      ),
      /* @__PURE__ */ jsx36("p", { className: cx("t-label"), "data-part": "theme-name-hint", "data-tone": problem ? "error" : void 0, role: problem ? "alert" : void 0, children: problem === "empty" ? t("preview.name_empty") : problem === "long" ? t("preview.name_long", { max: fmt(NAME_MAX2) }) : meta.join(" · ") })
    ] }),
    /* @__PURE__ */ jsx36(Section, { title: t("preview.videos"), count: items.length, description: items.length && !readOnly ? t("preview.videos_desc") : void 0, children: items.length ? /* @__PURE__ */ jsx36("div", { ref: gridRef, "data-part": "theme-grid", children: /* @__PURE__ */ jsx36(
      Grid,
      {
        items,
        getKey: (it) => it.video.id,
        label: t("preview.grid_label"),
        density: "compact",
        shortcuts: readOnly ? {} : { [DOWN_KEY]: "down" },
        onOpen: (it) => openVideo(it.video.id),
        onAction: (action, it) => {
          if (action === "down" && !disabled && !readOnly) onDown(it.video.id);
        },
        renderItem: (it) => /* @__PURE__ */ jsx36(
          VideoCard,
          {
            item: it,
            variant: "compact",
            actions: readOnly ? void 0 : /* @__PURE__ */ jsx36(QuickActions, { actions: [{ id: "down", label: t("preview.down"), icon: "thumbsdown", shortcut: DOWN_KEY, onSelect: () => !disabled && onDown(it.video.id) }] })
          }
        )
      }
    ) }) : empty }),
    /* @__PURE__ */ jsx36(
      Section,
      {
        title: t("preview.seeds"),
        count: preview.seeds.length,
        description: preview.seeds.length ? readOnly ? void 0 : t("preview.seeds_desc") : t("preview.seeds_empty"),
        actions: editable.length > 1 && !readOnly ? /* @__PURE__ */ jsxs31(Fragment17, { children: [
          /* @__PURE__ */ jsx36(Button22, { variant: "ghost", size: "xs", "data-part": "seeds-ignore-all", disabled, onClick: () => onChoiceAll("ignore"), children: t("preview.ignore_all") }),
          /* @__PURE__ */ jsx36(Button22, { variant: "ghost", size: "xs", "data-part": "seeds-follow-all", disabled, onClick: () => onChoiceAll("follow"), children: t("preview.follow_all") })
        ] }) : void 0,
        children: preview.seeds.length ? /* @__PURE__ */ jsx36("div", { role: "list", className: cx("sgroup"), "data-part": "theme-seeds", children: preview.seeds.map((s) => /* @__PURE__ */ jsx36(
          SeedRow,
          {
            t,
            seed: s,
            thumb: thumbs[s.channel_id] ?? null,
            choice: choices[s.channel_id] ?? null,
            inList: inList.has(s.channel_id),
            disabled,
            readOnly,
            onChoice: (c) => onChoice(s.channel_id, c)
          },
          s.channel_id
        )) }) : null
      }
    ),
    readOnly ? null : /* @__PURE__ */ jsxs31("label", { className: cx("stack"), "data-direction": "row", "data-gap": "2", "data-align": "center", children: [
      /* @__PURE__ */ jsx36(Checkbox3, { "data-part": "theme-folder", checked: createFolder, disabled, onCheckedChange: (v) => onCreateFolder(v === true) }),
      /* @__PURE__ */ jsx36("span", { className: cx("t-body"), children: problem ? t("preview.folder_plain") : t("preview.folder", { name: name.trim() }) })
    ] })
  ] });
}
function SeedRow({
  t,
  seed,
  thumb,
  choice,
  inList,
  disabled,
  readOnly,
  onChoice
}) {
  const fmt = useFormatCount();
  const status = inList ? "accepted" : choice === "ignore" ? "rejected" : "pending";
  return /* @__PURE__ */ jsxs31("div", { role: "listitem", className: cx("srow"), "data-part": "theme-seed", "data-channel": seed.channel_id, "data-status": status, "data-choice": choice ?? void 0, children: [
    /* @__PURE__ */ jsx36(ChannelAvatar, { title: seed.title, thumb, size: 28 }),
    /* @__PURE__ */ jsxs31("div", { className: cx("srow-main"), children: [
      /* @__PURE__ */ jsx36("div", { className: cx("srow-line t-body"), children: /* @__PURE__ */ jsx36("span", { className: cx("srow-subject"), children: seed.title }) }),
      /* @__PURE__ */ jsx36("div", { className: cx("srow-reason t-label"), children: t(`preview.seed_kept_${seed.kept_videos === 1 ? "one" : "other"}`, { count: fmt(seed.kept_videos) }) })
    ] }),
    /* @__PURE__ */ jsx36("div", { className: cx("srow-actions"), role: "group", "aria-label": t("preview.seed_choice", { name: seed.title }), children: inList ? /* @__PURE__ */ jsxs31("span", { className: cx("srow-status t-label"), children: [
      /* @__PURE__ */ jsx36(Codicon26, { name: "check", size: 12 }),
      t("preview.in_list")
    ] }) : readOnly ? null : /* @__PURE__ */ jsxs31(Fragment17, { children: [
      /* @__PURE__ */ jsx36(Button22, { variant: choice === "ignore" ? "secondary" : "ghost", size: "xs", "data-part": "seed-ignore", "aria-pressed": choice === "ignore", disabled, onClick: () => onChoice("ignore"), children: t("preview.ignore") }),
      /* @__PURE__ */ jsxs31(Button22, { variant: choice === "follow" ? "secondary" : "ghost", size: "xs", "data-part": "seed-follow", "aria-pressed": choice === "follow", disabled, onClick: () => onChoice("follow"), children: [
        /* @__PURE__ */ jsx36(Codicon26, { name: "add", size: 12 }),
        t("preview.follow")
      ] })
    ] }) })
  ] });
}
function PreviewSkeleton({ t }) {
  return /* @__PURE__ */ jsxs31(Stack, { gap: 5, children: [
    /* @__PURE__ */ jsxs31(Stack, { gap: 2, children: [
      /* @__PURE__ */ jsx36("span", { className: cx("t-label"), children: t("preview.name_label") }),
      /* @__PURE__ */ jsx36(Input5, { "data-part": "theme-name-skeleton", value: "", disabled: true, readOnly: true, "aria-busy": "true", "aria-label": t("preview.name_label") }),
      /* @__PURE__ */ jsx36("p", { className: cx("t-label"), "aria-hidden": "true", children: " " })
    ] }),
    /* @__PURE__ */ jsx36(Section, { title: t("preview.videos"), description: t("preview.videos_desc"), children: /* @__PURE__ */ jsx36(GridSkeleton, { density: "compact", rows: 2, label: t("preview.grid_label") }) }),
    /* @__PURE__ */ jsx36(Section, { title: t("preview.seeds"), description: t("preview.seeds_desc"), children: /* @__PURE__ */ jsxs31("div", { className: cx("sgroup"), children: [
      /* @__PURE__ */ jsx36(SuggestionRowSkeleton, {}),
      /* @__PURE__ */ jsx36(SuggestionRowSkeleton, {})
    ] }) })
  ] });
}

// desktop-src/dialogs/theme/index.tsx
import { Fragment as Fragment18, jsx as jsx37, jsxs as jsxs32 } from "react/jsx-runtime";
var CHANGED_BY_SAVE = ["GET /tabs", "GET /status", "GET /feed", "GET /channels", "GET /folders", "GET /themes"];
function ThemeDialog({ query, jobId, themeId, onClose, initial }) {
  const t = useT("theme");
  const tc2 = useT();
  const [boot] = useState25(() => {
    const stored = themeId ? null : readPending();
    const pending2 = jobId ? stored?.jobId === jobId ? stored : null : stored;
    return { jobId: jobId ?? pending2?.jobId ?? null, pending: pending2 };
  });
  const [mode, setMode] = useState25(() => initial?.view ?? (boot.jobId ? "job" : themeId ? "theme" : "form"));
  const [draft, setDraft] = useState25(() => initial?.draft ?? query ?? boot.pending?.query ?? "");
  const [asked, setAsked] = useState25(() => query ?? boot.pending?.query ?? initial?.draft ?? "");
  const [options, setOptions] = useState25(() => initial?.options ?? DEFAULT_OPTIONS);
  const [fieldError, setFieldError] = useState25(null);
  const [startError, setStartError] = useState25(null);
  const [aiStartError, setAiStartError] = useState25(null);
  const [counts, setCounts] = useState25(() => initial?.counts ?? boot.pending?.counts ?? {});
  const lastParams = useRef24(null);
  const inputRef = useRef24(null);
  const focusField = useRef24(false);
  const [startedAt, setStartedAt] = useState25(() => boot.pending?.at ?? null);
  const [cancelState, setCancelState] = useState25(() => initial?.cancelFailed ? "failed" : "idle");
  const job = useRpcJob("theme.create", boot.jobId);
  const tracking = mode === "job";
  const ai = useAiStatus(mode === "form");
  const liveCounts = useMemo5(() => tracking ? absorbProgress(counts, job.progress) : counts, [tracking, counts, job.progress]);
  const themeQ = useRest("GET /themes/{id}", { path: { id: themeId ?? "" } }, { enabled: mode === "theme" && !!themeId });
  const jobResult = tracking && job.phase === "done" ? job.result : null;
  const preview = mode === "theme" ? isThemePreview(themeQ.data) ? themeQ.data : null : isThemePreview(jobResult) ? jobResult : null;
  const badResult = tracking && job.phase === "done" && !preview;
  const [edits, setEdits] = useState25(null);
  if (preview && edits?.themeId !== preview.theme.id) {
    setEdits({
      themeId: preview.theme.id,
      name: initial?.name ?? preview.theme.name ?? stripHints(preview.theme.query, t),
      createFolder: initial?.createFolder ?? false,
      choices: initial?.choices ?? defaultChoices(preview),
      removed: initial?.removed ?? []
    });
  }
  const [saving, setSaving] = useState25(!!initial?.saving);
  const [saveError, setSaveError] = useState25(null);
  const seedIds = preview?.seeds.map((s) => s.channel_id) ?? [];
  const channelsQ = useRest("GET /channels", { query: { ids: seedIds.join(","), limit: Math.max(1, seedIds.length) } }, { enabled: seedIds.length > 0 });
  const { inList, thumbs } = useMemo5(() => {
    const set = /* @__PURE__ */ new Set();
    const pics = {};
    for (const row of channelsQ.data?.items ?? []) {
      const ch = row?.channel;
      if (!ch?.id) continue;
      pics[ch.id] = ch.thumb ?? null;
      if (ch.relation === "subscribed" || ch.relation === "followed") set.add(ch.id);
    }
    return { inList: set, thumbs: pics };
  }, [channelsQ.data]);
  const rawJobError = tracking && job.phase === "error" ? job.error : null;
  const cancelledJob = isCancelledError2(rawJobError);
  const jobError2 = cancelledJob ? null : rawJobError;
  const aiFailure = useAiProblem2(mode === "no-model" ? aiStartError : jobError2?.code === "llm_unavailable" ? jobError2 : null);
  const aiPhase = () => aiFailure.pending ? "progress" : aiFailure.problem?.kind === "provider_unavailable" ? "provider-unavailable" : aiFailure.problem?.kind === "other" ? "error" : "no-model";
  const phase = (() => {
    if (mode === "form") return "form";
    if (mode === "starting") return "progress";
    if (mode === "no-model") return aiPhase();
    if (mode === "busy" || mode === "unavailable" || mode === "expired") return mode;
    if (mode === "start-error") return "error";
    if (mode === "theme") return preview ? saving ? "saving" : "preview" : themeQ.error ? "error" : "loading";
    if (job.phase === "unavailable") return "unavailable";
    if (jobError2) {
      if (jobError2.code === "llm_unavailable") return aiPhase();
      if (jobError2.code === "not_found" && !job.job) return "expired";
      return "error";
    }
    if (badResult) return "error";
    if (preview) return saving ? "saving" : "preview";
    return "progress";
  })();
  useEffect26(() => {
    if (!tracking) return;
    if (!sameCounts(liveCounts, counts)) setCounts(liveCounts);
    if (job.jobId && (phase === "progress" || phase === "preview")) {
      const stored = readPending();
      const mine = stored?.jobId === job.jobId ? stored : null;
      writePending({
        jobId: job.jobId,
        query: asked,
        at: mine?.at ?? startedAt ?? Date.now(),
        counts: liveCounts,
        params: lastParams.current ?? mine?.params,
        // the preview is on screen: Home has nothing left to announce
        seen: phase === "preview" || mine?.seen ? true : void 0
      });
    } else if (phase === "error" || phase === "expired" || phase === "no-model" || phase === "provider-unavailable") clearPending();
  }, [tracking, liveCounts, counts, job.jobId, phase, asked, startedAt]);
  useEffect26(() => {
    if (mode !== "form") return;
    if (focusField.current || !initial) {
      focusField.current = false;
      inputRef.current?.focus();
      inputRef.current?.select?.();
    }
  }, [mode, initial]);
  const follow = useCallback12(
    (id) => {
      setStartError(null);
      setMode("job");
      job.resume(id);
    },
    [job]
  );
  const begin = useCallback12(
    async (text, sent) => {
      const clean = cleanText(text);
      if (clean.length < QUERY_MIN) {
        setFieldError("too_short");
        inputRef.current?.focus();
        return;
      }
      const params = sent ?? createParams(clean, options);
      lastParams.current = params;
      setFieldError(null);
      setStartError(null);
      setAiStartError(null);
      setSaveError(null);
      setCancelState("idle");
      setAsked(clean);
      setCounts({});
      setStartedAt(Date.now());
      job.reset();
      setMode("starting");
      const out = await callRpc("theme.create", params);
      if (out.kind === "ok") {
        const id = out.data?.job?.id;
        if (!id) {
          setStartError({ code: "internal", message: "RPC returned no job" });
          setMode("start-error");
          return;
        }
        const at = Date.now();
        setStartedAt(at);
        writePending({ jobId: id, query: clean, at, counts: {}, params });
        setMode("job");
        job.resume(id);
      } else if (out.kind === "unavailable") setMode("unavailable");
      else if (out.error.code === "llm_unavailable") {
        setAiStartError(out.error);
        setMode("no-model");
      } else if (out.error.code === "busy") setMode("busy");
      else if (out.error.code === "invalid") {
        setFieldError("invalid");
        focusField.current = true;
        setMode("form");
      } else {
        setStartError(out.error);
        setMode("start-error");
      }
    },
    [job, options]
  );
  const submit = () => void begin(draft);
  const retry3 = () => void begin(asked, lastParams.current ?? void 0);
  const rephrase = useCallback12(() => {
    job.reset();
    clearPending();
    setCancelState("idle");
    setDraft((d) => asked || d);
    focusField.current = true;
    setMode("form");
  }, [job, asked]);
  const cancel = useCallback12(async () => {
    const id = job.jobId;
    if (!id) return;
    setCancelState("pending");
    const outcome = await cancelJob2(id);
    if (outcome === "cancelled") rephrase();
    else setCancelState(outcome === "failed" ? "failed" : "idle");
  }, [job.jobId, rephrase]);
  useEffect26(() => {
    if (cancelledJob) rephrase();
  }, [cancelledJob, rephrase]);
  const followActive = useCallback12(async () => {
    try {
      const data = await restCall("GET /jobs", { query: { kind: "theme" } });
      const active = (data.items ?? []).find((j) => j.status === "queued" || j.status === "running");
      if (active) {
        follow(active.id);
        return;
      }
    } catch {
    }
    retry3();
  }, [follow, retry3]);
  const setEdit = (patch2) => setEdits((e) => e ? { ...e, ...patch2 } : e);
  const restore = useCallback12((videoId) => {
    setEdits((e) => e ? { ...e, removed: e.removed.filter((id) => id !== videoId) } : e);
    restCall("POST /videos/state", { body: { video_ids: [videoId], reaction: null } }).catch(() => void 0);
  }, []);
  const drop = useCallback12(
    (videoId) => {
      if (!preview || edits?.removed.includes(videoId)) return;
      const title = preview.videos[videoId]?.title ?? videoId;
      setEdits((e) => e ? { ...e, removed: [...e.removed, videoId] } : e);
      restCall("POST /videos/state", { body: { video_ids: [videoId], reaction: "down" } }).then(
        () => host13.notify({ kind: "info", message: t("toast.removed", { title }), action: { label: t("toast.undo"), onClick: () => restore(videoId) } }),
        (error) => {
          setEdits((e) => e ? { ...e, removed: e.removed.filter((id) => id !== videoId) } : e);
          host13.notify({ kind: "error", message: t("toast.down_failed", { error: errorText(tc2, toApiError(error)) }) });
        }
      );
    },
    [preview, edits, t, tc2, restore]
  );
  const openInHome = useCallback12(
    (tabId) => {
      rememberHomeTab2(tabId);
      void invalidateRest(...CHANGED_BY_SAVE);
      openSection("home");
      onClose();
    },
    [onClose]
  );
  const problem = edits ? nameProblem2(edits.name) : null;
  const visibleCount = preview && edits ? preview.items.filter((i) => !edits.removed.includes(i.video_id)).length : 0;
  const alreadySaved = preview?.theme.status === "saved";
  const canSave = !!preview && !!edits && !problem && visibleCount > 0 && !saving && !alreadySaved;
  const save = useCallback12(async () => {
    if (!preview || !edits || !canSave) return;
    setSaving(true);
    setSaveError(null);
    const out = await callRpc("theme.save", {
      theme_id: preview.theme.id,
      edits: buildEdits({ preview, name: edits.name, createFolder: edits.createFolder, choices: edits.choices, inList, removed: edits.removed })
    });
    if (out.kind !== "ok") {
      setSaving(false);
      setSaveError(out.kind === "unavailable" ? { kind: "unavailable" } : { kind: "error", error: out.error });
      return;
    }
    const saved = out.data;
    const name = saved.tab?.name ?? cleanText(edits.name);
    clearPending();
    openInHome(saved.tab.id);
    const themeIdSaved = saved.theme_id;
    const changeId = saved.change_id;
    host13.notify({
      kind: "success",
      message: t("toast.saved", { name }),
      action: changeId != null ? {
        label: t("toast.undo"),
        onClick: () => {
          restCall("POST /changes/{id}/undo", { path: { id: changeId } }).then(
            () => {
              void invalidateRest(...CHANGED_BY_SAVE);
              host13.notify({
                kind: "success",
                message: t("toast.undone", { name }),
                action: { label: t("toast.reopen"), onClick: () => openDialog("theme", { themeId: themeIdSaved }) }
              });
            },
            (error) => host13.notify({ kind: "error", message: t("toast.undo_failed", { error: errorText(tc2, toApiError(error)) }) })
          );
        }
      } : void 0
    });
  }, [preview, edits, canSave, inList, openInHome, t, tc2]);
  const discard = () => {
    clearPending();
    onClose();
  };
  const onKeyDown = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && (phase === "preview" || phase === "saving")) {
      e.preventDefault();
      void save();
    }
  };
  const states = stepStates(tracking ? stageOf(job.progress) : null, phase === "error" ? "error" : "running");
  const details = stepDetails(states, liveCounts, tracking ? job.progress : null);
  const shownQuery = asked || (preview ? stripHints(preview.theme.query, t) : "");
  const now = useNowTicker(phase === "progress");
  const since = startedAt ?? (job.job ? job.job.created_at * 1e3 : null);
  const elapsed = phase === "progress" && since != null ? formatElapsed(now - since) : null;
  const unreachable = (route) => route ? tc2("provider_unavailable", { route }) : tc2("provider_unavailable_plain");
  const before = statusProblem2(ai);
  let body;
  let footer;
  const notNow = /* @__PURE__ */ jsx37(Button23, { variant: "outline", size: "sm", "data-part": "theme-secondary", onClick: onClose, children: t("footer.not_now") });
  if (phase === "form") {
    body = /* @__PURE__ */ jsx37(
      FormView,
      {
        t,
        draft,
        onDraft: (v) => {
          setDraft(v);
          if (fieldError) setFieldError(null);
        },
        options,
        onOptions: setOptions,
        fieldError,
        onSubmit: submit,
        inputRef,
        banner: (
          // only an explicit `available: false` warns; the request stays possible (the config may have changed just now)
          before?.kind === "provider_unavailable" ? /* @__PURE__ */ jsx37("div", { "data-part": "theme-ai-warning", children: /* @__PURE__ */ jsx37(
            Banner,
            {
              tone: "warning",
              title: t("ai.provider_unavailable_title"),
              action: {
                label: t("ai.provider_unavailable_action"),
                onClick: () => {
                  host13.navigate(modelSettingsPath2());
                  onClose();
                }
              },
              children: unreachable(before.route)
            }
          ) }) : before ? /* @__PURE__ */ jsx37("div", { "data-part": "theme-ai-warning", children: /* @__PURE__ */ jsx37(
            Banner,
            {
              tone: "warning",
              title: t("ai.no_model_title"),
              action: {
                label: t("ai.open_settings"),
                onClick: () => {
                  host13.navigate(SETTINGS_PATH);
                  onClose();
                }
              },
              children: t("ai.no_model_desc")
            }
          ) }) : null
        )
      }
    );
    footer = /* @__PURE__ */ jsxs32(Fragment18, { children: [
      notNow,
      /* @__PURE__ */ jsxs32(
        Button23,
        {
          size: "sm",
          variant: ai?.available === false ? "outline" : void 0,
          "data-part": "theme-primary",
          disabled: cleanText(draft).length < QUERY_MIN,
          onClick: submit,
          children: [
            /* @__PURE__ */ jsx37(Codicon27, { name: "sparkle", size: 14 }),
            t("footer.start")
          ]
        }
      )
    ] });
  } else if (phase === "progress") {
    body = /* @__PURE__ */ jsx37(
      ProgressView,
      {
        t,
        query: shownQuery,
        states,
        details,
        elapsed,
        banner: cancelState === "failed" ? /* @__PURE__ */ jsx37("div", { "data-part": "theme-cancel-failed", children: /* @__PURE__ */ jsx37(Banner, { tone: "warning", children: t("progress.cancel_failed") }) }) : null
      }
    );
    footer = /* @__PURE__ */ jsxs32(Fragment18, { children: [
      /* @__PURE__ */ jsx37(
        Button23,
        {
          variant: "outline",
          size: "sm",
          "data-part": "theme-secondary",
          loading: cancelState === "pending",
          disabled: cancelState === "pending" || !job.jobId,
          onClick: () => void cancel(),
          children: t("footer.cancel")
        }
      ),
      /* @__PURE__ */ jsx37(Button23, { size: "sm", "data-part": "theme-background", disabled: cancelState === "pending", onClick: onClose, children: t("footer.background") })
    ] });
  } else if (phase === "no-model") {
    body = /* @__PURE__ */ jsx37(
      EmptyView,
      {
        icon: "sparkle",
        title: t("no_model.title"),
        description: t("no_model.desc"),
        action: /* @__PURE__ */ jsxs32(
          Button23,
          {
            size: "sm",
            "data-part": "theme-settings",
            onClick: () => {
              host13.navigate(SETTINGS_PATH);
              onClose();
            },
            children: [
              /* @__PURE__ */ jsx37(Codicon27, { name: "settings-gear", size: 14 }),
              t("no_model.action")
            ]
          }
        )
      }
    );
    footer = notNow;
  } else if (phase === "provider-unavailable") {
    const route = aiFailure.problem?.kind === "provider_unavailable" ? aiFailure.problem.route : "";
    body = /* @__PURE__ */ jsx37(
      EmptyView,
      {
        icon: "sparkle",
        title: t("provider_unavailable.title"),
        description: unreachable(route),
        action: /* @__PURE__ */ jsxs32(Fragment18, { children: [
          /* @__PURE__ */ jsx37(Button23, { variant: "outline", size: "sm", "data-part": "theme-retry", onClick: retry3, children: t("provider_unavailable.retry") }),
          /* @__PURE__ */ jsxs32(
            Button23,
            {
              size: "sm",
              "data-part": "theme-settings",
              onClick: () => {
                host13.navigate(modelSettingsPath2());
                onClose();
              },
              children: [
                /* @__PURE__ */ jsx37(Codicon27, { name: "settings-gear", size: 14 }),
                t("provider_unavailable.action")
              ]
            }
          )
        ] })
      }
    );
    footer = notNow;
  } else if (phase === "busy") {
    body = /* @__PURE__ */ jsx37(
      EmptyView,
      {
        icon: "watch",
        title: t("busy.title"),
        description: t("busy.desc"),
        action: /* @__PURE__ */ jsxs32(Fragment18, { children: [
          /* @__PURE__ */ jsx37(Button23, { variant: "outline", size: "sm", onClick: retry3, children: t("busy.retry") }),
          /* @__PURE__ */ jsx37(Button23, { size: "sm", onClick: () => void followActive(), children: t("busy.follow") })
        ] })
      }
    );
    footer = notNow;
  } else if (phase === "unavailable") {
    body = /* @__PURE__ */ jsx37(RpcUnavailableNotice, {});
    footer = notNow;
  } else if (phase === "expired") {
    body = /* @__PURE__ */ jsx37(EmptyView, { icon: "history", title: t("error.expired_title"), description: t("error.expired") });
    footer = /* @__PURE__ */ jsxs32(Fragment18, { children: [
      notNow,
      /* @__PURE__ */ jsx37(Button23, { size: "sm", "data-part": "theme-primary", onClick: rephrase, children: t("footer.new_theme") })
    ] });
  } else if (phase === "error") {
    if (mode === "theme") {
      body = /* @__PURE__ */ jsx37(ErrorView, { error: themeQ.error, title: t("error.load_title"), onRetry: () => void themeQ.refetch?.() });
      footer = notNow;
    } else {
      const error = startError ?? (mode === "no-model" ? aiStartError : null) ?? jobError2 ?? { code: "internal", message: "invalid job result" };
      const aiOther = aiFailure.problem?.kind === "other" ? error.message : void 0;
      body = /* @__PURE__ */ jsxs32(Stack, { gap: 5, children: [
        mode === "job" ? /* @__PURE__ */ jsx37(ProgressSteps, { t, states, details }) : null,
        /* @__PURE__ */ jsx37(ErrorView, { error, title: t("error.title"), description: aiOther, onRetry: retry3, compact: mode === "job" })
      ] });
      footer = /* @__PURE__ */ jsx37(Button23, { variant: "outline", size: "sm", "data-part": "theme-secondary", onClick: rephrase, children: t("footer.rephrase") });
    }
  } else if (phase === "loading") {
    body = /* @__PURE__ */ jsx37(PreviewSkeleton, { t });
    footer = /* @__PURE__ */ jsxs32(Fragment18, { children: [
      notNow,
      /* @__PURE__ */ jsxs32(Button23, { size: "sm", "data-part": "theme-primary", disabled: true, children: [
        /* @__PURE__ */ jsx37(Codicon27, { name: "save", size: 14 }),
        t("footer.save")
      ] })
    ] });
  } else if (preview && edits) {
    const partial = !alreadySaved && !!preview.theme.error && preview.items.length > 0;
    let banner = null;
    if (saveError) {
      const msg = saveError.kind === "unavailable" ? tc2(MESSAGE_KEYS.openDesktopBackend) : saveError.error.code === "conflict" ? t("error.conflict") : errorText(tc2, saveError.error);
      banner = /* @__PURE__ */ jsx37(Banner, { tone: "error", title: t("error.save_title"), children: msg });
    } else if (alreadySaved) {
      banner = /* @__PURE__ */ jsx37(Banner, { tone: "info", title: t("preview.saved_title"), children: t("preview.saved") });
    } else if (partial) {
      banner = /* @__PURE__ */ jsxs32(Banner, { tone: "warning", title: t("preview.partial_title"), children: [
        t("preview.partial"),
        " ",
        /* @__PURE__ */ jsx37("span", { className: cx("t-label"), children: preview.theme.error })
      ] });
    }
    const allRemoved = preview.items.length > 0 && visibleCount === 0;
    const empty = allRemoved ? /* @__PURE__ */ jsx37(
      EmptyView,
      {
        compact: true,
        icon: "thumbsdown",
        title: t("preview.all_removed_title"),
        description: t("preview.all_removed"),
        action: /* @__PURE__ */ jsx37(Button23, { variant: "outline", size: "sm", onClick: () => edits.removed.forEach(restore), children: t("empty.restore") })
      }
    ) : /* @__PURE__ */ jsx37(
      EmptyView,
      {
        compact: true,
        icon: "search",
        title: t("empty.title", { query: stripHints(preview.theme.query, t) }),
        description: preview.theme.error ? `${preview.theme.error} ${t("empty.desc")}` : t("empty.desc"),
        action: /* @__PURE__ */ jsx37(Button23, { variant: "outline", size: "sm", onClick: rephrase, children: t("footer.rephrase") })
      }
    );
    body = /* @__PURE__ */ jsx37(
      PreviewBody,
      {
        t,
        preview,
        about: shownQuery,
        name: edits.name,
        onName: (v) => setEdit({ name: v }),
        problem: alreadySaved ? null : problem,
        createFolder: edits.createFolder,
        onCreateFolder: (v) => setEdit({ createFolder: v }),
        choices: edits.choices,
        onChoice: (id, c) => setEdits((e) => e ? { ...e, choices: { ...e.choices, [id]: c } } : e),
        onChoiceAll: (c) => setEdits((e) => e ? { ...e, choices: Object.fromEntries(preview.seeds.map((s) => [s.channel_id, c])) } : e),
        inList,
        thumbs,
        removed: edits.removed,
        onDown: drop,
        banner,
        empty,
        disabled: saving,
        readOnly: alreadySaved
      }
    );
    footer = alreadySaved ? /* @__PURE__ */ jsxs32(Fragment18, { children: [
      /* @__PURE__ */ jsx37(Button23, { variant: "outline", size: "sm", "data-part": "theme-secondary", onClick: rephrase, children: t("footer.new_theme") }),
      /* @__PURE__ */ jsxs32(Button23, { size: "sm", "data-part": "theme-primary", onClick: () => preview.theme.tab_id && openInHome(preview.theme.tab_id), children: [
        /* @__PURE__ */ jsx37(Codicon27, { name: "home", size: 14 }),
        t("footer.open_home")
      ] })
    ] }) : /* @__PURE__ */ jsxs32(Fragment18, { children: [
      /* @__PURE__ */ jsx37(Button23, { variant: "outline", size: "sm", "data-part": "theme-secondary", disabled: saving, onClick: discard, children: t("footer.discard") }),
      /* @__PURE__ */ jsxs32(Button23, { size: "sm", "data-part": "theme-primary", title: t("footer.save_shortcut"), loading: saving, disabled: !canSave, onClick: () => void save(), children: [
        /* @__PURE__ */ jsx37(Codicon27, { name: "save", size: 14 }),
        edits.createFolder ? t("footer.save_folder") : t("footer.save")
      ] })
    ] });
  } else {
    body = /* @__PURE__ */ jsx37(PreviewSkeleton, { t });
    footer = notNow;
  }
  return (
    // theme already saved: the preview is read-only and "nothing is saved until you confirm" no longer applies
    /* @__PURE__ */ jsx37(DialogFrame, { title: t("title"), description: alreadySaved ? void 0 : t("description"), onClose, footer, size: "lg", children: /* @__PURE__ */ jsx37("div", { "data-part": "theme", "data-phase": phase, onKeyDown, children: body }) })
  );
}

// desktop-src/lib/shell.tsx
import { useEffect as useEffect27, useRef as useRef25 } from "react";
import { jsx as jsx38 } from "react/jsx-runtime";
var DEFAULT_CONFIG = { mascotLines: () => [] };
var config = DEFAULT_CONFIG;
onShellReset(() => {
  config = DEFAULT_CONFIG;
});
function configureShell(next) {
  config = { ...config, ...next };
}
var STATUS_EVENTS = ["refresh.done", "queue.changed"];
function useStatusPoller() {
  const q = useStatus({ poll: true });
  const data = q.data;
  const prev = useRef25(null);
  useEffect27(() => {
    if (!data) return;
    $status.set(data);
    let lines = [];
    try {
      lines = config.mascotLines(prev.current, data);
    } catch {
      lines = [];
    }
    for (const line of lines) sayToPet(line);
    prev.current = data;
  }, [data]);
  useTubeEvents(STATUS_EVENTS, () => {
    void invalidateRest("GET /status");
  });
}
function useExtrasSync() {
  const q = useRest("GET /extras", {}, { refetchInterval: EXTRAS_REFRESH_MS });
  useEffect27(() => {
    if (q.data) setExtras(q.data);
  }, [q.data]);
  useEffect27(
    () => onRawEvent(pluginEventType("settings.changed"), () => {
      void invalidateRest("GET /extras");
    }),
    []
  );
}
function useScopeRefresh() {
  const scope = useRestScope();
  const last = useRef25(scope);
  useEffect27(() => {
    if (last.current === scope) return;
    last.current = scope;
    $status.set(null);
    void invalidateRest();
  }, [scope]);
}
function ShellLeader() {
  useStatusPoller();
  useExtrasSync();
  useScopeRefresh();
  return /* @__PURE__ */ jsx38(DialogHost, {});
}
function ShellHost() {
  const leader = useLeader("shell-host");
  return leader ? /* @__PURE__ */ jsx38(ShellLeader, {}) : null;
}

// desktop-src/pages/cleanup/index.tsx
import { Button as Button25, Codicon as Codicon29, host as host15 } from "@hermes/plugin-sdk";
import { useCallback as useCallback14, useEffect as useEffect29, useId as useId6, useMemo as useMemo6, useRef as useRef27, useState as useState27 } from "react";

// desktop-src/lib/ext-notice.ts
function pickExtNotice({ status, neverPaired, needed }) {
  if (!status || neverPaired === null) return null;
  if (neverPaired) return "ext_not_paired";
  if (status.devices_online === 0 && needed) return "ext_disconnected";
  return null;
}
function useNeverPaired(enabled = true) {
  const devices = useRest("GET /devices", {}, { enabled });
  if (!enabled || devices.isError || !devices.data) return null;
  return devices.data.items.length === 0;
}

// desktop-src/pages/cleanup/actions.ts
import { host as host14 } from "@hermes/plugin-sdk";
import { useCallback as useCallback13, useEffect as useEffect28, useRef as useRef26, useState as useState26 } from "react";

// desktop-src/pages/cleanup/model.ts
var GROUPS = ["stale", "ignored", "off_profile", "manual"];
var RULE_GROUPS = ["stale", "ignored", "off_profile"];
var SAID_BY_REASON = {
  stale: ["last_video", "per_week"],
  ignored: ["watched", "per_week"],
  off_profile: [],
  manual: []
};
function trimReason(why) {
  return why.trim().replace(/\s*[.。]+$/u, "").trim();
}
var EX_RETENTION_DAYS = 30;
var UNDO_MS2 = 7e3;
var QUEUE_POLL_MS = JOB_POLL_MS;
var QUEUE_IDLE_POLL_MS = 3e4;
var QUEUE_RECENT_S = 24 * 3600;
var QUEUE_STATUSES = "approved,running,done,failed";
var LOCAL_PREFIX = "local:";
function isActive2(item) {
  return item.status === "approved" || item.status === "running";
}
function plural4(t, key, count2, fmt, vars2 = {}) {
  return t(`${key}_${count2 === 1 ? "one" : "other"}`, { ...vars2, count: fmt(count2) });
}
function localItem(channelId, action, nowS) {
  return {
    id: `${LOCAL_PREFIX}${action}:${channelId}`,
    channel_id: channelId,
    action,
    status: "approved",
    approved_at: nowS,
    approved_via: "desktop_rpc",
    created_at: nowS,
    updated_at: nowS,
    reason: null,
    error: null,
    device_id: null
  };
}
function mergeQueue(server, local, hidden, nowS) {
  const byId = /* @__PURE__ */ new Map();
  for (const it of server ?? []) byId.set(it.id, it);
  for (const it of local) {
    if (byId.has(it.id)) continue;
    if (it.id.startsWith(LOCAL_PREFIX) && [...byId.values()].some((s) => s.channel_id === it.channel_id && s.action === it.action && isActive2(s))) continue;
    byId.set(it.id, it);
  }
  return [...byId.values()].filter((it) => !hidden.has(it.id) && it.status !== "undone" && (isActive2(it) || nowS - it.updated_at <= QUEUE_RECENT_S)).sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
}
function activeChannels(queue, action) {
  return new Set(queue.filter((it) => it.action === action && isActive2(it)).map((it) => it.channel_id));
}
function groupCandidates(candidates, hiddenChannels) {
  const out = { stale: [], ignored: [], off_profile: [], manual: [] };
  const seen = /* @__PURE__ */ new Set();
  for (const c of candidates) {
    if (c.status !== "pending" || hiddenChannels.has(c.channel_id) || seen.has(c.channel_id)) continue;
    seen.add(c.channel_id);
    out[c.group]?.push(c);
  }
  return out;
}
function lacksWatchHistory(rows) {
  return !!rows && rows.length > 0 && rows.every((r) => r.watched_90d === null);
}
var NOT_HERE3 = /\b404\b|not found|expected json|got html|plugin.*(disabled|not (installed|loaded|enabled))/i;
function isPluginUnavailable(error) {
  if (!error) return false;
  if (error instanceof TubeApiError) return error.code === "plugin_disabled" || error.transport && NOT_HERE3.test(error.message);
  return toApiError(error).code === "plugin_disabled";
}
function pickBanner({
  scanPhase,
  status,
  statusFailed,
  needsExtension,
  noModel,
  providerUnavailable,
  pluginUnavailable,
  neverPaired = null,
  subscribed = null
}) {
  if (scanPhase === "error") return "scan_failed";
  if (scanPhase === "unavailable") return "scan_unavailable";
  if (scanPhase === "scanning") return "scanning";
  if (pluginUnavailable) return null;
  if (statusFailed && !status) return "server_down";
  if (status && needsExtension && !status.ext_endpoint_up) return "ext_endpoint_down";
  const ext = pickExtNotice({ status, neverPaired, needed: needsExtension || subscribed != null && subscribed > 0 });
  if (ext) return ext;
  if (noModel) return providerUnavailable ? "provider_unavailable" : "no_model";
  return null;
}
var ROUTE_PART_CHARS3 = 80;
function routePart3(value) {
  if (typeof value !== "string") return "";
  let text = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").trim();
  if (/^([/~\\]|[A-Za-z]:[\\/])/.test(text)) text = text.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  return text.length <= ROUTE_PART_CHARS3 ? text : `${text.slice(0, ROUTE_PART_CHARS3 - 1)}…`;
}
function unreachableRoute(status) {
  if (!status || status.available !== false || status.reason !== "provider_unavailable") return null;
  return [routePart3(status.provider), routePart3(status.model)].filter(Boolean).join(" · ");
}
function modelSettingsPath3() {
  return `/settings?tab=config:model&aux=${encodeURIComponent(`${PLUGIN_ID.replace(/-/g, "_")}_curator`)}`;
}
function expiresAt(row) {
  const v = row.expires_at;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// desktop-src/pages/cleanup/actions.ts
function undoErrorText(tc2, error) {
  if (error.code === "undo_refused" && error.reason === MESSAGE_KEYS.alreadyExecuted) return tc2(MESSAGE_KEYS.alreadyExecuted);
  return errorText(tc2, error);
}
var without = (set, ids) => {
  const next = new Set(set);
  for (const id of ids) next.delete(id);
  return next;
};
var withAll = (set, ids) => {
  const next = new Set(set);
  for (const id of ids) next.add(id);
  return next;
};
function useQueueActions(t, tc2, fmt) {
  const [local, setLocal] = useState26([]);
  const [hidden, setHidden] = useState26(/* @__PURE__ */ new Set());
  const refresh2 = () => void invalidateRest("GET /queue", "GET /cleanup", "GET /status", "GET /channels");
  const undo = useCallback13(
    (ids) => {
      const real = ids.filter((id) => !id.startsWith("local:"));
      if (!real.length) return;
      setHidden((h) => withAll(h, real));
      restCall("POST /queue/undo", { body: { ids: [...real] } }).then(
        (r) => {
          setLocal((l) => l.filter((it) => !real.includes(it.id)));
          refresh2();
          const n = r.items?.length || real.length;
          host14.notify({ kind: "success", message: t(`toast.undone_${n === 1 ? "one" : "other"}`, { count: fmt(n) }) });
        },
        (error) => {
          setHidden((h) => without(h, real));
          void invalidateRest("GET /queue");
          host14.notify({ kind: "error", message: t("toast.undo_failed", { error: undoErrorText(tc2, toApiError(error)) }) });
        }
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tc2, fmt]
  );
  const request = useCallback13(
    async (action, channelIds, toast) => {
      const nowS = Math.floor(Date.now() / 1e3);
      const placeholders = channelIds.map((id) => localItem(id, action, nowS));
      const ids = new Set(placeholders.map((p) => p.id));
      setLocal((l) => [...l.filter((it) => !ids.has(it.id)), ...placeholders]);
      const params = { channel_ids: [...channelIds] };
      const out = action === "unsubscribe" ? await callRpc("cleanup.approve", params) : await callRpc("cleanup.resubscribe", params);
      if (out.kind !== "ok") {
        setLocal((l) => l.filter((it) => !ids.has(it.id)));
        return out.kind === "error" ? { kind: "error", error: out.error } : { kind: "unavailable" };
      }
      const items = Array.isArray(out.data?.items) ? out.data.items : [];
      setLocal((l) => [...l.filter((it) => !ids.has(it.id)), ...items]);
      refresh2();
      host14.notify({
        kind: "success",
        message: toast(items),
        durationMs: UNDO_MS2,
        action: { label: t("toast.undo"), onClick: () => undo(items.filter((it) => it.status === "approved").map((it) => it.id)) }
      });
      return { kind: "ok", items };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, undo]
  );
  return { local, hidden, request, undo };
}
function useKeep(t, tc2) {
  const [kept, setKept] = useState26(/* @__PURE__ */ new Set());
  const pending2 = useRef26(/* @__PURE__ */ new Map());
  const mounted3 = useRef26(true);
  const release = (channelId) => {
    if (mounted3.current) setKept((k) => without(k, [channelId]));
  };
  const commit = useCallback13(
    (channelId) => {
      const entry = pending2.current.get(channelId);
      if (!entry) return;
      pending2.current.delete(channelId);
      clearTimeout(entry.timer);
      restCall("POST /cleanup/dismiss", { body: { ids: entry.candidateIds } }).then(
        // stays hidden until the new list arrives (no flicker back)
        () => invalidateRest("GET /cleanup").finally(() => release(channelId)),
        (error) => {
          release(channelId);
          host14.notify({ kind: "error", message: t("toast.keep_failed", { error: errorText(tc2, toApiError(error)) }) });
        }
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tc2]
  );
  const keep = useCallback13(
    (channelId, candidateIds, name) => {
      if (pending2.current.has(channelId) || !candidateIds.length) return;
      setKept((k) => withAll(k, [channelId]));
      const timer = setTimeout(() => commit(channelId), UNDO_MS2);
      pending2.current.set(channelId, { timer, candidateIds });
      host14.notify({
        kind: "success",
        message: t("toast.kept", { name }),
        durationMs: UNDO_MS2,
        action: {
          label: t("toast.undo"),
          onClick: () => {
            const entry = pending2.current.get(channelId);
            if (!entry) return;
            clearTimeout(entry.timer);
            pending2.current.delete(channelId);
            release(channelId);
          }
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, commit]
  );
  const commitRef = useRef26(commit);
  commitRef.current = commit;
  useEffect28(() => {
    mounted3.current = true;
    const map = pending2.current;
    return () => {
      mounted3.current = false;
      for (const id of [...map.keys()]) commitRef.current(id);
    };
  }, []);
  return { kept, keep };
}

// desktop-src/pages/cleanup/parts.tsx
import { Button as Button24, Checkbox as Checkbox4, Codicon as Codicon28 } from "@hermes/plugin-sdk";
import { Fragment as Fragment19, jsx as jsx39, jsxs as jsxs33 } from "react/jsx-runtime";
function formatDate(tsSeconds, locale) {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(tsSeconds * 1e3));
  } catch {
    return new Date(tsSeconds * 1e3).toISOString().slice(0, 10);
  }
}
function formatDecimal(value, locale) {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  } catch {
    return String(Math.round(value * 10) / 10);
  }
}
function RowList({ label, children }) {
  return /* @__PURE__ */ jsx39("div", { role: "list", "aria-label": label, className: cx("sgroup"), "data-part": "cleanup-list", children });
}
function InfoRow({ icon, text, action }) {
  return /* @__PURE__ */ jsxs33("div", { role: "listitem", className: cx("srow"), "data-part": "cleanup-info", children: [
    /* @__PURE__ */ jsx39(Codicon28, { name: icon, size: 14, className: cx("srow-arrow") }),
    /* @__PURE__ */ jsx39("div", { className: cx("srow-main"), children: /* @__PURE__ */ jsx39("div", { className: cx("srow-reason t-label"), children: text }) }),
    /* @__PURE__ */ jsx39("div", { className: cx("srow-actions"), children: action })
  ] });
}
function CandidateRow({ candidate, channel, facts, selected, onSelect, onKeep, now }) {
  const t = useT("cleanup");
  const locale = useLocale();
  const said = SAID_BY_REASON[candidate.group] ?? [];
  const fact = {
    watched: facts && facts.watched_90d != null ? t("row.watched", { count: formatDecimal(facts.watched_90d, locale) }) : null,
    last_video: channel.last_video_at ? t("row.last_video", { when: formatRelative(channel.last_video_at, now, locale) }) : t("row.no_videos"),
    per_week: channel.videos_per_week ? t("row.per_week", { count: formatDecimal(channel.videos_per_week, locale) }) : null
  };
  const order = ["watched", "last_video", "per_week"];
  const why = trimReason(candidate.why ?? "");
  const numbers = order.filter((f) => !said.includes(f)).map((f) => fact[f]).filter(Boolean).join(" · ");
  const reason = [why, numbers].filter(Boolean).join(" · ");
  return /* @__PURE__ */ jsxs33(
    "div",
    {
      role: "listitem",
      className: cx("srow"),
      "data-part": "cleanup-row",
      "data-selectable": "true",
      "data-channel": channel.id,
      "data-group": candidate.group,
      "data-selected": selected ? "true" : void 0,
      children: [
        /* @__PURE__ */ jsx39("span", { className: cx("srow-lead"), children: /* @__PURE__ */ jsx39(Checkbox4, { checked: selected, onCheckedChange: (v) => onSelect(v === true), "aria-label": t("row.select", { name: channel.title }) }) }),
        /* @__PURE__ */ jsx39("span", { className: cx("srow-lead"), children: /* @__PURE__ */ jsx39(ChannelAvatar, { title: channel.title, thumb: channel.thumb, size: 28 }) }),
        /* @__PURE__ */ jsxs33("div", { className: cx("srow-main"), children: [
          /* @__PURE__ */ jsx39("div", { className: cx("srow-line t-body"), "data-part": "row-title", children: /* @__PURE__ */ jsx39("span", { className: cx("srow-subject"), children: channel.title }) }),
          /* @__PURE__ */ jsxs33("div", { className: cx("srow-reason srow-reason-wrap t-label"), "data-part": "row-reason", title: reason, children: [
            why ? /* @__PURE__ */ jsx39("span", { "data-part": "row-why", children: why }) : null,
            why && numbers ? " · " : null,
            numbers
          ] })
        ] }),
        /* @__PURE__ */ jsx39("div", { className: cx("srow-actions"), children: /* @__PURE__ */ jsx39(Button24, { variant: "ghost", size: "xs", "data-part": "row-keep", "aria-label": t("row.keep_label", { name: channel.title }), onClick: onKeep, children: t("row.keep") }) })
      ]
    }
  );
}
function groupRule(t, group2) {
  return t(`groups.${group2}.rule`);
}
function GroupSection({ group: group2, items, channels, facts, selected, needsHistory, onSelect, onKeep, onConnect, now }) {
  const t = useT("cleanup");
  const title = t(`groups.${group2}.title`);
  const visible = items.filter((c) => channels[c.channel_id]);
  const ids = visible.map((c) => c.channel_id);
  const all = ids.length > 0 && ids.every((id) => selected.has(id));
  let body;
  if (visible.length) {
    body = visible.map((c) => {
      const ch = channels[c.channel_id];
      if (!ch) return null;
      return /* @__PURE__ */ jsx39(
        CandidateRow,
        {
          candidate: c,
          channel: ch,
          facts: facts.get(c.channel_id),
          selected: selected.has(c.channel_id),
          onSelect: (v) => onSelect([c.channel_id], v),
          onKeep: () => onKeep(c, ch),
          now
        },
        c.id
      );
    });
  } else if (group2 === "ignored" && needsHistory) {
    body = /* @__PURE__ */ jsx39(
      InfoRow,
      {
        icon: "history",
        text: t("groups.ignored.needs_history"),
        action: /* @__PURE__ */ jsx39(Button24, { variant: "ghost", size: "xs", onClick: onConnect, children: t("actions.connect") })
      }
    );
  } else {
    return null;
  }
  return /* @__PURE__ */ jsx39("div", { "data-part": "cleanup-group", "data-group": group2, children: /* @__PURE__ */ jsx39(
    Section,
    {
      title,
      count: visible.length,
      description: groupRule(t, group2),
      actions: ids.length ? /* @__PURE__ */ jsx39(Button24, { variant: "ghost", size: "xs", "data-part": "group-select", "aria-pressed": all, onClick: () => onSelect(ids, !all), children: all ? t("groups.clear") : t("groups.select_all", { count: ids.length }) }) : null,
      children: /* @__PURE__ */ jsx39(RowList, { label: t("groups.label", { group: title }), children: body })
    }
  ) });
}
function GroupsSkeleton({ label }) {
  const t = useT("cleanup");
  return /* @__PURE__ */ jsx39(Fragment19, { children: RULE_GROUPS.map((g, i) => /* @__PURE__ */ jsx39("div", { "data-part": "cleanup-group", "data-group": g, "data-skeleton": true, "aria-busy": "true", "aria-label": label, children: /* @__PURE__ */ jsx39(Section, { title: t(`groups.${g}.title`), description: groupRule(t, g), children: /* @__PURE__ */ jsx39(RowList, { label: t(`groups.${g}.title`), children: Array.from({ length: 3 - i % 2 }, (_, k) => /* @__PURE__ */ jsx39(SuggestionRowSkeleton, { selectable: true }, k)) }) }) }, g)) });
}
var STEP_STATUS = { approved: "waiting", running: "running", done: "done", failed: "failed", undone: "waiting" };
var DONE_NOTES = ["not_subscribed", "already_subscribed"];
var doneNote = (error) => {
  const note = error?.trim();
  return DONE_NOTES.includes(note ?? "") ? note : null;
};
function QueueSection({ items, channelName, offline, onUndo, now }) {
  const t = useT("cleanup");
  const locale = useLocale();
  const fmt = (n) => new Intl.NumberFormat(locale).format(n);
  const undoable = items.filter((it) => it.status === "approved" && !it.id.startsWith("local:"));
  const pending2 = items.filter(isActive2).length;
  const steps = items.map((it) => {
    const name = channelName(it.channel_id);
    let text;
    if (it.status === "approved") text = offline ? t("queue.status.approved_offline") : t("queue.status.approved");
    else if (it.status === "running") text = t("queue.status.running");
    else if (it.status === "done") {
      text = t("queue.status.done", { when: formatRelative(it.updated_at, now, locale) });
      const note = doneNote(it.error);
      if (note) text = `${text} · ${t(`queue.note.${note}`)}`;
    } else text = it.error?.trim() ? t("queue.status.failed", { reason: it.error.trim() }) : t("queue.status.failed_unknown");
    const canUndo = it.status === "approved" && !it.id.startsWith("local:");
    return {
      id: it.id,
      label: name,
      status: STEP_STATUS[it.status],
      detail: /* @__PURE__ */ jsxs33(Fragment19, { children: [
        t(`queue.action.${it.action}`),
        " · ",
        text,
        canUndo ? /* @__PURE__ */ jsxs33(Fragment19, { children: [
          " ",
          /* @__PURE__ */ jsx39(Button24, { variant: "ghost", size: "xs", "data-part": "queue-undo", "aria-label": t("queue.undo_label", { name }), onClick: () => onUndo([it.id]), children: t("queue.undo") })
        ] }) : null
      ] })
    };
  });
  return /* @__PURE__ */ jsx39("div", { "data-part": "cleanup-queue", children: /* @__PURE__ */ jsx39(
    Section,
    {
      title: t("queue.title"),
      count: pending2 || null,
      description: t("queue.description"),
      actions: undoable.length > 1 ? /* @__PURE__ */ jsxs33(Button24, { variant: "ghost", size: "xs", "data-part": "queue-undo-all", onClick: () => onUndo(undoable.map((it) => it.id)), children: [
        /* @__PURE__ */ jsx39(Codicon28, { name: "discard", size: 13 }),
        plural4(t, "queue.undo_all", undoable.length, fmt)
      ] }) : null,
      children: /* @__PURE__ */ jsx39(StepProgress, { steps, label: t("queue.label") })
    }
  ) });
}
function ExSection({ rows, error, queued, onResubscribe, onRetry, now }) {
  const t = useT("cleanup");
  const locale = useLocale();
  let body;
  if (rows) {
    body = rows.length ? /* @__PURE__ */ jsx39(RowList, { label: t("ex.label"), children: rows.map((r) => {
      const ch = r.channel;
      const until = expiresAt(r);
      const meta = [
        ch.unsubscribed_at ? t("ex.cancelled", { when: formatRelative(ch.unsubscribed_at, now, locale) }) : null,
        until ? t("ex.until", { date: formatDate(until, locale) }) : null
      ].filter(Boolean);
      const inQueue = queued.has(ch.id);
      return /* @__PURE__ */ jsxs33("div", { role: "listitem", className: cx("srow"), "data-part": "ex-row", "data-selectable": "true", "data-channel": ch.id, children: [
        /* @__PURE__ */ jsx39("span", { className: cx("srow-lead") }),
        /* @__PURE__ */ jsx39("span", { className: cx("srow-lead"), children: /* @__PURE__ */ jsx39(ChannelAvatar, { title: ch.title, thumb: ch.thumb, size: 28 }) }),
        /* @__PURE__ */ jsxs33("div", { className: cx("srow-main"), children: [
          /* @__PURE__ */ jsx39("div", { className: cx("srow-line t-body"), "data-part": "row-title", children: /* @__PURE__ */ jsx39("span", { className: cx("srow-subject"), children: ch.title }) }),
          /* @__PURE__ */ jsx39("div", { className: cx("srow-reason srow-reason-wrap t-label"), "data-part": "row-reason", children: meta.join(" · ") || ch.handle || " " })
        ] }),
        /* @__PURE__ */ jsx39("div", { className: cx("srow-actions"), children: inQueue ? /* @__PURE__ */ jsxs33("span", { className: cx("srow-status t-label"), "data-part": "ex-queued", children: [
          /* @__PURE__ */ jsx39(Codicon28, { name: "clock", size: 12 }),
          t("ex.queued")
        ] }) : /* @__PURE__ */ jsx39(Button24, { variant: "outline", size: "xs", "data-part": "ex-resubscribe", "aria-label": t("ex.resubscribe_label", { name: ch.title }), onClick: () => onResubscribe(ch), children: t("ex.resubscribe") }) })
      ] }, ch.id);
    }) }) : /* @__PURE__ */ jsx39(RowList, { label: t("ex.label"), children: /* @__PURE__ */ jsx39(InfoRow, { icon: "history", text: t("ex.empty", { days: EX_RETENTION_DAYS }) }) });
  } else if (error) {
    body = /* @__PURE__ */ jsx39(ErrorView, { compact: true, title: t("ex.error"), error, onRetry });
  } else {
    body = /* @__PURE__ */ jsxs33(RowList, { label: t("ex.label"), children: [
      /* @__PURE__ */ jsx39(SuggestionRowSkeleton, { selectable: true }),
      /* @__PURE__ */ jsx39(SuggestionRowSkeleton, { selectable: true })
    ] });
  }
  return /* @__PURE__ */ jsx39("div", { "data-part": "cleanup-ex", children: /* @__PURE__ */ jsx39(Section, { title: t("ex.title"), count: rows ? rows.length : null, description: t("ex.description", { days: EX_RETENTION_DAYS }), children: body }) });
}
var CRITERIA = [
  ["stale", "history"],
  ["ignored", "eye-closed"],
  ["off_profile", "compass"]
];
function NeverScanned({ onScan, children }) {
  const t = useT("cleanup");
  return /* @__PURE__ */ jsxs33("div", { className: cx("state"), "data-part": "empty", "data-kind": "never", children: [
    /* @__PURE__ */ jsx39(Hero, { icon: "search", title: t("empty.never_title"), description: t("empty.never_desc") }),
    /* @__PURE__ */ jsx39("div", { role: "list", "aria-label": t("empty.criteria.label"), className: cx("stack"), "data-gap": "2", "data-align": "start", "data-part": "cleanup-criteria", children: CRITERIA.map(([group2, icon]) => /* @__PURE__ */ jsxs33("div", { role: "listitem", className: cx("stack t-body"), "data-direction": "row", "data-gap": "2", "data-align": "start", children: [
      /* @__PURE__ */ jsx39(Codicon28, { name: icon, size: 16 }),
      /* @__PURE__ */ jsx39("span", { children: t(`empty.criteria.${group2}`) })
    ] }, group2)) }),
    /* @__PURE__ */ jsxs33(Button24, { size: "sm", onClick: onScan, children: [
      /* @__PURE__ */ jsx39(Codicon28, { name: "search", size: 14 }),
      t("actions.scan_first")
    ] }),
    children
  ] });
}

// desktop-src/pages/cleanup/index.tsx
import { Fragment as Fragment20, jsx as jsx40, jsxs as jsxs34 } from "react/jsx-runtime";
var CLOCK_MS = 3e4;
var PREVIEW_NAMES = 6;
var APPROVAL_LIST_MAX_PX = 232;
function useNow(ms) {
  const [now, setNow] = useState27(() => Date.now());
  useEffect29(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
function CleanupPage() {
  return /* @__PURE__ */ jsx40(CleanupView, {});
}
function CleanupView({ initialSelected, initialReview, scanJobId, initialShowAll } = {}) {
  const t = useT("cleanup");
  const tc2 = useT();
  const locale = useLocale();
  const fmt = useFormatCount();
  const now = useNow(CLOCK_MS);
  const nowS = Math.floor(now / 1e3);
  const cleanupQ = useRest("GET /cleanup", {});
  const statusQ = useStatus();
  const status = statusQ.data;
  const neverPaired = useNeverPaired();
  const queueQ = useRest(
    "GET /queue",
    { query: { status: QUEUE_STATUSES, limit: 200 } },
    { refetchInterval: (data) => data && data.pending > 0 ? QUEUE_POLL_MS : QUEUE_IDLE_POLL_MS }
  );
  const exQ = useRest("GET /channels", { query: { relation: "ex", limit: 500 } });
  const historyQ = useRest("GET /channels", { query: { relation: "subscribed", limit: 1 } });
  const scanData = cleanupQ.data?.scan ?? null;
  const aiStatus = useAiStatus(!!scanData && scanData.model == null);
  const candidateIds = useMemo6(() => [...new Set((scanData?.candidates ?? []).map((c) => c.channel_id))].sort(), [scanData]);
  const factsQ = useRest("GET /channels", { query: { ids: candidateIds.join(","), limit: Math.max(1, candidateIds.length) } }, { enabled: candidateIds.length > 0 });
  const facts = useMemo6(() => new Map((factsQ.data?.items ?? []).map((r) => [r.channel.id, r])), [factsQ.data]);
  useTubeEvents(["queue.changed", "cleanup.scanned"], (name) => {
    if (name === "queue.changed") void invalidateRest("GET /queue", "GET /status");
    else void invalidateRest("GET /cleanup");
  });
  const scan = useRpcJob("cleanup.scan", scanJobId ?? null);
  const startScan = useCallback14(() => void scan.start({}), [scan]);
  useEffect29(() => {
    if (scan.phase !== "done") return;
    void invalidateRest("GET /cleanup", "GET /channels").finally(() => scan.reset());
  }, [scan.phase]);
  const scanning = scan.phase === "starting" || scan.phase === "running" || scan.phase === "done";
  const queueActions = useQueueActions(t, tc2, fmt);
  const { kept, keep } = useKeep(t, tc2);
  const queue = useMemo6(
    () => mergeQueue(queueQ.data?.items, queueActions.local, queueActions.hidden, nowS),
    [queueQ.data, queueActions.local, queueActions.hidden, nowS]
  );
  const unsubscribing = useMemo6(() => activeChannels(queue, "unsubscribe"), [queue]);
  const resubscribing = useMemo6(() => activeChannels(queue, "resubscribe"), [queue]);
  const doneSeen = useRef27(null);
  useEffect29(() => {
    const done = new Set((queueQ.data?.items ?? []).filter((it) => it.status === "done" || it.status === "failed").map((it) => it.id));
    const before = doneSeen.current;
    doneSeen.current = done;
    if (before && [...done].some((id) => !before.has(id))) void invalidateRest("GET /channels", "GET /cleanup");
  }, [queueQ.data]);
  const known = useRef27(/* @__PURE__ */ new Map());
  for (const ch of Object.values(cleanupQ.data?.channels ?? {})) known.current.set(ch.id, ch);
  for (const r of exQ.data?.items ?? []) known.current.set(r.channel.id, r.channel);
  for (const r of factsQ.data?.items ?? []) if (!known.current.has(r.channel.id)) known.current.set(r.channel.id, r.channel);
  const unknownIds = [...new Set(queue.map((it) => it.channel_id))].filter((id) => !known.current.has(id)).sort();
  const lookupQ = useRest("GET /channels", { query: { ids: unknownIds.join(","), limit: Math.max(1, unknownIds.length) } }, { enabled: unknownIds.length > 0 });
  for (const r of lookupQ.data?.items ?? []) known.current.set(r.channel.id, r.channel);
  const channelName = (id) => known.current.get(id)?.title ?? t("queue.unknown_channel", { id });
  const hiddenChannels = useMemo6(() => /* @__PURE__ */ new Set([...kept, ...unsubscribing]), [kept, unsubscribing]);
  const groups2 = useMemo6(() => groupCandidates(scanData?.candidates ?? [], hiddenChannels), [scanData, hiddenChannels]);
  const channels = cleanupQ.data?.channels ?? {};
  const visibleIds = useMemo6(() => new Set(GROUPS.flatMap((g) => groups2[g].map((c) => c.channel_id)).filter((id) => channels[id])), [groups2, channels]);
  const visibleCount = visibleIds.size;
  const [selectedRaw, setSelected] = useState27(() => new Set(initialSelected ?? []));
  const selected = useMemo6(() => new Set([...selectedRaw].filter((id) => visibleIds.has(id))), [selectedRaw, visibleIds]);
  const select = useCallback14((ids, on) => {
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);
  const [review, setReview] = useState27(() => initialReview && initialSelected?.length ? { kind: "unsubscribe" } : null);
  const [problem, setProblem] = useState27(null);
  const [busy, setBusy] = useState27(false);
  const [showAll, setShowAll] = useState27(!!initialShowAll);
  const listId = useId6();
  const returnFocus = useRef27(null);
  const openReview = (r) => {
    returnFocus.current = typeof document !== "undefined" ? document.activeElement : null;
    setProblem(null);
    setShowAll(false);
    setReview(r);
  };
  const closeReview = useCallback14(() => {
    setReview(null);
    setProblem(null);
    setShowAll(false);
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el && el.isConnected) setTimeout(() => el.focus(), 0);
  }, []);
  const loaded = !!cleanupQ.data;
  useEffect29(() => {
    if (loaded && review?.kind === "unsubscribe" && selected.size === 0 && !busy) setReview(null);
  }, [loaded, review, selected.size, busy]);
  const confirm = async () => {
    if (!review || busy) return;
    setBusy(true);
    setProblem(null);
    let out;
    if (review.kind === "unsubscribe") {
      const ids = [...selected];
      out = await queueActions.request("unsubscribe", ids, (items) => plural4(t, "toast.queued", items.length || ids.length, fmt));
      if (out.kind === "ok") select(ids, false);
    } else {
      const ch = review.channel;
      out = await queueActions.request("resubscribe", [ch.id], () => t("toast.resub_queued", { name: ch.title }));
    }
    setBusy(false);
    if (out.kind === "ok") closeReview();
    else setProblem(out.kind === "error" ? { kind: "error", error: out.error } : { kind: "unavailable" });
  };
  const guardKeys = (e) => {
    if (e.key === "Enter" && e.target?.closest?.('[data-part="approval-confirm"]')) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const escape = (e) => {
    if (e.key === "Escape" && !busy) {
      e.preventDefault();
      closeReview();
    }
  };
  const offline = !!status && (status.devices_online === 0 || !status.ext_endpoint_up);
  let approval = null;
  if (review) {
    const problemNode = problem?.kind === "unavailable" ? /* @__PURE__ */ jsx40(RpcUnavailableNotice, {}) : problem?.kind === "error" ? /* @__PURE__ */ jsx40(Banner, { tone: "error", children: problem.error.code === "approval_refused" ? t("approve.refused") : t("approve.failed", { error: errorText(tc2, problem.error) }) }) : null;
    if (review.kind === "unsubscribe") {
      const count2 = selected.size;
      const chosen = [...selected].map((id) => channels[id]).filter((c) => !!c);
      const names = chosen.slice(0, PREVIEW_NAMES).map((c) => c.title);
      const rest = chosen.length - names.length;
      approval = /* @__PURE__ */ jsxs34(
        ApprovalCard,
        {
          title: plural4(t, "approve.title", count2, fmt),
          description: t("approve.description"),
          effects: [
            plural4(t, "approve.effect", count2, fmt),
            t("approve.effect_resubscribe", { days: EX_RETENTION_DAYS }),
            offline ? t("approve.effect_offline") : t("approve.effect_undo")
          ],
          confirmLabel: plural4(t, "approve.confirm", count2, fmt),
          onConfirm: () => void confirm(),
          onCancel: closeReview,
          busy,
          autoFocus: true,
          children: [
            /* @__PURE__ */ jsxs34(Stack, { direction: "row", gap: 2, align: "center", wrap: true, children: [
              showAll ? null : /* @__PURE__ */ jsxs34(Fragment20, { children: [
                /* @__PURE__ */ jsx40(Stack, { direction: "row", gap: 1, align: "center", children: chosen.slice(0, PREVIEW_NAMES).map((c) => /* @__PURE__ */ jsx40(ChannelAvatar, { title: c.title, thumb: c.thumb, size: 20 }, c.id)) }),
                /* @__PURE__ */ jsxs34("span", { className: cx("t-label"), children: [
                  names.join(" · "),
                  rest > 0 ? ` ${t("approve.more", { count: fmt(rest) })}` : ""
                ] })
              ] }),
              rest > 0 ? /* @__PURE__ */ jsxs34(
                Button25,
                {
                  variant: "ghost",
                  size: "xs",
                  "data-part": "approval-show-all",
                  "aria-expanded": showAll,
                  "aria-controls": listId,
                  onClick: () => setShowAll((v) => !v),
                  children: [
                    /* @__PURE__ */ jsx40(Codicon29, { name: showAll ? "chevron-up" : "chevron-down", size: 13 }),
                    showAll ? t("approve.show_less") : t("approve.show_all", { count: fmt(chosen.length) })
                  ]
                }
              ) : null
            ] }),
            showAll && rest > 0 ? (
              // full list inside the card: scrolls inside, max height (the kit has no class for it)
              /* @__PURE__ */ jsx40(
                "div",
                {
                  id: listId,
                  role: "list",
                  "aria-label": t("approve.list_label"),
                  className: cx("sgroup"),
                  "data-part": "approval-list",
                  tabIndex: 0,
                  style: { maxHeight: APPROVAL_LIST_MAX_PX, overflowY: "auto", overscrollBehavior: "contain" },
                  children: chosen.map((c) => /* @__PURE__ */ jsxs34("div", { role: "listitem", className: cx("srow"), "data-part": "approval-list-item", "data-channel": c.id, children: [
                    /* @__PURE__ */ jsx40(ChannelAvatar, { title: c.title, thumb: c.thumb, size: 20 }),
                    /* @__PURE__ */ jsx40("div", { className: cx("srow-main"), children: /* @__PURE__ */ jsx40("div", { className: cx("srow-line t-body"), children: /* @__PURE__ */ jsx40("span", { className: cx("srow-subject"), children: c.title }) }) }),
                    /* @__PURE__ */ jsx40("div", { className: cx("srow-actions") })
                  ] }, c.id))
                }
              )
            ) : null,
            problemNode
          ]
        }
      );
    } else {
      const ch = review.channel;
      approval = /* @__PURE__ */ jsx40(
        ApprovalCard,
        {
          title: t("resub.title", { name: ch.title }),
          description: t("resub.description"),
          effects: [t("resub.effect", { name: ch.title }), offline ? t("approve.effect_offline") : t("resub.effect_undo")],
          confirmLabel: t("resub.confirm", { name: ch.title }),
          onConfirm: () => void confirm(),
          onCancel: closeReview,
          busy,
          tone: "default",
          autoFocus: true,
          children: problemNode
        }
      );
    }
  }
  const hasScan = !!scanData;
  let toolbar = null;
  if (approval) {
    toolbar = /* @__PURE__ */ jsx40("div", { "data-part": "approval-wrap", onKeyDownCapture: guardKeys, onKeyDown: escape, children: approval });
  } else if (hasScan && visibleCount > 0) {
    const count2 = selected.size;
    toolbar = /* @__PURE__ */ jsx40("div", { "data-part": "selection-bar", "aria-label": t("selection.label"), role: "group", children: /* @__PURE__ */ jsx40(
      Toolbar,
      {
        end: /* @__PURE__ */ jsxs34(Fragment20, { children: [
          count2 > 0 ? /* @__PURE__ */ jsx40(Button25, { variant: "ghost", size: "sm", onClick: () => setSelected(/* @__PURE__ */ new Set()), children: t("selection.clear") }) : null,
          /* @__PURE__ */ jsxs34(Button25, { size: "sm", "data-part": "review", disabled: count2 === 0, onClick: () => openReview({ kind: "unsubscribe" }), children: [
            /* @__PURE__ */ jsx40(Codicon29, { name: "shield", size: 14 }),
            count2 > 0 ? plural4(t, "selection.review", count2, fmt) : t("selection.review_none")
          ] })
        ] }),
        children: /* @__PURE__ */ jsx40("span", { className: cx("t-label"), "aria-live": "polite", children: count2 > 0 ? plural4(t, "selection.count", count2, fmt) : t("selection.none") })
      }
    ) });
  }
  const needsExtension = queue.some((it) => it.status === "approved") || visibleCount > 0;
  const pluginUnavailable = isPluginUnavailable(statusQ.error) || isPluginUnavailable(cleanupQ.error);
  const noModel = hasScan && scanData?.model == null && visibleCount > 0;
  const aiRoute = unreachableRoute(aiStatus);
  const bannerKind = pickBanner({
    scanPhase: scan.phase === "error" ? "error" : scan.phase === "unavailable" ? "unavailable" : scanning ? "scanning" : "idle",
    status,
    statusFailed: !!statusQ.error,
    pluginUnavailable,
    needsExtension,
    noModel,
    providerUnavailable: aiRoute !== null,
    neverPaired,
    subscribed: typeof status?.subscribed_total === "number" ? status.subscribed_total : null
  });
  let banner = null;
  const progress = scan.progress;
  if (bannerKind === "scan_failed" && scan.error) {
    banner = /* @__PURE__ */ jsx40(Banner, { tone: "error", action: { label: t("banner.retry"), onClick: startScan }, onDismiss: scan.reset, children: t("banner.scan_failed", { error: errorText(tc2, scan.error) }) });
  } else if (bannerKind === "scan_unavailable") {
    banner = /* @__PURE__ */ jsx40(Banner, { tone: "info", icon: "plug", onDismiss: scan.reset, children: tc2(MESSAGE_KEYS.openDesktopBackend) });
  } else if (bannerKind === "scanning") {
    banner = /* @__PURE__ */ jsx40(Banner, { tone: "info", icon: "sync", children: progress && progress.total ? t("banner.scanning_progress", { done: fmt(progress.done), total: fmt(progress.total) }) : t("banner.scanning") });
  } else if (bannerKind === "server_down") {
    banner = /* @__PURE__ */ jsx40(Banner, { tone: "warning", action: { label: t("banner.retry"), onClick: () => void statusQ.refetch() }, children: t("banner.server_down") });
  } else if (bannerKind === "ext_endpoint_down") {
    banner = /* @__PURE__ */ jsx40(Banner, { tone: "warning", icon: "debug-disconnect", children: t("banner.ext_endpoint_down") });
  } else if (bannerKind === "ext_not_paired") {
    banner = /* @__PURE__ */ jsx40(Banner, { tone: "info", icon: "extensions", action: { label: t("banner.connect"), onClick: () => openDialog("onboarding", { step: "pair" }) }, children: t("banner.ext_not_paired") });
  } else if (bannerKind === "ext_disconnected") {
    banner = /* @__PURE__ */ jsx40(Banner, { tone: "info", icon: "debug-disconnect", action: { label: t("banner.reconnect"), onClick: () => openDialog("onboarding", { step: "pair" }) }, children: t("banner.ext_disconnected") });
  } else if (bannerKind === "provider_unavailable") {
    banner = /* @__PURE__ */ jsx40(Banner, { tone: "warning", icon: "sparkle", action: { label: t("banner.provider_unavailable_action"), onClick: () => host15.navigate(modelSettingsPath3()) }, children: aiRoute ? t("banner.provider_unavailable", { route: aiRoute }) : t("banner.provider_unavailable_plain") });
  } else if (bannerKind === "no_model") {
    banner = /* @__PURE__ */ jsx40(Banner, { tone: "info", icon: "sparkle", children: t("banner.no_model") });
  }
  let subtitle = " ";
  if (scanData) {
    const by = scanData.model ? t("subtitle.by_model", { model: scanData.model }) : t("subtitle.by_rule");
    subtitle = `${t("subtitle.last_scan", { when: formatRelative(scanData.created_at, now, locale) })} · ${by}`;
  } else if (cleanupQ.data) {
    subtitle = scanning ? t("subtitle.scanning") : t("subtitle.never");
  } else if (cleanupQ.error) {
    subtitle = t("subtitle.error");
  }
  const neverScanned = !!cleanupQ.data && !scanData && !scanning;
  const actions = neverScanned ? null : /* @__PURE__ */ jsxs34(Button25, { variant: "outline", size: "sm", loading: scanning, disabled: scanning || !cleanupQ.data, onClick: startScan, children: [
    /* @__PURE__ */ jsx40(Codicon29, { name: "refresh", size: 14 }),
    t("actions.scan")
  ] });
  const connect = () => openDialog("onboarding", { step: "pair" });
  const queueNode = queue.length ? /* @__PURE__ */ jsx40(QueueSection, { items: queue, channelName, offline, onUndo: queueActions.undo, now }) : null;
  const exNode = /* @__PURE__ */ jsx40(
    ExSection,
    {
      rows: exQ.data?.items,
      error: exQ.error,
      queued: resubscribing,
      onResubscribe: (ch) => openReview({ kind: "resubscribe", channel: ch }),
      onRetry: () => void exQ.refetch(),
      now
    }
  );
  let main;
  if (!cleanupQ.data && cleanupQ.error) {
    main = /* @__PURE__ */ jsx40(
      ErrorView,
      {
        error: cleanupQ.error,
        description: isPluginUnavailable(cleanupQ.error) ? tc2("errors.plugin_disabled") : void 0,
        onRetry: () => void cleanupQ.refetch()
      }
    );
  } else if (!cleanupQ.data || !scanData && scanning) {
    main = /* @__PURE__ */ jsx40(GroupsSkeleton, { label: scanning ? t("subtitle.scanning") : t("groups.loading") });
  } else if (!scanData) {
    main = /* @__PURE__ */ jsx40(NeverScanned, { onScan: startScan, children: scan.phase === "unavailable" ? /* @__PURE__ */ jsx40(RpcUnavailableNotice, {}) : null });
  } else if (visibleCount === 0) {
    main = /* @__PURE__ */ jsx40(
      EmptyView,
      {
        icon: "check-all",
        title: t("empty.clean_title"),
        description: t("empty.clean_desc", { when: formatRelative(scanData.created_at, now, locale) }),
        action: /* @__PURE__ */ jsx40(Button25, { variant: "outline", size: "sm", onClick: () => showSection("home"), children: t("actions.home") })
      }
    );
  } else {
    const shown = GROUPS;
    main = /* @__PURE__ */ jsx40(Fragment20, { children: shown.map((g) => /* @__PURE__ */ jsx40(
      GroupSection,
      {
        group: g,
        items: groups2[g],
        channels,
        facts,
        selected,
        needsHistory: g === "ignored" && lacksWatchHistory(historyQ.data?.items),
        onSelect: select,
        onKeep: (c, ch) => {
          select([ch.id], false);
          keep(
            ch.id,
            (scanData.candidates ?? []).filter((x) => x.channel_id === c.channel_id && x.status === "pending").map((x) => x.id),
            ch.title
          );
        },
        onConnect: connect,
        now
      },
      g
    )) });
  }
  return (
    // section selector (Subscriptions · Manage · Cleanup), the same on all three screens
    /* @__PURE__ */ jsx40(SectionFrame, { current: "cleanup", children: /* @__PURE__ */ jsxs34(Page, { title: t("title"), subtitle, actions, toolbar, banner, children: [
      queueNode,
      main,
      cleanupQ.data ? exNode : null
    ] }) })
  );
}

// desktop-src/pages/extras/index.tsx
import { jsx as jsx41 } from "react/jsx-runtime";
function ExtrasPage() {
  const t = useT();
  return /* @__PURE__ */ jsx41(SectionFrame, { current: "extras", children: /* @__PURE__ */ jsx41(Page, { title: t("routes.extras"), children: /* @__PURE__ */ jsx41(EmptyView, { title: t("placeholder.title"), description: t("placeholder.description") }) }) });
}

// desktop-src/pages/home/index.tsx
import {
  Button as Button30,
  Codicon as Codicon34,
  ConfirmDialog as ConfirmDialog2,
  DropdownMenu as DropdownMenu4,
  DropdownMenuContent as DropdownMenuContent4,
  DropdownMenuItem as DropdownMenuItem4,
  DropdownMenuTrigger as DropdownMenuTrigger4,
  Tip as Tip4,
  host as host21
} from "@hermes/plugin-sdk";
import { useCallback as useCallback18, useEffect as useEffect33, useLayoutEffect as useLayoutEffect7, useMemo as useMemo7, useRef as useRef32, useState as useState34 } from "react";

// desktop-src/components/PlaylistPicker.tsx
import { Button as Button26, Checkbox as Checkbox5, Codicon as Codicon30, Input as Input6, host as host16 } from "@hermes/plugin-sdk";
import { useState as useState28 } from "react";
import { jsx as jsx42, jsxs as jsxs35 } from "react/jsx-runtime";
var PLAYLIST_NAME_MAX = 80;
function invalidatePlaylists() {
  return invalidateRest("GET /playlists", "GET /playlists/{id}");
}
function playlistCountKey(count2) {
  return count2 === 1 ? "count_one" : "count";
}
function PlaylistPicker() {
  const pick = usePlaylistPick();
  if (!pick) return null;
  return /* @__PURE__ */ jsx42(PickerDialog, { item: pick.item }, pick.item.video.id);
}
function PickerDialog({ item }) {
  const t = useT();
  const videoId = item.video.id;
  const listQ = useRest("GET /playlists", { query: { video_id: videoId } });
  const [local, setLocal] = useState28({});
  const [busy, setBusy] = useState28(/* @__PURE__ */ new Set());
  const [creating, setCreating] = useState28(false);
  const [name, setName] = useState28("");
  const [saving, setSaving] = useState28(false);
  const items = listQ.data?.items ?? [];
  const member = new Set(listQ.data?.member_of ?? []);
  const isChecked = (id) => local[id] ?? member.has(id);
  const fail = (error) => host16.notify({ kind: "error", message: t("playlists.failed", { error: errorText(t, toApiError(error)) }) });
  const setBusyFor = (id, on) => setBusy((s) => {
    const next = new Set(s);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });
  const toggle = (p, on) => {
    if (busy.has(p.id)) return;
    const before = isChecked(p.id);
    setLocal((m) => ({ ...m, [p.id]: on }));
    setBusyFor(p.id, true);
    const call = on ? restCall("POST /playlists/{id}/items", { path: { id: p.id }, body: { video_ids: [videoId] } }) : restCall("POST /playlists/{id}/items/remove", { path: { id: p.id }, body: { video_ids: [videoId] } });
    call.then(
      () => {
        setBusyFor(p.id, false);
        host16.notify({ kind: "success", message: t(on ? "playlists.saved" : "playlists.removed", { name: p.name }) });
        void invalidatePlaylists();
      },
      (error) => {
        setBusyFor(p.id, false);
        setLocal((m) => ({ ...m, [p.id]: before }));
        fail(error);
      }
    );
  };
  const clean = name.replace(/\s+/g, " ").trim();
  const create = () => {
    if (!clean || saving) return;
    setSaving(true);
    restCall("POST /playlists", { body: { name: clean, video_ids: [videoId] } }).then(
      (made) => {
        setSaving(false);
        setCreating(false);
        setName("");
        setLocal((m) => ({ ...m, [made.id]: true }));
        host16.notify({ kind: "success", message: t("playlists.saved", { name: made.name }) });
        void invalidatePlaylists();
      },
      (error) => {
        setSaving(false);
        fail(error);
      }
    );
  };
  const onNameKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      create();
    }
  };
  const footer = /* @__PURE__ */ jsx42(Button26, { variant: "secondary", size: "sm", "data-part": "playlist-picker-done", onClick: closePlaylistPicker, children: t("playlists.picker.done") });
  return /* @__PURE__ */ jsx42(DialogFrame, { size: "sm", title: t("playlists.picker.title"), description: t("playlists.picker.description"), onClose: closePlaylistPicker, footer, children: /* @__PURE__ */ jsx42("div", { "data-part": "playlist-picker", "data-video": videoId, children: /* @__PURE__ */ jsxs35(Stack, { gap: 2, children: [
    /* @__PURE__ */ jsx42("p", { className: cx("t-label"), children: item.video.title }),
    listQ.error && !listQ.data ? /* @__PURE__ */ jsx42("p", { className: cx("t-body"), role: "alert", children: t("playlists.failed", { error: errorText(t, toApiError(listQ.error)) }) }) : !listQ.data ? /* @__PURE__ */ jsx42("p", { className: cx("t-label"), role: "status", children: t("playlists.picker.loading") }) : items.length === 0 ? /* @__PURE__ */ jsx42("p", { className: cx("t-body"), children: t("playlists.picker.empty") }) : /* @__PURE__ */ jsx42("div", { role: "group", "aria-label": t("playlists.picker.title"), children: /* @__PURE__ */ jsx42(Stack, { gap: 1, children: items.map((p) => /* @__PURE__ */ jsx42("label", { "data-part": "playlist-option", "data-playlist": p.id, children: /* @__PURE__ */ jsxs35(Stack, { direction: "row", gap: 2, align: "center", children: [
      /* @__PURE__ */ jsx42(Checkbox5, { checked: isChecked(p.id), disabled: busy.has(p.id), onCheckedChange: (v) => toggle(p, v === true), "aria-label": p.name }),
      /* @__PURE__ */ jsx42("span", { className: cx("t-body"), children: p.name }),
      /* @__PURE__ */ jsx42("span", { className: cx("t-label num"), children: t(`playlists.${playlistCountKey(p.count)}`, { count: p.count }) })
    ] }) }, p.id)) }) }),
    creating ? /* @__PURE__ */ jsxs35(Stack, { direction: "row", gap: 2, align: "center", children: [
      /* @__PURE__ */ jsx42(
        Input6,
        {
          "data-part": "playlist-new-name",
          "aria-label": t("playlists.picker.name_label"),
          placeholder: t("playlists.picker.name_placeholder"),
          maxLength: PLAYLIST_NAME_MAX,
          autoFocus: true,
          value: name,
          onChange: (e) => setName(e.target.value),
          onKeyDown: onNameKey
        }
      ),
      /* @__PURE__ */ jsx42(Button26, { variant: "secondary", size: "sm", "data-part": "playlist-new-create", disabled: !clean, loading: saving, onClick: create, children: t("playlists.picker.create") }),
      /* @__PURE__ */ jsx42(Button26, { variant: "ghost", size: "sm", "data-part": "playlist-new-cancel", onClick: () => setCreating(false), children: t("playlists.picker.cancel") })
    ] }) : /* @__PURE__ */ jsxs35(Button26, { variant: "ghost", size: "sm", "data-part": "playlist-new", onClick: () => setCreating(true), children: [
      /* @__PURE__ */ jsx42(Codicon30, { name: "add", size: 14 }),
      t("playlists.picker.new")
    ] })
  ] }) }) });
}

// desktop-src/lib/pane-visibility.ts
import { host as host17 } from "@hermes/plugin-sdk";
import { useCallback as useCallback15, useSyncExternalStore } from "react";
var PANE_TREE_ID = `${PLUGIN_ID}:${PANE_ID}`;
var RIGHT_SIDEBAR_ACTION = "view.toggleRightSidebar";
var paneHost = () => host17;
function paneControlsAvailable() {
  const h = paneHost();
  return typeof h.paneVisibility === "function" && typeof h.revealPane === "function";
}
function paneShownAtom() {
  const h = paneHost();
  if (typeof h.paneVisibility !== "function") return null;
  try {
    return h.paneVisibility(PANE_TREE_ID);
  } catch {
    return null;
  }
}
function showPane() {
  const h = paneHost();
  if (typeof h.revealPane !== "function") return false;
  h.revealPane(PANE_TREE_ID);
  return true;
}
function hidePane() {
  const shown = paneShownAtom();
  const run = maybePluginContext()?.runAction;
  if (!shown || typeof run !== "function") return "unavailable";
  for (let i = 0; i < 2 && shown.get(); i++) {
    const out = run(RIGHT_SIDEBAR_ACTION);
    if (!out?.ok) return "unavailable";
  }
  if (!shown.get()) return "hidden";
  host17.notify({ kind: "info", message: tNow("panes", "toggle.elsewhere") });
  return "elsewhere";
}
function togglePane() {
  const shown = paneShownAtom();
  if (shown?.get()) hidePane();
  else showPane();
}
var NO_ATOM = { get: () => false, listen: () => () => void 0 };
function listenTo(store, cb) {
  if (typeof store.listen === "function") return store.listen(() => cb());
  if (typeof store.subscribe === "function") return store.subscribe(() => cb());
  return () => void 0;
}
function usePaneShown() {
  const store = paneShownAtom();
  const target = store ?? NO_ATOM;
  const subscribe2 = useCallback15((cb) => listenTo(target, cb), [target]);
  const read2 = useCallback15(() => target.get(), [target]);
  const value = useSyncExternalStore(subscribe2, read2, read2);
  return store && paneControlsAvailable() ? value : null;
}

// desktop-src/pages/home/actions.ts
import { host as host18 } from "@hermes/plugin-sdk";
import { useCallback as useCallback16, useRef as useRef28, useState as useState29 } from "react";
var UNDO_MS3 = 7e3;
function useVideoActions(t, tc2) {
  const [overlay, setOverlay] = useState29({});
  const overlayRef = useRef28(overlay);
  overlayRef.current = overlay;
  const view = useCallback16(
    (item) => {
      const l = overlay[item.video.id];
      if (!l) return item;
      const state = l.state ?? item.state;
      return {
        ...item,
        state,
        reaction: l.reaction !== void 0 ? l.reaction : item.reaction,
        // going back to `new` here (undo) is new again, even if the feed has already arrived with the video watched
        // (if the feed says `new` but not fresh — already read by the watermark —, it stays not fresh)
        is_new: state !== "new" ? false : item.state === "new" ? item.is_new : l.state === "new"
      };
    },
    [overlay]
  );
  const isHidden = useCallback16((item) => overlay[item.video.id]?.state === "archived", [overlay]);
  const setLayer2 = (id, layer) => setOverlay((o) => {
    const next = { ...o };
    if (layer && Object.keys(layer).length) next[id] = layer;
    else delete next[id];
    return next;
  });
  const send3 = (id, change) => restCall("POST /videos/state", { body: { video_ids: [id], ...change } });
  const fail = (key, error) => host18.notify({ kind: "error", message: t(key, { error: errorText(tc2, toApiError(error)) }) });
  const priorRef = useRef28(/* @__PURE__ */ new Map());
  const run = useCallback16(
    (action, raw) => {
      const id = raw.video.id;
      const prevLayer = overlayRef.current[id];
      const current2 = view(raw);
      const { change, toast, inverse, restore } = planVideoAction(priorRef.current, action, id, current2);
      const applied = { ...prevLayer, ...asLayer(change) };
      setLayer2(id, applied);
      send3(id, change).then(
        () => {
          void invalidateRest("GET /status");
          host18.notify({
            kind: "success",
            message: t(toast),
            durationMs: UNDO_MS3,
            action: {
              label: t("toast.undo"),
              onClick: () => {
                setLayer2(id, { ...applied, ...asLayer(inverse) });
                send3(id, inverse).then(
                  () => void invalidateRest("GET /status"),
                  (error) => {
                    setLayer2(id, applied);
                    fail("toast.undo_failed", error);
                  }
                );
              }
            }
          });
        },
        (error) => {
          setLayer2(id, prevLayer);
          restore();
          fail("toast.failed", error);
        }
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, t, tc2]
  );
  return { view, isHidden, run };
}
function canMarkRead(tab) {
  if (!tab || tab.kind === "theme") return false;
  const inc = tab.rules?.include;
  if (!inc) return false;
  return !!(inc.all || inc.favorites || inc.folders?.length || inc.channels?.length || inc.tags?.length);
}
function readScopeOf(tab) {
  return { kind: "tab", id: tab.id };
}
function useMarkRead(t, tc2) {
  const [read2, setRead] = useState29(/* @__PURE__ */ new Set());
  const mark2 = (key, scope, label) => {
    const add = () => setRead((s) => new Set(s).add(key));
    const drop = () => setRead((s) => {
      const n = new Set(s);
      n.delete(key);
      return n;
    });
    add();
    restCall("POST /read", { query: { change_ids: true }, body: scope }).then((result) => {
      void invalidateRest("GET /status");
      if (!(result.changed > 0)) {
        host18.notify({ kind: "info", message: t("toast.read_nothing") });
        return;
      }
      const undoIds = result.change_ids ?? [];
      host18.notify({
        kind: "success",
        message: t("toast.read", { tab: label }),
        durationMs: UNDO_MS3,
        ...undoIds.length ? {
          action: {
            label: t("toast.undo"),
            onClick: () => {
              drop();
              Promise.all(undoIds.map((id) => restCall("POST /changes/{id}/undo", { path: { id } }))).then(
                () => void invalidateRest("GET /status", "GET /feed"),
                (error) => {
                  add();
                  host18.notify({ kind: "error", message: t("toast.undo_failed", { error: errorText(tc2, toApiError(error)) }) });
                }
              );
            }
          }
        } : {}
      });
    }).catch((error) => {
      drop();
      host18.notify({ kind: "error", message: t("toast.failed", { error: errorText(tc2, toApiError(error)) }) });
    });
  };
  return { read: read2, mark: mark2 };
}

// desktop-src/pages/home/banners.ts
function pickBanner2({ status, subscribed, arriving, neverPaired = null }) {
  if (arriving) return "arriving";
  if (status?.rss_down_since != null) return "rss_down";
  return pickExtNotice({ status, neverPaired, needed: subscribed != null && subscribed > 0 });
}

// desktop-src/pages/home/feed.ts
import { queryClient as queryClient2, useQuery as useQuery2 } from "@hermes/plugin-sdk";
import { useCallback as useCallback17, useEffect as useEffect30, useRef as useRef29, useState as useState30 } from "react";

// desktop-src/pages/home/prefs.ts
var STORAGE_KEYS = {
  tab: "home.tab",
  density: "home.density",
  /** Sort and group PER SOURCE — `{ [tab | ':later' | ':folder:<id>' | ':channel:<id>']: {sort, group} }`. */
  view: "home.view",
  /** Written by the pane (`panes/prefs.ts` → `PANE_KEYS.target`): `{kind, id, at}` of the clicked folder/channel. Read-only here. */
  paneTarget: "pane.target"
};
function storage2() {
  try {
    return maybePluginContext()?.storage ?? null;
  } catch {
    return null;
  }
}
function readPref(key, fallback, valid2) {
  try {
    const value = storage2()?.get(key, fallback);
    return valid2(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key, value) {
  try {
    storage2()?.set(key, value);
  } catch {
  }
}
var isDensity = (v) => typeof v === "string" && DENSITIES.includes(v);
var isText = (v) => typeof v === "string" && v.length > 0;
var SORTS = ["newest", "oldest", "longest", "shortest", "views"];
var GROUPS2 = ["none", "channel", "folder", "day", "kind"];
var DEFAULT_VIEW = { sort: "newest", group: "none" };
var isSort = (v) => typeof v === "string" && SORTS.includes(v);
var isGroup = (v) => typeof v === "string" && GROUPS2.includes(v);
var isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
function readViewMap() {
  const raw = readPref(STORAGE_KEYS.view, {}, isObject);
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!isObject(v)) continue;
    out[k] = { sort: isSort(v.sort) ? v.sort : DEFAULT_VIEW.sort, group: isGroup(v.group) ? v.group : DEFAULT_VIEW.group };
  }
  return out;
}

// desktop-src/pages/home/feed.ts
var PAGE_SIZE = 30;
var LATER_TAB = ":later";
function sourceKey(src) {
  if (src.kind === "later") return "later";
  if (src.kind === "scope") return `scope:${src.scope.kind}:${src.scope.id}`;
  return `${src.kind}:${src.tabId}`;
}
function serverSearch(src) {
  return !!src && src.kind !== "seen";
}
function serverOrder(src) {
  return serverSearch(src);
}
function orderQuery(src, order) {
  if (!order || !serverOrder(src)) return {};
  return {
    ...order.sort !== DEFAULT_VIEW.sort ? { sort: order.sort } : {},
    ...order.group !== DEFAULT_VIEW.group ? { group: order.group } : {},
    ...order.group === "day" ? { tz_offset_min: Math.max(-840, Math.min(840, Math.round(order.tzOffsetMin ?? 0))) } : {}
  };
}
function seenRules(rules) {
  return { ...rules, filters: { ...rules.filters, only_new: false } };
}
function cancelled() {
  return new TubeApiError({ code: "internal", message: "cancelled", reason: "cancelled" });
}
async function fetchPage(src, cursor, q = "", signal, order) {
  const extra = { ...q && serverSearch(src) ? { q } : {}, ...orderQuery(src, order), limit: PAGE_SIZE, ...cursor ? { cursor } : {} };
  let page;
  if (src.kind === "tab") {
    page = await restCall("GET /feed", { query: { tab: src.tabId, ...extra } });
  } else if (src.kind === "scope") {
    const scope = src.scope.kind === "folder" ? { folder: src.scope.id } : { channel: src.scope.id };
    page = await restCall("GET /feed", { query: { ...scope, ...extra } });
  } else if (src.kind === "later") {
    page = await restCall("GET /feed", { query: { state: "later", ...extra } });
  } else {
    page = await restCall("POST /feed/preview", { body: { rules: seenRules(src.rules), limit: PAGE_SIZE, ...cursor ? { cursor } : {} } });
  }
  if (signal?.aborted) throw cancelled();
  return page;
}
function routeOf(src) {
  return src.kind === "seen" ? "POST /feed/preview" : "GET /feed";
}
function feedQueryKey(src, q, order) {
  return restQueryKey(routeOf(src), { query: { source: sourceKey(src), ...q ? { q } : {}, ...orderQuery(src, order) } });
}
function retry(failureCount, error) {
  return error instanceof TubeApiError && error.transport && failureCount < 2;
}
function dedupe(items) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const it of items) {
    const id = it?.video?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(it);
  }
  return out;
}
var EMPTY_MORE = (key) => ({ key, items: [], cursor: void 0, loading: false, error: null });
function useFeed(src, options = {}) {
  const q = serverSearch(src) ? (options.q ?? "").trim() : "";
  const order = src && serverOrder(src) ? options.order ?? null : null;
  const orderKey = src ? new URLSearchParams(Object.entries(orderQuery(src, order)).map(([k, v]) => [k, String(v)])).toString() : "";
  const base = src ? sourceKey(src) : "";
  const key = `${base}${q ? `?q=${q}` : ""}${orderKey ? `&${orderKey}` : ""}`;
  const srcRef = useRef29(src);
  srcRef.current = src;
  const qRef = useRef29(q);
  qRef.current = q;
  const orderRef = useRef29(order);
  orderRef.current = order;
  const queryKey = src ? feedQueryKey(src, q, order) : ["home-feed-idle"];
  const first = useQuery2({
    queryKey,
    queryFn: ({ signal }) => fetchPage(srcRef.current, null, qRef.current, signal, orderRef.current),
    enabled: !!src,
    retry,
    refetchInterval: options.refetchInterval ?? false
  });
  const data = first.data;
  const keyJson = JSON.stringify(queryKey);
  useEffect30(() => {
    const searchKey = q ? JSON.parse(keyJson) : null;
    return () => {
      if (searchKey) void queryClient2.cancelQueries({ queryKey: searchKey, exact: true });
    };
  }, [keyJson, q]);
  const [moreRaw, setMore] = useState30(() => EMPTY_MORE(key));
  const more = moreRaw.key === key ? moreRaw : EMPTY_MORE(key);
  const keyRef = useRef29(key);
  keyRef.current = key;
  useEffect30(() => {
    setMore((m) => m.key === key ? m : EMPTY_MORE(key));
  }, [key]);
  const cursor = more.cursor === void 0 ? data?.next_cursor ?? null : more.cursor;
  const hasMore = !!data && cursor != null;
  const loadMore = useCallback17(() => {
    const s = srcRef.current;
    if (!s || !hasMore || more.loading || cursor == null) return;
    const k = keyRef.current;
    const qq = qRef.current;
    const oo = orderRef.current;
    setMore((m) => ({ ...m.key === k ? m : EMPTY_MORE(k), loading: true, error: null }));
    fetchPage(s, cursor, qq, void 0, oo).then(
      (p) => {
        if (keyRef.current !== k) return;
        setMore((m) => m.key !== k ? m : { key: k, items: [...m.items, ...p.items ?? []], cursor: p.next_cursor ?? null, loading: false, error: null });
      },
      (error) => {
        if (keyRef.current !== k) return;
        setMore((m) => m.key !== k ? m : { ...m, loading: false, error });
      }
    );
  }, [hasMore, more.loading, cursor]);
  const items = data ? dedupe([...data.items ?? [], ...more.items]) : [];
  const total = data ? data.counts?.total ?? items.length : null;
  const fresh = data ? data.counts?.new ?? null : null;
  const shownRef = useRef29(null);
  if (data) shownRef.current = { base, q, items, total: total ?? items.length, fresh };
  const held = !data && !first.error && !!src && shownRef.current?.base === base ? shownRef.current : null;
  return {
    items: held ? held.items : items,
    total: held ? null : total,
    fresh: held ? null : fresh,
    pending: !data && !first.error && !held,
    searching: !!held && held.q !== q,
    reordering: !!held && held.q === q,
    error: data ? null : first.error,
    refetch: () => {
      void first.refetch();
    },
    hasMore: held ? false : hasMore,
    loadingMore: more.loading,
    moreError: more.error,
    loadMore
  };
}

// desktop-src/pages/home/pane-link.ts
import { useEffect as useEffect31, useRef as useRef30 } from "react";
var PANE_POLL_MS = 600;
var PANE_FRESH_MS = 5e3;
function isPaneTarget(v) {
  if (!v || typeof v !== "object") return false;
  const o = v;
  return (o.kind === "folder" || o.kind === "channel") && typeof o.id === "string" && o.id.length > 0 && typeof o.at === "number";
}
function exactTabFor(target, tabs) {
  const key = target.kind === "folder" ? "folders" : "channels";
  const other = target.kind === "folder" ? "channels" : "folders";
  for (const tab of tabs ?? []) {
    const inc = tab.rules?.include;
    if (!inc || inc.all || inc.favorites) continue;
    const list = inc[key] ?? [];
    if (list.length !== 1 || list[0] !== target.id) continue;
    if ((inc[other] ?? []).length || (inc.tags ?? []).length || (inc.themes ?? []).length || (inc.lenses ?? []).length) continue;
    return tab.id;
  }
  return null;
}
function usePaneLink(handlers) {
  const ref = useRef30(handlers);
  ref.current = handlers;
  const lastTab = useRef30(null);
  const lastAt = useRef30(0);
  useEffect31(() => {
    lastTab.current = readPref(STORAGE_KEYS.tab, null, isText);
    const first = readPref(STORAGE_KEYS.paneTarget, null, isPaneTarget);
    lastAt.current = first?.at ?? 0;
    if (first && Date.now() - first.at <= PANE_FRESH_MS) ref.current.onTarget(first);
    const id = setInterval(() => {
      const target = readPref(STORAGE_KEYS.paneTarget, null, isPaneTarget);
      const tab = readPref(STORAGE_KEYS.tab, null, isText);
      if (target && target.at > lastAt.current) {
        lastAt.current = target.at;
        lastTab.current = tab;
        ref.current.onTarget(target);
        return;
      }
      if (tab && tab !== lastTab.current) {
        lastTab.current = tab;
        ref.current.onTab(tab);
      }
    }, PANE_POLL_MS);
    return () => clearInterval(id);
  }, []);
  return {
    noteTab: (tabId) => {
      lastTab.current = tabId;
    }
  };
}

// desktop-src/pages/home/playlists.tsx
import { Button as Button27, Codicon as Codicon31, ConfirmDialog, Input as Input7, host as host19 } from "@hermes/plugin-sdk";
import { useState as useState31 } from "react";
import { jsx as jsx43, jsxs as jsxs36 } from "react/jsx-runtime";
var PLAYLISTS_TAB = ":playlists";
var countText = (t, count2) => t(`playlists.${playlistCountKey(count2)}`, { count: count2 });
function PlaylistsView({ density, onBrowse, initialOpen = null }) {
  const t = useT("home");
  const [openId, setOpenId] = useState31(initialOpen);
  const [deleted, setDeleted] = useState31(/* @__PURE__ */ new Set());
  const listQ = useRest("GET /playlists", {}, { enabled: !openId });
  if (openId) {
    return /* @__PURE__ */ jsx43(
      PlaylistDetail,
      {
        id: openId,
        density,
        onBack: () => setOpenId(null),
        onDeleted: (id) => {
          setDeleted((s) => new Set(s).add(id));
          setOpenId(null);
        }
      },
      openId
    );
  }
  if (listQ.error && !listQ.data) return /* @__PURE__ */ jsx43(ErrorView, { error: listQ.error, onRetry: () => void listQ.refetch() });
  if (!listQ.data) return /* @__PURE__ */ jsx43(GridSkeleton, { density: "comfortable", count: 4, label: t("playlists.label") });
  const items = (listQ.data.items ?? []).filter((p) => !deleted.has(p.id));
  if (!items.length) {
    return /* @__PURE__ */ jsx43("div", { "data-part": "playlists-empty", children: /* @__PURE__ */ jsx43(
      EmptyView,
      {
        icon: "list-unordered",
        title: t("playlists.empty_title"),
        description: t("playlists.empty_desc"),
        action: /* @__PURE__ */ jsx43(Button27, { variant: "outline", size: "sm", onClick: onBrowse, children: t("playlists.empty_action") })
      }
    ) });
  }
  return /* @__PURE__ */ jsx43("div", { "data-part": "playlists", children: /* @__PURE__ */ jsx43(Section, { title: t("playlists.label"), count: items.length, description: t("playlists.local_note"), children: /* @__PURE__ */ jsx43(
    Grid,
    {
      items,
      getKey: (p) => p.id,
      label: t("playlists.label"),
      density: "comfortable",
      onOpen: (p) => setOpenId(p.id),
      renderItem: (p) => /* @__PURE__ */ jsx43(PlaylistCard, { playlist: p, t, onOpen: () => setOpenId(p.id) })
    }
  ) }) });
}
function PlaylistCard({ playlist, t, onOpen }) {
  const first = playlist.first_video_id;
  return /* @__PURE__ */ jsx43("article", { className: cx("card"), "data-part": "playlist-card", "data-variant": "grid", "data-playlist": playlist.id, children: /* @__PURE__ */ jsxs36("div", { className: cx("card-frame"), children: [
    /* @__PURE__ */ jsx43("div", { className: cx("card-media"), "data-part": "media", children: first ? /* @__PURE__ */ jsx43(Thumb, { videoId: first, title: playlist.name, mark: false }) : /* @__PURE__ */ jsx43("div", { className: cx("thumb"), "data-part": "thumb", "data-empty": "true", children: /* @__PURE__ */ jsx43("div", { className: cx("thumb-fallback"), role: "img", "aria-label": playlist.name, children: /* @__PURE__ */ jsx43(Codicon31, { name: "list-unordered", size: 22 }) }) }) }),
    /* @__PURE__ */ jsxs36("div", { className: cx("card-body"), "data-part": "body", children: [
      /* @__PURE__ */ jsx43("h3", { className: cx("card-title t-head"), "data-part": "title", children: /* @__PURE__ */ jsx43("button", { type: "button", className: cx("bare card-open"), "data-part": "playlist-open", "aria-label": t("playlists.open", { name: playlist.name }), onClick: onOpen, children: playlist.name }) }),
      /* @__PURE__ */ jsx43("div", { className: cx("card-meta t-label"), "data-part": "meta", children: /* @__PURE__ */ jsx43("span", { className: cx("card-stat num"), children: countText(t, playlist.count) }) })
    ] })
  ] }) });
}
function PlaylistDetail({ id, density, onBack, onDeleted }) {
  const t = useT("home");
  const tc2 = useT();
  const detailQ = useRest("GET /playlists/{id}", { path: { id } });
  const [removed, setRemoved] = useState31(/* @__PURE__ */ new Set());
  const [renaming, setRenaming] = useState31(false);
  const [name, setName] = useState31("");
  const [savingName, setSavingName] = useState31(false);
  const [confirming, setConfirming] = useState31(false);
  const fail = (error) => host19.notify({ kind: "error", message: t("playlists.failed", { error: errorText(tc2, toApiError(error)) }) });
  const back = /* @__PURE__ */ jsxs36(Button27, { variant: "ghost", size: "sm", "data-part": "playlist-back", onClick: onBack, children: [
    /* @__PURE__ */ jsx43(Codicon31, { name: "arrow-left", size: 14 }),
    t("playlists.back")
  ] });
  if (detailQ.error && !detailQ.data) {
    return /* @__PURE__ */ jsxs36("div", { "data-part": "playlist-detail", "data-playlist": id, children: [
      back,
      /* @__PURE__ */ jsx43(ErrorView, { error: detailQ.error, onRetry: () => void detailQ.refetch() })
    ] });
  }
  if (!detailQ.data) return /* @__PURE__ */ jsx43(GridSkeleton, { density, count: 6, label: t("playlists.label") });
  const playlist = detailQ.data.playlist;
  const items = (detailQ.data.items ?? []).filter((it) => !removed.has(it.video.id));
  const ref = { id: playlist.id, name: playlist.name };
  const remove = (it) => {
    setRemoved((s) => new Set(s).add(it.video.id));
    restCall("POST /playlists/{id}/items/remove", { path: { id }, body: { video_ids: [it.video.id] } }).then(
      () => {
        host19.notify({ kind: "success", message: t("playlists.removed", { name: playlist.name }) });
        void invalidatePlaylists();
      },
      (error) => {
        setRemoved((s) => {
          const next = new Set(s);
          next.delete(it.video.id);
          return next;
        });
        fail(error);
      }
    );
  };
  const clean = name.replace(/\s+/g, " ").trim();
  const saveName = () => {
    if (!clean || savingName) return;
    if (clean === playlist.name) {
      setRenaming(false);
      return;
    }
    setSavingName(true);
    restCall("PATCH /playlists/{id}", { path: { id }, body: { name: clean } }).then(
      (next) => {
        setSavingName(false);
        setRenaming(false);
        host19.notify({ kind: "success", message: t("playlists.renamed", { name: next.name }) });
        void invalidatePlaylists();
      },
      (error) => {
        setSavingName(false);
        fail(error);
      }
    );
  };
  const onNameKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveName();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setRenaming(false);
    }
  };
  const confirmDelete = async () => {
    try {
      await restCall("DELETE /playlists/{id}", { path: { id } });
    } catch (error) {
      throw new Error(t("playlists.failed", { error: errorText(tc2, toApiError(error)) }));
    }
    host19.notify({ kind: "success", message: t("playlists.deleted", { name: playlist.name }) });
    void invalidatePlaylists();
    onDeleted(id);
  };
  const title = renaming ? /* @__PURE__ */ jsxs36(Stack, { direction: "row", gap: 2, align: "center", children: [
    /* @__PURE__ */ jsx43(
      Input7,
      {
        "data-part": "playlist-rename-input",
        "aria-label": t("playlists.rename_label"),
        maxLength: PLAYLIST_NAME_MAX,
        autoFocus: true,
        value: name,
        onChange: (e) => setName(e.target.value),
        onKeyDown: onNameKey
      }
    ),
    /* @__PURE__ */ jsx43(Button27, { variant: "secondary", size: "xs", "data-part": "playlist-rename-save", disabled: !clean, loading: savingName, onClick: saveName, children: t("playlists.rename_save") }),
    /* @__PURE__ */ jsx43(Button27, { variant: "ghost", size: "xs", "data-part": "playlist-rename-cancel", onClick: () => setRenaming(false), children: t("playlists.rename_cancel") })
  ] }) : playlist.name;
  const actions = /* @__PURE__ */ jsxs36(Stack, { direction: "row", gap: 2, align: "center", wrap: true, children: [
    /* @__PURE__ */ jsx43("span", { className: cx("t-label num"), children: countText(t, items.length) }),
    /* @__PURE__ */ jsxs36(Button27, { variant: "secondary", size: "xs", "data-part": "playlist-play-all", disabled: !items.length, onClick: () => playAll(ref, items), children: [
      /* @__PURE__ */ jsx43(Codicon31, { name: "play", size: 13 }),
      t("playlists.play_all")
    ] }),
    renaming ? null : /* @__PURE__ */ jsxs36(
      Button27,
      {
        variant: "ghost",
        size: "xs",
        "data-part": "playlist-rename",
        onClick: () => {
          setName(playlist.name);
          setRenaming(true);
        },
        children: [
          /* @__PURE__ */ jsx43(Codicon31, { name: "edit", size: 13 }),
          t("playlists.rename")
        ]
      }
    ),
    /* @__PURE__ */ jsxs36(Button27, { variant: "ghost", size: "xs", "data-part": "playlist-delete", onClick: () => setConfirming(true), children: [
      /* @__PURE__ */ jsx43(Codicon31, { name: "trash", size: 13 }),
      t("playlists.delete")
    ] })
  ] });
  const cardActions = (it) => {
    const list = [
      { id: "playlist", label: tc2("playlists.add"), icon: "list-unordered", onSelect: () => openPlaylistPicker(it) },
      { id: "remove_from_playlist", label: t("playlists.remove"), icon: "close", onSelect: () => remove(it) }
    ];
    return /* @__PURE__ */ jsx43(QuickActions, { actions: list });
  };
  return /* @__PURE__ */ jsxs36("div", { "data-part": "playlist-detail", "data-playlist": id, children: [
    back,
    /* @__PURE__ */ jsx43(Section, { title, actions, description: t("playlists.local_note"), children: items.length ? /* @__PURE__ */ jsx43(
      Grid,
      {
        items,
        getKey: (it) => it.video.id,
        label: t("playlists.items_label", { name: playlist.name }),
        density,
        onOpen: (it) => openFromPlaylist(ref, items, it),
        renderItem: (it) => /* @__PURE__ */ jsx43(VideoCard, { item: it, variant: cardVariantFor(density), onOpen: () => openFromPlaylist(ref, items, it), actions: cardActions(it) })
      }
    ) : /* @__PURE__ */ jsx43(EmptyView, { compact: true, icon: "list-unordered", title: t("playlists.playlist_empty_title"), description: t("playlists.playlist_empty_desc") }) }),
    /* @__PURE__ */ jsx43(
      ConfirmDialog,
      {
        open: confirming,
        onClose: () => setConfirming(false),
        onConfirm: confirmDelete,
        title: t("playlists.delete_title", { name: playlist.name }),
        description: t("playlists.delete_desc"),
        confirmLabel: t("playlists.delete_confirm"),
        cancelLabel: t("playlists.delete_cancel"),
        destructive: true
      }
    )
  ] });
}

// desktop-src/pages/home/view.tsx
import { Button as Button28, Codicon as Codicon32, DropdownMenu as DropdownMenu3, DropdownMenuContent as DropdownMenuContent3, DropdownMenuItem as DropdownMenuItem3, DropdownMenuSeparator as DropdownMenuSeparator3, DropdownMenuTrigger as DropdownMenuTrigger3 } from "@hermes/plugin-sdk";
import { useState as useState32 } from "react";
import { jsx as jsx44, jsxs as jsxs37 } from "react/jsx-runtime";
function groupsFor(scope, tab) {
  const drop = /* @__PURE__ */ new Set();
  if (scope?.kind === "channel") {
    drop.add("channel");
    drop.add("folder");
  } else if (scope?.kind === "folder") {
    drop.add("folder");
  } else if (tab?.rules?.include) {
    const inc = tab.rules.include;
    const others = (keep) => keep !== "channels" && inc.channels.length > 0 || keep !== "folders" && inc.folders.length > 0 || inc.tags.length > 0 || inc.themes.length > 0 || inc.lenses.length > 0 || inc.all || inc.favorites;
    if (inc.channels.length === 1 && !others("channels")) {
      drop.add("channel");
      drop.add("folder");
    } else if (inc.folders.length === 1 && !others("folders")) {
      drop.add("folder");
    }
  }
  return GROUPS2.filter((g) => !drop.has(g));
}
function effectiveView(view, groups2) {
  return groups2.includes(view.group) ? view : { ...view, group: "none" };
}
function browserTzOffsetMin() {
  return -(/* @__PURE__ */ new Date()).getTimezoneOffset();
}
var SORT_ICON = "sort-precedence";
var GROUP_ICON = "group-by-ref-type";
function Choice({ checked, label, data, onSelect }) {
  return /* @__PURE__ */ jsxs37(DropdownMenuItem3, { role: "menuitemradio", "aria-checked": checked, ...data, onSelect, children: [
    /* @__PURE__ */ jsx44(Codicon32, { name: "check", size: 14, className: cx(checked ? "view-check" : "view-check view-check-off") }),
    /* @__PURE__ */ jsx44("span", { className: cx("t-body"), children: label })
  ] });
}
function trigger(part, icon, text, label, open) {
  return /* @__PURE__ */ jsxs37(Button28, { variant: "ghost", size: "xs", className: cx("view-trigger"), "data-part": part, "data-open": open ? "true" : void 0, "aria-label": label, title: label, children: [
    /* @__PURE__ */ jsx44(Codicon32, { name: icon, size: 13 }),
    /* @__PURE__ */ jsx44("span", { className: cx("view-trigger-text"), children: text }),
    /* @__PURE__ */ jsx44(Codicon32, { name: "chevron-down", size: 12, className: cx("view-trigger-caret") })
  ] });
}
function ViewControls({ value, groups: groups2, onChange, narrow, initialOpen }) {
  const t = useT("home");
  const [open, setOpen] = useState32(initialOpen ?? null);
  const toggle = (id) => (next) => setOpen((cur) => next ? id : cur === id ? null : cur);
  const sortText = t(`view.sort.${value.sort}`);
  const groupText = t(`view.group_trigger.${value.group}`);
  const sortItems = SORTS.map((s) => /* @__PURE__ */ jsx44(Choice, { checked: value.sort === s, label: t(`view.sort.${s}`), data: { "data-sort": s }, onSelect: () => onChange({ ...value, sort: s }) }, s));
  const groupItems2 = groups2.map((g) => /* @__PURE__ */ jsx44(Choice, { checked: value.group === g, label: t(`view.group.${g}`), data: { "data-group-option": g }, onSelect: () => onChange({ ...value, group: g }) }, g));
  if (narrow) {
    const label = t("view.menu_label", { sort: sortText, group: groupText });
    return /* @__PURE__ */ jsxs37(DropdownMenu3, { open: open === "view", onOpenChange: toggle("view"), children: [
      /* @__PURE__ */ jsx44(DropdownMenuTrigger3, { asChild: true, children: trigger("view-menu", SORT_ICON, t("view.label"), label, open === "view") }),
      /* @__PURE__ */ jsxs37(DropdownMenuContent3, { align: "end", children: [
        /* @__PURE__ */ jsx44("div", { className: cx("view-menu-label t-label"), role: "presentation", children: t("view.sort_title") }),
        sortItems,
        /* @__PURE__ */ jsx44(DropdownMenuSeparator3, {}),
        /* @__PURE__ */ jsx44("div", { className: cx("view-menu-label t-label"), role: "presentation", children: t("view.group_title") }),
        groupItems2
      ] })
    ] });
  }
  return /* @__PURE__ */ jsxs37("div", { className: cx("view-controls"), "data-part": "view-controls", children: [
    /* @__PURE__ */ jsxs37(DropdownMenu3, { open: open === "sort", onOpenChange: toggle("sort"), children: [
      /* @__PURE__ */ jsx44(DropdownMenuTrigger3, { asChild: true, children: trigger("view-sort", SORT_ICON, sortText, t("view.sort_label", { value: sortText }), open === "sort") }),
      /* @__PURE__ */ jsx44(DropdownMenuContent3, { align: "end", children: sortItems })
    ] }),
    /* @__PURE__ */ jsxs37(DropdownMenu3, { open: open === "group", onOpenChange: toggle("group"), children: [
      /* @__PURE__ */ jsx44(DropdownMenuTrigger3, { asChild: true, children: trigger("view-group", GROUP_ICON, groupText, t("view.group_label", { value: t(`view.group.${value.group}`) }), open === "group") }),
      /* @__PURE__ */ jsx44(DropdownMenuContent3, { align: "end", children: groupItems2 })
    ] })
  ] });
}
var DAY_S = 86400;
function dayOf(ts, tzOffsetMin) {
  return Math.floor((ts + tzOffsetMin * 60) / DAY_S);
}
function groupKeyOf(it, group2, tzOffsetMin) {
  switch (group2) {
    case "channel":
      return `c:${it.channel?.id ?? it.video.channel_id}`;
    case "folder":
      return `f:${it.channel?.folder_id ?? ""}`;
    case "day":
      return it.video.published_at == null ? "d:" : `d:${dayOf(it.video.published_at, tzOffsetMin)}`;
    case "kind":
      return `k:${it.video.is_short === true ? "short" : it.video.is_short === false ? "video" : "unknown"}`;
    default:
      return "";
  }
}
function runsOf(items, group2, tzOffsetMin) {
  const out = [];
  for (const it of items) {
    const key = groupKeyOf(it, group2, tzOffsetMin);
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(it);
    else out.push({ key, id: `${key}#${out.length}`, items: [it] });
  }
  return out;
}
function capitalize(text, locale) {
  return text ? text.charAt(0).toLocaleUpperCase(locale) + text.slice(1) : text;
}
function dayLabel(day, tzOffsetMin, t, locale, nowMs = Date.now()) {
  const today2 = dayOf(Math.floor(nowMs / 1e3), tzOffsetMin);
  if (day === today2) return t("group.today");
  if (day === today2 - 1) return t("group.yesterday");
  const d = new Date(day * DAY_S * 1e3);
  const sameYear = d.getUTCFullYear() === new Date(today2 * DAY_S * 1e3).getUTCFullYear();
  const opts = { weekday: "long", day: "numeric", month: "long", timeZone: "UTC", ...sameYear ? {} : { year: "numeric" } };
  try {
    return capitalize(new Intl.DateTimeFormat(locale, opts).format(d), locale);
  } catch {
    return capitalize(new Intl.DateTimeFormat("en", opts).format(d), "en");
  }
}
var KIND_ICON = { video: "device-camera-video", short: "device-mobile", unknown: "question" };
function headInfo(run, group2, folders, tzOffsetMin, t, locale) {
  const first = run.items[0];
  const icon = (name) => /* @__PURE__ */ jsx44(Codicon32, { name, size: 14, className: cx("feed-group-icon") });
  switch (group2) {
    case "channel": {
      const title = first.channel?.title ?? first.video.channel_title ?? "";
      return { label: title || t("group.no_channel"), lead: /* @__PURE__ */ jsx44(ChannelAvatar, { title, thumb: first.channel?.thumb ?? null, size: 20 }) };
    }
    case "folder": {
      const id = first.channel?.folder_id ?? null;
      const name = id ? folders.get(id)?.name : null;
      return { label: id ? name ?? "…" : t("group.no_folder"), lead: icon(id ? "folder" : "folder-opened") };
    }
    case "day": {
      const ts = first.video.published_at;
      return { label: ts == null ? t("group.no_date") : dayLabel(dayOf(ts, tzOffsetMin), tzOffsetMin, t, locale), lead: icon("calendar") };
    }
    default: {
      const kind = run.key.slice(2);
      return { label: t(`group.kind.${kind}`), lead: icon(KIND_ICON[kind] ?? "question") };
    }
  }
}
var gridsIn = (root) => [...root.querySelectorAll('[role="grid"]')];
var cellsIn = (grid) => [...grid.querySelectorAll('[role="gridcell"]')];
function columnsIn(grid) {
  const rows = [...grid.querySelectorAll(':scope > [role="row"]')];
  if (!rows.length) return 1;
  const first = rows[0].getBoundingClientRect();
  if (first.width === 0 && first.height === 0) return 1;
  let n = 0;
  for (const r of rows) {
    if (Math.abs(r.getBoundingClientRect().top - first.top) > 2) break;
    n++;
  }
  return Math.max(1, n);
}
function crossGridKeys(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target;
  if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  const cell = target.closest('[role="gridcell"]');
  const grid = cell?.closest('[role="grid"]');
  if (!cell || !grid) return;
  const grids = gridsIn(e.currentTarget);
  const gi = grids.indexOf(grid);
  if (gi < 0) return;
  const cells = cellsIn(grid);
  const idx = cells.indexOf(cell);
  const cols = columnsIn(grid);
  const next = grids[gi + 1];
  const prev = grids[gi - 1];
  let to;
  switch (e.key) {
    case "ArrowRight":
    case "j":
      if (idx === cells.length - 1 && next) to = cellsIn(next)[0];
      break;
    case "ArrowLeft":
    case "k":
      if (idx === 0 && prev) to = cellsIn(prev).at(-1);
      break;
    case "ArrowDown":
      if (idx + cols >= cells.length && next) {
        const below = cellsIn(next);
        to = below[Math.min(idx % cols, below.length - 1)];
      }
      break;
    case "ArrowUp":
      if (idx - cols < 0 && prev) {
        const above = cellsIn(prev);
        const pc = columnsIn(prev);
        const lastRow = Math.floor((above.length - 1) / pc) * pc;
        to = above[Math.min(lastRow + idx % cols, above.length - 1)];
      }
      break;
    case "Home":
      if (gi > 0) to = cellsIn(grids[0])[0];
      break;
    case "End":
      if (gi < grids.length - 1) to = cellsIn(grids[grids.length - 1]).at(-1);
      break;
    default:
      return;
  }
  if (!to) return;
  e.preventDefault();
  e.stopPropagation();
  to.focus();
  to.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}
function GroupedGrids({ runs, group: group2, folders, tzOffsetMin, locale, more, collapsed, onToggle, renderGrid }) {
  const t = useT("home");
  return /* @__PURE__ */ jsx44("div", { className: cx("feed-groups"), "data-part": "feed-groups", "data-group-by": group2, onKeyDownCapture: crossGridKeys, children: runs.map((run, i) => {
    const info = headInfo(run, group2, folders, tzOffsetMin, t, locale);
    const open = !collapsed.has(run.key);
    const count2 = formatNumber(run.items.length, locale);
    const last = i === runs.length - 1;
    const countText2 = last && more ? t("group.count_more", { count: count2 }) : count2;
    const countHint = t("group.count_hint", { count: count2 });
    return /* @__PURE__ */ jsxs37("section", { className: cx("feed-group"), "data-part": "feed-group", "data-group": run.key, "data-collapsed": open ? void 0 : "true", children: [
      /* @__PURE__ */ jsx44("div", { className: cx("feed-group-head"), "data-part": "group-head", role: "heading", "aria-level": 3, children: /* @__PURE__ */ jsxs37("button", { type: "button", className: cx("bare feed-group-toggle"), "aria-expanded": open, onClick: () => onToggle(run.key), children: [
        /* @__PURE__ */ jsx44(Codicon32, { name: open ? "chevron-down" : "chevron-right", size: 12, className: cx("feed-group-caret") }),
        /* @__PURE__ */ jsx44("span", { className: cx("feed-group-lead"), children: info.lead }),
        /* @__PURE__ */ jsx44("span", { className: cx("feed-group-name t-head"), "data-part": "group-name", children: info.label }),
        /* @__PURE__ */ jsx44("span", { className: cx("feed-group-count t-label num"), "data-part": "group-count", title: countHint, children: countText2 })
      ] }) }),
      open ? renderGrid(run, info.label) : null
    ] }, run.id);
  }) });
}

// desktop-src/pages/home/Welcome.tsx
import { Button as Button29, Codicon as Codicon33, Input as Input8, host as host20 } from "@hermes/plugin-sdk";
import { useEffect as useEffect32, useRef as useRef31, useState as useState33 } from "react";
import { Fragment as Fragment21, jsx as jsx45, jsxs as jsxs38 } from "react/jsx-runtime";
var AFTER_CHANNELS2 = ["GET /channels", "GET /tabs", "GET /status", "GET /feed"];
var LINK_ERROR_ID = "home-link-error";
function linkErrorKey(error) {
  const api = toApiError(error);
  switch (api.code) {
    case "conflict": {
      const ch = api.details?.channel ?? null;
      return ch?.title ? { key: "welcome.errors.conflict", vars: { title: ch.title } } : { key: "welcome.errors.conflict_generic" };
    }
    case "invalid":
      return { key: "welcome.errors.invalid" };
    case "youtube_error":
      return { key: "welcome.errors.youtube_error" };
    case "timeout":
      return { key: "welcome.errors.timeout" };
    default:
      return { key: "" };
  }
}
function PasteCard({ onArriving }) {
  const t = useT("home");
  const tc2 = useT();
  const inputRef = useRef31(null);
  const [open, setOpen] = useState33(false);
  const [value, setValue] = useState33("");
  const [busy, setBusy] = useState33(false);
  const [error, setError] = useState33(null);
  useEffect32(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  const submit = (e) => {
    e?.preventDefault();
    const text = value.trim();
    if (!text) {
      setError(t("welcome.errors.empty"));
      inputRef.current?.focus();
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    restCall("POST /channels/add", { body: { url_or_handle: text } }).then(
      (channel) => {
        setBusy(false);
        setValue("");
        host20.notify({ kind: "success", message: t("welcome.link_added", { title: channel.title }) });
        onArriving({ kind: "channel", channels: 1, title: channel.title, since: Date.now() });
        void invalidateRest(...AFTER_CHANNELS2);
      },
      (err) => {
        setBusy(false);
        const { key, vars: vars2 } = linkErrorKey(err);
        setError(key ? t(key, vars2) : errorText(tc2, toApiError(err)));
        inputRef.current?.focus();
      }
    );
  };
  return /* @__PURE__ */ jsxs38("article", { className: cx("path"), "data-part": "path-card", "data-primary": "false", "data-open": open ? "true" : void 0, children: [
    /* @__PURE__ */ jsx45("div", { className: cx("path-top"), children: /* @__PURE__ */ jsx45("span", { className: cx("path-icon"), "data-part": "path-icon", "aria-hidden": "true", children: /* @__PURE__ */ jsx45(Codicon33, { name: "link", size: 20 }) }) }),
    /* @__PURE__ */ jsx45("h3", { className: cx("path-title t-head"), "data-part": "path-title", children: t("welcome.link_title") }),
    open ? /* @__PURE__ */ jsx45("form", { onSubmit: submit, noValidate: true, "data-part": "link-form", children: /* @__PURE__ */ jsxs38(Stack, { gap: 2, align: "stretch", children: [
      /* @__PURE__ */ jsx45(
        Input8,
        {
          ref: inputRef,
          name: "channel",
          type: "text",
          inputMode: "url",
          autoComplete: "off",
          spellCheck: false,
          value,
          placeholder: t("welcome.link_placeholder"),
          "aria-label": t("welcome.link_label"),
          "aria-invalid": error ? true : void 0,
          "aria-describedby": error ? LINK_ERROR_ID : void 0,
          onChange: (e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }
        }
      ),
      error ? /* @__PURE__ */ jsx45("p", { id: LINK_ERROR_ID, className: cx("t-label"), role: "alert", "data-part": "link-error", children: error }) : /* @__PURE__ */ jsx45("p", { className: cx("path-hint t-label"), "data-part": "link-hint", children: t("welcome.link_hint") }),
      /* @__PURE__ */ jsx45("div", { className: cx("path-foot"), "data-part": "path-foot", children: /* @__PURE__ */ jsxs38(Button29, { type: "submit", variant: "outline", size: "sm", loading: busy, children: [
        /* @__PURE__ */ jsx45(Codicon33, { name: "add", size: 14 }),
        t("welcome.link_submit")
      ] }) })
    ] }) }) : /* @__PURE__ */ jsxs38(Fragment21, { children: [
      /* @__PURE__ */ jsx45("p", { className: cx("path-desc t-body"), "data-part": "path-desc", children: t("welcome.link_desc") }),
      /* @__PURE__ */ jsx45("div", { className: cx("path-foot"), "data-part": "path-foot", children: /* @__PURE__ */ jsx45(Button29, { variant: "outline", size: "sm", "aria-expanded": false, onClick: () => setOpen(true), children: t("welcome.link_action") }) })
    ] })
  ] });
}
function Welcome({ onArriving }) {
  const t = useT("home");
  const tc2 = useT();
  const [demoBusy, setDemoBusy] = useState33(false);
  const uiLocale = useUiLocale();
  const loadDemo = () => {
    if (demoBusy) return;
    setDemoBusy(true);
    restCall("POST /demo/load", { body: { ui_locale: uiLocale } }).then(
      (report) => {
        setDemoBusy(false);
        onArriving({ kind: "demo", channels: report.channels, since: Date.now() });
        restCall("POST /refresh", { body: { force: true } }).catch(() => void 0);
        void invalidateRest(...AFTER_CHANNELS2);
      },
      (error) => {
        setDemoBusy(false);
        host20.notify({
          kind: "error",
          message: t("welcome.demo_failed", { error: errorText(tc2, error instanceof TubeApiError ? error.toApiError() : toApiError(error)) })
        });
      }
    );
  };
  return /* @__PURE__ */ jsxs38(Fragment21, { children: [
    /* @__PURE__ */ jsx45(Hero, { icon: "play-circle", title: tc2("kit.welcome.title"), tagline: tc2("kit.welcome.tagline"), description: t("welcome.lead") }),
    /* @__PURE__ */ jsxs38(PathGroup, { label: t("welcome.group"), children: [
      /* @__PURE__ */ jsx45(
        PathCard,
        {
          primary: true,
          recommended: true,
          icon: "plug",
          title: t("welcome.pair_title"),
          description: t("welcome.pair_desc"),
          actionLabel: t("welcome.pair_action"),
          onAction: () => openDialog("onboarding", { step: "pair" }),
          hint: t("welcome.pair_hint")
        }
      ),
      /* @__PURE__ */ jsx45(PasteCard, { onArriving }),
      /* @__PURE__ */ jsx45(
        PathCard,
        {
          icon: "beaker",
          title: t("welcome.demo_title"),
          description: t("welcome.demo_desc"),
          actionLabel: demoBusy ? t("welcome.demo_loading") : t("welcome.demo_action"),
          onAction: loadDemo,
          hint: t("welcome.demo_hint")
        }
      )
    ] })
  ] });
}

// desktop-src/pages/home/index.tsx
import { Fragment as Fragment22, jsx as jsx46, jsxs as jsxs39 } from "react/jsx-runtime";
var FAST_POLL_MS = 3e3;
var CLOCK_MS2 = 3e4;
var ARRIVING_MAX_MS = 18e4;
var SEARCH_DEBOUNCE_MS = 250;
var NARROW_PX = 560;
var SHORTCUTS = { ...GRID_SHORTCUTS, u: "up", d: "down", p: "playlist" };
var BUILTIN_TABS = /* @__PURE__ */ new Set(["all-new", "favorites"]);
var CODICON_NAME = /^[a-z][a-z0-9-]*$/;
var KIND_ICON2 = { category: "folder", channels: "account", theme: "sparkle", mixed: "layers" };
var BUILTIN_ICON = { "all-new": "inbox", favorites: "star-full" };
var DENSITY_ICON = { comfortable: "preview", compact: "extensions", list: "list-flat" };
var MORE_SKELETON = { comfortable: 4, compact: 6, list: 3 };
var NO_KEYS = /* @__PURE__ */ new Set();
function withOrder(tabs, order) {
  if (!order) return [...tabs];
  const pos = new Map(order.map((id, i) => [id, i]));
  const rank = (t, i) => pos.get(t.id) ?? order.length + i;
  return tabs.map((t, i) => [t, rank(t, i)]).sort((a, b) => a[1] - b[1]).map(([t]) => t);
}
function tabEmoji(tab) {
  return tab.icon && !CODICON_NAME.test(tab.icon) ? tab.icon : null;
}
function tabLabel(tab, t) {
  if (tab.builtin && BUILTIN_TABS.has(tab.id)) return t(`tabs.${tab.id}`);
  const emoji = tabEmoji(tab);
  return emoji && !tab.name.startsWith(emoji) ? `${emoji} ${tab.name}` : tab.name;
}
function tabIcon(tab) {
  if (tab.icon && CODICON_NAME.test(tab.icon)) return tab.icon;
  if (tab.builtin && BUILTIN_ICON[tab.id]) return BUILTIN_ICON[tab.id];
  if (tabEmoji(tab)) return null;
  return KIND_ICON2[tab.kind] ?? null;
}
function fold2(text) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
function useDebounced(value, ms) {
  const [settled, setSettled] = useState34(value);
  useEffect33(() => {
    if (!value) {
      setSettled("");
      return;
    }
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return value ? settled : "";
}
function matches(item, needle) {
  if (!needle) return true;
  const hay = fold2(`${item.video.title} ${item.channel?.title ?? item.video.channel_title ?? ""} ${item.why?.label ?? ""}`);
  return needle.split(/\s+/).every((w) => hay.includes(w));
}
function featuredOf(items) {
  return items.find((it) => (it.is_new || it.channel?.favorite) && canFeature(it)) ?? null;
}
function canFeature(it) {
  return isVideoId(it.video.id) && it.video.is_short !== true;
}
function compactWhy(item) {
  const why = item.why;
  if (!why || why.via === "channel") return item;
  const head = why.label.split(/:\s/, 1)[0]?.trim() ?? "";
  const label = head && head.length < why.label.length && head.length <= 24 ? head : why.label;
  if (label === why.label && !why.detail) return item;
  return { ...item, why: { ...why, label, detail: null } };
}
function sinceText(ts, locale, now = Date.now()) {
  const d = new Date(ts * 1e3);
  const today2 = new Date(now);
  try {
    const time = new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(d);
    if (today2.toDateString() === d.toDateString()) return time;
    const yesterday = new Date(today2);
    yesterday.setDate(today2.getDate() - 1);
    if (yesterday.toDateString() === d.toDateString()) return `${new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-1, "day")} ${time}`;
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(d);
  } catch {
    return d.toISOString();
  }
}
function useNow2(ms) {
  const [now, setNow] = useState34(() => Date.now());
  useEffect33(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
function useNarrow(limit) {
  const [el, setEl] = useState34(null);
  const [narrow, setNarrow] = useState34(false);
  useEffect33(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[entries.length - 1]?.contentRect?.width;
      if (typeof w === "number" && w > 0) setNarrow(w < limit);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, limit]);
  return [setEl, narrow];
}
function CardActions({ item, onAction, reactions }) {
  const tc2 = useT();
  const standard = useStandardQuickActions({
    watched: () => onAction("watched", item),
    later: () => onAction("later", item),
    archive: () => onAction("archive", item),
    state: item.state
  });
  const playlist = { id: "playlist", label: tc2("playlists.add"), icon: "list-unordered", shortcut: "p", onSelect: () => openPlaylistPicker(item) };
  const actions = reactions ? [
    ...standard,
    {
      id: "up",
      label: tc2("kit.actions.up"),
      hint: tc2(item.reaction === "up" ? "kit.actions.up_undo" : "kit.actions.up_do"),
      icon: "thumbsup",
      shortcut: "u",
      onSelect: () => onAction("up", item),
      pressed: item.reaction === "up"
    },
    {
      id: "down",
      label: tc2("kit.actions.down"),
      hint: tc2(item.reaction === "down" ? "kit.actions.down_undo" : "kit.actions.down_do"),
      icon: "thumbsdown",
      shortcut: "d",
      onSelect: () => onAction("down", item),
      pressed: item.reaction === "down"
    },
    playlist
  ] : [...standard, playlist];
  return /* @__PURE__ */ jsx46(QuickActions, { actions });
}
function GoneSlot({ children, onUndo }) {
  const t = useT("home");
  const inGrid = useInGrid();
  return /* @__PURE__ */ jsxs39("div", { className: cx("card-gone"), "data-part": "card-gone", children: [
    /* @__PURE__ */ jsx46("div", { className: cx("card-gone-ghost"), "aria-hidden": "true", inert: true, children }),
    /* @__PURE__ */ jsxs39("div", { className: cx("card-gone-note"), role: "status", children: [
      /* @__PURE__ */ jsx46(Codicon34, { name: "archive", size: 14 }),
      /* @__PURE__ */ jsx46("span", { className: cx("t-label"), children: t("gone.archived") }),
      /* @__PURE__ */ jsx46(Button30, { variant: "ghost", size: "xs", "data-part": "gone-undo", tabIndex: inGrid ? -1 : void 0, onClick: onUndo, children: t("gone.undo") })
    ] })
  ] });
}
function useListSession(key) {
  const ref = useRef32(null);
  if (!ref.current || ref.current.key !== key) ref.current = { key, featured: null, touched: /* @__PURE__ */ new Set(), gone: /* @__PURE__ */ new Set() };
  return ref.current;
}
var NEW_TAB_ENTRIES = [
  { id: "category", icon: "folder", run: () => openDialog("tab-editor", { preset: { kind: "category" } }) },
  { id: "channels", icon: "account", run: () => openDialog("tab-editor", { preset: { kind: "channels" } }) },
  { id: "theme", icon: "sparkle", run: () => openDialog("theme", {}) },
  { id: "mixed", icon: "layers", run: () => openDialog("tab-editor", { preset: { kind: "mixed" } }) }
];
function NewTabMenu({ open, onOpenChange }) {
  const t = useT("home");
  return /* @__PURE__ */ jsxs39(DropdownMenu4, { open, onOpenChange, children: [
    /* @__PURE__ */ jsx46(DropdownMenuTrigger4, { asChild: true, children: /* @__PURE__ */ jsxs39(Button30, { variant: "outline", size: "xs", className: cx("tab-add"), "data-part": "new-tab", "aria-label": t("actions.new_tab"), children: [
      /* @__PURE__ */ jsx46(Codicon34, { name: "add", size: 14 }),
      /* @__PURE__ */ jsx46("span", { className: cx("tab-add-label"), children: t("actions.new_tab") })
    ] }) }),
    /* @__PURE__ */ jsx46(DropdownMenuContent4, { align: "end", children: NEW_TAB_ENTRIES.map((e) => /* @__PURE__ */ jsxs39(DropdownMenuItem4, { "data-entry": e.id, onSelect: () => e.run(), children: [
      /* @__PURE__ */ jsx46(Codicon34, { name: e.icon, size: 14 }),
      /* @__PURE__ */ jsxs39(Stack, { gap: 0, children: [
        /* @__PURE__ */ jsx46("span", { className: cx("t-body"), children: t(`new_tab.${e.id}`) }),
        /* @__PURE__ */ jsx46("span", { className: cx("t-label"), children: t(`new_tab.${e.id}_desc`) })
      ] })
    ] }, e.id)) })
  ] });
}
function ThemeSlot({ compact }) {
  const t = useT("home");
  const tc2 = useT();
  const ai = useAiStatus();
  const onEnd = (end) => {
    const name = end.query;
    if (end.kind === "ready") {
      host21.notify({
        kind: "success",
        message: name ? t("theme_build.ready", { name }) : t("theme_build.ready_unnamed"),
        action: { label: t("theme_build.open_preview"), onClick: () => openDialog("theme", { jobId: end.jobId }) }
      });
      return;
    }
    const error = errorText(tc2, end.error);
    const params = end.params ?? (name ? { query: name } : null);
    host21.notify({
      kind: "error",
      message: name ? t("theme_build.failed", { name, error }) : t("theme_build.failed_unnamed", { error }),
      action: {
        label: t("theme_build.retry"),
        onClick: () => {
          if (!params) return openDialog("theme", {});
          void retryThemeBuild(params, name).then((started) => started ? void 0 : openDialog("theme", { query: name }));
        }
      }
    });
  };
  const build = useThemeBuild(onEnd);
  const now = useNowTicker(!!build);
  if (build) {
    const label2 = build.query ? t("theme_build.building", { name: build.query }) : t("theme_build.building_unnamed");
    const time = formatElapsed(now - build.startedAt);
    return /* @__PURE__ */ jsx46(Tip4, { label: compact ? label2 : t("theme_build.building_tip"), children: /* @__PURE__ */ jsxs39(Button30, { variant: "ghost", size: "xs", className: cx("tab-building"), "data-part": "theme-building", "data-job": build.jobId, "aria-label": `${label2} ${time}`, onClick: () => openDialog("theme", { jobId: build.jobId }), children: [
      /* @__PURE__ */ jsx46(Codicon34, { name: "loading", size: 14, spinning: true }),
      compact ? null : /* @__PURE__ */ jsx46("span", { className: cx("tab-building-label"), children: label2 }),
      /* @__PURE__ */ jsx46("span", { className: cx("tab-building-time"), "data-part": "theme-building-time", children: time })
    ] }) });
  }
  const off = ai?.available === false;
  const label = t("theme_build.button");
  const button = /* @__PURE__ */ jsxs39(Button30, { variant: "outline", size: "xs", className: cx("tab-theme"), "data-part": "new-theme", "aria-label": label, disabled: off, onClick: () => openDialog("theme", {}), children: [
    /* @__PURE__ */ jsx46(Codicon34, { name: "wand", size: 14, className: cx("tab-theme-icon") }),
    compact ? null : /* @__PURE__ */ jsx46("span", { className: cx("tab-theme-label"), children: label })
  ] });
  if (off)
    return /* @__PURE__ */ jsx46(Tip4, { label: t("theme_build.no_ai"), children: /* @__PURE__ */ jsx46("span", { className: cx("tab-theme-off"), "data-part": "new-theme-off", tabIndex: 0, children: button }) });
  return /* @__PURE__ */ jsx46(Tip4, { label: compact ? label : t("theme_build.button_tip"), children: button });
}
function PaneToggle() {
  const tp = useT("panes");
  const shown = usePaneShown();
  if (shown === null) return null;
  const label = shown ? tp("toggle.hide") : tp("toggle.show");
  return /* @__PURE__ */ jsx46(Tip4, { label, children: /* @__PURE__ */ jsx46(Button30, { variant: "ghost", size: "icon-sm", "data-part": "pane-toggle", "aria-label": label, "aria-pressed": shown, onClick: togglePane, children: /* @__PURE__ */ jsx46(Codicon34, { name: shown ? "layout-sidebar-right" : "layout-sidebar-right-off", size: 15 }) }) });
}
function FilterChip({ label, active, onToggle, icon }) {
  return /* @__PURE__ */ jsxs39("button", { type: "button", className: cx("bare chip t-label"), "aria-pressed": active, "data-active": active ? "true" : void 0, onClick: onToggle, children: [
    /* @__PURE__ */ jsx46(Codicon34, { name: active ? "check" : icon, size: 12, className: cx("chip-icon") }),
    /* @__PURE__ */ jsx46("span", { className: cx("chip-label"), children: label })
  ] });
}
function DensityIcons({ value, onChange }) {
  const tc2 = useT();
  return /* @__PURE__ */ jsx46("div", { className: cx("mode"), "data-part": "density-icons", role: "group", "aria-label": tc2("kit.density.label"), children: /* @__PURE__ */ jsx46(Stack, { direction: "row", gap: 1, children: DENSITIES.map((d) => /* @__PURE__ */ jsx46(
    Button30,
    {
      variant: value === d ? "secondary" : "ghost",
      size: "icon-xs",
      "aria-label": tc2(`kit.density.${d}`),
      title: tc2(`kit.density.${d}`),
      "aria-pressed": value === d,
      onClick: () => onChange(d),
      children: /* @__PURE__ */ jsx46(Codicon34, { name: DENSITY_ICON[d], size: 14 })
    },
    d
  )) }) });
}
function MoreLoader({ onLoad, label, watchKey }) {
  const ref = useRef32(null);
  const cb = useRef32(onLoad);
  cb.current = onLoad;
  const supported = typeof IntersectionObserver !== "undefined";
  useEffect33(() => {
    const el = ref.current;
    if (!el || !supported) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) cb.current();
    }, { rootMargin: "0px 0px 800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [supported, watchKey]);
  return /* @__PURE__ */ jsx46("div", { ref, "data-part": "feed-more", children: supported ? null : /* @__PURE__ */ jsx46(Button30, { variant: "outline", size: "sm", onClick: onLoad, children: label }) });
}
function scopeTab(scope, name) {
  return {
    id: `:${scope.kind}:${scope.id}`,
    name,
    kind: scope.kind === "folder" ? "category" : "channels",
    rules: {
      include: { folders: scope.kind === "folder" ? [scope.id] : [], tags: [], channels: scope.kind === "channel" ? [scope.id] : [], themes: [], lenses: [], all: false, favorites: false },
      exclude: { folders: [], tags: [], channels: [], shorts: false },
      filters: { only_new: false, per_channel: null, min_s: null, max_s: null },
      mode: "fresh"
    },
    icon: null,
    filters: {},
    sort: 0,
    builtin: false
  };
}
function HomePage() {
  return /* @__PURE__ */ jsx46(HomeView, {});
}
function HomeView({
  initialTab,
  initialDensity,
  initialMenuOpen,
  initialFilter,
  initialQuery,
  initialActions,
  initialTabMenu,
  initialDelete,
  initialView,
  initialViewMenu
}) {
  const t = useT("home");
  const tc2 = useT();
  const locale = useLocale();
  const now = useNow2(CLOCK_MS2);
  const fmt = useCallback18((n) => formatNumber(n, locale), [locale]);
  const [density, setDensityState] = useState34(() => initialDensity ?? readPref(STORAGE_KEYS.density, "comfortable", isDensity));
  const [wantedTab, setWantedTab] = useState34(() => initialTab ?? readPref(STORAGE_KEYS.tab, null, isText));
  const setDensity = (d) => {
    setDensityState(d);
    writePref(STORAGE_KEYS.density, d);
  };
  const [viewMap, setViewMap] = useState34(() => {
    const stored = readViewMap();
    const first = initialFilter ? `:${initialFilter.kind}:${initialFilter.id}` : initialTab;
    return initialView && first ? { ...stored, [first]: initialView } : stored;
  });
  const tzOffsetMin = useMemo7(() => browserTzOffsetMin(), []);
  const [query, setQuery] = useState34(initialQuery ?? "");
  const searchText = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const [newOnly, setNewOnly] = useState34(false);
  const [noShorts, setNoShorts] = useState34(false);
  const [seen, setSeen] = useState34(false);
  const [arriving, setArriving] = useState34(null);
  const [kickedAt, setKickedAt] = useState34(null);
  const [menuOpen, setMenuOpen] = useState34(!!initialMenuOpen);
  const [paneFilter, setPaneFilter] = useState34(initialFilter ?? null);
  const [pendingTarget, setPendingTarget] = useState34(null);
  const [epoch, setEpoch] = useState34(0);
  const toolbarEl = useRef32(null);
  const [observeWidth, narrow] = useNarrow(NARROW_PX);
  const toolbarRef = useCallback18(
    (el) => {
      toolbarEl.current = el;
      observeWidth(el);
    },
    [observeWidth]
  );
  const rssRef = useRef32(null);
  const resetFilters = () => {
    setQuery("");
    setNewOnly(false);
    setNoShorts(false);
    setSeen(false);
  };
  const link = usePaneLink({
    onTab: (id) => {
      setPaneFilter(null);
      setWantedTab(id);
      resetFilters();
    },
    onTarget: (target) => setPendingTarget(target)
  });
  const refreshingGuess = kickedAt != null;
  const tabsQ = useRest("GET /tabs", {});
  const statusQ = useRest("GET /status", {}, { refetchInterval: refreshingGuess || arriving ? FAST_POLL_MS : false });
  const status = statusQ.data;
  const totalChannels = typeof status?.channels_total === "number" ? status.channels_total : null;
  const subscribedCount = typeof status?.subscribed_total === "number" ? status.subscribed_total : null;
  const foldersQ = useRest("GET /folders", {}, { enabled: paneFilter?.kind === "folder" });
  const channelQ = useRest("GET /channels/{id}", { path: { id: paneFilter?.kind === "channel" ? paneFilter.id : "" } }, { enabled: paneFilter?.kind === "channel" });
  const [tabOrder, setTabOrder] = useState34(null);
  const [deletedTabs, setDeletedTabs] = useState34(/* @__PURE__ */ new Set());
  const [deletingId, setDeletingId] = useState34(initialDelete ?? null);
  const serverTabs = tabsQ.data ? tabsQ.data.items ?? [] : null;
  const tabs = useMemo7(
    () => serverTabs ? withOrder(serverTabs, tabOrder).filter((x) => !deletedTabs.has(x.id)) : null,
    [serverTabs, tabOrder, deletedTabs]
  );
  useEffect33(() => {
    if (tabOrder && serverTabs && serverTabs.map((x) => x.id).join("\n") === withOrder(serverTabs, tabOrder).map((x) => x.id).join("\n")) setTabOrder(null);
  }, [serverTabs, tabOrder]);
  const tabId = tabs ? wantedTab === LATER_TAB || wantedTab === PLAYLISTS_TAB || wantedTab && tabs.some((x) => x.id === wantedTab) ? wantedTab : tabs[0]?.id ?? LATER_TAB : null;
  const onPlaylists = !paneFilter && tabId === PLAYLISTS_TAB;
  useEffect33(() => {
    if (!pendingTarget || !tabs) return;
    setPendingTarget(null);
    const exact = exactTabFor(pendingTarget, tabs);
    resetFilters();
    if (exact) {
      setPaneFilter(null);
      setWantedTab(exact);
    } else {
      setPaneFilter({ kind: pendingTarget.kind, id: pendingTarget.id });
    }
  }, [pendingTarget, tabs]);
  const filterName = paneFilter?.kind === "folder" ? foldersQ.data?.items?.find((f) => f.id === paneFilter.id)?.name ?? "" : paneFilter?.kind === "channel" ? channelQ.data?.channel?.title ?? "" : "";
  const activeId = paneFilter ? null : tabId;
  const activeTab = paneFilter ? scopeTab(paneFilter, filterName) : tabs?.find((x) => x.id === activeId) ?? null;
  const onlyNewTab = !paneFilter && !!activeTab?.rules?.filters?.only_new;
  const isWelcome = totalChannels === 0 && !arriving;
  const source = isWelcome ? null : paneFilter ? { kind: "scope", scope: paneFilter } : !activeId || activeId === PLAYLISTS_TAB ? null : activeId === LATER_TAB ? { kind: "later" } : seen && onlyNewTab && activeTab ? { kind: "seen", tabId: activeId, rules: activeTab.rules } : { kind: "tab", tabId: activeId };
  const viewKey = paneFilter ? `:${paneFilter.kind}:${paneFilter.id}` : activeId;
  const groupChoices = groupsFor(paneFilter, paneFilter ? null : activeTab);
  const listView = effectiveView((viewKey ? viewMap[viewKey] : void 0) ?? DEFAULT_VIEW, groupChoices);
  const orderable = serverOrder(source);
  const order = orderable ? { ...listView, tzOffsetMin } : null;
  const grouping = order?.group ?? "none";
  const setListView = (next) => {
    if (!viewKey) return;
    setViewMap((m) => ({ ...m, [viewKey]: next }));
    writePref(STORAGE_KEYS.view, { ...readViewMap(), [viewKey]: next });
  };
  const feed = useFeed(source, { refetchInterval: arriving ? FAST_POLL_MS : false, q: searchText, order });
  const remoteSearch = serverSearch(source);
  const actions = useVideoActions(t, tc2);
  const reads = useMarkRead(t, tc2);
  const refreshing = !!status?.refresh_running || refreshingGuess;
  const refresh2 = useCallback18(() => {
    setKickedAt(Date.now());
    setEpoch((e) => e + 1);
    restCall("POST /refresh", { body: { force: true } }).then(
      (r) => {
        if (r.result === "skipped") {
          setKickedAt(null);
          host21.notify({ kind: "info", message: t("toast.refresh_skipped") });
        }
        void invalidateRest("GET /status");
      },
      (error) => {
        setKickedAt(null);
        host21.notify({ kind: "error", message: t("toast.refresh_failed", { error: errorText(tc2, toApiError(error)) }) });
      }
    );
  }, [t, tc2]);
  const prevRunning = useRef32(void 0);
  const prevRss = useRef32(void 0);
  useEffect33(() => {
    if (!status) return;
    const wasRunning = prevRunning.current;
    const lastRss = prevRss.current;
    prevRunning.current = status.refresh_running;
    prevRss.current = status.last_rss_at;
    const finished = wasRunning === true && !status.refresh_running;
    if (finished) setKickedAt(null);
    if (finished || lastRss !== void 0 && lastRss !== status.last_rss_at) void invalidateRest("GET /feed", "POST /feed/preview");
  }, [status]);
  useEffect33(() => {
    if (kickedAt == null) return;
    const id = setTimeout(() => setKickedAt(null), 15e3);
    return () => clearTimeout(id);
  }, [kickedAt]);
  useEffect33(() => {
    if (!arriving) return;
    const age = now - arriving.since;
    if (age > ARRIVING_MAX_MS || feed.items.length > 0 && status && !status.refresh_running && age > 8e3) setArriving(null);
  }, [arriving, now, feed.items.length, status]);
  useEffect33(() => {
    if (!arriving) return;
    const id = setTimeout(() => setArriving((a) => a === arriving ? null : a), ARRIVING_MAX_MS);
    return () => clearTimeout(id);
  }, [arriving]);
  const selectTab = (id) => {
    setPaneFilter(null);
    setWantedTab(id);
    writePref(STORAGE_KEYS.tab, id);
    link.noteTab(id);
    resetFilters();
  };
  useNavDetail("home", activeId);
  useNavRestore("home", (id) => {
    if (id !== activeId && tabItems?.some((x) => x.id === id)) selectTab(id);
  });
  const reorderTabs = (ids) => {
    setTabOrder(ids);
    restCall("POST /tabs/reorder", { body: { ids } }).then(
      () => void invalidateRest("GET /tabs"),
      (error) => {
        setTabOrder(null);
        void invalidateRest("GET /tabs");
        host21.notify({ kind: "error", message: t("toast.reorder_failed", { error: errorText(tc2, toApiError(error)) }) });
      }
    );
  };
  const moveTab = (id, delta) => {
    const ids = (tabs ?? []).map((x) => x.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    ids.splice(i, 1);
    ids.splice(j, 0, id);
    reorderTabs(ids);
  };
  const tabMenu = (id) => {
    const list = tabs ?? [];
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const tab = list[i];
    const entries = [
      { id: "edit", label: t("tab_menu.edit"), icon: "edit", onSelect: () => openDialog("tab-editor", { tabId: id }) },
      { id: "move_left", label: t("tab_menu.move_left"), icon: "arrow-left", disabled: i === 0, onSelect: () => moveTab(id, -1) },
      { id: "move_right", label: t("tab_menu.move_right"), icon: "arrow-right", disabled: i === list.length - 1, onSelect: () => moveTab(id, 1) }
    ];
    if (!tab.builtin) entries.push({ id: "delete", label: t("tab_menu.delete"), icon: "trash", destructive: true, onSelect: () => setDeletingId(id) });
    return entries;
  };
  const deleting = deletingId ? tabs?.find((x) => x.id === deletingId) ?? null : null;
  const deletingName = deleting ? tabLabel(deleting, t) : "";
  const confirmDelete = async () => {
    const tab = deleting;
    if (!tab) return;
    const list = tabs ?? [];
    const i = list.findIndex((x) => x.id === tab.id);
    const neighbor = list[i + 1]?.id ?? list[i - 1]?.id ?? LATER_TAB;
    const name = tabLabel(tab, t);
    let result;
    try {
      result = await restCall("DELETE /tabs/{id}", { path: { id: tab.id } });
    } catch (error) {
      throw new Error(t("tab_menu.delete_failed", { error: errorText(tc2, toApiError(error)) }));
    }
    setDeletedTabs((s) => new Set(s).add(tab.id));
    setTabOrder((o) => o ? o.filter((x) => x !== tab.id) : o);
    if (tabId === tab.id && !paneFilter) selectTab(neighbor);
    void invalidateRest("GET /tabs", "GET /status");
    const changeId = result?.change_id;
    host21.notify({
      kind: "success",
      message: t("toast.tab_deleted", { name }),
      durationMs: UNDO_MS3,
      ...typeof changeId === "number" ? {
        action: {
          label: t("toast.undo"),
          onClick: () => {
            restCall("POST /changes/{id}/undo", { path: { id: changeId } }).then(
              () => {
                setDeletedTabs((s) => {
                  const n = new Set(s);
                  n.delete(tab.id);
                  return n;
                });
                void invalidateRest("GET /tabs", "GET /status");
              },
              (error) => host21.notify({ kind: "error", message: t("toast.undo_failed", { error: errorText(tc2, toApiError(error)) }) })
            );
          }
        }
      } : {}
    });
  };
  const countByTab = useMemo7(() => {
    const m = /* @__PURE__ */ new Map();
    for (const c of status?.new_by_tab ?? []) m.set(c.tab_id, c.count);
    return m;
  }, [status]);
  const tabItems = tabs ? [
    ...tabs.map((tab) => ({
      id: tab.id,
      label: tabLabel(tab, t),
      icon: tabIcon(tab),
      count: reads.read.has(tab.id) ? null : countByTab.get(tab.id) ?? null
    })),
    { id: LATER_TAB, label: t("tabs.later"), icon: "clock" },
    { id: PLAYLISTS_TAB, label: t("tabs.playlists"), icon: "list-unordered" }
  ] : null;
  const activeLabel = paneFilter ? filterName : activeId === LATER_TAB ? t("tabs.later") : activeId === PLAYLISTS_TAB ? t("tabs.playlists") : activeTab ? tabLabel(activeTab, t) : "";
  const readKey = activeTab?.id ?? null;
  const readActive = !!readKey && reads.read.has(readKey);
  const typed = query.trim();
  const localNeedle = remoteSearch ? "" : fold2(typed);
  const searching = !!typed;
  const chips = newOnly || noShorts;
  const filtering = searching || chips;
  const sessionKey = JSON.stringify([source, searchText, newOnly, noShorts, seen, density, epoch, order]);
  const session = useListSession(sessionKey);
  const [collapsedRaw, setCollapsed] = useState34(() => ({ key: sessionKey, keys: /* @__PURE__ */ new Set() }));
  const collapsed = collapsedRaw.key === sessionKey ? collapsedRaw.keys : NO_KEYS;
  const toggleGroup = (k) => setCollapsed((c) => {
    const keys = new Set(c.key === sessionKey ? c.keys : NO_KEYS);
    if (keys.has(k)) keys.delete(k);
    else keys.add(k);
    return { key: sessionKey, keys };
  });
  const shownGrouping = useRef32(grouping);
  if (!feed.reordering && !feed.pending) shownGrouping.current = grouping;
  const drawGroup = feed.reordering ? shownGrouping.current : grouping;
  const groupFoldersQ = useRest("GET /folders", {}, { enabled: grouping === "folder" || drawGroup === "folder" });
  const folderById = useMemo7(() => new Map((groupFoldersQ.data?.items ?? []).map((f) => [f.id, f])), [groupFoldersQ.data]);
  const isGone = (it) => session.gone.has(it.video.id) && actions.isHidden(it);
  const shown = feed.items.filter((it) => !actions.isHidden(it) || session.gone.has(it.video.id)).map((it) => {
    const v = actions.view(it);
    return readActive && v.is_new ? { ...v, is_new: false } : v;
  });
  const visible = shown.filter(
    (it) => matches(it, localNeedle) && (!newOnly || it.is_new || session.touched.has(it.video.id)) && (!noShorts || !it.video.is_short)
  );
  let featured = null;
  if (density === "comfortable" && !filtering && drawGroup === "none") {
    const pinned = session.touched.size && session.featured ? visible.find((it) => it.video.id === session.featured && canFeature(it)) : void 0;
    featured = pinned ?? featuredOf(visible.filter((it) => !isGone(it)));
    session.featured = featured?.video.id ?? null;
  }
  const resultCount = !filtering ? null : feed.searching || feed.reordering ? null : remoteSearch && searching && !noShorts ? newOnly ? feed.fresh : feed.total : visible.length;
  const gridItems = featured ? visible.filter((it) => it !== featured) : visible;
  const playFrom = (it) => openVideo(it.video.id, { item: it, list: (featured ? [featured, ...gridItems] : gridItems).filter((x) => !isGone(x)), source: activeLabel });
  const variant = cardVariantFor(density);
  const reactions = density !== "compact";
  const onAction = (a, item) => {
    if (!isVideoAction(a)) return;
    session.touched.add(item.video.id);
    if (a === "archive" && item.state !== "archived") session.gone.add(item.video.id);
    actions.run(a, item);
  };
  const onKeyAction = (a, item) => {
    if (a === "playlist" && !isGone(item)) return openPlaylistPicker(item);
    if (!isVideoAction(a) || isGone(item) && a !== "archive") return;
    session.touched.add(item.video.id);
    actions.run(a, item);
  };
  const initialDone = useRef32(false);
  useEffect33(() => {
    if (initialDone.current || !initialActions?.length || !visible.length) return;
    initialDone.current = true;
    for (const [a, i] of initialActions) if (visible[i]) onAction(a, visible[i]);
  });
  const cardFor = (it, v, withReactions) => {
    const cardEl = /* @__PURE__ */ jsx46(VideoCard, { item: v === "compact" ? compactWhy(it) : it, variant: v, onOpen: () => playFrom(it), actions: /* @__PURE__ */ jsx46(CardActions, { item: it, onAction, reactions: withReactions }) });
    return isGone(it) ? /* @__PURE__ */ jsx46(GoneSlot, { onUndo: () => onAction("archive", it), children: cardEl }) : cardEl;
  };
  const focusSearch = () => toolbarEl.current?.querySelector("input")?.focus();
  const gridOf = (items, label) => /* @__PURE__ */ jsx46(
    Grid,
    {
      items,
      getKey: (it) => it.video.id,
      label,
      density,
      shortcuts: SHORTCUTS,
      onAction: onKeyAction,
      onOpen: (it) => {
        if (!isGone(it)) playFrom(it);
      },
      onSearch: focusSearch,
      renderItem: (it) => cardFor(it, variant, reactions)
    }
  );
  const clearFilters = () => {
    setQuery("");
    setNewOnly(false);
    setNoShorts(false);
  };
  const markRead = () => {
    if (paneFilter) reads.mark(`:${paneFilter.kind}:${paneFilter.id}`, { kind: paneFilter.kind, id: paneFilter.id }, activeLabel);
    else if (activeTab) reads.mark(activeTab.id, readScopeOf(activeTab), activeLabel);
  };
  const neverPaired = useNeverPaired(!isWelcome);
  const bannerKind = pickBanner2({ status, subscribed: subscribedCount, arriving: !!arriving, neverPaired });
  const rssDetail = bannerKind === "rss_down" && status && status.rss_fallback_channels > 0 ? t("banner.rss_fallback", { count: fmt(status.rss_fallback_channels) }) : null;
  let banner = null;
  if (bannerKind === "arriving" && arriving) {
    banner = /* @__PURE__ */ jsx46(Banner, { tone: "info", icon: "sync", children: arriving.kind === "demo" ? t("banner.demo_arriving", { count: fmt(feed.total ?? 0), channels: fmt(arriving.channels) }) : t("banner.channel_arriving", { title: arriving.title ?? "" }) });
  } else if (bannerKind === "rss_down" && status?.rss_down_since != null) {
    banner = /* @__PURE__ */ jsx46(Banner, { tone: "warning", action: { label: t("banner.retry"), onClick: refresh2 }, children: /* @__PURE__ */ jsx46("span", { ref: rssRef, "data-part": "rss-down", children: t(status.rss_fallback_channels > 0 ? "banner.rss_down" : "banner.rss_down_stale", { time: sinceText(status.rss_down_since, locale, now) }) }) });
  } else if (bannerKind === "ext_not_paired") {
    banner = /* @__PURE__ */ jsx46(Banner, { tone: "info", icon: "extensions", action: { label: t("banner.connect"), onClick: () => openDialog("onboarding", { step: "pair" }) }, children: t("banner.ext_not_paired") });
  } else if (bannerKind === "ext_disconnected") {
    banner = /* @__PURE__ */ jsx46(Banner, { tone: "info", icon: "debug-disconnect", action: { label: t("banner.reconnect"), onClick: () => openDialog("onboarding", { step: "pair" }) }, children: t("banner.ext_disconnected") });
  }
  useLayoutEffect7(() => {
    const action = rssRef.current?.closest('[data-part="banner"]')?.querySelector('[data-part="banner-action"]');
    if (!action) return;
    if (rssDetail) action.setAttribute("title", rssDetail);
    else action.removeAttribute("title");
  });
  if (isWelcome && !(!tabs && tabsQ.error)) {
    return /* @__PURE__ */ jsx46(SectionFrame, { current: "home", children: /* @__PURE__ */ jsx46(Page, { narrow: true, banner, children: /* @__PURE__ */ jsx46(Welcome, { onArriving: setArriving }) }) });
  }
  let subtitle = " ";
  if (status) {
    const when = refreshing ? t("subtitle.refreshing") : status.last_rss_at ? t("subtitle.updated", { when: formatRelative(status.last_rss_at, now, locale) }) : t("subtitle.never");
    subtitle = `${t("subtitle.new", { count: fmt(status.new_total) })} · ${when}`;
  } else if (statusQ.error) {
    subtitle = t("subtitle.status_error");
  }
  const headerActions = /* @__PURE__ */ jsxs39(Fragment22, { children: [
    /* @__PURE__ */ jsx46(PaneToggle, {}),
    EXTRAS_PAGE_READY ? /* @__PURE__ */ jsxs39(Button30, { variant: "ghost", size: "sm", onClick: () => showSection("extras"), children: [
      /* @__PURE__ */ jsx46(Codicon34, { name: "sparkle", size: 14 }),
      t("actions.extras")
    ] }) : null,
    /* @__PURE__ */ jsxs39(Button30, { variant: "outline", size: "sm", loading: refreshing, onClick: refresh2, "aria-label": t("actions.refresh"), children: [
      /* @__PURE__ */ jsx46(Codicon34, { name: "refresh", size: 14 }),
      t("actions.refresh")
    ] })
  ] });
  const toolbar = tabItems && tabId ? /* @__PURE__ */ jsx46(
    TabBar,
    {
      tabs: tabItems,
      value: activeId ?? "",
      onChange: selectTab,
      label: t("tabs.label"),
      addSlot: /* @__PURE__ */ jsxs39(Fragment22, { children: [
        /* @__PURE__ */ jsx46(NewTabMenu, { open: menuOpen, onOpenChange: setMenuOpen }),
        /* @__PURE__ */ jsx46(ThemeSlot, { compact: narrow })
      ] }),
      onReorder: reorderTabs,
      reorderable: (id) => id !== LATER_TAB && id !== PLAYLISTS_TAB,
      menu: tabMenu,
      defaultMenuTab: initialTabMenu
    }
  ) : tabsQ.error ? null : /* @__PURE__ */ jsx46(TabBarSkeleton, { count: 5 });
  const filterRow = paneFilter ? /* @__PURE__ */ jsx46("div", { "data-part": "pane-filter", role: "status", children: /* @__PURE__ */ jsxs39(Stack, { direction: "row", gap: 2, wrap: true, children: [
    /* @__PURE__ */ jsxs39("span", { className: cx("chip t-label"), "data-part": "pane-filter-chip", "data-active": "true", children: [
      /* @__PURE__ */ jsx46(Codicon34, { name: paneFilter.kind === "folder" ? "folder" : "account", size: 12, className: cx("chip-icon") }),
      /* @__PURE__ */ jsx46("span", { className: cx("chip-label"), children: t("pane_filter.label", { name: filterName || "…" }) }),
      /* @__PURE__ */ jsx46("button", { type: "button", className: cx("bare chip-remove"), "data-part": "pane-filter-clear", "aria-label": t("pane_filter.clear"), title: t("pane_filter.clear"), onClick: () => setPaneFilter(null), children: /* @__PURE__ */ jsx46(Codicon34, { name: "close", size: 10 }) })
    ] }),
    /* @__PURE__ */ jsxs39(
      Button30,
      {
        variant: "ghost",
        size: "xs",
        "data-part": "pane-filter-create",
        onClick: () => openDialog("tab-editor", {
          preset: paneFilter.kind === "folder" ? { name: filterName, kind: "category", rules: { include: { folders: [paneFilter.id] } } } : { name: filterName, kind: "channels", rules: { include: { channels: [paneFilter.id] } } }
        }),
        children: [
          /* @__PURE__ */ jsx46(Codicon34, { name: "add", size: 13 }),
          t("pane_filter.create_tab")
        ]
      }
    )
  ] }) }) : null;
  const filterBar = /* @__PURE__ */ jsx46("div", { ref: toolbarRef, children: /* @__PURE__ */ jsx46(
    Toolbar,
    {
      end: /* @__PURE__ */ jsxs39(Fragment22, { children: [
        /* @__PURE__ */ jsx46(OpenModeSwitch, { compact: narrow }),
        orderable ? /* @__PURE__ */ jsx46(ViewControls, { value: listView, groups: groupChoices, onChange: setListView, narrow, initialOpen: initialViewMenu }) : null,
        narrow ? /* @__PURE__ */ jsx46(DensityIcons, { value: density, onChange: setDensity }) : /* @__PURE__ */ jsx46(ModeSwitch, { value: density, onChange: setDensity })
      ] }),
      children: /* @__PURE__ */ jsxs39(
        FilterBar,
        {
          query,
          onQueryChange: setQuery,
          placeholder: t("filters.search"),
          resultCount,
          onClear: filtering ? clearFilters : void 0,
          children: [
            activeId !== LATER_TAB ? /* @__PURE__ */ jsx46(FilterChip, { icon: "circle-filled", label: t("filters.new_only"), active: newOnly, onToggle: () => setNewOnly((v) => !v) }) : null,
            /* @__PURE__ */ jsx46(FilterChip, { icon: "device-mobile", label: t("filters.no_shorts"), active: noShorts, onToggle: () => setNoShorts((v) => !v) }),
            onlyNewTab ? /* @__PURE__ */ jsx46(FilterChip, { icon: "eye", label: t("filters.show_seen"), active: seen, onToggle: () => setSeen((v) => !v) }) : null
          ]
        }
      )
    }
  ) });
  const searchEmpty = /* @__PURE__ */ jsx46("div", { "data-part": "search-empty", children: /* @__PURE__ */ jsx46(
    EmptyView,
    {
      compact: true,
      icon: "search",
      title: searching ? t("empty.search_title", { query: typed }) : t("empty.filter_title"),
      description: searching ? remoteSearch ? t("empty.search_desc") : t("empty.search_loaded_desc", { query: typed }) : t("empty.filter_desc"),
      action: /* @__PURE__ */ jsx46(Button30, { variant: "outline", size: "sm", onClick: clearFilters, children: searching && chips ? t("empty.clear") : searching ? t("empty.clear_search") : t("empty.clear_filters") })
    }
  ) });
  const unknownChannels = totalChannels === null && !statusQ.error;
  let body;
  if (!tabs && tabsQ.error) {
    body = /* @__PURE__ */ jsx46(ErrorView, { error: tabsQ.error, onRetry: () => void tabsQ.refetch() });
  } else if (onPlaylists) {
    body = /* @__PURE__ */ jsx46(PlaylistsView, { density, onBrowse: () => selectTab(tabs?.[0]?.id ?? "all-new") });
  } else if (!tabs || feed.pending || !feed.items.length && !feed.error && !searching && (arriving || unknownChannels)) {
    body = /* @__PURE__ */ jsxs39(Fragment22, { children: [
      filterRow,
      /* @__PURE__ */ jsx46(GridSkeleton, { density, count: density === "list" ? 6 : 8, label: t("feed.loading") })
    ] });
  } else if (feed.error) {
    body = /* @__PURE__ */ jsxs39(Fragment22, { children: [
      filterRow,
      searching ? filterBar : null,
      /* @__PURE__ */ jsx46(ErrorView, { error: feed.error, onRetry: feed.refetch })
    ] });
  } else if (!shown.length && !searching) {
    body = /* @__PURE__ */ jsxs39(Fragment22, { children: [
      filterRow,
      tabEmpty()
    ] });
  } else {
    body = /* @__PURE__ */ jsxs39(Fragment22, { children: [
      filterRow,
      filterBar,
      featured ? /* @__PURE__ */ jsx46(Section, { title: t("sections.featured"), children: /* @__PURE__ */ jsx46("div", { "data-part": "featured-slot", children: cardFor(featured, "featured", true) }) }) : null,
      /* @__PURE__ */ jsxs39(
        Section,
        {
          title: activeLabel,
          actions: /* @__PURE__ */ jsxs39(Stack, { direction: "row", gap: 3, align: "center", children: [
            feed.searching ? /* @__PURE__ */ jsx46("span", { className: cx("t-label"), "data-part": "feed-searching", "aria-live": "polite", children: t("feed.searching") }) : feed.reordering ? /* @__PURE__ */ jsx46("span", { className: cx("t-label"), "data-part": "feed-reordering", "aria-live": "polite", children: t("feed.reordering") }) : feed.total != null ? /* @__PURE__ */ jsx46("span", { className: cx("t-label num"), children: t("feed.count", { count: fmt(feed.total) }) }) : null,
            activeId !== LATER_TAB && canMarkRead(activeTab) ? /* @__PURE__ */ jsxs39(Button30, { variant: "ghost", size: "xs", onClick: markRead, children: [
              /* @__PURE__ */ jsx46(Codicon34, { name: "check-all", size: 13 }),
              t("actions.mark_read")
            ] }) : null
          ] }),
          children: [
            gridItems.length && drawGroup !== "none" ? /* @__PURE__ */ jsx46(
              GroupedGrids,
              {
                runs: runsOf(gridItems, drawGroup, tzOffsetMin),
                group: drawGroup,
                folders: folderById,
                tzOffsetMin,
                locale,
                more: feed.hasMore,
                collapsed,
                onToggle: toggleGroup,
                renderGrid: (run, name) => gridOf(run.items, t("feed.group_label", { tab: activeLabel, group: name }))
              }
            ) : gridItems.length ? gridOf(gridItems, t("feed.label", { tab: activeLabel })) : filtering && !feed.searching && !feed.reordering ? searchEmpty : null,
            feed.loadingMore ? /* @__PURE__ */ jsx46(GridSkeleton, { density, count: MORE_SKELETON[density], label: t("feed.loading_more") }) : null,
            feed.moreError ? /* @__PURE__ */ jsx46(ErrorView, { compact: true, title: t("feed.more_error"), error: feed.moreError, onRetry: feed.loadMore }) : null,
            feed.hasMore && !feed.loadingMore && !feed.moreError ? /* @__PURE__ */ jsx46(
              MoreLoader,
              {
                onLoad: feed.loadMore,
                label: t("feed.load_more"),
                watchKey: `${source ? JSON.stringify(source) : ""}:${seen}:${searchText}:${JSON.stringify(order)}:${feed.items.length}:${visible.length}`
              }
            ) : null
          ]
        }
      )
    ] });
  }
  function tabEmpty() {
    if (activeId === LATER_TAB) {
      return /* @__PURE__ */ jsx46(
        EmptyView,
        {
          icon: "clock",
          title: t("empty.later_title"),
          description: t("empty.later_desc"),
          action: /* @__PURE__ */ jsx46(Button30, { variant: "outline", size: "sm", onClick: () => selectTab(tabs?.[0]?.id ?? "all-new"), children: t("empty.see_all") })
        }
      );
    }
    const first = tabs?.[0]?.id;
    const canSeeAll = !!first && (!!paneFilter || activeId !== first);
    const canShowSeen = onlyNewTab && !seen;
    return /* @__PURE__ */ jsx46(
      EmptyView,
      {
        icon: refreshing ? "sync" : "check-all",
        title: refreshing ? t("empty.refreshing_title") : t("empty.tab_title"),
        description: t("empty.tab_desc", { tab: activeLabel }),
        action: /* @__PURE__ */ jsxs39(Stack, { direction: "row", gap: 2, wrap: true, justify: "end", children: [
          canSeeAll ? /* @__PURE__ */ jsx46(Button30, { variant: "outline", size: "sm", onClick: () => selectTab(first), children: t("empty.see_all") }) : null,
          canShowSeen ? /* @__PURE__ */ jsx46(Button30, { variant: "outline", size: "sm", onClick: () => setSeen(true), children: t("empty.show_seen") }) : null,
          !canSeeAll && !canShowSeen ? /* @__PURE__ */ jsx46(Button30, { variant: "outline", size: "sm", onClick: refresh2, loading: refreshing, children: t("actions.refresh") }) : null
        ] })
      }
    );
  }
  return (
    // section selector (Subscriptions · Manage · Cleanup), the same on all three screens
    /* @__PURE__ */ jsx46(SectionFrame, { current: "home", children: /* @__PURE__ */ jsxs39(Page, { title: t("title"), subtitle, actions: headerActions, toolbar, banner, children: [
      body,
      /* @__PURE__ */ jsx46(PlaylistPicker, {}),
      /* @__PURE__ */ jsx46(
        ConfirmDialog2,
        {
          open: !!deleting,
          onClose: () => setDeletingId(null),
          onConfirm: confirmDelete,
          title: t("tab_menu.delete_title", { name: deletingName }),
          description: t("tab_menu.delete_desc"),
          confirmLabel: t("tab_menu.delete_confirm"),
          cancelLabel: t("tab_menu.delete_cancel"),
          destructive: true
        }
      )
    ] }) })
  );
}

// desktop-src/pages/manage/index.tsx
import { Button as Button33, Codicon as Codicon39, useQuery as useQuery3 } from "@hermes/plugin-sdk";
import { useCallback as useCallback21, useEffect as useEffect36, useLayoutEffect as useLayoutEffect11, useMemo as useMemo10, useRef as useRef37, useState as useState40 } from "react";

// desktop-src/pages/manage/Batch.tsx
import { Button as Button32, Codicon as Codicon36 } from "@hermes/plugin-sdk";
import { useState as useState36 } from "react";

// desktop-src/pages/manage/Picker.tsx
import { Button as Button31, Codicon as Codicon35 } from "@hermes/plugin-sdk";
import { useEffect as useEffect34, useId as useId7, useLayoutEffect as useLayoutEffect8, useMemo as useMemo8, useRef as useRef33, useState as useState35 } from "react";

// desktop-src/pages/manage/model.ts
var RELATION_FILTERS = ["active", "subscribed", "followed", "ex", "ignored"];
var STALE_MONTHS = [3, 6, 12];
var DEFAULT_FILTERS = {
  q: "",
  folder: null,
  tag: null,
  relation: "active",
  favorite: false,
  muted: false,
  staleMonths: null
};
function activeChips(f) {
  const out = [];
  if (f.folder) out.push("folder");
  if (f.tag) out.push("tag");
  if (f.relation !== "active") out.push("relation");
  if (f.favorite) out.push("favorite");
  if (f.muted) out.push("muted");
  if (f.staleMonths) out.push("stale");
  return out;
}
function clearChip(f, chip) {
  switch (chip) {
    case "folder":
      return { ...f, folder: null };
    case "tag":
      return { ...f, tag: null };
    case "relation":
      return { ...f, relation: "active" };
    case "favorite":
      return { ...f, favorite: false };
    case "muted":
      return { ...f, muted: false };
    case "stale":
      return { ...f, staleMonths: null };
  }
}
function hasFilters(f) {
  return f.q.trim() !== "" || activeChips(f).length > 0;
}
function normalize(text) {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().trim();
}
function inRelation(relation, filter) {
  if (filter === "active") return relation === "subscribed" || relation === "followed";
  return relation === filter;
}
function folderDescendants(folders, id) {
  const children = /* @__PURE__ */ new Map();
  for (const f of folders) {
    if (!f.parent_id) continue;
    const list = children.get(f.parent_id) ?? [];
    list.push(f.id);
    children.set(f.parent_id, list);
  }
  const out = /* @__PURE__ */ new Set([id]);
  const stack = [id];
  while (stack.length) {
    for (const c of children.get(stack.pop()) ?? []) {
      if (out.has(c)) continue;
      out.add(c);
      stack.push(c);
    }
  }
  return out;
}
var MONTH_S = 30 * 86400;
function applyFilters(rows, f, ctx) {
  const known = new Set(ctx.folders.map((x) => x.id));
  const inFolder = f.folder && f.folder !== "none" ? folderDescendants(ctx.folders, f.folder) : null;
  const words = normalize(f.q).split(/\s+/).filter(Boolean);
  const staleBefore = f.staleMonths ? ctx.nowS - f.staleMonths * MONTH_S : null;
  return rows.filter(({ channel: c }) => {
    if (!inRelation(c.relation, f.relation)) return false;
    if (f.folder === "none" && c.folder_id && known.has(c.folder_id)) return false;
    if (inFolder && !(c.folder_id && inFolder.has(c.folder_id))) return false;
    if (f.tag && !c.tag_ids.includes(f.tag)) return false;
    if (f.favorite && !c.favorite) return false;
    if (f.muted && !c.muted) return false;
    if (staleBefore !== null && !(c.last_video_at != null && c.last_video_at < staleBefore)) return false;
    if (words.length) {
      const hay = normalize(`${c.title} ${c.handle ?? ""}`);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}
function folderCounts(rows, folders) {
  const parent = new Map(folders.map((f) => [f.id, f.parent_id]));
  const out = /* @__PURE__ */ new Map([["all", rows.length], ["none", 0]]);
  for (const f of folders) out.set(f.id, 0);
  for (const { channel: c } of rows) {
    if (!c.folder_id || !parent.has(c.folder_id)) {
      out.set("none", (out.get("none") ?? 0) + 1);
      continue;
    }
    const seen = /* @__PURE__ */ new Set();
    for (let id = c.folder_id; id && !seen.has(id); id = parent.get(id)) {
      seen.add(id);
      out.set(id, (out.get(id) ?? 0) + 1);
    }
  }
  return out;
}
function folderTree(folders) {
  const known = new Set(folders.map((f) => f.id));
  const byParent = /* @__PURE__ */ new Map();
  for (const f of folders) {
    const p = f.parent_id && known.has(f.parent_id) ? f.parent_id : null;
    const list = byParent.get(p) ?? [];
    list.push(f);
    byParent.set(p, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const walk = (p, level) => {
    for (const f of byParent.get(p) ?? []) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ folder: f, level });
      walk(f.id, level + 1);
    }
  };
  walk(null, 1);
  return out;
}
var DEFAULT_SORT = { key: "name", dir: "asc" };
function firstDir(key) {
  return key === "name" || key === "folder" || key === "relation" || key === "tags" ? "asc" : "desc";
}
function nextSort(current2, key) {
  if (current2.key !== key) return { key, dir: firstDir(key) };
  return { key, dir: current2.dir === "asc" ? "desc" : "asc" };
}
var RELATION_ORDER = { subscribed: 0, followed: 1, ignored: 2, ex: 3 };
function sortValue(row, key, folderName, tagName) {
  const c = row.channel;
  switch (key) {
    case "name":
      return normalize(c.title);
    case "folder": {
      const name = c.folder_id ? folderName.get(c.folder_id) : void 0;
      return name ? normalize(name) : null;
    }
    case "tags": {
      const names = c.tag_ids.map((id) => tagName.get(id)).filter((n) => !!n);
      return names.length ? normalize(names.sort().join(" ")) : null;
    }
    case "last":
      return c.last_video_at;
    case "rhythm":
      return c.videos_per_week;
    case "shorts":
      return c.shorts_ratio;
    case "watched":
      return row.watched_90d;
    case "relation":
      return RELATION_ORDER[c.relation] ?? 9;
  }
}
function sortRows(rows, sort, folderName, tagName = /* @__PURE__ */ new Map()) {
  const sign = sort.dir === "asc" ? 1 : -1;
  const keyed = rows.map((r) => ({ r, v: sortValue(r, sort.key, folderName, tagName), n: normalize(r.channel.title) }));
  keyed.sort((a, b) => {
    if (a.v === null || b.v === null) {
      if (a.v === null && b.v !== null) return 1;
      if (b.v === null && a.v !== null) return -1;
    } else if (a.v !== b.v) {
      const cmp = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : String(a.v).localeCompare(String(b.v));
      if (cmp) return sign * cmp;
    }
    return a.n.localeCompare(b.n) || a.r.channel.id.localeCompare(b.r.channel.id);
  });
  return keyed.map((k) => k.r);
}
var ALL_COLUMNS = ["select", "name", "folder", "tags", "last", "rhythm", "shorts", "watched", "relation"];
var NUMERIC_COLUMNS = /* @__PURE__ */ new Set(["last", "rhythm", "shorts", "watched"]);
var COLUMN_WIDTH = {
  select: 28,
  name: 220,
  folder: 136,
  tags: 152,
  last: 96,
  rhythm: 76,
  shorts: 64,
  watched: 80,
  relation: 92
};
var COLUMN_GAP = 12;
var DROP_ORDER = ["shorts", "rhythm", "relation", "watched", "tags", "last", "folder"];
function dataColumns(rows) {
  const has = (fn) => rows.some((r) => fn(r) != null);
  return ALL_COLUMNS.filter((c) => {
    if (c === "rhythm") return has((r) => r.channel.videos_per_week);
    if (c === "shorts") return has((r) => r.channel.shorts_ratio);
    if (c === "watched") return has((r) => r.watched_90d);
    return true;
  });
}
var NAME_MAX_NEED = 340;
var NAME_CHROME = 24 + 6 + 4 + 20 + 16;
function nameNeed(rows) {
  if (!rows.length) return COLUMN_WIDTH.name;
  const lens = rows.map((r) => r.channel.title.length).sort((a, b) => a - b);
  const p90 = lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.9))];
  return Math.round(Math.min(NAME_MAX_NEED, Math.max(COLUMN_WIDTH.name, p90 * 6.8 + NAME_CHROME)));
}
function widthOf(cols, nameMin) {
  return cols.reduce((s, c) => s + (c === "name" ? nameMin : COLUMN_WIDTH[c]), 0) + Math.max(0, cols.length - 1) * COLUMN_GAP;
}
function fitColumns(cols, width, nameMin = COLUMN_WIDTH.name) {
  let out = [...cols];
  if (!width) return out;
  for (const drop of DROP_ORDER) {
    if (widthOf(out, nameMin) <= width) break;
    out = out.filter((c) => c !== drop);
  }
  return out;
}
function gridTemplate(cols, nameMin = COLUMN_WIDTH.name) {
  return cols.map((c) => c === "name" ? `minmax(${nameMin}px, 1fr)` : `${COLUMN_WIDTH[c]}px`).join(" ");
}
var ROW_H = 38;
function windowRange({ scrollTop, viewport, bodyTop, total, overscan = 8 }) {
  const top = Math.max(0, scrollTop - bodyTop);
  const first = Math.floor(top / ROW_H);
  const last = Math.ceil((top + Math.max(viewport, 0)) / ROW_H);
  const start = Math.min(Math.max(0, first - overscan), Math.max(0, total));
  const end = Math.min(total, Math.max(start, last + overscan));
  return { start, end };
}
var VIEW_KEY = "manage.view";
var SORT_KEYS = ["name", "folder", "tags", "last", "rhythm", "shorts", "watched", "relation"];
function parseView(raw) {
  const v = raw && typeof raw === "object" ? raw : {};
  const f = v.filters && typeof v.filters === "object" ? v.filters : {};
  const s = v.sort && typeof v.sort === "object" ? v.sort : {};
  const str2 = (x) => typeof x === "string" && x ? x : null;
  return {
    filters: {
      q: typeof f.q === "string" ? f.q : "",
      folder: str2(f.folder),
      tag: str2(f.tag),
      relation: RELATION_FILTERS.includes(f.relation) ? f.relation : "active",
      favorite: f.favorite === true,
      muted: f.muted === true,
      staleMonths: STALE_MONTHS.includes(f.staleMonths) ? f.staleMonths : null
    },
    sort: {
      key: SORT_KEYS.includes(s.key) ? s.key : DEFAULT_SORT.key,
      dir: s.dir === "desc" ? "desc" : s.dir === "asc" ? "asc" : DEFAULT_SORT.dir
    }
  };
}
function pruneFilters(f, folders, tags) {
  let out = f;
  if (folders && f.folder && f.folder !== "none" && !folders.some((x) => x.id === f.folder)) out = { ...out, folder: null };
  if (tags && f.tag && !tags.some((x) => x.id === f.tag)) out = { ...out, tag: null };
  return out;
}
function rangeIds(order, a, b) {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0) return j >= 0 ? [b] : [];
  const [lo, hi] = i <= j ? [i, j] : [j, i];
  return order.slice(lo, hi + 1);
}

// desktop-src/pages/manage/Picker.tsx
import { jsx as jsx47, jsxs as jsxs40 } from "react/jsx-runtime";
function Picker({
  label,
  options,
  mode = "single",
  value,
  values,
  onPick,
  onCommit,
  onCreate,
  createLabel,
  onClose,
  searchable,
  align = "start",
  footer
}) {
  const t = useT("manage");
  const base = useId7();
  const rootRef = useRef33(null);
  const inputRef = useRef33(null);
  const listRef = useRef33(null);
  const [query, setQuery] = useState35("");
  const [marked, setMarked] = useState35(() => [...values ?? []]);
  const [active, setActive] = useState35(0);
  const [flip, setFlip] = useState35(false);
  const showSearch = searchable ?? (options.length > 6 || !!onCreate);
  const shown = useMemo8(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    if (!words.length) return options;
    return options.filter((o) => {
      const hay = normalize(o.label);
      return words.every((w) => hay.includes(w));
    });
  }, [options, query]);
  const text = query.trim();
  const canCreate = !!onCreate && !!text && !options.some((o) => normalize(o.label) === normalize(text));
  useEffect34(() => setActive(0), [query]);
  useEffect34(() => {
    ;
    (inputRef.current ?? listRef.current)?.focus();
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  useLayoutEffect8(() => {
    const el = rootRef.current;
    if (!el || typeof window === "undefined") return;
    const r = el.getBoundingClientRect();
    if (r.height && r.bottom > window.innerHeight - 8 && r.top - r.height > 48) setFlip(true);
  }, []);
  useEffect34(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  const toggle = (v) => setMarked((m) => m.includes(v) ? m.filter((x) => x !== v) : [...m, v]);
  const choose = (o) => {
    if (mode === "multi") {
      toggle(o.value);
      return;
    }
    onPick?.(o.value);
    onClose();
  };
  const create = () => {
    if (!canCreate) return;
    onCreate?.(text, mode === "multi" ? marked : void 0);
    onClose();
  };
  const commit = () => {
    onCommit?.(marked);
    onClose();
  };
  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(0, shown.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = shown[active];
      if (mode === "multi") {
        if (text && hit) {
          toggle(hit.value);
          setQuery("");
        } else if (canCreate) create();
        else commit();
      } else if (hit) choose(hit);
      else create();
    }
  };
  const isMarked = (o) => mode === "multi" ? marked.includes(o.value) : (value ?? "") === o.value;
  return /* @__PURE__ */ jsxs40(
    "div",
    {
      ref: rootRef,
      className: cx("mpicker"),
      "data-part": "manage-picker",
      "data-align": align,
      "data-flip": flip ? "true" : void 0,
      onKeyDown,
      onClick: (e) => e.stopPropagation(),
      onDoubleClick: (e) => e.stopPropagation(),
      onDragStart: (e) => {
        e.preventDefault();
        e.stopPropagation();
      },
      children: [
        showSearch ? /* @__PURE__ */ jsx47(
          "input",
          {
            ref: inputRef,
            type: "text",
            className: cx("mpicker-input t-body"),
            "data-part": "picker-input",
            value: query,
            placeholder: t("picker.filter"),
            "aria-label": label,
            "aria-controls": `${base}-list`,
            "aria-activedescendant": shown[active] ? `${base}-${active}` : void 0,
            onChange: (e) => setQuery(e.target.value)
          }
        ) : null,
        /* @__PURE__ */ jsxs40(
          "div",
          {
            ref: listRef,
            id: `${base}-list`,
            role: "listbox",
            "aria-label": label,
            "aria-multiselectable": mode === "multi" ? true : void 0,
            tabIndex: showSearch ? -1 : 0,
            className: cx("mpicker-list"),
            "aria-activedescendant": !showSearch && shown[active] ? `${base}-${active}` : void 0,
            children: [
              shown.map((o, i) => /* @__PURE__ */ jsxs40(
                "div",
                {
                  id: `${base}-${i}`,
                  role: "option",
                  "data-value": o.value,
                  "aria-selected": isMarked(o),
                  "data-active": i === active ? "true" : void 0,
                  className: cx("mpicker-option t-body"),
                  style: o.level && o.level > 1 ? { [cssVar("level")]: o.level } : void 0,
                  onMouseEnter: () => setActive(i),
                  onClick: () => choose(o),
                  children: [
                    /* @__PURE__ */ jsx47("span", { className: cx("mpicker-check"), "aria-hidden": "true", children: isMarked(o) ? /* @__PURE__ */ jsx47(Codicon35, { name: "check", size: 13 }) : null }),
                    o.icon ? /* @__PURE__ */ jsx47(Codicon35, { name: o.icon, size: 13, className: cx("mpicker-icon") }) : null,
                    /* @__PURE__ */ jsx47("span", { className: cx("mpicker-label truncate"), children: o.label }),
                    o.hint ? /* @__PURE__ */ jsx47("span", { className: cx("mpicker-hint t-label"), children: o.hint }) : null
                  ]
                },
                o.value || "∅"
              )),
              !shown.length && !canCreate ? /* @__PURE__ */ jsx47("div", { className: cx("mpicker-empty t-label"), children: t("picker.empty") }) : null
            ]
          }
        ),
        canCreate ? /* @__PURE__ */ jsxs40("button", { type: "button", className: cx("bare mpicker-create t-body"), "data-part": "picker-create", onClick: create, children: [
          /* @__PURE__ */ jsx47(Codicon35, { name: "add", size: 13 }),
          /* @__PURE__ */ jsx47("span", { className: cx("truncate"), children: createLabel ? createLabel(text) : text })
        ] }) : null,
        mode === "multi" ? /* @__PURE__ */ jsx47("div", { className: cx("mpicker-foot"), children: /* @__PURE__ */ jsx47(Button31, { variant: "outline", size: "xs", "data-part": "picker-apply", onClick: commit, children: t("picker.apply") }) }) : null,
        footer
      ]
    }
  );
}

// desktop-src/pages/manage/Batch.tsx
import { jsx as jsx48, jsxs as jsxs41 } from "react/jsx-runtime";
function BatchBar(p) {
  const t = useT("manage");
  const [open, setOpen] = useState36(null);
  const toggle = (which) => setOpen((o) => o === which ? null : which);
  const menu = (which, icon, picker) => /* @__PURE__ */ jsxs41("span", { className: cx("manchor"), children: [
    /* @__PURE__ */ jsxs41(Button32, { variant: "ghost", size: "xs", "data-action": which, "aria-haspopup": "listbox", "aria-expanded": open === which, onClick: () => toggle(which), children: [
      /* @__PURE__ */ jsx48(Codicon36, { name: icon, size: 13 }),
      /* @__PURE__ */ jsx48("span", { children: t(`batch.${which}`) })
    ] }),
    open === which ? picker : null
  ] });
  const simple = (op, icon) => /* @__PURE__ */ jsxs41(Button32, { variant: "ghost", size: "xs", "data-action": op, onClick: () => p.onOp(op), children: [
    /* @__PURE__ */ jsx48(Codicon36, { name: icon, size: 13 }),
    /* @__PURE__ */ jsx48("span", { children: t(`batch.${op}`) })
  ] });
  const close = () => setOpen(null);
  return /* @__PURE__ */ jsxs41("div", { className: cx("mbatch"), "data-part": "manage-batch", role: "toolbar", "aria-label": t("batch.label"), children: [
    /* @__PURE__ */ jsx48("span", { className: cx("mbatch-count t-label"), "aria-live": "polite", children: p.plural("batch.selected", p.count) }),
    p.hidden ? /* @__PURE__ */ jsx48("span", { className: cx("mbatch-hidden t-label"), children: p.plural("batch.hidden", p.hidden) }) : null,
    /* @__PURE__ */ jsx48("span", { className: cx("mbatch-sep"), "aria-hidden": "true" }),
    /* @__PURE__ */ jsxs41("span", { className: cx("mbatch-actions"), children: [
      menu(
        "move",
        "folder",
        /* @__PURE__ */ jsx48(
          Picker,
          {
            label: t("picker.move"),
            options: p.folderOptions,
            searchable: true,
            onPick: (v) => p.onMove(v || null),
            onCreate: p.onCreateFolder,
            createLabel: (name) => t("picker.create_folder", { name }),
            onClose: close
          }
        )
      ),
      menu(
        "tag",
        "tag",
        /* @__PURE__ */ jsx48(
          Picker,
          {
            label: t("picker.tag"),
            options: p.tagOptions,
            searchable: true,
            onPick: p.onTag,
            onCreate: p.onCreateTag,
            createLabel: (name) => t("picker.create_tag", { name }),
            onClose: close
          }
        )
      ),
      p.untagOptions.length ? menu("untag", "close", /* @__PURE__ */ jsx48(Picker, { label: t("picker.untag"), options: p.untagOptions, onPick: p.onUntag, onClose: close })) : null,
      simple("favorite", "star-full"),
      simple("unfavorite", "star-empty"),
      simple("mute", "bell-slash"),
      simple("unmute", "bell"),
      /* @__PURE__ */ jsxs41(Button32, { variant: "ghost", size: "xs", "data-action": "read", onClick: p.onRead, children: [
        /* @__PURE__ */ jsx48(Codicon36, { name: "check-all", size: 13 }),
        /* @__PURE__ */ jsx48("span", { children: t("batch.read") })
      ] }),
      /* @__PURE__ */ jsxs41(Button32, { variant: "ghost", size: "xs", "data-action": "organize", onClick: p.onOrganize, children: [
        /* @__PURE__ */ jsx48(Codicon36, { name: "sparkle", size: 13 }),
        /* @__PURE__ */ jsx48("span", { children: t("batch.organize") })
      ] })
    ] }),
    /* @__PURE__ */ jsx48("span", { className: cx("mbatch-end"), children: /* @__PURE__ */ jsx48(Button32, { variant: "ghost", size: "xs", "data-action": "clear", "aria-label": t("batch.clear"), title: t("batch.clear"), onClick: p.onClear, children: /* @__PURE__ */ jsx48(Codicon36, { name: "close", size: 13 }) }) })
  ] });
}

// desktop-src/pages/manage/actions.ts
import { host as host22 } from "@hermes/plugin-sdk";
import { useCallback as useCallback19, useRef as useRef34, useState as useState37 } from "react";
var UNDO_MS4 = 7e3;
var READ_CONCURRENCY = 4;
var REFRESH = ["GET /channels", "GET /state", "GET /status"];
function patchFor(op, c, value) {
  switch (op) {
    case "move":
      return { folder_id: value ?? null };
    case "favorite":
    case "unfavorite":
      return { favorite: op === "favorite" };
    case "mute":
    case "unmute":
      return { muted: op === "mute" };
    case "tag":
      return value && !c.tag_ids.includes(value) ? { tag_ids: [...c.tag_ids, value] } : {};
    case "untag":
      return { tag_ids: c.tag_ids.filter((x) => x !== value) };
    case "follow":
      return { relation: "followed" };
    case "ignore":
      return { relation: "ignored" };
  }
}
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { ok: true, value: await fn(items[i]) };
      } catch (error) {
        out[i] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}
function useManageActions(deps) {
  const depsRef = useRef34(deps);
  depsRef.current = deps;
  const [overlay, setOverlay] = useState37({});
  const [errors, setErrors] = useState37({});
  const seq2 = useRef34(0);
  const push = (patches) => {
    const token = ++seq2.current;
    setOverlay((o) => {
      const next = { ...o };
      for (const [id, patch3] of Object.entries(patches)) next[id] = { patch: { ...o[id]?.patch, ...patch3 }, token };
      return next;
    });
    return token;
  };
  const drop = (ids, token) => setOverlay((o) => {
    let changed = false;
    const next = { ...o };
    for (const id of ids)
      if (next[id] && next[id].token === token) {
        delete next[id];
        changed = true;
      }
    return changed ? next : o;
  });
  const setError = (id, message) => setErrors((e) => {
    if (message === null && !(id in e)) return e;
    const next = { ...e };
    if (message === null) delete next[id];
    else next[id] = message;
    return next;
  });
  const view = useCallback19(
    (row) => {
      const l = overlay[row.channel.id];
      return l ? { ...row, channel: { ...row.channel, ...l.patch } } : row;
    },
    [overlay]
  );
  const fail = (key, error) => {
    const { t, tc: tc2 } = depsRef.current;
    host22.notify({ kind: "error", message: t(key, { error: errorText(tc2, toApiError(error)) }) });
  };
  const refresh2 = () => invalidateRest(...REFRESH);
  const undoChanges = useCallback19(async (ids) => {
    const { t } = depsRef.current;
    try {
      for (const id of ids) await restCall("POST /changes/{id}/undo", { path: { id } });
      await refresh2();
      host22.notify({ kind: "info", message: t("toast.undone") });
    } catch (error) {
      await refresh2();
      fail("toast.undo_failed", error);
    }
  }, []);
  const batchMessage = (op, ids, value, labels) => {
    const { plural: plural5, current: current2, folderName, tagName } = depsRef.current;
    const name = ids.length === 1 ? current2(ids[0])?.channel.title ?? "" : "";
    switch (op) {
      case "move":
        return value ? plural5("toast.move", ids.length, { name, folder: labels.folder ?? folderName(value) }) : plural5("toast.move_none", ids.length, { name });
      case "tag":
      case "untag":
        return plural5(`toast.${op}`, ids.length, { name, tag: labels.tag ?? (value ? tagName(value) : "") });
      default:
        return plural5(`toast.${op}`, ids.length, { name });
    }
  };
  const batch = useCallback19(async (op, ids, value, labels = {}) => {
    if (!ids.length) return;
    const { t, current: current2 } = depsRef.current;
    const patches = {};
    for (const id of ids) {
      const row = current2(id);
      if (row) patches[id] = patchFor(op, row.channel, value);
    }
    const token = push(patches);
    const withValue = op === "move" || op === "tag" || op === "untag";
    try {
      const out = await restCall("POST /channels/batch", {
        body: { op, channel_ids: [...ids], ...withValue ? { value: value ?? null } : {} }
      });
      const changeId = out.batch?.change_id ?? null;
      if (!out.batch || !out.batch.changed.length || changeId === null) {
        host22.notify({ kind: "info", message: t("toast.nothing") });
      } else {
        host22.notify({
          kind: "success",
          message: batchMessage(op, ids, value, labels),
          durationMs: UNDO_MS4,
          action: { label: t("toast.undo"), onClick: () => void undoChanges([changeId]) }
        });
      }
      for (const id of ids) setError(id, null);
      await refresh2();
      drop(ids, token);
    } catch (error) {
      drop(ids, token);
      fail("toast.failed", error);
    }
  }, []);
  const patch2 = useCallback19(async (id, body, inverse, message) => {
    const { t, tc: tc2 } = depsRef.current;
    const token = push({ [id]: body });
    setError(id, null);
    try {
      await restCall("PATCH /channels/{id}", { path: { id }, body });
      if (message)
        host22.notify({
          kind: "success",
          message,
          durationMs: UNDO_MS4,
          action: {
            label: t("toast.undo"),
            onClick: () => {
              const back = push({ [id]: inverse });
              restCall("PATCH /channels/{id}", { path: { id }, body: inverse }).then(
                async () => {
                  await refresh2();
                  drop([id], back);
                },
                (error) => {
                  drop([id], back);
                  fail("toast.undo_failed", error);
                }
              );
            }
          }
        });
      await refresh2();
      drop([id], token);
    } catch (error) {
      drop([id], token);
      setError(id, t("row_error", { error: errorText(tc2, toApiError(error)) }));
    }
  }, []);
  const markRead = useCallback19(async (ids) => {
    if (!ids.length) return;
    const { t, tc: tc2, plural: plural5, current: current2 } = depsRef.current;
    const results = await pool(
      ids,
      READ_CONCURRENCY,
      (id) => restCall("POST /read", { query: { change_ids: true }, body: { kind: "channel", id } })
    );
    const changeIds = [];
    let channels = 0;
    let failed = 0;
    let firstError = null;
    for (const r of results) {
      if (!r.ok) {
        failed++;
        firstError ??= r.error;
        continue;
      }
      if (r.value.changed > 0) channels++;
      changeIds.push(...r.value.change_ids ?? []);
    }
    void invalidateRest("GET /status", "GET /state", "GET /feed");
    if (failed) {
      host22.notify({ kind: "error", message: t("toast.read_partial", { count: failed, error: errorText(tc2, toApiError(firstError)) }) });
    }
    if (!channels) {
      if (!failed) host22.notify({ kind: "info", message: t("toast.read_nothing") });
      return;
    }
    const name = ids.length === 1 ? current2(ids[0])?.channel.title ?? "" : "";
    host22.notify({
      kind: "success",
      message: plural5("toast.read", channels, { name }),
      durationMs: UNDO_MS4,
      ...changeIds.length ? { action: { label: t("toast.undo"), onClick: () => void undoChanges(changeIds) } } : {}
    });
  }, []);
  const createFolder = useCallback19(async (name, notify = false) => {
    const { t } = depsRef.current;
    try {
      const folder = await restCall("POST /folders", { body: { name } });
      await invalidateRest("GET /folders");
      if (notify) host22.notify({ kind: "success", message: t("toast.folder_created", { name: folder.name }) });
      return folder;
    } catch (error) {
      fail("toast.failed", error);
      return null;
    }
  }, []);
  const renameFolder = useCallback19(async (id, name) => {
    const { t } = depsRef.current;
    try {
      const folder = await restCall("PATCH /folders/{id}", { path: { id }, body: { name } });
      await invalidateRest("GET /folders");
      host22.notify({ kind: "success", message: t("toast.folder_renamed", { name: folder.name }) });
    } catch (error) {
      fail("toast.failed", error);
    }
  }, []);
  const createTag = useCallback19(async (name) => {
    try {
      const tag = await restCall("POST /tags", { body: { name } });
      await invalidateRest("GET /tags");
      return tag;
    } catch (error) {
      fail("toast.failed", error);
      return null;
    }
  }, []);
  return { view, errors, batch, patch: patch2, markRead, createFolder, renameFolder, createTag, clearError: (id) => setError(id, null) };
}

// desktop-src/pages/manage/Rail.tsx
import { Codicon as Codicon37 } from "@hermes/plugin-sdk";
import { useRef as useRef35, useState as useState38 } from "react";
import { Fragment as Fragment23, jsx as jsx49, jsxs as jsxs42 } from "react/jsx-runtime";
function Rail({ tree, counts, current: current2, onSelect, onDropTo, onCreate, onRename }) {
  const t = useT("manage");
  const fmt = useFormatCount();
  const [over, setOver] = useState38(null);
  const [renaming, setRenaming] = useState38(null);
  const [creating, setCreating] = useState38(false);
  const dropProps = (key, target) => ({
    onDragOver: (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      if (over !== key) setOver(key);
    },
    onDragLeave: () => setOver((o) => o === key ? null : o),
    onDrop: (e) => {
      e.preventDefault();
      setOver(null);
      if (e.dataTransfer) onDropTo(target, e.dataTransfer);
    }
  });
  const item = (key, label, opts) => {
    const filterValue = key === "all" ? null : key;
    const isCurrent = current2 === filterValue;
    const style = opts.level && opts.level > 1 ? { [cssVar("level")]: opts.level } : void 0;
    const count2 = counts.get(key) ?? 0;
    return /* @__PURE__ */ jsx49(
      "div",
      {
        className: cx("mrail-item t-body"),
        "data-part": "rail-item",
        "data-folder": key,
        "aria-current": isCurrent ? "true" : void 0,
        "data-drop": over === key ? "true" : void 0,
        title: over === key ? t("rail.drop") : void 0,
        style,
        ...opts.droppable ? dropProps(key, key === "none" ? null : key) : {},
        children: opts.folder && renaming === opts.folder.id ? /* @__PURE__ */ jsx49(
          NameInput,
          {
            initial: opts.folder.name,
            placeholder: t("rail.placeholder"),
            onDone: (name) => {
              setRenaming(null);
              if (name && name !== opts.folder?.name) onRename(opts.folder.id, name);
            }
          }
        ) : /* @__PURE__ */ jsxs42(Fragment23, { children: [
          /* @__PURE__ */ jsxs42("button", { type: "button", className: cx("bare mrail-select"), "data-part": "rail-select", "aria-pressed": isCurrent, onClick: () => onSelect(isCurrent && key !== "all" ? null : filterValue), children: [
            /* @__PURE__ */ jsx49(Codicon37, { name: opts.icon, size: 14, className: cx("mrail-icon") }),
            /* @__PURE__ */ jsx49("span", { className: cx("truncate"), children: label })
          ] }),
          opts.folder ? /* @__PURE__ */ jsx49(
            "button",
            {
              type: "button",
              className: cx("bare mrail-rename"),
              "data-part": "rail-rename",
              "aria-label": t("rail.rename", { name: label }),
              title: t("rail.rename", { name: label }),
              onClick: () => setRenaming(opts.folder.id),
              children: /* @__PURE__ */ jsx49(Codicon37, { name: "edit", size: 12 })
            }
          ) : null,
          /* @__PURE__ */ jsx49("span", { className: cx("mrail-count t-label"), "data-part": "rail-count", children: fmt(count2) })
        ] })
      },
      key
    );
  };
  return /* @__PURE__ */ jsxs42("nav", { className: cx("mrail"), "data-part": "manage-rail", "aria-label": t("rail.label"), children: [
    /* @__PURE__ */ jsx49("span", { className: cx("mrail-head t-label"), "aria-hidden": "true", children: t("rail.label") }),
    item("all", t("rail.all"), { icon: "list-flat", droppable: false }),
    tree.map(({ folder, level }) => item(folder.id, folder.name, { icon: "folder", level, folder, droppable: true })),
    item("none", t("rail.none"), { icon: "circle-slash", droppable: true }),
    /* @__PURE__ */ jsx49("span", { className: cx("mrail-sep"), "aria-hidden": "true" }),
    creating ? /* @__PURE__ */ jsx49("div", { className: cx("mrail-item"), children: /* @__PURE__ */ jsx49(
      NameInput,
      {
        initial: "",
        placeholder: t("rail.placeholder"),
        onDone: (name) => {
          setCreating(false);
          if (name) onCreate(name);
        }
      }
    ) }) : /* @__PURE__ */ jsxs42("button", { type: "button", className: cx("bare mrail-new t-body"), "data-part": "rail-new", onClick: () => setCreating(true), children: [
      /* @__PURE__ */ jsx49(Codicon37, { name: "add", size: 14 }),
      /* @__PURE__ */ jsx49("span", { children: t("rail.new") })
    ] })
  ] });
}
function NameInput({ initial, placeholder, onDone }) {
  const [value, setValue] = useState38(initial);
  const done = useRef35(false);
  const finish = (name) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      finish(value.trim() || null);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(null);
    }
  };
  return /* @__PURE__ */ jsx49(
    "input",
    {
      autoFocus: true,
      type: "text",
      className: cx("mrail-input t-body"),
      "data-part": "rail-input",
      value,
      placeholder,
      "aria-label": placeholder,
      onChange: (e) => setValue(e.target.value),
      onKeyDown,
      onBlur: () => finish(value.trim() || null)
    }
  );
}

// desktop-src/pages/manage/style.ts
import { useLayoutEffect as useLayoutEffect9 } from "react";
var MANAGE_STYLE_ATTR = `data-${CLASS_PREFIX}manage`;
var MANAGE_CSS = `
/* ------------------------------------------------ bar (filters + batch) */

.PFX_mtoolbar {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s2);
  padding-bottom: var(--PFX_s2);
}

.PFX_manchor {
  position: relative;
  display: inline-flex;
}

.PFX_mfilter {
  gap: 4px;
  cursor: pointer;
}

.PFX_mfilter[data-active='true'] {
  font-weight: 600;
}

.PFX_mfilter-caret {
  color: var(--PFX_fg3);
}

.PFX_mchip {
  gap: 4px;
  border-color: var(--ui-stroke-secondary);
  background: var(--ui-bg-quaternary);
  color: var(--ui-text-primary);
}

.PFX_mcount {
  margin-left: auto;
  color: var(--PFX_fg3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.PFX_mbatch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--PFX_s1) var(--PFX_s2);
  min-height: 36px;
  padding: 2px var(--PFX_s2);
  border: 1px solid var(--ui-stroke-tertiary);
  border-radius: var(--PFX_r-control);
  background: var(--ui-bg-quinary);
}

.PFX_mbatch-count {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.PFX_mbatch-hidden {
  color: var(--PFX_fg3);
  white-space: nowrap;
}

.PFX_mbatch-actions {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
}

.PFX_mbatch-sep {
  width: 1px;
  height: 16px;
  margin: 0 var(--PFX_s1);
  background: var(--ui-stroke-tertiary);
}

.PFX_mbatch-end {
  margin-left: auto;
}

/* ------------------------------------------------ layout: folders on the left + table */

.PFX_mlayout {
  display: flex;
  align-items: flex-start;
  gap: var(--PFX_s4);
  min-width: 0;
  container-type: inline-size;
  container-name: PFX_mlayout;
}

.PFX_mmain {
  flex: 1 1 auto;
  min-width: 0;
}

.PFX_mrail {
  position: sticky;
  top: 0;
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 1px;
  width: 208px;
  max-height: calc(100vh - 160px);
  overflow-y: auto;
  padding-top: 2px;
}

.PFX_mrail-head {
  padding: 0 var(--PFX_s2) var(--PFX_s1);
  color: var(--PFX_fg3);
  letter-spacing: 0.04em;
}

.PFX_mrail-item {
  --PFX_level: 1;
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 var(--PFX_s2) 0 calc(var(--PFX_s2) + (var(--PFX_level) - 1) * 14px);
  border-radius: var(--PFX_r-control);
  color: var(--ui-text-secondary);
  transition: background-color var(--PFX_dur) var(--PFX_ease);
}

.PFX_mrail-item:hover {
  background: var(--ui-row-hover-background);
}

.PFX_mrail-item[aria-current='true'] {
  background: var(--ui-row-active-background);
  color: var(--ui-text-primary);
}

.PFX_mrail-item[data-drop='true'] {
  background: var(--ui-bg-quaternary);
  box-shadow: inset 0 0 0 1px var(--ui-text-quaternary);
}

.PFX_mrail-select {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 100%;
  text-align: left;
  cursor: pointer;
}

.PFX_mrail-icon {
  flex: none;
  color: var(--PFX_fg3);
}

.PFX_mrail-count {
  flex: none;
  color: var(--PFX_fg3);
  font-variant-numeric: tabular-nums;
}

.PFX_mrail-rename {
  display: none;
  flex: none;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: var(--PFX_fg3);
}

.PFX_mrail-item:hover .PFX_mrail-rename,
.PFX_mrail-item:focus-within .PFX_mrail-rename {
  display: inline-grid;
}

.PFX_mrail-rename:hover {
  background: var(--ui-control-hover-background);
  color: var(--ui-text-primary);
}

.PFX_mrail-input,
.PFX_mpicker-input {
  width: 100%;
  min-width: 0;
  height: 26px;
  padding: 0 var(--PFX_s2);
  border: 1px solid var(--ui-stroke-secondary);
  border-radius: var(--PFX_r-control);
  background: var(--ui-bg-editor);
  color: var(--ui-text-primary);
  outline: none;
}

.PFX_mrail-input:focus-visible,
.PFX_mpicker-input:focus-visible {
  outline: 2px solid var(--PFX_ring);
  outline-offset: 0;
}

.PFX_mrail-new {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 var(--PFX_s2);
  border-radius: var(--PFX_r-control);
  color: var(--PFX_fg3);
  cursor: pointer;
}

.PFX_mrail-new:hover {
  background: var(--ui-row-hover-background);
  color: var(--ui-text-primary);
}

.PFX_mrail-sep {
  height: 1px;
  margin: var(--PFX_s1) var(--PFX_s2);
  background: var(--ui-stroke-quaternary);
}

/* ------------------------------------------------ table */

.PFX_mtable {
  position: relative;
  min-width: 0;
  outline: none;
  font-size: var(--PFX_fs-body);
  line-height: var(--PFX_lh-body);
}

.PFX_mtable:focus-visible .PFX_mrow[data-active='true'] {
  outline: 2px solid var(--PFX_ring);
  outline-offset: -2px;
}

.PFX_mhead,
.PFX_mrow {
  display: grid;
  grid-template-columns: var(--PFX_cols);
  align-items: center;
  column-gap: 12px;
  padding: 0 var(--PFX_s2);
}

.PFX_mhead {
  position: sticky;
  top: 0;
  z-index: 3;
  height: 32px;
  border-bottom: 1px solid var(--ui-stroke-tertiary);
  background: var(--ui-bg-editor);
  color: var(--PFX_fg3);
}

.PFX_mrow {
  position: relative;
  height: 38px;
  border-bottom: 1px solid var(--ui-stroke-quaternary);
  color: var(--ui-text-primary);
  transition: background-color var(--PFX_dur) var(--PFX_ease);
}

.PFX_mrow:hover {
  background: var(--ui-row-hover-background);
}

.PFX_mrow[aria-selected='true'] {
  background: var(--ui-row-active-background);
}

.PFX_mrow[data-editing='true'] {
  z-index: 4;
}

.PFX_mcell {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 100%;
}

.PFX_mcell[data-num='true'] {
  justify-content: flex-end;
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.PFX_mcell[data-col='relation'] {
  color: var(--ui-text-secondary);
  white-space: nowrap;
}

.PFX_mcell[data-col='select'] {
  justify-content: center;
  cursor: pointer;
}

.PFX_mhead-cell {
  font-size: var(--PFX_fs-label);
  line-height: var(--PFX_lh-label);
  font-weight: 500;
  letter-spacing: 0.04em;
}

.PFX_msort {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
  height: 24px;
  padding: 0 4px;
  margin: 0 -4px;
  border-radius: 4px;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  white-space: nowrap;
  cursor: pointer;
}

.PFX_msort:hover {
  background: var(--ui-control-hover-background);
  color: var(--ui-text-primary);
}

.PFX_mhead-cell[aria-sort='ascending'] .PFX_msort,
.PFX_mhead-cell[aria-sort='descending'] .PFX_msort {
  color: var(--ui-text-primary);
}

.PFX_msort-icon {
  flex: none;
  opacity: 0;
}

.PFX_mhead-cell[aria-sort='ascending'] .PFX_msort-icon,
.PFX_mhead-cell[aria-sort='descending'] .PFX_msort-icon {
  opacity: 1;
}

.PFX_mname-text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}

.PFX_mname-line {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.PFX_mname-title {
  min-width: 0;
  font-weight: 550;
}

.PFX_mname-sub {
  color: var(--PFX_fg3);
}

.PFX_mfav {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  color: var(--ui-text-quaternary);
  opacity: 0;
  cursor: pointer;
  transition: opacity var(--PFX_dur) var(--PFX_ease);
}

.PFX_mrow:hover .PFX_mfav,
.PFX_mrow[data-active='true'] .PFX_mfav,
.PFX_mfav:focus-visible,
.PFX_mfav[aria-pressed='true'] {
  opacity: 1;
}

.PFX_mfav[aria-pressed='true'] {
  color: var(--ui-text-primary);
}

.PFX_mfav:hover {
  background: var(--ui-control-hover-background);
  color: var(--ui-text-secondary);
}

.PFX_mmuted {
  flex: none;
  color: var(--PFX_fg3);
}

.PFX_mrow-error {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  color: var(--ui-text-primary);
}

.PFX_mrow-error-icon {
  flex: none;
  color: var(--ui-text-secondary);
}

.PFX_medit {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
  height: 26px;
  padding: 0 4px;
  margin: 0 -4px;
  overflow: hidden;
  border-radius: var(--PFX_r-control);
  cursor: pointer;
}

.PFX_medit:hover,
.PFX_medit[aria-expanded='true'] {
  background: var(--ui-control-hover-background);
}

.PFX_medit .PFX_chip {
  flex: 0 1 auto;
  min-width: 0;
}

.PFX_mplaceholder {
  color: var(--PFX_fg3);
  white-space: nowrap;
}

/* "Add tags" only shows on row hover/focus (otherwise nothing to read: it takes no space and counts for nothing) */
.PFX_mplaceholder[data-hover='true'] {
  display: none;
}

.PFX_mrow:hover .PFX_mplaceholder[data-hover='true'],
.PFX_mrow[data-active='true'] .PFX_mplaceholder[data-hover='true'],
.PFX_medit:focus-visible .PFX_mplaceholder[data-hover='true'] {
  display: inline;
}

.PFX_mmore {
  flex: none;
  color: var(--PFX_fg3);
  font-variant-numeric: tabular-nums;
}

.PFX_mnone {
  color: var(--ui-text-quaternary);
}

.PFX_mrow[data-skeleton] {
  pointer-events: none;
}

.PFX_mrow[data-skeleton] .PFX_mcell {
  overflow: hidden;
}

.PFX_mrow[data-skeleton] .PFX_avatar {
  width: 24px;
  height: 24px;
}

/* ------------------------------------------------ in-place picker */

.PFX_mpicker {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: max-content;
  min-width: 220px;
  max-width: 300px;
  padding: 6px;
  border: 1px solid var(--ui-stroke-secondary);
  border-radius: var(--PFX_r-card);
  background: var(--ui-bg-elevated, var(--ui-bg-editor));
  color: var(--ui-text-primary);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--ui-base) 14%, transparent);
  cursor: default;
  font-weight: 400;
  letter-spacing: normal;
  text-align: left;
  white-space: normal;
}

.PFX_mpicker[data-align='end'] {
  right: 0;
  left: auto;
}

.PFX_mpicker[data-flip='true'] {
  top: auto;
  bottom: calc(100% + 4px);
}

.PFX_mpicker-list {
  display: flex;
  flex-direction: column;
  max-height: 248px;
  overflow-y: auto;
  overscroll-behavior: contain;
  outline: none;
}

.PFX_mpicker-option {
  --PFX_level: 1;
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 var(--PFX_s2) 0 calc(4px + (var(--PFX_level) - 1) * 14px);
  border-radius: 5px;
  color: var(--ui-text-secondary);
  cursor: pointer;
}

.PFX_mpicker-option[data-active='true'] {
  background: var(--ui-row-hover-background);
  color: var(--ui-text-primary);
}

.PFX_mpicker-option[aria-selected='true'] {
  color: var(--ui-text-primary);
}

.PFX_mpicker-check {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 14px;
}

.PFX_mpicker-icon {
  flex: none;
  color: var(--PFX_fg3);
}

.PFX_mpicker-label {
  flex: 1 1 auto;
}

.PFX_mpicker-hint {
  flex: none;
  color: var(--PFX_fg3);
  font-variant-numeric: tabular-nums;
}

.PFX_mpicker-empty {
  padding: 6px var(--PFX_s2);
  color: var(--PFX_fg3);
}

.PFX_mpicker-create {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 var(--PFX_s2);
  border-top: 1px solid var(--ui-stroke-quaternary);
  color: var(--ui-text-primary);
  cursor: pointer;
}

.PFX_mpicker-create:hover {
  background: var(--ui-row-hover-background);
}

.PFX_mpicker-foot {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
  border-top: 1px solid var(--ui-stroke-quaternary);
}

/* ------------------------------------------------ narrow: the folder list leaves (the picker enters the bar) */

@container PFX_mlayout (max-width: 560px) {
  .PFX_mhead,
  .PFX_mrow {
    column-gap: 8px;
    padding: 0 4px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .PFX_mrow,
  .PFX_mrail-item,
  .PFX_mfav {
    transition: none;
  }
}
`;
var users2 = 0;
var mounted2 = null;
function useManageStyles() {
  useLayoutEffect9(() => {
    if (typeof document === "undefined" || !document.head) return;
    users2++;
    if (!mounted2 || !mounted2.isConnected) {
      mounted2 = document.head.querySelector(`style[${MANAGE_STYLE_ATTR}]`);
      if (!mounted2) {
        mounted2 = document.createElement("style");
        mounted2.setAttribute(MANAGE_STYLE_ATTR, "");
        document.head.appendChild(mounted2);
      }
      mounted2.textContent = resolveCss(MANAGE_CSS);
    }
    return () => {
      users2 = Math.max(0, users2 - 1);
      if (!users2 && mounted2) {
        mounted2.remove();
        mounted2 = null;
      }
    };
  }, []);
}

// desktop-src/pages/manage/Table.tsx
import { Checkbox as Checkbox6, Codicon as Codicon38 } from "@hermes/plugin-sdk";
import {
  memo,
  useCallback as useCallback20,
  useEffect as useEffect35,
  useId as useId8,
  useLayoutEffect as useLayoutEffect10,
  useMemo as useMemo9,
  useRef as useRef36,
  useState as useState39
} from "react";
import { Fragment as Fragment24, jsx as jsx50, jsxs as jsxs43 } from "react/jsx-runtime";
var SORTABLE = /* @__PURE__ */ new Set(["name", "folder", "tags", "last", "rhythm", "shorts", "watched", "relation"]);
var OVERSCAN = 8;
var VIRTUAL_MIN = 200;
var HEAD_H = 32;
function scrollerOf(el) {
  if (typeof document === "undefined") return null;
  for (let n = el?.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll" || oy === "overlay") && n.clientHeight > 0 && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return null;
}
function windowHeight() {
  return typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 760;
}
function measure(body) {
  if (!body) return { scrollTop: 0, viewport: windowHeight(), bodyTop: 0 };
  const scroller = scrollerOf(body);
  const rect = body.getBoundingClientRect();
  if (scroller) {
    return { scrollTop: scroller.scrollTop, viewport: scroller.clientHeight, bodyTop: rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop };
  }
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  return { scrollTop: y, viewport: windowHeight(), bodyTop: rect.top + y };
}
var raf = typeof requestAnimationFrame === "function" ? (fn) => void requestAnimationFrame(fn) : (fn) => void setTimeout(fn, 16);
function useNumberFormats(locale) {
  return useMemo9(() => {
    const fmt = (opts) => {
      try {
        return new Intl.NumberFormat(locale, opts);
      } catch {
        return new Intl.NumberFormat("en", opts);
      }
    };
    return { one: fmt({ maximumFractionDigits: 1 }), zero: fmt({ maximumFractionDigits: 0 }), pct: fmt({ style: "percent", maximumFractionDigits: 0 }) };
  }, [locale]);
}
function ManageTable(props) {
  const t = useT("manage");
  const locale = useLocale();
  const { rows, columns, sort, onSort, selected, editing } = props;
  const base = useId8().replace(/:/g, "");
  const gridRef = useRef36(null);
  const bodyRef = useRef36(null);
  const [box, setBox] = useState39(() => ({ scrollTop: 0, viewport: 760, bodyTop: 0 }));
  const [active, setActive] = useState39(-1);
  const formats = useNumberFormats(locale);
  const propsRef = useRef36(props);
  propsRef.current = props;
  const update = useCallback20(() => {
    setBox((prev) => {
      const next = measure(bodyRef.current);
      return prev.scrollTop === next.scrollTop && prev.viewport === next.viewport && prev.bodyTop === next.bodyTop ? prev : next;
    });
  }, []);
  useLayoutEffect10(() => {
    let pending2 = false;
    const onScroll = () => {
      if (pending2) return;
      pending2 = true;
      raf(() => {
        pending2 = false;
        update();
      });
    };
    update();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    let ro = null;
    if (typeof ResizeObserver !== "undefined" && bodyRef.current) {
      ro = new ResizeObserver(onScroll);
      ro.observe(bodyRef.current);
    }
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      ro?.disconnect();
    };
  }, [update]);
  useLayoutEffect10(update, [rows.length, update]);
  useEffect35(() => {
    if (active >= rows.length) setActive(rows.length - 1);
  }, [rows.length, active]);
  const { start, end } = rows.length <= VIRTUAL_MIN ? { start: 0, end: rows.length } : windowRange({ ...box, total: rows.length, overscan: OVERSCAN });
  const rowId = (id) => `${base}-r-${id}`;
  const reveal = useCallback20((i) => {
    const body = bodyRef.current;
    if (!body) return;
    const scroller = scrollerOf(body);
    const m = measure(body);
    const top = m.bodyTop + i * ROW_H;
    let next = null;
    if (top - HEAD_H < m.scrollTop) next = Math.max(0, top - HEAD_H);
    else if (top + ROW_H > m.scrollTop + m.viewport) next = top + ROW_H - m.viewport;
    if (next === null) return;
    if (scroller) scroller.scrollTop = next;
    else window.scrollTo?.({ top: next });
    setBox(measure(body));
  }, []);
  const moveTo = (i, extend) => {
    if (!rows.length) return;
    const next = Math.max(0, Math.min(rows.length - 1, i));
    const from = rows[active]?.channel.id ?? rows[next].channel.id;
    setActive(next);
    reveal(next);
    if (extend) props.onExtend(from, rows[next].channel.id);
  };
  const onKeyDown = (e) => {
    if (e.target !== e.currentTarget) return;
    const mod = e.metaKey || e.ctrlKey;
    const cur = rows[active];
    if (e.key === "ArrowDown") moveTo(active < 0 ? 0 : active + 1, e.shiftKey);
    else if (e.key === "ArrowUp") moveTo(active < 0 ? 0 : active - 1, e.shiftKey);
    else if (e.key === "Home") moveTo(0, e.shiftKey);
    else if (e.key === "End") moveTo(rows.length - 1, e.shiftKey);
    else if (e.key === "PageDown") moveTo(active + 10, e.shiftKey);
    else if (e.key === "PageUp") moveTo(active - 10, e.shiftKey);
    else if (e.key === " " && cur) props.onToggle(cur.channel.id, e.shiftKey);
    else if ((e.key === "a" || e.key === "A") && mod) props.onSelectAll();
    else if (e.key === "Escape" && selected.size) props.onClearSelection();
    else if (e.key === "Enter" && cur && !mod) props.onEdit({ id: cur.channel.id, field: "folder" });
    else if ((e.key === "f" || e.key === "F") && cur && !mod && !e.altKey) props.onFavorite(cur);
    else return;
    e.preventDefault();
  };
  const onRowClick = useCallback20((e, index, id) => {
    if (e.target.closest('button, input, a, [role="option"], [data-part="manage-picker"]')) return;
    setActive(index);
    gridRef.current?.focus({ preventScroll: true });
    if (e.shiftKey) propsRef.current.onToggle(id, true);
    else if (e.metaKey || e.ctrlKey) propsRef.current.onToggle(id, false);
  }, []);
  const onSelectCell = useCallback20((e, index, id) => {
    e.stopPropagation();
    setActive(index);
    propsRef.current.onToggle(id, e.shiftKey);
  }, []);
  const style = { [cssVar("cols")]: gridTemplate(columns, props.nameMin) };
  const activeId = rows[active] && active >= start && active < end ? rowId(rows[active].channel.id) : void 0;
  return /* @__PURE__ */ jsxs43(
    "div",
    {
      ref: gridRef,
      role: "grid",
      "aria-label": t("table_label"),
      "aria-multiselectable": "true",
      "aria-rowcount": rows.length + 1,
      "aria-colcount": columns.length,
      "aria-activedescendant": activeId,
      tabIndex: 0,
      className: cx("mtable"),
      "data-part": "manage-table",
      style,
      onKeyDown,
      children: [
        /* @__PURE__ */ jsx50("div", { role: "rowgroup", children: /* @__PURE__ */ jsx50("div", { role: "row", "aria-rowindex": 1, className: cx("mhead"), "data-part": "manage-head", children: columns.map((c) => /* @__PURE__ */ jsx50(
          HeadCell,
          {
            col: c,
            t,
            sort,
            onSort,
            allSelected: props.allSelected,
            someSelected: props.someSelected,
            count: rows.length,
            onSelectAll: props.allSelected ? props.onClearSelection : props.onSelectAll
          },
          c
        )) }) }),
        /* @__PURE__ */ jsxs43("div", { role: "rowgroup", ref: bodyRef, children: [
          start > 0 ? /* @__PURE__ */ jsx50("div", { "aria-hidden": "true", "data-part": "manage-spacer-top", style: { height: `${start * ROW_H}px` } }) : null,
          rows.slice(start, end).map((row, k) => {
            const i = start + k;
            const id = row.channel.id;
            return /* @__PURE__ */ jsx50(
              Row2,
              {
                domId: rowId(id),
                index: i,
                row,
                columns,
                selected: selected.has(id),
                active: i === active,
                editing: editing && editing.id === id ? editing.field : null,
                error: props.errors[id] ?? null,
                folder: row.channel.folder_id ? props.folders.get(row.channel.folder_id) ?? null : null,
                tags: props.tags,
                folderOptions: props.folderOptions,
                tagOptions: props.tagOptions,
                nowS: props.nowS,
                locale,
                formats,
                onRowClick,
                onSelectCell,
                handlers: propsRef
              },
              id
            );
          }),
          /* @__PURE__ */ jsx50("div", { "aria-hidden": "true", "data-part": "manage-spacer-bottom", style: { height: `${Math.max(0, rows.length - end) * ROW_H}px` } })
        ] })
      ]
    }
  );
}
function HeadCell({
  col,
  t,
  sort,
  onSort,
  allSelected,
  someSelected,
  count: count2,
  onSelectAll
}) {
  const fmtLocale = useLocale();
  if (col === "select") {
    return /* @__PURE__ */ jsx50(
      "div",
      {
        role: "columnheader",
        className: cx("mcell mhead-cell"),
        "data-col": "select",
        onClick: (e) => {
          e.stopPropagation();
          onSelectAll();
        },
        children: /* @__PURE__ */ jsx50(
          Checkbox6,
          {
            checked: allSelected ? true : someSelected ? "indeterminate" : false,
            onCheckedChange: () => void 0,
            tabIndex: -1,
            "data-part": "manage-select-all",
            "aria-label": t("select_all", { count: formatNumber(count2, fmtLocale) })
          }
        )
      }
    );
  }
  const sortable = SORTABLE.has(col);
  const on = sort.key === col;
  const ariaSort = !sortable ? void 0 : on ? sort.dir === "asc" ? "ascending" : "descending" : "none";
  const label = t(`columns.${col}`);
  const hint = col === "last" || col === "rhythm" || col === "shorts" || col === "watched" ? t(`column_hints.${col}`) : void 0;
  return /* @__PURE__ */ jsx50(
    "div",
    {
      role: "columnheader",
      "aria-sort": ariaSort,
      className: cx("mcell mhead-cell"),
      "data-col": col,
      "data-num": NUMERIC_COLUMNS.has(col) ? "true" : void 0,
      children: sortable ? /* @__PURE__ */ jsxs43("button", { type: "button", tabIndex: -1, className: cx("bare msort"), title: hint, "aria-label": t("sort_by", { name: label }), onClick: () => onSort(col), children: [
        /* @__PURE__ */ jsx50("span", { className: cx("truncate"), children: label }),
        /* @__PURE__ */ jsx50(Codicon38, { name: on && sort.dir === "desc" ? "arrow-down" : "arrow-up", size: 12, className: cx("msort-icon") })
      ] }) : /* @__PURE__ */ jsx50("span", { className: cx("truncate"), children: label })
    }
  );
}
var Row2 = memo(function Row3({
  domId,
  index,
  row,
  columns,
  selected,
  active,
  editing,
  error,
  folder,
  tags,
  folderOptions,
  tagOptions,
  nowS,
  locale,
  formats,
  onRowClick,
  onSelectCell,
  handlers
}) {
  const t = useT("manage");
  const c = row.channel;
  const h = () => handlers.current;
  const dash = /* @__PURE__ */ jsx50("span", { className: cx("mnone"), children: "–" });
  const rowTags = c.tag_ids.map((id) => tags.get(id)).filter((x) => !!x);
  const cell = (col) => {
    switch (col) {
      case "select":
        return /* @__PURE__ */ jsx50("div", { role: "gridcell", className: cx("mcell"), "data-col": "select", onClick: (e) => onSelectCell(e, index, c.id), children: /* @__PURE__ */ jsx50(Checkbox6, { checked: selected, onCheckedChange: () => void 0, tabIndex: -1, "aria-label": t("select_row", { name: c.title }) }) }, col);
      case "name":
        return /* @__PURE__ */ jsxs43("div", { role: "gridcell", className: cx("mcell"), "data-col": "name", children: [
          /* @__PURE__ */ jsx50(ChannelAvatar, { title: c.title, thumb: c.thumb, size: 24 }),
          /* @__PURE__ */ jsxs43("span", { className: cx("mname-text"), children: [
            /* @__PURE__ */ jsxs43("span", { className: cx("mname-line"), children: [
              /* @__PURE__ */ jsx50("span", { className: cx("mname-title truncate"), title: c.ai_note ? `${c.title} — ${c.ai_note}` : c.title, children: c.title }),
              /* @__PURE__ */ jsx50(
                "button",
                {
                  type: "button",
                  tabIndex: -1,
                  className: cx("bare mfav"),
                  "data-part": "manage-fav",
                  "aria-pressed": c.favorite,
                  "aria-label": t("favorite"),
                  onClick: () => h().onFavorite(row),
                  children: /* @__PURE__ */ jsx50(Codicon38, { name: c.favorite ? "star-full" : "star-empty", size: 13 })
                }
              ),
              c.muted ? /* @__PURE__ */ jsx50("span", { className: cx("mmuted"), role: "img", "aria-label": t("muted"), title: t("muted"), children: /* @__PURE__ */ jsx50(Codicon38, { name: "bell-slash", size: 12 }) }) : null
            ] }),
            error ? /* @__PURE__ */ jsxs43("span", { className: cx("mrow-error t-label"), "data-part": "manage-row-error", role: "status", title: error, children: [
              /* @__PURE__ */ jsx50(Codicon38, { name: "error", size: 12, className: cx("mrow-error-icon") }),
              /* @__PURE__ */ jsx50("span", { className: cx("truncate"), children: error })
            ] }) : c.handle ? /* @__PURE__ */ jsx50("span", { className: cx("mname-sub t-label truncate"), children: c.handle }) : null
          ] })
        ] }, col);
      case "folder":
        return /* @__PURE__ */ jsxs43("div", { role: "gridcell", className: cx("mcell"), "data-col": "folder", children: [
          /* @__PURE__ */ jsx50(
            "button",
            {
              type: "button",
              tabIndex: -1,
              className: cx("bare medit"),
              "data-part": "manage-folder-edit",
              "aria-haspopup": "listbox",
              "aria-expanded": editing === "folder",
              "aria-label": t("edit_folder", { name: c.title }),
              onClick: () => h().onEdit(editing === "folder" ? null : { id: c.id, field: "folder" }),
              children: folder ? /* @__PURE__ */ jsx50(FolderChip, { folder }) : /* @__PURE__ */ jsx50("span", { className: cx("mplaceholder t-label"), children: t("no_folder") })
            }
          ),
          editing === "folder" ? /* @__PURE__ */ jsx50(
            Picker,
            {
              label: t("edit_folder", { name: c.title }),
              options: folderOptions,
              value: c.folder_id ?? "",
              searchable: true,
              onPick: (v) => h().onSetFolder(row, v || null),
              onCreate: (name) => h().onCreateFolder(row, name),
              createLabel: (name) => t("picker.create_folder", { name }),
              onClose: () => h().onEdit(null)
            }
          ) : null
        ] }, col);
      case "tags":
        return /* @__PURE__ */ jsxs43("div", { role: "gridcell", className: cx("mcell"), "data-col": "tags", children: [
          /* @__PURE__ */ jsx50(
            "button",
            {
              type: "button",
              tabIndex: -1,
              className: cx("bare medit"),
              "data-part": "manage-tags-edit",
              "aria-haspopup": "listbox",
              "aria-expanded": editing === "tags",
              "aria-label": t("edit_tags", { name: c.title }),
              onClick: () => h().onEdit(editing === "tags" ? null : { id: c.id, field: "tags" }),
              children: rowTags.length ? /* @__PURE__ */ jsxs43(Fragment24, { children: [
                rowTags.slice(0, 2).map((tag) => /* @__PURE__ */ jsx50(TagChip, { tag }, tag.id)),
                rowTags.length > 2 ? /* @__PURE__ */ jsxs43("span", { className: cx("mmore t-label"), children: [
                  "+",
                  rowTags.length - 2
                ] }) : null
              ] }) : /* @__PURE__ */ jsx50("span", { className: cx("mplaceholder t-label"), "data-hover": "true", children: t("add_tags") })
            }
          ),
          editing === "tags" ? /* @__PURE__ */ jsx50(
            Picker,
            {
              label: t("edit_tags", { name: c.title }),
              options: tagOptions,
              mode: "multi",
              values: c.tag_ids,
              searchable: true,
              onCommit: (ids) => h().onSetTags(row, ids),
              onCreate: (name, marked) => h().onCreateTag(row, name, marked ?? c.tag_ids),
              createLabel: (name) => t("picker.create_tag", { name }),
              onClose: () => h().onEdit(null)
            }
          ) : null
        ] }, col);
      case "last":
        return /* @__PURE__ */ jsx50(
          "div",
          {
            role: "gridcell",
            className: cx("mcell t-label"),
            "data-col": "last",
            "data-num": "true",
            title: c.last_video_at ? new Date(c.last_video_at * 1e3).toLocaleDateString(locale) : void 0,
            children: c.last_video_at ? formatRelative(c.last_video_at, nowS * 1e3, locale) : dash
          },
          col
        );
      case "rhythm": {
        const v = c.videos_per_week;
        return /* @__PURE__ */ jsx50("div", { role: "gridcell", className: cx("mcell"), "data-col": "rhythm", "data-num": "true", children: v == null ? dash : t("rhythm_value", { n: (v < 10 ? formats.one : formats.zero).format(v) }) }, col);
      }
      case "shorts":
        return /* @__PURE__ */ jsx50("div", { role: "gridcell", className: cx("mcell"), "data-col": "shorts", "data-num": "true", children: c.shorts_ratio == null ? dash : formats.pct.format(c.shorts_ratio) }, col);
      case "watched":
        return /* @__PURE__ */ jsx50("div", { role: "gridcell", className: cx("mcell"), "data-col": "watched", "data-num": "true", children: row.watched_90d == null ? dash : formatNumber(row.watched_90d, locale) }, col);
      case "relation":
        return /* @__PURE__ */ jsx50("div", { role: "gridcell", className: cx("mcell t-label"), "data-col": "relation", children: t(`relation.${c.relation}`) }, col);
    }
  };
  return /* @__PURE__ */ jsx50(
    "div",
    {
      id: domId,
      role: "row",
      "aria-rowindex": index + 2,
      "aria-selected": selected,
      className: cx("mrow"),
      "data-part": "manage-row",
      "data-channel": c.id,
      "data-active": active ? "true" : void 0,
      "data-editing": editing ? "true" : void 0,
      "data-error": error ? "true" : void 0,
      draggable: editing ? void 0 : true,
      onDragStart: (e) => {
        if (e.dataTransfer) h().onDragStart(row, e.dataTransfer);
      },
      onClick: (e) => onRowClick(e, index, c.id),
      children: columns.map(cell)
    }
  );
});
function ManageTableSkeleton({ columns, rows = 12 }) {
  const t = useT("manage");
  const style = { [cssVar("cols")]: gridTemplate(columns) };
  const widths = ["52%", "64%", "44%", "72%", "58%", "48%"];
  return /* @__PURE__ */ jsxs43("div", { role: "grid", "aria-label": t("loading"), "aria-busy": "true", className: cx("mtable"), "data-part": "manage-table", style, children: [
    /* @__PURE__ */ jsx50("div", { role: "rowgroup", children: /* @__PURE__ */ jsx50("div", { role: "row", className: cx("mhead"), "data-part": "manage-head", children: columns.map((c) => /* @__PURE__ */ jsx50("div", { role: "columnheader", className: cx("mcell mhead-cell"), "data-col": c, "data-num": NUMERIC_COLUMNS.has(c) ? "true" : void 0, children: c === "select" ? null : /* @__PURE__ */ jsx50("span", { className: cx("truncate"), children: t(`columns.${c}`) }) }, c)) }) }),
    /* @__PURE__ */ jsx50("div", { role: "rowgroup", children: Array.from({ length: rows }, (_, i) => /* @__PURE__ */ jsx50("div", { role: "row", className: cx("mrow"), "data-part": "manage-row", "data-skeleton": true, "aria-hidden": "true", children: columns.map((c) => /* @__PURE__ */ jsx50("div", { role: "gridcell", className: cx("mcell"), "data-col": c, "data-num": NUMERIC_COLUMNS.has(c) ? "true" : void 0, children: c === "name" ? /* @__PURE__ */ jsxs43(Fragment24, { children: [
      /* @__PURE__ */ jsx50(ChannelAvatarSkeleton, { size: 24 }),
      /* @__PURE__ */ jsx50("span", { className: cx("mname-text"), children: /* @__PURE__ */ jsx50("span", { className: cx("t-body"), children: /* @__PURE__ */ jsx50(SkLine, { width: widths[i % widths.length] }) }) })
    ] }) : c === "folder" || c === "tags" ? /* @__PURE__ */ jsx50(ChipSkeleton, { width: c === "folder" ? "76px" : "56px" }) : c === "select" ? null : /* @__PURE__ */ jsx50("span", { className: cx("t-label"), children: /* @__PURE__ */ jsx50(SkLine, { width: "32px" }) }) }, c)) }, i)) })
  ] });
}
function SkLine({ width }) {
  return /* @__PURE__ */ jsx50("span", { className: cx("sk-line"), style: { width }, children: /* @__PURE__ */ jsx50("span", { className: cx("sk"), style: { [cssVar("sk-w")]: "100%" } }) });
}

// desktop-src/pages/manage/index.tsx
import { Fragment as Fragment25, jsx as jsx51, jsxs as jsxs44 } from "react/jsx-runtime";
var RAIL_SPACE = 208 + 16;
var NARROW_PX2 = 700;
var PAGE = 2e3;
var DRAG_TYPE = `application/x-${CLASS_PREFIX}channels`;
async function fetchAllChannels() {
  const out = [];
  for (let page = 0; page < 50; page++) {
    const data = await restCall("GET /channels", { query: { limit: PAGE, ...out.length ? { offset: out.length } : {} } });
    out.push(...data.items);
    if (!data.items.length || out.length >= data.total) break;
  }
  return out;
}
function retry2(failureCount, error) {
  return error instanceof TubeApiError && error.transport && failureCount < 2;
}
function readView() {
  try {
    return parseView(maybePluginContext()?.storage.get(VIEW_KEY, null));
  } catch {
    return parseView(null);
  }
}
function writeView(value) {
  try {
    maybePluginContext()?.storage.set(VIEW_KEY, value);
  } catch {
  }
}
function useWidth(ref, key) {
  const [width, setWidth] = useState40(null);
  useLayoutEffect11(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth((prev) => prev === w ? prev : w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, key]);
  return width;
}
function ManagePage() {
  return /* @__PURE__ */ jsx51(ManageView, {});
}
function ManageView({ initial }) {
  useManageStyles();
  const t = useT("manage");
  const tc2 = useT();
  const fmt = useFormatCount();
  const plural5 = useCallback21((key, n, vars2 = {}) => t(`${key}_${n === 1 ? "one" : "other"}`, { ...vars2, count: fmt(n) }), [t, fmt]);
  const [filters, setFilters] = useState40(() => ({ ...readView().filters, ...initial?.filters }));
  const [sort, setSort] = useState40(() => initial?.sort ?? readView().sort);
  useEffect36(() => writeView({ filters, sort }), [filters, sort]);
  const channelsQ = useQuery3({
    queryKey: restQueryKey("GET /channels", { query: { view: "manage" } }),
    queryFn: fetchAllChannels,
    retry: retry2
  });
  const foldersQ = useRest("GET /folders", {});
  const tagsQ = useRest("GET /tags", {});
  const status = useStatus().data;
  const browserOnline = (status?.devices_online ?? 0) > 0;
  const neverPaired = useNeverPaired();
  const folders = useMemo10(() => foldersQ.data?.items ?? [], [foldersQ.data]);
  const tags = useMemo10(() => tagsQ.data?.items ?? [], [tagsQ.data]);
  const folderMap = useMemo10(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const folderNames = useMemo10(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);
  const tagMap = useMemo10(() => new Map(tags.map((x) => [x.id, x])), [tags]);
  const tagNames = useMemo10(() => new Map(tags.map((x) => [x.id, x.name])), [tags]);
  const tree = useMemo10(() => folderTree(folders), [folders]);
  const byIdRef = useRef37(/* @__PURE__ */ new Map());
  const actions = useManageActions({
    t,
    tc: tc2,
    plural: plural5,
    current: (id) => byIdRef.current.get(id),
    folderName: (id) => id ? folderNames.get(id) ?? "" : t("no_folder"),
    tagName: (id) => tagNames.get(id) ?? ""
  });
  const allRows = useMemo10(() => (channelsQ.data ?? []).map(actions.view), [channelsQ.data, actions.view]);
  const byId = useMemo10(() => new Map(allRows.map((r) => [r.channel.id, r])), [allRows]);
  byIdRef.current = byId;
  const nowS = useMemo10(() => Math.floor(Date.now() / 1e3), [channelsQ.data]);
  const effective = useMemo10(() => pruneFilters(filters, foldersQ.data?.items, tagsQ.data?.items), [filters, foldersQ.data, tagsQ.data]);
  const scope = useMemo10(() => allRows.filter((r) => inRelation(r.channel.relation, effective.relation)), [allRows, effective.relation]);
  const filtered = useMemo10(() => applyFilters(allRows, effective, { folders, nowS }), [allRows, effective, folders, nowS]);
  const sorted = useMemo10(() => sortRows(filtered, sort, folderNames, tagNames), [filtered, sort, folderNames, tagNames]);
  const order = useMemo10(() => sorted.map((r) => r.channel.id), [sorted]);
  const counts = useMemo10(() => folderCounts(scope, folders), [scope, folders]);
  const patchFilters = (next) => setFilters((f) => ({ ...f, ...next }));
  const clearFilters = () => setFilters({ ...DEFAULT_FILTERS });
  const rootRef = useRef37(null);
  const data = channelsQ.data;
  const hasChannels = !!data && data.length > 0;
  const width = useWidth(rootRef, hasChannels);
  const narrow = width !== null && width < NARROW_PX2;
  const tableWidth = width === null ? null : narrow ? width : width - RAIL_SPACE;
  const nameMin = useMemo10(() => nameNeed(allRows), [allRows]);
  const columns = useMemo10(() => fitColumns(dataColumns(allRows), tableWidth, nameMin), [allRows, tableWidth, nameMin]);
  const [selected, setSelected] = useState40(() => new Set(initial?.selected ?? []));
  const anchor = useRef37(null);
  const [editing, setEditing] = useState40(initial?.editing ?? null);
  useEffect36(() => {
    if (!channelsQ.data) return;
    setSelected((s) => {
      const next = new Set([...s].filter((id) => byId.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [channelsQ.data, byId]);
  const onToggle = useCallback21(
    (id, range) => {
      if (range && anchor.current) {
        const ids = rangeIds(order, anchor.current, id);
        setSelected((s) => /* @__PURE__ */ new Set([...s, ...ids]));
        return;
      }
      anchor.current = id;
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [order]
  );
  const onExtend = useCallback21(
    (from, to) => {
      if (!anchor.current) anchor.current = from;
      const ids = rangeIds(order, anchor.current, to);
      setSelected((s) => /* @__PURE__ */ new Set([...s, ...ids]));
    },
    [order]
  );
  const selectAll = useCallback21(() => setSelected((s) => /* @__PURE__ */ new Set([...s, ...order])), [order]);
  const clearSelection = useCallback21(() => {
    anchor.current = null;
    setSelected(/* @__PURE__ */ new Set());
  }, []);
  const allSelected = order.length > 0 && order.every((id) => selected.has(id));
  const someSelected = !allSelected && order.some((id) => selected.has(id));
  const visible = useMemo10(() => new Set(order), [order]);
  const hidden = [...selected].filter((id) => !visible.has(id)).length;
  const selectedIds = () => [...selected];
  const folderOptions = useMemo10(
    () => [
      { value: "", label: t("no_folder"), icon: "circle-slash" },
      ...tree.map(({ folder, level }) => ({ value: folder.id, label: folder.name, icon: "folder", level }))
    ],
    [tree, t]
  );
  const tagOptions = useMemo10(() => tags.map((x) => ({ value: x.id, label: x.name, icon: "tag" })), [tags]);
  const untagOptions = useMemo10(() => {
    const present = /* @__PURE__ */ new Set();
    for (const id of selected) for (const tg of byId.get(id)?.channel.tag_ids ?? []) present.add(tg);
    return tagOptions.filter((o) => present.has(o.value));
  }, [selected, byId, tagOptions]);
  const setFolder = (row, folderId, folderLabel) => {
    const prev = row.channel.folder_id ?? null;
    if (prev === folderId) return;
    const name = row.channel.title;
    const message = folderId ? plural5("toast.move", 1, { name, folder: folderLabel ?? folderNames.get(folderId) ?? "" }) : plural5("toast.move_none", 1, { name });
    void actions.patch(row.channel.id, { folder_id: folderId }, { folder_id: prev }, message);
  };
  const setTags = (row, ids) => {
    const prev = row.channel.tag_ids;
    if (prev.length === ids.length && prev.every((x) => ids.includes(x))) return;
    void actions.patch(row.channel.id, { tag_ids: ids }, { tag_ids: [...prev] }, t("toast.tags_set", { name: row.channel.title }));
  };
  const rowHandlers = {
    onToggle,
    onEdit: setEditing,
    onFavorite: (row) => {
      const fav = row.channel.favorite;
      void actions.patch(row.channel.id, { favorite: !fav }, { favorite: fav }, null);
    },
    onSetFolder: (row, folderId) => setFolder(row, folderId),
    onCreateFolder: async (row, name) => {
      const folder = await actions.createFolder(name);
      if (folder) setFolder(row, folder.id, folder.name);
    },
    onSetTags: setTags,
    onCreateTag: async (row, name, marked) => {
      const tag = await actions.createTag(name);
      if (tag) setTags(row, [...marked.filter((x) => x !== tag.id), tag.id]);
    },
    onDragStart: (row, dt) => {
      const id = row.channel.id;
      const ids = selected.has(id) ? selectedIds() : [id];
      dt.setData("text/plain", `channel:${id}`);
      dt.setData(DRAG_TYPE, JSON.stringify(ids));
      dt.effectAllowed = "move";
    }
  };
  const onDropTo = (target, dt) => {
    let ids = [];
    try {
      const raw = dt.getData(DRAG_TYPE);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) ids = parsed.filter((x) => typeof x === "string");
    } catch {
      ids = [];
    }
    if (!ids.length) {
      const text = dt.getData("text/plain").trim();
      const m = text.match(/^channel:(.+)$/);
      if (m) ids = [m[1]];
      else if (/^UC[\w-]{22}$/.test(text)) ids = [text];
    }
    ids = ids.filter((id) => byId.has(id));
    if (ids.length) void actions.batch("move", ids, target);
  };
  const [openFilter, setOpenFilter] = useState40(null);
  const searchRef = useRef37(null);
  const chipLabel2 = (chip) => {
    switch (chip) {
      case "folder":
        return effective.folder === "none" ? t("rail.none") : t("chips.folder", { name: folderNames.get(effective.folder ?? "") ?? "" });
      case "tag":
        return t("chips.tag", { name: tagNames.get(effective.tag ?? "") ?? "" });
      case "relation":
        return t(`relation.${effective.relation}`);
      case "favorite":
        return t("filters.favorite");
      case "muted":
        return t("filters.muted");
      case "stale":
        return t("chips.stale", { count: effective.staleMonths ?? 0 });
    }
  };
  const filterMenu = (key, label, active, options, value, onPick) => /* @__PURE__ */ jsxs44("span", { className: cx("manchor"), children: [
    /* @__PURE__ */ jsxs44(
      "button",
      {
        type: "button",
        className: cx("bare chip t-label mfilter"),
        "data-part": "manage-filter",
        "data-filter": key,
        "data-active": active ? "true" : void 0,
        "aria-haspopup": "listbox",
        "aria-expanded": openFilter === key,
        onClick: () => setOpenFilter((o) => o === key ? null : key),
        children: [
          /* @__PURE__ */ jsx51("span", { children: label }),
          /* @__PURE__ */ jsx51(Codicon39, { name: "chevron-down", size: 12, className: cx("mfilter-caret") })
        ]
      }
    ),
    openFilter === key ? /* @__PURE__ */ jsx51(Picker, { label, options, value, onPick, onClose: () => setOpenFilter(null) }) : null
  ] }, key);
  const toggleFilter = (key, label, icon) => /* @__PURE__ */ jsxs44(
    "button",
    {
      type: "button",
      className: cx("bare chip t-label mfilter"),
      "data-part": "manage-filter",
      "data-filter": key,
      "data-active": effective[key] ? "true" : void 0,
      "aria-pressed": effective[key],
      onClick: () => patchFilters({ [key]: !effective[key] }),
      children: [
        /* @__PURE__ */ jsx51(Codicon39, { name: effective[key] ? "check" : icon, size: 12 }),
        /* @__PURE__ */ jsx51("span", { children: label })
      ]
    },
    key
  );
  const filterChildren = [
    narrow ? filterMenu(
      "folder",
      t("filters.folder"),
      !!effective.folder,
      [
        { value: "", label: t("filters.folder_all"), icon: "list-flat", hint: fmt(counts.get("all") ?? 0) },
        { value: "none", label: t("rail.none"), icon: "circle-slash", hint: fmt(counts.get("none") ?? 0) },
        ...tree.map(({ folder, level }) => ({ value: folder.id, label: folder.name, icon: "folder", level, hint: fmt(counts.get(folder.id) ?? 0) }))
      ],
      effective.folder ?? "",
      (v) => patchFilters({ folder: v || null })
    ) : null,
    tags.length ? filterMenu(
      "tag",
      t("filters.tag"),
      !!effective.tag,
      [{ value: "", label: t("filters.tag_all") }, ...tagOptions],
      effective.tag ?? "",
      (v) => patchFilters({ tag: v || null })
    ) : null,
    filterMenu(
      "relation",
      t("filters.relation"),
      effective.relation !== "active",
      RELATION_FILTERS.map((r) => ({ value: r, label: t(`relation.${r}`) })),
      effective.relation,
      (v) => patchFilters({ relation: RELATION_FILTERS.find((r) => r === v) ?? "active" })
    ),
    toggleFilter("favorite", t("filters.favorite"), "star-empty"),
    toggleFilter("muted", t("filters.muted"), "bell-slash"),
    filterMenu(
      "stale",
      t("filters.stale"),
      !!effective.staleMonths,
      [{ value: "", label: t("filters.stale_any") }, ...STALE_MONTHS.map((m) => ({ value: String(m), label: t("filters.stale_option", { count: m }) }))],
      effective.staleMonths ? String(effective.staleMonths) : "",
      (v) => patchFilters({ staleMonths: v ? Number(v) : null })
    ),
    ...activeChips(effective).map((chip) => {
      const label = chipLabel2(chip);
      return /* @__PURE__ */ jsxs44("span", { className: cx("chip t-label mchip"), "data-part": "manage-chip", "data-filter": chip, children: [
        /* @__PURE__ */ jsx51("span", { className: cx("chip-label"), children: label }),
        /* @__PURE__ */ jsx51(
          "button",
          {
            type: "button",
            className: cx("bare chip-remove"),
            "data-part": "chip-remove",
            "aria-label": t("chips.remove", { name: label }),
            onClick: () => setFilters((f) => clearChip(f, chip)),
            children: /* @__PURE__ */ jsx51(Codicon39, { name: "close", size: 10 })
          }
        )
      ] }, `chip-${chip}`);
    }),
    /* @__PURE__ */ jsx51("span", { className: cx("mcount t-label"), "data-part": "manage-count", "aria-live": "polite", children: t("count", { shown: fmt(sorted.length), total: fmt(scope.length) }) }, "count")
  ];
  const subscribed = allRows.filter((r) => r.channel.relation === "subscribed").length;
  const followed = allRows.filter((r) => r.channel.relation === "followed").length;
  const extNotice = pickExtNotice({ status, neverPaired, needed: subscribed > 0 });
  const banner = extNotice === "ext_not_paired" ? /* @__PURE__ */ jsx51(Banner, { tone: "info", icon: "extensions", action: { label: t("banner.connect"), onClick: () => openDialog("onboarding", { step: "pair" }) }, children: t("banner.ext_not_paired") }) : extNotice === "ext_disconnected" ? /* @__PURE__ */ jsx51(Banner, { tone: "info", icon: "debug-disconnect", action: { label: t("banner.reconnect"), onClick: () => openDialog("onboarding", { step: "pair" }) }, children: t("banner.ext_disconnected") }) : void 0;
  const toolbar = hasChannels ? /* @__PURE__ */ jsxs44("div", { className: cx("mtoolbar"), children: [
    /* @__PURE__ */ jsx51(
      FilterBar,
      {
        query: filters.q,
        onQueryChange: (q) => patchFilters({ q }),
        placeholder: t("filters.search"),
        searchRef,
        onClear: hasFilters(effective) ? clearFilters : void 0,
        children: filterChildren
      }
    ),
    selected.size ? /* @__PURE__ */ jsx51(
      BatchBar,
      {
        count: selected.size,
        hidden,
        plural: plural5,
        folderOptions,
        tagOptions,
        untagOptions,
        onMove: (fid) => void actions.batch("move", selectedIds(), fid),
        onCreateFolder: async (name) => {
          const ids = selectedIds();
          const folder = await actions.createFolder(name);
          if (folder) await actions.batch("move", ids, folder.id, { folder: folder.name });
        },
        onTag: (tagId) => void actions.batch("tag", selectedIds(), tagId),
        onCreateTag: async (name) => {
          const ids = selectedIds();
          const tag = await actions.createTag(name);
          if (tag) await actions.batch("tag", ids, tag.id, { tag: tag.name });
        },
        onUntag: (tagId) => void actions.batch("untag", selectedIds(), tagId),
        onOp: (op) => void actions.batch(op, selectedIds()),
        onRead: () => void actions.markRead(selectedIds()),
        onOrganize: () => openDialog("organize", { channelIds: selectedIds() }),
        onClear: clearSelection
      }
    ) : null
  ] }) : void 0;
  let body;
  if (!data && channelsQ.error) {
    body = /* @__PURE__ */ jsx51(ErrorView, { error: channelsQ.error, title: t("error.title"), onRetry: () => void channelsQ.refetch() });
  } else if (!data) {
    body = /* @__PURE__ */ jsx51("div", { className: cx("mlayout"), ref: rootRef, children: /* @__PURE__ */ jsx51("div", { className: cx("mmain"), children: /* @__PURE__ */ jsx51(ManageTableSkeleton, { columns: fitColumns(ALL_COLUMNS, tableWidth) }) }) });
  } else if (!hasChannels) {
    body = /* @__PURE__ */ jsx51(
      EmptyView,
      {
        icon: "organization",
        title: t("empty.title"),
        description: t("empty.description"),
        action: /* @__PURE__ */ jsx51(Button33, { onClick: () => showSection("home"), children: t("empty.action") })
      }
    );
  } else {
    body = /* @__PURE__ */ jsxs44("div", { className: cx("mlayout"), ref: rootRef, "data-part": "manage", "data-narrow": narrow ? "true" : void 0, children: [
      narrow ? null : /* @__PURE__ */ jsx51(
        Rail,
        {
          tree,
          counts,
          current: effective.folder,
          onSelect: (folder) => patchFilters({ folder }),
          onDropTo,
          onCreate: (name) => void actions.createFolder(name, true),
          onRename: (id, name) => void actions.renameFolder(id, name)
        }
      ),
      /* @__PURE__ */ jsx51("div", { className: cx("mmain"), children: sorted.length ? /* @__PURE__ */ jsx51(
        ManageTable,
        {
          rows: sorted,
          columns,
          nameMin,
          sort,
          onSort: (key) => setSort((s) => nextSort(s, key)),
          selected,
          onExtend,
          onSelectAll: selectAll,
          onClearSelection: clearSelection,
          allSelected,
          someSelected,
          folders: folderMap,
          folderOptions,
          tags: tagMap,
          tagOptions,
          errors: actions.errors,
          editing,
          nowS,
          ...rowHandlers
        }
      ) : /* @__PURE__ */ jsx51("div", { "data-part": "manage-no-results", children: /* @__PURE__ */ jsx51(
        EmptyView,
        {
          icon: "filter",
          title: t("no_results.title"),
          description: t("no_results.description"),
          action: /* @__PURE__ */ jsx51(Button33, { variant: "outline", size: "sm", onClick: clearFilters, children: t("no_results.action") })
        }
      ) }) })
    ] });
  }
  return (
    // section selector (Subscriptions · Manage · Cleanup), the same on all three screens
    /* @__PURE__ */ jsx51(SectionFrame, { current: "manage", children: /* @__PURE__ */ jsx51(
      Page,
      {
        title: t("title"),
        subtitle: hasChannels ? t("subtitle", { subscribed: fmt(subscribed), followed: fmt(followed) }) : void 0,
        actions: (
          // with no channels at all, the way forward is the Welcome (the empty state's button is the main one);
          // the button is always there: the fixed way into the Welcome dialog (browser, channel link, demo). With a
          // browser online it says so instead of asking to connect one that is already connected.
          /* @__PURE__ */ jsxs44(Fragment25, { children: [
            /* @__PURE__ */ jsxs44(
              Button33,
              {
                variant: "outline",
                size: "sm",
                "data-part": "manage-connect",
                "data-state": browserOnline ? "connected" : "idle",
                title: t(browserOnline ? "actions.connected_hint" : "actions.connect_hint"),
                onClick: () => openDialog("onboarding", {}),
                children: [
                  /* @__PURE__ */ jsx51(Codicon39, { name: browserOnline ? "check" : "plug", size: 14 }),
                  /* @__PURE__ */ jsx51("span", { children: t(browserOnline ? "actions.connected" : "actions.connect") })
                ]
              }
            ),
            !data || hasChannels ? /* @__PURE__ */ jsxs44(Button33, { size: "sm", onClick: () => openDialog("organize"), children: [
              /* @__PURE__ */ jsx51(Codicon39, { name: "sparkle", size: 14 }),
              /* @__PURE__ */ jsx51("span", { children: t("actions.organize") })
            ] }) : null
          ] })
        ),
        toolbar,
        banner,
        children: body
      }
    ) })
  );
}

// desktop-src/pages/manage/create-tab/index.tsx
import { jsx as jsx52 } from "react/jsx-runtime";
function CreateTabDialog({ onClose }) {
  const t = useT();
  return /* @__PURE__ */ jsx52(DialogFrame, { title: t("dialogs.create-tab"), onClose, children: /* @__PURE__ */ jsx52(EmptyView, { title: t("placeholder.title"), description: t("placeholder.description") }) });
}

// desktop-src/pages/manage/history/index.tsx
import { jsx as jsx53 } from "react/jsx-runtime";
function HistoryDialog({ onClose }) {
  const t = useT();
  return /* @__PURE__ */ jsx53(DialogFrame, { title: t("dialogs.history"), onClose, children: /* @__PURE__ */ jsx53(EmptyView, { title: t("placeholder.title"), description: t("placeholder.description") }) });
}

// desktop-src/panes/index.tsx
import {
  Button as Button35,
  Codicon as Codicon40,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  SearchField as SearchField2,
  Tip as Tip5,
  atom as atom16,
  host as host25,
  useValue as useValue17
} from "@hermes/plugin-sdk";
import { useCallback as useCallback23, useEffect as useEffect37, useMemo as useMemo12, useRef as useRef39, useState as useState42 } from "react";

// desktop-src/panes/actions.ts
import { host as host24 } from "@hermes/plugin-sdk";
import { useCallback as useCallback22, useMemo as useMemo11, useRef as useRef38, useState as useState41 } from "react";
var UNDO_MS5 = 7e3;
var channelKey = (id, field) => `c:${id}:${field}`;
var folderKey2 = (id) => `f:${id}:parent_id`;
function applyOverlay(folders, channels, overlay) {
  const f = overlay.fields;
  if (!Object.keys(f).length) return { folders: [...folders], channels: [...channels] };
  const out = {
    folders: folders.map((x) => {
      const l = f[folderKey2(x.id)];
      return l ? { ...x, parent_id: l.value } : x;
    }),
    channels: channels.map((c) => {
      let next = c;
      for (const field of ["folder_id", "favorite", "muted"]) {
        const l = f[channelKey(c.id, field)];
        if (l) next = { ...next, [field]: l.value };
      }
      return next;
    })
  };
  return out;
}
function readAdjusted(byChannel, overlay) {
  if (!byChannel) return null;
  if (!overlay.readAll && !overlay.read.size) return { ...byChannel };
  const out = {};
  for (const [id, n] of Object.entries(byChannel)) out[id] = overlay.readAll || overlay.read.has(id) ? 0 : n;
  return out;
}
var REFRESH_ROUTES = ["GET /channels", "GET /folders", "GET /state", "GET /status", "GET /feed"];
function refresh() {
  return invalidateRest(...REFRESH_ROUTES).catch(() => void 0);
}
async function markReadChanges(sinceTs) {
  const { items } = await restCall("GET /changes", { query: { limit: 20 } });
  return items.filter((c) => c.action === "mark_read" && c.undone_at == null && c.ts >= sinceTs).slice(0, 1).map((c) => c.id);
}
function usePaneActions(t, tc2) {
  const [fields, setFields] = useState41({});
  const [reads, setReads] = useState41({});
  const token = useRef38(0);
  const put = useCallback22((key, value) => {
    const tk = ++token.current;
    setFields((f) => ({ ...f, [key]: { value, token: tk } }));
    return tk;
  }, []);
  const settle = useCallback22((key, tk) => {
    setFields((f) => {
      if (f[key]?.token !== tk) return f;
      const next = { ...f };
      delete next[key];
      return next;
    });
  }, []);
  const fail = useCallback22(
    (msg, error) => host24.notify({ kind: "error", message: t(msg, { error: errorText(tc2, toApiError(error)) }) }),
    [t, tc2]
  );
  const change = useCallback22(
    (spec) => {
      const tk = put(spec.key, spec.after);
      spec.send(spec.after).then(
        async () => {
          await refresh();
          settle(spec.key, tk);
          host24.notify({
            kind: "success",
            message: spec.message,
            durationMs: UNDO_MS5,
            action: {
              label: t("toast.undo"),
              onClick: () => {
                const tu = put(spec.key, spec.before);
                spec.send(spec.before).then(
                  async () => {
                    await refresh();
                    settle(spec.key, tu);
                  },
                  (error) => {
                    settle(spec.key, tu);
                    fail("toast.undo_failed", error);
                  }
                );
              }
            }
          });
        },
        (error) => {
          settle(spec.key, tk);
          fail("toast.failed", error);
        }
      );
    },
    [put, settle, fail, t]
  );
  const moveChannel = useCallback22(
    (c, folderId, message) => change({
      key: channelKey(c.id, "folder_id"),
      before: c.folder_id,
      after: folderId,
      send: (v) => restCall("PATCH /channels/{id}", { path: { id: c.id }, body: { folder_id: v } }),
      message
    }),
    [change]
  );
  const moveFolder = useCallback22(
    (f, parentId, message) => change({
      key: folderKey2(f.id),
      before: f.parent_id,
      after: parentId,
      send: (v) => restCall("PATCH /folders/{id}", { path: { id: f.id }, body: { parent_id: v } }),
      message
    }),
    [change]
  );
  const setFlag = useCallback22(
    (c, field, value, message) => change({
      key: channelKey(c.id, field),
      before: c[field],
      after: value,
      send: (v) => restCall("PATCH /channels/{id}", { path: { id: c.id }, body: { [field]: v } }),
      message
    }),
    [change]
  );
  const markRead = useCallback22(
    (scope, channelIds, messages) => {
      const op = ++token.current;
      const drop = () => setReads((r) => {
        const next = { ...r };
        delete next[op];
        return next;
      });
      setReads((r) => ({ ...r, [op]: scope.kind === "all" ? "all" : channelIds }));
      const since = Math.floor(Date.now() / 1e3) - 2;
      restCall("POST /read", { body: scope }).then(
        async (res) => {
          await refresh();
          drop();
          if (!res.changed) {
            host24.notify({ kind: "info", message: messages.nothing });
            return;
          }
          let undoIds = [];
          try {
            undoIds = await markReadChanges(since);
          } catch {
            undoIds = [];
          }
          host24.notify({
            kind: "success",
            message: messages.done,
            durationMs: UNDO_MS5,
            ...undoIds.length ? {
              action: {
                label: t("toast.undo"),
                onClick: () => {
                  Promise.all(undoIds.map((id) => restCall("POST /changes/{id}/undo", { path: { id } }))).then(
                    () => refresh(),
                    (error) => fail("toast.undo_failed", error)
                  );
                }
              }
            } : {}
          });
        },
        (error) => {
          drop();
          fail("toast.failed", error);
        }
      );
    },
    [fail, t]
  );
  const overlay = useMemo11(() => {
    const all = Object.values(reads);
    const read2 = /* @__PURE__ */ new Set();
    for (const r of all) if (r !== "all") for (const id of r) read2.add(id);
    return { fields, readAll: all.includes("all"), read: read2 };
  }, [fields, reads]);
  return { overlay, moveChannel, moveFolder, setFlag, markRead };
}

// desktop-src/panes/model.ts
function nodeKey(ref) {
  return ref.kind === "folder" || ref.kind === "channel" ? `${ref.kind}:${ref.id}` : ref.kind;
}
function parseKey(key) {
  if (!key) return null;
  if (key === "all" || key === "later" || key === "unfiled") return { kind: key };
  const i = key.indexOf(":");
  if (i < 0) return null;
  const kind = key.slice(0, i);
  const id = key.slice(i + 1);
  if (!id) return null;
  return kind === "folder" || kind === "channel" ? { kind, id } : null;
}
var collator = new Intl.Collator(void 0, { sensitivity: "base", numeric: true });
function byFolderOrder(a, b) {
  return a.sort - b.sort || collator.compare(a.name, b.name);
}
function byTitle(a, b) {
  return collator.compare(a.title, b.title);
}
function buildTree(folders, channels) {
  const folderMap = new Map(folders.map((f) => [f.id, f]));
  const kids = /* @__PURE__ */ new Map();
  for (const f of folders) {
    const parent = f.parent_id && folderMap.has(f.parent_id) && !reachesSelf(folderMap, f) ? f.parent_id : null;
    const list = kids.get(parent) ?? [];
    list.push(f);
    kids.set(parent, list);
  }
  const inFolder = /* @__PURE__ */ new Map();
  const unfiled = [];
  for (const c of channels) {
    if (c.folder_id && folderMap.has(c.folder_id)) {
      const list = inFolder.get(c.folder_id) ?? [];
      list.push(c);
      inFolder.set(c.folder_id, list);
    } else unfiled.push(c);
  }
  const build = (f) => ({
    folder: f,
    children: (kids.get(f.id) ?? []).sort(byFolderOrder).map(build),
    channels: (inFolder.get(f.id) ?? []).sort(byTitle)
  });
  return {
    roots: (kids.get(null) ?? []).sort(byFolderOrder).map(build),
    unfiled: unfiled.sort(byTitle),
    folders: folderMap,
    channels: new Map(channels.map((c) => [c.id, c]))
  };
}
function reachesSelf(map, f) {
  const seen = /* @__PURE__ */ new Set([f.id]);
  let p = f.parent_id;
  while (p) {
    if (seen.has(p)) return true;
    seen.add(p);
    p = map.get(p)?.parent_id ?? null;
  }
  return false;
}
function isInside(folders, id, ancestorId) {
  const map = folders instanceof Map ? folders : new Map(folders.map((f) => [f.id, f]));
  const seen = /* @__PURE__ */ new Set();
  let p = map.get(id)?.parent_id ?? null;
  while (p && !seen.has(p)) {
    if (p === ancestorId) return true;
    seen.add(p);
    p = map.get(p)?.parent_id ?? null;
  }
  return false;
}
function folderCounts2(tree, byChannel) {
  const out = /* @__PURE__ */ new Map();
  if (!byChannel) return out;
  const walk = (n) => {
    let sum2 = 0;
    for (const c of n.channels) sum2 += byChannel[c.id] ?? 0;
    for (const k of n.children) sum2 += walk(k);
    out.set(n.folder.id, sum2);
    return sum2;
  };
  for (const r of tree.roots) walk(r);
  return out;
}
function channelsIn(tree, ref) {
  if (ref.kind === "all") return [...tree.channels.keys()];
  if (ref.kind === "channel") return [ref.id];
  if (ref.kind === "unfiled") return tree.unfiled.map((c) => c.id);
  if (ref.kind !== "folder") return [];
  const out = [];
  const walk = (n) => {
    for (const c of n.channels) out.push(c.id);
    n.children.forEach(walk);
  };
  const find = (nodes) => {
    for (const n of nodes) {
      if (n.folder.id === ref.id) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return null;
  };
  const node = find(tree.roots);
  if (node) walk(node);
  return out;
}
function readScopeOf2(ref) {
  if (ref.kind === "all") return { kind: "all" };
  if (ref.kind === "folder" || ref.kind === "channel") return { kind: ref.kind, id: ref.id };
  return null;
}
function fold3(text) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
function filterTree(tree, query) {
  const words = fold3(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { tree, matches: 0 };
  const hit = (text) => {
    const hay = fold3(text);
    return words.every((w) => hay.includes(w));
  };
  let matches2 = 0;
  const channelHit = (c) => hit(`${c.title} ${c.handle ?? ""}`);
  const walk = (n) => {
    if (hit(n.folder.name)) {
      matches2++;
      return n;
    }
    const children = n.children.map(walk).filter((k) => k !== null);
    const channels = n.channels.filter(channelHit);
    matches2 += channels.length;
    return children.length || channels.length ? { folder: n.folder, children, channels } : null;
  };
  const roots = tree.roots.map(walk).filter((k) => k !== null);
  const unfiled = tree.unfiled.filter(channelHit);
  matches2 += unfiled.length;
  return { tree: { ...tree, roots, unfiled }, matches: matches2 };
}
var CHANNEL_ID2 = /^UC[A-Za-z0-9_-]{22}$/;
function dragData(item) {
  return `${item.kind}:${item.id}`;
}
function parseDrag(data) {
  const text = (data ?? "").trim();
  if (CHANNEL_ID2.test(text)) return { kind: "channel", id: text };
  const m = /^(channel|folder):(.+)$/.exec(text);
  if (!m) return null;
  if (m[1] === "channel" && !CHANNEL_ID2.test(m[2])) return null;
  return { kind: m[1], id: m[2] };
}
var HOME_LATER_TAB = ":later";
var HOME_ALL_TAB = "all-new";
function onlyThis(tab, key, id) {
  const inc = tab.rules?.include;
  if (!inc || inc.all || inc.favorites) return false;
  const other = key === "folders" ? "channels" : "folders";
  const list = inc[key] ?? [];
  return list.length === 1 && list[0] === id && !(inc[other] ?? []).length && !(inc.tags ?? []).length && !(inc.themes ?? []).length && !(inc.lenses ?? []).length;
}
function homeTabFor(ref, tabs) {
  if (ref.kind === "later") return HOME_LATER_TAB;
  if (ref.kind === "all") return tabs?.find((t) => t.id === HOME_ALL_TAB)?.id ?? tabs?.find((t) => t.rules?.include?.all)?.id ?? HOME_ALL_TAB;
  if (ref.kind === "folder") return tabs?.find((t) => onlyThis(t, "folders", ref.id))?.id ?? null;
  if (ref.kind === "channel") return tabs?.find((t) => onlyThis(t, "channels", ref.id))?.id ?? null;
  return null;
}
var NOT_HERE4 = /\b404\b|not found|expected json|got html|plugin.*(disabled|not (installed|loaded|enabled))/i;
function failureKind2(error) {
  if (error instanceof TubeApiError) {
    if (error.code === "plugin_disabled") return "unavailable";
    if (error.transport) return NOT_HERE4.test(error.message) ? "unavailable" : "offline";
    return "error";
  }
  const api = toApiError(error);
  if (api.code === "plugin_disabled") return "unavailable";
  if (api.code !== "internal") return "error";
  return NOT_HERE4.test(api.message) ? "unavailable" : "offline";
}

// desktop-src/panes/MoveDialog.tsx
import { Button as Button34 } from "@hermes/plugin-sdk";
import { jsx as jsx54, jsxs as jsxs45 } from "react/jsx-runtime";
function MoveDialog({ subject, tree, onPick, onClose }) {
  const t = useT("panes");
  const pick = (id) => {
    onClose();
    if (id !== subject.current) onPick(id);
  };
  const render = (n, level) => {
    if (subject.kind === "folder" && n.folder.id === subject.id) return null;
    const kids = n.children.map((k) => render(k, level + 1)).filter(Boolean);
    return /* @__PURE__ */ jsx54(
      TreeItem,
      {
        id: `dest:${n.folder.id}`,
        level,
        label: n.folder.name,
        icon: "folder",
        expanded: kids.length ? true : void 0,
        selected: subject.current === n.folder.id,
        onSelect: () => pick(n.folder.id),
        children: kids.length ? kids : void 0
      },
      n.folder.id
    );
  };
  return /* @__PURE__ */ jsx54(
    DialogFrame,
    {
      size: "sm",
      title: t("move.title", { name: subject.name }),
      description: subject.kind === "channel" ? t("move.description_channel") : t("move.description_folder"),
      onClose,
      footer: /* @__PURE__ */ jsx54(Button34, { variant: "outline", size: "sm", onClick: onClose, children: t("move.cancel") }),
      children: /* @__PURE__ */ jsxs45(Tree, { label: t("move.title", { name: subject.name }), children: [
        /* @__PURE__ */ jsx54(
          TreeItem,
          {
            id: "dest:",
            label: subject.kind === "channel" ? t("move.no_folder") : t("move.top_level"),
            icon: subject.kind === "channel" ? "circle-slash" : "list-tree",
            selected: subject.current === null,
            onSelect: () => pick(null)
          }
        ),
        tree.roots.map((n) => render(n, 1))
      ] })
    }
  );
}

// desktop-src/panes/prefs.ts
var PANE_KEYS = {
  expanded: "pane.expanded",
  selected: "pane.selected",
  target: "pane.target"
};
var HOME_TAB_KEY3 = "home.tab";
function storage3() {
  try {
    return maybePluginContext()?.storage ?? null;
  } catch {
    return null;
  }
}
function readPref2(key, fallback, valid2) {
  try {
    const value = storage3()?.get(key, fallback);
    return valid2(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
function writePref2(key, value) {
  try {
    storage3()?.set(key, value);
  } catch {
  }
}
var isStringList = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
var isText2 = (v) => typeof v === "string" && v.length > 0;

// desktop-src/panes/index.tsx
import { Fragment as Fragment26, jsx as jsx55, jsxs as jsxs46 } from "react/jsx-runtime";
var REFRESH_MS = 6e4;
var CHANNEL_QUERY = { relation: "subscribed,followed", limit: 2e3 };
var NO_PROFILE_ATOM2 = atom16("default");
function SubscriptionsPane() {
  return /* @__PURE__ */ jsx55(PaneView, {});
}
function openMenuFrom(el) {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + Math.min(r.width, 24), clientY: r.bottom }));
}
function sum(ids, counts) {
  let n = 0;
  for (const id of ids) n += counts[id] ?? 0;
  return n;
}
function presetFor(ref, name) {
  if (ref.kind === "folder") return { name, kind: "category", rules: { include: { folders: [ref.id] } } };
  if (ref.kind === "channel") return { name, kind: "channels", rules: { include: { channels: [ref.id] } } };
  return null;
}
function PaneView({ initialExpanded, initialQuery = "" }) {
  const t = useT("panes");
  const tc2 = useT();
  const profile = useValue17(host25.state?.profile ?? NO_PROFILE_ATOM2) || "default";
  const folders = useRest("GET /folders", {}, { refetchInterval: REFRESH_MS });
  const channels = useRest("GET /channels", { query: CHANNEL_QUERY }, { refetchInterval: REFRESH_MS });
  const state = useRest("GET /state", {}, { refetchInterval: REFRESH_MS });
  const tabs = useRest("GET /tabs", {}, { staleTime: REFRESH_MS });
  const status = useStatus();
  const st = status.data;
  const { overlay, moveChannel, moveFolder, setFlag, markRead } = usePaneActions(t, tc2);
  const pulse = st ? `${st.new_total}:${st.last_rss_at}:${st.refresh_running}` : null;
  const lastPulse = useRef39(pulse);
  useEffect37(() => {
    if (lastPulse.current !== null && pulse !== null && pulse !== lastPulse.current) void invalidateRest("GET /state", "GET /channels");
    if (pulse !== null) lastPulse.current = pulse;
  }, [pulse]);
  const view = useMemo12(() => {
    const fItems = folders.data?.items;
    const cItems = channels.data?.items;
    if (!Array.isArray(fItems) || !Array.isArray(cItems)) return null;
    const merged = applyOverlay(
      fItems,
      cItems.map((r) => r.channel),
      overlay
    );
    return { tree: buildTree(merged.folders, merged.channels) };
  }, [folders.data, channels.data, overlay]);
  const serverCounts = state.data?.counts;
  const counts = useMemo12(() => readAdjusted(serverCounts?.by_channel, overlay), [serverCounts, overlay]);
  const byFolder = useMemo12(() => view && counts ? folderCounts2(view.tree, counts) : null, [view, counts]);
  const allCount = useMemo12(() => {
    if (!serverCounts || !counts) return null;
    if (overlay.readAll) return 0;
    return Math.max(0, (serverCounts.total ?? 0) - sum(overlay.read, serverCounts.by_channel ?? {}));
  }, [serverCounts, counts, overlay]);
  const [expanded, setExpanded] = useState42(() => new Set(initialExpanded ?? readPref2(PANE_KEYS.expanded, [], isStringList)));
  const [selected, setSelected] = useState42(() => readPref2(PANE_KEYS.selected, null, isText2));
  const [query, setQuery] = useState42(initialQuery);
  const [menuFor, setMenuFor] = useState42(null);
  const [moving, setMoving] = useState42(null);
  const told = useRef39(/* @__PURE__ */ new Set());
  const rootRef = useRef39(null);
  const fmt = useFormatCount();
  const toggle = useCallback23((key) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      writePref2(PANE_KEYS.expanded, [...n]);
      return n;
    });
  }, []);
  const filtered = useMemo12(() => view && query.trim() ? filterTree(view.tree, query) : null, [view, query]);
  const nameOf = useCallback23(
    (ref) => {
      if (ref.kind === "folder") return view?.tree.folders.get(ref.id)?.name ?? "";
      if (ref.kind === "channel") return view?.tree.channels.get(ref.id)?.title ?? "";
      return t(`tree.${ref.kind}`);
    },
    [view, t]
  );
  const openInHome = useCallback23(
    (ref) => {
      const tabId = homeTabFor(ref, Array.isArray(tabs.data?.items) ? tabs.data.items : void 0);
      if (tabId) writePref2(HOME_TAB_KEY3, tabId);
      if (ref.kind === "folder" || ref.kind === "channel") writePref2(PANE_KEYS.target, { kind: ref.kind, id: ref.id, at: Date.now() });
      openSection("home");
      const key = nodeKey(ref);
      const name = nameOf(ref);
      const preset = presetFor(ref, name);
      if (!tabId && preset && !told.current.has(key)) {
        told.current.add(key);
        host25.notify({
          kind: "info",
          message: t("nav.no_tab", { name }),
          action: { label: t("nav.create_tab"), onClick: () => openDialog(DIALOG_IDS.tabEditor, { preset }) }
        });
      }
    },
    [tabs.data, nameOf, t]
  );
  const select = useCallback23(
    (ref) => {
      if (ref.kind === "unfiled") {
        toggle("unfiled");
        return;
      }
      const key = nodeKey(ref);
      setSelected(key);
      writePref2(PANE_KEYS.selected, key);
      openInHome(ref);
    },
    [toggle, openInHome]
  );
  const destOf = (ref) => {
    if (ref.kind === "folder") return ref.id;
    if (ref.kind === "all" || ref.kind === "unfiled") return null;
    if (ref.kind === "channel") return view?.tree.channels.get(ref.id)?.folder_id ?? null;
    return void 0;
  };
  const moveTo = useCallback23(
    (item, dest) => {
      if (!view) return;
      const folderName = dest ? view.tree.folders.get(dest)?.name ?? "" : "";
      if (item.kind === "channel") {
        const c = view.tree.channels.get(item.id);
        if (!c || (c.folder_id ?? null) === dest) return;
        moveChannel(c, dest, dest ? t("toast.moved_channel", { name: c.title, folder: folderName }) : t("toast.moved_channel_none", { name: c.title }));
        return;
      }
      const f = view.tree.folders.get(item.id);
      if (!f || dest === f.id) return;
      if (dest && isInside(view.tree.folders, dest, f.id)) {
        host25.notify({ kind: "info", message: t("toast.cycle") });
        return;
      }
      if ((f.parent_id ?? null) === dest) return;
      moveFolder(f, dest, dest ? t("toast.moved_folder", { name: f.name, folder: folderName }) : t("toast.moved_folder_root", { name: f.name }));
    },
    [view, moveChannel, moveFolder, t]
  );
  const onDrop = (target, data) => {
    const item = parseDrag(data);
    const dest = destOf(target);
    if (!item || dest === void 0) return;
    moveTo(item, dest);
  };
  const doMarkRead = (ref) => {
    const scope = readScopeOf2(ref);
    if (!scope || !view) return;
    const name = nameOf(ref);
    markRead(scope, channelsIn(view.tree, ref), {
      done: ref.kind === "all" ? t("toast.read_all") : t("toast.read", { name }),
      nothing: ref.kind === "all" ? t("toast.read_nothing_all") : t("toast.read_nothing", { name })
    });
  };
  const onContextMenu = (e) => {
    const li = e.target.closest('[role="treeitem"]');
    const ref = parseKey(li?.getAttribute("data-id"));
    if (!ref || ref.kind === "later" || ref.kind === "unfiled") {
      e.preventDefault();
      setMenuFor(null);
      return;
    }
    setMenuFor(ref);
  };
  const onTreeKeyDown = (e) => {
    if (!(e.key === "ContextMenu" || e.key === "F10" && e.shiftKey)) return;
    const li = e.target.closest('[role="treeitem"]');
    const row = li?.querySelector(':scope > [data-part="tree-row"]');
    if (!row) return;
    e.preventDefault();
    openMenuFrom(row);
  };
  const menuItems = (ref) => {
    if (!view) return null;
    const item = (id, icon, label, run) => /* @__PURE__ */ jsxs46(ContextMenuItem, { "data-menu": id, onSelect: run, children: [
      /* @__PURE__ */ jsx55(Codicon40, { name: icon, size: 14 }),
      label
    ] }, id);
    if (ref.kind === "all") return [item("mark_all_read", "check-all", t("menu.mark_all_read"), () => doMarkRead(ref))];
    if (ref.kind === "folder") {
      const f = view.tree.folders.get(ref.id);
      if (!f) return null;
      const preset = presetFor(ref, f.name);
      return [
        item("open_home", "home", t("menu.open_home"), () => select(ref)),
        item("mark_read", "check-all", t("menu.mark_read"), () => doMarkRead(ref)),
        /* @__PURE__ */ jsx55(ContextMenuSeparator, {}, "s1"),
        item("new_tab", "add", t("menu.new_tab"), () => preset && openDialog(DIALOG_IDS.tabEditor, { preset })),
        item("move", "folder-active", t("menu.move"), () => setMoving({ kind: "folder", id: f.id, name: f.name, current: f.parent_id ?? null }))
      ];
    }
    if (ref.kind === "channel") {
      const c = view.tree.channels.get(ref.id);
      if (!c) return null;
      const url = safeChannelUrl(c.url, c.id);
      return [
        item("open_home", "home", t("menu.open_home"), () => select(ref)),
        item("mark_read", "check-all", t("menu.mark_read"), () => doMarkRead(ref)),
        /* @__PURE__ */ jsx55(ContextMenuSeparator, {}, "s1"),
        c.favorite ? item("unfavorite", "star-empty", t("menu.unfavorite"), () => setFlag(c, "favorite", false, t("toast.favorite_off", { name: c.title }))) : item("favorite", "star-full", t("menu.favorite"), () => setFlag(c, "favorite", true, t("toast.favorite_on", { name: c.title }))),
        c.muted ? item("unmute", "bell", t("menu.unmute"), () => setFlag(c, "muted", false, t("toast.muted_off", { name: c.title }))) : item("mute", "bell-slash", t("menu.mute"), () => setFlag(c, "muted", true, t("toast.muted_on", { name: c.title }))),
        item("move", "folder-active", t("menu.move"), () => setMoving({ kind: "channel", id: c.id, name: c.title, current: c.folder_id ?? null })),
        /* @__PURE__ */ jsx55(ContextMenuSeparator, {}, "s2"),
        item("open_youtube", "link-external", t("menu.open_youtube"), () => void maybePluginContext()?.os?.openExternal?.(url))
      ];
    }
    return null;
  };
  const rowMenu = (name) => /* @__PURE__ */ jsx55(
    Button35,
    {
      variant: "ghost",
      size: "icon-xs",
      tabIndex: -1,
      "aria-label": t("row.menu", { name }),
      "data-part": "row-menu",
      onClick: (e) => {
        e.stopPropagation();
        openMenuFrom(e.currentTarget);
      },
      children: /* @__PURE__ */ jsx55(Codicon40, { name: "ellipsis", size: 14 })
    }
  );
  const searching = !!filtered;
  const isOpen = (key) => searching || expanded.has(key);
  const channelItem = (c, level) => {
    const ref = { kind: "channel", id: c.id };
    const key = nodeKey(ref);
    return /* @__PURE__ */ jsx55(
      TreeItem,
      {
        id: key,
        level,
        avatar: { title: c.title, thumb: c.thumb },
        label: /* @__PURE__ */ jsxs46(Fragment26, { children: [
          c.title,
          c.favorite ? /* @__PURE__ */ jsxs46(Fragment26, { children: [
            " ",
            /* @__PURE__ */ jsx55(Codicon40, { name: "star-full", size: 11 }),
            /* @__PURE__ */ jsx55("span", { className: cx("sr"), children: t("row.favorite") })
          ] }) : null,
          c.muted ? /* @__PURE__ */ jsxs46(Fragment26, { children: [
            " ",
            /* @__PURE__ */ jsx55(Codicon40, { name: "bell-slash", size: 11 }),
            /* @__PURE__ */ jsx55("span", { className: cx("sr"), children: t("row.muted") })
          ] }) : null
        ] }),
        count: counts ? counts[c.id] || null : null,
        selected: selected === key,
        onSelect: () => select(ref),
        onDropItem: (d) => onDrop(ref, d),
        dragData: dragData({ kind: "channel", id: c.id }),
        actions: rowMenu(c.title)
      },
      key
    );
  };
  const folderItem = (n, level) => {
    const ref = { kind: "folder", id: n.folder.id };
    const key = nodeKey(ref);
    const open = isOpen(key);
    const hasContent2 = n.children.length > 0 || n.channels.length > 0;
    return /* @__PURE__ */ jsx55(
      TreeItem,
      {
        id: key,
        level,
        label: n.folder.name,
        icon: open && hasContent2 ? "folder-opened" : "folder",
        count: byFolder?.get(n.folder.id) || null,
        expanded: hasContent2 ? open : void 0,
        onToggle: hasContent2 ? () => toggle(key) : void 0,
        selected: selected === key,
        onSelect: () => select(ref),
        onDropItem: (d) => onDrop(ref, d),
        dragData: dragData({ kind: "folder", id: n.folder.id }),
        actions: rowMenu(n.folder.name),
        children: open && hasContent2 ? [...n.children.map((k) => folderItem(k, level + 1)), ...n.channels.map((c) => channelItem(c, level + 1))] : void 0
      },
      key
    );
  };
  let body;
  const loadError = folders.error ?? channels.error;
  if (!view) {
    if (loadError) {
      const kind = failureKind2(loadError);
      body = /* @__PURE__ */ jsx55(
        ErrorView,
        {
          compact: true,
          error: loadError,
          title: kind === "unavailable" ? t("error.unavailable", { profile }) : kind === "offline" ? t("error.offline") : t("error.title"),
          description: kind === "unavailable" ? t("error.unavailable_hint", { profile }) : kind === "offline" ? t("error.offline_hint") : void 0,
          onRetry: () => {
            if (folders.error) void folders.refetch();
            if (channels.error) void channels.refetch();
          }
        }
      );
    } else body = /* @__PURE__ */ jsx55(PaneSkeleton, { label: t("tree.label") });
  } else if (!view.tree.roots.length && !view.tree.channels.size) {
    body = /* @__PURE__ */ jsx55(
      EmptyView,
      {
        compact: true,
        icon: "inbox",
        title: t("empty.title"),
        description: t("empty.description"),
        action: /* @__PURE__ */ jsx55(Button35, { size: "sm", onClick: () => openSection("home"), children: t("empty.action") })
      }
    );
  } else if (filtered && !filtered.matches) {
    body = /* @__PURE__ */ jsx55(
      EmptyView,
      {
        compact: true,
        icon: "search",
        title: t("search.empty_title", { query: query.trim() }),
        description: t("search.empty_desc"),
        action: /* @__PURE__ */ jsx55(Button35, { variant: "outline", size: "sm", onClick: () => setQuery(""), children: t("search.clear") })
      }
    );
  } else {
    const tree = filtered?.tree ?? view.tree;
    const grouped = view.tree.roots.length > 0;
    const unfiledCount = counts ? sum(tree.unfiled.map((c) => c.id), counts) : null;
    const unfiledOpen = isOpen("unfiled");
    body = /* @__PURE__ */ jsxs46(ContextMenu, { children: [
      /* @__PURE__ */ jsx55(ContextMenuTrigger, { asChild: true, children: /* @__PURE__ */ jsx55("div", { "data-part": "pane-tree", onContextMenu, onKeyDown: onTreeKeyDown, children: /* @__PURE__ */ jsxs46(Tree, { label: t("tree.label"), children: [
        searching ? null : /* @__PURE__ */ jsxs46(Fragment26, { children: [
          /* @__PURE__ */ jsx55(
            TreeItem,
            {
              id: "all",
              label: t("tree.all"),
              icon: "inbox",
              count: allCount || null,
              selected: selected === "all",
              onSelect: () => select({ kind: "all" }),
              onDropItem: (d) => onDrop({ kind: "all" }, d),
              actions: rowMenu(t("tree.all"))
            }
          ),
          /* @__PURE__ */ jsx55(TreeItem, { id: "later", label: t("tree.later"), icon: "clock", selected: selected === "later", onSelect: () => select({ kind: "later" }) })
        ] }),
        tree.roots.map((n) => folderItem(n, 1)),
        grouped ? tree.unfiled.length ? /* @__PURE__ */ jsx55(
          TreeItem,
          {
            id: "unfiled",
            label: t("tree.unfiled"),
            icon: "list-unordered",
            count: unfiledCount || null,
            expanded: unfiledOpen,
            onToggle: () => toggle("unfiled"),
            onSelect: () => toggle("unfiled"),
            onDropItem: (d) => onDrop({ kind: "unfiled" }, d),
            children: unfiledOpen ? tree.unfiled.map((c) => channelItem(c, 2)) : void 0
          }
        ) : null : tree.unfiled.map((c) => channelItem(c, 1))
      ] }) }) }),
      /* @__PURE__ */ jsx55(ContextMenuContent, { children: menuFor ? menuItems(menuFor) : null })
    ] });
  }
  const subscribed = (channels.data?.items ?? []).some((r) => r.channel.relation === "subscribed") ?? false;
  const banner = view && state.error ? /* @__PURE__ */ jsx55(Banner, { tone: "error", action: { label: t("banner.retry"), onClick: () => void state.refetch() }, children: t("banner.counts_failed") }) : st?.rss_down_since ? /* @__PURE__ */ jsx55(Banner, { tone: "warning", icon: "rss", children: t("banner.rss_down") }) : st && st.devices_online === 0 && subscribed ? /* @__PURE__ */ jsx55(
    Banner,
    {
      tone: "info",
      icon: "debug-disconnect",
      action: { label: t("banner.reconnect"), onClick: () => openDialog(DIALOG_IDS.onboarding, { step: "pair" }) },
      children: t("banner.ext_disconnected")
    }
  ) : null;
  const hasContent = !!view && (view.tree.roots.length > 0 || view.tree.channels.size > 0);
  const showSearch = !view || hasContent;
  return /* @__PURE__ */ jsxs46("div", { className: cx("page"), "data-part": "pane", ref: rootRef, children: [
    /* @__PURE__ */ jsxs46("div", { className: cx("pane-head"), "data-part": "pane-head", children: [
      /* @__PURE__ */ jsx55("span", { className: cx("pane-head-title"), role: "heading", "aria-level": 2, children: tc2("pane.title") }),
      view && allCount ? /* @__PURE__ */ jsx55("span", { className: cx("pane-head-count num"), "data-part": "pane-head-count", "aria-label": tc2("kit.tree.new_count", { count: fmt(allCount) }), children: fmt(allCount) }) : null,
      /* @__PURE__ */ jsx55(Tip5, { label: tc2("pane.open_page_tip"), children: /* @__PURE__ */ jsxs46("button", { type: "button", className: cx("pane-head-open"), "data-part": "pane-open-page", "aria-label": tc2("pane.open_page"), onClick: () => openSection("home"), children: [
        /* @__PURE__ */ jsx55(Codicon40, { name: "play-circle", size: 13 }),
        /* @__PURE__ */ jsx55("span", { className: cx("pane-head-open-label"), children: tc2("pane.open_page_short") }),
        /* @__PURE__ */ jsx55(Codicon40, { name: "arrow-right", size: 11 })
      ] }) })
    ] }),
    showSearch ? /* @__PURE__ */ jsx55("div", { className: cx("page-banner"), "data-part": "pane-search", children: /* @__PURE__ */ jsx55(
      SearchField2,
      {
        value: query,
        onChange: (next) => setQuery(next),
        placeholder: t("search.placeholder"),
        "aria-label": t("search.placeholder"),
        onKeyDown: (e) => {
          if (e.key === "ArrowDown") {
            const first = rootRef.current?.querySelector('[data-part="pane-tree"] [role="treeitem"]');
            if (first) {
              e.preventDefault();
              first.focus();
            }
          } else if (e.key === "Escape" && query) {
            e.preventDefault();
            setQuery("");
          }
        },
        ...query ? { onClear: () => setQuery("") } : {}
      }
    ) }) : null,
    banner ? /* @__PURE__ */ jsx55("div", { className: cx("page-banner"), children: banner }) : null,
    /* @__PURE__ */ jsx55("div", { className: cx("page-body"), "data-part": "pane-body", children: body }),
    moving && view ? /* @__PURE__ */ jsx55(
      MoveDialog,
      {
        subject: moving,
        tree: view.tree,
        onClose: () => setMoving(null),
        onPick: (dest) => moveTo({ kind: moving.kind, id: moving.id }, dest)
      }
    ) : null
  ] });
}
function PaneSkeleton({ label }) {
  return /* @__PURE__ */ jsx55("div", { "data-part": "pane-tree", "aria-busy": "true", children: /* @__PURE__ */ jsxs46(Tree, { label, children: [
    /* @__PURE__ */ jsx55(TreeItemSkeleton, {}),
    /* @__PURE__ */ jsx55(TreeItemSkeleton, {}),
    [0, 1, 2].map((i) => /* @__PURE__ */ jsx55(SkeletonFolder, { channels: i === 0 ? 2 : 1 }, i)),
    /* @__PURE__ */ jsx55(TreeItemSkeleton, {})
  ] }) });
}
function SkeletonFolder({ channels }) {
  return /* @__PURE__ */ jsxs46(Fragment26, { children: [
    /* @__PURE__ */ jsx55(TreeItemSkeleton, { level: 1 }),
    Array.from({ length: channels }, (_, i) => /* @__PURE__ */ jsx55(TreeItemSkeleton, { level: 2, avatar: true }, i))
  ] });
}

// desktop-src/panes/contribution.tsx
import { PALETTE_AREA, PANES_AREA, icons as icons2 } from "@hermes/plugin-sdk";
import { Fragment as Fragment27, jsx as jsx56 } from "react/jsx-runtime";
var PANE_SIZE = { width: "237px", minWidth: "10rem", maxWidth: "20rem" };
var DOCK_ANCHOR = "files";
var DOCK_MIGRATION_KEY = "pane.dock_migrated_v1";
var SHOW_PANE_COMMAND = "show-pane";
function takeDockMigration(ctx) {
  try {
    if (ctx.storage.get(DOCK_MIGRATION_KEY, false) === true) return false;
    ctx.storage.set(DOCK_MIGRATION_KEY, true);
    return true;
  } catch {
    return false;
  }
}
function PaneTabTitle() {
  const tc2 = useT();
  return /* @__PURE__ */ jsx56(Fragment27, { children: tc2("pane.title") });
}
function subscriptionsPane(render, opts) {
  return {
    id: PANE_ID,
    area: PANES_AREA,
    title: tNow("common", "pane.title"),
    data: {
      placement: "right",
      dock: { pane: DOCK_ANCHOR, pos: "center", ...opts.enforceDock ? { enforce: true } : {} },
      hideOnly: true,
      collapsible: true,
      ...PANE_SIZE,
      tabTitle: () => /* @__PURE__ */ jsx56(PaneTabTitle, {}),
      tabTitleText: () => tNow("common", "pane.title")
    },
    render
  };
}
function keywords() {
  const words = LOCALES.flatMap((loc) => (BUNDLES[loc].panes.palette?.show?.keywords ?? "").split(/\s+/));
  return [...new Set(words.filter(Boolean))];
}
function showPaneCommand() {
  if (!paneControlsAvailable()) return null;
  return {
    id: SHOW_PANE_COMMAND,
    area: PALETTE_AREA,
    data: {
      id: `${PLUGIN_ID}.${SHOW_PANE_COMMAND}`,
      label: tNow("panes", "palette.show.label"),
      icon: icons2.LayoutDashboard,
      keywords: keywords(),
      run: () => void showPane()
    }
  };
}

// desktop-src/pages/watch/index.tsx
import { Button as Button37, Codicon as Codicon42, MessageTextContent, useValue as useValue20 } from "@hermes/plugin-sdk";
import { useEffect as useEffect39, useInsertionEffect as useInsertionEffect2, useLayoutEffect as useLayoutEffect13, useRef as useRef41, useState as useState44 } from "react";

// desktop-src/pages/watch/actions.ts
import { atom as atom17, host as host26, useValue as useValue18 } from "@hermes/plugin-sdk";
var UNDO_MS6 = 7e3;
var ACTION_KEYS = { w: "watched", l: "later", e: "archive", u: "up", d: "down" };
var NAV_KEYS = { n: "next", j: "next", arrowright: "next", p: "prev", k: "prev", arrowleft: "prev" };
var $watchOverlay = atom17({});
var priors2 = /* @__PURE__ */ new Map();
onShellReset(() => {
  $watchOverlay.set({});
  priors2.clear();
});
function setLayer(id, layer) {
  const next = { ...$watchOverlay.get() };
  if (layer && Object.keys(layer).length) next[id] = layer;
  else delete next[id];
  $watchOverlay.set(next);
}
function applyWatchLayer(item, layer) {
  if (!layer) return item;
  const state = layer.state ?? item.state;
  return {
    ...item,
    state,
    reaction: layer.reaction !== void 0 ? layer.reaction : item.reaction,
    is_new: state !== "new" ? false : item.state === "new" ? item.is_new : layer.state === "new"
  };
}
function useWatchOverlay() {
  return useValue18($watchOverlay);
}
var send2 = (id, change) => restCall("POST /videos/state", { body: { video_ids: [id], ...change } });
function refreshAfterWrite() {
  void invalidateRest("GET /status", "GET /feed", "POST /feed/preview");
}
function runWatchAction(action, raw, t, tc2) {
  const id = raw.video.id;
  const prevLayer = $watchOverlay.get()[id];
  const current2 = applyWatchLayer(raw, prevLayer);
  const { change, toast, inverse, restore } = planVideoAction(priors2, action, id, current2);
  const applied = { ...prevLayer, ...asLayer(change) };
  const fail = (key, error) => host26.notify({ kind: "error", message: t(key, { error: errorText(tc2, toApiError(error)) }) });
  setLayer(id, applied);
  send2(id, change).then(
    () => {
      refreshAfterWrite();
      host26.notify({
        kind: "success",
        message: t(toast),
        durationMs: UNDO_MS6,
        action: {
          label: t("toast.undo"),
          onClick: () => {
            setLayer(id, { ...applied, ...asLayer(inverse) });
            send2(id, inverse).then(refreshAfterWrite, (error) => {
              setLayer(id, applied);
              fail("toast.undo_failed", error);
            });
          }
        }
      });
    },
    (error) => {
      if ($watchOverlay.get()[id] === applied) {
        setLayer(id, prevLayer);
        restore();
      }
      fail("toast.failed", error);
    }
  );
}
function plainKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return null;
  const el = e.target;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ""))) return null;
  return e.key.toLowerCase();
}

// desktop-src/pages/watch/queue.tsx
import { Button as Button36, Codicon as Codicon41, atom as atom18, host as host27, useValue as useValue19 } from "@hermes/plugin-sdk";
import { useEffect as useEffect38, useLayoutEffect as useLayoutEffect12, useRef as useRef40, useState as useState43 } from "react";
import { jsx as jsx57, jsxs as jsxs47 } from "react/jsx-runtime";
var $announce = atom18("");
onShellReset(() => {
  $announce.set("");
});
var titleOf = (it) => it.video.title || it.video.id;
function announce(text) {
  $announce.set(text);
}
function removeQueued(id, t) {
  const q = getQueue();
  if (!q) return false;
  const { queue, removed } = removeItem(q, id);
  if (!removed) return false;
  setQueue(queue);
  if (removed.wasCurrent && queue.current) playQueued(queue.current);
  const message = t("next.removed", { title: titleOf(removed.item) });
  announce(message);
  host27.notify({
    kind: "info",
    message,
    durationMs: UNDO_MS6,
    action: { label: t("toast.undo"), onClick: () => undoRemove(removed, t) }
  });
  return true;
}
function undoRemove(removed, t) {
  const q = getQueue();
  if (!q || q.serial !== removed.serial) return false;
  const back = restoreItem(q, removed);
  if (back === q) return false;
  setQueue(back);
  if (removed.wasCurrent) playQueued(removed.item.video.id);
  announce(t("next.restored", { title: titleOf(removed.item) }));
  return true;
}
function announceMove(q, id, t) {
  const i = indexOf(q, id);
  if (i >= 0) announce(t("next.moved", { title: titleOf(q.items[i]), index: i + 1, total: q.items.length }));
}
function moveQueued(id, delta, t) {
  const q = getQueue();
  if (!q) return false;
  const next = moveBy(q, id, delta);
  if (next === q) return false;
  setQueue(next);
  announceMove(next, id, t);
  return true;
}
function moveQueuedTo(from, to, t) {
  const q = getQueue();
  if (!q) return false;
  const next = moveItem(q, from, to);
  if (next === q) return false;
  setQueue(next);
  announceMove(next, q.items[from].video.id, t);
  return true;
}
function playNextQueued(id, t) {
  const q = getQueue();
  if (!q) return false;
  const next = playNext(q, id);
  if (next === q) return false;
  setQueue(next);
  const it = next.items[indexOf(next, id)];
  announce(t("next.queued_next", { title: titleOf(it) }));
  return true;
}
var EDGE_PX = 48;
var EDGE_SPEED = 16;
var ROW_SELECTOR = ':scope > [data-part="watch-next-item"]';
var nextFrame = (fn) => {
  if (typeof requestAnimationFrame === "function") {
    const h2 = requestAnimationFrame(fn);
    return () => cancelAnimationFrame(h2);
  }
  const h = setTimeout(fn, 16);
  return () => clearTimeout(h);
};
function useQueueDrag(list, scroller, onDrop) {
  const [view, setView] = useState43(null);
  const active = useRef40(null);
  const dropRef = useRef40(onDrop);
  dropRef.current = onDrop;
  useEffect38(() => () => active.current?.(), []);
  const start = (e, id, from) => {
    if (e.button > 0) return;
    const listEl = list.current;
    if (!listEl) return;
    e.preventDefault();
    active.current?.();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
    }
    const doc = listEl.ownerDocument;
    let y = e.clientY;
    let drop = null;
    let cancelFrame = null;
    const target = () => {
      const rows = [...listEl.querySelectorAll(ROW_SELECTOR)];
      let at = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          at = i;
          break;
        }
      }
      return at === from || at === from + 1 ? null : at;
    };
    const update = () => {
      const next = target();
      if (next === drop) return;
      drop = next;
      setView({ id, drop });
    };
    let last = 0;
    const tick = () => {
      cancelFrame = null;
      const sc = scroller.current;
      if (!sc) return;
      const now = Date.now();
      const frames = last ? Math.min(4, Math.max(1, (now - last) / 16)) : 1;
      last = now;
      const r = sc.getBoundingClientRect();
      const edge = Math.min(EDGE_PX, r.height / 4);
      let dy = 0;
      if (y < r.top + edge) dy = -Math.ceil(frames * EDGE_SPEED * Math.min(edge, r.top + edge - y) / edge);
      else if (y > r.bottom - edge) dy = Math.ceil(frames * EDGE_SPEED * Math.min(edge, y - (r.bottom - edge)) / edge);
      if (!dy) {
        last = 0;
        return;
      }
      const max = Math.max(0, sc.scrollHeight - sc.clientHeight);
      const to = Math.min(max, Math.max(0, sc.scrollTop + dy));
      if (to === sc.scrollTop) return;
      sc.scrollTop = to;
      update();
      cancelFrame = nextFrame(tick);
    };
    const onMove = (ev) => {
      y = ev.clientY;
      update();
      if (!cancelFrame) cancelFrame = nextFrame(tick);
    };
    const finish = (commit) => {
      stop();
      setView(null);
      if (commit && drop != null) dropRef.current(from, drop > from ? drop - 1 : drop);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (ev) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    const stop = () => {
      doc.removeEventListener("pointermove", onMove);
      doc.removeEventListener("pointerup", onUp);
      doc.removeEventListener("pointercancel", onCancel);
      doc.removeEventListener("keydown", onKey, true);
      cancelFrame?.();
      cancelFrame = null;
      if (active.current === stop) active.current = null;
    };
    doc.addEventListener("pointermove", onMove);
    doc.addEventListener("pointerup", onUp);
    doc.addEventListener("pointercancel", onCancel);
    doc.addEventListener("keydown", onKey, true);
    active.current = stop;
    setView({ id, drop: null });
  };
  return { view, start };
}
var rowButtonOf = (list, id) => list?.querySelector(`[data-part="watch-next-item"][data-video="${id}"] [data-part="watch-next-row"]`) ?? null;
function QueuePanel({ queue, t, seq: seq2, now }) {
  const overlay = useWatchOverlay();
  const locale = useLocale();
  const live = useValue19($announce);
  const listRef = useRef40(null);
  const scrollRef = useRef40(null);
  const focusAfter = useRef40(null);
  const drag = useQueueDrag(listRef, scrollRef, (from, to) => moveQueuedTo(from, to, t));
  const idx = queueIndex(queue);
  const total = queue.items.length;
  const prevItem = prevOf(queue);
  const nextItem = nextOf(queue);
  const nextId = nextItem?.video.id ?? null;
  const label = queue.origin?.label;
  const hintId = `watch-next-hint-${seq2}`;
  useLayoutEffect12(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    rowButtonOf(listRef.current, id)?.focus();
  });
  useEffect38(() => {
    const sc = scrollRef.current;
    const cur = queue.current;
    if (!sc || !cur || sc.scrollHeight <= sc.clientHeight) return;
    const row = sc.querySelector(`[data-part="watch-next-item"][data-video="${cur}"]`);
    if (!row) return;
    const top = row.offsetTop;
    if (top < sc.scrollTop || top + row.offsetHeight > sc.scrollTop + sc.clientHeight) sc.scrollTop = Math.max(0, top - row.offsetHeight);
  }, [seq2]);
  const remove = (it, i) => {
    const neighbour = queue.items[i + 1] ?? queue.items[i - 1];
    focusAfter.current = neighbour?.video.id ?? null;
    removeQueued(it.video.id, t);
  };
  const onRowKey = (e, it, i) => {
    if (e.metaKey || e.ctrlKey) return;
    const id = it.video.id;
    const vertical = e.key === "ArrowUp" || e.key === "ArrowDown";
    if (e.altKey) {
      if (!vertical) return;
      e.preventDefault();
      e.stopPropagation();
      focusAfter.current = id;
      moveQueued(id, e.key === "ArrowUp" ? -1 : 1, t);
      return;
    }
    if (e.shiftKey) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) remove(it, i);
      return;
    }
    if (vertical) {
      const to = queue.items[i + (e.key === "ArrowDown" ? 1 : -1)];
      if (!to) return;
      e.preventDefault();
      e.stopPropagation();
      rowButtonOf(listRef.current, to.video.id)?.focus();
    }
  };
  const dragging = drag.view;
  return /* @__PURE__ */ jsxs47("aside", { className: cx("watch-next"), "data-part": "watch-next", "aria-label": t("next.label"), children: [
    /* @__PURE__ */ jsxs47("div", { className: cx("watch-next-head"), children: [
      /* @__PURE__ */ jsx57("h2", { className: cx("watch-next-title t-head"), children: label ? t("next.from", { source: label }) : t("next.title") }),
      /* @__PURE__ */ jsxs47("div", { className: cx("watch-next-nav"), children: [
        idx >= 0 ? /* @__PURE__ */ jsx57("span", { className: cx("watch-next-pos t-label num"), "data-part": "watch-next-pos", children: t("next.position", { index: idx + 1, total }) }) : null,
        /* @__PURE__ */ jsx57(
          Button36,
          {
            variant: "ghost",
            size: "icon-xs",
            "data-part": "watch-prev",
            disabled: !prevItem,
            "aria-label": t("next.previous"),
            "aria-keyshortcuts": "p",
            title: `${t("next.previous")} · P`,
            onClick: () => prevItem && playQueued(prevItem.video.id),
            children: /* @__PURE__ */ jsx57(Codicon41, { name: "chevron-left", size: 14 })
          }
        ),
        /* @__PURE__ */ jsx57(
          Button36,
          {
            variant: "ghost",
            size: "icon-xs",
            "data-part": "watch-next-btn",
            disabled: !nextItem,
            "aria-label": t("next.next"),
            "aria-keyshortcuts": "n",
            title: `${t("next.next")} · N`,
            onClick: () => nextItem && playQueued(nextItem.video.id),
            children: /* @__PURE__ */ jsx57(Codicon41, { name: "chevron-right", size: 14 })
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxs47("div", { className: cx("watch-next-scroll"), "data-part": "watch-next-scroll", ref: scrollRef, children: [
      total === 0 ? /* @__PURE__ */ jsxs47("div", { className: cx("watch-next-empty"), "data-part": "watch-next-empty", children: [
        /* @__PURE__ */ jsx57("p", { className: cx("watch-next-empty-title t-body"), children: t("next.empty") }),
        /* @__PURE__ */ jsx57("p", { className: cx("watch-next-keys t-label"), children: t("next.empty_hint") })
      ] }) : /* @__PURE__ */ jsx57("ol", { className: cx("watch-next-list"), ref: listRef, "aria-label": t("next.list"), "data-dragging": dragging ? "true" : void 0, children: queue.items.map((it, i) => {
        const id = it.video.id;
        const v = applyWatchLayer(it, overlay[id]);
        const current2 = id === queue.current;
        const drop = dragging?.drop == null ? void 0 : dragging.drop === i ? "before" : dragging.drop === total && i === total - 1 ? "after" : void 0;
        return /* @__PURE__ */ jsxs47(
          "li",
          {
            className: cx("watch-next-item"),
            "data-part": "watch-next-item",
            "data-video": id,
            "data-state": v.state,
            "data-current": current2 ? "true" : "false",
            "data-dragging": dragging?.id === id ? "true" : void 0,
            "data-drop": drop,
            children: [
              /* @__PURE__ */ jsxs47("span", { className: cx("watch-next-grip"), "data-part": "watch-next-grip", "aria-hidden": "true", title: t("next.drag"), onPointerDown: (e) => drag.start(e, id, i), children: [
                /* @__PURE__ */ jsx57("span", { className: cx("watch-next-index t-label num"), children: current2 ? /* @__PURE__ */ jsx57(Codicon41, { name: "play", size: 12 }) : i + 1 }),
                /* @__PURE__ */ jsx57(Codicon41, { name: "gripper", size: 14, className: cx("watch-next-grip-icon") })
              ] }),
              /* @__PURE__ */ jsxs47(
                "button",
                {
                  type: "button",
                  className: cx("bare watch-next-row"),
                  "data-part": "watch-next-row",
                  "aria-current": current2 ? "true" : void 0,
                  "aria-describedby": hintId,
                  "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown Delete",
                  onClick: () => playQueued(id),
                  onKeyDown: (e) => onRowKey(e, it, i),
                  children: [
                    /* @__PURE__ */ jsx57("span", { className: cx("watch-next-thumb"), children: /* @__PURE__ */ jsx57(Thumb, { videoId: id, title: it.video.title, durationS: it.video.duration_s, watched: v.state === "watched", isShort: it.video.is_short }) }),
                    /* @__PURE__ */ jsxs47("span", { className: cx("watch-next-body"), children: [
                      /* @__PURE__ */ jsx57("span", { className: cx("watch-next-name t-body"), children: it.video.title }),
                      /* @__PURE__ */ jsx57("span", { className: cx("watch-next-sub t-label"), children: it.channel?.title ?? it.video.channel_title ?? "" }),
                      current2 ? /* @__PURE__ */ jsx57("span", { className: cx("watch-next-now t-label"), children: t("next.now_playing") }) : /* @__PURE__ */ jsx57("span", { className: cx("watch-next-when t-label num"), children: formatRelative(it.video.published_at, now ?? Date.now(), locale) })
                    ] })
                  ]
                }
              ),
              /* @__PURE__ */ jsxs47("span", { className: cx("watch-next-tools"), children: [
                current2 || id === nextId || idx < 0 ? null : /* @__PURE__ */ jsx57(
                  Button36,
                  {
                    variant: "ghost",
                    size: "icon-xs",
                    "data-part": "watch-next-playnext",
                    "aria-label": t("next.play_next"),
                    title: t("next.play_next"),
                    onClick: () => playNextQueued(id, t),
                    children: /* @__PURE__ */ jsx57(Codicon41, { name: "arrow-up", size: 14 })
                  }
                ),
                /* @__PURE__ */ jsx57(
                  Button36,
                  {
                    variant: "ghost",
                    size: "icon-xs",
                    "data-part": "watch-next-remove",
                    "aria-label": t("next.remove"),
                    title: `${t("next.remove")} · Delete`,
                    onClick: () => remove(it, i),
                    children: /* @__PURE__ */ jsx57(Codicon41, { name: "close", size: 14 })
                  }
                )
              ] })
            ]
          },
          id
        );
      }) }),
      total > 0 ? /* @__PURE__ */ jsxs47("div", { className: cx("watch-next-foot"), children: [
        /* @__PURE__ */ jsx57("p", { className: cx("watch-next-keys t-label"), id: hintId, children: t("next.edit_keys") }),
        /* @__PURE__ */ jsx57("p", { className: cx("watch-next-keys t-label"), children: nextItem || idx < 0 ? t("next.keys") : `${t("next.end")} ${t("next.keys")}` })
      ] }) : null
    ] }),
    /* @__PURE__ */ jsx57("p", { className: cx("watch-sr"), "data-part": "watch-next-live", role: "status", "aria-live": "polite", children: live })
  ] });
}

// desktop-src/pages/watch/styles.ts
var WATCH_CSS = `

/* root: the whole section scrolls; it is the query container (the page goes from ~320 px to full screen) */
.PFX_watch {
  height: 100%;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  color: var(--ui-text-primary);
  container-type: inline-size;
  container-name: PFX_watch;
  outline: none;
  /* the core's player width (640 px, height up to 1/3 of the window) */
  --PFX_watch-w: min(640px, calc(33dvh * 16 / 9));
  /* the queue column beside it takes the room the player cannot use (the player's size is the app's), up to this
     width, and the gap between the two */
  --PFX_watch-side: 640px;
  --PFX_watch-gap: var(--PFX_s5);
  /* the core draws its embed card with a 0.5rem margin above and below (inside our wrapper): the queue starts on
     the player's top line, not the wrapper's */
  --PFX_watch-embed-inset: 8px;
  /* room under the page's content (the queue beside the player stops above it: no page scroll for a short page) */
  --PFX_watch-pad-b: 48px;
}

/* --------------------------------------------------------------- the page: one box, one grid
   Behind its top, the video's own thumbnail, blurred and faint: the only color on the screen, changing with each
   video. It fades downward into the theme background (no fixed black: works in light and dark). */
.PFX_watch-page {
  position: relative;
  isolation: isolate;
  padding: var(--PFX_s4) var(--PFX_s5) var(--PFX_watch-pad-b);
}

.PFX_watch-ambient-clip {
  position: absolute;
  z-index: -1;
  top: 0;
  right: 0;
  left: 0;
  height: min(100%, calc(var(--PFX_watch-w) * 9 / 16 + 200px));
  overflow: hidden;
  pointer-events: none;
}

.PFX_watch[data-large='true'] .PFX_watch-ambient-clip {
  height: min(100%, 960px);
}

.PFX_watch-ambient {
  position: absolute;
  top: -20%;
  left: -10%;
  width: 120%;
  max-width: none; /* the app stylesheet caps images at 100%: here it bleeds on purpose */
  height: 120%;
  object-fit: cover;
  filter: blur(72px) saturate(1.4);
  opacity: 0.22;
  pointer-events: none;
  user-select: none;
  mask-image: linear-gradient(to bottom, black 20%, transparent 100%);
}

/* the grid, left-aligned in the section like its header (never centered). Narrow, or without a queue: one column
   exactly as wide as the player, so the line under it and the details share the player's edges; the queue goes
   under the player. The only side padding is the page's. */
.PFX_watch-layout {
  display: grid;
  grid-template-columns: minmax(0, var(--PFX_watch-w));
  grid-template-areas: 'player' 'foot' 'next' 'below';
  align-items: start;
  row-gap: var(--PFX_s3);
  column-gap: var(--PFX_watch-gap);
  min-width: 0;
}

.PFX_watch[data-large='true'] .PFX_watch-layout {
  grid-template-columns: minmax(0, 1fr);
  max-width: 1600px;
}

/* the player's column: the player sits at its start (its left edge is the details' left edge) */
.PFX_watch-stage {
  grid-area: player;
  display: flex;
  justify-content: flex-start;
  min-width: 0;
}

/* wrapper for the core's player. The width repeats the core's cap (640 px, height up to 1/3 of the window) so the
   player fills it at its own size; "Larger player" scales it with zoom (set by the screen). */
.PFX_watch-player {
  flex: none;
  width: var(--PFX_watch-w);
  max-width: 100%;
  min-width: 0;
}

/* under the player: one-time tip (left) and the discreet "Larger player" toggle (right) */
.PFX_watch-foot {
  grid-area: foot;
  display: flex;
  align-items: center;
  gap: var(--PFX_s3);
  min-width: 0;
  min-height: 28px;
  color: var(--PFX_fg3);
}

.PFX_watch-foot-spacer {
  flex: 1 1 auto;
}

/* multi-line when narrow: the icon sits on the first line, the button stays centered */
.PFX_watch-tip {
  display: flex;
  flex: 1 1 auto;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
  margin: 0;
  color: var(--ui-text-secondary);
}

.PFX_watch-tip-icon {
  flex: none;
  height: var(--PFX_lh-label);
  color: var(--PFX_fg3);
}

.PFX_watch .PFX_watch-tip > button {
  align-self: center;
}

.PFX_watch-tip-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.PFX_watch .PFX_watch-foot button {
  flex: none;
  color: var(--ui-text-secondary);
}

.PFX_watch .PFX_watch-foot button:hover {
  color: var(--ui-text-primary);
}

.PFX_watch .PFX_watch-larger[aria-pressed='true'] {
  background: color-mix(in srgb, var(--ui-base) 10%, transparent);
  color: var(--ui-text-primary);
}

/* the details: in the player's column, under the line */
.PFX_watch-below {
  grid-area: below;
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s4);
  min-width: 0;
  padding-top: var(--PFX_s1);
}

/* wide: the queue is a column of its own on the right, from the player's top line down, as tall as the section
   allows (the measured height, --PFX_watch-h; not the player's), scrolling inside and staying in view while the
   details scroll. The player's column keeps the core's width (it gives way first when the section narrows). */
@container PFX_watch (min-width: 820px) {
  .PFX_watch[data-queue='true'] .PFX_watch-layout {
    grid-template-columns: minmax(0, var(--PFX_watch-w)) minmax(300px, 1fr);
    grid-template-areas: 'player next' 'foot next' 'below next';
    grid-template-rows: auto auto 1fr;
    max-width: calc(var(--PFX_watch-w) + var(--PFX_watch-gap) + var(--PFX_watch-side));
    margin-inline: auto; /* what is left over on a very wide window is split between the two sides */
  }

  .PFX_watch[data-queue='true'][data-large='true'] .PFX_watch-layout {
    grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
    max-width: 1600px;
  }

  /* (scoped by the root: the narrow rule for the same box comes later in this sheet) */
  .PFX_watch .PFX_watch-next {
    position: sticky;
    top: var(--PFX_s4);
    margin-top: var(--PFX_watch-embed-inset);
    max-height: calc(var(--PFX_watch-h, 100dvh) - var(--PFX_s4) - var(--PFX_watch-embed-inset) - var(--PFX_watch-pad-b));
  }
}

@container PFX_watch (max-width: 480px) {
  .PFX_watch-page {
    padding: var(--PFX_s2) var(--PFX_s3) var(--PFX_s6);
  }

  .PFX_watch-title {
    font-size: 18px;
    line-height: 24px;
  }
}

/* --------------------------------------------------------------- what is ours */

.PFX_watch-info {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s3);
  min-width: 0;
}

/* the title is the largest text in the plugin: here the video is the subject of the whole screen */
.PFX_watch-title {
  margin: 0;
  color: var(--ui-text-primary);
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
  letter-spacing: -0.015em;
  text-wrap: balance;
  overflow-wrap: anywhere;
}

.PFX_watch-meta {
  display: flex;
  align-items: center;
  gap: var(--PFX_s3);
  min-width: 0;
}

.PFX_watch-byline {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.PFX_watch-byline-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px var(--PFX_s2);
  min-width: 0;
}

.PFX_watch-channel {
  color: var(--ui-text-primary);
  font-weight: 600;
  overflow-wrap: anywhere;
}

/* published · duration · views: the dot between them is drawn here */
.PFX_watch-facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  min-width: 0;
  color: var(--PFX_fg3);
}

.PFX_watch-facts > * + *::before {
  content: '·';
  margin: 0 6px;
  color: var(--ui-text-quaternary);
}

/* actions: one highlighted (monochrome: the highlight is contrast, not a color), the rest in groups with a rule */
.PFX_watch-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--PFX_s2);
  padding-top: var(--PFX_s1);
}

.PFX_watch .PFX_watch-primary {
  height: 32px;
  padding-inline: 14px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--ui-text-primary);
  color: var(--ui-bg-editor);
  font-weight: 600;
  transition:
    background-color var(--PFX_dur) var(--PFX_ease),
    color var(--PFX_dur) var(--PFX_ease),
    border-color var(--PFX_dur) var(--PFX_ease);
}

.PFX_watch .PFX_watch-primary:hover {
  background: color-mix(in srgb, var(--ui-text-primary) 86%, var(--ui-bg-editor));
  color: var(--ui-bg-editor);
}

/* already watched: the button steps back to an outline — the remaining action is undo */
.PFX_watch .PFX_watch-primary[aria-pressed='true'] {
  border-color: var(--ui-stroke-secondary);
  background: transparent;
  color: var(--ui-text-primary);
}

.PFX_watch .PFX_watch-primary[aria-pressed='true']:hover {
  background: color-mix(in srgb, var(--ui-base) 6%, transparent);
}

.PFX_watch-group {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  height: 32px;
  padding: 2px;
  border: 1px solid var(--ui-stroke-tertiary);
  border-radius: 999px;
}

.PFX_watch .PFX_watch-group > button {
  height: 26px;
  padding-inline: 10px;
  border-radius: 999px;
  color: var(--ui-text-secondary);
}

.PFX_watch .PFX_watch-group > button:hover {
  color: var(--ui-text-primary);
}

.PFX_watch .PFX_watch-group > button[data-icon-only='true'] {
  width: 30px;
  padding-inline: 0;
}

.PFX_watch .PFX_watch-group > button[aria-pressed='true'] {
  background: color-mix(in srgb, var(--ui-base) 10%, transparent);
  color: var(--ui-text-primary);
}

.PFX_watch-actions-end {
  display: flex;
  margin-left: auto;
}

.PFX_watch .PFX_watch-actions-end > button {
  height: 32px;
  border-radius: 999px;
  color: var(--ui-text-secondary);
}

.PFX_watch .PFX_watch-actions-end > button:hover {
  color: var(--ui-text-primary);
}

.PFX_watch-note {
  margin: 0;
  color: var(--ui-text-secondary);
}

/* description: collapsed to 3 lines; "Show more" opens */
.PFX_watch-desc {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--PFX_s1);
  padding: 14px var(--PFX_s4) 10px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--ui-base) 4%, transparent);
}

.PFX_watch-desc-text {
  margin: 0;
  color: var(--ui-text-secondary);
  line-height: 20px;
  white-space: pre-line;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}

.PFX_watch-desc[data-open='true'] .PFX_watch-desc-text {
  display: block;
  -webkit-line-clamp: unset;
  overflow: visible;
}

/* "Open videos: In Hermes | On YouTube" (the same setting as Home): a preference, not content — discreet footer */
.PFX_watch-mode {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--PFX_s2);
  padding-top: var(--PFX_s3);
  border-top: 1px solid var(--ui-stroke-tertiary);
  color: var(--PFX_fg3);
}

/* --------------------------------------------------------------- Up next: the queue */

/* narrow: under the player, a box of its own that scrolls inside (the details stay close) */
.PFX_watch-next {
  grid-area: next;
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s2);
  min-width: 0;
  min-height: 0;
  max-height: min(480px, calc(var(--PFX_watch-h, 100dvh) * 0.6));
}

.PFX_watch-next-scroll {
  position: relative; /* rows measure their offset from here (bringing the current one into view) */
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--PFX_s2);
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.PFX_watch-next-head {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--PFX_s2);
  min-height: 32px;
  min-width: 0;
}

.PFX_watch-next-title {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.005em;
}

/* position in the queue + previous/next: one piece */
.PFX_watch-next-nav {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 2px;
  height: 28px;
  padding: 0 2px 0 10px;
  border: 1px solid var(--ui-stroke-tertiary);
  border-radius: 999px;
}

.PFX_watch-next-pos {
  margin-right: 4px;
  color: var(--PFX_fg3);
  white-space: nowrap;
}

.PFX_watch-next-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.PFX_watch-next-list[data-dragging='true'] {
  cursor: grabbing;
  user-select: none;
}

/* a row: gutter (position, ▶ for the one playing, the drag handle on hover) + the clickable video */
.PFX_watch-next-item {
  position: relative;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: stretch;
  border-radius: 12px;
  transition:
    background-color var(--PFX_dur) var(--PFX_ease),
    opacity var(--PFX_dur) var(--PFX_ease);
}

.PFX_watch-next-item:hover {
  background: color-mix(in srgb, var(--ui-base) 5%, transparent);
}

.PFX_watch-next-item[data-current='true'] {
  background: color-mix(in srgb, var(--ui-base) 9%, transparent);
}

.PFX_watch-next-item[data-dragging='true'] {
  opacity: 0.45;
}

/* where the dragged row lands: a line between rows */
.PFX_watch-next-item[data-drop]::before {
  content: '';
  position: absolute;
  z-index: 1;
  right: 6px;
  left: 6px;
  height: 2px;
  border-radius: 1px;
  background: var(--ui-text-primary);
  pointer-events: none;
}

.PFX_watch-next-item[data-drop='before']::before {
  top: -1px;
}

.PFX_watch-next-item[data-drop='after']::before {
  bottom: -1px;
}

.PFX_watch-next-grip {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  color: var(--PFX_fg3);
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.PFX_watch-next-index {
  color: var(--PFX_fg3);
}

.PFX_watch-next-item[data-current='true'] .PFX_watch-next-index {
  color: var(--ui-text-primary);
}

.PFX_watch-next-grip-icon {
  display: none;
}

.PFX_watch-next-item:hover .PFX_watch-next-grip-icon,
.PFX_watch-next-item[data-dragging='true'] .PFX_watch-next-grip-icon {
  display: inline-flex;
}

.PFX_watch-next-item:hover .PFX_watch-next-index,
.PFX_watch-next-item[data-dragging='true'] .PFX_watch-next-index {
  display: none;
}

.PFX_watch-next-list[data-dragging='true'] .PFX_watch-next-item:not([data-dragging='true']) .PFX_watch-next-grip-icon {
  display: none;
}

.PFX_watch-next-list[data-dragging='true'] .PFX_watch-next-item:not([data-dragging='true']) .PFX_watch-next-index {
  display: inline;
}

.PFX_watch-next-row {
  display: grid;
  grid-template-columns: clamp(96px, 40%, 140px) minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  width: 100%;
  padding: 6px 8px 6px 2px;
  border-radius: 12px;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.PFX_watch-next-row:focus-visible {
  outline: 2px solid var(--PFX_ring);
  outline-offset: 1px;
}

.PFX_watch-next-thumb {
  display: block;
  min-width: 0;
}

.PFX_watch-next-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding-top: 1px;
}

.PFX_watch-next-name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: var(--ui-text-primary);
  font-weight: 550;
}

.PFX_watch-next-item[data-state='watched'] .PFX_watch-next-name {
  color: var(--ui-text-secondary);
}

.PFX_watch-next-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-secondary);
}

.PFX_watch-next-when {
  color: var(--PFX_fg3);
}

.PFX_watch-next-when:empty {
  display: none;
}

.PFX_watch-next-now {
  color: var(--ui-text-primary);
  font-weight: 600;
}

/* "Play next" and ✕: on hover or keyboard focus, over the row's top right corner */
.PFX_watch-next-tools {
  position: absolute;
  z-index: 2;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--ui-stroke-tertiary);
  border-radius: 999px;
  background: var(--ui-bg-editor);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--PFX_dur) var(--PFX_ease);
}

.PFX_watch-next-item:hover .PFX_watch-next-tools,
.PFX_watch-next-item:focus-within .PFX_watch-next-tools {
  opacity: 1;
  pointer-events: auto;
}

.PFX_watch-next-list[data-dragging='true'] .PFX_watch-next-tools {
  opacity: 0;
  pointer-events: none;
}

.PFX_watch .PFX_watch-next-tools > button {
  color: var(--ui-text-secondary);
}

.PFX_watch .PFX_watch-next-tools > button:hover {
  color: var(--ui-text-primary);
}

.PFX_watch-next-foot {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s1);
  padding: 0 var(--PFX_s2) var(--PFX_s2);
}

.PFX_watch-next-keys {
  margin: 0;
  color: var(--PFX_fg3);
}

.PFX_watch-next-empty {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s1);
  padding: var(--PFX_s4);
  border: 1px dashed var(--ui-stroke-tertiary);
  border-radius: 12px;
}

.PFX_watch-next-empty-title {
  margin: 0;
  color: var(--ui-text-secondary);
}

/* read by screen readers, not shown */
.PFX_watch-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
`;
var WATCH_STYLE_ATTR = `data-${CLASS_PREFIX}watch-styles`;
var ownerCtx3 = null;
var tokenSeq4 = 0;
onShellReset(() => {
  ownerCtx3 = null;
});
function ensureWatchStyles(doc = globalThis.document) {
  if (!doc?.head) return;
  const found = [...doc.head.querySelectorAll(`style[${WATCH_STYLE_ATTR}]`)];
  for (const extra of found.slice(1)) extra.remove();
  let el = found[0];
  if (!el) {
    el = doc.createElement("style");
    el.setAttribute(WATCH_STYLE_ATTR, "");
    doc.head.appendChild(el);
  }
  const css = resolveCss(WATCH_CSS);
  if (el.textContent !== css) el.textContent = css;
  const ctx = maybePluginContext();
  if (ctx && (ownerCtx3 !== ctx || el.getAttribute(WATCH_STYLE_ATTR) === "")) {
    ownerCtx3 = ctx;
    const token = `${Date.now().toString(36)}-${++tokenSeq4}`;
    el.setAttribute(WATCH_STYLE_ATTR, token);
    const style = el;
    ctx.onDispose(() => {
      if (style.isConnected && style.getAttribute(WATCH_STYLE_ATTR) === token) style.remove();
    });
  }
}

// desktop-src/pages/watch/index.tsx
import { Fragment as Fragment28, jsx as jsx58, jsxs as jsxs48 } from "react/jsx-runtime";
function WatchPage() {
  useInsertionEffect2(() => ensureWatchStyles(), []);
  const state = useValue20($watch);
  if (!state) return /* @__PURE__ */ jsx58(WatchEmpty, {});
  return /* @__PURE__ */ jsx58(WatchView, { state });
}
function WatchEmpty() {
  const t = useT("watch");
  return /* @__PURE__ */ jsx58("div", { className: cx("watch"), "data-part": "watch-empty", children: /* @__PURE__ */ jsx58(
    EmptyView,
    {
      icon: "play-circle",
      title: t("state.empty_title"),
      description: t("state.empty_desc"),
      action: /* @__PURE__ */ jsx58(Button37, { variant: "outline", size: "sm", onClick: () => closeWatch(), children: t("state.empty_action") })
    }
  ) });
}
var ZOOM_MAX = 3;
var STAGE_MAX_W = 1280;
var STAGE_H_FRAC = 0.62;
var STAGE_MIN_H = 200;
var LINK_MAX_H = 64;
var ZOOM_MAX_STEPS = 8;
function zoomSupported() {
  try {
    return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("zoom", "2");
  } catch {
    return false;
  }
}
function usePlayerZoom(enabled, root, lane, box, key) {
  const [zoom, setZoom] = useState44(1);
  const live = useRef41({ zoom: 1, sig: "", steps: 0 });
  useLayoutEffect13(() => {
    const st = live.current;
    if (!enabled) {
      st.zoom = 1;
      st.sig = "";
      st.steps = 0;
      setZoom(1);
      return;
    }
    const rootEl = root.current;
    const laneEl = lane.current;
    const boxEl = box.current;
    if (!rootEl || !laneEl || !boxEl || typeof ResizeObserver === "undefined" || !zoomSupported()) return;
    const measure2 = () => {
      const r = boxEl.getBoundingClientRect();
      const laneW = laneEl.clientWidth;
      const rootH = rootEl.clientHeight;
      if (r.width < 1 || r.height < 1 || laneW < 1 || rootH < 1) return;
      const rootBox = rootEl.getBoundingClientRect();
      if (r.bottom < rootBox.top || r.top > rootBox.bottom) return;
      const natW = r.width / st.zoom;
      const natH = r.height / st.zoom;
      const availW = Math.min(laneW, STAGE_MAX_W);
      const availH = Math.max(STAGE_MIN_H, rootH * STAGE_H_FRAC);
      const want = natH < LINK_MAX_H ? 1 : Math.min(ZOOM_MAX, Math.max(1, Math.min(availW / natW, availH / natH)));
      const next = Math.round(want * 200) / 200;
      if (Math.abs(next - st.zoom) < 0.01) return;
      const sig = `${laneW}x${rootH}`;
      if (sig !== st.sig) {
        st.sig = sig;
        st.steps = 0;
      }
      if (++st.steps > ZOOM_MAX_STEPS) return;
      st.zoom = next;
      setZoom(next);
    };
    const ro = new ResizeObserver(measure2);
    ro.observe(rootEl);
    ro.observe(laneEl);
    ro.observe(boxEl);
    measure2();
    return () => ro.disconnect();
  }, [enabled, root, lane, box, key]);
  return enabled ? zoom : 1;
}
function Ambient({ id }) {
  const extras = useExtras();
  const [failed, setFailed] = useState44(null);
  const src = thumbnailUrl(id, extras, "mq");
  if (failed === src) return null;
  return /* @__PURE__ */ jsx58("div", { className: cx("watch-ambient-clip"), "data-bleed": "", "aria-hidden": "true", children: /* @__PURE__ */ jsx58("img", { className: cx("watch-ambient"), "data-part": "watch-ambient", src, alt: "", decoding: "async", referrerPolicy: "no-referrer", onError: () => setFailed(src) }) });
}
function WatchView({ state, now, initialDescriptionOpen }) {
  useInsertionEffect2(() => ensureWatchStyles(), []);
  const t = useT("watch");
  const tc2 = useT();
  const overlay = useWatchOverlay();
  const rootRef = useRef41(null);
  const laneRef = useRef41(null);
  const boxRef = useRef41(null);
  const large = usePlayerFlag(LARGE_PLAYER_KEY);
  const zoom = usePlayerZoom(large, rootRef, laneRef, boxRef, state.id);
  const fetched = useRest("GET /videos", { query: { ids: state.id } }, { enabled: !state.item });
  const fetchedItem = state.item ? null : fetched.data?.items?.find((it) => it.video.id === state.id) ?? null;
  useEffect39(() => {
    if (fetchedItem) setWatchItem(fetchedItem);
  }, [fetchedItem]);
  const raw = state.item ?? fetchedItem;
  const item = raw ? applyWatchLayer(raw, overlay[raw.video.id]) : null;
  const phase = raw ? "ready" : fetched.error ? "error" : fetched.data ? "unknown" : "loading";
  const queue = useQueue();
  const prevItem = queue ? prevOf(queue) : null;
  const nextItem = queue ? nextOf(queue) : null;
  const go = (it) => {
    if (it) playQueued(it.video.id);
  };
  const run = (action) => {
    if (raw) runWatchAction(action, raw, t, tc2);
  };
  useEffect39(() => {
    const el = rootRef.current;
    if (!el) return;
    el.scrollTop = 0;
    el.focus({ preventScroll: true });
  }, [state.seq]);
  useLayoutEffect13(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const set = () => el.style.setProperty(cssVar("watch-h"), `${el.clientHeight}px`);
    const ro = new ResizeObserver(set);
    ro.observe(el);
    set();
    return () => ro.disconnect();
  }, []);
  const onKeyDown = (e) => {
    const key = plainKey(e);
    if (!key) return;
    const nav = NAV_KEYS[key];
    if (nav) {
      e.preventDefault();
      go(nav === "next" ? nextItem : prevItem);
      return;
    }
    if (key === "o") {
      e.preventDefault();
      openOnYouTube(state.id);
      return;
    }
    const action = ACTION_KEYS[key];
    if (action && raw) {
      e.preventDefault();
      run(action);
    }
  };
  const title = item?.video.title ?? "";
  return /* @__PURE__ */ jsxs48(Fragment28, { children: [
    /* @__PURE__ */ jsx58(
      "div",
      {
        ref: rootRef,
        className: cx("watch"),
        "data-part": "watch",
        "data-video": state.id,
        "data-large": large ? "true" : "false",
        "data-queue": queue ? "true" : "false",
        tabIndex: -1,
        "aria-label": title ? t("label", { title }) : t("tab.title"),
        onKeyDown,
        children: /* @__PURE__ */ jsxs48("div", { className: cx("watch-page"), children: [
          /* @__PURE__ */ jsx58(Ambient, { id: state.id }),
          /* @__PURE__ */ jsxs48("div", { className: cx("watch-layout"), "data-part": "watch-layout", children: [
            /* @__PURE__ */ jsx58("section", { className: cx("watch-stage"), "data-part": "watch-player", "aria-label": t("player.label"), ref: laneRef, children: /* @__PURE__ */ jsx58("div", { className: cx("watch-player"), ref: boxRef, "data-zoom": zoom, style: zoom === 1 ? void 0 : { zoom }, children: /* @__PURE__ */ jsx58(MessageTextContent, { text: youtubeWatchUrl(state.id) }) }, state.id) }),
            /* @__PURE__ */ jsx58(PlayerFoot, { t, large }),
            queue ? /* @__PURE__ */ jsx58(QueuePanel, { queue, t, seq: state.seq, now }) : null,
            /* @__PURE__ */ jsxs48("div", { className: cx("watch-below"), "data-part": "watch-below", children: [
              item ? /* @__PURE__ */ jsx58(Details, { item, now, t, tc: tc2, onAction: run, id: state.id, initialDescriptionOpen }, state.seq) : /* @__PURE__ */ jsx58(Missing, { phase, t, tc: tc2, id: state.id, error: fetched.error, onRetry: () => void fetched.refetch() }),
              /* @__PURE__ */ jsxs48("div", { className: cx("watch-mode t-label"), children: [
                /* @__PURE__ */ jsx58("span", { children: t("open_mode.label") }),
                /* @__PURE__ */ jsx58(OpenModeSwitch, {})
              ] })
            ] })
          ] })
        ] })
      }
    ),
    /* @__PURE__ */ jsx58(PlaylistPicker, {})
  ] });
}
function PlayerFoot({ t, large }) {
  const dismissed = usePlayerFlag(TIP_DISMISSED_KEY);
  return /* @__PURE__ */ jsxs48("div", { className: cx("watch-foot"), "data-part": "watch-foot", children: [
    dismissed ? /* @__PURE__ */ jsx58("span", { className: cx("watch-foot-spacer") }) : /* @__PURE__ */ jsxs48("p", { className: cx("watch-tip t-label"), "data-part": "watch-tip", children: [
      /* @__PURE__ */ jsx58(Codicon42, { name: "lightbulb", size: 12, className: cx("watch-tip-icon") }),
      /* @__PURE__ */ jsx58("span", { className: cx("watch-tip-text"), children: t("tip.always_allow") }),
      /* @__PURE__ */ jsx58(Button37, { variant: "ghost", size: "xs", "data-part": "watch-tip-dismiss", onClick: () => setPlayerFlag(TIP_DISMISSED_KEY, true), children: t("tip.dismiss") })
    ] }),
    /* @__PURE__ */ jsxs48(
      Button37,
      {
        variant: "ghost",
        size: "xs",
        className: cx("watch-larger"),
        "data-part": "watch-larger",
        "aria-pressed": large,
        title: t(large ? "player.larger_off_hint" : "player.larger_hint"),
        onClick: () => setPlayerFlag(LARGE_PLAYER_KEY, !large),
        children: [
          /* @__PURE__ */ jsx58(Codicon42, { name: large ? "screen-normal" : "screen-full", size: 12 }),
          t("player.larger")
        ]
      }
    )
  ] });
}
function Details({ id, item, now, t, tc: tc2, onAction, initialDescriptionOpen }) {
  const locale = useLocale();
  const [open, setOpen] = useState44(!!initialDescriptionOpen);
  const { video, channel } = item;
  const channelTitle = channel?.title ?? video.channel_title ?? "";
  const foldersQ = useRest("GET /folders", {}, { enabled: !!channel?.folder_id });
  const folderFound = channel?.folder_id ? foldersQ.data?.items?.find((f) => f.id === channel.folder_id) ?? null : null;
  const folder = folderFound && !(item.why?.via === "folder" && item.why.label === folderFound.name) ? folderFound : null;
  const when = formatRelative(video.published_at, now ?? Date.now(), locale);
  const duration = formatDuration(video.duration_s);
  const description = (video.description ?? "").trim();
  const watched = item.state === "watched";
  const toggle = (action, icon, labelKey, pressed, hint, key, iconOnly = false) => /* @__PURE__ */ jsxs48(
    Button37,
    {
      variant: "ghost",
      size: "sm",
      "data-watch-action": action,
      "data-icon-only": iconOnly ? "true" : void 0,
      "aria-label": iconOnly ? tc2(labelKey) : void 0,
      "aria-pressed": pressed,
      "aria-keyshortcuts": key,
      title: `${hint} · ${key.toUpperCase()}`,
      onClick: () => onAction(action),
      children: [
        /* @__PURE__ */ jsx58(Codicon42, { name: icon, size: 14 }),
        iconOnly ? null : tc2(labelKey)
      ]
    }
  );
  return /* @__PURE__ */ jsxs48("div", { className: cx("watch-info"), children: [
    /* @__PURE__ */ jsx58(Why, { why: item.why, subject: channelTitle }),
    /* @__PURE__ */ jsx58("h1", { className: cx("watch-title t-title"), "data-part": "watch-title", children: video.title }),
    /* @__PURE__ */ jsxs48("div", { className: cx("watch-meta"), "data-part": "watch-meta", children: [
      /* @__PURE__ */ jsx58(ChannelAvatar, { title: channelTitle, thumb: channel?.thumb, size: 32 }),
      /* @__PURE__ */ jsxs48("div", { className: cx("watch-byline"), children: [
        /* @__PURE__ */ jsxs48("div", { className: cx("watch-byline-top"), children: [
          /* @__PURE__ */ jsx58("span", { className: cx("watch-channel t-body"), children: channelTitle }),
          folder ? /* @__PURE__ */ jsx58(FolderChip, { folder }) : null
        ] }),
        /* @__PURE__ */ jsxs48("div", { className: cx("watch-facts t-label"), children: [
          when ? /* @__PURE__ */ jsx58(
            "time",
            {
              className: cx("num"),
              dateTime: video.published_at ? new Date(video.published_at * 1e3).toISOString() : void 0,
              title: video.published_at ? t("meta.published", { date: fullDate(video.published_at, locale) }) : void 0,
              children: when
            }
          ) : null,
          duration ? /* @__PURE__ */ jsx58("span", { className: cx("num"), title: t("meta.duration", { duration }), children: duration }) : null,
          video.views != null ? /* @__PURE__ */ jsx58("span", { className: cx("num"), children: t("meta.views", { count: formatCompact(video.views, locale) }) }) : null
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs48("div", { className: cx("watch-actions"), "data-part": "watch-actions", role: "group", "aria-label": t("actions.label"), children: [
      /* @__PURE__ */ jsxs48(
        Button37,
        {
          variant: "secondary",
          size: "sm",
          className: cx("watch-primary"),
          "data-watch-action": "watched",
          "aria-pressed": watched,
          "aria-keyshortcuts": "w",
          title: `${tc2(watched ? "kit.actions.watched_undo" : "kit.actions.watched_do")} · W`,
          onClick: () => onAction("watched"),
          children: [
            /* @__PURE__ */ jsx58(Codicon42, { name: watched ? "check" : "eye", size: 14 }),
            watched ? t("actions.watched") : t("actions.mark_watched")
          ]
        }
      ),
      /* @__PURE__ */ jsxs48("div", { className: cx("watch-group"), children: [
        toggle("later", "clock", "kit.actions.later", item.state === "later", tc2(item.state === "later" ? "kit.actions.later_undo" : "kit.actions.later_do"), "l"),
        toggle("archive", "archive", "kit.actions.archive", item.state === "archived", tc2(item.state === "archived" ? "kit.actions.archive_undo" : "kit.actions.archive_do"), "e")
      ] }),
      /* @__PURE__ */ jsxs48("div", { className: cx("watch-group"), children: [
        toggle("up", "thumbsup", "kit.actions.up", item.reaction === "up", tc2(item.reaction === "up" ? "kit.actions.up_undo" : "kit.actions.up_do"), "u", true),
        toggle("down", "thumbsdown", "kit.actions.down", item.reaction === "down", tc2(item.reaction === "down" ? "kit.actions.down_undo" : "kit.actions.down_do"), "d", true)
      ] }),
      /* @__PURE__ */ jsx58("div", { className: cx("watch-group"), children: /* @__PURE__ */ jsxs48(Button37, { variant: "ghost", size: "sm", "data-watch-action": "playlist", title: tc2("playlists.add"), onClick: () => openPlaylistPicker(item), children: [
        /* @__PURE__ */ jsx58(Codicon42, { name: "list-unordered", size: 14 }),
        tc2("playlists.add")
      ] }) }),
      /* @__PURE__ */ jsx58("span", { className: cx("watch-actions-end"), children: /* @__PURE__ */ jsx58(OpenOnYouTube, { id, t }) })
    ] }),
    description ? /* @__PURE__ */ jsxs48("div", { className: cx("watch-desc"), "data-part": "watch-desc", "data-open": open ? "true" : "false", children: [
      /* @__PURE__ */ jsx58("p", { className: cx("watch-desc-text t-body"), id: `watch-desc-${id}`, children: description }),
      /* @__PURE__ */ jsx58(
        Button37,
        {
          variant: "ghost",
          size: "xs",
          "data-part": "watch-desc-toggle",
          "aria-expanded": open,
          "aria-controls": `watch-desc-${id}`,
          onClick: () => setOpen((o) => !o),
          children: open ? t("description.less") : t("description.more")
        }
      )
    ] }) : null
  ] });
}
function OpenOnYouTube({ id, t }) {
  return /* @__PURE__ */ jsxs48(Button37, { variant: "ghost", size: "sm", "data-watch-action": "youtube", "aria-keyshortcuts": "o", title: `${t("player.note")} · O`, onClick: () => openOnYouTube(id), children: [
    /* @__PURE__ */ jsx58(Codicon42, { name: "link-external", size: 14 }),
    t("actions.open")
  ] });
}
function Missing({ id, phase, t, tc: tc2, error, onRetry }) {
  const part = phase === "error" ? "watch-error" : phase === "unknown" ? "watch-unknown" : "watch-loading";
  return /* @__PURE__ */ jsxs48("div", { className: cx("watch-info"), "data-part": part, "aria-busy": phase === "loading" ? "true" : void 0, children: [
    phase === "unknown" ? /* @__PURE__ */ jsxs48(Fragment28, { children: [
      /* @__PURE__ */ jsx58("h1", { className: cx("watch-title t-title"), children: t("state.unknown_title") }),
      /* @__PURE__ */ jsx58("p", { className: cx("watch-note t-body"), children: t("state.unknown_desc") })
    ] }) : phase === "error" ? /* @__PURE__ */ jsx58("p", { className: cx("watch-note t-body"), role: "alert", children: t("state.error", { error: errorText(tc2, toApiError(error)) }) }) : /* @__PURE__ */ jsx58("p", { className: cx("watch-note t-body"), role: "status", children: t("state.loading") }),
    /* @__PURE__ */ jsxs48("div", { className: cx("watch-actions"), "data-part": "watch-actions", children: [
      phase === "error" ? /* @__PURE__ */ jsxs48(Button37, { variant: "ghost", size: "sm", onClick: onRetry, children: [
        /* @__PURE__ */ jsx58(Codicon42, { name: "refresh", size: 14 }),
        t("state.retry")
      ] }) : null,
      /* @__PURE__ */ jsx58("span", { className: cx("watch-actions-end"), children: /* @__PURE__ */ jsx58(OpenOnYouTube, { id, t }) })
    ] })
  ] });
}
function fullDate(tsSeconds, locale) {
  const d = new Date(tsSeconds * 1e3);
  try {
    return new Intl.DateTimeFormat(locale || "en", { dateStyle: "medium" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

// desktop-src/main.tsx
import { Fragment as Fragment29, jsx as jsx59, jsxs as jsxs49 } from "react/jsx-runtime";
var PLUGIN_NAME = "HermesTube";
var DIALOGS = {
  onboarding: OnboardingDialog,
  "tab-editor": TabEditorDialog,
  organize: OrganizeDialog,
  theme: ThemeDialog,
  "list-import": ListImportDialog,
  history: HistoryDialog,
  "create-tab": CreateTabDialog
};
var SECTIONS = {
  home: HomePage,
  manage: ManagePage,
  cleanup: CleanupPage,
  extras: ExtrasPage,
  watch: WatchPage
};
function SinglePage() {
  return /* @__PURE__ */ jsx59(PluginGate, { children: /* @__PURE__ */ jsx59(ShellPage, { sections: SECTIONS }) });
}
var SECTION_RUNS = {
  [PALETTE_COMMANDS.openHome]: () => openSection("home"),
  [PALETTE_COMMANDS.cleanup]: () => openSection("cleanup"),
  [PALETTE_COMMANDS.openExtras]: () => openSection("extras"),
  [PALETTE_COMMANDS.organize]: () => {
    openSection("manage");
    openDialog(DIALOG_IDS.organize, {});
  },
  [PALETTE_COMMANDS.newThemeTab]: () => {
    openSection("home");
    openDialog(DIALOG_IDS.theme, {});
  }
};
function SectionChip() {
  return /* @__PURE__ */ jsx59("span", { style: { display: "contents" }, onClickCapture: () => showSection("home"), children: /* @__PURE__ */ jsx59(StatusChip, {}) });
}
var NAV_CODICON = "play-circle";
function withShell(Component) {
  return () => /* @__PURE__ */ jsxs49(Fragment29, { children: [
    /* @__PURE__ */ jsx59(ShellHost, {}),
    /* @__PURE__ */ jsx59(Component, {})
  ] });
}
function labelledContributions() {
  const route = {
    id: "route-home",
    area: ROUTES_AREA,
    title: tNow("common", "plugin_name"),
    order: 0,
    data: { path: DESKTOP_ROUTES.home },
    render: withShell(SinglePage)
  };
  const nav = {
    id: "nav-home",
    area: SIDEBAR_NAV_AREA,
    order: 0,
    data: { path: DESKTOP_ROUTES.home, label: tNow("common", "plugin_name"), codicon: NAV_CODICON }
  };
  const palette = paletteCommands().map((c, i) => ({
    id: c.id,
    area: PALETTE_AREA2,
    order: i,
    data: paletteContribution(SECTION_RUNS[c.id] ? { ...c, run: SECTION_RUNS[c.id] } : c)
  }));
  palette.push({ id: CONNECT_COMMAND, area: PALETTE_AREA2, order: palette.length, data: connectCommand(() => openSection("home")) });
  const showPane2 = showPaneCommand();
  if (showPane2) palette.push({ ...showPane2, order: palette.length });
  return [route, nav, ...palette];
}
function fixedContributions(ctx) {
  return [
    // tab next to Files/Review; the first load after this version re-docks users who already had the pane
    subscriptionsPane(withShell(SubscriptionsPane), { enforceDock: takeDockMigration(ctx) }),
    {
      id: STATUS_CHIP_ID,
      area: STATUSBAR_AREAS.right,
      order: 130,
      render: withShell(SectionChip)
    },
    {
      id: "chat-video-card",
      area: TRANSCRIPT_DIRECTIVE_AREA,
      data: {
        name: CHAT_DIRECTIVE,
        render: (props) => /* @__PURE__ */ jsx59(ChatVideoCard, { ...props })
      }
    }
  ];
}
function registerShell(ctx) {
  ctx.onDispose(mountStyles());
  setPluginContext(ctx);
  registerLocales(ctx);
  bindWindowVisibility(ctx);
  const disposeDialogs = registerDialogs(DIALOGS);
  configureShell({ mascotLines });
  ctx.onDispose(setWatchRenderer(() => /* @__PURE__ */ jsx59(WatchPage, {})));
  ctx.registerMany(fixedContributions(ctx));
  let disposeLabelled = ctx.registerMany(labelledContributions());
  ctx.i18n?.onLocaleChange?.(() => {
    disposeLabelled();
    disposeLabelled = ctx.registerMany(labelledContributions());
  });
  ctx.onDispose(() => {
    disposeDialogs();
    resetShellState();
  });
}
var plugin = {
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  description: "Organize your YouTube subscriptions with Hermes: folders, tabs, cleanup and topic tabs.",
  register: registerShell
};
var main_default = plugin;
export {
  DIALOGS,
  PLUGIN_NAME,
  main_default as default,
  registerShell
};
