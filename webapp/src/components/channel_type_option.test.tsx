// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {fireEvent, screen} from '@testing-library/react';
import React from 'react';

import {makeState, makeStore, renderWithStore, teamId} from '../../tests/utils';
import type {NewChannelFormState} from '../types/host';

import VoiceChannelPrivacy, {newVoiceChannelType} from './channel_type_option';

const form = (privacy?: 'O' | 'P'): NewChannelFormState => ({teamId, displayName: 'Lounge', url: 'lounge', purpose: '', type: 'voice', privacy});

describe('VoiceChannelPrivacy', () => {
    test('asks whether the channel is public or private, public first', () => {
        renderWithStore(<VoiceChannelPrivacy formState={form()}/>, makeStore(makeState({})));

        expect(screen.getByRole('radio', {name: /Public/})).toBeChecked();
        expect(newVoiceChannelType(form())).toBe('O');

        fireEvent.click(screen.getByRole('radio', {name: /Private/}));
        expect(newVoiceChannelType(form())).toBe('P');
    });

    test('leaves the choice to a host that asks it for every channel', () => {
        renderWithStore(<VoiceChannelPrivacy formState={form('P')}/>, makeStore(makeState({})));

        expect(screen.queryByRole('radio')).toBeNull();
        expect(newVoiceChannelType(form('P'))).toBe('P');
        expect(newVoiceChannelType(form('O'))).toBe('O');
    });
});
