// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

// The state the Calls plugin keeps in the Redux store (state['plugins-com.mattermost.calls']).
// Calls doesn't export its selectors, so this plugin reads the parts it needs.

export type CallsSessionState = {
    session_id: string;
    user_id: string;
    unmuted: boolean;
    raised_hand: number;
    video?: boolean;

    // Whether the session is talking
    voice?: boolean;
};

export type CallsPluginState = {
    channels?: {[channelID: string]: {id: string; enabled?: boolean; props?: Record<string, unknown>}};
    calls?: {[channelID: string]: {ID: string; channelID: string; startAt: number; ownerID: string}};
    sessions?: {[channelID: string]: {[sessionID: string]: CallsSessionState}};
    screenSharingIDs?: {[channelID: string]: string};
    clientStateReducer?: {channelID: string; sessionID: string} | null;
    callsConfig?: {EnableVideo?: boolean; AllowScreenSharing?: boolean};
};
