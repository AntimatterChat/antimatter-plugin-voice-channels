// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

package main

import (
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

const voiceCommandTrigger = "voice"

const voiceCommandHelp = "* `/voice on` - Make this channel a voice channel\n" +
	"* `/voice off` - Make this voice channel a regular channel\n" +
	"* `/voice` - Tell whether this channel is a voice channel"

func voiceCommand() *model.Command {
	autocomplete := model.NewAutocompleteData(voiceCommandTrigger, "[on|off]", "Manage the voice channel setting of this channel")
	autocomplete.AddCommand(model.NewAutocompleteData("on", "", "Make this channel a voice channel"))
	autocomplete.AddCommand(model.NewAutocompleteData("off", "", "Make this voice channel a regular channel"))

	return &model.Command{
		Trigger:          voiceCommandTrigger,
		DisplayName:      "Voice",
		Description:      "Manage voice channels",
		AutoComplete:     true,
		AutoCompleteDesc: "Manage the voice channel setting of this channel",
		AutoCompleteHint: "[on|off]",
		AutocompleteData: autocomplete,
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
	case "on", "off":
		if _, err := p.setVoiceChannel(args.UserId, channel, action == "on"); err != nil {
			if statusFor(err) >= 500 {
				p.API.LogError("Failed to change a voice channel", "channel_id", channel.Id, "err", err.Error())
			}
			return ephemeralResponse(commandErrorText(err)), nil
		}
		if action == "on" {
			return ephemeralResponse("This channel is now a voice channel."), nil
		}
		return ephemeralResponse("This channel is now a regular channel."), nil
	default:
		return ephemeralResponse(voiceCommandHelp), nil
	}
}

func commandErrorText(err error) string {
	switch statusFor(err) {
	case 400, 403:
		return "Couldn't change this channel: " + err.Error() + "."
	case 503:
		return "Couldn't change this channel: calls are unavailable. Ask your system administrator to enable the Calls plugin."
	default:
		return "Something went wrong, please try again."
	}
}
