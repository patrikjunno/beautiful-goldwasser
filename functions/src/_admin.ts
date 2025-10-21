// functions/src/_admin.ts
import * as admin from "firebase-admin";
import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";

export const REGION = "europe-west1";

/** Lazy/safe access till Admin SDK app. */
export function getAdminApp(): admin.app.App {
    try {
        return admin.app();
    } catch {
        return admin.initializeApp();
    }
}

/** Firestore (lazy). */
export function getDb(): admin.firestore.Firestore {
    return getAdminApp().firestore();
}

/** Auth (lazy). */
export function getAuth(): admin.auth.Auth {
    return getAdminApp().auth();
}

/** Roller i systemet. */
export type Role = "admin" | "user" | "customer";

export type Claims = {
    role?: Role;
} & Record<string, unknown>;

/** Härled roll från custom claims (bakåtkompatibel). */
export function getRoleFromClaims(claims: unknown): Role {
    const c = claims as Claims | undefined;
    const isAdmin =
        c?.role === "admin" ||
        (c as any)?.admin === true ||
        ((c as any)?.roles && (c as any).roles.admin === true);

    if (isAdmin) return "admin";
    if (c?.role === "customer") return "customer";
    return "user";
}

/** Säkerställ att anropare är inloggad admin. */
export function assertAdmin(req: CallableRequest<unknown>): void {
    if (!req.auth) {
        throw new HttpsError("unauthenticated", "Måste vara inloggad.");
    }
    const role = getRoleFromClaims(req.auth.token);
    if (role !== "admin") {
        throw new HttpsError("permission-denied", "Endast admin.");
    }
}
