// functions/src/users.ts
// User-admin callables: setUserRole, listUsers, deleteUser, triggerPasswordReset (+ optional bootstrapMakeMeAdmin)

import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { getAuth, assertAdmin, getRoleFromClaims, REGION } from "./_admin";

// Domänroller
export type Role = "admin" | "user" | "customer";

/** Sätt roll: admin | user */
export const setUserRole = onCall({ region: REGION }, async (req) => {
    assertAdmin(req);

    const data = req.data as { uid?: string; role?: Role };
    const uid = String(data.uid || "");
    const role = data.role;

    if (!uid || (role !== "admin" && role !== "user")) {
        throw new HttpsError("invalid-argument", "uid/role saknas eller ogiltig.");
    }

    await getAuth().setCustomUserClaims(uid, { role });
    return { ok: true as const };
});

export type PublicUser = {
    uid: string;
    email?: string;
    displayName?: string;
    disabled: boolean;
    role: Role;
    emailVerified: boolean;
    createdAt?: string;
    lastLoginAt?: string;
};

/** Lista alla användare (paginering server-side) */
export const listUsers = onCall({ region: REGION }, async (req) => {
    assertAdmin(req);

    const users: PublicUser[] = [];
    let nextPageToken: string | undefined = undefined;

    do {
        const res = await getAuth().listUsers(1000, nextPageToken);
        for (const u of res.users) {
            const role = getRoleFromClaims(u.customClaims);
            users.push({
                uid: u.uid,
                email: u.email ?? undefined,
                displayName: u.displayName ?? undefined,
                disabled: u.disabled,
                role,
                emailVerified: u.emailVerified,
                createdAt: u.metadata.creationTime ?? undefined,
                lastLoginAt: u.metadata.lastSignInTime ?? undefined,
            });
        }
        nextPageToken = res.pageToken;
    } while (nextPageToken);

    return { users };
});

/** Radera användare */
export const deleteUser = onCall({ region: REGION }, async (req) => {
    assertAdmin(req);

    const uid = String((req.data as any)?.uid || "");
    if (!uid) throw new HttpsError("invalid-argument", "uid saknas.");

    await getAuth().deleteUser(uid);
    return { ok: true as const };
});

/** Skapa återställningslänk (admin delar länken vidare) */
export const triggerPasswordReset = onCall({ region: REGION }, async (req) => {
    assertAdmin(req);

    const email = String((req.data as any)?.email || "").trim();
    if (!email) throw new HttpsError("invalid-argument", "email saknas.");

    const link = await getAuth().generatePasswordResetLink(email);
    return { resetLink: link };
});

/** (Valfri) Tillfällig bootstrap: gör inloggad whitelistrad e-post till admin */
const ALLOWED = ["patrik.junno@convit.se"].map((e) => e.toLowerCase());

export const bootstrapMakeMeAdmin = onCall({ region: REGION }, async (req: CallableRequest<unknown>) => {
    const uid = req.auth?.uid;
    const email = (req.auth?.token?.email as string | undefined)?.toLowerCase() ?? "";

    if (!uid) throw new HttpsError("unauthenticated", "Måste vara inloggad.");
    if (!ALLOWED.includes(email)) {
        throw new HttpsError("permission-denied", "Endast whitelistan får köra detta.");
    }

    await getAuth().setCustomUserClaims(uid, { role: "admin" });
    return { ok: true as const };
});
