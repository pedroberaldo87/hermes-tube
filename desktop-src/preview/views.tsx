// Reference compositions for the preview. PREVIEW ONLY: the real screens mount
// with the kit. The goal here is to see the language applied with realistic data.
import { Button, Codicon, Kbd } from '@hermes/plugin-sdk'
import { type ReactNode, useState } from 'react'
import {
  ApprovalCard,
  ApprovalCardSkeleton,
  Banner,
  ChannelAvatar,
  ChannelAvatarSkeleton,
  ChannelRow,
  ChannelRowSkeleton,
  ChannelTable,
  ChipSkeleton,
  Count,
  type Density,
  DialogFrame,
  Dot,
  EmptyView,
  ErrorView,
  FilterBar,
  FolderChip,
  Grid,
  GridSkeleton,
  Hero,
  LoadingState,
  ModeSwitch,
  Page,
  PairingCode,
  PairingCodeSkeleton,
  PairingSteps,
  PathCard,
  PathCardSkeleton,
  PathGroup,
  QuickActions,
  RpcUnavailableNotice,
  Section,
  Stack,
  Stat,
  StatSkeleton,
  StepProgress,
  StepProgressSkeleton,
  SuggestionGroup,
  SuggestionRow,
  SuggestionRowSkeleton,
  TabBar,
  TabBarSkeleton,
  TagChip,
  Thumb,
  ThumbSkeleton,
  Toolbar,
  Tree,
  TreeItem,
  TreeItemSkeleton,
  VideoCard,
  VideoCardSkeleton,
  type VideoCardVariant,
  Why,
  cardVariantFor,
  useStandardQuickActions
} from '../components'
import type { FeedItem } from '../../shared/api-types'
import { useT } from '../lib/i18n'
import { TubeApiError } from '../lib/rest'
import { cx } from '../lib/style'
import {
  CHANNELS,
  CLEANUP,
  FEATURED,
  FEED,
  FOLDERS,
  LAST_VIDEO,
  NEW_BY_CHANNEL,
  NOW,
  ORGANIZE,
  PROGRESS,
  TABS,
  THEME_FEED,
  TAGS,
  avatarOf,
  channelById,
  folderById,
  tagsOf
} from './data'

export const VIEW_IDS = ['gallery', 'home', 'home-compact', 'home-list', 'manage', 'cleanup', 'theme', 'welcome', 'pane', 'chat'] as const
export type ViewId = (typeof VIEW_IDS)[number]

export const VIEW_TITLES: Record<ViewId, string> = {
  gallery: 'Kit gallery',
  home: 'Subscriptions · comfortable',
  'home-compact': 'Subscriptions · compact',
  'home-list': 'Subscriptions · list',
  manage: 'Manage',
  cleanup: 'Cleanup',
  theme: 'New topic tab',
  welcome: 'Welcome',
  pane: 'Side pane',
  chat: 'Card in chat'
}

/** Frame of each composition: full page, side pane or chat column. */
export const VIEW_FRAME: Record<ViewId, 'page' | 'pane' | 'chat'> = {
  gallery: 'page',
  home: 'page',
  'home-compact': 'page',
  'home-list': 'page',
  manage: 'page',
  cleanup: 'page',
  theme: 'page',
  welcome: 'page',
  pane: 'pane',
  chat: 'chat'
}

// ------------------------------------------------------------------ Home

function CardActions({ item, onDone }: { item: FeedItem; onDone: (id: string, action: string) => void }) {
  const actions = useStandardQuickActions({
    watched: () => onDone(item.video.id, 'watched'),
    later: () => onDone(item.video.id, 'later'),
    archive: () => onDone(item.video.id, 'archive'),
    state: item.state
  })
  return <QuickActions actions={actions} />
}

function HomeView({ density: initial }: { density: Density }) {
  const [tab, setTab] = useState('all')
  const [density, setDensity] = useState<Density>(initial)
  const [query, setQuery] = useState('')
  const [feed, setFeed] = useState(FEED.slice(2))
  const remove = (id: string, action: string) => {
    if (action === 'archive') setFeed((f) => f.filter((x) => x.video.id !== id))
    else setFeed((f) => f.map((x) => (x.video.id === id ? { ...x, state: action === 'watched' ? 'watched' : 'later' } : x)))
  }
  const variant: VideoCardVariant = cardVariantFor(density)
  return (
    <Page
      title="Subscriptions"
      subtitle="38 new · updated 2 min ago"
      actions={
        <>
          <Button variant="ghost" size="sm">
            <Codicon name="sparkle" size={14} />
            Extras
          </Button>
          <Button variant="outline" size="sm">
            <Codicon name="refresh" size={14} />
            Refresh
          </Button>
          <Button size="sm">
            <Codicon name="add" size={14} />
            New tab
          </Button>
        </>
      }
      toolbar={<TabBar tabs={TABS} value={tab} onChange={setTab} onAdd={() => undefined} />}
      banner={
        <Banner tone="warning" action={{ label: 'Try again', onClick: () => undefined }}>
          The YouTube feed is down; showing what we already have.
        </Banner>
      }
    >
      <Toolbar end={<ModeSwitch value={density} onChange={setDensity} />}>
        <FilterBar query={query} onQueryChange={setQuery} placeholder="Search this tab">
          <FolderChip folder={{ id: 'tech', name: 'Tecnologia' }} onClick={() => undefined} />
          <TagChip tag={{ id: 'ai', name: 'ia' }} active onClick={() => undefined} />
        </FilterBar>
      </Toolbar>
      {density !== 'list' ? (
        <Section title="Featured">
          <VideoCard item={FEATURED} variant="featured" now={NOW} actions={<CardActions item={FEATURED} onDone={() => undefined} />} />
        </Section>
      ) : null}
      <Section title="New" count={feed.length}>
        <Grid
          items={feed}
          getKey={(it) => it.video.id}
          label="New"
          density={density}
          onAction={(a, it) => remove(it.video.id, a)}
          renderItem={(it) => (
            <VideoCard item={it} variant={variant} now={NOW} progress={PROGRESS[it.video.id]} actions={<CardActions item={it} onDone={remove} />} />
          )}
        />
      </Section>
      <Section title="Loading the next page">
        <GridSkeleton density={density} rows={density === 'list' ? 2 : 1} />
      </Section>
    </Page>
  )
}

// ------------------------------------------------------------------ Manage

function ManageView() {
  const [selected, setSelected] = useState<Set<string>>(new Set(['UCddiUEpeqJcYeBxX1IVBKvQ', 'UCLXo7UDZvByw2ixzpQCufnA', 'UCknLrEdhRCp1aegoMqRaCZg']))
  const [favs, setFavs] = useState(new Set(CHANNELS.filter((c) => c.favorite).map((c) => c.id)))
  const [folder, setFolder] = useState<string | null>(null)
  const rows = CHANNELS.filter((c) => !folder || c.folder_id === folder).slice(0, 14)
  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }
  return (
    <Page
      title="Manage subscriptions"
      subtitle={`${CHANNELS.length} channels · 6 folders · 4 tags`}
      actions={
        <>
          <Button variant="ghost" size="sm">
            <Codicon name="history" size={14} />
            History
          </Button>
          <Button size="sm">
            <Codicon name="sparkle" size={14} />
            Organize with Hermes
          </Button>
        </>
      }
      toolbar={
        <Toolbar end={<span className={cx('t-label')}>{selected.size} selected</span>}>
          <FilterBar query="" onQueryChange={() => undefined} placeholder="Search channel or @handle" resultCount={rows.length}>
            {FOLDERS.map((f) => (
              <FolderChip key={f.id} folder={f} active={folder === f.id} onClick={() => setFolder(folder === f.id ? null : f.id)} />
            ))}
          </FilterBar>
        </Toolbar>
      }
    >
      <Toolbar
        end={
          <>
            <Button variant="ghost" size="xs">
              <Codicon name="folder" size={13} />
              Move to folder
            </Button>
            <Button variant="ghost" size="xs">
              <Codicon name="add" size={13} />
              Create tab from selection
            </Button>
            <Button variant="outline" size="xs">
              <Codicon name="trash" size={13} />
              Propose unsubscribing
            </Button>
          </>
        }
      >
        <Stack direction="row" gap={2}>
          <Count value={selected.size} />
          <span className={cx('t-body')}>in the selection</span>
        </Stack>
      </Toolbar>
      <ChannelTable label="Channels" selectable>
        {rows.map((c) => (
          <ChannelRow
            key={c.id}
            channel={{ ...c, favorite: favs.has(c.id) }}
            folder={folderById(c.folder_id)}
            tags={tagsOf(c)}
            newCount={NEW_BY_CHANNEL[c.id]}
            lastVideo={LAST_VIDEO[c.id] ?? null}
            now={NOW}
            selected={selected.has(c.id)}
            onSelect={() => setSelected((s) => toggle(s, c.id))}
            onToggleFavorite={() => setFavs((s) => toggle(s, c.id))}
            actions={
              <Button variant="ghost" size="icon-xs" aria-label="More">
                <Codicon name="kebab-vertical" size={14} />
              </Button>
            }
          />
        ))}
        <ChannelRowSkeleton />
        <ChannelRowSkeleton />
      </ChannelTable>
    </Page>
  )
}

// ------------------------------------------------------------------ Cleanup

const GROUP_TITLE = { stale: 'Inactive', ignored: "You don't watch", off_profile: 'Off your profile' } as const

function CleanupView() {
  const [approved, setApproved] = useState(false)
  return (
    <Page
      title="Cleanup"
      subtitle="Last scan 3 days ago · suggested by claude-sonnet"
      actions={
        <Button variant="outline" size="sm">
          <Codicon name="refresh" size={14} />
          Scan again
        </Button>
      }
      banner={
        <Banner tone="info" icon="debug-disconnect" action={{ label: 'Reconnect', onClick: () => undefined }}>
          Extension disconnected: approvals stay queued until the browser is back.
        </Banner>
      }
    >
      <Stack direction="row" gap={6} wrap>
        <Stat label="Subscriptions" value={CHANNELS.length} />
        <Stat label="Candidates" value={6} hint="in 3 groups" />
        <Stat label="Queued" value={approved ? 3 : 0} />
        <Stat label="Former subscriptions" value={11} hint="resubscribe any time" />
      </Stack>
      <ApprovalCard
        title="Unsubscribe from 3 channels in “You don't watch”"
        description="Done by the extension in your browser, one channel at a time, with a pause between them."
        effects={CLEANUP.ignored.map((r) => `Unsubscribe from ${channelById(r.channel).title}`)}
        confirmLabel={approved ? 'Queued' : 'Unsubscribe from 3 channels'}
        busy={approved}
        onConfirm={() => setApproved(true)}
        onCancel={() => setApproved(false)}
      >
        <Stack direction="row" gap={1}>
          {CLEANUP.ignored.map((r) => (
            <ChannelAvatar key={r.channel} title={channelById(r.channel).title} thumb={channelById(r.channel).thumb} size={24} />
          ))}
        </Stack>
      </ApprovalCard>
      {(Object.keys(CLEANUP) as Array<keyof typeof CLEANUP>).map((g) => (
        <SuggestionGroup key={g} title={GROUP_TITLE[g]} count={CLEANUP[g].length} model="claude-sonnet" onAcceptAll={() => undefined}>
          {CLEANUP[g].map((r, i) => (
            <SuggestionRow
              key={r.channel}
              subject={channelById(r.channel).title}
              avatar={avatarOf(r.channel)}
              target={<span className={cx('t-label')}>unsubscribe</span>}
              reason={r.reason}
              status={g === 'ignored' && approved ? 'accepted' : i === 1 && g === 'stale' ? 'rejected' : 'pending'}
              onAccept={() => undefined}
              onReject={() => undefined}
            />
          ))}
        </SuggestionGroup>
      ))}
      <SuggestionGroup title="Loading the next scan">
        <SuggestionRowSkeleton />
        <SuggestionRowSkeleton />
      </SuggestionGroup>
    </Page>
  )
}

// ------------------------------------------------------------------ New theme tab (dialog)

function ThemeView() {
  return (
    <DialogFrame
      title="New topic tab"
      description="Hermes searches YouTube and HN, curates and shows a preview before saving."
      size="xl"
      onClose={() => undefined}
      footer={
        <>
          <Button variant="outline" size="sm">
            Cancel
          </Button>
          <Button size="sm">
            <Codicon name="save" size={14} />
            Save as tab and folder
          </Button>
        </>
      }
    >
      <Stack direction="row" gap={2} align="center" wrap>
        <Codicon name="sparkle" size={14} />
        <span className={cx('t-head')}>Agentes de IA</span>
        <span className={cx('t-label')}>· topic · refreshes every 7 days</span>
      </Stack>
      <StepProgress
        label="Progress"
        steps={[
          { id: 'expand', label: 'Understand the topic', status: 'done', detail: '6 search terms' },
          { id: 'search', label: 'Search videos', status: 'done', detail: '40 of 40' },
          { id: 'curate', label: 'Curate with AI', status: 'running', detail: '18 of 40 rated' },
          { id: 'preview', label: 'Build the preview', status: 'waiting' }
        ]}
      />
      <Section title="Preview" count={THEME_FEED.length} description="Seed channels: Andrej Karpathy, 3Blue1Brown, Two Minute Papers">
        <Grid
          items={THEME_FEED}
          getKey={(it) => it.video.id}
          label="Topic preview"
          density="compact"
          renderItem={(it) => <VideoCard item={it} variant="compact" now={NOW} />}
        />
      </Section>
      <SuggestionGroup title="Follow seed channels" count={2} model="claude-sonnet" onAcceptAll={() => undefined}>
        {ORGANIZE[0].rows.map((r) => (
          <SuggestionRow
            key={r.channel}
            subject={channelById(r.channel).title}
            avatar={avatarOf(r.channel)}
            target="Inteligência artificial"
            reason={r.reason}
            confidence={r.confidence}
            onAccept={() => undefined}
            onReject={() => undefined}
          />
        ))}
      </SuggestionGroup>
    </DialogFrame>
  )
}

// ------------------------------------------------------------------ Welcome

function WelcomeView() {
  const t = useT()
  return (
    <Page narrow>
      <Hero icon="play" title={t('kit.welcome.title')} tagline={t('kit.welcome.tagline')} description="Organize the channels you follow into folders and tabs, see only what is new and let Hermes help with the cleanup." />
      <PathGroup label="How to start">
        <PathCard
          primary
          recommended
          icon="plug"
          title="Connect the extension"
          description="Brings all your subscriptions and the browser history, no password."
          actionLabel="Pair now"
          onAction={() => undefined}
          hint="1 min"
        />
        <PathCard
          icon="link"
          title="Paste a channel"
          description="Paste a channel link or an @handle to follow without the extension."
          actionLabel="Paste link"
          onAction={() => undefined}
        />
        <PathCard
          icon="beaker"
          title="Demo mode"
          description="40 real public channels in 6 folders, to explore before connecting."
          actionLabel="Load demo"
          onAction={() => undefined}
        />
      </PathGroup>
      <Section title="Pair the extension" description="Takes a minute. The code is valid for 5 minutes and only works on this computer.">
        <PairingSteps code="482913" expiresAt={Date.now() + 4 * 60_000 + 37_000} onRegenerate={() => undefined} status="waiting" />
      </Section>
      <Section title="After pairing">
        <PairingSteps code="482913" expiresAt={Date.now() + 4 * 60_000 + 37_000} status="paired" />
      </Section>
    </Page>
  )
}

// ------------------------------------------------------------------ Side pane

function PaneView() {
  const [open, setOpen] = useState<Set<string>>(new Set(['tech', 'science']))
  const [sel, setSel] = useState('UCsBjURrPoezykLs9EqgamOA')
  return (
    <div className={cx('stack')} data-gap="2">
      <Banner tone="warning" icon="debug-disconnect">
        Extension disconnected.
      </Banner>
      <Tree label="Subscriptions">
        <TreeItem id="all" label="All" icon="inbox" count={38} selected={sel === 'all'} onSelect={() => setSel('all')} />
        <TreeItem id="later" label="Watch later" icon="clock" selected={sel === 'later'} onSelect={() => setSel('later')} />
        {FOLDERS.map((f) => {
          const channels = CHANNELS.filter((c) => c.folder_id === f.id)
          const count = channels.reduce((n, c) => n + (NEW_BY_CHANNEL[c.id] ?? 0), 0)
          return (
            <TreeItem
              key={f.id}
              id={f.id}
              label={f.name}
              icon="folder"
              count={count}
              expanded={open.has(f.id)}
              onToggle={() =>
                setOpen((s) => {
                  const n = new Set(s)
                  if (n.has(f.id)) n.delete(f.id)
                  else n.add(f.id)
                  return n
                })
              }
              onDropItem={() => undefined}
            >
              {channels.map((c) => (
                <TreeItem
                  key={c.id}
                  id={c.id}
                  level={2}
                  label={c.title}
                  avatar={{ title: c.title, thumb: c.thumb }}
                  count={NEW_BY_CHANNEL[c.id]}
                  selected={sel === c.id}
                  onSelect={() => setSel(c.id)}
                  dragData={c.id}
                />
              ))}
            </TreeItem>
          )
        })}
        <TreeItemSkeleton level={1} />
        <TreeItemSkeleton level={2} avatar />
      </Tree>
    </div>
  )
}

// ------------------------------------------------------------------ Chat card

function ChatView() {
  const item = FEED[3]
  return (
    <div className={cx('stack')} data-gap="3">
      <p className={cx('t-body')}>You asked for this week's new music videos. This is the one that best matches what you watch:</p>
      <VideoCard item={item} variant="row" now={NOW} actions={<CardActions item={item} onDone={() => undefined} />} />
      <p className={cx('t-body')}>Veritasium, your favorite, also posted one:</p>
      <VideoCard item={FEATURED} variant="row" now={NOW} actions={<CardActions item={FEATURED} onDone={() => undefined} />} />
      <p className={cx('t-body')}>If you prefer the large thumbnail, the grid variant is capped at ~360 px in chat:</p>
      <VideoCard item={FEED[0]} variant="grid" now={NOW} />
      <VideoCardSkeleton variant="row" />
    </div>
  )
}

// ------------------------------------------------------------------ Gallery

function GalleryBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section title={title}>
      <div className={cx('stack')} data-gap="4">
        {children}
      </div>
    </Section>
  )
}

const pairs = (variant: VideoCardVariant) => (
  <div className={cx('grid')} data-density={variant === 'row' ? 'list' : variant === 'compact' ? 'compact' : 'comfortable'}>
    <div className={cx('grid-row')}>
      <VideoCard item={{ ...FEED[2], badges: ['hn'] }} variant={variant} now={NOW} progress={0.4} />
    </div>
    <div className={cx('grid-row')}>
      <VideoCardSkeleton variant={variant} />
    </div>
    <div className={cx('grid-row')}>
      <VideoCard item={{ ...FEED[9], state: 'watched', is_new: false }} variant={variant} now={NOW} progress={1} />
    </div>
  </div>
)

function GalleryView() {
  const [density, setDensity] = useState<Density>('comfortable')
  const err = new TubeApiError({ code: 'llm_unavailable', message: 'no model' })
  return (
    <Page title="Kit gallery" subtitle="Every component in every state — sample data">
      <GalleryBlock title="Typography (4 levels)">
        <span className={cx('t-title')}>Title · 17/24 · 600</span>
        <span className={cx('t-head')}>Heading · 14/20 · 600</span>
        <span className={cx('t-body')}>Body · 13/18 · 400 — metadata on one line with · and figures 0123456789</span>
        <span className={cx('t-label')}>Label · 12/16 · 450 — 1,905,521 views · 3 days ago</span>
      </GalleryBlock>
      <GalleryBlock title="Thumb">
        <div className={cx('grid')} data-density="compact">
          <Thumb videoId="KfODG5REyss" durationS={3955} isNew />
          <Thumb videoId="NiCgcUTL9_Q" durationS={1922} progress={0.6} />
          <Thumb videoId="nEaJMdM1djM" durationS={296} watched progress={1} />
          <Thumb videoId="rL0qEmTRI-I" durationS={58} isShort />
          <Thumb videoId="VMj-3S1tku0" durationS={8822} badges={['hn']} />
          <Thumb videoId="KfODG5REyss" src="https://i.ytimg.com/vi/xxxxxxxxxxx/none.jpg" title="Failure" />
          <ThumbSkeleton />
        </div>
      </GalleryBlock>
      <GalleryBlock title="VideoCard · grid (final, skeleton, watched)">{pairs('grid')}</GalleryBlock>
      <GalleryBlock title="VideoCard · compact">{pairs('compact')}</GalleryBlock>
      <GalleryBlock title="VideoCard · row">{pairs('row')}</GalleryBlock>
      <GalleryBlock title="VideoCard · featured">
        <VideoCard item={FEATURED} variant="featured" now={NOW} actions={<CardActions item={FEATURED} onDone={() => undefined} />} />
        <VideoCardSkeleton variant="featured" actions />
      </GalleryBlock>
      <GalleryBlock title="QuickActions">
        <QuickActions
          actions={[
            { id: 'watched', label: 'Visto', icon: 'eye', shortcut: 'w', onSelect: () => undefined },
            { id: 'later', label: 'Later', icon: 'clock', shortcut: 'l', onSelect: () => undefined, pressed: true },
            { id: 'archive', label: 'Archive', icon: 'archive', shortcut: 'e', onSelect: () => undefined }
          ]}
        />
      </GalleryBlock>
      <GalleryBlock title="TabBar · ModeSwitch · FilterBar">
        <TabBar tabs={TABS} value="tech" onChange={() => undefined} onAdd={() => undefined} />
        <TabBarSkeleton count={5} />
        <Toolbar end={<ModeSwitch value={density} onChange={setDensity} />}>
          <FilterBar query="rust" onQueryChange={() => undefined} resultCount={12} onClear={() => undefined}>
            <FolderChip folder={{ id: 'tech', name: 'Tecnologia' }} count={12} active onClick={() => undefined} />
            <TagChip tag={TAGS[0]} onRemove={() => undefined} />
          </FilterBar>
        </Toolbar>
      </GalleryBlock>
      <GalleryBlock title="Channel · avatar, chips, table row">
        <Stack direction="row" gap={2} wrap>
          <ChannelAvatar title="Veritasium" thumb={channelById('UCHnyfMqiRRG1u-2MsSQLbXA').thumb} size={32} />
          <ChannelAvatar title="Kurzgesagt" thumb={channelById('UCsXVk37bltHxD1rDPwtNM8Q').thumb} size={32} />
          <ChannelAvatar title="/noclip" thumb={null} size={32} />
          <ChannelAvatar title="CGP Grey" thumb="https://yt3.googleusercontent.com/invalid-avatar=s88" size={32} />
          <ChannelAvatarSkeleton size={32} />
          <FolderChip folder={{ id: 'science', name: 'Ciência' }} />
          <FolderChip folder={{ id: 'tech', name: 'Tecnologia' }} count={8} active onClick={() => undefined} />
          <TagChip tag={TAGS[1]} />
          <TagChip tag={TAGS[3]} onClick={() => undefined} onRemove={() => undefined} />
          <ChipSkeleton />
        </Stack>
        <ChannelTable label="Channels">
          {CHANNELS.slice(8, 11).map((c) => (
            <ChannelRow
              key={c.id}
              channel={c}
              folder={folderById(c.folder_id)}
              tags={tagsOf(c)}
              newCount={NEW_BY_CHANNEL[c.id]}
              lastVideo={LAST_VIDEO[c.id] ?? null}
              now={NOW}
              onToggleFavorite={() => undefined}
            />
          ))}
          <ChannelRowSkeleton />
        </ChannelTable>
      </GalleryBlock>
      <GalleryBlock title="AI flows">
        <StepProgress
          label="Steps"
          steps={[
            { id: 'a', label: 'Done', status: 'done', detail: '6 terms' },
            { id: 'b', label: 'Running', status: 'running', detail: '18/40' },
            { id: 'c', label: 'Waiting', status: 'waiting' },
            { id: 'd', label: 'Failed', status: 'failed', detail: 'model unavailable' }
          ]}
        />
        <StepProgressSkeleton count={3} />
        <SuggestionGroup title="Inteligência artificial" count={2} model="claude-sonnet" onAcceptAll={() => undefined} onRejectAll={() => undefined}>
          <SuggestionRow
            subject="Two Minute Papers"
            avatar={avatarOf('UCbfYPyITQ-7l4upoX8nvctg')}
            target="Inteligência artificial"
            reason="Weekly summaries of AI papers"
            model="claude-sonnet"
            confidence={0.94}
            onAccept={() => undefined}
            onReject={() => undefined}
          />
          <SuggestionRow subject="Andrej Karpathy" avatar={avatarOf('UCXUPKJO5MZQN11PqgIvyuvQ')} target="Inteligência artificial" reason="Long lectures" status="accepted" />
          <SuggestionRow subject="The Verge" avatar={avatarOf('UCddiUEpeqJcYeBxX1IVBKvQ')} target="Notícias" reason="Tech news" status="rejected" />
          <SuggestionRowSkeleton />
        </SuggestionGroup>
        <ApprovalCard
          title="Unsubscribe from 2 channels"
          description="The dismiss button never uses the action's verb."
          effects={['Unsubscribe from The Verge', 'Unsubscribe from DW News']}
          confirmLabel="Unsubscribe from 2 channels"
          onConfirm={() => undefined}
          onCancel={() => undefined}
        />
        <ApprovalCardSkeleton effects={2} />
      </GalleryBlock>
      <GalleryBlock title="Boas-vindas">
        <Hero icon="play" title="Welcome" tagline="Your subscriptions. Your way." />
        <PathGroup>
          <PathCard primary recommended icon="plug" title="Connect the extension" description="Brings your subscriptions." actionLabel="Pair" onAction={() => undefined} hint={<Kbd>P</Kbd>} />
          <PathCard icon="link" title="Paste a channel" description="Link or @handle." actionLabel="Paste" onAction={() => undefined} />
          <PathCardSkeleton />
        </PathGroup>
        <Stack direction="row" gap={6} wrap align="start">
          <PairingCode code="482913" expiresAt={Date.now() + 299_000} />
          <PairingCode code="771204" expiresAt={Date.now() - 1000} onRegenerate={() => undefined} />
          <PairingCodeSkeleton />
        </Stack>
        <PairingSteps code="482913" expiresAt={Date.now() + 299_000} />
        <PairingSteps code="482913" expiresAt={Date.now() + 299_000} status="paired" />
      </GalleryBlock>
      <GalleryBlock title="Small pieces">
        <Stack direction="row" gap={6} wrap>
          <Stat label="New" value={38} hint="since yesterday" />
          <Stat label="Channels" value={1204} />
          <StatSkeleton />
        </Stack>
        <Stack direction="row" gap={3} wrap align="center">
          <Count value={12} tone="new" />
          <Count value={1204} />
          <Dot tone="new" label="new" />
          <Dot tone="neutral" label="neutral" />
          <Dot tone="success" label="ok" />
          <Dot tone="warning" label="warning" />
          <Dot tone="error" label="error" />
        </Stack>
        <Why why={{ via: 'folder', label: 'Ciência', detail: null }} />
        <Why why={{ via: 'theme', label: 'Agentes de IA', detail: 'cited 3× in the searches' }} />
        <Why why={{ via: 'hn', label: 'HN: best starting point for backprop', detail: null }} />
      </GalleryBlock>
      <GalleryBlock title="Banner">
        <Banner tone="info" title="Tip" action={{ label: 'See', onClick: () => undefined }} onDismiss={() => undefined}>
          Use j/k to move through the grid and w/l/e for watched, later and archive.
        </Banner>
        <Banner tone="warning" action={{ label: 'Try again', onClick: () => undefined }}>
          The YouTube feed is down; showing what we already have.
        </Banner>
        <Banner tone="error" title="Something went wrong" action={{ label: 'Try again', onClick: () => undefined }}>
          The extension did not respond.
        </Banner>
      </GalleryBlock>
      <GalleryBlock title="Estados">
        <EmptyView icon="inbox" title="Nothing new in this tab" description="New videos from this folder's channels show up here." action={<Button size="sm">See all tabs</Button>} />
        <ErrorView error={err} onRetry={() => undefined} compact />
        <LoadingState />
        <RpcUnavailableNotice />
        <GridSkeleton density="compact" rows={1} />
      </GalleryBlock>
    </Page>
  )
}

export function renderView(id: ViewId): ReactNode {
  switch (id) {
    case 'gallery':
      return <GalleryView />
    case 'home':
      return <HomeView density="comfortable" />
    case 'home-compact':
      return <HomeView density="compact" />
    case 'home-list':
      return <HomeView density="list" />
    case 'manage':
      return <ManageView />
    case 'cleanup':
      return <CleanupView />
    case 'theme':
      return <ThemeView />
    case 'welcome':
      return <WelcomeView />
    case 'pane':
      return <PaneView />
    case 'chat':
      return <ChatView />
  }
}
