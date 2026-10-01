// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React from 'react';
import {useIntl} from 'react-intl';

import type {Participant} from '../selectors';

import {messages} from './messages';

type Props = {
    participant: Pick<Participant, 'muted' | 'deafened' | 'video' | 'screenSharing' | 'raisedHand'>;
};

type IconProps = {
    icon: string;
    label: string;
    modifier?: string;
};

function StatusIcon({icon, label, modifier}: IconProps) {
    return (
        <i
            className={`icon icon-${icon} VoiceStatusIcons__icon${modifier ? ` VoiceStatusIcons__icon--${modifier}` : ''}`}
            role='img'
            aria-label={label}
            title={label}
        />
    );
}

// ParticipantStatusIcons shows whether a participant raised their hand, shares their screen,
// has their camera on, or is deafened or muted.
export default function ParticipantStatusIcons({participant}: Props) {
    const {formatMessage} = useIntl();

    if (!participant.muted && !participant.deafened && !participant.video && !participant.screenSharing && !participant.raisedHand) {
        return null;
    }

    return (
        <span className='VoiceStatusIcons'>
            {participant.raisedHand && (
                <StatusIcon
                    icon='hand-right'
                    label={formatMessage(messages.raisedHand)}
                    modifier='hand'
                />
            )}
            {participant.screenSharing && (
                <StatusIcon
                    icon='monitor-share'
                    label={formatMessage(messages.screenSharing)}
                />
            )}
            {participant.video && (
                <StatusIcon
                    icon='video-outline'
                    label={formatMessage(messages.video)}
                />
            )}
            {participant.deafened && (
                <StatusIcon
                    icon='headphones'
                    label={formatMessage(messages.deafened)}
                    modifier='off'
                />
            )}
            {participant.muted && !participant.deafened && (
                <StatusIcon
                    icon='microphone-off'
                    label={formatMessage(messages.muted)}
                    modifier='muted'
                />
            )}
        </span>
    );
}
