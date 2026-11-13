/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import * as Webpack from "@webpack";
import { Constants, Menu, RestAPI } from "@webpack/common";

const targetUserIds: Set<string> = new Set();
let FluxDispatcher: any;
let VoiceActions: any;
let MediaEngineStore: any;
let VoiceStateStore: any;
let ChannelStore: any;
let checkInterval: any = null;
let interval = 5000;
const tryCount = 0;
const userActions: Map<string, Set<string>> = new Map();
const userGuildMap: Map<string, string> = new Map(); // userId -> guildId (cached for periodicEnforce)
const ACTIONS = [
    { id: "kick", label: "Kick" }
];

const UserContext: NavContextMenuPatchCallback = (children, props) => {
    const { user, guildId } = props;

    console.log("[onDecoLia] UserContext called! user:", user?.username, "guildId:", guildId);
    if (guildId && user) {
        const userSet = userActions.get(user.id) || new Set<string>();


        children.push(
            <Menu.MenuItem id="onDecoLia-actions" label="Actions" color="danger">
                <Menu.MenuCheckboxItem
                    id="ondecolia-action-kick"
                    label="Kick"
                    color="danger"
                    checked={userSet.has("kick")}
                    action={() => {
                        const set = userActions.get(user.id) || new Set<string>();
                        if (set.has("kick")) {
                            set.delete("kick");
                            // remove from target list
                            targetUserIds.delete(user.id);
                            userGuildMap.delete(user.id);
                        } else {
                            set.add("kick");
                            // add to target list
                            targetUserIds.add(user.id);
                            // Cache the guildId for this user for use in periodicEnforce
                            userGuildMap.set(user.id, guildId);
                            if (VoiceActions?.setChannel) {
                                setTimeout(() => {
                                    try { VoiceActions.setChannel(guildId, user.id, null); } catch (e) { console.debug("[onDecoLia] Erreur kick:", e); }
                                }, 0);
                            }
                        }
                        userActions.set(user.id, set);
                        console.debug("[onDecoLia] Actions pour", user.username, Array.from(set), "targets:", Array.from(targetUserIds));
                    }}
                />

                <Menu.MenuCheckboxItem
                    id="ondecolia-action-mute"
                    label="Mute (admin)"
                    color="danger"
                    checked={userSet.has("mute")}
                    action={() => {
                        const set = userActions.get(user.id) || new Set<string>();
                        if (set.has("mute")) {
                            set.delete("mute");
                            if (RestAPI) {
                                setTimeout(() => {
                                    // Ensure we have a valid guildId before attempting patch
                                    if (!guildId) {
                                        console.debug("[onDecoLia] Admin unmute skipped: missing guildId for user", user.id);
                                        return;
                                    }
                                    RestAPI.patch({
                                        url: `${Constants.Endpoints.GUILD_MEMBERS(guildId)}/${user.id}`,
                                        body: { mute: false }
                                    }).then(() => {
                                        console.debug("[onDecoLia] Admin unmute vocal appliqué");
                                    }).catch((e: any) => {
                                        console.debug("[onDecoLia] Erreur unmute admin:", e);
                                    });
                                }, 0);
                            }
                        } else {
                            set.add("mute");
                            if (RestAPI) {
                                setTimeout(() => {
                                    // Ensure we have a valid guildId before attempting patch
                                    if (!guildId) {
                                        console.debug("[onDecoLia] Admin mute skipped: missing guildId for user", user.id);
                                        return;
                                    }
                                    RestAPI.patch({
                                        url: `${Constants.Endpoints.GUILD_MEMBERS(guildId)}/${user.id}`,
                                        body: { mute: true }
                                    }).then(() => {
                                        console.debug("[onDecoLia] Admin mute vocal appliqué");
                                    }).catch((e: any) => {
                                        console.debug("[onDecoLia] Erreur mute admin:", e);
                                    });
                                }, 0);
                            }
                        }
                        userActions.set(user.id, set);
                        console.debug("[onDecoLia] Actions pour", user.username, Array.from(set));
                    }}
                />
            </Menu.MenuItem>
        );
    }
};

function handleVoiceUpdate(event: any) {
    // On gère l'objet simple (UPDATE) ou le premier élément du tableau (UPDATES)
    const state = event.voiceStates ? event.voiceStates[0] : event;
    if (!state) return;

    const userId = String(state.userId || state.user_id || "");

    const guildId = state.guildId || event.guildId;

    // Vérifier si on doit kicker par ID (liste de cibles)
    let shouldKick = !!(userId && targetUserIds.has(userId));

    // Vérifier si l'utilisateur a des actions définies (ex: kick)
    if (!shouldKick) {
        const set = userActions.get(userId);
        if (set && set.has("kick")) shouldKick = true;
    }

    if (shouldKick && state.channelId) {
        console.warn("[onDecoLia] 🎯 CIBLE DÉTECTÉE !");

        if (VoiceActions?.setChannel) {
            VoiceActions.setChannel(guildId, userId, null);
            console.log("[onDecoLia] Kick effectué avec succès.");
        }
    }
}


function periodicEnforce() {
    try {
        // For every user with actions, re-apply needed actions
        for (const [userId, set] of userActions.entries()) {
            // Re-apply kick: if user is in a voice channel, move them out
            if (set.has("kick")) {
                const vs = VoiceStateStore.getVoiceStateForUser(userId);
                const channelId = vs?.channelId;
                console.log("[onDecoLia] Vérification périodique pour", userId, "dans channel:", channelId);
                if (channelId) {
                    try {
                        VoiceActions.setChannel(userGuildMap.get(userId), userId, null); // Kick: réappliquer déplacement hors du canal vocal
                    } catch (e) {
                        console.debug("[onDecoLia] periodicEnforce kick error:", e);
                    }
                    interval = 1000; // Si on doit kicker, on vérifie plus fréquemment
                }
                else {
                    interval = 5000;
                }
            }
        }
    } catch (e) {
        console.debug("[onDecoLia] periodicEnforce error:", e);
    }
}

export default definePlugin({
    name: "onDecoLia",
    description: "Anti-Lia Vocal",
    authors: [{ name: "KANT1", id: 541691494872907789n }],

    contextMenus: {
        "user-context": UserContext
    },

    start() {
        console.log("[onDecoLia] ✅ Plugin started!");

        // Récupération des modules Discord
        FluxDispatcher = Webpack.findByProps("dispatch", "subscribe");
        VoiceActions = Webpack.findByProps("setChannel");
        VoiceStateStore = Webpack.findByProps("getVoiceStateForUser");
        ChannelStore = Webpack.findByProps("getChannel");

        console.log("[onDecoLia] Modules found:", { FluxDispatcher: !!FluxDispatcher, VoiceActions: !!VoiceActions, VoiceStateStore: !!VoiceStateStore, ChannelStore: !!ChannelStore });

        // Abonnement aux événements de changement d'état vocal
        FluxDispatcher?.subscribe("VOICE_STATE_UPDATE", handleVoiceUpdate);
        FluxDispatcher?.subscribe("VOICE_STATE_UPDATES", handleVoiceUpdate);

        // Abonnement aux mises à jour de membres (pour remmute si enlevé)
        // FluxDispatcher?.subscribe("GUILD_MEMBER_UPDATE", handleGuildMemberUpdate);

        // Start periodic enforcement (twice per second)
        if (!checkInterval) checkInterval = setInterval(periodicEnforce, interval);
    },

    stop() {
        // Nettoyage propre lors de la désactivation
        FluxDispatcher?.unsubscribe("VOICE_STATE_UPDATE", handleVoiceUpdate);
        FluxDispatcher?.unsubscribe("VOICE_STATE_UPDATES", handleVoiceUpdate);
        if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
        }
        // FluxDispatcher?.unsubscribe("GUILD_MEMBER_UPDATE", handleGuildMemberUpdate);
        console.log("[onDecoLia] 🛑 Plugin stopped.");
    }
});
