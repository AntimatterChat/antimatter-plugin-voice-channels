// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {makeState, makeStore, teamId} from '../tests/utils';

import {LEAVE_TIMEOUT, autoJoinVoiceChannel, joinVoiceChannel} from './call_control';
import type {CallsPluginState} from './types/calls';
import type CallsClient from './types/calls_client';

const channels = [{id: 'voice1'}, {id: 'voice2'}, {id: 'dm', type: 'D'}];

function stateWith(calls: CallsPluginState, voice = {channels: {voice1: teamId, voice2: teamId} as {[id: string]: string | false}}) {
    return makeState({calls, channels, voice});
}

type Listener = (...args: unknown[]) => void;

type FakeCallsClient = {
    channelID: string;
    localVideoStream: null;
    getSessionID: () => string;
    mute: jest.Mock;
    unmute: jest.Mock;
    disconnect: jest.Mock;
    getLocalScreenStream: () => null;
    getRemoteScreenStream: () => null;
    getRemoteVoiceTracks: () => MediaStreamTrack[];
    on: jest.Mock;
    off: jest.Mock;
    emit: (event: string, ...args: unknown[]) => void;
    tracks: MediaStreamTrack[];
};

function fakeCallsClient(channelID: string, sessionID = 'mysession'): FakeCallsClient {
    const listeners: {[event: string]: Listener[]} = {};
    const tracks = [{enabled: true}, {enabled: true}] as MediaStreamTrack[];
    const callsClient: FakeCallsClient = {
        channelID,
        localVideoStream: null,
        getSessionID: () => sessionID,
        mute: jest.fn(),
        unmute: jest.fn(() => Promise.resolve()),
        disconnect: jest.fn(),
        getLocalScreenStream: () => null,
        getRemoteScreenStream: () => null,
        getRemoteVoiceTracks: () => tracks,
        on: jest.fn((event: string, listener: Listener) => {
            listeners[event] = [...(listeners[event] || []), listener];
            return callsClient;
        }),
        off: jest.fn((event: string, listener: Listener) => {
            listeners[event] = (listeners[event] || []).filter((l) => l !== listener);
            return callsClient;
        }),
        emit: (event: string, ...args: unknown[]) => listeners[event]?.forEach((l) => l(...args)),
        tracks,
    };
    return callsClient;
}

describe('joinVoiceChannel', () => {
    let postMessage: jest.SpyInstance;

    beforeEach(() => {
        postMessage = jest.spyOn(window, 'postMessage').mockImplementation(() => {});
    });

    afterEach(() => {
        postMessage.mockRestore();
        delete window.callsClient;
        jest.useRealTimers();
    });

    const joinMessage = (channelId: string) => ({
        type: 'calls-run-slash-command',
        message: '/call join',
        args: {channel_id: channelId, team_id: teamId},
    });

    test('joins when not in a call', async () => {
        const store = makeStore(stateWith({}));
        expect(await joinVoiceChannel(store, 'voice1', false)).toBe(true);
        expect(postMessage).toHaveBeenCalledWith(joinMessage('voice1'), window.origin);
    });

    test('does nothing when already in the call', async () => {
        window.callsClient = fakeCallsClient('voice1') as unknown as CallsClient;
        const store = makeStore(stateWith({}));
        expect(await joinVoiceChannel(store, 'voice1', false)).toBe(false);
        expect(postMessage).not.toHaveBeenCalled();
    });

    test('switches from the call of another voice channel', async () => {
        const callsClient = fakeCallsClient('voice1');
        callsClient.disconnect.mockImplementation(() => {
            delete window.callsClient;
        });
        window.callsClient = callsClient as unknown as CallsClient;
        const store = makeStore(stateWith({}));

        const joining = joinVoiceChannel(store, 'voice2', false);
        expect(callsClient.disconnect).toHaveBeenCalled();
        expect(postMessage).not.toHaveBeenCalled();

        // Calls updates its state when the call is left
        store.setState(stateWith({clientStateReducer: null}));
        expect(await joining).toBe(true);
        expect(postMessage).toHaveBeenCalledWith(joinMessage('voice2'), window.origin);
    });

    test('only leaves other kinds of calls when asked to', async () => {
        // A direct message call in the desktop app's call window
        const store = makeStore(stateWith({clientStateReducer: {channelID: 'dm', sessionID: 's'}}));
        expect(await joinVoiceChannel(store, 'voice1', false)).toBe(false);
        expect(postMessage).not.toHaveBeenCalled();

        const joining = joinVoiceChannel(store, 'voice1', true);
        expect(postMessage).toHaveBeenCalledWith({
            type: 'calls-run-slash-command',
            message: '/call leave',
            args: {channel_id: 'dm', team_id: ''},
        }, window.origin);
        store.setState(stateWith({clientStateReducer: null}));
        expect(await joining).toBe(true);
        expect(postMessage).toHaveBeenLastCalledWith(joinMessage('voice1'), window.origin);
    });

    test('gives up when the previous call is not left', async () => {
        jest.useFakeTimers();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const store = makeStore(stateWith({clientStateReducer: {channelID: 'voice1', sessionID: 's'}}));

        const joining = joinVoiceChannel(store, 'voice2', false);
        jest.advanceTimersByTime(LEAVE_TIMEOUT);
        expect(await joining).toBe(false);
        expect(postMessage).toHaveBeenCalledTimes(1); // only the leave
    });

    test('auto join follows the configuration', async () => {
        const store = makeStore(makeState({channels, voice: {channels: {voice1: teamId, text: false}, config: {autoJoin: false, allowVideo: true}}}));
        autoJoinVoiceChannel(store, 'voice1');

        const autoStore = makeStore(stateWith({}));
        autoJoinVoiceChannel(autoStore, 'text');
        expect(postMessage).not.toHaveBeenCalled();

        autoJoinVoiceChannel(autoStore, 'voice1');
        await Promise.resolve();
        expect(postMessage).toHaveBeenCalledWith(joinMessage('voice1'), window.origin);
    });
});
