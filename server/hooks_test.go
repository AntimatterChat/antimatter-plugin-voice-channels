// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"net/http"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/require"
)

// TestChannelHasBeenCreatedSetsUpVoice covers B6: the server already refused creating a voice channel without
// this app active (§3.4 of the channel types design), so by the time this hook runs it only has to set up the
// channel's calls and mirror it in the KV store.
func TestChannelHasBeenCreatedSetsUpVoice(t *testing.T) {
	channel := &model.Channel{
		Id: model.NewId(), TeamId: model.NewId(), CreatorId: model.NewId(), Type: model.ChannelTypeOpen,
		Props: map[string]any{amChannelTypeProp: amChannelTypeVoice},
	}

	t.Run("sets up calls and mirrors the channel", func(t *testing.T) {
		e := newTestEnv(t)
		e.p.ChannelHasBeenCreated(nil, channel)

		require.True(t, e.calls.channel(channel.Id).Enabled)
		require.Equal(t, true, e.calls.channel(channel.Id).Props[callsPropBroadcastSessionState])

		vc, err := e.p.store.GetVoiceChannel(channel.Id)
		require.NoError(t, err)
		require.NotNil(t, vc)
		require.Equal(t, channel.CreatorId, vc.EnabledBy)
		require.Equal(t, channel.TeamId, vc.TeamID)
	})

	t.Run("does nothing for a channel that isn't voice", func(t *testing.T) {
		e := newTestEnv(t)
		regular := &model.Channel{Id: model.NewId(), TeamId: model.NewId(), Type: model.ChannelTypeOpen}
		e.p.ChannelHasBeenCreated(nil, regular)

		require.Nil(t, e.calls.channel(regular.Id))
		vc, err := e.p.store.GetVoiceChannel(regular.Id)
		require.NoError(t, err)
		require.Nil(t, vc)
	})

	t.Run("doesn't clobber a mirror entry the join check already wrote", func(t *testing.T) {
		e := newTestEnv(t)
		require.NoError(t, e.p.store.SaveVoiceChannel(&VoiceChannel{ChannelID: channel.Id, TeamID: channel.TeamId, EnabledBy: "joiner", EnabledAt: 1}))

		e.p.ChannelHasBeenCreated(nil, channel)

		vc, err := e.p.store.GetVoiceChannel(channel.Id)
		require.NoError(t, err)
		require.Equal(t, "joiner", vc.EnabledBy, "the first write of the mirror wins")
	})
}

// TestUserHasJoinedChannelSetsUpVoice covers the join check (§3.4, §5 item 6): the moment between a voice
// channel's creation and the ChannelHasBeenCreated hook actually running (it's dispatched asynchronously, after
// the creator is already added), covered so the first person in always finds a working call.
func TestUserHasJoinedChannelSetsUpVoice(t *testing.T) {
	channel := &model.Channel{
		Id: model.NewId(), TeamId: model.NewId(), CreatorId: model.NewId(), Type: model.ChannelTypeOpen,
		Props: map[string]any{amChannelTypeProp: amChannelTypeVoice},
	}
	member := &model.ChannelMember{ChannelId: channel.Id, UserId: model.NewId()}

	t.Run("covers the moment before the creation hook has run", func(t *testing.T) {
		e := newTestEnv(t)
		e.api.On("GetChannel", channel.Id).Return(channel, nil)

		vc, err := e.p.store.GetVoiceChannel(channel.Id)
		require.NoError(t, err)
		require.Nil(t, vc, "nothing done yet: ChannelHasBeenCreated hasn't run")

		e.p.UserHasJoinedChannel(nil, member, nil)

		require.True(t, e.calls.channel(channel.Id).Enabled)
		vc, err = e.p.store.GetVoiceChannel(channel.Id)
		require.NoError(t, err)
		require.NotNil(t, vc)
	})

	t.Run("does nothing for a channel that isn't voice", func(t *testing.T) {
		e := newTestEnv(t)
		regular := &model.Channel{Id: model.NewId(), TeamId: model.NewId(), Type: model.ChannelTypeOpen}
		e.api.On("GetChannel", regular.Id).Return(regular, nil)

		e.p.UserHasJoinedChannel(nil, &model.ChannelMember{ChannelId: regular.Id, UserId: model.NewId()}, nil)

		require.Nil(t, e.calls.channel(regular.Id))
	})

	t.Run("a channel lookup failure is logged, not fatal", func(t *testing.T) {
		e := newTestEnv(t)
		e.api.On("GetChannel", member.ChannelId).Return(nil, model.NewAppError("GetChannel", "x", nil, "", http.StatusInternalServerError))

		require.NotPanics(t, func() { e.p.UserHasJoinedChannel(nil, member, nil) })
	})
}
