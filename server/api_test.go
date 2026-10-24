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

// TestAPIUpdateChannel covers B6: voice is now a native channel type, fixed when the channel is created, so the
// app's own toggle endpoint has nothing left to do and always answers 400 (§3.4 of the channel types design).
func TestAPIUpdateChannel(t *testing.T) {
	userID := model.NewId()
	channel := &model.Channel{Id: model.NewId(), TeamId: model.NewId(), Type: model.ChannelTypeOpen}
	path := "/api/v1/channels/" + channel.Id

	for _, body := range []any{map[string]any{"voice": true}, map[string]any{"voice": false}, nil} {
		e := newTestEnv(t)
		w := e.request(t, userID, http.MethodPut, path, body)
		require.Equal(t, http.StatusBadRequest, w.Code, "%v", body)
		require.Contains(t, w.Body.String(), "can no longer be turned on or off")
	}

	t.Run("still needs a user, like every other route", func(t *testing.T) {
		e := newTestEnv(t)
		w := e.request(t, "", http.MethodPut, path, map[string]any{"voice": true})
		require.Equal(t, http.StatusUnauthorized, w.Code)
	})
}

// TestAPIGetChannel also covers B6: Voice comes from the channel's own props (channel.Props["am_type"]), the
// server's channel type, not the KV mirror; see getVoiceChannelState in voice.go.
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

	// The server made it a voice channel (its props say so); the GetChannel mock returns the same channel
	// pointer, so mutating its props is reflected in the next request.
	channel.Props = map[string]any{amChannelTypeProp: amChannelTypeVoice}
	sessionID, otherUserID := model.NewId(), model.NewId()
	_, err := e.p.store.SetSessionDeafened(channel.Id, sessionID, otherUserID, true, time.Now())
	require.NoError(t, err)

	w = e.request(t, userID, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, VoiceChannelState{ChannelID: channel.Id, TeamID: channel.TeamId, Voice: true, DeafenedSessions: map[string]string{sessionID: otherUserID}},
		decode[VoiceChannelState](t, w.Body.Bytes()))

	t.Run("a private channel the user isn't in", func(t *testing.T) {
		e := newTestEnv(t)
		private := &model.Channel{Id: channel.Id, TeamId: channel.TeamId, Type: model.ChannelTypePrivate}
		e.api.On("GetChannel", channel.Id).Return(private, nil)
		e.api.On("HasPermissionToChannel", userID, channel.Id, model.PermissionReadChannel).Return(false)
		w := e.request(t, userID, http.MethodGet, path, nil)
		require.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("a public channel of the user's team, not joined", func(t *testing.T) {
		e := newTestEnv(t)
		voice := &model.Channel{Id: channel.Id, TeamId: channel.TeamId, Type: model.ChannelTypeOpen, Props: map[string]any{amChannelTypeProp: amChannelTypeVoice}}
		e.api.On("GetChannel", channel.Id).Return(voice, nil)
		e.api.On("HasPermissionToChannel", userID, channel.Id, model.PermissionReadChannel).Return(false)
		e.api.On("HasPermissionToTeam", userID, channel.TeamId, model.PermissionReadPublicChannel).Return(true)
		w := e.request(t, userID, http.MethodGet, path, nil)
		require.Equal(t, http.StatusOK, w.Code)
		require.True(t, decode[VoiceChannelState](t, w.Body.Bytes()).Voice)
	})

	t.Run("a public channel of another team", func(t *testing.T) {
		e := newTestEnv(t)
		e.api.On("GetChannel", channel.Id).Return(channel, nil)
		e.api.On("HasPermissionToChannel", userID, channel.Id, model.PermissionReadChannel).Return(false)
		e.api.On("HasPermissionToTeam", userID, channel.TeamId, model.PermissionReadPublicChannel).Return(false)
		w := e.request(t, userID, http.MethodGet, path, nil)
		require.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("deleted channel", func(t *testing.T) {
		e := newTestEnv(t)
		e.api.On("HasPermissionToChannel", userID, channel.Id, model.PermissionReadChannel).Return(true).Maybe()
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
	channel := &model.Channel{
		Id: model.NewId(), TeamId: model.NewId(), Type: model.ChannelTypeOpen,
		Props: map[string]any{amChannelTypeProp: amChannelTypeVoice},
	}
	sessionID, otherSessionID := model.NewId(), model.NewId()
	path := func(sessionID string) string {
		return "/api/v1/channels/" + channel.Id + "/sessions/" + sessionID + "/deafened"
	}

	setup := func(t *testing.T) *testEnv {
		e := newTestEnv(t)
		e.api.On("HasPermissionToChannel", mock.Anything, channel.Id, model.PermissionReadChannel).Return(true)
		e.api.On("GetChannel", channel.Id).Return(channel, nil)
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
		e := newTestEnv(t)
		regular := &model.Channel{Id: channel.Id, TeamId: channel.TeamId, Type: model.ChannelTypeOpen}
		e.api.On("HasPermissionToChannel", mock.Anything, channel.Id, model.PermissionReadChannel).Return(true)
		e.api.On("GetChannel", channel.Id).Return(regular, nil)
		e.calls.setCall(channel.Id, map[string]string{sessionID: userID})
		w := e.request(t, userID, http.MethodPut, path(sessionID), map[string]any{"deafened": true})
		require.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("invalid body", func(t *testing.T) {
		e := newTestEnv(t)
		w := e.request(t, userID, http.MethodPut, path(sessionID), map[string]any{})
		require.Equal(t, http.StatusBadRequest, w.Code)
	})
}
