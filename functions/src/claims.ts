// functions/src/claims.ts
// setUserClaims: admin sätter roll/status + ev. customerKeys och speglar till users/{uid}

import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { assertAdmin, getDb, getAuth, REGION } from "./_admin";

type AccountRole = "admin" | "user" | "customer";
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
        // 1) Endast admin
        assertAdmin(req);

        const uid = String(req.data?.uid || "");
        const role = req.data?.role as AccountRole | undefined;
        const status = req.data?.status as AccountStatus | undefined;
        let customerKeys = req.data?.customerKeys;

        // 2) Validera indata
        if (!uid) throw new HttpsError("invalid-argument", "uid saknas.");
        const validRoles: AccountRole[] = ["admin", "user", "customer"];
        const validStatus: AccountStatus[] = ["pending", "active", "disabled"];
        if (!role || !validRoles.includes(role)) throw new HttpsError("invalid-argument", "Ogiltig roll.");
        if (!status || !validStatus.includes(status)) throw new HttpsError("invalid-argument", "Ogiltig status.");

        if (role === "customer") {
            if (!Array.isArray(customerKeys) || customerKeys.length === 0) {
                throw new HttpsError("invalid-argument", "customerKeys krävs för kundroll.");
            }
            customerKeys = customerKeys.map((k) => String(k).trim()).filter(Boolean);
            if (customerKeys.length === 0) {
                throw new HttpsError("invalid-argument", "customerKeys kan inte vara tom efter trim.");
            }

            // ✅ Validera att varje key motsvarar ett customers/{id}-dokument (root-nivå)
            const db = getDb();
            for (const key of customerKeys) {
                const snap = await db.doc(`customers/${key}`).get();
                if (!snap.exists) {
                    throw new HttpsError("invalid-argument", `Okänd kund-id: ${key}`);
                }
            }
        } else {
            // Icke-kundroll → rensa ev. gamla kopplingar
            customerKeys = [];
        }

        // 3) Sätt custom claims i Auth
        await getAuth().setCustomUserClaims(uid, { role, status, customerKeys });

        // 4) Spegla till users/{uid} (för Admin-UI; ej säkerhetskritiskt)
        try {
            const db = getDb();
            await db.doc(`users/${uid}`).set(
                {
                    role,
                    status,
                    customerKeys,
                    updatedAt: Date.now(),
                },
                { merge: true }
            );
        } catch (e) {
            console.warn("users/{uid} mirror failed:", e);
        }

        // 5) Svar
        return {
            ok: true as const,
            applied: { role, status, customerKeys },
            requiresReauth: true,
        };
    }
);
