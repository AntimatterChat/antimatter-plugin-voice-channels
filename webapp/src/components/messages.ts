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

    // What the app registers with the host: the channel settings tab, the new channel option, and the classic UI's
    // right-hand panel and channel header button.
    settingsTab: {
        id: 'voice_channels.settings.tab',
        defaultMessage: 'Voice',
        description: 'Name of the tab of the channel settings where a channel is made a voice channel or a regular one.',
    },
    settingsSection: {
        id: 'voice_channels.settings.section',
        defaultMessage: 'Voice channel',
        description: 'Title of the section of the channel settings that turns the channel into a voice channel or back.',
    },
    settingsHelp: {
        id: 'voice_channels.settings.help',
        defaultMessage: 'A voice channel works like an always-open call: members join and leave its call whenever they want, and can still chat in the channel. The Calls app must be enabled.',
        description: 'Help under the voice channel setting of a channel. "Calls" is the name of the app that runs the calls.',
    },
    settingsOn: {
        id: 'voice_channels.settings.on',
        defaultMessage: 'Voice channel',
        description: 'Choice of the voice channel setting: the channel is a voice channel (an always-open call).',
    },
    settingsOff: {
        id: 'voice_channels.settings.off',
        defaultMessage: 'Regular channel',
        description: 'Choice of the voice channel setting: the channel is an ordinary text channel.',
    },
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
