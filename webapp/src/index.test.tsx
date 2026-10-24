// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import type {Channel} from '@mattermost/types/channels';

import {Client4} from 'mattermost-redux/client';

import {makeState, makeStore, teamId} from '../tests/utils';

import type {PluginClass, PluginRegistry} from './types/host';

jest.mock('./client', () => ({
    getConfig: jest.fn(() => Promise.resolve({auto_join: true, allow_video: true})),
    getVoiceChannels: jest.fn(() => Promise.resolve([])),
    getVoiceChannel: jest.fn((channelId: string) => Promise.resolve({channel_id: channelId, team_id: 'team', voice: false, deafened_sessions: {}})),
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
            expect(registry.registerChannelTypeOption).toHaveBeenCalled();
            plugin.uninitialize?.();
        } finally {
            delete window.antimatterWebUI;
        }
    });

    test('installs its API while running', () => {
        const onReady = jest.fn();
        window.addEventListener('antimatter-voice-channels:ready', onReady);
        const plugin = new Plugin();
        plugin.initialize(makeRegistry(true) as unknown as PluginRegistry, makeStore(state));

        expect(window.antimatterVoiceChannels?.version).toBe(1);
        expect(onReady).toHaveBeenCalled();

        plugin.uninitialize?.();
        expect(window.antimatterVoiceChannels).toBeUndefined();
        window.removeEventListener('antimatter-voice-channels:ready', onReady);
    });

    test('new voice channel creates through the ordinary channel API, with the Talk preset', async () => {
        const registry = makeRegistry(true);
        const plugin = new Plugin();
        plugin.initialize(registry as unknown as PluginRegistry, makeStore(state));
        const option = registry.registerChannelTypeOption.mock.calls[0][0];

        // The new channel option's name and description are translated where the host draws them.
        expect(option.label.props.id).toBe('voice_channels.new_channel.label');
        expect(option.label.props.defaultMessage).toBe('Voice channel');
        expect(option.description.props.id).toBe('voice_channels.new_channel.description');

        const created = {id: 'newchannel', team_id: teamId} as Channel;
        const createChannel = jest.spyOn(Client4, 'createChannel').mockResolvedValue(created as never);

        const result = await option.onCreate({teamId, displayName: 'Lounge', url: 'lounge', purpose: '', type: option.id});
        expect(createChannel).toHaveBeenCalledWith(expect.objectContaining({
            team_id: teamId, name: 'lounge', display_name: 'Lounge', type: 'O', props: {am_preset: 'voice_talk'},
        }));
        expect(result).toEqual({status: 'created', channel: created});

        createChannel.mockRejectedValue(new Error('A channel with that name already exists'));
        expect(await option.onCreate({teamId, displayName: 'Lounge', url: 'lounge', purpose: '', type: option.id})).toEqual({
            status: 'error',
            message: 'A channel with that name already exists',
        });
        plugin.uninitialize?.();
    });
});
