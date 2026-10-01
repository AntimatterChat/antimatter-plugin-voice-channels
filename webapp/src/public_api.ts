// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type {GlobalState} from '@mattermost/types/store';

import {getChannel} from 'mattermost-redux/selectors/entities/channels';

import {autoJoinVoiceChannel, joinVoiceChannel, leaveCall, setDeafened} from './call_control';
import {
    callsState,
    getConfig,
    getCurrentCallChannelId,
    getMySessionId,
    getParticipants,
    isActiveVoiceChannel,
    isSessionDeafened,
    isVoiceChannel,
    type Participant,
} from './selectors';
import type {PluginStore} from './types/host';
import type {AntimatterVoiceChannelsAPI, VoiceParticipant} from './types/public_api';

function isActiveVoiceChannelId(state: GlobalState, channelId: string): boolean {
    const channel = getChannel(state, channelId);

    // Without the channel, whether it's archived isn't known
    return channel ? isActiveVoiceChannel(state, channel) : isVoiceChannel(state, channelId);
}

type ParticipantsCacheEntry = {
    participants: Participant[];
    hostId: string;
    mySessionId: string;
    result: VoiceParticipant[];
};

const participantsCache = new Map<string, ParticipantsCacheEntry>();
const noParticipants: VoiceParticipant[] = [];

function getVoiceParticipants(state: GlobalState, channelId: string): VoiceParticipant[] {
    const participants = getParticipants(state, channelId);
    const hostId = callsState(state).hosts?.[channelId]?.hostID || '';
    const mySessionId = getCurrentCallChannelId(state) === channelId ? getMySessionId(state) : '';

    const cached = participantsCache.get(channelId);
    if (cached && cached.participants === participants && cached.hostId === hostId && cached.mySessionId === mySessionId) {
        return cached.result;
    }

    const result = participants.length ? participants.map((p) => ({
        ...p,
        isHost: Boolean(hostId) && p.userId === hostId,
        isMe: Boolean(mySessionId) && p.sessionId === mySessionId,
    })) : noParticipants;
    participantsCache.set(channelId, {participants, hostId, mySessionId, result});
    return result;
}

function isDeafened(state: GlobalState): boolean {
    return isSessionDeafened(state, getCurrentCallChannelId(state), getMySessionId(state));
}

function getAutoJoin(state: GlobalState): boolean {
    return Boolean(getConfig(state)?.autoJoin);
}

export const selectors = {
    isVoiceChannel: isActiveVoiceChannelId,
    getParticipants: getVoiceParticipants,
    isDeafened,
    getAutoJoin,
} as AntimatterVoiceChannelsAPI['selectors'];

// createVoiceChannelsAPI creates window.antimatterVoiceChannels.
export function createVoiceChannelsAPI(store: PluginStore): AntimatterVoiceChannelsAPI {
    return {
        version: 1,
        selectors,

        join: async (channelId, opts) => {
            await joinVoiceChannel(store, channelId, Boolean(opts?.leaveOtherCalls));
        },

        autoJoin: (channelId) => autoJoinVoiceChannel(store, channelId),

        leave: () => {
            const channelId = getCurrentCallChannelId(store.getState());
            if (channelId) {
                leaveCall(channelId);
            }
        },

        setDeafened: (deafened) => {
            setDeafened(store, deafened);
        },
    };
}
