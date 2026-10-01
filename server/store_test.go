// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"testing"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/require"
)

func TestStoreVoiceChannels(t *testing.T) {
	kv := newFakeKV()
	s := NewStore(kv)

	channelID := model.NewId()
	vc, err := s.GetVoiceChannel(channelID)
	require.NoError(t, err)
	require.Nil(t, vc)

	saved := &VoiceChannel{ChannelID: channelID, TeamID: model.NewId(), EnabledBy: model.NewId(), EnabledAt: 1234}
	require.NoError(t, s.SaveVoiceChannel(saved))

	vc, err = s.GetVoiceChannel(channelID)
	require.NoError(t, err)
	require.Equal(t, saved, vc)

	// Other keys aren't listed as voice channels
	now := time.Now()
	_, err = s.SetSessionDeafened(channelID, model.NewId(), model.NewId(), true, now)
	require.NoError(t, err)
	other := &VoiceChannel{ChannelID: model.NewId(), TeamID: model.NewId()}
	require.NoError(t, s.SaveVoiceChannel(other))

	list, err := s.ListVoiceChannels()
	require.NoError(t, err)
	require.ElementsMatch(t, []*VoiceChannel{saved, other}, list)

	require.NoError(t, s.DeleteVoiceChannel(channelID))
	vc, err = s.GetVoiceChannel(channelID)
	require.NoError(t, err)
	require.Nil(t, vc)
	sessions, err := s.GetDeafenedSessions(channelID, now)
	require.NoError(t, err)
	require.Empty(t, sessions)

	list, err = s.ListVoiceChannels()
	require.NoError(t, err)
	require.Equal(t, []*VoiceChannel{other}, list)
}

func TestStoreListManyVoiceChannels(t *testing.T) {
	s := NewStore(newFakeKV())
	for range kvListPageSize + 5 {
		require.NoError(t, s.SaveVoiceChannel(&VoiceChannel{ChannelID: model.NewId()}))
	}

	list, err := s.ListVoiceChannels()
	require.NoError(t, err)
	require.Len(t, list, kvListPageSize+5)
}

func TestStoreDeafenedSessions(t *testing.T) {
	kv := newFakeKV()
	s := NewStore(kv)
	channelID := model.NewId()
	userA, userB := model.NewId(), model.NewId()
	sessionA, sessionB := model.NewId(), model.NewId()
	now := time.Now()

	ok, err := s.SetSessionDeafened(channelID, sessionA, userA, true, now)
	require.NoError(t, err)
	require.True(t, ok)
	ok, err = s.SetSessionDeafened(channelID, sessionB, userB, true, now)
	require.NoError(t, err)
	require.True(t, ok)

	sessions, err := s.GetDeafenedSessions(channelID, now)
	require.NoError(t, err)
	require.Equal(t, map[string]DeafenedSession{
		sessionA: {UserID: userA, UpdatedAt: now.UnixMilli()},
		sessionB: {UserID: userB, UpdatedAt: now.UnixMilli()},
	}, sessions)

	t.Run("can't change the session of another user", func(t *testing.T) {
		ok, err := s.SetSessionDeafened(channelID, sessionA, userB, false, now)
		require.NoError(t, err)
		require.False(t, ok)
		ok, err = s.SetSessionDeafened(channelID, sessionA, userB, true, now)
		require.NoError(t, err)
		require.False(t, ok)
	})

	t.Run("undeafen", func(t *testing.T) {
		ok, err := s.SetSessionDeafened(channelID, sessionA, userA, false, now)
		require.NoError(t, err)
		require.True(t, ok)
		sessions, err := s.GetDeafenedSessions(channelID, now)
		require.NoError(t, err)
		require.Equal(t, []string{sessionB}, keys(sessions))

		// Undeafening an unknown session is a no-op
		ok, err = s.SetSessionDeafened(channelID, model.NewId(), userA, false, now)
		require.NoError(t, err)
		require.True(t, ok)
	})

	t.Run("old sessions expire", func(t *testing.T) {
		later := now.Add(deafenedSessionTTL + time.Minute)
		sessions, err := s.GetDeafenedSessions(channelID, later)
		require.NoError(t, err)
		require.Empty(t, sessions)

		// and are dropped on the next update
		sessionC := model.NewId()
		ok, err := s.SetSessionDeafened(channelID, sessionC, userA, true, later)
		require.NoError(t, err)
		require.True(t, ok)
		sessions, err = s.GetDeafenedSessions(channelID, now)
		require.NoError(t, err)
		require.Equal(t, []string{sessionC}, keys(sessions))
	})

	t.Run("the key is deleted when no session is deafened", func(t *testing.T) {
		otherChannelID := model.NewId()
		_, err := s.SetSessionDeafened(otherChannelID, sessionA, userA, true, now)
		require.NoError(t, err)
		_, err = s.SetSessionDeafened(otherChannelID, sessionA, userA, false, now)
		require.NoError(t, err)
		data, appErr := kv.KVGet(deafenedKey(otherChannelID))
		require.Nil(t, appErr)
		require.Nil(t, data)
	})
}

func keys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
