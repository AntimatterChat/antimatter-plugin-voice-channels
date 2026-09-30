// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type {Channel} from '@mattermost/types/channels';

import {makeState} from '../tests/utils';

import {
    getCurrentCallChannelId,
    getMySessionId,
    getParticipants,
    isActiveVoiceChannel,
    isCallsAvailable,
    isKnownChannel,
    isSessionDeafened,
} from './selectors';
import type CallsClient from './types/calls_client';

const session = (id: string, userId: string, extra = {}) => ({session_id: id, user_id: userId, unmuted: false, raised_hand: 0, ...extra});

describe('selectors', () => {
    afterEach(() => {
        delete window.callsClient;
    });

    test('voice channels', () => {
        const state = makeState({voice: {channels: {voice: 'team', text: false}}});
        expect(isActiveVoiceChannel(state, {id: 'voice', delete_at: 0} as Channel)).toBe(true);
        expect(isActiveVoiceChannel(state, {id: 'voice', delete_at: 1} as Channel)).toBe(false);
        expect(isActiveVoiceChannel(state, {id: 'text', delete_at: 0} as Channel)).toBe(false);
        expect(isKnownChannel(state, 'text')).toBe(true);
        expect(isKnownChannel(state, 'other')).toBe(false);
    });

    test('calls availability', () => {
        expect(isCallsAvailable(makeState())).toBe(true);
        expect(isCallsAvailable(makeState({calls: null}))).toBe(false);
    });

    test('current call', () => {
        const state = makeState({calls: {clientStateReducer: {channelID: 'desktop-call', sessionID: 'desktop-session'}}});

        // With the desktop app, the call runs in another window
        expect(getCurrentCallChannelId(state)).toBe('desktop-call');
        expect(getMySessionId(state)).toBe('desktop-session');

        window.callsClient = {channelID: 'browser-call', getSessionID: () => 'browser-session'} as unknown as CallsClient;
        expect(getCurrentCallChannelId(state)).toBe('browser-call');
        expect(getMySessionId(state)).toBe('browser-session');

        expect(getCurrentCallChannelId(makeState({calls: null}))).toBe('browser-call');
    });

    test('participants', () => {
        const calls = {
            sessions: {
                channel: {
                    s1: session('s1', 'u1', {unmuted: true, voice: true}),
                    s2: session('s2', 'u2', {video: true, raised_hand: 1234}),
                    s3: session('s3', 'u3', {voice: true}),
                },
            },
            screenSharingIDs: {channel: 's2'},
        };
        const state = makeState({calls, voice: {deafened: {channel: {s3: 'u3'}}}});

        const participants = getParticipants(state, 'channel');
        expect(participants).toEqual([
            {sessionId: 's1', userId: 'u1', muted: false, deafened: false, video: false, screenSharing: false, speaking: true, raisedHand: false},
            {sessionId: 's2', userId: 'u2', muted: true, deafened: false, video: true, screenSharing: true, speaking: false, raisedHand: true},

            // Voice activity of muted sessions isn't speaking
            {sessionId: 's3', userId: 'u3', muted: true, deafened: true, video: false, screenSharing: false, speaking: false, raisedHand: false},
        ]);

        // Memoized while the call doesn't change
        expect(getParticipants({...state} as typeof state, 'channel')).toBe(participants);

        expect(getParticipants(state, 'other')).toEqual([]);
        expect(isSessionDeafened(state, 'channel', 's3')).toBe(true);
        expect(isSessionDeafened(state, 'channel', 's1')).toBe(false);
        expect(isSessionDeafened(state, 'channel', '')).toBe(false);
    });
});
