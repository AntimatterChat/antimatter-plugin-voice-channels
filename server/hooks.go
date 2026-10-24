// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
	"github.com/pkg/errors"
)

// Antimatter channel types (server/public/model/channel_type.go, server main): a voice channel is a native
// channel type now, fixed at creation; the server refuses to create one unless this app is active. This app no
// longer decides whether a channel is a voice channel (there's no more turning it on or off, see api.go and
// command.go); it only sets up and keeps up the channel's calls, and mirrors which channels are voice channels
// in its KV store so the sync loop (sync.go) doesn't have to scan every channel.
//
// amChannelTypeProp and amChannelTypeVoice mirror the server's channel type props (model.ChannelPropType,
// model.AMChannelTypeVoice) as plain strings: this plugin's pinned server/public module predates channel types,
// so the constants aren't in it yet, but a channel's props carry them regardless of the module version.
const (
	amChannelTypeProp  = "am_type"
	amChannelTypeVoice = "voice"
)

// isVoiceChannel tells whether the server made the channel a voice channel (the Talk or Stage preset). The type
// is fixed at creation and never changes, so this is never wrong once the channel carries its filled-in props
// (every team channel's does, direct and group messages excepted).
func isVoiceChannel(channel *model.Channel) bool {
	return channel != nil && channel.Props != nil && channel.Props[amChannelTypeProp] == amChannelTypeVoice
}

// ensureVoiceChannelSetup sets up a voice channel's calls (broadcast session state, no call post, video if
// configured) and adds it to the KV mirror if it isn't there yet. It does nothing to a channel that isn't a
// voice channel. It's idempotent: ChannelHasBeenCreated and UserHasJoinedChannel both call it, so that a member
// who joins before the creation hook has run still finds a working call.
func (p *Plugin) ensureVoiceChannelSetup(channel *model.Channel) error {
	if !isVoiceChannel(channel) {
		return nil
	}
	if err := p.calls.SetVoiceProps(channel.Id, true, p.getConfiguration().AllowVideo); err != nil {
		return errors.Wrap(err, "failed to set up calls in the channel")
	}

	existing, err := p.store.GetVoiceChannel(channel.Id)
	if err != nil {
		return err
	}
	if existing != nil {
		return nil
	}
	return p.store.SaveVoiceChannel(&VoiceChannel{
		ChannelID: channel.Id,
		TeamID:    channel.TeamId,
		EnabledBy: channel.CreatorId,
		EnabledAt: time.Now().UnixMilli(),
	})
}

// ChannelHasBeenCreated sets up a newly created voice channel: the server already refused the creation if this
// app wasn't active (§3.4 of the channel types design), so by the time this runs the channel exists and needs
// its call.
func (p *Plugin) ChannelHasBeenCreated(_ *plugin.Context, channel *model.Channel) {
	if !isVoiceChannel(channel) {
		return
	}
	if err := p.ensureVoiceChannelSetup(channel); err != nil {
		p.API.LogError("Failed to set up a newly created voice channel", "channel_id", channel.Id, "err", err.Error())
	}
}

// UserHasJoinedChannel covers the moment between a voice channel's creation and the ChannelHasBeenCreated hook
// actually running: the creator (or anyone else added at creation) can join before that hook fires, and would
// otherwise find a voice channel with no call set up yet.
func (p *Plugin) UserHasJoinedChannel(_ *plugin.Context, member *model.ChannelMember, _ *model.User) {
	channel, appErr := p.API.GetChannel(member.ChannelId)
	if appErr != nil {
		p.API.LogWarn("Failed to check a joined channel for voice setup", "channel_id", member.ChannelId, "err", appErr.Error())
		return
	}
	if !isVoiceChannel(channel) {
		return
	}
	if err := p.ensureVoiceChannelSetup(channel); err != nil {
		p.API.LogError("Failed to set up voice on join", "channel_id", channel.Id, "err", err.Error())
	}
}
