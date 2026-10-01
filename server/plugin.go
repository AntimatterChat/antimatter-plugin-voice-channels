// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"net/http"
	"sync"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/plugin"
	"github.com/pkg/errors"
)

// Plugin implements the interface expected by the Antimatter server to communicate between the
// server and plugin processes.
type Plugin struct {
	plugin.MattermostPlugin

	// configurationLock synchronizes access to the configuration.
	configurationLock sync.RWMutex

	// configuration is the active plugin configuration. Consult getConfiguration and
	// setConfiguration for usage.
	configuration *configuration

	store  *Store
	calls  *CallsClient
	router *mux.Router

	// syncLock guards syncTrigger and syncStop, set while the plugin is active.
	syncLock    sync.Mutex
	syncTrigger chan struct{}
	syncStop    chan struct{}
}

// OnActivate is invoked when the plugin is activated.
func (p *Plugin) OnActivate() error {
	p.store = NewStore(p.API)
	p.calls = NewCallsClient(p.API.PluginHTTP)
	p.router = p.newRouter()

	if err := p.API.RegisterCommand(voiceCommand()); err != nil {
		return errors.Wrap(err, "failed to register the /voice command")
	}

	p.syncLock.Lock()
	p.syncTrigger = make(chan struct{}, 1)
	p.syncStop = make(chan struct{})
	go p.runCallsSync(p.syncTrigger, p.syncStop)
	p.syncLock.Unlock()

	return nil
}

// OnDeactivate is invoked when the plugin is deactivated.
func (p *Plugin) OnDeactivate() error {
	p.syncLock.Lock()
	defer p.syncLock.Unlock()
	if p.syncStop != nil {
		close(p.syncStop)
		p.syncStop = nil
		p.syncTrigger = nil
	}
	return nil
}

// ServeHTTP serves the plugin's REST API.
func (p *Plugin) ServeHTTP(_ *plugin.Context, w http.ResponseWriter, r *http.Request) {
	p.router.ServeHTTP(w, r)
}
