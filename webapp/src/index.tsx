// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React from 'react';

import type {Channel} from '@mattermost/types/channels';
import type {GlobalState} from '@mattermost/types/store';

import {Client4} from 'mattermost-redux/client';
import {Permissions} from 'mattermost-redux/constants';
import {getCurrentChannelId} from 'mattermost-redux/selectors/entities/channels';
import {haveIChannelPermission} from 'mattermost-redux/selectors/entities/roles';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import {
    handleSessionDeafened,
    handleVoiceChannelUpdated,
    loadConfig,
    loadVoiceChannel,
    loadVoiceChannels,
    logError,
    setVoiceChannel,
} from './actions';
import {startDeafenController, stopDeafenController} from './call_control';
import VoiceChannelPrivacy, {newVoiceChannelPrivacy} from './components/channel_type_option';
import RHSVoicePanel from './components/rhs_voice_panel';
import makeSidebarChannelLabel from './components/sidebar_channel_label';
import SidebarParticipants from './components/sidebar_participants';
import VoicePanel from './components/voice_panel/voice_panel';
import manifest from './manifest';
import {createVoiceChannelsAPI} from './public_api';
import reducer from './reducer';
import {isActiveVoiceChannel, isCallsAvailable, isKnownChannel, isVoiceChannel} from './selectors';
import type {PluginClass, PluginRegistry, PluginStore, WebSocketMessage} from './types/host';
import {isFusionUI} from './web_ui';

import './styles.css';

function canManageVoice(state: GlobalState, channel: Channel) {
    let permission;
    if (channel.type === 'O') {
        permission = Permissions.MANAGE_PUBLIC_CHANNEL_PROPERTIES;
    } else if (channel.type === 'P') {
        permission = Permissions.MANAGE_PRIVATE_CHANNEL_PROPERTIES;
    } else {
        return false;
    }
    return channel.delete_at === 0 && haveIChannelPermission(state, channel.team_id, channel.id, permission);
}

// loadAllVoiceChannels loads the voice channels the user is a member of, and whether the current
// channel is one (it may be a public channel the user isn't a member of).
async function loadAllVoiceChannels(store: PluginStore) {
    await loadVoiceChannels(store);
    const channelId = getCurrentChannelId(store.getState());
    if (channelId && !isKnownChannel(store.getState(), channelId)) {
        loadVoiceChannel(store, channelId);
    }
}

export default class Plugin implements PluginClass {
    private unsubscribers: Array<() => void> = [];

    public initialize(registry: PluginRegistry, store: PluginStore) {
        if (window.basename) {
            Client4.setUrl(window.basename);
        }

        registry.registerReducer(reducer);
        this.registerWebSocketEvents(registry, store);
        this.registerSidebar(registry);
        this.registerChannelView(registry, store);
        this.registerChannelSettings(registry, store);

        startDeafenController(store);
        this.unsubscribers.push(stopDeafenController);

        // Let other UIs (the Fusion web UI) show and drive voice channels
        const api = createVoiceChannelsAPI(store);
        window.antimatterVoiceChannels = api;
        this.unsubscribers.push(() => {
            if (window.antimatterVoiceChannels === api) {
                delete window.antimatterVoiceChannels;
            }
        });
        window.dispatchEvent(new Event('antimatter-voice-channels:ready'));

        this.loadWhenLoggedIn(store);
        this.watchCurrentChannel(store);
    }

    public uninitialize() {
        for (const unsubscribe of this.unsubscribers) {
            unsubscribe();
        }
        this.unsubscribers = [];
    }

    private registerWebSocketEvents(registry: PluginRegistry, store: PluginStore) {
        registry.registerWebSocketEventHandler(`custom_${manifest.id}_voice_channel_updated`, (msg) => handleVoiceChannelUpdated(store, msg));
        registry.registerWebSocketEventHandler(`custom_${manifest.id}_session_deafened`, (msg) => handleSessionDeafened(store, msg));

        // The user was added to a channel, which may be a voice channel
        registry.registerWebSocketEventHandler('user_added', (msg: WebSocketMessage) => {
            if (msg.data.user_id === getCurrentUserId(store.getState())) {
                loadVoiceChannel(store, msg.broadcast.channel_id);
            }
        });

        registry.registerReconnectHandler(() => {
            loadConfig(store);
            loadAllVoiceChannels(store);
        });
    }

    private registerSidebar(registry: PluginRegistry) {
        // Fusion shows the participants under voice channels itself, and joins them when they're
        // opened through window.antimatterVoiceChannels.autoJoin.
        if (!isFusionUI()) {
            // Hosts without the sidebar channel footer show the participants' avatars next to the name
            const hasFooter = typeof registry.registerSidebarChannelFooterComponent === 'function';
            registry.registerSidebarChannelFooterComponent?.(SidebarParticipants);
            registry.registerSidebarChannelLinkLabelComponent(makeSidebarChannelLabel(!hasFooter));
        }

        registry.registerChannelIconOverride?.((state, channel: Channel) => isActiveVoiceChannel(state, channel), 'volume-high');
    }

    private registerChannelView(registry: PluginRegistry, store: PluginStore) {
        // Fusion shows the call of voice channels itself
        if (isFusionUI()) {
            return;
        }

        if (typeof registry.registerChannelViewPanel === 'function') {
            registry.registerChannelViewPanel(
                (state, channel) => isActiveVoiceChannel(state, channel) && isCallsAvailable(state),
                VoicePanel,
            );
            return;
        }

        // Hosts without channel view panels get the stage in the right-hand sidebar
        const rhs = registry.registerRightHandSidebarComponent(RHSVoicePanel, 'Voice');
        registry.registerChannelHeaderButtonAction(
            <i className='icon icon-volume-high'/>,
            () => store.dispatch(rhs.toggleRHSPlugin),
            'Voice',
            'Voice channel',
        );
    }

    private registerChannelSettings(registry: PluginRegistry, store: PluginStore) {
        registry.registerChannelSettingsTab?.({
            uiName: 'Voice',
            icon: 'icon-volume-high',
            shouldRender: canManageVoice,
            sections: [{
                title: 'Voice channel',
                settings: [{
                    name: 'voice',
                    type: 'radio',
                    default: 'off',
                    helpText: 'A voice channel works like an always-open call: members join and leave its call whenever they want, and can still chat in the channel. Calls must be enabled.',
                    options: [
                        {value: 'on', text: 'Voice channel'},
                        {value: 'off', text: 'Regular channel'},
                    ],
                }],
            }],
            loadValues: async (channel) => {
                await loadVoiceChannel(store, channel.id);
                return {voice: isVoiceChannel(store.getState(), channel.id) ? 'on' : 'off'};
            },
            onSave: async (values, channel) => {
                await setVoiceChannel(store, channel.id, values.voice === 'on');
            },
        });

        registry.registerChannelTypeOption?.({
            label: 'Voice channel',
            description: 'An always-open call that members can hop in and out of',
            icon: <i className='icon icon-volume-high'/>,
            isAvailable: isCallsAvailable,
            extraContent: VoiceChannelPrivacy,
            onCreate: async (form) => {
                let channel: Channel;
                try {
                    channel = await Client4.createChannel({
                        team_id: form.teamId,
                        name: form.url,
                        display_name: form.displayName,
                        purpose: form.purpose,
                        header: '',
                        type: newVoiceChannelPrivacy.isPrivate ? 'P' : 'O',
                    } as Channel);
                } catch (err) {
                    return {status: 'error', message: (err as Error).message};
                }

                try {
                    await setVoiceChannel(store, channel.id, true);
                } catch (err) {
                    // The channel exists: open it, it can be made a voice channel from its settings
                    logError('failed to make the new channel a voice channel', err);
                }
                return {status: 'created', channel};
            },
        });
    }

    // loadWhenLoggedIn loads the plugin's state once the current user is known.
    private loadWhenLoggedIn(store: PluginStore) {
        const load = () => {
            loadConfig(store);
            loadAllVoiceChannels(store);
        };

        if (getCurrentUserId(store.getState())) {
            load();
            return;
        }

        const unsubscribe = store.subscribe(() => {
            if (getCurrentUserId(store.getState())) {
                unsubscribe();
                load();
            }
        });
        this.unsubscribers.push(unsubscribe);
    }

    // watchCurrentChannel checks whether the channels the user opens are voice channels when the
    // plugin doesn't know yet (e.g. public channels the user isn't a member of).
    private watchCurrentChannel(store: PluginStore) {
        let currentChannelId = '';
        const unsubscribe = store.subscribe(() => {
            const state = store.getState();
            const channelId = getCurrentChannelId(state);
            if (channelId === currentChannelId) {
                return;
            }
            currentChannelId = channelId;
            if (channelId && !isKnownChannel(state, channelId)) {
                loadVoiceChannel(store, channelId);
            }
        });
        this.unsubscribers.push(unsubscribe);
    }
}

window.registerPlugin(manifest.id, new Plugin());
