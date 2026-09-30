// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type {GlobalState} from '@mattermost/types/store';

import {currentUserId, makeState, makeStore, teamId} from '../tests/utils';

import {
    LEAVE_TIMEOUT,
    autoJoinVoiceChannel,
    joinVoiceChannel,
    setDeafened,
    startDeafenController,
    stopDeafenController,
} from './call_control';
import * as client from './client';
import {isSessionDeafened} from './selectors';
import type {CallsPluginState} from './types/calls';
import type CallsClient from './types/calls_client';

jest.mock('./client', () => ({
    setSessionDeafened: jest.fn(() => Promise.resolve({})),
}));

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

describe('deafen', () => {
    const callsInCall = (unmuted: boolean): CallsPluginState => ({
        sessions: {voice1: {mysession: {session_id: 'mysession', user_id: currentUserId, unmuted, raised_hand: 0}}},
    });
    const inCall = (unmuted: boolean) => stateWith(callsInCall(unmuted));

    afterEach(() => {
        stopDeafenController();
        delete window.callsClient;
        jest.clearAllMocks();
    });

    test('deafening disables the call audio and mutes, undeafening restores both', async () => {
        const callsClient = fakeCallsClient('voice1');
        window.callsClient = callsClient as unknown as CallsClient;
        const store = makeStore(inCall(true));
        startDeafenController(store);

        await setDeafened(store, true);
        expect(isSessionDeafened(store.getState(), 'voice1', 'mysession')).toBe(true);
        expect(callsClient.tracks.map((t) => t.enabled)).toEqual([false, false]);
        expect(callsClient.mute).toHaveBeenCalled();
        expect(client.setSessionDeafened).toHaveBeenCalledWith('voice1', 'mysession', true);

        // New remote audio stays disabled
        const newTrack = {enabled: true};
        callsClient.emit('remoteVoiceStream', {getAudioTracks: () => [newTrack]});
        expect(newTrack.enabled).toBe(false);

        // Calls reports the mute
        setCallsState(store, callsInCall(false));
        expect(isSessionDeafened(store.getState(), 'voice1', 'mysession')).toBe(true);

        await setDeafened(store, false);
        expect(isSessionDeafened(store.getState(), 'voice1', 'mysession')).toBe(false);
        expect(callsClient.tracks.map((t) => t.enabled)).toEqual([true, true]);
        expect(callsClient.unmute).toHaveBeenCalled();
        expect(client.setSessionDeafened).toHaveBeenLastCalledWith('voice1', 'mysession', false);
    });

    test('unmuting undeafens', async () => {
        const callsClient = fakeCallsClient('voice1');
        window.callsClient = callsClient as unknown as CallsClient;
        const store = makeStore(inCall(false));
        startDeafenController(store);

        await setDeafened(store, true);
        expect(isSessionDeafened(store.getState(), 'voice1', 'mysession')).toBe(true);

        // The user unmutes in the call widget
        setCallsState(store, callsInCall(true));
        expect(isSessionDeafened(store.getState(), 'voice1', 'mysession')).toBe(false);
        expect(callsClient.tracks.map((t) => t.enabled)).toEqual([true, true]);
        expect(client.setSessionDeafened).toHaveBeenLastCalledWith('voice1', 'mysession', false);
    });

    test('ending the call undeafens', async () => {
        const callsClient = fakeCallsClient('voice1');
        window.callsClient = callsClient as unknown as CallsClient;
        const store = makeStore(inCall(false));
        startDeafenController(store);

        await setDeafened(store, true);
        expect(callsClient.mute).not.toHaveBeenCalled(); // already muted

        delete window.callsClient;
        setCallsState(store, {});
        expect(isSessionDeafened(store.getState(), 'voice1', 'mysession')).toBe(false);
        expect(client.setSessionDeafened).toHaveBeenLastCalledWith('voice1', 'mysession', false);
    });

    test('does nothing outside of a call of this window', async () => {
        const store = makeStore(inCall(true));
        startDeafenController(store);
        await setDeafened(store, true);
        expect(client.setSessionDeafened).not.toHaveBeenCalled();
    });
});

// setCallsState replaces the state of the Calls plugin.
function setCallsState(store: ReturnType<typeof makeStore>, calls: CallsPluginState) {
    store.setState({...store.getState(), 'plugins-com.mattermost.calls': calls} as GlobalState);
}
