// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestVoiceCommand(t *testing.T) {
	userID := model.NewId()
	channel := &model.Channel{Id: model.NewId(), TeamId: model.NewId(), Type: model.ChannelTypeOpen}

	run := func(t *testing.T, e *testEnv, command string) string {
		t.Helper()
		resp, appErr := e.p.ExecuteCommand(nil, &model.CommandArgs{Command: command, UserId: userID, ChannelId: channel.Id})
		require.Nil(t, appErr)
		require.Equal(t, model.CommandResponseTypeEphemeral, resp.ResponseType)
		return resp.Text
	}

	t.Run("status, on and off", func(t *testing.T) {
		e := newTestEnv(t)
		e.api.On("GetChannel", channel.Id).Return(channel, nil)
		e.api.On("HasPermissionToChannel", userID, channel.Id, model.PermissionManagePublicChannelProperties).Return(true)
		e.api.On("PublishWebSocketEvent", wsEventVoiceChannelUpdated, mock.Anything, mock.Anything)

		require.Equal(t, "This channel is a regular channel.", run(t, e, "/voice"))
		require.Equal(t, "This channel is now a voice channel.", run(t, e, "/voice on"))
		require.Equal(t, "This channel is a voice channel.", run(t, e, "/voice"))
		require.Equal(t, "This channel is now a regular channel.", run(t, e, "/voice  off "))
		require.Equal(t, "This channel is a regular channel.", run(t, e, "/voice"))
	})

	t.Run("help", func(t *testing.T) {
		e := newTestEnv(t)
		e.api.On("GetChannel", channel.Id).Return(channel, nil)
		require.Equal(t, voiceCommandHelp, run(t, e, "/voice help"))
	})

	t.Run("errors", func(t *testing.T) {
		e := newTestEnv(t)
		e.api.On("GetChannel", channel.Id).Return(channel, nil)
		e.api.On("HasPermissionToChannel", userID, channel.Id, model.PermissionManagePublicChannelProperties).Return(false).Once()
		require.Contains(t, run(t, e, "/voice on"), "you don't have permission")

		e.api.On("HasPermissionToChannel", userID, channel.Id, model.PermissionManagePublicChannelProperties).Return(true)
		e.calls.unavailable = true
		require.Contains(t, run(t, e, "/voice on"), "calls are unavailable")
	})
}
