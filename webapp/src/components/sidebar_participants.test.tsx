// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {act, screen} from '@testing-library/react';
import React from 'react';

import type {Channel} from '@mattermost/types/channels';

import {makeState, makeStore, renderWithStore, teamId} from '../../tests/utils';

import SidebarParticipants from './sidebar_participants';

const channel = {id: 'voice', display_name: 'Lounge', delete_at: 0, team_id: teamId, type: 'O'} as Channel;

const session = (id: string, userId: string, extra = {}) => ({session_id: id, user_id: userId, unmuted: true, raised_hand: 0, ...extra});

describe('SidebarParticipants', () => {
    const users = [{id: 'u1', username: 'alice'}, {id: 'u2', username: 'bob'}];

    test('lists the people in the call with their state', () => {
        const store = makeStore(makeState({
            users,
            voice: {channels: {voice: teamId}, deafened: {voice: {s2: 'u2'}}},
            calls: {
                sessions: {voice: {s1: session('s1', 'u1', {voice: true}), s2: session('s2', 'u2', {unmuted: false})}},
                screenSharingIDs: {voice: 's1'},
            },
        }));

        renderWithStore(<SidebarParticipants channel={channel}/>, store);

        expect(screen.getByRole('list', {name: 'People in the call of Lounge'})).toBeInTheDocument();
        const items = screen.getAllByRole('listitem');
        expect(items).toHaveLength(2);
        expect(items[0]).toHaveTextContent('alice');
        expect(items[0]).toHaveClass('VoiceSidebarParticipant--speaking');
        expect(items[0]).toHaveAccessibleName('alice is speaking');
        expect(screen.getByRole('img', {name: 'Sharing their screen'})).toBeInTheDocument();
        expect(items[1]).toHaveTextContent('bob');
        expect(screen.getByRole('img', {name: 'Deafened'})).toBeInTheDocument();

        // Deafened implies muted, only the deafened icon is shown
        expect(screen.queryByRole('img', {name: 'Muted'})).not.toBeInTheDocument();
    });

    test('renders nothing for empty calls and regular channels', () => {
        const store = makeStore(makeState({
            users,
            voice: {channels: {voice: teamId}},
            calls: {sessions: {other: {s1: session('s1', 'u1')}}},
        }));
        const {container} = renderWithStore(<SidebarParticipants channel={channel}/>, store);
        expect(container).toBeEmptyDOMElement();

        act(() => store.setState(makeState({users, calls: {sessions: {voice: {s1: session('s1', 'u1')}}}})));
        expect(container).toBeEmptyDOMElement();
    });
});
