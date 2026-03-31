/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { showNotification } from "@api/Notifications";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { findComponentByCodeLazy } from "@webpack";
import { SelectedChannelStore } from "@webpack/common";
import ErrorBoundary from "@components/ErrorBoundary";

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
    deaf: boolean;
    mute: boolean;
    selfDeaf: boolean;
    selfMute: boolean;
}

const VoiceStateStore = findByPropsLazy("getVoiceStatesForChannel", "getCurrentClientVoiceChannelId");

let faking: boolean = false;
let origWS: (data: string | ArrayBufferLike | Blob | ArrayBufferView) => void;

function log(text: string) {
    new Logger("FakeDeafen", "#7b4af7").info(text);
}

const settings = definePluginSettings({
    notifications: {
        type: OptionType.BOOLEAN,
        description: "Show a notification on the bottom right when enabled/disabled",
        default: true
    }
});

let notificationsEnabled = true;
let settingsInterval: ReturnType<typeof setInterval>;

export default definePlugin({
    name: "FakeDeafen",
    description: "Fake deafens you. (So you still hear things)",
    authors: [{ name: "Mr_PanoZzz", id: 939129546551210056n }],
    version: "1.1.0",
    settings,

    flux: {
        AUDIO_TOGGLE_SELF_DEAF: async function () {
            await new Promise(f => setTimeout(f, 100));

            const chanId = SelectedChannelStore.getVoiceChannelId()!;
            const s = VoiceStateStore.getVoiceStateForChannel(chanId) as VoiceState;
            if (!s) return;

            const event = s.deaf || s.selfDeaf ? "undeafen" : "deafen";
            if (event === "deafen") {
                faking = true;

                // Override original websocket prototype
                WebSocket.prototype.send = function (data) {
                    const dataType = Object.prototype.toString.call(data);

                    switch (dataType) {
                        case "[object String]":
                            let obj: any;
                            try {
                                obj = JSON.parse(data);
                            } catch {
                                // Not a json!
                                origWS.apply(this, [data]);
                                return;
                            }

                            if (obj.d !== undefined && obj.d.self_deaf !== undefined && obj.d.self_deaf === false) {
                                // Undeafen packet, discard it
                                return;
                            }
                            break;

                        case "[object ArrayBuffer]":
                            const decoder = new TextDecoder("utf-8");
                            if (decoder.decode(data).includes("self_deafs\x05false")) {
                                // Undeafen packet, discard it
                                return;
                            }
                            break;
                    }

                    // Pass data down to original websocket
                    origWS.apply(this, [data]);
                };

		if (notificationsEnabled) {
			showNotification({
                    		title: "FakeDeafen",
                    		body: "Deafening is now faked. Please undeafen."
                	});
		}
            } else {
                if (faking === true) {
                    faking = false;
                } else {
                    WebSocket.prototype.send = origWS;

			if (notificationsEnabled) {
                    		showNotification({
                        		title: "FakeDeafen",
                        		body: "Fake deafen is now disabled."
                    		});
			}
                }
            }
        }
    },

    start: function () {
        origWS = WebSocket.prototype.send;

        notificationsEnabled = settings.store.notifications;

        settingsInterval = setInterval(() => {
            notificationsEnabled = settings.store.notifications;
        }, 1000);

        log("Ready");
    },

    stop: function () {
        WebSocket.prototype.send = origWS;

        clearInterval(settingsInterval);

        log("Disarmed");
    }
});
