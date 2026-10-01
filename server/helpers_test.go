// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// fakeKV is an in-memory kvAPI.
type fakeKV struct {
	mu   sync.Mutex
	data map[string][]byte
}

func newFakeKV() *fakeKV {
	return &fakeKV{data: map[string][]byte{}}
}

func (f *fakeKV) KVGet(key string) ([]byte, *model.AppError) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if v, ok := f.data[key]; ok {
		return bytes.Clone(v), nil
	}
	return nil, nil
}

func (f *fakeKV) KVSetWithOptions(key string, value []byte, options model.PluginKVSetOptions) (bool, *model.AppError) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if options.Atomic {
		current, exists := f.data[key]
		if options.OldValue == nil && exists || options.OldValue != nil && (!exists || !bytes.Equal(current, options.OldValue)) {
			return false, nil
		}
	}
	if value == nil {
		delete(f.data, key)
	} else {
		f.data[key] = bytes.Clone(value)
	}
	return true, nil
}

func (f *fakeKV) KVDelete(key string) *model.AppError {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.data, key)
	return nil
}

func (f *fakeKV) KVList(page, perPage int) ([]string, *model.AppError) {
	f.mu.Lock()
	defer f.mu.Unlock()
	keys := make([]string, 0, len(f.data))
	for k := range f.data {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	start := min(page*perPage, len(keys))
	end := min(start+perPage, len(keys))
	return keys[start:end], nil
}

// fakeCalls fakes the channel settings API of the Calls plugin.
type fakeCalls struct {
	mu          sync.Mutex
	unavailable bool
	channels    map[string]*CallsChannel
	posts       []map[string]any
}

func newFakeCalls() *fakeCalls {
	return &fakeCalls{channels: map[string]*CallsChannel{}}
}

func (f *fakeCalls) channel(channelID string) *CallsChannel {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.channels[channelID]
}

func (f *fakeCalls) pluginHTTP(r *http.Request) *http.Response {
	f.mu.Lock()
	defer f.mu.Unlock()

	rec := httptest.NewRecorder()
	channelID, ok := strings.CutPrefix(r.URL.Path, "/"+callsPluginID+"/")
	if f.unavailable || !ok {
		rec.WriteHeader(http.StatusNotFound)
		return rec.Result()
	}

	channel := f.channels[channelID]
	if channel == nil {
		channel = &CallsChannel{ChannelID: channelID}
	}

	switch r.Method {
	case http.MethodGet:
		_ = json.NewEncoder(rec).Encode(channel)
	case http.MethodPost:
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			rec.WriteHeader(http.StatusBadRequest)
			return rec.Result()
		}
		f.posts = append(f.posts, body)
		updated := &CallsChannel{ChannelID: channelID, Enabled: body["enabled"].(bool), Call: channel.Call}
		if props, ok := body["props"].(map[string]any); ok {
			updated.Props = props
		} else {
			updated.Props = channel.Props
		}
		f.channels[channelID] = updated
		_ = json.NewEncoder(rec).Encode(updated)
	default:
		rec.WriteHeader(http.StatusMethodNotAllowed)
	}
	return rec.Result()
}

// setCall adds an ongoing call with the given sessions (session ID -> user ID) to the channel.
func (f *fakeCalls) setCall(channelID string, sessions map[string]string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	channel := f.channels[channelID]
	if channel == nil {
		channel = &CallsChannel{ChannelID: channelID}
		f.channels[channelID] = channel
	}
	channel.Call = &struct {
		Sessions []CallsSession `json:"sessions"`
	}{}
	for sessionID, userID := range sessions {
		channel.Call.Sessions = append(channel.Call.Sessions, CallsSession{SessionID: sessionID, UserID: userID})
	}
}

type testEnv struct {
	p     *Plugin
	api   *plugintest.API
	kv    *fakeKV
	calls *fakeCalls
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()

	api := &plugintest.API{}
	t.Cleanup(func() { api.AssertExpectations(t) })
	// Allow logging with any number of key/value pairs
	for _, level := range []string{"LogDebug", "LogInfo", "LogWarn", "LogError"} {
		for n := 1; n <= 7; n += 2 {
			args := make([]any, n)
			for i := range args {
				args[i] = mock.Anything
			}
			api.On(level, args...).Maybe()
		}
	}

	kv := newFakeKV()
	calls := newFakeCalls()
	p := &Plugin{
		MattermostPlugin: plugin.MattermostPlugin{API: api},
		configuration:    &configuration{AutoJoin: true, AllowVideo: true},
		store:            NewStore(kv),
		calls:            NewCallsClient(calls.pluginHTTP),
	}
	p.router = p.newRouter()

	return &testEnv{p: p, api: api, kv: kv, calls: calls}
}

// request serves a request to the plugin's REST API as the given user.
func (e *testEnv) request(t *testing.T, userID, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()

	var reqBody *bytes.Reader
	if body != nil {
		data, err := json.Marshal(body)
		require.NoError(t, err)
		reqBody = bytes.NewReader(data)
	} else {
		reqBody = bytes.NewReader(nil)
	}

	r := httptest.NewRequest(method, path, reqBody)
	if userID != "" {
		r.Header.Set("Mattermost-User-Id", userID)
	}
	w := httptest.NewRecorder()
	e.p.ServeHTTP(nil, w, r)
	return w
}
