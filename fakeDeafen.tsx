/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import React from "react";
import { definePluginSettings } from "@api/Settings";
import { showNotification } from "@api/Notifications";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps, findByPropsLazy, findComponentByCodeLazy } from "@webpack";
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

const Button = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");
const VoiceStateStore = findByPropsLazy("getVoiceStatesForChannel", "getCurrentClientVoiceChannelId");

const logger = new Logger("FakeDeafen", "#7b4af7");

let enabled = false;
let origWS: (data: string | ArrayBufferLike | Blob | ArrayBufferView) => void;

const settings = definePluginSettings({
    pluginEnabled: {
        type: OptionType.BOOLEAN,
        description: "Master Switch: Enable or completely disable Fake Deafen functionality",
        default: true,
        onChange: (val) => {
            if (!val && enabled) {
                toggleFakeDeafen(false);
            }
        }
    },
    showButton: {
        type: OptionType.BOOLEAN,
        description: "Add a dedicated Fake Deafen button to your account bar instead of double-clicking standard Deafen",
        default: true,
        onChange: () => {
            if (enabled) toggleFakeDeafen(false);
        }
    },
    notifications: {
        type: OptionType.BOOLEAN,
        description: "Show a notification on the bottom right when enabled/disabled",
        default: true
    }
});

function refresh_voice_state(isEnabled: boolean) {
    const ChannelStore = findByProps("getChannel", "getDMFromUserId");
    const wsModule = findByProps("getSocket");
    const MediaEngineStore = findByProps("isDeaf", "isMute");

    if (!wsModule || !SelectedChannelStore) return;
    
    const socket = wsModule.getSocket();
    const channelId = SelectedChannelStore.getVoiceChannelId();
    const channel = channelId ? ChannelStore?.getChannel(channelId) : null;
    
    if (socket && channelId) {
        try {
            socket.send(4, {
                guild_id: channel?.guild_id ?? null,
                channel_id: channelId,
                self_mute: isEnabled || (MediaEngineStore?.isMute() ?? false),
                self_deaf: isEnabled || (MediaEngineStore?.isDeaf() ?? false),
                self_video: false,
                flags: 0
            });
        } catch (error) {
            logger.error("Failed to update voice state:", error);
        }
    }
}

function toggleFakeDeafen(forceState?: boolean) {
    enabled = forceState !== undefined ? forceState : !enabled;

    if (enabled && settings.store.notifications) {
        showNotification({
            title: "FakeDeafen",
            body: "Deafening is now faked. Please undeafen."
        });
    } else if (!enabled && settings.store.notifications) {
        showNotification({
            title: "FakeDeafen",
            body: "Fake deafen is now disabled."
        });
    }

    if (settings.store.showButton) {
        refresh_voice_state(enabled);
    }
}

function fd_icon() {
    const iconColor = enabled ? "#ed4245" : "currentColor";
    
    return (
        <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
            <rect x="6" y="8" width="20" height="4" rx="2" fill={iconColor}/>
            <rect x="11" y="3" width="10" height="8" rx="3" fill={iconColor}/>
            {enabled ? (
                <>
                    <line x1="7" y1="18" x2="13" y2="24" stroke={iconColor} strokeWidth="2"/>
                    <line x1="13" y1="18" x2="7" y2="24" stroke={iconColor} strokeWidth="2"/>
                    <line x1="19" y1="18" x2="25" y2="24" stroke={iconColor} strokeWidth="2"/>
                    <line x1="25" y1="18" x2="19" y2="24" stroke={iconColor} strokeWidth="2"/>
                    <path d="M14 23c1-1 3-1 4 0" stroke={iconColor} strokeWidth="2" strokeLinecap="round"/>
                </>
            ) : (
                <>
                    <circle cx="10" cy="21" r="4" stroke={iconColor} strokeWidth="2" fill="none"/>
                    <circle cx="22" cy="21" r="4" stroke={iconColor} strokeWidth="2" fill="none"/>
                    <path d="M14 21c1 1 3 1 4 0" stroke={iconColor} strokeWidth="2" strokeLinecap="round"/>
                </>
            )}
        </svg>
    );
}

function fd_button(props: { nameplate?: any; }) {
    const { pluginEnabled, showButton } = settings.use(["pluginEnabled", "showButton"]);

    if (!pluginEnabled || !showButton) return null;

    return (
        <Button
            tooltipText={enabled ? "Disable Fake Deafen" : "Enable Fake Deafen"}
            icon={fd_icon}
            role="switch"
            aria-checked={enabled}
            redGlow={enabled}
            plated={props?.nameplate != null}
            onClick={() => toggleFakeDeafen()}
        />
    );
}

export default definePlugin({
    name: "FakeDeafen",
    description: "Fake deafens you while keeping audio stream intact. Includes a toggleable UI bar button option.",
    authors: [{ name: "Mr_PanoZzz", id: 1230932285067366400n }],
    version: "2.1.0",
    settings,

    flux: {
        AUDIO_TOGGLE_SELF_DEAF: async function () {
            if (!settings.store.pluginEnabled) return;
            if (settings.store.showButton) return;

            await new Promise(f => setTimeout(f, 100));

            const chanId = SelectedChannelStore.getVoiceChannelId();
            if (!chanId) return;
            
            const s = VoiceStateStore.getVoiceStateForChannel(chanId) as VoiceState;
            if (!s) return;

            const event = s.deaf || s.selfDeaf ? "undeafen" : "deafen";
            if (event === "deafen") {
                toggleFakeDeafen(true);
            } else {
                toggleFakeDeafen(false);
            }
        }
    },

    start: function () {
        origWS = WebSocket.prototype.send;

        WebSocket.prototype.send = function (data) {
            if (!settings.store.pluginEnabled || !enabled) {
                return origWS.apply(this, [data]);
            }

            const dataType = Object.prototype.toString.call(data);

            switch (dataType) {
                case "[object String]":
                    let obj: any;
                    try {
                        obj = JSON.parse(data);
                    } catch {
                        origWS.apply(this, [data]);
                        return;
                    }

                    if (obj.d !== undefined && obj.d.self_deaf !== undefined && obj.d.self_deaf === false) {
                        return;
                    }
                    break;

                case "[object ArrayBuffer]":
                    const decoder = new TextDecoder("utf-8");
                    if (decoder.decode(data).includes("self_deafs\x05false")) {
                        return;
                    }
                    break;
            }

            origWS.apply(this, [data]);
        };

        logger.info("Ready");
    },

    stop: function () {
        WebSocket.prototype.send = origWS;
        enabled = false;
        logger.info("Disarmed");
    },

    patches: [
        {
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                match: /children:\[(?=.{0,25}?accountContainerRef)/,
                replace: "children:[$self.fd_button(arguments[0]),"
            }
        }
    ],

    fd_button: ErrorBoundary.wrap(fd_button, { noop: true })
});