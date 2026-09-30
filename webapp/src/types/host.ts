// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type React from 'react';
import type {AnyAction, Reducer, Store} from 'redux';

import type {Channel} from '@mattermost/types/channels';
import type {GlobalState} from '@mattermost/types/store';

import type CallsClient from './calls_client';

export type ChannelMatcher = (state: GlobalState, channel: Channel) => boolean;

export type ChannelViewPanelProps = {
    channel: Channel;
    messagesVisible: boolean;
    setMessagesVisible: (visible: boolean) => void;
};

export type ChannelSettingsValues = {[name: string]: string};

export type ChannelSettingsTab = {
    uiName: string;
    icon?: string;
    shouldRender?: ChannelMatcher;
    sections: Array<{
        title: string;
        settings: Array<{
            name: string;
            type: 'radio';
            title?: string;
            helpText?: string;
            default: string;
            options: Array<{value: string; text: string; helpText?: string}>;
        }>;
    }>;
    onSave: (values: ChannelSettingsValues, channel: Channel) => Promise<void>;
    loadValues?: (channel: Channel) => ChannelSettingsValues | Promise<ChannelSettingsValues>;
};

export type NewChannelFormState = {
    teamId: string;
    displayName: string;
    url: string;
    purpose: string;
    type: string;
};

export type NewChannelFormResult =
    {status: 'created'; channel: Channel} |
    {status: 'deferred'} |
    {status: 'error'; message: string};

export type RightHandSidebarRegistration = {
    id: string;
    showRHSPlugin: AnyAction;
    hideRHSPlugin: AnyAction;
    toggleRHSPlugin: AnyAction;
};

// The subset of the host's plugin registry this plugin uses. The hooks that older or upstream
// hosts may lack are optional: the plugin checks for them and degrades gracefully.
export interface PluginRegistry {
    registerReducer(reducer: Reducer): void;
    registerWebSocketEventHandler(event: string, handler: (msg: WebSocketMessage) => void): void;
    registerReconnectHandler(handler: () => void): void;
    registerSidebarChannelLinkLabelComponent(component: React.ComponentType<{channel: Channel}>): string;
    registerRightHandSidebarComponent(component: React.ComponentType, title: React.ReactNode): RightHandSidebarRegistration;
    registerChannelHeaderButtonAction(icon: React.ReactNode, action: (channel: Channel) => void, dropdownText: React.ReactNode, tooltipText: React.ReactNode): string;
    registerTranslations?(getTranslationsForLocale: (locale: string) => Record<string, string>): void;

    // Antimatter hooks
    registerSidebarChannelFooterComponent?(component: React.ComponentType<{channel: Channel}>): string;
    registerChannelViewPanel?(matcher: ChannelMatcher, component: React.ComponentType<ChannelViewPanelProps>): string;

    // Recent upstream hooks
    registerChannelIconOverride?(matcher: ChannelMatcher, iconName: string): string;
    registerChannelSettingsTab?(tab: ChannelSettingsTab): string;
    registerChannelTypeOption?(option: {
        label: React.ReactNode;
        description: React.ReactNode;
        icon: React.ReactNode;
        isAvailable: (state: GlobalState) => boolean;
        extraContent?: React.ComponentType<{formState: NewChannelFormState; setCanCreate: (v: boolean) => void}>;
        onCreate: (formState: NewChannelFormState) => Promise<NewChannelFormResult>;
        createButtonText?: React.ReactNode;
    }): string;
}

export type WebSocketMessage<T = Record<string, unknown>> = {
    event: string;
    data: T;
    broadcast: {channel_id: string; team_id: string; user_id: string};
};

export type PluginStore = Store<GlobalState>;

export interface PluginClass {
    initialize(registry: PluginRegistry, store: PluginStore): void | Promise<void>;
    uninitialize?(): void;
}

declare global {
    interface Window {
        registerPlugin(pluginId: string, plugin: PluginClass): void;
        basename?: string;

        // Set by the Calls plugin while this window is in a call
        callsClient?: CallsClient;

        WebappUtils?: {
            browserHistory: {push: (path: string) => void};
        };
    }
}
