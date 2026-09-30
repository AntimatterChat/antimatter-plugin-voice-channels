# Voice Channels

An Antimatter plugin that turns public and private channels into always-open voice rooms, like the
voice channels of Discord or the rooms of TeamSpeak. Members hop in and out of a voice channel's
call whenever they want and keep chatting in the channel.

The plugin only adds the voice channel experience. Everything media (audio, video, screen sharing,
the SFU, TURN, recordings...) is handled by the **Calls plugin**, so there is one calls stack to run
and configure.

## Features

- **Voice channels.** Any public or private channel can be made a voice channel by people who can
  manage its properties: from the new **Voice** tab of the channel settings, as a **Voice channel**
  type in the new channel modal, or with the `/voice on|off` slash command (works from every client).
  Voice channels get a speaker icon in the sidebar.
- **Join by opening.** Opening a voice channel from the sidebar joins its call (can be turned off).
  Joining another voice channel leaves the previous one; other calls, e.g. a direct message call,
  are only left when using the channel's **Join voice** button.
- **Who's in, visible to all.** The people in a voice channel's call are listed below the channel in
  the sidebar, for every member of the channel, with who is speaking, muted, deafened, sharing their
  screen, using their camera or raising their hand.
- **Stage.** A voice channel opens on its stage: a tile for every participant, their camera when
  it's on, the screen share, a focus mode and full screen for videos, and a toggle to show the
  channel's messages.
- **Group video.** Participants of voice channels can turn on their camera (a Calls feature that is
  otherwise limited to direct messages).
- **Deafen.** Participants can deafen themselves (stop hearing the call, which also mutes them);
  everyone sees it. Unmuting undeafens.
- **No "call started" spam.** Calls in voice channels don't post a "call started" message.

The call controls (mute, camera, screen sharing, raise hand, reactions, devices, leave, pop-out,
host controls...) are the ones of the Calls widget, which stays visible while in a call, whatever
channel is open.

## Requirements

- An Antimatter server. The webapp uses two small plugin hooks added by Antimatter (see below); on
  other servers the plugin falls back to a degraded UI.
- The **Calls plugin from the Antimatter fork, branch `voice-channels`**
  (https://github.com/antimatterchat/antimatter-plugin-calls). It lets other plugins manage the calls
  settings of a channel and adds the channel settings voice channels rely on. With another Calls
  version, voice channels can't be created (the API answers 503 and the `/voice` command says calls
  are unavailable).
- To allow video in voice channels, **video must be enabled in the Calls plugin settings**
  (System Console > Plugins > Calls > Enable video).

## Enabling and disabling

The feature is enabled and disabled like any plugin:

- **System Console > Plugins > Plugin Management**, or **System Console > Plugins > Voice Channels
  > Enable plugin**.
- With the server configuration, `PluginSettings.PluginStates["com.antimatterchat.voice-channels"].Enable`.
- With environment variables, the server reads `MM_PLUGINSETTINGS_PLUGINSTATES` as JSON. It
  replaces the whole map of plugin states, so it has to list every plugin to enable, e.g.
  `MM_PLUGINSETTINGS_PLUGINSTATES='{"com.mattermost.calls":{"Enable":true},"com.antimatterchat.voice-channels":{"Enable":true}}'`.

When the plugin is disabled, voice channels behave as regular channels that keep their calls
settings (calls enabled, no "call started" posts, video allowed); they become voice channels again
when the plugin is enabled.

### Settings

System Console > Plugins > Voice Channels:

| Setting | Default | Meaning |
| --- | --- | --- |
| Join when opening a voice channel (`AutoJoin`) | true | Opening a voice channel from the sidebar joins its call. When false, users join with the stage's **Join voice** button. |
| Allow video in voice channels (`AllowVideo`) | true | Participants can turn on their camera. Video must also be enabled in the Calls plugin. |

They can also be set in `PluginSettings.Plugins["com.antimatterchat.voice-channels"]` (keys in
lowercase: `autojoin`, `allowvideo`).

See the [documentation](https://docs.antimatter.example/voice-channels) for more.

## How it works

### Server

- A voice channel is a `vc_<channel id>` key in the plugin's KV store. The plugin's own data never
  goes into the Calls plugin or the channel.
- Making a channel a voice channel configures its calls through inter-plugin requests to the Calls
  plugin: calls are enabled and the channel gets these Calls channel props:
  `broadcast_session_state` (send mute/voice/screen/video/hand events to the whole channel, so that
  members outside the call see who's talking), `disable_call_post` (no "call started" post) and,
  unless `AllowVideo` is off, `enable_video`. Making it a regular channel again removes the props and
  leaves calls enabled.
- The plugin sets these up again when it's activated and when `AllowVideo` changes, retrying while
  the Calls plugin is unavailable (e.g. activated later), and forgets voice channels whose channel
  was deleted. Archived voice channels are hidden and come back when unarchived.
- Calls has no deafen: the plugin keeps the deafened call sessions of each voice channel
  (`deaf_<channel id>`, expiring after a day without update) and only accepts a session of the
  user's own that is in the call.

REST API, under `/plugins/com.antimatterchat.voice-channels/api/v1` (user session required):

| Method & path | Body | Response |
| --- | --- | --- |
| `GET /config` | | `{"auto_join": bool, "allow_video": bool}` |
| `GET /channels` | | the voice channels the user is a member of: `[{"channel_id", "team_id", "voice": true, "deafened_sessions": {"<session id>": "<user id>"}}]` |
| `GET /channels/{channel_id}` | | the same for one channel the user can read (`voice` may be false) |
| `PUT /channels/{channel_id}` | `{"voice": bool}` | the channel's state. Needs the permission to manage the channel's properties (public or private); `400` for other channel types or archived channels, `503` when calls are unavailable. |
| `PUT /channels/{channel_id}/sessions/{session_id}/deafened` | `{"deafened": bool}` | `{"status": "OK"}` |

WebSocket events, sent to the channel's members: `custom_com.antimatterchat.voice-channels_voice_channel_updated`
(`{channel_id, team_id, voice}`) and `custom_com.antimatterchat.voice-channels_session_deafened`
(`{channel_id, session_id, user_id, deafened}`).

### Webapp

- Reads the call state (participants, mute, speaking, screen sharing, video, the current call) from
  the Calls plugin's store, and the cameras and screens from the Calls client of the window
  (`window.callsClient`), which tells which session sent each stream.
- Joins and leaves calls through the Calls plugin's `/call join` and `/call leave`, so that its
  checks, its widget and the desktop app's call window keep working.
- Deafens by disabling the remote audio tracks of the Calls client.
- Uses these host plugin hooks:

| Hook | Used for | Without it |
| --- | --- | --- |
| `registerSidebarChannelFooterComponent` (Antimatter) | participants below the channel | avatars next to the channel name |
| `registerChannelViewPanel` (Antimatter) | the stage in the channel view | the stage in the right-hand sidebar, from a channel header button |
| `registerChannelIconOverride` | speaker icon | regular channel icon |
| `registerChannelSettingsTab` | Voice tab of the channel settings | `/voice` command |
| `registerChannelTypeOption` | Voice channel type in the new channel modal | `/voice` command |
| `registerSidebarChannelLinkLabelComponent` | join when opening from the sidebar | |

In the desktop app, calls run in a separate window: the stage then shows the participants without
their videos and points to the call window, and deafen isn't available.

## Compared to the original built-in voice channels

This plugin replaces an earlier built-in implementation that had its own SFU. Differences:

| Built-in design | This plugin |
| --- | --- |
| In-process pion SFU, own signalling, UDP/TCP ports, `VoiceSettings` | The Calls plugin (integrated SFU or rtcd), configured in the Calls settings |
| `Channels.Props` column (migration) with `props.voice` | Plugin KV store, no server or schema change |
| `EnableVoiceChannels` switch | Enabling or disabling the plugin |
| Voice control bar at the bottom of the sidebar | The Calls widget (same place in the browser, plus devices, reactions, raise hand, pop-out, host controls) and the stage's Deafen button |
| Deafen in the control bar | Deafen on the stage; unmuting from the widget undeafens |
| Speaking indicators computed from audio levels by every client | Voice activity from Calls, sent to the whole channel |
| Joining a voice channel ends the session elsewhere, across devices | One call per client, handled by Calls; another voice channel's call is left when joining |
| Group video and screen sharing | Same; one screen share at a time (a Calls limit) |
| Voice toggle inside the channel settings info tab and the new channel modal | A Voice tab in the channel settings and a Voice channel type in the new channel modal |

Not ported: the per-channel `voice` channel prop in the channel API (voice channels are known
through this plugin's API instead) and the built-in `VoiceSettings` (ports, ICE servers), which
are the Calls plugin's settings.

## Development

```sh
make dist      # build the plugin bundle in dist/
make test      # run the server and webapp tests
make check-style
```

Set `MM_SERVICESETTINGS_ENABLEDEVELOPER=true` to only build the server for the current platform.

## License

GNU Affero General Public License v3.0, see [LICENSE.txt](LICENSE.txt). The build tooling is derived
from Apache-2.0 licensed Mattermost plugins, see [NOTICE.txt](NOTICE.txt).
