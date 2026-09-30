// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/pkg/errors"
)

const (
	// voiceChannelKeyPrefix prefixes the key of every voice channel.
	voiceChannelKeyPrefix = "vc_"
	// deafenedKeyPrefix prefixes the key of the deafened sessions of a voice channel.
	deafenedKeyPrefix = "deaf_"

	// deafenedSessionTTL is how long a session is kept deafened without an update. Sessions that
	// ended without undeafening (e.g. a closed browser) are dropped after this long; clients also
	// ignore the sessions that aren't in the call.
	deafenedSessionTTL = 24 * time.Hour

	kvListPageSize       = 200
	atomicUpdateAttempts = 5
)

// kvAPI is the part of the plugin API used to store data (implemented by plugin.API).
type kvAPI interface {
	KVGet(key string) ([]byte, *model.AppError)
	KVSetWithOptions(key string, value []byte, options model.PluginKVSetOptions) (bool, *model.AppError)
	KVDelete(key string) *model.AppError
	KVList(page, perPage int) ([]string, *model.AppError)
}

// VoiceChannel is a channel flagged as a voice channel.
type VoiceChannel struct {
	ChannelID string `json:"channel_id"`
	TeamID    string `json:"team_id"`
	EnabledBy string `json:"enabled_by"`
	EnabledAt int64  `json:"enabled_at"`
}

// DeafenedSession is a call session whose user doesn't hear the call.
type DeafenedSession struct {
	UserID    string `json:"user_id"`
	UpdatedAt int64  `json:"updated_at"`
}

// Store keeps the voice channels and the deafened sessions in the plugin's KV store.
type Store struct {
	kv kvAPI
}

func NewStore(kv kvAPI) *Store {
	return &Store{kv: kv}
}

func voiceChannelKey(channelID string) string {
	return voiceChannelKeyPrefix + channelID
}

func deafenedKey(channelID string) string {
	return deafenedKeyPrefix + channelID
}

// GetVoiceChannel returns the voice channel, or nil if the channel isn't a voice channel.
func (s *Store) GetVoiceChannel(channelID string) (*VoiceChannel, error) {
	data, appErr := s.kv.KVGet(voiceChannelKey(channelID))
	if appErr != nil {
		return nil, errors.Wrap(appErr, "failed to get voice channel")
	}
	if data == nil {
		return nil, nil
	}

	var vc VoiceChannel
	if err := json.Unmarshal(data, &vc); err != nil {
		return nil, errors.Wrap(err, "failed to decode voice channel")
	}
	return &vc, nil
}

// SaveVoiceChannel flags a channel as a voice channel.
func (s *Store) SaveVoiceChannel(vc *VoiceChannel) error {
	data, err := json.Marshal(vc)
	if err != nil {
		return errors.Wrap(err, "failed to encode voice channel")
	}
	if _, appErr := s.kv.KVSetWithOptions(voiceChannelKey(vc.ChannelID), data, model.PluginKVSetOptions{}); appErr != nil {
		return errors.Wrap(appErr, "failed to save voice channel")
	}
	return nil
}

// DeleteVoiceChannel makes a voice channel a regular channel again.
func (s *Store) DeleteVoiceChannel(channelID string) error {
	if appErr := s.kv.KVDelete(voiceChannelKey(channelID)); appErr != nil {
		return errors.Wrap(appErr, "failed to delete voice channel")
	}
	if appErr := s.kv.KVDelete(deafenedKey(channelID)); appErr != nil {
		return errors.Wrap(appErr, "failed to delete deafened sessions")
	}
	return nil
}

// ListVoiceChannels returns all the voice channels.
func (s *Store) ListVoiceChannels() ([]*VoiceChannel, error) {
	var channels []*VoiceChannel
	for page := 0; ; page++ {
		keys, appErr := s.kv.KVList(page, kvListPageSize)
		if appErr != nil {
			return nil, errors.Wrap(appErr, "failed to list keys")
		}

		for _, key := range keys {
			channelID, ok := strings.CutPrefix(key, voiceChannelKeyPrefix)
			if !ok {
				continue
			}
			vc, err := s.GetVoiceChannel(channelID)
			if err != nil {
				return nil, err
			}
			if vc != nil {
				channels = append(channels, vc)
			}
		}

		if len(keys) < kvListPageSize {
			return channels, nil
		}
	}
}

// GetDeafenedSessions returns the deafened sessions of a voice channel by session ID.
func (s *Store) GetDeafenedSessions(channelID string, now time.Time) (map[string]DeafenedSession, error) {
	data, appErr := s.kv.KVGet(deafenedKey(channelID))
	if appErr != nil {
		return nil, errors.Wrap(appErr, "failed to get deafened sessions")
	}

	sessions, err := decodeDeafenedSessions(data)
	if err != nil {
		return nil, err
	}
	pruneDeafenedSessions(sessions, now)
	return sessions, nil
}

// SetSessionDeafened records whether a call session is deafened. It returns false, without
// changing anything, when undeafening a session that belongs to another user.
func (s *Store) SetSessionDeafened(channelID, sessionID, userID string, deafened bool, now time.Time) (bool, error) {
	key := deafenedKey(channelID)
	for range atomicUpdateAttempts {
		oldData, appErr := s.kv.KVGet(key)
		if appErr != nil {
			return false, errors.Wrap(appErr, "failed to get deafened sessions")
		}

		sessions, err := decodeDeafenedSessions(oldData)
		if err != nil {
			return false, err
		}
		pruneDeafenedSessions(sessions, now)

		if existing, ok := sessions[sessionID]; ok && existing.UserID != userID {
			return false, nil
		}
		if deafened {
			sessions[sessionID] = DeafenedSession{UserID: userID, UpdatedAt: now.UnixMilli()}
		} else {
			delete(sessions, sessionID)
		}

		var newData []byte
		if len(sessions) > 0 {
			if newData, err = json.Marshal(sessions); err != nil {
				return false, errors.Wrap(err, "failed to encode deafened sessions")
			}
		}
		if newData == nil && oldData == nil {
			return true, nil
		}
		if bytes.Equal(newData, oldData) {
			return true, nil
		}

		ok, appErr := s.kv.KVSetWithOptions(key, newData, model.PluginKVSetOptions{Atomic: true, OldValue: oldData})
		if appErr != nil {
			return false, errors.Wrap(appErr, "failed to save deafened sessions")
		}
		if ok {
			return true, nil
		}
	}

	return false, errors.New("failed to save deafened sessions: too many concurrent updates")
}

func decodeDeafenedSessions(data []byte) (map[string]DeafenedSession, error) {
	sessions := map[string]DeafenedSession{}
	if data == nil {
		return sessions, nil
	}
	if err := json.Unmarshal(data, &sessions); err != nil {
		return nil, errors.Wrap(err, "failed to decode deafened sessions")
	}
	return sessions, nil
}

func pruneDeafenedSessions(sessions map[string]DeafenedSession, now time.Time) {
	limit := now.Add(-deafenedSessionTTL).UnixMilli()
	for id, session := range sessions {
		if session.UpdatedAt < limit {
			delete(sessions, id)
		}
	}
}
