// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import React, {useEffect, useRef} from 'react';

type Props = {
    stream: MediaStream;
    className?: string;
    mirrored?: boolean;
};

// VideoStream plays a video stream. It's muted: the Calls plugin plays the audio of the call.
export default function VideoStream({stream, className, mirrored}: Props) {
    const ref = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (ref.current && ref.current.srcObject !== stream) {
            ref.current.srcObject = stream;
        }
    }, [stream]);

    let classes = className || '';
    if (mirrored) {
        classes += ' VoiceVideo--mirrored';
    }

    return (
        <video
            ref={ref}
            className={classes}
            autoPlay={true}
            playsInline={true}
            muted={true}
        />
    );
}
