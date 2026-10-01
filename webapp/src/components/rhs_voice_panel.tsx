// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage} from 'react-intl';
import {useSelector} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';

import {getCurrentChannel} from 'mattermost-redux/selectors/entities/channels';

import {isActiveVoiceChannel} from '../selectors';

import VoicePanel from './voice_panel/voice_panel';

// RHSVoicePanel shows the stage of the current voice channel in the right-hand sidebar, for
// hosts that can't show it in the channel view.
export default function RHSVoicePanel() {
    const channel = useSelector(getCurrentChannel);
    const isVoice = useSelector((state: GlobalState) => Boolean(channel && isActiveVoiceChannel(state, channel)));

    if (!channel || !isVoice) {
        return (
            <p className='VoicePanel__notice'>
                <FormattedMessage
                    id='voice_channels.rhs.not_voice'
                    defaultMessage='This channel is not a voice channel.'
                />
            </p>
        );
    }

    return (
        <VoicePanel
            channel={channel}
            messagesVisible={true}
        />
    );
}
