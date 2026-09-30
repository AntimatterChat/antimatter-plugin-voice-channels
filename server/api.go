// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
)

const requestBodyMaxSizeBytes = 64 * 1024

// ClientConfig is the part of the plugin configuration clients need.
type ClientConfig struct {
	AutoJoin   bool `json:"auto_join"`
	AllowVideo bool `json:"allow_video"`
}

// newRouter returns the router of the plugin's REST API, served under
// /plugins/com.antimatterchat.voice-channels/api/v1.
func (p *Plugin) newRouter() *mux.Router {
	router := mux.NewRouter()
	router.Use(p.requireUser)

	api := router.PathPrefix("/api/v1").Subrouter()
	api.HandleFunc("/config", p.handleGetConfig).Methods(http.MethodGet)
	api.HandleFunc("/channels", p.handleListChannels).Methods(http.MethodGet)
	api.HandleFunc("/channels/{channel_id:[a-z0-9]{26}}", p.handleGetChannel).Methods(http.MethodGet)
	api.HandleFunc("/channels/{channel_id:[a-z0-9]{26}}", p.handleUpdateChannel).Methods(http.MethodPut)
	api.HandleFunc("/channels/{channel_id:[a-z0-9]{26}}/sessions/{session_id:[a-z0-9]{26}}/deafened", p.handleSetDeafened).Methods(http.MethodPut)

	return router
}

func (p *Plugin) requireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Mattermost-User-Id") == "" {
			http.Error(w, "Not authorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (p *Plugin) writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		p.API.LogWarn("Failed to write response", "err", err.Error())
	}
}

func (p *Plugin) writeError(w http.ResponseWriter, err error) {
	status := statusFor(err)
	if status >= http.StatusInternalServerError {
		p.API.LogError("Voice channels request failed", "err", err.Error())
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

// readableChannel returns the channel of the request if the user can read it.
func (p *Plugin) readableChannel(r *http.Request) (*model.Channel, error) {
	userID := r.Header.Get("Mattermost-User-Id")
	channelID := mux.Vars(r)["channel_id"]

	if !p.API.HasPermissionToChannel(userID, channelID, model.PermissionReadChannel) {
		return nil, newAPIError(http.StatusForbidden, "you don't have access to this channel")
	}

	channel, appErr := p.API.GetChannel(channelID)
	if appErr != nil {
		if appErr.StatusCode == http.StatusNotFound {
			return nil, newAPIError(http.StatusNotFound, "channel not found")
		}
		return nil, appErr
	}
	return channel, nil
}

func (p *Plugin) handleGetConfig(w http.ResponseWriter, _ *http.Request) {
	cfg := p.getConfiguration()
	p.writeJSON(w, ClientConfig{AutoJoin: cfg.AutoJoin, AllowVideo: cfg.AllowVideo})
}

func (p *Plugin) handleListChannels(w http.ResponseWriter, r *http.Request) {
	states, err := p.listVoiceChannelsForUser(r.Header.Get("Mattermost-User-Id"))
	if err != nil {
		p.writeError(w, err)
		return
	}
	p.writeJSON(w, states)
}

func (p *Plugin) handleGetChannel(w http.ResponseWriter, r *http.Request) {
	channel, err := p.readableChannel(r)
	if err != nil {
		p.writeError(w, err)
		return
	}

	state, err := p.getVoiceChannelState(channel)
	if err != nil {
		p.writeError(w, err)
		return
	}
	p.writeJSON(w, state)
}

func (p *Plugin) handleUpdateChannel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Voice *bool `json:"voice"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, requestBodyMaxSizeBytes)).Decode(&body); err != nil || body.Voice == nil {
		p.writeError(w, newAPIError(http.StatusBadRequest, `invalid request body, expected {"voice": true|false}`))
		return
	}

	channel, err := p.readableChannel(r)
	if err != nil {
		p.writeError(w, err)
		return
	}

	state, err := p.setVoiceChannel(r.Header.Get("Mattermost-User-Id"), channel, *body.Voice)
	if err != nil {
		p.writeError(w, err)
		return
	}
	p.writeJSON(w, state)
}

func (p *Plugin) handleSetDeafened(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Deafened *bool `json:"deafened"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, requestBodyMaxSizeBytes)).Decode(&body); err != nil || body.Deafened == nil {
		p.writeError(w, newAPIError(http.StatusBadRequest, `invalid request body, expected {"deafened": true|false}`))
		return
	}

	channel, err := p.readableChannel(r)
	if err != nil {
		p.writeError(w, err)
		return
	}

	if err := p.setSessionDeafened(r.Header.Get("Mattermost-User-Id"), channel, mux.Vars(r)["session_id"], *body.Deafened); err != nil {
		p.writeError(w, err)
		return
	}
	p.writeJSON(w, map[string]string{"status": "OK"})
}
