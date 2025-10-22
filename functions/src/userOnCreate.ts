// functions/src/userOnCreate.ts
import { region, auth as v1auth } from "firebase-functions/v1";
import type { UserRecord } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { REGION, getDb } from "./_admin";

/**
 * Skapar/synkar users/{uid} när ett nytt Auth-konto skapas.
 * Samma dokument som Admin UI senare uppdaterar via setUserClaims.
 */
export const userProfileOnCreate = region(REGION)
    .auth
    .user()
    .onCreate(async (user: UserRecord) => {
        const { uid, email, displayName, emailVerified } = user;

        const db = getDb();
        const ref = db.collection("users").doc(uid);

        // Idempotent (merge) så att senare admin-skrivningar inte störs
        await ref.set(
            {
                email: email ?? null,
                displayName: displayName ?? null,
                emailVerified: !!emailVerified,
                role: "unassigned",
                status: "pending",
                customerKeys: [],
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
    });
