// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"net/http"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/pkg/errors"
)

// WebSocket events sent to the members of a channel. Clients receive them as
// custom_<plugin id>_<event>.
const (
	// wsEventSessionDeafened is sent when a participant deafens or undeafens themselves.
	wsEventSessionDeafened = "session_deafened"
)

// VoiceChannelState is what clients get to know about a channel.
type VoiceChannelState struct {
	ChannelID string `json:"channel_id"`
	TeamID    string `json:"team_id"`
	Voice     bool   `json:"voice"`

	// DeafenedSessions maps the ID of every deafened call session to its user ID.
	DeafenedSessions map[string]string `json:"deafened_sessions"`
}

// apiError is an error with the HTTP status to answer with.
type apiError struct {
	status int
	err    error
}

func (e *apiError) Error() string {
	return e.err.Error()
}

func newAPIError(status int, msg string) *apiError {
	return &apiError{status: status, err: errors.New(msg)}
}

// statusFor returns the HTTP status for an error returned by the plugin's operations.
func statusFor(err error) int {
	var apiErr *apiError
	switch {
	case errors.As(err, &apiErr):
		return apiErr.status
	case errors.Is(err, errCallsUnavailable):
		return http.StatusServiceUnavailable
	default:
		return http.StatusInternalServerError
	}
}

// getVoiceChannelState returns the voice state of the channel. Voice comes from the channel's own props (the
// server's channel type, fixed at creation): this is race-free even for a channel so new that the creation hook
// (ChannelHasBeenCreated) hasn't mirrored it into the KV store yet.
func (p *Plugin) getVoiceChannelState(channel *model.Channel) (*VoiceChannelState, error) {
	state := &VoiceChannelState{ChannelID: channel.Id, TeamID: channel.TeamId, Voice: isVoiceChannel(channel), DeafenedSessions: map[string]string{}}
	if !state.Voice {
		return state, nil
	}

	sessions, err := p.store.GetDeafenedSessions(channel.Id, time.Now())
	if err != nil {
		return nil, err
	}
	for id, s := range sessions {
		state.DeafenedSessions[id] = s.UserID
	}

	return state, nil
}

// setSessionDeafened records whether the user's call session in the voice channel is deafened
// and tells the channel members.
func (p *Plugin) setSessionDeafened(userID string, channel *model.Channel, sessionID string, deafened bool) error {
	if !isVoiceChannel(channel) {
		return newAPIError(http.StatusBadRequest, "not a voice channel")
	}

	if deafened {
		callsChannel, callsErr := p.calls.GetChannel(channel.Id)
		if callsErr != nil {
			return errors.Wrap(callsErr, "failed to get the call")
		}
		if !callsChannel.HasSession(sessionID, userID) {
			return newAPIError(http.StatusBadRequest, "the session isn't in the call")
		}
	}

	ok, err := p.store.SetSessionDeafened(channel.Id, sessionID, userID, deafened, time.Now())
	if err != nil {
		return err
	}
	if !ok {
		return newAPIError(http.StatusForbidden, "the session belongs to another user")
	}

	p.API.PublishWebSocketEvent(wsEventSessionDeafened, map[string]any{
		"channel_id": channel.Id,
		"session_id": sessionID,
		"user_id":    userID,
		"deafened":   deafened,
	}, &model.WebsocketBroadcast{ChannelId: channel.Id})

	return nil
}

// listVoiceChannelsForUser returns the voice channels the user is a member of.
func (p *Plugin) listVoiceChannelsForUser(userID string) ([]*VoiceChannelState, error) {
	voiceChannels, err := p.store.ListVoiceChannels()
	if err != nil {
		return nil, err
	}

	states := []*VoiceChannelState{}
	if len(voiceChannels) == 0 {
		return states, nil
	}

	memberships := map[string]bool{}
	const perPage = 200
	for page := 0; ; page++ {
		members, appErr := p.API.GetChannelMembersForUser("", userID, page, perPage)
		if appErr != nil {
			return nil, errors.Wrap(appErr, "failed to get channel memberships")
		}
		for _, m := range members {
			memberships[m.ChannelId] = true
		}
		if len(members) < perPage {
			break
		}
	}

	now := time.Now()
	for _, vc := range voiceChannels {
		if !memberships[vc.ChannelID] {
			continue
		}

		state := &VoiceChannelState{ChannelID: vc.ChannelID, TeamID: vc.TeamID, Voice: true, DeafenedSessions: map[string]string{}}
		sessions, err := p.store.GetDeafenedSessions(vc.ChannelID, now)
		if err != nil {
			return nil, err
		}
		for id, s := range sessions {
			state.DeafenedSessions[id] = s.UserID
		}
		states = append(states, state)
	}

	return states, nil
}
