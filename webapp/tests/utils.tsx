// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {render} from '@testing-library/react';
import React from 'react';
import {IntlProvider} from 'react-intl';
import {Provider} from 'react-redux';
import {createStore} from 'redux';

import type {GlobalState} from '@mattermost/types/store';

import manifest from '../src/manifest';
import reducer, {type VoicePluginState} from '../src/reducer';
import type {CallsPluginState} from '../src/types/calls';
import type {PluginStore} from '../src/types/host';

export const currentUserId = 'currentuserid00000000000000';
export const teamId = 'teamid0000000000000000000000';

type TestStateOptions = {
    voice?: Partial<VoicePluginState>;
    calls?: CallsPluginState | null;
    channels?: Array<{id: string; type?: string; delete_at?: number; display_name?: string}>;
    users?: Array<{id: string; username: string}>;
};

// makeState returns a minimal host state with this plugin's and the Calls plugin's state.
export function makeState({voice = {}, calls = {}, channels = [], users = []}: TestStateOptions = {}): GlobalState {
    const voiceState = reducer(undefined, {type: '@@INIT'}) as VoicePluginState;
    const state: Record<string, unknown> = {
        entities: {
            general: {config: {}, license: {}},
            preferences: {myPreferences: {}},
            users: {
                currentUserId,
                profiles: Object.fromEntries(users.map((u) => [u.id, {last_picture_update: 0, ...u}])),
            },
            channels: {
                currentChannelId: '',
                channels: Object.fromEntries(channels.map((c) => [c.id, {team_id: teamId, type: 'O', delete_at: 0, display_name: c.id, ...c}])),
            },
            teams: {currentTeamId: teamId, teams: {}},
        },
        [`plugins-${manifest.id}`]: {...voiceState, ...voice},
    };
    if (calls) {
        state['plugins-com.mattermost.calls'] = calls;
    }
    return state as unknown as GlobalState;
}

// makeStore returns a store whose state can be replaced with setState. Actions go through this
// plugin's reducer.
export function makeStore(initial: GlobalState) {
    const pluginKey = `plugins-${manifest.id}`;
    const store = createStore((state: GlobalState | undefined, action: {type: string; state?: GlobalState}) => {
        if (action.type === 'SET_STATE' && action.state) {
            return action.state;
        }
        const current = state || initial;
        const pluginState = (current as unknown as Record<string, VoicePluginState>)[pluginKey];
        const next = reducer(pluginState, action);
        if (next === pluginState) {
            return current;
        }
        return {...current, [pluginKey]: next} as GlobalState;
    }, initial);

    return Object.assign(store as unknown as PluginStore, {
        setState: (state: GlobalState) => store.dispatch({type: 'SET_STATE', state}),
    });
}

export function renderWithStore(ui: React.ReactElement, store: PluginStore) {
    return render(
        <Provider store={store}>
            <IntlProvider
                locale='en'
                onError={() => null}
            >
                {ui}
            </IntlProvider>
        </Provider>,
    );
}
