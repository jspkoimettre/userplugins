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
    // Find the "block user" button and insert Actions right after it
    // let insertIndex = -1;
    // for (let i = 0; i < children.length; i++) {
    //     const child = children[i];
    //     if (child?.props?.id === "block-user" || child?.props?.label?.toLowerCase?.()?.includes?.("block") || child?.props?.label?.toLowerCase?.()?.includes?.("bloquer")) {
    //         insertIndex = i + 1;
    //         console.log("[onDecoLia] Inserting Actions menu at index:", insertIndex);
    //         break;
    //     }
    // }
    // // If block button not found, use position before last item (default behavior)
    // if (insertIndex === -1) insertIndex = children.length - 1;
    // Si c'est dans un salon vocal (guildId existe)
    if (guildId) {
        const userSet = userActions.get(user.id) || new Set<string>();


        children.splice(-2, 0, (
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
        ));
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

// function handleGuildMemberUpdate(event: any) {
//     const { user, guild_id, mute } = event;
//     if (!user || !guild_id) return;

//     const userId = String(user.id || "");
//     const set = userActions.get(userId);

//     // Si l'utilisateur a le "mute" activé et que son état serveur n'est pas muté, le remmute
//     if (set && set.has("mute") && !mute) {
//         console.debug("[onDecoLia] Mute enlevé, remmute...");
//         if (RestAPI) {
//             setTimeout(() => {
//                 try {
//                     RestAPI.patch({
//                         url: `${Constants.Endpoints.GUILD_MEMBERS(guild_id)}/${userId}`,
//                         body: { mute: true }
//                     });
//                     console.debug("[onDecoLia] Remute appliqué");
//                 } catch (e) {
//                     console.debug("[onDecoLia] Erreur remute:", e);
//                 }
//             }, 0);
//         }
//     }
// }

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

            // Re-apply admin mute: if set and member not muted, patch
            // if (set.has("mute") && RestAPI) {
            //     // Check voice state mute flag
            //     const vs = VoiceStateStore?.getVoiceStateForUser ? VoiceStateStore.getVoiceStateForUser(userId) : null;
            //     const isMuted = !!(vs?.mute);
            //     if (!isMuted) {
            //         // need guild id to patch member
            //         const channelId = vs?.channelId;
            //         const channel = ChannelStore?.getChannel ? ChannelStore.getChannel(channelId) : null;
            //         // Try multiple possible guild id fields
            //         const guildId = channel?.guild_id ?? channel?.guildId ?? channel?.guild?.id ?? vs?.guildId ?? vs?.guild_id ?? null;
            //         if (!guildId) {
            //             console.debug("[onDecoLia] periodicEnforce: missing guildId for user", userId);
            //         } else {
            //             RestAPI.patch({
            //                 url: `${Constants.Endpoints.GUILD_MEMBERS(guildId)}/${userId}`,
            //                 body: { mute: true }
            //             }).then(() => {
            //                 // success
            //             }).catch((e: any) => {
            //                 console.debug("[onDecoLia] periodicEnforce remute error:", e);
            //             });
            //         }
            //     }
            // }
        }
    } catch (e) {
        console.debug("[onDecoLia] periodicEnforce error:", e);
    }
}

export default definePlugin({
    name: "onDecoLia",
    description: "Anti-Lia Vocal",
    authors: [{ name: "KANT1", id: 541691494872907789n }],

    patches: [
        {
            find: "UserContextMenu",
            replacement: {
                match: /function (\w+)\((\w+)\){/,
                replace: "function $1($2){$self.UserContext($2.children,$2.props);"
            }
        }
    ],

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
        // FluxDispatcher?.unsubscribe("GUILD_MEMBER_UPDATE", handleGuildMemberUpdate);
        console.log("[onDecoLia] 🛑 Plugin stopped.");
    }
});
