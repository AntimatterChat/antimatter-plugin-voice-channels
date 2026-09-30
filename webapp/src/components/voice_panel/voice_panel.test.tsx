// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {fireEvent, screen} from '@testing-library/react';
import React from 'react';

import type {Channel} from '@mattermost/types/channels';

import {currentUserId, makeState, makeStore, renderWithStore, teamId} from '../../../tests/utils';
import * as callControl from '../../call_control';
import type {Participant} from '../../selectors';
import type CallsClient from '../../types/calls_client';

import VoicePanel, {buildTiles} from './voice_panel';

jest.mock('../../call_control', () => ({
    joinVoiceChannel: jest.fn(),
    leaveCall: jest.fn(),
}));

const channel = {id: 'voice', display_name: 'Lounge', delete_at: 0, team_id: teamId, type: 'O'} as Channel;
const users = [{id: currentUserId, username: 'me'}, {id: 'u2', username: 'bob'}];
const session = (id: string, userId: string, extra = {}) => ({session_id: id, user_id: userId, unmuted: true, raised_hand: 0, ...extra});

const participant = (sessionId: string, userId: string, extra: Partial<Participant> = {}): Participant => ({
    sessionId,
    userId,
    muted: false,
    deafened: false,
    video: false,
    screenSharing: false,
    speaking: false,
    raisedHand: false,
    ...extra,
});

describe('buildTiles', () => {
    const localVideo = {id: 'local'} as unknown as MediaStream;
    const remoteVideo = {id: 'remote'} as unknown as MediaStream;
    const screenStream = {id: 'screen'} as unknown as MediaStream;
    const media = {localVideo, screen: screenStream, videos: {s2: remoteVideo}};

    test('screen shares come first and cameras are shown when on', () => {
        const participants = [
            participant('s1', currentUserId, {video: true}),
            participant('s2', 'u2', {video: true, screenSharing: true}),
            participant('s3', 'u3'),
        ];

        const tiles = buildTiles(participants, media, 's1', currentUserId);
        expect(tiles.map((t) => [t.id, t.kind, t.stream, t.isCurrentUser])).toEqual([
            ['screen-s2', 'screen', screenStream, false],
            ['s1', 'participant', localVideo, true],
            ['s2', 'participant', remoteVideo, false],
            ['s3', 'participant', undefined, false],
        ]);
    });

    test('no media outside of the call', () => {
        const tiles = buildTiles([participant('s2', 'u2', {video: true, screenSharing: true})], null, '', currentUserId);
        expect(tiles.map((t) => t.stream)).toEqual([undefined, undefined]);
    });
});

describe('VoicePanel', () => {
    afterEach(() => {
        delete window.callsClient;
        jest.clearAllMocks();
    });

    const stateWithCall = (calls = {}) => makeState({
        users,
        channels: [channel],
        voice: {channels: {voice: teamId}},
        calls: {sessions: {voice: {s2: session('s2', 'u2')}}, ...calls},
    });

    test('offers to join when not in the call', () => {
        const store = makeStore(stateWithCall());
        renderWithStore(
            <VoicePanel
                channel={channel}
                messagesVisible={false}
                setMessagesVisible={jest.fn()}
            />,
            store,
        );

        expect(screen.getByRole('region', {name: 'Voice call'})).toBeInTheDocument();
        expect(screen.getByTestId('voiceTile-s2')).toHaveTextContent('bob');
        fireEvent.click(screen.getByRole('button', {name: /Join voice/}));
        expect(callControl.joinVoiceChannel).toHaveBeenCalledWith(store, 'voice', true);
        expect(screen.queryByTestId('voicePanelLeave')).not.toBeInTheDocument();
    });

    test('shows the call controls when in the call', () => {
        window.callsClient = {
            channelID: 'voice',
            localVideoStream: null,
            getSessionID: () => 's1',
            getLocalScreenStream: () => null,
            getRemoteScreenStream: () => null,
            getRemoteVideoStreams: () => ({}),
            on: jest.fn(),
            off: jest.fn(),
        } as unknown as CallsClient;
        const store = makeStore(stateWithCall({sessions: {voice: {s1: session('s1', currentUserId), s2: session('s2', 'u2')}}}));
        const setMessagesVisible = jest.fn();

        renderWithStore(
            <VoicePanel
                channel={channel}
                messagesVisible={false}
                setMessagesVisible={setMessagesVisible}
            />,
            store,
        );

        expect(screen.queryByRole('button', {name: /Join voice/})).not.toBeInTheDocument();
        expect(screen.getByTestId('voiceTile-s1')).toHaveTextContent('me (you)');

        fireEvent.click(screen.getByRole('button', {name: 'Disconnect'}));
        expect(callControl.leaveCall).toHaveBeenCalledWith('voice');
        fireEvent.click(screen.getByRole('button', {name: 'Show chat'}));
        expect(setMessagesVisible).toHaveBeenCalledWith(true);
    });

    test('points to the call window when the call runs in the desktop app', () => {
        const store = makeStore(stateWithCall({clientStateReducer: {channelID: 'voice', sessionID: 's1'}}));
        renderWithStore(
            <VoicePanel
                channel={channel}
                messagesVisible={true}
            />,
            store,
        );

        expect(screen.getByText('Cameras and screen shares are shown in the call window.')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Disconnect'})).toBeInTheDocument();

        // Without setMessagesVisible there's no chat toggle
        expect(screen.queryByTestId('voicePanelChatToggle')).not.toBeInTheDocument();
    });

    test('empty call', () => {
        const store = makeStore(stateWithCall({sessions: {}}));
        renderWithStore(
            <VoicePanel
                channel={channel}
                messagesVisible={false}
                setMessagesVisible={jest.fn()}
            />,
            store,
        );
        expect(screen.getByText('No one is here yet')).toBeInTheDocument();
    });
});
