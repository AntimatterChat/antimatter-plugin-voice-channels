// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

// The part of the Calls plugin's API (window.antimatterCalls) this plugin uses. Calls versions
// without it are driven through /call slash commands instead.
export interface CallsAPI {
    version: number;

    // Joins (or starts) the call of a channel, through the same checks as Calls' call button.
    join(channelId: string, opts?: {title?: string; switchCall?: boolean; unmuted?: boolean; video?: boolean}): Promise<void>;

    // Leaves the user's call, whether this window or the desktop app's call window runs it.
    leave(): void;
}
