// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"time"

	"github.com/pkg/errors"
)

// Delays between attempts to set up calls in the voice channels while the Calls plugin is
// unavailable (e.g. it's activated after this plugin, or not installed yet).
var callsSyncRetryDelays = []time.Duration{10 * time.Second, 30 * time.Second, time.Minute, 5 * time.Minute, 15 * time.Minute}

// syncCallsSettings makes sure calls are set up in every voice channel, e.g. after the Calls
// plugin was reinstalled or the configuration changed.
func (p *Plugin) syncCallsSettings() error {
	channels, err := p.store.ListVoiceChannels()
	if err != nil {
		return err
	}

	allowVideo := p.getConfiguration().AllowVideo
	for _, vc := range channels {
		if _, appErr := p.API.GetChannel(vc.ChannelID); appErr != nil && appErr.StatusCode == 404 {
			// The channel was deleted
			if err := p.store.DeleteVoiceChannel(vc.ChannelID); err != nil {
				p.API.LogWarn("Failed to forget a deleted voice channel", "channel_id", vc.ChannelID, "err", err.Error())
			}
			continue
		}

		if err := p.calls.SetVoiceProps(vc.ChannelID, true, allowVideo); err != nil {
			if errors.Is(err, errCallsUnavailable) {
				return err
			}
			p.API.LogWarn("Failed to set up calls in a voice channel", "channel_id", vc.ChannelID, "err", err.Error())
		}
	}

	return nil
}

// runCallsSync syncs the calls settings of the voice channels when started and whenever
// triggered, retrying while it fails, until stopped.
func (p *Plugin) runCallsSync(trigger <-chan struct{}, stop <-chan struct{}) {
	attempt := 0
	for {
		var timer *time.Timer
		var retry <-chan time.Time
		if err := p.syncCallsSettings(); err != nil {
			delay := callsSyncRetryDelays[min(attempt, len(callsSyncRetryDelays)-1)]
			if attempt == 0 {
				p.API.LogWarn("Failed to set up calls in the voice channels, will retry", "err", err.Error(), "retry_in", delay.String())
			} else {
				p.API.LogDebug("Failed to set up calls in the voice channels, will retry", "err", err.Error(), "retry_in", delay.String())
			}
			attempt++
			timer = time.NewTimer(delay)
			retry = timer.C
		} else {
			attempt = 0
		}

		select {
		case <-stop:
			return
		case <-trigger:
		case <-retry:
		}
		if timer != nil {
			timer.Stop()
		}
	}
}

// triggerCallsSync asks runCallsSync to sync again.
func (p *Plugin) triggerCallsSync() {
	p.syncLock.Lock()
	defer p.syncLock.Unlock()
	if p.syncTrigger == nil {
		return
	}
	select {
	case p.syncTrigger <- struct{}{}:
	default:
	}
}
