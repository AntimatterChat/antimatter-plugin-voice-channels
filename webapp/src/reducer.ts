// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {combineReducers} from 'redux';

import {RECEIVED_CONFIG, RECEIVED_VOICE_CHANNEL, RECEIVED_VOICE_CHANNELS, SESSION_DEAFENED} from './action_types';
import type {ClientConfig, VoiceChannelState} from './client';

export type VoiceConfig = {
    autoJoin: boolean;
    allowVideo: boolean;
};

export type VoicePluginState = {
    config: VoiceConfig;

    // The voice channels (channel ID -> team ID), and the channels known not to be (false)
    channels: {[channelId: string]: string | false};

    // The deafened call sessions of each voice channel (session ID -> user ID)
    deafened: {[channelId: string]: {[sessionId: string]: string}};
};

type DeafenedData = {channelId: string; sessionId: string; userId: string; deafened: boolean};

type Action = {
    type: string;
    data?: unknown;
};

export const defaultConfig: VoiceConfig = {autoJoin: true, allowVideo: true};

function config(state: VoiceConfig = defaultConfig, action: Action): VoiceConfig {
    switch (action.type) {
    case RECEIVED_CONFIG: {
        const data = action.data as ClientConfig;
        return {autoJoin: data.auto_join, allowVideo: data.allow_video};
    }
    default:
        return state;
    }
}

function channels(state: VoicePluginState['channels'] = {}, action: Action): VoicePluginState['channels'] {
    switch (action.type) {
    case RECEIVED_VOICE_CHANNELS: {
        const next: VoicePluginState['channels'] = {};
        for (const vc of action.data as VoiceChannelState[]) {
            next[vc.channel_id] = vc.team_id;
        }
        return next;
    }
    case RECEIVED_VOICE_CHANNEL: {
        const vc = action.data as VoiceChannelState;
        const value = vc.voice ? vc.team_id : false;
        if (state[vc.channel_id] === value) {
            return state;
        }
        return {...state, [vc.channel_id]: value};
    }
    default:
        return state;
    }
}

function deafened(state: VoicePluginState['deafened'] = {}, action: Action): VoicePluginState['deafened'] {
    switch (action.type) {
    case RECEIVED_VOICE_CHANNELS: {
        const next: VoicePluginState['deafened'] = {};
        for (const vc of action.data as VoiceChannelState[]) {
            next[vc.channel_id] = vc.deafened_sessions || {};
        }
        return next;
    }
    case RECEIVED_VOICE_CHANNEL: {
        const vc = action.data as VoiceChannelState;
        const next = {...state};
        if (vc.voice) {
            next[vc.channel_id] = vc.deafened_sessions || {};
        } else {
            delete next[vc.channel_id];
        }
        return next;
    }
    case SESSION_DEAFENED: {
        const {channelId, sessionId, userId, deafened: isDeafened} = action.data as DeafenedData;
        const sessions = {...state[channelId]};
        if (isDeafened) {
            if (sessions[sessionId] === userId) {
                return state;
            }
            sessions[sessionId] = userId;
        } else {
            if (!(sessionId in sessions)) {
                return state;
            }
            delete sessions[sessionId];
        }
        return {...state, [channelId]: sessions};
    }
    default:
        return state;
    }
}

export default combineReducers({
    config,
    channels,
    deafened,
});
