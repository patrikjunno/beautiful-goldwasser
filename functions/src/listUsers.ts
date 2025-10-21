// functions/src/listUsers.ts
// listUsers: läs roll/status från custom claims (primärt), med tydliga fallbacks.
// + loggning så vi kan verifiera innehållet i svaret.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { assertAdmin, getAuth, getDb, REGION } from "./_admin";

type AccountRole = "admin" | "user" | "customer" | "unassigned";
type AccountStatus = "pending" | "active" | "disabled";

type ListedUser = {
    uid: string;
    email: string | null;
    emailVerified: boolean;
    displayName: string | null;
    lastSignInTime: string | null;
    creationTime: string | null;
    disabled: boolean;
    role: AccountRole;
    status: AccountStatus;
    customerKeys: string[];
};

const asStatus = (v: any): AccountStatus | undefined =>
    v === "pending" || v === "active" || v === "disabled" ? v : undefined;

const fallbackStatus = (role: AccountRole | undefined, claimStatus?: string): AccountStatus => {
    const s = asStatus(claimStatus);
    if (s) return s;
    switch (role) {
        case "admin":
        case "user":
            return "active";
        case "customer":
        case "unassigned":
        default:
            return "pending";
    }
};

export const listUsers = onCall({ region: REGION }, async (req): Promise<{ users: ListedUser[] }> => {
    // Endast admin får lista
    assertAdmin(req);

    const auth = getAuth();
    const db = getDb();

    const out: ListedUser[] = [];
    let pageToken: string | undefined = undefined;

    try {
        do {
            const resp = await auth.listUsers(1000, pageToken);
            for (const u of resp.users) {
                const cc = (u.customClaims ?? {}) as {
                    role?: AccountRole;
                    status?: string;
                    customerKeys?: unknown;
                };

                // Primärt: claims
                let role: AccountRole | undefined = cc.role as AccountRole | undefined;
                let status: AccountStatus = fallbackStatus(role, cc.status);
                let customerKeys: string[] = Array.isArray(cc.customerKeys)
                    ? (cc.customerKeys as unknown[]).map((k) => String(k)).filter(Boolean)
                    : [];

                // Sekundärt: spegel i Firestore om claims saknas
                if (!role || customerKeys.length === 0) {
                    const snap = await db.doc(`users/${u.uid}`).get();
                    if (snap.exists) {
                        const d = snap.data() as Partial<Pick<ListedUser, "role" | "status" | "customerKeys">>;
                        if (!role && d?.role) role = d.role as AccountRole;
                        if (customerKeys.length === 0 && Array.isArray(d?.customerKeys)) {
                            customerKeys = d!.customerKeys!.map(String).filter(Boolean);
                        }
                        // använd speglad status endast om claim saknas
                        if (asStatus(cc.status) === undefined && asStatus(d?.status) !== undefined) {
                            status = d!.status as AccountStatus;
                        }
                    }
                }

                if (!role) role = "unassigned";

                out.push({
                    uid: u.uid,
                    email: u.email ?? null,
                    emailVerified: !!u.emailVerified,
                    displayName: u.displayName ?? null,
                    lastSignInTime: u.metadata?.lastSignInTime ?? null,
                    creationTime: u.metadata?.creationTime ?? null,
                    disabled: !!u.disabled,
                    role,
                    status,
                    customerKeys,
                });
            }
            pageToken = resp.pageToken;
        } while (pageToken);
    } catch (err) {
        console.error("[listUsers] error", { error: (err as Error).message });
        throw new HttpsError("internal", "Kunde inte lista användare.");
    }

    // Kort logg för att bekräfta att status/role faktiskt finns med
    console.log("[listUsers] returning", out.map(u => ({ email: u.email, role: u.role, status: u.status })).slice(0, 10));

    return { users: out };
});
