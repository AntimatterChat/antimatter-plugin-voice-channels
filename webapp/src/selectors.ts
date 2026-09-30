// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type {Channel} from '@mattermost/types/channels';
import type {GlobalState} from '@mattermost/types/store';

import manifest from './manifest';
import type {VoicePluginState} from './reducer';
import type {CallsPluginState, CallsSessionState} from './types/calls';

export const callsPluginId = 'com.mattermost.calls';

export type Participant = {
    sessionId: string;
    userId: string;
    muted: boolean;
    deafened: boolean;
    video: boolean;
    screenSharing: boolean;
    speaking: boolean;
    raisedHand: boolean;
};

const emptyCallsState: CallsPluginState = {};

export function pluginState(state: GlobalState): VoicePluginState {
    return (state as unknown as Record<string, VoicePluginState>)[`plugins-${manifest.id}`];
}

export function callsState(state: GlobalState): CallsPluginState {
    return (state as unknown as Record<string, CallsPluginState | undefined>)[`plugins-${callsPluginId}`] || emptyCallsState;
}

// isCallsAvailable returns whether the Calls plugin is running in the webapp.
export function isCallsAvailable(state: GlobalState): boolean {
    return Boolean((state as unknown as Record<string, unknown>)[`plugins-${callsPluginId}`]);
}

export function getConfig(state: GlobalState) {
    return pluginState(state).config;
}

export function isVoiceChannel(state: GlobalState, channelId: string): boolean {
    return Boolean(pluginState(state)?.channels[channelId]);
}

// isKnownChannel returns whether the plugin knows whether the channel is a voice channel.
export function isKnownChannel(state: GlobalState, channelId: string): boolean {
    return channelId in (pluginState(state)?.channels || {});
}

// isActiveVoiceChannel returns whether the channel is a voice channel that isn't archived.
export function isActiveVoiceChannel(state: GlobalState, channel: Channel): boolean {
    return channel.delete_at === 0 && isVoiceChannel(state, channel.id);
}

// getCurrentCallChannelId returns the channel of the call the user is in (in this window or,
// with the desktop app, in the call window), or an empty string.
export function getCurrentCallChannelId(state: GlobalState): string {
    return window.callsClient?.channelID || callsState(state).clientStateReducer?.channelID || '';
}

// getMySessionId returns the ID of the user's session in the current call, or an empty string.
export function getMySessionId(state: GlobalState): string {
    return window.callsClient?.getSessionID() || callsState(state).clientStateReducer?.sessionID || '';
}

// isMediaInThisWindow returns whether the current call's media is handled by this window: it
// isn't with the desktop app, which runs calls in a separate window.
export function isMediaInThisWindow(): boolean {
    return Boolean(window.callsClient);
}

export function isSessionDeafened(state: GlobalState, channelId: string, sessionId: string): boolean {
    return Boolean(sessionId && pluginState(state)?.deafened[channelId]?.[sessionId]);
}

type ParticipantsCacheEntry = {
    sessions?: {[sessionID: string]: CallsSessionState};
    screenSharingId?: string;
    deafened?: {[sessionId: string]: string};
    participants: Participant[];
};

const participantsCache = new Map<string, ParticipantsCacheEntry>();
const noParticipants: Participant[] = [];

// getParticipants returns the participants of the call of a channel, in the order they joined.
// The result only changes when the call changes.
export function getParticipants(state: GlobalState, channelId: string): Participant[] {
    const calls = callsState(state);
    const sessions = calls.sessions?.[channelId];
    const screenSharingId = calls.screenSharingIDs?.[channelId];
    const deafened = pluginState(state)?.deafened[channelId];

    const cached = participantsCache.get(channelId);
    if (cached && cached.sessions === sessions && cached.screenSharingId === screenSharingId && cached.deafened === deafened) {
        return cached.participants;
    }

    let participants = noParticipants;
    if (sessions && Object.keys(sessions).length) {
        participants = Object.values(sessions).map((session) => ({
            sessionId: session.session_id,
            userId: session.user_id,
            muted: !session.unmuted,
            deafened: Boolean(deafened?.[session.session_id]),
            video: Boolean(session.video),
            screenSharing: screenSharingId === session.session_id,
            speaking: Boolean(session.voice) && session.unmuted,
            raisedHand: session.raised_hand > 0,
        }));
    }

    participantsCache.set(channelId, {sessions, screenSharingId, deafened, participants});
    return participants;
}
