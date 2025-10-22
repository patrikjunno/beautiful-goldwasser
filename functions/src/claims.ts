// functions/src/claims.ts
// setUserClaims: Admin sätter roll/status + ev. customerKeys.
// Robust: bump av claimsVersion + claimsBumpedAt för omedelbar klientreaktion.
// Riklig loggning för felsökning (Gen2 → Cloud Logging / Logs Explorer).

import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { assertAdmin, getDb, getAuth, REGION } from "./_admin";
import { FieldValue } from "firebase-admin/firestore";

type AccountRole = "admin" | "user" | "customer" | "unassigned";
type AccountStatus = "pending" | "active" | "disabled";

type SetUserClaimsRequest = {
    uid?: string;
    role?: AccountRole;
    status?: AccountStatus;
    customerKeys?: string[];
};

type SetUserClaimsResponse = {
    ok: true;
    applied: { role: AccountRole; status: AccountStatus; customerKeys: string[] };
    requiresReauth: true;
};

export const setUserClaims = onCall(
    { region: REGION },
    async (req: CallableRequest<SetUserClaimsRequest>): Promise<SetUserClaimsResponse> => {
        const t0 = Date.now();
        const callerUid = req.auth?.uid ?? null;

        try {
            // 1) Behörighetskontroll – endast admin får köra detta
            assertAdmin(req);

            const uid = String(req.data?.uid || "");
            const role = req.data?.role as AccountRole | undefined;
            const status = req.data?.status as AccountStatus | undefined;
            let customerKeys = req.data?.customerKeys;

            console.log("[setUserClaims] incoming", { callerUid, targetUid: uid, role, status, customerKeys });

            if (!uid) throw new HttpsError("invalid-argument", "uid saknas.");
            const validRoles: AccountRole[] = ["admin", "user", "customer", "unassigned"];
            const validStatus: AccountStatus[] = ["pending", "active", "disabled"];
            if (!role || !validRoles.includes(role)) {
                throw new HttpsError("invalid-argument", "Ogiltig roll.");
            }
            if (role !== "unassigned" && (!status || !validStatus.includes(status))) {
                throw new HttpsError("invalid-argument", "Ogiltig status.");
            }

            const db = getDb();
            const auth = getAuth();

            // 2) Hämta Firestore-profil för versionering/bump
            const userRef = db.doc(`users/${uid}`);
            const profileSnap = await userRef.get();
            const prevVersion =
                (profileSnap.exists && typeof profileSnap.data()?.claimsVersion === "number"
                    ? (profileSnap.data()!.claimsVersion as number)
                    : 0) || 0;
            const nextVersion = prevVersion + 1;

            // 3) Hantera kund-nycklar per roll
            if (role === "customer") {
                if (!Array.isArray(customerKeys) || customerKeys.length === 0) {
                    throw new HttpsError("invalid-argument", "customerKeys krävs för kundroll.");
                }
                // trim + dedupe
                customerKeys = Array.from(
                    new Set(
                        customerKeys
                            .map((k) => String(k).trim())
                            .filter(Boolean)
                    )
                );
                if (customerKeys.length === 0) {
                    throw new HttpsError("invalid-argument", "customerKeys kan inte vara tom efter trim.");
                }
                // Validera att varje customers/{id} finns
                for (const key of customerKeys) {
                    const snap = await db.doc(`customers/${key}`).get();
                    if (!snap.exists) {
                        throw new HttpsError("invalid-argument", `Okänd kund-id: ${key}`);
                    }
                }
            } else {
                // admin/user/unassigned har inga customerKeys
                customerKeys = [];
            }

            // 4) Skriv custom claims i Auth
            // - För "unassigned": töm claims men skriv claimsVersion för att trigga klient
            if (role === "unassigned") {
                await auth.setCustomUserClaims(uid, {
                    // tomma effektiva rättigheter
                    claimsVersion: nextVersion,
                });
                console.log("[setUserClaims] claims cleared (unassigned) + version bumped", {
                    targetUid: uid,
                    claimsVersion: nextVersion,
                });
            } else {
                const effectiveStatus = status!; // garanterad ovan
                await auth.setCustomUserClaims(uid, {
                    role,
                    status: effectiveStatus,
                    customerKeys,
                    claimsVersion: nextVersion,
                });
                console.log("[setUserClaims] claims applied (CLAIMSVERSION_READY)", {
                    targetUid: uid,
                    role,
                    status: effectiveStatus,
                    customerKeys,
                    claimsVersion: nextVersion,
                });
            }

            // 5) Spegla till users/{uid} (profilkopia + bumpfält)
            try {
                const urec = await auth.getUser(uid);
                const mirror: Record<string, unknown> = {
                    email: urec.email ?? null,
                    emailVerified: !!urec.emailVerified,
                    displayName: urec.displayName ?? null,
                    role,
                    status: role === "unassigned" ? ("pending" as AccountStatus) : (status as AccountStatus),
                    customerKeys,
                    claimsVersion: nextVersion,
                    claimsBumpedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                };
                await userRef.set(mirror, { merge: true });
                console.log("[setUserClaims] mirrored users/{uid}", {
                    targetUid: uid,
                    role: mirror.role,
                    status: mirror.status,
                    customerKeys: mirror.customerKeys,
                    claimsVersion: nextVersion,
                });
            } catch (e) {
                console.warn("[setUserClaims] users/{uid} mirror failed", {
                    targetUid: uid,
                    error: (e as Error).message ?? String(e),
                });
            }

            const dt = Date.now() - t0;
            console.log("[setUserClaims] done", { targetUid: uid, ms: dt });

            // 6) Respons till klient
            return {
                ok: true,
                applied: {
                    role,
                    status: role === "unassigned" ? ("pending" as AccountStatus) : (status as AccountStatus),
                    customerKeys: customerKeys as string[],
                },
                requiresReauth: true,
            };
        } catch (err) {
            const dt = Date.now() - t0;
            console.error("[setUserClaims] error", {
                callerUid,
                ms: dt,
                error: (err as Error).message ?? String(err),
                code: (err as any)?.code,
            });
            throw err;
        }
    }
);
