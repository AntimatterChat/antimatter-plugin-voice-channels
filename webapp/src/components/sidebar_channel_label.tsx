// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React, {useEffect, useRef} from 'react';
import {useSelector, useStore} from 'react-redux';

import type {Channel} from '@mattermost/types/channels';
import type {GlobalState} from '@mattermost/types/store';

import {autoJoinVoiceChannel} from '../call_control';
import {getParticipants, isActiveVoiceChannel} from '../selectors';
import type {PluginStore} from '../types/host';

import {profileImageURL} from './use_user';

const MAX_AVATARS = 3;

function noCleanup() {
    // Nothing to clean up
}

type Props = {
    channel: Channel;

    // Whether to show the avatars of the participants next to the channel name, for hosts that
    // can't show them below the channel.
    showAvatars: boolean;
};

// SidebarChannelLabel is rendered in the sidebar link of every channel. For voice channels, it
// joins the call when the link is clicked (like opening a voice room) and can show who's in it.
export function SidebarChannelLabel({channel, showAvatars}: Props) {
    const store = useStore() as PluginStore;
    const ref = useRef<HTMLSpanElement>(null);
    const isVoice = useSelector((state: GlobalState) => isActiveVoiceChannel(state, channel));
    const participants = useSelector((state: GlobalState) => getParticipants(state, channel.id));

    useEffect(() => {
        const link = ref.current?.closest('a');
        if (!isVoice || !link) {
            return noCleanup;
        }

        const onClick = (e: MouseEvent) => {
            // Only plain clicks open the channel, others select channels or open new tabs
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
                return;
            }
            autoJoinVoiceChannel(store, channel.id);
        };
        link.addEventListener('click', onClick);
        return () => link.removeEventListener('click', onClick);
    }, [isVoice, channel.id, store]);

    if (!isVoice) {
        return null;
    }

    return (
        <span
            ref={ref}
            className='VoiceSidebarLabel'
        >
            {showAvatars && participants.slice(0, MAX_AVATARS).map((p) => (
                <img
                    key={p.sessionId}
                    className={`VoiceSidebarLabel__avatar${p.speaking ? ' VoiceSidebarLabel__avatar--speaking' : ''}`}
                    src={profileImageURL(p.userId)}
                    alt=''
                />
            ))}
            {showAvatars && participants.length > MAX_AVATARS && (
                <span className='VoiceSidebarLabel__more'>{`+${participants.length - MAX_AVATARS}`}</span>
            )}
        </span>
    );
}

type LabelProps = {
    channel: Channel;
};

// makeSidebarChannelLabel returns the component to register as sidebar channel label.
export default function makeSidebarChannelLabel(showAvatars: boolean) {
    return function VoiceSidebarChannelLabel({channel}: LabelProps) {
        return (
            <SidebarChannelLabel
                channel={channel}
                showAvatars={showAvatars}
            />
        );
    };
}
