export type PersonalizedPlaybackStrategy =
  | 'normal'
  | 'random_all'
  | 'next_unwatched'
  | 'random_unwatched';

export type PersonalizedEpisodeCandidate<T> = {
  value: T;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  originalAirDate?: string | null;
  title: string;
  played: boolean;
  positionMs: number;
  lastPlayedAtMs: number;
};

function chronologicalCompare<T>(
  left: PersonalizedEpisodeCandidate<T>,
  right: PersonalizedEpisodeCandidate<T>,
): number {
  const leftSeason = left.seasonNumber ?? Number.MAX_SAFE_INTEGER;
  const rightSeason = right.seasonNumber ?? Number.MAX_SAFE_INTEGER;
  if (leftSeason !== rightSeason) return leftSeason - rightSeason;

  const leftEpisode = left.episodeNumber ?? Number.MAX_SAFE_INTEGER;
  const rightEpisode = right.episodeNumber ?? Number.MAX_SAFE_INTEGER;
  if (leftEpisode !== rightEpisode) return leftEpisode - rightEpisode;

  const airDate = (left.originalAirDate ?? '').localeCompare(
    right.originalAirDate ?? '',
  );
  if (airDate !== 0) return airDate;
  return left.title.localeCompare(right.title);
}

export function choosePersonalizedEpisode<T>(
  strategy: PersonalizedPlaybackStrategy,
  candidates: PersonalizedEpisodeCandidate<T>[],
  random: () => number = Math.random,
): { value: T; resumePositionMs: number } | undefined {
  if (
    candidates.length === 0 ||
    strategy === 'normal' ||
    strategy === 'random_all'
  ) {
    return undefined;
  }

  const partial = candidates
    .filter((candidate) => !candidate.played && candidate.positionMs > 0)
    .sort((a, b) => b.lastPlayedAtMs - a.lastPlayedAtMs)[0];
  if (partial) {
    return { value: partial.value, resumePositionMs: partial.positionMs };
  }

  const unwatched = candidates
    .filter((candidate) => !candidate.played && candidate.positionMs <= 0)
    .sort(chronologicalCompare);
  if (unwatched.length > 0) {
    const selected =
      strategy === 'next_unwatched'
        ? unwatched[0]
        : unwatched[Math.floor(random() * unwatched.length)];
    return selected ? { value: selected.value, resumePositionMs: 0 } : undefined;
  }

  const selected = candidates[Math.floor(random() * candidates.length)];
  return selected ? { value: selected.value, resumePositionMs: 0 } : undefined;
}
