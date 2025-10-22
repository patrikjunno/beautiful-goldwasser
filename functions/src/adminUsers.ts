// functions/src/adminUsers.ts
import { onCall } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";
import { REGION, getDb, getAuth } from "./_admin";

/** === Typer === */
type DeleteUserAccountRequest = { uid: string };
type DeleteUserAccountResponse = {
    ok: true;
    deleted: { auth: boolean; userDoc: boolean };
    auditId?: string;
};

export const deleteUserAccount = onCall(
    { region: REGION },
    async (request) => {
        const caller = request.auth;
        const data = request.data as DeleteUserAccountRequest;

        // === Säkerhet: kräver inloggad admin ===
        if (!caller) {
            throw new HttpsError("unauthenticated", "Måste vara inloggad.");
        }
        const role = (caller.token as any)?.role;
        if (role !== "admin") {
            throw new HttpsError("permission-denied", "Endast admin får radera användare.");
        }

        const targetUid = data?.uid?.trim();
        if (!targetUid) {
            throw new HttpsError("invalid-argument", "Saknar uid att radera.");
        }

        const db = getDb();
        const auth = getAuth();

        // === Kör radering (best-effort båda håll) ===
        let authDeleted = false;
        let userDocDeleted = false;
        let auditId: string | undefined;

        // Skriv audit-logg först (intent)
        try {
            const auditRef = await db.collection("adminLogs").add({
                kind: "deleteUserAccount",
                actorUid: caller.uid,
                targetUid,
                at: new Date(),
                stage: "start",
            });
            auditId = auditRef.id;
        } catch {
            // audit är "nice to have"
        }

        // Radera Auth-konto
        try {
            await auth.deleteUser(targetUid);
            authDeleted = true;
        } catch (e: any) {
            if (e?.code !== "auth/user-not-found") {
                if (auditId) {
                    await db.doc(`adminLogs/${auditId}`).set(
                        { stage: "auth-delete-error", authError: String(e?.message || e) },
                        { merge: true }
                    );
                }
            }
        }

        // Radera Firestore-profilen
        try {
            await db.doc(`users/${targetUid}`).delete();
            userDocDeleted = true;
        } catch (e: any) {
            if (auditId) {
                await db.doc(`adminLogs/${auditId}`).set(
                    { stage: "userdoc-delete-error", userDocError: String(e?.message || e) },
                    { merge: true }
                );
            }
        }

        if (auditId) {
            await db.doc(`adminLogs/${auditId}`).set(
                { stage: "done", result: { authDeleted, userDocDeleted }, atDone: new Date() },
                { merge: true }
            );
        }

        // Om inget blev raderat – kasta fel för UI
        if (!authDeleted && !userDocDeleted) {
            throw new HttpsError(
                "failed-precondition",
                "Misslyckades radera användare i både Auth och Firestore."
            );
        }

        const res: DeleteUserAccountResponse = {
            ok: true,
            deleted: { auth: authDeleted, userDoc: userDocDeleted },
            auditId,
        };
        return res;
    }
);
