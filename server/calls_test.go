// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/require"
)

func TestCallsClientSetVoiceProps(t *testing.T) {
	channelID := model.NewId()

	t.Run("enables calls and sets the props, keeping other props", func(t *testing.T) {
		calls := newFakeCalls()
		calls.channels[channelID] = &CallsChannel{ChannelID: channelID, Props: map[string]any{"other": "value"}}
		client := NewCallsClient(calls.pluginHTTP)

		require.NoError(t, client.SetVoiceProps(channelID, true, true))
		require.Equal(t, &CallsChannel{ChannelID: channelID, Enabled: true, Props: map[string]any{
			"other":                        "value",
			callsPropBroadcastSessionState: true,
			callsPropDisableCallPost:       true,
			callsPropEnableVideo:           true,
		}}, calls.channel(channelID))

		// Nothing to change the second time
		require.NoError(t, client.SetVoiceProps(channelID, true, true))
		require.Len(t, calls.posts, 1)
	})

	t.Run("without video", func(t *testing.T) {
		calls := newFakeCalls()
		calls.channels[channelID] = &CallsChannel{ChannelID: channelID, Enabled: true, Props: map[string]any{callsPropEnableVideo: true}}
		client := NewCallsClient(calls.pluginHTTP)

		require.NoError(t, client.SetVoiceProps(channelID, true, false))
		require.Equal(t, map[string]any{
			callsPropBroadcastSessionState: true,
			callsPropDisableCallPost:       true,
		}, calls.channel(channelID).Props)
	})

	t.Run("disabling removes the props only", func(t *testing.T) {
		calls := newFakeCalls()
		client := NewCallsClient(calls.pluginHTTP)
		require.NoError(t, client.SetVoiceProps(channelID, true, true))
		calls.channels[channelID].Props["other"] = "value"

		require.NoError(t, client.SetVoiceProps(channelID, false, false))
		require.Equal(t, &CallsChannel{ChannelID: channelID, Enabled: true, Props: map[string]any{"other": "value"}}, calls.channel(channelID))
	})

	t.Run("calls unavailable", func(t *testing.T) {
		calls := newFakeCalls()
		calls.unavailable = true
		client := NewCallsClient(calls.pluginHTTP)
		require.ErrorIs(t, client.SetVoiceProps(channelID, true, true), errCallsUnavailable)

		// No response at all
		client = NewCallsClient(func(*http.Request) *http.Response { return nil })
		require.ErrorIs(t, client.SetVoiceProps(channelID, true, true), errCallsUnavailable)
	})

	t.Run("other errors", func(t *testing.T) {
		client := NewCallsClient(func(*http.Request) *http.Response {
			rec := httptest.NewRecorder()
			http.Error(rec, "boom", http.StatusInternalServerError)
			return rec.Result()
		})
		err := client.SetVoiceProps(channelID, true, true)
		require.Error(t, err)
		require.NotErrorIs(t, err, errCallsUnavailable)
		require.Contains(t, err.Error(), "boom")
	})
}

func TestCallsChannelHasSession(t *testing.T) {
	calls := newFakeCalls()
	channelID, sessionID, userID := model.NewId(), model.NewId(), model.NewId()
	client := NewCallsClient(calls.pluginHTTP)

	channel, err := client.GetChannel(channelID)
	require.NoError(t, err)
	require.False(t, channel.HasSession(sessionID, userID))

	calls.setCall(channelID, map[string]string{sessionID: userID})
	channel, err = client.GetChannel(channelID)
	require.NoError(t, err)
	require.True(t, channel.HasSession(sessionID, userID))
	require.False(t, channel.HasSession(sessionID, model.NewId()))
	require.False(t, channel.HasSession(model.NewId(), userID))
}
