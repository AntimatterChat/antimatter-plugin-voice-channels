// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {defineMessages} from 'react-intl';

export const messages = defineMessages({
    muted: {id: 'voice_channels.status.muted', defaultMessage: 'Muted'},
    deafened: {id: 'voice_channels.status.deafened', defaultMessage: 'Deafened'},
    video: {id: 'voice_channels.status.video', defaultMessage: 'Camera on'},
    screenSharing: {id: 'voice_channels.status.screen_sharing', defaultMessage: 'Sharing their screen'},
    raisedHand: {id: 'voice_channels.status.raised_hand', defaultMessage: 'Raised hand'},
    speaking: {id: 'voice_channels.status.speaking', defaultMessage: '{name} is speaking'},
    you: {id: 'voice_channels.you', defaultMessage: '{name} (you)'},
    participants: {id: 'voice_channels.sidebar.participants', defaultMessage: 'People in the call of {channel}'},

    // What the app registers with the host: the new channel option (voice is a native channel type now, picked
    // once at creation: see index.tsx), and the classic UI's right-hand panel and channel header button.
    newChannelLabel: {
        id: 'voice_channels.new_channel.label',
        defaultMessage: 'Voice channel',
        description: 'Name of the voice channel type in the dialog that creates a channel.',
    },
    newChannelDescription: {
        id: 'voice_channels.new_channel.description',
        defaultMessage: 'An always-open call that members can hop in and out of',
        description: 'Description of the voice channel type in the dialog that creates a channel.',
    },
    panelTitle: {
        id: 'voice_channels.rhs.title',
        defaultMessage: 'Voice',
        description: 'Title of the right-hand panel that shows the call of a voice channel (classic UI).',
    },
    headerButton: {
        id: 'voice_channels.header.button',
        defaultMessage: 'Voice channel',
        description: 'Text and tooltip of the channel header button that opens the call of a voice channel (classic UI).',
    },
});
