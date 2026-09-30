// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type {GlobalState} from '@mattermost/types/store';

import {getChannel} from 'mattermost-redux/selectors/entities/channels';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import {logError, sessionDeafened} from './actions';
import * as client from './client';
import {
    callsState,
    getConfig,
    getCurrentCallChannelId,
    getMySessionId,
    isSessionDeafened,
    isVoiceChannel,
} from './selectors';
import type CallsClient from './types/calls_client';
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

// DeafenController deafens the user when their session of the current call is marked deafened:
// the remote audio tracks of the call are disabled. Deafening also mutes the user; unmuting
// undeafens. It only works while the call runs in this window (not with the desktop app).
export class DeafenController {
    private store: PluginStore;
    private unsubscribe: () => void;
    private client: CallsClient | null = null;
    private active: {channelId: string; sessionId: string; deafened: boolean; unmuted: boolean} | null = null;
    private mutedByDeafen = false;

    constructor(store: PluginStore) {
        this.store = store;
        this.unsubscribe = store.subscribe(this.update);
        this.update();
    }

    destroy() {
        this.unsubscribe();
        this.setClient(null);
    }

    private onRemoteVoiceStream = (stream: MediaStream) => {
        if (this.active?.deafened) {
            for (const track of stream.getAudioTracks()) {
                track.enabled = false;
            }
        }
    };

    private setClient(callsClient: CallsClient | null) {
        if (this.client === callsClient) {
            return;
        }
        this.client?.off('remoteVoiceStream', this.onRemoteVoiceStream);
        this.client = callsClient;
        this.client?.on('remoteVoiceStream', this.onRemoteVoiceStream);
    }

    private update = () => {
        const state = this.store.getState();
        const callsClient = window.callsClient || null;
        const channelId = callsClient ? getCurrentCallChannelId(state) : '';
        const sessionId = callsClient ? getMySessionId(state) : '';

        // The call ended or changed: undeafen the previous session
        if (this.active && (this.active.channelId !== channelId || this.active.sessionId !== sessionId)) {
            const previous = this.active;
            this.active = null;
            this.mutedByDeafen = false;
            if (previous.deafened) {
                this.store.dispatch(sessionDeafened(previous.channelId, previous.sessionId, getCurrentUserId(state), false));
                client.setSessionDeafened(previous.channelId, previous.sessionId, false).catch((err) => logError('failed to undeafen a past session', err));
            }
        }

        this.setClient(callsClient);
        if (!callsClient || !channelId || !sessionId) {
            return;
        }

        const deafened = isSessionDeafened(state, channelId, sessionId);
        const unmuted = Boolean(callsState(state).sessions?.[channelId]?.[sessionId]?.unmuted);
        const previous = this.active;
        this.active = {channelId, sessionId, deafened, unmuted};

        if (deafened !== (previous?.deafened ?? false)) {
            for (const track of callsClient.getRemoteVoiceTracks()) {
                track.enabled = !deafened;
            }
        }

        // Unmuting while deafened undeafens
        if (deafened && previous?.deafened && unmuted && !previous.unmuted) {
            this.mutedByDeafen = false;
            setDeafened(this.store, false);
        }
    };

    // Called when the user deafens: mute them and remember to unmute them when undeafening.
    muteForDeafen() {
        const state = this.store.getState();
        const channelId = getCurrentCallChannelId(state);
        const sessionId = getMySessionId(state);
        if (window.callsClient && callsState(state).sessions?.[channelId]?.[sessionId]?.unmuted) {
            window.callsClient.mute();
            this.mutedByDeafen = true;
        }
    }

    // Called when the user undeafens: unmute them if deafening muted them.
    unmuteAfterDeafen() {
        if (this.mutedByDeafen) {
            this.mutedByDeafen = false;
            window.callsClient?.unmute();
        }
    }
}

let deafenController: DeafenController | null = null;

export function startDeafenController(store: PluginStore) {
    deafenController?.destroy();
    deafenController = new DeafenController(store);
    return deafenController;
}

export function stopDeafenController() {
    deafenController?.destroy();
    deafenController = null;
}

// setDeafened deafens or undeafens the user in the call of this window.
export async function setDeafened(store: PluginStore, deafened: boolean) {
    const state = store.getState();
    const channelId = getCurrentCallChannelId(state);
    const sessionId = getMySessionId(state);
    if (!window.callsClient || !channelId || !sessionId || isSessionDeafened(state, channelId, sessionId) === deafened) {
        return;
    }

    const userId = getCurrentUserId(state);
    store.dispatch(sessionDeafened(channelId, sessionId, userId, deafened));
    if (deafened) {
        deafenController?.muteForDeafen();
    } else {
        deafenController?.unmuteAfterDeafen();
    }

    try {
        await client.setSessionDeafened(channelId, sessionId, deafened);
    } catch (err) {
        logError('failed to share the deafened state', err);
    }
}
