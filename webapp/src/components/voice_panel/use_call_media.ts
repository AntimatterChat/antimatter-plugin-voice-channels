// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {useEffect, useRef, useState} from 'react';

import type CallsClient from '../../types/calls_client';

export type CallMedia = {
    localVideo: MediaStream | null;
    screen: MediaStream | null;

    // The camera streams of the other participants by session ID
    videos: {[sessionId: string]: MediaStream};
};

const noMedia: CallMedia = {localVideo: null, screen: null, videos: {}};

// Events after which the streams of a call may have changed
const mediaEvents = ['remoteVideoStream', 'remoteScreenStream', 'localScreenStream', 'localVideoStream', 'video_on', 'video_off'];

// Tracks can end without an event, so streams are also refreshed periodically.
const refreshInterval = 2000;

function noCleanup() {
    // Nothing to clean up
}

function trackId(stream: MediaStream | null | undefined) {
    return stream?.getTracks()[0]?.id || '';
}

// useCallMedia returns the video streams of the call run by the given Calls client (the call of
// this window), keeping the same stream objects while their tracks don't change so that videos
// don't restart.
export function useCallMedia(callsClient: CallsClient | null): CallMedia {
    const [media, setMedia] = useState<CallMedia>(noMedia);
    const current = useRef<CallMedia>(noMedia);

    useEffect(() => {
        if (!callsClient) {
            current.current = noMedia;
            setMedia(noMedia);
            return noCleanup;
        }

        const stable = (prev: MediaStream | null | undefined, next: MediaStream | null | undefined) => {
            if (!next) {
                return null;
            }
            return prev && trackId(prev) === trackId(next) ? prev : next;
        };

        const update = () => {
            const prev = current.current;
            const videos: CallMedia['videos'] = {};
            for (const [sessionId, stream] of Object.entries(callsClient.getRemoteVideoStreams?.() || {})) {
                videos[sessionId] = stable(prev.videos[sessionId], stream) as MediaStream;
            }
            const next: CallMedia = {
                localVideo: stable(prev.localVideo, callsClient.localVideoStream),
                screen: stable(prev.screen, callsClient.getLocalScreenStream() || callsClient.getRemoteScreenStream()),
                videos,
            };

            const changed = next.localVideo !== prev.localVideo ||
                next.screen !== prev.screen ||
                Object.keys(next.videos).length !== Object.keys(prev.videos).length ||
                Object.entries(next.videos).some(([id, stream]) => prev.videos[id] !== stream);
            if (changed) {
                current.current = next;
                setMedia(next);
            }
        };

        update();
        for (const event of mediaEvents) {
            callsClient.on(event, update);
        }
        const interval = setInterval(update, refreshInterval);

        return () => {
            for (const event of mediaEvents) {
                callsClient.off(event, update);
            }
            clearInterval(interval);
        };
    }, [callsClient]);

    return media;
}
