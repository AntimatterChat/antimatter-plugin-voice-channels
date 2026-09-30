// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {RECEIVED_CONFIG, RECEIVED_VOICE_CHANNEL, RECEIVED_VOICE_CHANNELS, SESSION_DEAFENED} from './action_types';
import * as client from './client';
import type {PluginStore, WebSocketMessage} from './types/host';

// logError reports an error of a background request. Errors of user actions are shown instead.
export function logError(message: string, err: unknown) {
    // eslint-disable-next-line no-console
    console.error(`[voice channels] ${message}`, err);
}

export async function loadConfig(store: PluginStore) {
    try {
        store.dispatch({type: RECEIVED_CONFIG, data: await client.getConfig()});
    } catch (err) {
        logError('failed to load the configuration', err);
    }
}

export async function loadVoiceChannels(store: PluginStore) {
    try {
        store.dispatch({type: RECEIVED_VOICE_CHANNELS, data: await client.getVoiceChannels()});
    } catch (err) {
        logError('failed to load the voice channels', err);
    }
}

export async function loadVoiceChannel(store: PluginStore, channelId: string) {
    try {
        store.dispatch({type: RECEIVED_VOICE_CHANNEL, data: await client.getVoiceChannel(channelId)});
    } catch (err) {
        logError('failed to load a voice channel', err);
    }
}

// setVoiceChannel makes a channel a voice channel (voice is true) or a regular channel. It
// throws a client.ClientError when the server refuses.
export async function setVoiceChannel(store: PluginStore, channelId: string, voice: boolean) {
    store.dispatch({type: RECEIVED_VOICE_CHANNEL, data: await client.updateVoiceChannel(channelId, voice)});
}

export function sessionDeafened(channelId: string, sessionId: string, userId: string, deafened: boolean) {
    return {type: SESSION_DEAFENED, data: {channelId, sessionId, userId, deafened}};
}

export function handleVoiceChannelUpdated(store: PluginStore, msg: WebSocketMessage) {
    const {channel_id: channelId, team_id: teamId, voice} = msg.data as {channel_id: string; team_id: string; voice: boolean};
    if (voice) {
        // Refetch to get the deafened sessions too
        loadVoiceChannel(store, channelId);
        return;
    }
    store.dispatch({type: RECEIVED_VOICE_CHANNEL, data: {channel_id: channelId, team_id: teamId, voice: false, deafened_sessions: {}}});
}

export function handleSessionDeafened(store: PluginStore, msg: WebSocketMessage) {
    const data = msg.data as {channel_id: string; session_id: string; user_id: string; deafened: boolean};
    store.dispatch(sessionDeafened(data.channel_id, data.session_id, data.user_id, data.deafened));
}
