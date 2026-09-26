import type { Maybe } from '@/types/util.ts';
import { get, isNil, isObject, isUndefined, merge } from 'lodash-es';
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import {
  type EditorsState,
  createChannelEditorState,
} from './channelEditor/store.ts';
import type { ProgrammingState } from './programming/store.ts';
import { createProgrammingState } from './programming/store.ts';
import {
  type ProgrammingListingsState,
  createProgrammingListingsState,
} from './programmingSelector/store.ts';
import type { SettingsStateInternal } from './settings/store.ts';
import {
  type PersistedSettingsState,
  type SettingsState,
  SettingsStateInternalSchema,
  DefaultBackendUri,
  createSettingsSlice,
} from './settings/store.ts';
import type { ThemeEditorStateInner } from './themeEditor/store.ts';
import {
  type ThemeEditorState,
  createThemeEditorState,
} from './themeEditor/store.ts';

export type State = ThemeEditorState &
  SettingsState &
  ProgrammingListingsState &
  EditorsState &
  ProgrammingState;

type PersistedState = PersistedSettingsState & ThemeEditorState;

const useStore = create<State>()(
  immer(
    devtools(
      persist(
        (...set) => ({
          ...createSettingsSlice(...set),
          ...createProgrammingListingsState(...set),
          ...createChannelEditorState(...set),
          ...createThemeEditorState(...set),
          ...createProgrammingState(...set),
        }),
        {
          name: 'tunarr',
          partialize: (state: State) =>
            ({
              theme: state.theme,
              settings: {
                backendUri: state.settings.backendUri,
                ui: {
                  ...state.settings.ui,
                },
              },
            }) satisfies PersistedState,
          merge(persistedState, currentState) {
            if (isNil(persistedState)) {
              return currentState;
            }

            if (!isObject(persistedState)) {
              return currentState;
            }

            const persistedTheme = get(persistedState, 'theme') as unknown;
            const persistedSettings = get(
              persistedState,
              'settings',
            ) as unknown;

            let parsedSettings: Maybe<SettingsStateInternal>;
            if (persistedSettings) {
              const result = SettingsStateInternalSchema.safeParse(
                persistedSettings,
                { reportInput: true },
              );
              if (result.error) {
                console.error(
                  'Could not hydrate persisted settings',
                  result.error,
                );
              } else {
                parsedSettings = result.data;
                // Older development builds stored either localhost:8000 or a
                // Codespaces :8000 forwarded URL. Development now uses Vite's
                // same-origin proxy, so transparently migrate those old defaults.
                if (import.meta.env.DEV) {
                  const oldDevBackend =
                    parsedSettings.backendUri === 'http://localhost:8000' ||
                    /-8000\.app\.github\.dev$/.test(
                      parsedSettings.backendUri,
                    );
                  if (oldDevBackend) {
                    parsedSettings.backendUri = DefaultBackendUri;
                  }
                }
                // TODO: provide way to convert to the next version
              }
            }

            // Migrate to new setting.
            if (
              isObject(persistedTheme) &&
              isUndefined(
                (persistedTheme as ThemeEditorStateInner).themePreference,
              )
            ) {
              const castedTheme = persistedTheme as ThemeEditorStateInner;
              castedTheme.themePreference = castedTheme.darkMode
                ? 'dark'
                : 'light';
            }

            return {
              ...currentState,
              theme: merge(
                {},
                currentState.theme ?? {},
                isObject(persistedTheme) ? persistedTheme : {},
              ),
              settings: merge(
                {},
                currentState.settings ?? {},
                parsedSettings ?? {},
              ),
            };
          },
        },
      ),
    ),
  ),
);

export default useStore;
