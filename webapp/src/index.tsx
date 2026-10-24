// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage} from 'react-intl';

import type {Channel} from '@mattermost/types/channels';

import {Client4} from 'mattermost-redux/client';
import {getCurrentChannelId} from 'mattermost-redux/selectors/entities/channels';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import {
    handleSessionDeafened,
    loadConfig,
    loadVoiceChannel,
    loadVoiceChannels,
} from './actions';
import {startDeafenController, stopDeafenController} from './call_control';
import VoiceChannelPrivacy, {newVoiceChannelType} from './components/channel_type_option';
import {messages} from './components/messages';
import RHSVoicePanel from './components/rhs_voice_panel';
import makeSidebarChannelLabel from './components/sidebar_channel_label';
import SidebarParticipants from './components/sidebar_participants';
import VoicePanel from './components/voice_panel/voice_panel';
import manifest from './manifest';
import {createVoiceChannelsAPI} from './public_api';
import reducer from './reducer';
import {isActiveVoiceChannel, isCallsAvailable, isKnownChannel} from './selectors';
import type {PluginClass, PluginRegistry, PluginStore, WebSocketMessage} from './types/host';
import {isFusionUI} from './web_ui';
import {registerTranslations} from './translations';

import './styles.css';

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
        registerTranslations(registry);

        if (window.basename) {
            Client4.setUrl(window.basename);
        }

        registry.registerReducer(reducer);
        this.registerWebSocketEvents(registry, store);
        this.registerSidebar(registry);
        this.registerChannelView(registry, store);
        this.registerNewChannelOption(registry);

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
        const rhs = registry.registerRightHandSidebarComponent(RHSVoicePanel, <FormattedMessage {...messages.panelTitle}/>);
        registry.registerChannelHeaderButtonAction(
            <i className='icon icon-volume-high'/>,
            () => store.dispatch(rhs.toggleRHSPlugin),
            <FormattedMessage {...messages.panelTitle}/>,
            <FormattedMessage {...messages.headerButton}/>,
        );
    }

    // registerNewChannelOption registers the classic new-channel modal's Voice channel type (Fusion's own
    // PresetPicker replaces it there: design §4.1). Voice is a native Antimatter channel type now, picked once at
    // creation and fixed afterwards; there's no longer a settings tab or a `/voice on|off` to turn it on or off
    // (see ../server/api.go and ../server/command.go), so this is the only place left that makes one, and it does
    // so through the ordinary channel creation API, with the Talk preset.
    private registerNewChannelOption(registry: PluginRegistry) {
        registry.registerChannelTypeOption?.({
            label: <FormattedMessage {...messages.newChannelLabel}/>,
            description: <FormattedMessage {...messages.newChannelDescription}/>,
            icon: isFusionUI() ? <svg className='am-ic'><use href='#am-i-speaker'/></svg> : <i className='icon icon-volume-high'/>,
            isAvailable: isCallsAvailable,
            extraContent: VoiceChannelPrivacy,
            onCreate: async (form) => {
                try {
                    const channel = await Client4.createChannel({
                        team_id: form.teamId,
                        name: form.url,
                        display_name: form.displayName,
                        purpose: form.purpose,
                        header: '',
                        type: newVoiceChannelType(form),

                        // am_preset "voice_talk" (server/public/model/channel_type.go's ChannelPresetVoiceTalk):
                        // the server sets up the channel's type and settings from it before this app's
                        // ChannelHasBeenCreated hook runs.
                        props: {am_preset: 'voice_talk'},
                    } as Channel);
                    return {status: 'created', channel};
                } catch (err) {
                    return {status: 'error', message: (err as Error).message};
                }
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
