-- Plugin SQLite schema — contract.
--
-- Rules:
--   * idempotent (IF NOT EXISTS / OR IGNORE): can be applied again over an existing database
--   * connection PRAGMAs (journal_mode=WAL, busy_timeout, foreign_keys=ON) belong to whoever opens
--     the connection (core/db.py), not to this file
--   * time = INTEGER, seconds since the Unix epoch (UTC); booleans = INTEGER 0/1
--   * JSON = TEXT checked by json_valid()
--   * additive evolution only: migrate_N in core/db.py + this file (meta.schema_version)
--   * the CHECK values are the same as the enums in plugin/core/types.py
--   * each table has one owner (its only writer): see the comment above each table

-- meta · key/value (schema version, last RSS run, RSS lock, own server port…)
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');

-- folders · TaxonomyService · nested folders
CREATE TABLE IF NOT EXISTS folders (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
    parent_id  TEXT REFERENCES folders (id) ON DELETE SET NULL,
    color      TEXT,
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders (parent_id, sort);

-- channels · ChannelService
CREATE TABLE IF NOT EXISTS channels (
    id              TEXT PRIMARY KEY
                    CHECK (length(id) = 24 AND substr(id, 1, 2) = 'UC'),
    handle          TEXT,            -- canonical: dedup.normalize_handle ('@' + casefold)
    title           TEXT NOT NULL DEFAULT '',
    thumb           TEXT,
    url             TEXT,
    relation        TEXT NOT NULL
                    CHECK (relation IN ('subscribed', 'followed', 'ex', 'ignored')),
    folder_id       TEXT REFERENCES folders (id) ON DELETE SET NULL,
    favorite        INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    muted           INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1)),
    source          TEXT NOT NULL
                    CHECK (source IN ('extension', 'link', 'demo', 'theme', 'list', 'mytube')),
    added_at        INTEGER NOT NULL,
    unsubscribed_at INTEGER,
    last_video_at   INTEGER,
    videos_per_week REAL,
    shorts_ratio    REAL CHECK (shorts_ratio IS NULL OR (shorts_ratio >= 0 AND shorts_ratio <= 1)),
    ai_note         TEXT,
    updated_at      INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_handle ON channels (handle) WHERE handle IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_channels_folder ON channels (folder_id);
CREATE INDEX IF NOT EXISTS idx_channels_relation ON channels (relation);
CREATE INDEX IF NOT EXISTS idx_channels_source ON channels (source);

-- tags · TaxonomyService
CREATE TABLE IF NOT EXISTS tags (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
    color      TEXT,
    created_at INTEGER NOT NULL
);

-- channel_tags · ChannelService
CREATE TABLE IF NOT EXISTS channel_tags (
    channel_id TEXT NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    tag_id     TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_tags_tag ON channel_tags (tag_id);

-- videos · VideoStore. No FK to channels: theme/HN/list videos may come from channels that are
-- not followed (channel_title keeps the name in that case).
CREATE TABLE IF NOT EXISTS videos (
    id            TEXT PRIMARY KEY CHECK (length(id) = 11),
    channel_id    TEXT NOT NULL,
    channel_title TEXT,
    title         TEXT NOT NULL DEFAULT '',
    description   TEXT,               -- media:description from the RSS feed
    published_at  INTEGER,
    duration_s    INTEGER CHECK (duration_s IS NULL OR duration_s >= 0),
    is_short      INTEGER CHECK (is_short IS NULL OR is_short IN (0, 1)),
    views         INTEGER CHECK (views IS NULL OR views >= 0),
    first_seen_at INTEGER NOT NULL,    -- set on the first insert only
    origin        TEXT NOT NULL CHECK (origin IN ('rss', 'search', 'hn', 'list')),  -- same
    updated_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_videos_channel_pub ON videos (channel_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_pub ON videos (published_at DESC);

-- video_state · VideoStateService · inbox; no row = new
CREATE TABLE IF NOT EXISTS video_state (
    video_id   TEXT PRIMARY KEY,
    state      TEXT NOT NULL DEFAULT 'new'
               CHECK (state IN ('new', 'seen', 'later', 'archived', 'watched')),
    reaction   TEXT CHECK (reaction IS NULL OR reaction IN ('up', 'down')),
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_video_state_state ON video_state (state, updated_at DESC);

-- watermarks · Refresher · "new" = published_at > seen_up_to
CREATE TABLE IF NOT EXISTS watermarks (
    channel_id TEXT PRIMARY KEY REFERENCES channels (id) ON DELETE CASCADE,
    seen_up_to INTEGER NOT NULL
);

-- tabs · TabService. rules = TabRules with include.lenses; filters = view state of the
-- interface (the engine ignores it).
CREATE TABLE IF NOT EXISTS tabs (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
    icon       TEXT,
    kind       TEXT NOT NULL CHECK (kind IN ('category', 'channels', 'theme', 'mixed')),
    rules      TEXT NOT NULL DEFAULT '{}'
               CHECK (json_valid(rules) AND json_type(rules) = 'object'
                      AND coalesce(json_type(rules, '$.include'), 'object') = 'object'
                      AND coalesce(json_type(rules, '$.include.lenses'), 'array') = 'array'
                      AND coalesce(json_type(rules, '$.exclude'), 'object') = 'object'
                      AND coalesce(json_type(rules, '$.filters'), 'object') = 'object'),
    filters    TEXT NOT NULL DEFAULT '{}'
               CHECK (json_valid(filters) AND json_type(filters) = 'object'),
    sort       INTEGER NOT NULL DEFAULT 0,
    builtin    INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- themes · Themes
CREATE TABLE IF NOT EXISTS themes (
    id             TEXT PRIMARY KEY,
    tab_id         TEXT REFERENCES tabs (id) ON DELETE SET NULL,
    query          TEXT NOT NULL,
    name           TEXT,
    icon           TEXT,
    searches       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(searches)),
    seeds          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(seeds)),
    include_terms  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(include_terms)),
    exclude_terms  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(exclude_terms)),
    last_search_at INTEGER,
    cadence_days   INTEGER NOT NULL DEFAULT 7 CHECK (cadence_days > 0),
    status         TEXT NOT NULL CHECK (status IN ('searching', 'preview', 'saved', 'error')),
    error          TEXT,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);

-- theme_items · Themes
CREATE TABLE IF NOT EXISTS theme_items (
    theme_id TEXT NOT NULL REFERENCES themes (id) ON DELETE CASCADE,
    video_id TEXT NOT NULL,
    reason   TEXT,
    score    REAL,
    source   TEXT NOT NULL CHECK (source IN ('search', 'classics', 'rss')),
    verdict  TEXT NOT NULL CHECK (verdict IN ('keep', 'cut', 'user_down')),
    PRIMARY KEY (theme_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_theme_items_video ON theme_items (video_id);

-- suggestions · Organizer · nothing is applied until accepted
CREATE TABLE IF NOT EXISTS suggestions (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('organize', 'cleanup', 'seed')),
    channel_id TEXT,
    payload    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
    status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
    model      TEXT,
    created_at INTEGER NOT NULL,
    decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions (kind, status, created_at);

-- cleanup_candidates · Cleanup · cleanup reasons (kept out of suggestions)
CREATE TABLE IF NOT EXISTS cleanup_candidates (
    id         TEXT PRIMARY KEY,
    scan_id    TEXT NOT NULL,
    channel_id TEXT NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    group_key  TEXT NOT NULL CHECK (group_key IN ('stale', 'ignored', 'off_profile', 'manual')),
    why        TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'dismissed')),
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cleanup_candidates_scan ON cleanup_candidates (scan_id, status);
CREATE INDEX IF NOT EXISTS idx_cleanup_candidates_channel ON cleanup_candidates (channel_id);

-- unsub_queue · Cleanup · only the extension consumes it, and only items a human approved.
-- approved_at/approved_via NOT NULL: no item exists without approval. No FK to channels
-- (the queue history survives a deleted channel).
CREATE TABLE IF NOT EXISTS unsub_queue (
    id           TEXT PRIMARY KEY,
    channel_id   TEXT NOT NULL,
    action       TEXT NOT NULL DEFAULT 'unsubscribe'
                 CHECK (action IN ('unsubscribe', 'resubscribe')),
    reason       TEXT,
    approved_at  INTEGER NOT NULL,
    approved_via TEXT NOT NULL CHECK (approved_via IN ('desktop_rpc', 'ask_choice')),
    status       TEXT NOT NULL DEFAULT 'approved'
                 CHECK (status IN ('approved', 'running', 'done', 'failed', 'undone')),
    error        TEXT,
    device_id    TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
-- at most one active item per channel and action
CREATE UNIQUE INDEX IF NOT EXISTS idx_unsub_queue_active
    ON unsub_queue (channel_id, action) WHERE status IN ('approved', 'running');
CREATE INDEX IF NOT EXISTS idx_unsub_queue_status ON unsub_queue (status, approved_at);

-- jobs · JobRunner · asynchronous AI jobs (event + GET /jobs/{id})
CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL
                CHECK (kind IN ('organize', 'cleanup_scan', 'theme', 'list_import', 'digest')),
    status      TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'running', 'done', 'error')),
    progress    TEXT CHECK (progress IS NULL OR json_valid(progress)),
    result      TEXT CHECK (result IS NULL OR json_valid(result)),
    error       TEXT CHECK (error IS NULL OR json_valid(error)),
    session_id  TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status, created_at);

-- search_jobs · Searcher · searches delegated to the extension; expire after 15 s (expires_at)
CREATE TABLE IF NOT EXISTS search_jobs (
    id           TEXT PRIMARY KEY,
    batch_id     TEXT NOT NULL,
    theme_id     TEXT,
    query        TEXT NOT NULL,
    search_order TEXT NOT NULL DEFAULT 'relevance' CHECK (search_order IN ('relevance', 'date')),
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'claimed', 'done', 'expired', 'failed')),
    payload      TEXT,                -- ytInitialData returned by the extension
    device_id    TEXT,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    completed_at INTEGER,
    CHECK (expires_at >= created_at)
);
CREATE INDEX IF NOT EXISTS idx_search_jobs_status ON search_jobs (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_search_jobs_batch ON search_jobs (batch_id);

-- watch_history · SyncIngest · from the extension tracker; resending is idempotent
CREATE TABLE IF NOT EXISTS watch_history (
    video_id   TEXT NOT NULL,
    channel_id TEXT,
    watched_at INTEGER NOT NULL,
    device_id  TEXT,
    PRIMARY KEY (video_id, watched_at)
);
CREATE INDEX IF NOT EXISTS idx_watch_history_channel ON watch_history (channel_id, watched_at);

-- changes · ChangeLog · history + undo; increasing integer id = order
CREATE TABLE IF NOT EXISTS changes (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        INTEGER NOT NULL,
    actor     TEXT NOT NULL CHECK (actor IN ('user', 'hermes', 'extension', 'routine')),
    action    TEXT NOT NULL,          -- ChangeAction (no CHECK: the list grows additively)
    group_id  TEXT,
    payload   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
    undo      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(undo)),
    undone_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_changes_group ON changes (group_id) WHERE group_id IS NOT NULL;

-- devices · DeviceAuth · pairing; only the token hash is stored
CREATE TABLE IF NOT EXISTS devices (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen  INTEGER,
    revoked_at INTEGER,
    origin     TEXT
);

-- pair_codes · DeviceAuth · 6-digit codes (hash only), single use
CREATE TABLE IF NOT EXISTS pair_codes (
    code_hash  TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER,
    device_id  TEXT
);

-- hn_videos · HN lens · optional extra; only filled when it is on
CREATE TABLE IF NOT EXISTS hn_videos (
    video_id   TEXT PRIMARY KEY,
    title      TEXT,
    channel    TEXT,
    channel_id TEXT,
    summary    TEXT,
    why        TEXT,
    topics     TEXT CHECK (topics IS NULL OR json_valid(topics)),
    categories TEXT CHECK (categories IS NULL OR json_valid(categories)),
    score      REAL
);
CREATE INDEX IF NOT EXISTS idx_hn_videos_channel ON hn_videos (channel_id);

-- list_imports · ListImporter · "import a list" previews
CREATE TABLE IF NOT EXISTS list_imports (
    id         TEXT PRIMARY KEY,
    url        TEXT NOT NULL,
    title      TEXT,
    payload    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
    tab_id     TEXT,
    created_at INTEGER NOT NULL
);
