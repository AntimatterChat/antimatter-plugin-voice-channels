// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {RECEIVED_CONFIG, RECEIVED_VOICE_CHANNEL, RECEIVED_VOICE_CHANNELS, SESSION_DEAFENED} from './action_types';
import reducer, {defaultConfig} from './reducer';

describe('reducer', () => {
    const initial = reducer(undefined, {type: '@@INIT'});

    test('initial state', () => {
        expect(initial).toEqual({config: defaultConfig, channels: {}, deafened: {}});
    });

    test('config', () => {
        const state = reducer(initial, {type: RECEIVED_CONFIG, data: {auto_join: false, allow_video: true}});
        expect(state.config).toEqual({autoJoin: false, allowVideo: true});
    });

    test('voice channels list replaces the known channels', () => {
        let state = reducer(initial, {type: RECEIVED_VOICE_CHANNEL, data: {channel_id: 'old', team_id: 't', voice: true, deafened_sessions: {s0: 'u0'}}});
        state = reducer(state, {type: RECEIVED_VOICE_CHANNELS,
            data: [
                {channel_id: 'a', team_id: 'team1', voice: true, deafened_sessions: {s1: 'u1'}},
                {channel_id: 'b', team_id: 'team2', voice: true, deafened_sessions: {}},
            ]});
        expect(state.channels).toEqual({a: 'team1', b: 'team2'});
        expect(state.deafened).toEqual({a: {s1: 'u1'}, b: {}});
    });

    test('single voice channel', () => {
        let state = reducer(initial, {type: RECEIVED_VOICE_CHANNEL, data: {channel_id: 'a', team_id: 'team1', voice: true, deafened_sessions: {s1: 'u1'}}});
        expect(state.channels).toEqual({a: 'team1'});
        expect(state.deafened).toEqual({a: {s1: 'u1'}});

        // Unchanged state is kept
        const same = reducer(state, {type: RECEIVED_VOICE_CHANNEL, data: {channel_id: 'a', team_id: 'team1', voice: true, deafened_sessions: {s1: 'u1'}}});
        expect(same.channels).toBe(state.channels);

        state = reducer(state, {type: RECEIVED_VOICE_CHANNEL, data: {channel_id: 'a', team_id: 'team1', voice: false, deafened_sessions: {}}});
        expect(state.channels).toEqual({a: false});
        expect(state.deafened).toEqual({});
    });

    test('deafened sessions', () => {
        let state = reducer(initial, {type: SESSION_DEAFENED, data: {channelId: 'a', sessionId: 's1', userId: 'u1', deafened: true}});
        expect(state.deafened).toEqual({a: {s1: 'u1'}});

        const same = reducer(state, {type: SESSION_DEAFENED, data: {channelId: 'a', sessionId: 's1', userId: 'u1', deafened: true}});
        expect(same).toBe(state);

        state = reducer(state, {type: SESSION_DEAFENED, data: {channelId: 'a', sessionId: 's1', userId: 'u1', deafened: false}});
        expect(state.deafened).toEqual({a: {}});

        const unchanged = reducer(state, {type: SESSION_DEAFENED, data: {channelId: 'a', sessionId: 'unknown', userId: 'u1', deafened: false}});
        expect(unchanged).toBe(state);
    });
});
