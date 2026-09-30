// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func decode[T any](t *testing.T, body []byte) T {
	t.Helper()
	var v T
	require.NoError(t, json.Unmarshal(body, &v))
	return v
}

func TestAPIRequiresUser(t *testing.T) {
	e := newTestEnv(t)
	w := e.request(t, "", http.MethodGet, "/api/v1/config", nil)
	require.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAPIGetConfig(t *testing.T) {
	e := newTestEnv(t)
	e.p.configuration = &configuration{AutoJoin: false, AllowVideo: true}

	w := e.request(t, model.NewId(), http.MethodGet, "/api/v1/config", nil)
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, ClientConfig{AutoJoin: false, AllowVideo: true}, decode[ClientConfig](t, w.Body.Bytes()))
}

func TestAPIUpdateChannel(t *testing.T) {
	userID := model.NewId()
	channel := &model.Channel{Id: model.NewId(), TeamId: model.NewId(), Type: model.ChannelTypeOpen}
	path := "/api/v1/channels/" + channel.Id

	setup := func(t *testing.T, ch *model.Channel) *testEnv {
		e := newTestEnv(t)
		e.api.On("HasPermissionToChannel", userID, ch.Id, model.PermissionReadChannel).Return(true).Maybe()
		e.api.On("GetChannel", ch.Id).Return(ch, nil).Maybe()
		return e
	}

	t.Run("turn on and off", func(t *testing.T) {
		e := setup(t, channel)
		e.api.On("HasPermissionToChannel", userID, channel.Id, model.PermissionManagePublicChannelProperties).Return(true)
		e.api.On("PublishWebSocketEvent", wsEventVoiceChannelUpdated, map[string]any{
			"channel_id": channel.Id, "team_id": channel.TeamId, "voice": true,
		}, &model.WebsocketBroadcast{ChannelId: channel.Id}).Once()

		w := e.request(t, userID, http.MethodPut, path, map[string]any{"voice": true})
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		require.Equal(t, VoiceChannelState{ChannelID: channel.Id, TeamID: channel.TeamId, Voice: true, DeafenedSessions: map[string]string{}},
			decode[VoiceChannelState](t, w.Body.Bytes()))

		vc, err := e.p.store.GetVoiceChannel(channel.Id)
		require.NoError(t, err)
		require.Equal(t, userID, vc.EnabledBy)
		require.Equal(t, channel.TeamId, vc.TeamID)
		require.True(t, e.calls.channel(channel.Id).Enabled)
		require.Equal(t, true, e.calls.channel(channel.Id).Props[callsPropBroadcastSessionState])

		e.api.On("PublishWebSocketEvent", wsEventVoiceChannelUpdated, map[string]any{
			"channel_id": channel.Id, "team_id": channel.TeamId, "voice": false,
		}, &model.WebsocketBroadcast{ChannelId: channel.Id}).Once()

		w = e.request(t, userID, http.MethodPut, path, map[string]any{"voice": false})
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		require.False(t, decode[VoiceChannelState](t, w.Body.Bytes()).Voice)

		vc, err = e.p.store.GetVoiceChannel(channel.Id)
		require.NoError(t, err)
		require.Nil(t, vc)
		require.Empty(t, e.calls.channel(channel.Id).Props)
	})

	t.Run("private channels need the private permission", func(t *testing.T) {
		private := &model.Channel{Id: model.NewId(), TeamId: model.NewId(), Type: model.ChannelTypePrivate}
		e := setup(t, private)
		e.api.On("HasPermissionToChannel", userID, private.Id, model.PermissionManagePrivateChannelProperties).Return(false)

		w := e.request(t, userID, http.MethodPut, "/api/v1/channels/"+private.Id, map[string]any{"voice": true})
		require.Equal(t, http.StatusForbidden, w.Code)
		vc, err := e.p.store.GetVoiceChannel(private.Id)
		require.NoError(t, err)
		require.Nil(t, vc)
		require.Nil(t, e.calls.channel(private.Id))
	})

	t.Run("only public and private channels", func(t *testing.T) {
		dm := &model.Channel{Id: model.NewId(), Type: model.ChannelTypeDirect}
		e := setup(t, dm)
		w := e.request(t, userID, http.MethodPut, "/api/v1/channels/"+dm.Id, map[string]any{"voice": true})
		require.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("not archived channels", func(t *testing.T) {
		archived := &model.Channel{Id: model.NewId(), Type: model.ChannelTypeOpen, DeleteAt: 1}
		e := setup(t, archived)
		w := e.request(t, userID, http.MethodPut, "/api/v1/channels/"+archived.Id, map[string]any{"voice": true})
		require.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("calls unavailable", func(t *testing.T) {
		e := setup(t, channel)
		e.api.On("HasPermissionToChannel", userID, channel.Id, model.PermissionManagePublicChannelProperties).Return(true)
		e.calls.unavailable = true

		w := e.request(t, userID, http.MethodPut, path, map[string]any{"voice": true})
		require.Equal(t, http.StatusServiceUnavailable, w.Code)
		vc, err := e.p.store.GetVoiceChannel(channel.Id)
		require.NoError(t, err)
		require.Nil(t, vc)
	})

	t.Run("no access to the channel", func(t *testing.T) {
		e := newTestEnv(t)
		e.api.On("HasPermissionToChannel", userID, channel.Id, model.PermissionReadChannel).Return(false)
		w := e.request(t, userID, http.MethodPut, path, map[string]any{"voice": true})
		require.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("invalid body", func(t *testing.T) {
		e := newTestEnv(t)
		w := e.request(t, userID, http.MethodPut, path, map[string]any{"enabled": true})
		require.Equal(t, http.StatusBadRequest, w.Code)
	})
}

func TestAPIGetChannel(t *testing.T) {
	userID := model.NewId()
	channel := &model.Channel{Id: model.NewId(), TeamId: model.NewId(), Type: model.ChannelTypeOpen}
	path := "/api/v1/channels/" + channel.Id

	e := newTestEnv(t)
	e.api.On("HasPermissionToChannel", userID, channel.Id, model.PermissionReadChannel).Return(true)
	e.api.On("GetChannel", channel.Id).Return(channel, nil)

	w := e.request(t, userID, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, VoiceChannelState{ChannelID: channel.Id, TeamID: channel.TeamId, DeafenedSessions: map[string]string{}},
		decode[VoiceChannelState](t, w.Body.Bytes()))

	require.NoError(t, e.p.store.SaveVoiceChannel(&VoiceChannel{ChannelID: channel.Id, TeamID: channel.TeamId}))
	sessionID, otherUserID := model.NewId(), model.NewId()
	_, err := e.p.store.SetSessionDeafened(channel.Id, sessionID, otherUserID, true, time.Now())
	require.NoError(t, err)

	w = e.request(t, userID, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, VoiceChannelState{ChannelID: channel.Id, TeamID: channel.TeamId, Voice: true, DeafenedSessions: map[string]string{sessionID: otherUserID}},
		decode[VoiceChannelState](t, w.Body.Bytes()))

	t.Run("no access", func(t *testing.T) {
		e := newTestEnv(t)
		e.api.On("HasPermissionToChannel", userID, channel.Id, model.PermissionReadChannel).Return(false)
		w := e.request(t, userID, http.MethodGet, path, nil)
		require.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("deleted channel", func(t *testing.T) {
		e := newTestEnv(t)
		e.api.On("HasPermissionToChannel", userID, channel.Id, model.PermissionReadChannel).Return(true)
		e.api.On("GetChannel", channel.Id).Return(nil, model.NewAppError("GetChannel", "not_found", nil, "", http.StatusNotFound))
		w := e.request(t, userID, http.MethodGet, path, nil)
		require.Equal(t, http.StatusNotFound, w.Code)
	})
}

func TestAPIListChannels(t *testing.T) {
	userID := model.NewId()
	member := &VoiceChannel{ChannelID: model.NewId(), TeamID: model.NewId()}
	notMember := &VoiceChannel{ChannelID: model.NewId(), TeamID: model.NewId()}

	e := newTestEnv(t)
	require.NoError(t, e.p.store.SaveVoiceChannel(member))
	require.NoError(t, e.p.store.SaveVoiceChannel(notMember))
	sessionID := model.NewId()
	_, err := e.p.store.SetSessionDeafened(member.ChannelID, sessionID, userID, true, time.Now())
	require.NoError(t, err)

	e.api.On("GetChannelMembersForUser", "", userID, 0, 200).Return([]*model.ChannelMember{
		{ChannelId: member.ChannelID, UserId: userID},
		{ChannelId: model.NewId(), UserId: userID},
	}, nil)

	w := e.request(t, userID, http.MethodGet, "/api/v1/channels", nil)
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, []VoiceChannelState{
		{ChannelID: member.ChannelID, TeamID: member.TeamID, Voice: true, DeafenedSessions: map[string]string{sessionID: userID}},
	}, decode[[]VoiceChannelState](t, w.Body.Bytes()))

	t.Run("no voice channels", func(t *testing.T) {
		e := newTestEnv(t)
		w := e.request(t, userID, http.MethodGet, "/api/v1/channels", nil)
		require.Equal(t, http.StatusOK, w.Code)
		require.JSONEq(t, "[]", w.Body.String())
	})
}

func TestAPISetDeafened(t *testing.T) {
	userID, otherUserID := model.NewId(), model.NewId()
	channel := &model.Channel{Id: model.NewId(), TeamId: model.NewId(), Type: model.ChannelTypeOpen}
	sessionID, otherSessionID := model.NewId(), model.NewId()
	path := func(sessionID string) string {
		return "/api/v1/channels/" + channel.Id + "/sessions/" + sessionID + "/deafened"
	}

	setup := func(t *testing.T) *testEnv {
		e := newTestEnv(t)
		e.api.On("HasPermissionToChannel", mock.Anything, channel.Id, model.PermissionReadChannel).Return(true)
		e.api.On("GetChannel", channel.Id).Return(channel, nil)
		require.NoError(t, e.p.store.SaveVoiceChannel(&VoiceChannel{ChannelID: channel.Id, TeamID: channel.TeamId}))
		e.calls.setCall(channel.Id, map[string]string{sessionID: userID, otherSessionID: otherUserID})
		return e
	}

	t.Run("deafen and undeafen", func(t *testing.T) {
		e := setup(t)
		for _, deafened := range []bool{true, false} {
			e.api.On("PublishWebSocketEvent", wsEventSessionDeafened, map[string]any{
				"channel_id": channel.Id, "session_id": sessionID, "user_id": userID, "deafened": deafened,
			}, &model.WebsocketBroadcast{ChannelId: channel.Id}).Once()

			w := e.request(t, userID, http.MethodPut, path(sessionID), map[string]any{"deafened": deafened})
			require.Equal(t, http.StatusOK, w.Code, w.Body.String())

			sessions, err := e.p.store.GetDeafenedSessions(channel.Id, time.Now())
			require.NoError(t, err)
			_, ok := sessions[sessionID]
			require.Equal(t, deafened, ok)
		}
	})

	t.Run("only own sessions in the call", func(t *testing.T) {
		e := setup(t)
		w := e.request(t, userID, http.MethodPut, path(otherSessionID), map[string]any{"deafened": true})
		require.Equal(t, http.StatusBadRequest, w.Code)
		w = e.request(t, userID, http.MethodPut, path(model.NewId()), map[string]any{"deafened": true})
		require.Equal(t, http.StatusBadRequest, w.Code)

		_, err := e.p.store.SetSessionDeafened(channel.Id, otherSessionID, otherUserID, true, time.Now())
		require.NoError(t, err)
		w = e.request(t, userID, http.MethodPut, path(otherSessionID), map[string]any{"deafened": false})
		require.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("only voice channels", func(t *testing.T) {
		e := setup(t)
		require.NoError(t, e.p.store.DeleteVoiceChannel(channel.Id))
		w := e.request(t, userID, http.MethodPut, path(sessionID), map[string]any{"deafened": true})
		require.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("invalid body", func(t *testing.T) {
		e := newTestEnv(t)
		w := e.request(t, userID, http.MethodPut, path(sessionID), map[string]any{})
		require.Equal(t, http.StatusBadRequest, w.Code)
	})
}
