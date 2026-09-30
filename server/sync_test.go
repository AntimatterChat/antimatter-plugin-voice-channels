// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"net/http"
	"testing"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestSyncCallsSettings(t *testing.T) {
	existing := &model.Channel{Id: model.NewId(), TeamId: model.NewId(), Type: model.ChannelTypeOpen}
	deletedID := model.NewId()

	setup := func(t *testing.T) *testEnv {
		e := newTestEnv(t)
		require.NoError(t, e.p.store.SaveVoiceChannel(&VoiceChannel{ChannelID: existing.Id, TeamID: existing.TeamId}))
		require.NoError(t, e.p.store.SaveVoiceChannel(&VoiceChannel{ChannelID: deletedID}))
		e.api.On("GetChannel", existing.Id).Return(existing, nil).Maybe()
		e.api.On("GetChannel", deletedID).Return(nil, model.NewAppError("GetChannel", "not_found", nil, "", http.StatusNotFound)).Maybe()
		return e
	}

	t.Run("sets up calls and forgets deleted channels", func(t *testing.T) {
		e := setup(t)
		require.NoError(t, e.p.syncCallsSettings())

		require.True(t, e.calls.channel(existing.Id).Enabled)
		require.Equal(t, true, e.calls.channel(existing.Id).Props[callsPropEnableVideo])
		vc, err := e.p.store.GetVoiceChannel(deletedID)
		require.NoError(t, err)
		require.Nil(t, vc)

		// Video follows the configuration
		e.p.configuration = &configuration{AllowVideo: false}
		require.NoError(t, e.p.syncCallsSettings())
		require.NotContains(t, e.calls.channel(existing.Id).Props, callsPropEnableVideo)
	})

	t.Run("calls unavailable", func(t *testing.T) {
		e := setup(t)
		e.calls.unavailable = true
		require.ErrorIs(t, e.p.syncCallsSettings(), errCallsUnavailable)
	})

	t.Run("retries until calls is available", func(t *testing.T) {
		e := setup(t)
		e.calls.mu.Lock()
		e.calls.unavailable = true
		e.calls.mu.Unlock()

		delays := callsSyncRetryDelays
		callsSyncRetryDelays = []time.Duration{10 * time.Millisecond}
		t.Cleanup(func() { callsSyncRetryDelays = delays })

		trigger, stop := make(chan struct{}, 1), make(chan struct{})
		done := make(chan struct{})
		go func() {
			e.p.runCallsSync(trigger, stop)
			close(done)
		}()

		time.Sleep(30 * time.Millisecond)
		e.calls.mu.Lock()
		e.calls.unavailable = false
		e.calls.mu.Unlock()

		require.Eventually(t, func() bool {
			channel := e.calls.channel(existing.Id)
			return channel != nil && channel.Enabled
		}, time.Second, 10*time.Millisecond)

		close(stop)
		<-done
	})
}

func TestConfigurationChangeTriggersSync(t *testing.T) {
	e := newTestEnv(t)
	e.p.syncTrigger = make(chan struct{}, 1)
	e.api.On("LoadPluginConfiguration", &configuration{}).Return(nil).Run(func(args mock.Arguments) {
		args.Get(0).(*configuration).AllowVideo = false
	})

	require.NoError(t, e.p.OnConfigurationChange())
	require.Len(t, e.p.syncTrigger, 1)
}
