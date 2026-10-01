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
});
