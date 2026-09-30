// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React, {useCallback, useMemo, useState} from 'react';
import {FormattedMessage, defineMessages, useIntl} from 'react-intl';
import {useSelector, useStore} from 'react-redux';

import type {Channel} from '@mattermost/types/channels';
import type {GlobalState} from '@mattermost/types/store';

import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import {joinVoiceChannel, leaveCall, setDeafened} from '../../call_control';
import {
    getCurrentCallChannelId,
    getMySessionId,
    getParticipants,
    isCallsAvailable,
    isSessionDeafened,
    type Participant,
} from '../../selectors';
import type {PluginStore} from '../../types/host';

import {useCallMedia, type CallMedia} from './use_call_media';
import VoiceTile, {type TileKind} from './voice_tile';

const messages = defineMessages({
    stage: {id: 'voice_channels.stage.label', defaultMessage: 'Voice call'},
    join: {id: 'voice_channels.stage.join', defaultMessage: 'Join voice'},
    leave: {id: 'voice_channels.stage.leave', defaultMessage: 'Disconnect'},
    deafen: {id: 'voice_channels.stage.deafen', defaultMessage: 'Deafen'},
    undeafen: {id: 'voice_channels.stage.undeafen', defaultMessage: 'Undeafen'},
    showChat: {id: 'voice_channels.stage.show_chat', defaultMessage: 'Show chat'},
    hideChat: {id: 'voice_channels.stage.hide_chat', defaultMessage: 'Hide chat'},
});

export type Tile = {
    id: string;
    kind: TileKind;
    participant: Participant;
    stream?: MediaStream | null;
    isCurrentUser: boolean;
};

// buildTiles returns the tiles of the stage: the screen share first, then every participant
// with their camera when it's on. Media is only available when in the call in this window.
export function buildTiles(participants: Participant[], media: CallMedia | null, mySessionId: string, currentUserId: string): Tile[] {
    const screenTiles: Tile[] = [];
    const participantTiles: Tile[] = [];

    for (const participant of participants) {
        const isMe = participant.sessionId === mySessionId;
        const isCurrentUser = participant.userId === currentUserId;

        let camera: MediaStream | null | undefined;
        if (media && participant.video) {
            camera = isMe ? media.localVideo : media.videos[participant.sessionId];
        }
        participantTiles.push({id: participant.sessionId, kind: 'participant', participant, stream: camera, isCurrentUser});

        if (participant.screenSharing) {
            screenTiles.push({
                id: `screen-${participant.sessionId}`,
                kind: 'screen',
                participant,
                stream: media?.screen,
                isCurrentUser,
            });
        }
    }

    return [...screenTiles, ...participantTiles];
}

type Props = {
    channel: Channel;
    messagesVisible: boolean;

    // Missing when the host shows the panel on its own (e.g. in the right-hand sidebar)
    setMessagesVisible?: (visible: boolean) => void;
};

// VoicePanel is the stage of a voice channel: a tile for every participant and screen share,
// and the controls the Calls widget doesn't have.
export default function VoicePanel({channel, messagesVisible, setMessagesVisible}: Props) {
    const {formatMessage} = useIntl();
    const store = useStore() as PluginStore;

    const participants = useSelector((state: GlobalState) => getParticipants(state, channel.id));
    const currentUserId = useSelector(getCurrentUserId);
    const inThisCall = useSelector((state: GlobalState) => getCurrentCallChannelId(state) === channel.id);
    const mySessionId = useSelector((state: GlobalState) => (inThisCall ? getMySessionId(state) : ''));
    const deafened = useSelector((state: GlobalState) => isSessionDeafened(state, channel.id, mySessionId));
    const callsAvailable = useSelector(isCallsAvailable);

    // The call's media is only in this window when it runs here (not in the desktop app's call window)
    const callsClient = (inThisCall && window.callsClient) || null;
    const media = useCallMedia(callsClient);

    const [focusedTileId, setFocusedTileId] = useState('');

    const tiles = useMemo(
        () => buildTiles(participants, callsClient ? media : null, mySessionId, currentUserId),
        [participants, callsClient, media, mySessionId, currentUserId],
    );
    const focusedTile = tiles.find((tile) => tile.id === focusedTileId);

    const handleToggleFocus = useCallback((tileId: string) => {
        setFocusedTileId((current) => (current === tileId ? '' : tileId));
    }, []);
    const handleJoin = useCallback(() => joinVoiceChannel(store, channel.id, true), [store, channel.id]);
    const handleLeave = useCallback(() => leaveCall(channel.id), [channel.id]);
    const handleDeafen = useCallback(() => setDeafened(store, !deafened), [store, deafened]);
    const handleToggleChat = useCallback(() => setMessagesVisible?.(!messagesVisible), [setMessagesVisible, messagesVisible]);

    const renderTile = (tile: Tile, small = false) => (
        <VoiceTile
            key={tile.id}
            id={tile.id}
            kind={tile.kind}
            participant={tile.participant}
            stream={tile.stream}
            isCurrentUser={tile.isCurrentUser}
            focused={tile.id === focusedTileId}
            small={small}
            onToggleFocus={handleToggleFocus}
        />
    );

    let body;
    if (tiles.length === 0) {
        body = (
            <div className='VoicePanel__empty'>
                <i className='icon icon-phone-in-talk'/>
                <p>
                    <FormattedMessage
                        id='voice_channels.stage.empty'
                        defaultMessage='No one is here yet'
                    />
                </p>
            </div>
        );
    } else if (focusedTile) {
        body = (
            <div className='VoicePanel__focusLayout'>
                <div className='VoicePanel__focused'>{renderTile(focusedTile)}</div>
                {tiles.length > 1 && (
                    <div className='VoicePanel__strip'>
                        {tiles.filter((tile) => tile !== focusedTile).map((tile) => renderTile(tile, true))}
                    </div>
                )}
            </div>
        );
    } else {
        let gridClass = 'VoicePanel__grid';
        if (tiles.length === 1) {
            gridClass += ' VoicePanel__grid--single';
        } else if (tiles.length <= 4) {
            gridClass += ' VoicePanel__grid--few';
        }
        body = <div className={gridClass}>{tiles.map((tile) => renderTile(tile))}</div>;
    }

    return (
        <section
            className='VoicePanel'
            aria-label={formatMessage(messages.stage)}
            data-testid='voicePanel'
        >
            <div className='VoicePanel__body'>
                {body}
            </div>
            {!callsAvailable && (
                <p className='VoicePanel__notice'>
                    <FormattedMessage
                        id='voice_channels.stage.calls_unavailable'
                        defaultMessage='Calls are unavailable. Ask your system administrator to enable the Calls plugin.'
                    />
                </p>
            )}
            {inThisCall && !callsClient && (
                <p className='VoicePanel__notice'>
                    <FormattedMessage
                        id='voice_channels.stage.call_window'
                        defaultMessage='Cameras and screen shares are shown in the call window.'
                    />
                </p>
            )}
            <div className='VoicePanel__footer'>
                {!inThisCall && (
                    <button
                        type='button'
                        className='btn btn-primary VoicePanel__join'
                        onClick={handleJoin}
                        disabled={!callsAvailable}
                    >
                        <i className='icon icon-phone-in-talk'/>
                        {formatMessage(messages.join)}
                    </button>
                )}
                {inThisCall && callsClient && (
                    <button
                        type='button'
                        className={`VoicePanel__control${deafened ? ' VoicePanel__control--danger' : ''}`}
                        aria-label={formatMessage(deafened ? messages.undeafen : messages.deafen)}
                        aria-pressed={deafened}
                        title={formatMessage(deafened ? messages.undeafen : messages.deafen)}
                        onClick={handleDeafen}
                        data-testid='voicePanelDeafen'
                    >
                        <i className={`icon icon-headphones${deafened ? ' VoicePanel__deafenedIcon' : ''}`}/>
                    </button>
                )}
                {inThisCall && (
                    <button
                        type='button'
                        className='VoicePanel__control VoicePanel__control--danger'
                        aria-label={formatMessage(messages.leave)}
                        title={formatMessage(messages.leave)}
                        onClick={handleLeave}
                        data-testid='voicePanelLeave'
                    >
                        <i className='icon icon-phone-hangup'/>
                    </button>
                )}
                {setMessagesVisible && (
                    <button
                        type='button'
                        className={`VoicePanel__control VoicePanel__chatToggle${messagesVisible ? ' VoicePanel__control--active' : ''}`}
                        aria-label={formatMessage(messagesVisible ? messages.hideChat : messages.showChat)}
                        aria-pressed={messagesVisible}
                        title={formatMessage(messagesVisible ? messages.hideChat : messages.showChat)}
                        onClick={handleToggleChat}
                        data-testid='voicePanelChatToggle'
                    >
                        <i className='icon icon-message-text-outline'/>
                    </button>
                )}
            </div>
        </section>
    );
}
