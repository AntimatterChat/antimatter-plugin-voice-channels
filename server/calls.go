// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"reflect"

	"github.com/pkg/errors"
)

const callsPluginID = "com.mattermost.calls"

// Calls channel props (see the Calls plugin's server/public/calls_channel.go) set on voice channels.
const (
	callsPropBroadcastSessionState = "broadcast_session_state"
	callsPropDisableCallPost       = "disable_call_post"
	callsPropEnableVideo           = "enable_video"
)

// voiceCallsProps are the Calls channel props this plugin manages.
var voiceCallsProps = []string{callsPropBroadcastSessionState, callsPropDisableCallPost, callsPropEnableVideo}

// errCallsUnavailable is returned when the Calls plugin can't be reached: it isn't installed or
// enabled, or it's a version that doesn't let other plugins manage channels.
var errCallsUnavailable = errors.New("the Calls plugin is unavailable or doesn't support voice channels")

// CallsSession is a session of an ongoing call.
type CallsSession struct {
	SessionID string `json:"session_id"`
	UserID    string `json:"user_id"`
}

// CallsChannel is the Calls state of a channel.
type CallsChannel struct {
	ChannelID string         `json:"channel_id"`
	Enabled   bool           `json:"enabled"`
	Props     map[string]any `json:"props"`
	Call      *struct {
		Sessions []CallsSession `json:"sessions"`
	} `json:"call,omitempty"`
}

// HasSession returns whether the ongoing call of the channel has the given session of the user.
func (c *CallsChannel) HasSession(sessionID, userID string) bool {
	if c == nil || c.Call == nil {
		return false
	}
	for _, s := range c.Call.Sessions {
		if s.SessionID == sessionID && s.UserID == userID {
			return true
		}
	}
	return false
}

// CallsClient talks to the Calls plugin through inter-plugin requests.
type CallsClient struct {
	pluginHTTP func(*http.Request) *http.Response
}

func NewCallsClient(pluginHTTP func(*http.Request) *http.Response) *CallsClient {
	return &CallsClient{pluginHTTP: pluginHTTP}
}

func (c *CallsClient) do(method, channelID string, body any, out any) error {
	var reqBody io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return errors.Wrap(err, "failed to encode request")
		}
		reqBody = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, fmt.Sprintf("/%s/%s", callsPluginID, channelID), reqBody)
	if err != nil {
		return errors.Wrap(err, "failed to create request")
	}
	req.Header.Set("Content-Type", "application/json")

	resp := c.pluginHTTP(req)
	if resp == nil {
		return errCallsUnavailable
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusNotImplemented:
		return errCallsUnavailable
	case resp.StatusCode != http.StatusOK:
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return errors.Errorf("calls request failed with status %d: %s", resp.StatusCode, bytes.TrimSpace(msg))
	}

	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return errors.Wrap(err, "failed to decode calls response")
		}
	}
	return nil
}

// GetChannel returns the Calls state of a channel, including its ongoing call if any.
func (c *CallsClient) GetChannel(channelID string) (*CallsChannel, error) {
	var channel CallsChannel
	if err := c.do(http.MethodGet, channelID, nil, &channel); err != nil {
		return nil, err
	}
	return &channel, nil
}

// SetVoiceProps configures calls in the channel for a voice channel (enabled is true): calls are
// enabled and the voice channel props are set, keeping any other props. When enabled is false,
// the voice channel props are removed and the rest is left as is.
func (c *CallsClient) SetVoiceProps(channelID string, enabled, allowVideo bool) error {
	channel, err := c.GetChannel(channelID)
	if err != nil {
		return err
	}

	props := map[string]any{}
	for k, v := range channel.Props {
		props[k] = v
	}
	for _, k := range voiceCallsProps {
		delete(props, k)
	}

	callsEnabled := channel.Enabled
	if enabled {
		callsEnabled = true
		props[callsPropBroadcastSessionState] = true
		props[callsPropDisableCallPost] = true
		if allowVideo {
			props[callsPropEnableVideo] = true
		}
	}

	if callsEnabled == channel.Enabled && propsEqual(props, channel.Props) {
		return nil
	}

	return c.do(http.MethodPost, channelID, map[string]any{
		"enabled": callsEnabled,
		"props":   props,
	}, nil)
}

func propsEqual(a, b map[string]any) bool {
	if len(a) == 0 && len(b) == 0 {
		return true
	}
	return reflect.DeepEqual(a, b)
}
