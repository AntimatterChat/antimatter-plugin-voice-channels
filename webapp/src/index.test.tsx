// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type {Channel} from '@mattermost/types/channels';

import {Client4} from 'mattermost-redux/client';

import {makeState, makeStore, teamId} from '../tests/utils';

import * as client from './client';
import type {ChannelSettingsTab, PluginClass, PluginRegistry} from './types/host';

jest.mock('./client', () => ({
    getConfig: jest.fn(() => Promise.resolve({auto_join: true, allow_video: true})),
    getVoiceChannels: jest.fn(() => Promise.resolve([])),
    getVoiceChannel: jest.fn((channelId: string) => Promise.resolve({channel_id: channelId, team_id: 'team', voice: false, deafened_sessions: {}})),
    updateVoiceChannel: jest.fn((channelId: string, voice: boolean) => Promise.resolve({channel_id: channelId, team_id: 'team', voice, deafened_sessions: {}})),
    setSessionDeafened: jest.fn(),
}));

let Plugin: new () => PluginClass;
beforeAll(() => {
    window.registerPlugin = jest.fn();
    // eslint-disable-next-line global-require
    Plugin = require('./index').default;
});

function makeRegistry(withHooks: boolean) {
    const registry = {
        registerReducer: jest.fn(),
        registerWebSocketEventHandler: jest.fn(),
        registerReconnectHandler: jest.fn(),
        registerSidebarChannelLinkLabelComponent: jest.fn(),
        registerRightHandSidebarComponent: jest.fn(() => ({id: 'rhs', toggleRHSPlugin: {type: 'TOGGLE'}})),
        registerChannelHeaderButtonAction: jest.fn(),
    } as Record<string, jest.Mock>;
    if (withHooks) {
        Object.assign(registry, {
            registerSidebarChannelFooterComponent: jest.fn(),
            registerChannelViewPanel: jest.fn(),
            registerChannelIconOverride: jest.fn(),
            registerChannelSettingsTab: jest.fn(),
            registerChannelTypeOption: jest.fn(),
        });
    }
    return registry;
}

describe('Plugin', () => {
    const state = makeState({channels: [{id: 'voice'}]});

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('uses the host hooks when available', () => {
        const registry = makeRegistry(true);
        const plugin = new Plugin();
        plugin.initialize(registry as unknown as PluginRegistry, makeStore(state));

        expect(registry.registerSidebarChannelFooterComponent).toHaveBeenCalled();
        expect(registry.registerSidebarChannelLinkLabelComponent).toHaveBeenCalled();
        expect(registry.registerChannelViewPanel).toHaveBeenCalled();
        expect(registry.registerChannelIconOverride).toHaveBeenCalledWith(expect.any(Function), 'volume-high');
        expect(registry.registerChannelSettingsTab).toHaveBeenCalled();
        expect(registry.registerChannelTypeOption).toHaveBeenCalled();
        expect(registry.registerRightHandSidebarComponent).not.toHaveBeenCalled();
        plugin.uninitialize?.();
    });

    test('falls back to the right-hand sidebar without channel view panels', () => {
        const registry = makeRegistry(false);
        const plugin = new Plugin();
        plugin.initialize(registry as unknown as PluginRegistry, makeStore(state));

        expect(registry.registerRightHandSidebarComponent).toHaveBeenCalled();
        expect(registry.registerChannelHeaderButtonAction).toHaveBeenCalled();
        expect(registry.registerSidebarChannelLinkLabelComponent).toHaveBeenCalled();
        plugin.uninitialize?.();
    });

    test('leaves the sidebar participants and the call view to Fusion', () => {
        window.antimatterWebUI = 'fusion';
        try {
            const registry = makeRegistry(true);
            const plugin = new Plugin();
            plugin.initialize(registry as unknown as PluginRegistry, makeStore(state));

            expect(registry.registerSidebarChannelFooterComponent).not.toHaveBeenCalled();
            expect(registry.registerSidebarChannelLinkLabelComponent).not.toHaveBeenCalled();
            expect(registry.registerChannelViewPanel).not.toHaveBeenCalled();
            expect(registry.registerRightHandSidebarComponent).not.toHaveBeenCalled();
            expect(registry.registerChannelHeaderButtonAction).not.toHaveBeenCalled();

            // The rest stays
            expect(registry.registerReducer).toHaveBeenCalled();
            expect(registry.registerChannelIconOverride).toHaveBeenCalledWith(expect.any(Function), 'volume-high');
            expect(registry.registerChannelSettingsTab).toHaveBeenCalled();
            expect(registry.registerChannelTypeOption).toHaveBeenCalled();
            plugin.uninitialize?.();
        } finally {
            delete window.antimatterWebUI;
        }
    });

    test('channel settings tab', async () => {
        const registry = makeRegistry(true);
        const store = makeStore(state);
        const plugin = new Plugin();
        plugin.initialize(registry as unknown as PluginRegistry, store);
        const tab = registry.registerChannelSettingsTab.mock.calls[0][0] as ChannelSettingsTab;

        expect(tab.shouldRender!(store.getState(), {id: 'dm', type: 'D', delete_at: 0} as Channel)).toBe(false);

        const channel = {id: 'voice', type: 'O', team_id: teamId, delete_at: 0} as Channel;
        expect(await tab.loadValues!(channel)).toEqual({voice: 'off'});
        await tab.onSave({voice: 'on'}, channel);
        expect(client.updateVoiceChannel).toHaveBeenCalledWith('voice', true);
        plugin.uninitialize?.();
    });

    test('new voice channel', async () => {
        const registry = makeRegistry(true);
        const plugin = new Plugin();
        plugin.initialize(registry as unknown as PluginRegistry, makeStore(state));
        const option = registry.registerChannelTypeOption.mock.calls[0][0];

        const created = {id: 'newchannel', team_id: teamId} as Channel;
        const createChannel = jest.spyOn(Client4, 'createChannel').mockResolvedValue(created as never);

        const result = await option.onCreate({teamId, displayName: 'Lounge', url: 'lounge', purpose: '', type: option.id});
        expect(createChannel).toHaveBeenCalledWith(expect.objectContaining({team_id: teamId, name: 'lounge', display_name: 'Lounge', type: 'O'}));
        expect(client.updateVoiceChannel).toHaveBeenCalledWith('newchannel', true);
        expect(result).toEqual({status: 'created', channel: created});

        createChannel.mockRejectedValue(new Error('A channel with that name already exists'));
        expect(await option.onCreate({teamId, displayName: 'Lounge', url: 'lounge', purpose: '', type: option.id})).toEqual({
            status: 'error',
            message: 'A channel with that name already exists',
        });
        plugin.uninitialize?.();
    });
});
