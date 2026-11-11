// The plugin's component kit. Screens import from here; never from another screen.
// Visual language and API: docs/design/DESIGN.md. All visuals come from the plugin's own stylesheet (lib/style.ts);
// controls (button, input, menu, dialog, tooltip, badge, skeleton, switch, tabs) are the SDK's.

// structure
export { Banner, type BannerProps, type BannerTone, Page, type PageProps, Section, type SectionProps, Stack, type StackProps, Toolbar, type ToolbarProps } from './Page'
export { PageFrame, type PageFrameProps } from './PageFrame'
export { DialogFrame, type DialogFrameProps } from './DialogFrame'
export { DENSITIES, type Density, GRID_SHORTCUTS, Grid, type GridProps, GridSkeleton, type GridSkeletonProps, cardVariantFor } from './Grid'

// video
export { Thumb, type ThumbProps, ThumbSkeleton, VideoMark, type VideoMarkKind, type VideoMarkProps, hasVideoMark, spokenDuration, videoMarkKind } from './Thumb'
export { VideoCard, type VideoCardProps, VideoCardSkeleton, type VideoCardSkeletonProps, type VideoCardVariant } from './VideoCard'
export { type QuickAction, QuickActions, type QuickActionsProps, type StandardQuickActionHandlers, TIP_DELAY_MS, useStandardQuickActions } from './QuickActions'

// navigation
export {
  FilterBar,
  type FilterBarProps,
  ModeSwitch,
  type ModeSwitchProps,
  StatusBarItem,
  type StatusBarItemProps,
  TabBar,
  type TabBarItem,
  type TabBarProps,
  TabBarSkeleton,
  type TabMenuEntry
} from './nav'
export { BackButton, SECTION_KEYS, type SectionKey, SectionFrame, type SectionFrameProps, SectionNav, type SectionNavProps, type SectionScreens, ShellPage, WATCH_TAB_MAX } from './SectionNav'

// channel
export { ChannelAvatar, type ChannelAvatarProps, ChannelAvatarSkeleton } from './ChannelAvatar'
export { type ChannelColumn, ChannelRow, type ChannelRowProps, ChannelRowSkeleton, ChannelTable, type ChannelTableProps } from './ChannelRow'
export { ChipSkeleton, FolderChip, type FolderChipProps, TagChip, type TagChipProps } from './FolderChip'
export { Tree, TreeItem, type TreeItemProps, TreeItemSkeleton } from './Tree'

// AI flows
export {
  ApprovalCard,
  type ApprovalCardProps,
  ApprovalCardSkeleton,
  type Step,
  StepProgress,
  StepProgressSkeleton,
  type StepStatus,
  SuggestionGroup,
  type SuggestionGroupProps,
  SuggestionRow,
  type SuggestionRowProps,
  SuggestionRowSkeleton,
  type SuggestionStatus
} from './flows'

// boas-vindas
export {
  Hero,
  type HeroProps,
  PairingCode,
  type PairingCodeProps,
  PairingCodeSkeleton,
  type PairingStatus,
  PairingSteps,
  type PairingStepsProps,
  PathCard,
  type PathCardProps,
  PathCardSkeleton,
  PathGroup
} from './welcome'

// small pieces and states
export { Count, type CountProps, Dot, type DotTone, Stat, type StatProps, StatSkeleton, WHY_ICON, Why, type WhyProps } from './misc'
export { WhyBadge } from './WhyBadge'
export { EmptyView, type EmptyViewProps, ErrorView, LoadingState, QueryView, RpcUnavailableNotice } from './states'

// kit utilities (for screens that compose with the kit)
export { formatNumber, formatRelative, useFormatCount, useInGrid, useLocale, useUiLocale } from './kit'

// preview: type of the screen scenarios (`<screen>/preview.scenarios.tsx`; see docs/design/DESIGN.md §10)
export type { Scenario, ScenarioRequest, ScenarioValue } from './scenario'
