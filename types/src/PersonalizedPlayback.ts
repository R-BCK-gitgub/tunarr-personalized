import { z } from 'zod/v4';

export const PersonalizedPlaybackStrategySchema = z.enum([
  'normal',
  'random_all',
  'next_unwatched',
  'random_unwatched',
]);

export type PersonalizedPlaybackStrategy = z.infer<
  typeof PersonalizedPlaybackStrategySchema
>;

export const JellyfinChannelVisibilitySchema = z.enum([
  'all_users',
  'selected_users',
]);

export type JellyfinChannelVisibility = z.infer<
  typeof JellyfinChannelVisibilitySchema
>;

export const PersonalizedPlaybackConfigSchema = z.object({
  /**
   * Channel-wide playback strategy.
   *
   * normal:
   *   Keep Tunarr's existing live/scheduled behavior unchanged.
   *
   * random_all:
   *   Keep Tunarr's existing scheduler-selected episode behavior. This is the
   *   explicit "ignore watch state" choice and keeps the normal full EPG.
   *
   * next_unwatched:
   *   For the series selected by Tunarr's scheduler, resume a partially
   *   watched episode first. Otherwise play the chronologically next unwatched
   *   episode. If everything has been watched, fall back to a random episode
   *   from that same series.
   *
   * random_unwatched:
   *   For the series selected by Tunarr's scheduler, resume a partially
   *   watched episode first. Otherwise select a random unwatched episode. If
   *   everything has been watched, fall back to a random episode from that
   *   same series.
   */
  strategy: PersonalizedPlaybackStrategySchema.default('normal'),

  /**
   * Controls which Jellyfin account supplies watch/resume state.
   *
   * all_users uses the account configured on the Jellyfin media source.
   * selected_users uses the explicitly selected account below. A personalized
   * channel is intended to target a single Jellyfin user; the array shape is
   * retained for forwards compatibility with visibility filtering.
   */
  visibility: JellyfinChannelVisibilitySchema.default('all_users'),

  /**
   * Used when visibility === 'selected_users'. The first selected user is the
   * playback-state owner for this channel.
   */
  jellyfinUserIds: z.array(z.string()).default([]),

  /**
   * Do not write playback progress back to Jellyfin until the viewer has
   * remained on the program for this many seconds. This prevents quick channel
   * surfing from creating Continue Watching entries.
   */
  channelSurfGracePeriodSeconds: z.number().nonnegative().default(60),
});

export type PersonalizedPlaybackConfig = z.infer<
  typeof PersonalizedPlaybackConfigSchema
>;

export const DEFAULT_PERSONALIZED_PLAYBACK_CONFIG: PersonalizedPlaybackConfig =
  {
    strategy: 'normal',
    visibility: 'all_users',
    jellyfinUserIds: [],
    channelSurfGracePeriodSeconds: 60,
  };

export function usesSeriesOnlyGuide(
  strategy: PersonalizedPlaybackStrategy,
): boolean {
  return strategy === 'next_unwatched' || strategy === 'random_unwatched';
}
