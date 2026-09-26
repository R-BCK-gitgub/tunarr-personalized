import { inject, injectable } from 'inversify';
import { v4 } from 'uuid';
import { isContentBackedLineupItem } from '../../db/derived_types/StreamLineup.ts';
import { MediaSourceDB } from '../../db/mediaSourceDB.ts';
import type { MediaSourceWithRelations } from '../../db/schema/derivedTypes.ts';
import type { UpdateJellyfinPlayStatusScheduledTaskFactory } from '../../tasks/jellyfin/UpdateJellyfinPlayStatusTask.ts';
import { UpdateJellyfinPlayStatusScheduledTask } from '../../tasks/jellyfin/UpdateJellyfinPlayStatusTask.ts';
import { Result } from '../../types/result.ts';
import type { Maybe } from '../../types/util.ts';
import { isNonEmptyString } from '../../util/index.ts';
import { InjectLogger } from '../../util/inject.ts';
import type { Logger } from '../../util/logging/LoggerFactory.ts';
import type {
  PluginContext,
  ProgramStreamPlugin,
} from './ProgramStreamPlugin.ts';

@injectable()
export class JellyfinPlayStatusUpdaterPlugin implements ProgramStreamPlugin {
  @InjectLogger() declare private readonly logger: Logger;

  private updateStatusTask: Maybe<UpdateJellyfinPlayStatusScheduledTask>;
  private delayedStart: Maybe<ReturnType<typeof setTimeout>>;

  constructor(
    @inject(UpdateJellyfinPlayStatusScheduledTask.KEY)
    private playStatusTaskFactory: UpdateJellyfinPlayStatusScheduledTaskFactory,
    @inject(MediaSourceDB) private mediaSourceDB: MediaSourceDB,
  ) {}

  async run(context: PluginContext): Promise<Result<void>> {
    const lineupItem = context.playerContext.lineupItem;
    if (!isContentBackedLineupItem(lineupItem)) {
      return Result.void();
    }

    if (lineupItem.program.sourceType !== 'jellyfin') {
      return Result.void();
    }

    const server = await this.mediaSourceDB.getById(
      lineupItem.program.mediaSourceId,
    );

    if (!server) {
      return Result.forError(
        new Error(
          `Unable to find server "${lineupItem.program.mediaSourceId}" specified by program.`,
        ),
      );
    }

    if (!server.sendPlayStatusUpdates) {
      return Result.void();
    }

    const config = context.playerContext.sourceChannel.personalizedPlayback;
    const personalized =
      config?.strategy === 'next_unwatched' ||
      config?.strategy === 'random_unwatched';
    const selectedUserId =
      personalized && config.visibility === 'selected_users'
        ? config.jellyfinUserIds.find(isNonEmptyString)
        : undefined;

    const targetServer: MediaSourceWithRelations = selectedUserId
      ? { ...server, userId: selectedUserId }
      : server;
    const graceMs = personalized
      ? Math.max(0, config.channelSurfGracePeriodSeconds * 1000)
      : 0;

    const startUpdater = () => {
      this.updateStatusTask = this.playStatusTaskFactory(
        targetServer,
        {
          channelNumber: context.playerContext.sourceChannel.number,
          first: true,
          itemDuration: lineupItem.program.duration,
          itemId: lineupItem.program.externalKey,
          itemStartPositionMs: Math.min(
            (lineupItem.startOffset ?? 0) + graceMs,
            lineupItem.program.duration,
          ),
        },
        v4(),
      );
      this.delayedStart = undefined;
    };

    if (graceMs > 0) {
      this.delayedStart = setTimeout(startUpdater, graceMs);
    } else {
      startUpdater();
    }

    return Result.void();
  }

  shutdown(): Promise<Result<void>> {
    if (this.delayedStart) {
      clearTimeout(this.delayedStart);
      this.delayedStart = undefined;
    }
    this.updateStatusTask?.stop();
    return Promise.resolve(Result.void());
  }
}
