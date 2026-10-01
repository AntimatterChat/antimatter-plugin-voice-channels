// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {currentUserId, makeState, makeStore, teamId} from '../tests/utils';

import * as callControl from './call_control';
import {createVoiceChannelsAPI, selectors} from './public_api';
import type {CallsPluginState} from './types/calls';

jest.mock('./call_control', () => ({
    autoJoinVoiceChannel: jest.fn(),
    joinVoiceChannel: jest.fn(() => Promise.resolve(true)),
    leaveCall: jest.fn(),
    setDeafened: jest.fn(() => Promise.resolve()),
}));

const session = (id: string, userId: string, extra = {}) => ({session_id: id, user_id: userId, unmuted: false, raised_hand: 0, ...extra});

const sessions = {
    s1: session('s1', 'host', {unmuted: true, voice: true}),
    s2: session('s2', currentUserId),
};

function stateWith(calls: CallsPluginState, deafened: {[sessionId: string]: string} = {}) {
    return makeState({
        calls,
        channels: [{id: 'voice'}, {id: 'archived', delete_at: 1}],
        voice: {channels: {voice: teamId, archived: teamId, text: false}, deafened: {voice: deafened}},
    });
}

describe('selectors', () => {
    test('isVoiceChannel only includes active voice channels', () => {
        const state = stateWith({});
        expect(selectors.isVoiceChannel(state, 'voice')).toBe(true);
        expect(selectors.isVoiceChannel(state, 'archived')).toBe(false);
        expect(selectors.isVoiceChannel(state, 'text')).toBe(false);
        expect(selectors.isVoiceChannel(state, 'unknown')).toBe(false);
    });

    test('getParticipants adds the host, the user and who is deafened, and keeps the result while unchanged', () => {
        const calls = {
            sessions: {voice: sessions},
            hosts: {voice: {hostID: 'host'}},
            localCall: {channelID: 'voice', sessionID: 's2', state: 'connected' as const},
        };
        const deafened = {s2: currentUserId};
        const participants = selectors.getParticipants(stateWith(calls, deafened), 'voice');
        expect(participants).toEqual([
            {sessionId: 's1', userId: 'host', muted: false, deafened: false, video: false, screenSharing: false, speaking: true, raisedHand: false, isHost: true, isMe: false},
            {sessionId: 's2', userId: currentUserId, muted: true, deafened: true, video: false, screenSharing: false, speaking: false, raisedHand: false, isHost: false, isMe: true},
        ]);
        expect(selectors.getParticipants(stateWith(calls, deafened), 'voice')).toBe(participants);

        expect(selectors.getParticipants(stateWith({}), 'voice')).toEqual([]);
    });

    test('isDeafened', () => {
        const calls = {sessions: {voice: sessions}, localCall: {channelID: 'voice', sessionID: 's2', state: 'connected' as const}};
        expect(selectors.isDeafened(stateWith(calls))).toBe(false);
        expect(selectors.isDeafened(stateWith(calls, {s2: currentUserId}))).toBe(true);
        expect(selectors.isDeafened(stateWith({}))).toBe(false);
    });

    test('getAutoJoin follows the configuration', () => {
        expect(selectors.getAutoJoin(makeState({voice: {config: {autoJoin: true, allowVideo: true}}}))).toBe(true);
        expect(selectors.getAutoJoin(makeState({voice: {config: {autoJoin: false, allowVideo: true}}}))).toBe(false);
    });
});

describe('createVoiceChannelsAPI', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('exposes the contract', () => {
        const api = createVoiceChannelsAPI(makeStore(stateWith({})));
        expect(api.version).toBe(1);
        expect(Object.keys(api).sort()).toEqual(['autoJoin', 'join', 'leave', 'selectors', 'setDeafened', 'version']);
        expect(Object.keys(api.selectors).sort()).toEqual(['getAutoJoin', 'getParticipants', 'isDeafened', 'isVoiceChannel']);
    });

    test('drives the calls of voice channels', async () => {
        const store = makeStore(stateWith({localCall: {channelID: 'voice', sessionID: 's2', state: 'connected'}}));
        const api = createVoiceChannelsAPI(store);

        await api.join('voice', {leaveOtherCalls: true});
        expect(callControl.joinVoiceChannel).toHaveBeenCalledWith(store, 'voice', true);
        await api.join('voice');
        expect(callControl.joinVoiceChannel).toHaveBeenLastCalledWith(store, 'voice', false);

        api.autoJoin('voice');
        expect(callControl.autoJoinVoiceChannel).toHaveBeenCalledWith(store, 'voice');

        api.setDeafened(true);
        expect(callControl.setDeafened).toHaveBeenCalledWith(store, true);

        api.leave();
        expect(callControl.leaveCall).toHaveBeenCalledWith('voice');
    });

    test('leave does nothing outside of a call', () => {
        const api = createVoiceChannelsAPI(makeStore(stateWith({})));
        api.leave();
        expect(callControl.leaveCall).not.toHaveBeenCalled();
    });
});
