// FILE: src/hooks/useForceLogoutOnClaimsBump.ts
// Signalera claims-ändring till UI (App.tsx) istället för att logga ut direkt.
// Ignorerar första snapshot efter sidladdning (baseline) så F5 inte triggar.

import React from "react";
import { auth } from "../firebase";
import { getFirestore, doc, onSnapshot } from "firebase/firestore";

export default function useForceLogoutOnClaimsBump(enabled: boolean) {
    const seenRef = React.useRef<{ version?: number; bumpedAt?: string } | null>(null);
    const initializedRef = React.useRef(false);
    const firedRef = React.useRef(false); // skydd mot dubbel-signal i Strict Mode

    React.useEffect(() => {
        const debug = new URLSearchParams(location.search).get("debug") === "1";

        if (!enabled) {
            if (debug) console.log("[forceLogout] not mounted (enabled=false)");
            return;
        }
        const user = auth.currentUser;
        if (!user) {
            if (debug) console.log("[forceLogout] not mounted (no user)");
            return;
        }

        const db = getFirestore();
        const ref = doc(db, "users", user.uid);
        if (debug) console.log("[forceLogout] subscribe users/%s", user.uid);

        const unsub = onSnapshot(
            ref,
            (snap) => {
                if (!snap.exists()) {
                    if (debug) console.log("[forceLogout] users doc missing");
                    return;
                }

                const d = snap.data() as any;
                const ver: number | undefined =
                    typeof d.claimsVersion === "number" ? d.claimsVersion : undefined;

                const bumpedAt: string | undefined = d.claimsBumpedAt?.toMillis
                    ? String(d.claimsBumpedAt.toMillis())
                    : (typeof d.claimsBumpedAt === "string" ? d.claimsBumpedAt : undefined);

                // Första snapshot: spara baseline, trigga inte logout.
                if (!initializedRef.current) {
                    seenRef.current = { version: ver, bumpedAt };
                    initializedRef.current = true;
                    if (debug) console.log("[forceLogout] baseline set", seenRef.current);
                    return;
                }

                const prev = seenRef.current;
                const changed =
                    (ver !== undefined && ver !== prev?.version) ||
                    (bumpedAt !== undefined && bumpedAt !== prev?.bumpedAt);

                if (debug) console.log("[forceLogout] snapshot", { ver, bumpedAt, prev, changed });

                if (changed && !firedRef.current) {
                    // Uppdatera baseline och signalera till UI att visa countdown-notisen
                    seenRef.current = { version: ver, bumpedAt };
                    firedRef.current = true;
                    if (debug) console.log("[forceLogout] claims changed → dispatch gw:claims-bumped");
                    window.dispatchEvent(new CustomEvent("gw:claims-bumped"));
                    // UI (App.tsx) ansvarar för att visa LogoutNotice + signOut(auth)
                }
            },
            (err) => {
                console.error("[forceLogout] onSnapshot error", err);
            }
        );

        return () => {
            if (debug) console.log("[forceLogout] unsubscribe users/%s", user.uid);
            unsub();
            firedRef.current = false;
        };
    }, [enabled]);
}
