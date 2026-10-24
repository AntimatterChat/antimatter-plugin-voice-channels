// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/require"
)

// TestVoiceCommand covers B6: voice is now a native channel type, fixed at creation, so /voice only reports the
// channel's state; "on" and "off" are gone (the toggle is refused elsewhere too, see TestAPIUpdateChannel).
func TestVoiceCommand(t *testing.T) {
	userID := model.NewId()
	channel := &model.Channel{Id: model.NewId(), TeamId: model.NewId(), Type: model.ChannelTypeOpen}
	voiceChannel := &model.Channel{Id: channel.Id, TeamId: channel.TeamId, Type: model.ChannelTypeOpen, Props: map[string]any{amChannelTypeProp: amChannelTypeVoice}}

	run := func(t *testing.T, e *testEnv, command string) string {
		t.Helper()
		resp, appErr := e.p.ExecuteCommand(nil, &model.CommandArgs{Command: command, UserId: userID, ChannelId: channel.Id})
		require.Nil(t, appErr)
		require.Equal(t, model.CommandResponseTypeEphemeral, resp.ResponseType)
		return resp.Text
	}

	t.Run("status of a regular channel", func(t *testing.T) {
		e := newTestEnv(t)
		e.api.On("GetChannel", channel.Id).Return(channel, nil)
		require.Equal(t, "This channel is a regular channel.", run(t, e, "/voice"))
	})

	t.Run("status of a voice channel", func(t *testing.T) {
		e := newTestEnv(t)
		e.api.On("GetChannel", channel.Id).Return(voiceChannel, nil)
		require.Equal(t, "This channel is a voice channel.", run(t, e, "/voice"))
	})

	t.Run("on and off are gone", func(t *testing.T) {
		e := newTestEnv(t)
		e.api.On("GetChannel", channel.Id).Return(channel, nil)
		require.Equal(t, voiceCommandHelp, run(t, e, "/voice on"))
		require.Equal(t, voiceCommandHelp, run(t, e, "/voice off"))
	})

	t.Run("help", func(t *testing.T) {
		e := newTestEnv(t)
		e.api.On("GetChannel", channel.Id).Return(channel, nil)
		require.Equal(t, voiceCommandHelp, run(t, e, "/voice help"))
	})

	t.Run("unknown channel", func(t *testing.T) {
		e := newTestEnv(t)
		e.api.On("GetChannel", channel.Id).Return(nil, model.NewAppError("GetChannel", "not_found", nil, "", 404))
		require.Equal(t, "Couldn't find this channel.", run(t, e, "/voice"))
	})
}
