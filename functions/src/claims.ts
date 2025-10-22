// functions/src/claims.ts
// setUserClaims: admin sätter roll/status + ev. customerKeys och speglar till users/{uid}
// + riklig loggning för felsökning (Gen2 → Cloud Logging / Logs Explorer)

import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { assertAdmin, getDb, getAuth, REGION } from "./_admin";

type AccountRole = "admin" | "user" | "customer" | "unassigned";
type AccountStatus = "pending" | "active" | "disabled";

export const setUserClaims = onCall(
    { region: REGION },
    async (
        req: CallableRequest<{
            uid?: string;
            role?: AccountRole;
            status?: AccountStatus;
            customerKeys?: string[];
        }>
    ) => {
        const t0 = Date.now();
        const callerUid = req.auth?.uid ?? null;

        try {
            // 1) Endast admin
            assertAdmin(req);

            const uid = String(req.data?.uid || "");
            const role = req.data?.role as AccountRole | undefined;
            const status = req.data?.status as AccountStatus | undefined;
            let customerKeys = req.data?.customerKeys;

            console.log("[setUserClaims] incoming", {
                callerUid,
                targetUid: uid,
                role,
                status,
                customerKeys,
            });

            if (!uid) throw new HttpsError("invalid-argument", "uid saknas.");
            const validRoles: AccountRole[] = ["admin", "user", "customer", "unassigned"];
            const validStatus: AccountStatus[] = ["pending", "active", "disabled"];
            if (!role || !validRoles.includes(role)) throw new HttpsError("invalid-argument", "Ogiltig roll.");
            if (!status && role !== "unassigned") throw new HttpsError("invalid-argument", "Ogiltig status.");

            const db = getDb();
            const auth = getAuth();

            // Särfall: unassigned ⇒ rensa claims, pending, inga keys
            if (role === "unassigned") {
                await auth.setCustomUserClaims(uid, {});
                console.log("[setUserClaims] claims cleared (unassigned)", { targetUid: uid });

                const urec = await auth.getUser(uid);
                await db.doc(`users/${uid}`).set(
                    {
                        email: urec.email ?? null,
                        emailVerified: !!urec.emailVerified,
                        displayName: urec.displayName ?? null,
                        role: "unassigned",
                        status: "pending",
                        customerKeys: [],
                        updatedAt: Date.now(),
                    },
                    { merge: true }
                );
                console.log("[setUserClaims] mirrored users/{uid}", {
                    targetUid: uid,
                    role: "unassigned",
                    status: "pending",
                    customerKeys: [],
                });

                const dt = Date.now() - t0;
                console.log("[setUserClaims] done", { targetUid: uid, ms: dt });
                return {
                    ok: true as const,
                    applied: { role: "unassigned", status: "pending", customerKeys: [] },
                    requiresReauth: true,
                };
            }

            // Övriga roller
            if (role === "customer") {
                if (!Array.isArray(customerKeys) || customerKeys.length === 0) {
                    throw new HttpsError("invalid-argument", "customerKeys krävs för kundroll.");
                }
                customerKeys = customerKeys.map((k) => String(k).trim()).filter(Boolean);
                if (customerKeys.length === 0) {
                    throw new HttpsError("invalid-argument", "customerKeys kan inte vara tom efter trim.");
                }
                // Validera att customers/{id} finns
                for (const key of customerKeys) {
                    const snap = await db.doc(`customers/${key}`).get();
                    if (!snap.exists) throw new HttpsError("invalid-argument", `Okänd kund-id: ${key}`);
                }
            } else {
                customerKeys = []; // admin/user har inga keys
            }

            const effectiveStatus: AccountStatus = status!; // krävs för icke-unassigned

            // 3) Sätt custom claims i Auth
            await getAuth().setCustomUserClaims(uid, { role, status: effectiveStatus, customerKeys });
            console.log("[setUserClaims] claims applied", {
                targetUid: uid,
                role,
                status: effectiveStatus,
                customerKeys,
            });

            // 4) Spegla till users/{uid} (för Admin-UI; ej säkerhetskritiskt)
            try {
                const urec = await getAuth().getUser(uid);
                await db.doc(`users/${uid}`).set(
                    {
                        email: urec.email ?? null,
                        emailVerified: !!urec.emailVerified,
                        displayName: urec.displayName ?? null,
                        role,
                        status: effectiveStatus,
                        customerKeys,
                        updatedAt: Date.now(),
                    },
                    { merge: true }
                );
                console.log("[setUserClaims] mirrored users/{uid}", {
                    targetUid: uid,
                    role,
                    status: effectiveStatus,
                    customerKeys,
                });
            } catch (e) {
                console.warn("[setUserClaims] users/{uid} mirror failed", {
                    targetUid: uid,
                    error: (e as Error).message ?? String(e),
                });
            }

            const dt = Date.now() - t0;
            console.log("[setUserClaims] done", { targetUid: uid, ms: dt });

            // 5) Svar
            return {
                ok: true as const,
                applied: { role, status: effectiveStatus, customerKeys: customerKeys as string[] },
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
