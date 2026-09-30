// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type {GlobalState} from '@mattermost/types/store';

import {getChannel} from 'mattermost-redux/selectors/entities/channels';

import {logError} from './actions';
import {getConfig, getCurrentCallChannelId, isVoiceChannel} from './selectors';
import type {PluginStore} from './types/host';

// How long to wait for the previous call to end when switching to another voice channel.
export const LEAVE_TIMEOUT = 5000;

// runCallsCommand runs a /call command through the Calls plugin, which handles both calls run in
// this window and those run by the desktop app.
function runCallsCommand(message: string, channelId: string, teamId = '') {
    window.postMessage({
        type: 'calls-run-slash-command',
        message,
        args: {channel_id: channelId, team_id: teamId},
    }, window.origin);
}

export function leaveCall(channelId: string) {
    if (window.callsClient?.channelID === channelId) {
        window.callsClient.disconnect();
        return;
    }
    runCallsCommand('/call leave', channelId);
}

// waitForState resolves to true once the predicate is true, or false after the timeout.
export function waitForState(store: PluginStore, predicate: (state: GlobalState) => boolean, timeout: number): Promise<boolean> {
    if (predicate(store.getState())) {
        return Promise.resolve(true);
    }

    return new Promise((resolve) => {
        let unsubscribe: (() => void) | null = null;
        const timer = setTimeout(() => {
            unsubscribe?.();
            resolve(false);
        }, timeout);
        unsubscribe = store.subscribe(() => {
            if (predicate(store.getState())) {
                clearTimeout(timer);
                unsubscribe?.();
                resolve(true);
            }
        });
    });
}

// joinVoiceChannel joins the call of a voice channel. A user is in at most one call: when in
// the call of another voice channel, it's left first; when in another kind of call (e.g. a
// direct message call), it's only left if leaveOtherCalls is true. Returns whether the join was
// requested.
export async function joinVoiceChannel(store: PluginStore, channelId: string, leaveOtherCalls: boolean): Promise<boolean> {
    const state = store.getState();
    const current = getCurrentCallChannelId(state);
    if (current === channelId) {
        return false;
    }

    if (current) {
        if (!leaveOtherCalls && !isVoiceChannel(state, current)) {
            return false;
        }
        leaveCall(current);
        if (!await waitForState(store, (s) => !getCurrentCallChannelId(s), LEAVE_TIMEOUT)) {
            logError('timed out leaving the previous call', current);
            return false;
        }
    }

    runCallsCommand('/call join', channelId, getChannel(store.getState(), channelId)?.team_id);
    return true;
}

// autoJoinVoiceChannel joins the call of a voice channel opened from the sidebar, if the
// plugin is configured to do so.
export function autoJoinVoiceChannel(store: PluginStore, channelId: string) {
    const state = store.getState();
    if (!getConfig(state).autoJoin || !isVoiceChannel(state, channelId)) {
        return;
    }
    joinVoiceChannel(store, channelId, false);
}
