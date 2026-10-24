// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

const voiceCommandTrigger = "voice"

// voiceCommandHelp is the command's help text. Voice is now a native channel type (Antimatter channel types, the
// Talk and Stage presets), fixed when the channel is created: there's no longer an "on" or "off" to set here,
// only the channel's own state to tell.
const voiceCommandHelp = "* `/voice` - Tell whether this channel is a voice channel"

func voiceCommand() *model.Command {
	return &model.Command{
		Trigger:          voiceCommandTrigger,
		DisplayName:      "Voice",
		Description:      "Tell whether this channel is a voice channel",
		AutoComplete:     true,
		AutoCompleteDesc: "Tell whether this channel is a voice channel",
		AutocompleteData: model.NewAutocompleteData(voiceCommandTrigger, "", "Tell whether this channel is a voice channel"),
	}
}

func ephemeralResponse(text string) *model.CommandResponse {
	return &model.CommandResponse{ResponseType: model.CommandResponseTypeEphemeral, Text: text}
}

// ExecuteCommand runs the /voice command.
func (p *Plugin) ExecuteCommand(_ *plugin.Context, args *model.CommandArgs) (*model.CommandResponse, *model.AppError) {
	fields := strings.Fields(args.Command)
	if len(fields) == 0 || fields[0] != "/"+voiceCommandTrigger {
		return ephemeralResponse("Unknown command"), nil
	}

	channel, appErr := p.API.GetChannel(args.ChannelId)
	if appErr != nil {
		return ephemeralResponse("Couldn't find this channel."), nil
	}

	var action string
	if len(fields) > 1 {
		action = fields[1]
	}

	switch action {
	case "":
		state, err := p.getVoiceChannelState(channel)
		if err != nil {
			p.API.LogError("Failed to get the voice channel state", "err", err.Error())
			return ephemeralResponse("Something went wrong, please try again."), nil
		}
		if state.Voice {
			return ephemeralResponse("This channel is a voice channel."), nil
		}
		return ephemeralResponse("This channel is a regular channel."), nil
	default:
		return ephemeralResponse(voiceCommandHelp), nil
	}
}
