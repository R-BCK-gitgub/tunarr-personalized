import type { ProgramAndTimeElapsed } from '@/stream/StreamProgramCalculator.js';
import { MediaSourceApiFactory } from '@/external/MediaSourceApiFactory.js';
import { MediaSourceDB } from '@/db/mediaSourceDB.js';
import type { IChannelDB } from '@/db/interfaces/IChannelDB.js';
import type { IProgramDB } from '@/db/interfaces/IProgramDB.js';
import type { ChannelOrm } from '@/db/schema/Channel.js';
import type {
  ProgramOrmWithExternalIds,
  ProgramWithRelationsOrm,
} from '@/db/schema/derivedTypes.js';
import { KEYS } from '@/types/inject.js';
import { InjectLogger } from '@/util/inject.js';
import { isNonEmptyString } from '@/util/index.js';
import type { Logger } from '@/util/logging/LoggerFactory.js';
import type { JellyfinItem } from '@tunarr/types/jellyfin';
import { inject, injectable } from 'inversify';
import { chunk } from 'lodash-es';
import { choosePersonalizedEpisode } from './personalizedPlaybackSelector.ts';

type ResolvedSlot = {
  programUuid: string;
  resumePositionMs: number;
  resolvedAtMs: number;
};

type PlaybackState = {
  program: ProgramWithRelationsOrm;
  played: boolean;
  positionMs: number;
  lastPlayedAtMs: number;
};

const MAX_JELLYFIN_IDS_PER_REQUEST = 100;

/**
 * Resolves the concrete Jellyfin episode for a personalized channel after the
 * normal Tunarr scheduler has already selected the series/slot. This keeps all
 * native slot, block, weighting, cycling and ordering behaviour intact.
 */
@injectable()
export class PersonalizedPlaybackService {
  @InjectLogger() declare private readonly logger: Logger;

  private readonly resolvedSlots = new Map<string, ResolvedSlot>();

  constructor(
    @inject(KEYS.ChannelDB) private readonly channelDB: IChannelDB,
    @inject(KEYS.ProgramDB) private readonly programDB: IProgramDB,
    @inject(MediaSourceDB) private readonly mediaSourceDB: MediaSourceDB,
    @inject(MediaSourceApiFactory)
    private readonly mediaSourceApiFactory: MediaSourceApiFactory,
  ) {}

  async resolve(
    channel: ChannelOrm,
    scheduled: ProgramAndTimeElapsed,
    requestTimeMs: number,
  ): Promise<ProgramAndTimeElapsed> {
    const config = channel.personalizedPlayback;
    if (
      !config ||
      config.strategy === 'normal' ||
      config.strategy === 'random_all' ||
      scheduled.program.type !== 'program' ||
      scheduled.program.program.type !== 'episode' ||
      scheduled.program.program.sourceType !== 'jellyfin'
    ) {
      return scheduled;
    }

    const scheduledProgram = scheduled.program.program;
    if (
      !isNonEmptyString(scheduledProgram.tvShowUuid) ||
      !isNonEmptyString(scheduledProgram.mediaSourceId)
    ) {
      return scheduled;
    }

    const slotKey = `${channel.uuid}:${scheduled.program.programBeginMs}`;
    const cached = this.resolvedSlots.get(slotKey);
    if (cached) {
      const cachedProgram = await this.findCandidateByUuid(
        channel.uuid,
        scheduledProgram.tvShowUuid,
        scheduledProgram.mediaSourceId,
        cached.programUuid,
      );
      if (cachedProgram) {
        return this.replaceScheduledProgram(
          scheduled,
          cachedProgram,
          cached.resumePositionMs,
          Math.max(0, requestTimeMs - cached.resolvedAtMs),
        );
      }
      this.resolvedSlots.delete(slotKey);
    }

    try {
      const allPrograms = await this.channelDB.getChannelPrograms(
        channel.uuid,
        undefined,
        'episode',
      );
      const candidates = allPrograms.results.filter(
        (program) =>
          program.sourceType === 'jellyfin' &&
          program.mediaSourceId === scheduledProgram.mediaSourceId &&
          program.tvShowUuid === scheduledProgram.tvShowUuid &&
          program.state === 'ok',
      );

      if (candidates.length === 0) {
        return scheduled;
      }

      const mediaSource = await this.mediaSourceDB.getById(
        scheduledProgram.mediaSourceId,
      );
      if (!mediaSource || mediaSource.type !== 'jellyfin') {
        return scheduled;
      }

      const selectedUserId =
        config.visibility === 'selected_users'
          ? config.jellyfinUserIds.find(isNonEmptyString)
          : mediaSource.userId;

      if (!isNonEmptyString(selectedUserId)) {
        this.logger.warn(
          'Personalized playback is enabled for channel %s but no Jellyfin user is available. Using scheduled playback.',
          channel.uuid,
        );
        return scheduled;
      }

      const api = await this.mediaSourceApiFactory.getJellyfinApiClient({
        mediaSource: {
          ...mediaSource,
          userId: selectedUserId,
        },
      });

      const stateByExternalId = new Map<string, JellyfinItem>();
      const externalIds = candidates.map((program) => program.externalKey);
      for (const ids of chunk(externalIds, MAX_JELLYFIN_IDS_PER_REQUEST)) {
        const result = await api.getRawItems(
          null,
          ['Episode'],
          [],
          { offset: 0, limit: ids.length },
          { ids },
        );
        if (result.isFailure()) {
          throw result.error;
        }
        for (const item of result.get().Items ?? []) {
          stateByExternalId.set(item.Id, item);
        }
      }

      const states = candidates.map((program) => {
        const userData = stateByExternalId.get(program.externalKey)?.UserData;
        const positionMs = Math.max(
          0,
          Math.floor((userData?.PlaybackPositionTicks ?? 0) / 10_000),
        );
        return {
          program,
          played: userData?.Played ?? false,
          positionMs,
          lastPlayedAtMs: userData?.LastPlayedDate
            ? Date.parse(userData.LastPlayedDate)
            : 0,
        } satisfies PlaybackState;
      });

      const selection = choosePersonalizedEpisode(
        config.strategy,
        states.map((state) => ({
          value: state,
          seasonNumber: state.program.seasonNumber,
          episodeNumber: state.program.episode,
          originalAirDate: state.program.originalAirDate,
          title: state.program.title,
          played: state.played,
          positionMs: state.positionMs,
          lastPlayedAtMs: state.lastPlayedAtMs,
        })),
      );
      if (!selection) {
        return scheduled;
      }
      const selected = selection.value;
      const selectedStreamProgram = await this.programDB.getProgramById(
        selected.program.uuid,
      );
      if (
        !selectedStreamProgram ||
        !isNonEmptyString(selectedStreamProgram.mediaSourceId)
      ) {
        return scheduled;
      }

      const resumePositionMs = Math.min(
        selection.resumePositionMs,
        Math.max(0, selectedStreamProgram.duration - 1),
      );

      this.resolvedSlots.set(slotKey, {
        programUuid: selectedStreamProgram.uuid,
        resumePositionMs,
        resolvedAtMs: requestTimeMs,
      });

      this.pruneResolvedSlots(requestTimeMs);

      return this.replaceScheduledProgram(
        scheduled,
        selectedStreamProgram,
        resumePositionMs,
        0,
      );
    } catch (error) {
      this.logger.warn(
        error,
        'Unable to resolve personalized playback for channel %s. Using the scheduled episode.',
        channel.uuid,
      );
      return scheduled;
    }
  }

  private async findCandidateByUuid(
    channelId: string,
    tvShowUuid: string,
    mediaSourceId: string,
    programUuid: string,
  ) {
    const programs = await this.channelDB.getChannelPrograms(
      channelId,
      undefined,
      'episode',
    );
    const candidate = programs.results.find(
      (program) =>
        program.uuid === programUuid &&
        program.tvShowUuid === tvShowUuid &&
        program.mediaSourceId === mediaSourceId,
    );
    if (!candidate) {
      return undefined;
    }

    return this.programDB.getProgramById(candidate.uuid);
  }

  private replaceScheduledProgram(
    scheduled: ProgramAndTimeElapsed,
    selected: ProgramOrmWithExternalIds,
    resumePositionMs: number,
    personalizedElapsedMs: number,
  ): ProgramAndTimeElapsed {
    if (
      scheduled.program.type !== 'program' ||
      !isNonEmptyString(selected.mediaSourceId)
    ) {
      return scheduled;
    }

    return {
      ...scheduled,
      timeElapsed: personalizedElapsedMs,
      program: {
        ...scheduled.program,
        program: {
          ...selected,
          mediaSourceId: selected.mediaSourceId,
        },
        startOffset: resumePositionMs,
      },
    };
  }

  private pruneResolvedSlots(nowMs: number) {
    const cutoff = nowMs - 6 * 60 * 60 * 1000;
    for (const [key, value] of this.resolvedSlots) {
      if (value.resolvedAtMs < cutoff) {
        this.resolvedSlots.delete(key);
      }
    }
  }
}
