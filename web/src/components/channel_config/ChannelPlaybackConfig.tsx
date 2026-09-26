import { getApiMediaSources } from '@/generated/sdk.gen.ts';
import { useSettings } from '@/store/settings/selectors.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import type { SaveableChannel } from '@tunarr/types';
import { Controller, useFormContext, useWatch } from 'react-hook-form';

type JellyfinUserOption = {
  id: string;
  name: string;
  sourceName: string;
};

export function ChannelPlaybackConfig() {
  const { t } = useLingui();
  const { backendUri } = useSettings();
  const { control } = useFormContext<SaveableChannel>();
  const [strategy, visibility] = useWatch({
    control,
    name: [
      'personalizedPlayback.strategy',
      'personalizedPlayback.visibility',
    ],
  });

  const { data: mediaSources } = useQuery({
    queryKey: ['settings', 'media-sources'],
    queryFn: async () => {
      const result = await getApiMediaSources({ throwOnError: true });
      return result.data;
    },
  });

  const jellyfinSources = (mediaSources ?? []).filter(
    (source) => source.type === 'jellyfin',
  );

  const { data: jellyfinUsers = [], isLoading: jellyfinUsersLoading } =
    useQuery({
      queryKey: [
        'jellyfin-users',
        backendUri,
        ...jellyfinSources.map((source) => source.id),
      ],
      enabled: jellyfinSources.length > 0,
      queryFn: async (): Promise<JellyfinUserOption[]> => {
        const base = backendUri.replace(/\/$/, '');
        const users = await Promise.all(
          jellyfinSources.map(async (source) => {
            const response = await fetch(
              `${base}/api/jellyfin/${source.id}/users`,
              { credentials: 'include' },
            );
            if (!response.ok) {
              throw new Error(
                `Unable to load Jellyfin users for ${source.name}`,
              );
            }
            const body = (await response.json()) as Array<{
              Id: string;
              Name: string;
              Policy?: { IsDisabled?: boolean };
            }>;
            return body
              .filter((user) => !user.Policy?.IsDisabled)
              .map((user) => ({
                id: user.Id,
                name: user.Name,
                sourceName: source.name,
              }));
          }),
        );
        return users.flat();
      },
    });

  const isPersonalized =
    strategy === 'next_unwatched' || strategy === 'random_unwatched';

  return (
    <Stack spacing={2}>
      <Typography variant="h5">
        <Trans>Playback Strategy</Trans>
      </Typography>

      <Typography variant="body1">
        <Trans>
          Tunarr still controls scheduling, series order, blocks, slots,
          cycling, shuffling, and weighting. Personalized strategies only
          choose the concrete episode after Tunarr has selected the series.
        </Trans>
      </Typography>

      <Controller
        name="personalizedPlayback.strategy"
        control={control}
        render={({ field }) => (
          <FormControl fullWidth>
            <InputLabel>{t`Playback Strategy`}</InputLabel>
            <Select {...field} label={t`Playback Strategy`}>
              <MenuItem value="normal">
                <Trans>Normal Live</Trans>
              </MenuItem>
              <MenuItem value="random_all">
                <Trans>Random All</Trans>
              </MenuItem>
              <MenuItem value="next_unwatched">
                <Trans>Next Unwatched</Trans>
              </MenuItem>
              <MenuItem value="random_unwatched">
                <Trans>Random Unwatched</Trans>
              </MenuItem>
            </Select>
          </FormControl>
        )}
      />

      <Typography variant="body2">
        <Trans>
          Normal Live keeps the existing Tunarr live schedule. Random All
          ignores Jellyfin watch state and keeps the normal detailed guide.
          Next Unwatched resumes a partially watched episode first, otherwise
          uses the next unwatched episode in season/episode order. Random
          Unwatched also resumes first, then chooses an unwatched episode at
          random. When no unwatched episodes remain, both personalized modes
          fall back to a random episode from the series selected by Tunarr.
        </Trans>
      </Typography>

      {isPersonalized && (
        <>
          <Controller
            name="personalizedPlayback.visibility"
            control={control}
            render={({ field }) => (
              <FormControl fullWidth>
                <InputLabel>{t`Jellyfin Watch State`}</InputLabel>
                <Select {...field} label={t`Jellyfin Watch State`}>
                  <MenuItem value="all_users">
                    <Trans>Use the Jellyfin account configured on the source</Trans>
                  </MenuItem>
                  <MenuItem value="selected_users">
                    <Trans>Use a selected Jellyfin user</Trans>
                  </MenuItem>
                </Select>
              </FormControl>
            )}
          />

          {visibility === 'selected_users' && (
            <Controller
              name="personalizedPlayback.jellyfinUserIds"
              control={control}
              render={({ field }) => (
                <FormControl fullWidth>
                  <InputLabel>{t`Jellyfin User`}</InputLabel>
                  <Select
                    value={field.value?.[0] ?? ''}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value ? [event.target.value] : [],
                      )
                    }
                    label={t`Jellyfin User`}
                  >
                    {jellyfinUsersLoading && (
                      <MenuItem disabled value="">
                        <Trans>Loading Jellyfin users…</Trans>
                      </MenuItem>
                    )}
                    {!jellyfinUsersLoading && jellyfinUsers.length === 0 && (
                      <MenuItem disabled value="">
                        <Trans>No Jellyfin users found</Trans>
                      </MenuItem>
                    )}
                    {jellyfinUsers.map((user) => (
                      <MenuItem
                        key={`${user.sourceName}-${user.id}`}
                        value={user.id}
                      >
                        {user.sourceName} — {user.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            />
          )}

          <Controller
            name="personalizedPlayback.channelSurfGracePeriodSeconds"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                type="number"
                label={t`Channel Surf Grace Period (seconds)`}
                helperText={t`Tunarr will not write playback progress to Jellyfin until the channel has been watched for this long, avoiding Continue Watching entries while channel surfing.`}
                inputProps={{ min: 0, step: 1 }}
                onChange={(event) =>
                  field.onChange(Math.max(0, Number(event.target.value) || 0))
                }
              />
            )}
          />

          <Typography variant="body2">
            <Trans>
              For personalized modes the guide intentionally shows the series
              rather than a specific season/episode, because the exact episode
              depends on the selected Jellyfin user's watch history when
              playback begins.
            </Trans>
          </Typography>
        </>
      )}
    </Stack>
  );
}
