// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type {Channel} from '@mattermost/types/channels';

import {Client4} from 'mattermost-redux/client';
import {getCurrentChannelId} from 'mattermost-redux/selectors/entities/channels';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import {
    handleSessionDeafened,
    handleVoiceChannelUpdated,
    loadConfig,
    loadVoiceChannel,
    loadVoiceChannels,
} from './actions';
import makeSidebarChannelLabel from './components/sidebar_channel_label';
import SidebarParticipants from './components/sidebar_participants';
import manifest from './manifest';
import reducer from './reducer';
import {isActiveVoiceChannel, isKnownChannel} from './selectors';
import type {PluginClass, PluginRegistry, PluginStore, WebSocketMessage} from './types/host';

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
        if (window.basename) {
            Client4.setUrl(window.basename);
        }

        registry.registerReducer(reducer);
        this.registerWebSocketEvents(registry, store);
        this.registerSidebar(registry);

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
        // Hosts without the sidebar channel footer show the participants' avatars next to the name
        const hasFooter = typeof registry.registerSidebarChannelFooterComponent === 'function';
        registry.registerSidebarChannelFooterComponent?.(SidebarParticipants);
        registry.registerSidebarChannelLinkLabelComponent(makeSidebarChannelLabel(!hasFooter));

        registry.registerChannelIconOverride?.((state, channel: Channel) => isActiveVoiceChannel(state, channel), 'volume-high');
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
