import { describe, expect, it } from 'vitest';
import { choosePersonalizedEpisode } from './personalizedPlaybackSelector.ts';

type Episode = { id: string };

const episode = (
  id: string,
  seasonNumber: number,
  episodeNumber: number,
  overrides: Partial<{
    played: boolean;
    positionMs: number;
    lastPlayedAtMs: number;
  }> = {},
) => ({
  value: { id } satisfies Episode,
  seasonNumber,
  episodeNumber,
  title: id,
  played: false,
  positionMs: 0,
  lastPlayedAtMs: 0,
  ...overrides,
});

describe('choosePersonalizedEpisode', () => {
  it('does not replace normal or random-all scheduled playback', () => {
    const candidates = [episode('s1e1', 1, 1)];
    expect(choosePersonalizedEpisode('normal', candidates)).toBeUndefined();
    expect(
      choosePersonalizedEpisode('random_all', candidates),
    ).toBeUndefined();
  });

  it('resumes the most recently played partial episode first', () => {
    const result = choosePersonalizedEpisode('next_unwatched', [
      episode('partial-old', 1, 1, {
        positionMs: 30_000,
        lastPlayedAtMs: 10,
      }),
      episode('partial-new', 1, 2, {
        positionMs: 45_000,
        lastPlayedAtMs: 20,
      }),
      episode('unwatched', 1, 3),
    ]);

    expect(result).toEqual({
      value: { id: 'partial-new' },
      resumePositionMs: 45_000,
    });
  });

  it('chooses the chronologically first unwatched episode for next-unwatched', () => {
    const result = choosePersonalizedEpisode('next_unwatched', [
      episode('s2e1', 2, 1),
      episode('s1e2', 1, 2),
      episode('s1e1-watched', 1, 1, { played: true }),
    ]);

    expect(result).toEqual({
      value: { id: 's1e2' },
      resumePositionMs: 0,
    });
  });

  it('chooses an unwatched episode at random for random-unwatched', () => {
    const result = choosePersonalizedEpisode(
      'random_unwatched',
      [episode('s1e1', 1, 1), episode('s1e2', 1, 2)],
      () => 0.99,
    );

    expect(result).toEqual({
      value: { id: 's1e2' },
      resumePositionMs: 0,
    });
  });

  it('falls back to a random episode when all episodes are watched', () => {
    const result = choosePersonalizedEpisode(
      'next_unwatched',
      [
        episode('s1e1', 1, 1, { played: true }),
        episode('s1e2', 1, 2, { played: true }),
      ],
      () => 0.75,
    );

    expect(result).toEqual({
      value: { id: 's1e2' },
      resumePositionMs: 0,
    });
  });
});
