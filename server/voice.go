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
	// wsEventVoiceChannelUpdated is sent when a channel becomes or stops being a voice channel.
	wsEventVoiceChannelUpdated = "voice_channel_updated"
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

// manageVoicePermission returns the permission needed to turn a channel into a voice channel
// and back, or nil for channels that can't be voice channels.
func manageVoicePermission(channel *model.Channel) *model.Permission {
	switch channel.Type {
	case model.ChannelTypeOpen:
		return model.PermissionManagePublicChannelProperties
	case model.ChannelTypePrivate:
		return model.PermissionManagePrivateChannelProperties
	default:
		return nil
	}
}

// getVoiceChannelState returns the voice state of the channel.
func (p *Plugin) getVoiceChannelState(channel *model.Channel) (*VoiceChannelState, error) {
	state := &VoiceChannelState{ChannelID: channel.Id, TeamID: channel.TeamId, DeafenedSessions: map[string]string{}}

	vc, err := p.store.GetVoiceChannel(channel.Id)
	if err != nil {
		return nil, err
	}
	if vc == nil {
		return state, nil
	}
	state.Voice = true

	sessions, err := p.store.GetDeafenedSessions(channel.Id, time.Now())
	if err != nil {
		return nil, err
	}
	for id, s := range sessions {
		state.DeafenedSessions[id] = s.UserID
	}

	return state, nil
}

// setVoiceChannel turns a channel into a voice channel (voice is true) or back into a regular
// channel, on behalf of the user.
func (p *Plugin) setVoiceChannel(userID string, channel *model.Channel, voice bool) (*VoiceChannelState, error) {
	perm := manageVoicePermission(channel)
	if perm == nil {
		return nil, newAPIError(http.StatusBadRequest, "only public and private channels can be voice channels")
	}
	if channel.DeleteAt != 0 {
		return nil, newAPIError(http.StatusBadRequest, "archived channels can't be changed")
	}
	if !p.API.HasPermissionToChannel(userID, channel.Id, perm) {
		return nil, newAPIError(http.StatusForbidden, "you don't have permission to change this channel")
	}

	if voice {
		// Calls is set up first so that a voice channel always has working calls.
		if err := p.calls.SetVoiceProps(channel.Id, true, p.getConfiguration().AllowVideo); err != nil {
			return nil, errors.Wrap(err, "failed to set up calls in the channel")
		}
		if err := p.store.SaveVoiceChannel(&VoiceChannel{
			ChannelID: channel.Id,
			TeamID:    channel.TeamId,
			EnabledBy: userID,
			EnabledAt: time.Now().UnixMilli(),
		}); err != nil {
			return nil, err
		}
	} else {
		if err := p.store.DeleteVoiceChannel(channel.Id); err != nil {
			return nil, err
		}
		if err := p.calls.SetVoiceProps(channel.Id, false, false); err != nil {
			p.API.LogWarn("Failed to reset the calls settings of a former voice channel", "channel_id", channel.Id, "err", err.Error())
		}
	}

	p.API.PublishWebSocketEvent(wsEventVoiceChannelUpdated, map[string]any{
		"channel_id": channel.Id,
		"team_id":    channel.TeamId,
		"voice":      voice,
	}, &model.WebsocketBroadcast{ChannelId: channel.Id})

	return p.getVoiceChannelState(channel)
}

// setSessionDeafened records whether the user's call session in the voice channel is deafened
// and tells the channel members.
func (p *Plugin) setSessionDeafened(userID string, channel *model.Channel, sessionID string, deafened bool) error {
	vc, err := p.store.GetVoiceChannel(channel.Id)
	if err != nil {
		return err
	}
	if vc == nil {
		return newAPIError(http.StatusBadRequest, "not a voice channel")
	}

	if deafened {
		callsChannel, err := p.calls.GetChannel(channel.Id)
		if err != nil {
			return errors.Wrap(err, "failed to get the call")
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
