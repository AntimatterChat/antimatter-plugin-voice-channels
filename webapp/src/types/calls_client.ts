// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

// The part of the Calls plugin's client (window.callsClient) this plugin uses. It only exists in
// the window that is in a call: in the desktop app, calls run in a separate window.
interface CallsClient {
    channelID: string;
    localVideoStream: MediaStream | null;

    getSessionID(): string | undefined;
    mute(): void;
    unmute(): Promise<void>;
    disconnect(): void;

    getLocalScreenStream(): MediaStream | null;
    getRemoteScreenStream(): MediaStream | null;
    getRemoteVoiceTracks(): MediaStreamTrack[];

    // Added by the Calls fork's voice channel support; missing in older versions.
    getRemoteVideoStreams?(): {[sessionID: string]: MediaStream};

    on(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
}

export default CallsClient;
