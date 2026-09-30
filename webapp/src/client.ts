// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {Client4} from 'mattermost-redux/client';

import manifest from './manifest';

export type ClientConfig = {
    auto_join: boolean;
    allow_video: boolean;
};

export type VoiceChannelState = {
    channel_id: string;
    team_id: string;
    voice: boolean;

    // Session ID -> user ID
    deafened_sessions: {[sessionId: string]: string};
};

export class ClientError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

function apiURL(path: string) {
    return `${window.basename || ''}/plugins/${manifest.id}/api/v1${path}`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const options: {method: string; body?: string} = {method};
    if (typeof body !== 'undefined') {
        options.body = JSON.stringify(body);
    }
    const response = await fetch(apiURL(path), Client4.getOptions(options));

    if (!response.ok) {
        let message = response.statusText;
        try {
            const data = await response.json();
            message = data.error || message;
        } catch {
            // Not JSON
        }
        throw new ClientError(message, response.status);
    }

    return response.json();
}

export function getConfig() {
    return request<ClientConfig>('GET', '/config');
}

export function getVoiceChannels() {
    return request<VoiceChannelState[]>('GET', '/channels');
}

export function getVoiceChannel(channelId: string) {
    return request<VoiceChannelState>('GET', `/channels/${channelId}`);
}

export function updateVoiceChannel(channelId: string, voice: boolean) {
    return request<VoiceChannelState>('PUT', `/channels/${channelId}`, {voice});
}

export function setSessionDeafened(channelId: string, sessionId: string, deafened: boolean) {
    return request<unknown>('PUT', `/channels/${channelId}/sessions/${sessionId}/deafened`, {deafened});
}
