// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React, {memo, useCallback, useRef} from 'react';
import {defineMessages, useIntl} from 'react-intl';

import type {Participant} from '../../selectors';
import {messages as sharedMessages} from '../messages';
import ParticipantStatusIcons from '../participant_status_icons';
import {useUser} from '../use_user';

import VideoStream from './video_stream';

const messages = defineMessages({
    fullscreen: {id: 'voice_channels.stage.fullscreen', defaultMessage: 'Full screen'},
    screenOf: {id: 'voice_channels.stage.screen_of', defaultMessage: "{name}'s screen"},
    focus: {id: 'voice_channels.stage.focus', defaultMessage: 'Focus on {name}'},
});

export type TileKind = 'participant' | 'screen';

type Props = {
    id: string;
    kind: TileKind;
    participant: Participant;
    stream?: MediaStream | null;
    isCurrentUser: boolean;
    focused: boolean;
    small?: boolean;
    onToggleFocus: (id: string) => void;
};

// VoiceTile shows a participant of a call (their camera or their picture) or a screen share.
function VoiceTile({id, kind, participant, stream, isCurrentUser, focused, small, onToggleFocus}: Props) {
    const {formatMessage} = useIntl();
    const tileRef = useRef<HTMLDivElement>(null);
    const {displayName, imageURL} = useUser(participant.userId);

    const name = isCurrentUser ? formatMessage(sharedMessages.you, {name: displayName}) : displayName;
    const label = kind === 'screen' ? formatMessage(messages.screenOf, {name: displayName}) : name;

    const handleClick = useCallback(() => onToggleFocus(id), [id, onToggleFocus]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleFocus(id);
        }
    }, [id, onToggleFocus]);

    const handleFullscreen = useCallback(() => {
        const tile = tileRef.current;
        if (!tile) {
            return;
        }
        const ignore = () => {
            // Full screen can be refused, e.g. without a user gesture
        };
        if (document.fullscreenElement === tile) {
            document.exitFullscreen?.().catch(ignore);
        } else {
            tile.requestFullscreen?.().catch(ignore);
        }
    }, []);

    let className = `VoiceTile VoiceTile--${kind}`;
    if (participant.speaking && kind === 'participant') {
        className += ' VoiceTile--speaking';
    }
    if (focused) {
        className += ' VoiceTile--focused';
    }
    if (small) {
        className += ' VoiceTile--small';
    }

    return (
        <div
            ref={tileRef}
            className={className}
            data-testid={`voiceTile-${id}`}
        >
            <div
                className='VoiceTile__content'
                role='button'
                tabIndex={0}
                aria-pressed={focused}
                aria-label={formatMessage(messages.focus, {name: label})}
                onClick={handleClick}
                onKeyDown={handleKeyDown}
            >
                {stream ? (
                    <VideoStream
                        className={`VoiceTile__video${kind === 'screen' ? ' VoiceTile__video--contain' : ''}`}
                        stream={stream}
                        mirrored={isCurrentUser && kind === 'participant'}
                    />
                ) : (
                    <img
                        className='VoiceTile__avatar'
                        src={imageURL}
                        alt=''
                    />
                )}
                <div className='VoiceTile__label'>
                    <span className='VoiceTile__name'>{label}</span>
                    {kind === 'participant' && <ParticipantStatusIcons participant={participant}/>}
                </div>
            </div>
            {stream && (
                <button
                    type='button'
                    className='VoiceTile__fullscreen'
                    aria-label={formatMessage(messages.fullscreen)}
                    title={formatMessage(messages.fullscreen)}
                    onClick={handleFullscreen}
                >
                    <i className='icon icon-arrow-expand'/>
                </button>
            )}
        </div>
    );
}

export default memo(VoiceTile);
