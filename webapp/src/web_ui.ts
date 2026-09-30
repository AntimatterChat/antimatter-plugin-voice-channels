// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

// Antimatter ships two web UIs: the classic one and Fusion. Fusion draws voice channels itself and
// drives them through window.antimatterVoiceChannels, so the plugin leaves its own UI out under
// it. Both UIs say which one is running before plugins load.

export type WebUI = 'classic' | 'fusion';

// isFusionUI returns whether the Fusion web UI is running.
export function isFusionUI(): boolean {
    return window.antimatterWebUI === 'fusion' || document.documentElement.dataset.amWebUi === 'fusion';
}
