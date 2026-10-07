// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React, {useEffect, useState} from 'react';
import {FormattedMessage} from 'react-intl';

import type {NewChannelFormState} from '../types/host';

// The privacy picked for the voice channel being created in the new channel modal. The host only
// passes the form to onCreate, so the option's extra content shares its choice this way.
export const newVoiceChannelPrivacy = {isPrivate: false};

// VoiceChannelPrivacy lets users pick whether a new voice channel is public or private, unless the host asks it for
// every type of channel (its form then has a privacy, see newVoiceChannelType).
export default function VoiceChannelPrivacy({formState}: {formState?: NewChannelFormState}) {
    const [isPrivate, setPrivate] = useState(false);

    useEffect(() => {
        newVoiceChannelPrivacy.isPrivate = false;
    }, []);

    if (formState?.privacy) {
        return null;
    }

    const handleChange = (value: boolean) => {
        newVoiceChannelPrivacy.isPrivate = value;
        setPrivate(value);
    };

    return (
        <fieldset className='VoiceChannelPrivacy'>
            <label className='VoiceChannelPrivacy__option'>
                <input
                    type='radio'
                    name='voiceChannelPrivacy'
                    checked={!isPrivate}
                    onChange={() => handleChange(false)}
                />
                <FormattedMessage
                    id='voice_channels.new_channel.public'
                    defaultMessage='Public: anyone on the team can join'
                />
            </label>
            <label className='VoiceChannelPrivacy__option'>
                <input
                    type='radio'
                    name='voiceChannelPrivacy'
                    checked={isPrivate}
                    onChange={() => handleChange(true)}
                />
                <FormattedMessage
                    id='voice_channels.new_channel.private'
                    defaultMessage='Private: only invited members'
                />
            </label>
        </fieldset>
    );
}

// newVoiceChannelType is the type of the voice channel the form creates: the host's choice when it asks, else the one
// made in VoiceChannelPrivacy.
export function newVoiceChannelType(form: NewChannelFormState): 'O' | 'P' {
    if (form.privacy) {
        return form.privacy;
    }
    return newVoiceChannelPrivacy.isPrivate ? 'P' : 'O';
}
