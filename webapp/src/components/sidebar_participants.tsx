// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React, {memo} from 'react';
import {useIntl} from 'react-intl';
import {useSelector} from 'react-redux';

import type {Channel} from '@mattermost/types/channels';
import type {GlobalState} from '@mattermost/types/store';

import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import {getParticipants, isActiveVoiceChannel, type Participant} from '../selectors';

import {messages} from './messages';
import ParticipantStatusIcons from './participant_status_icons';
import {useUser} from './use_user';

type Props = {
    channel: Channel;
};

// SidebarParticipants lists the people in the call of a voice channel, below the channel in
// the sidebar.
function SidebarParticipants({channel}: Props) {
    const {formatMessage} = useIntl();
    const isVoice = useSelector((state: GlobalState) => isActiveVoiceChannel(state, channel));
    const participants = useSelector((state: GlobalState) => getParticipants(state, channel.id));

    if (!isVoice || participants.length === 0) {
        return null;
    }

    return (
        <ul
            className='VoiceSidebarParticipants'
            aria-label={formatMessage(messages.participants, {channel: channel.display_name})}
            data-testid={`voiceSidebarParticipants-${channel.id}`}
        >
            {participants.map((participant) => (
                <SidebarParticipant
                    key={participant.sessionId}
                    participant={participant}
                />
            ))}
        </ul>
    );
}

function SidebarParticipant({participant}: {participant: Participant}) {
    const {formatMessage} = useIntl();
    const {displayName, imageURL} = useUser(participant.userId);
    const isCurrentUser = useSelector((state: GlobalState) => getCurrentUserId(state) === participant.userId);

    let className = 'VoiceSidebarParticipant';
    if (participant.speaking) {
        className += ' VoiceSidebarParticipant--speaking';
    }

    return (
        <li
            className={className}
            {...(participant.speaking ? {'aria-label': formatMessage(messages.speaking, {name: displayName})} : {})}
        >
            <img
                className='VoiceSidebarParticipant__avatar'
                src={imageURL}
                alt=''
            />
            <span className={`VoiceSidebarParticipant__name${isCurrentUser ? ' VoiceSidebarParticipant__name--you' : ''}`}>
                {displayName}
            </span>
            <ParticipantStatusIcons participant={participant}/>
        </li>
    );
}

export default memo(SidebarParticipants);
