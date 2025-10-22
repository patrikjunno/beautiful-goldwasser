// functions-reports/src/_admin.ts
import * as admin from "firebase-admin";
import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";

export const REGION = "europe-west1";

export function getAdminApp(): admin.app.App {
    try {
        return admin.app();
    } catch {
        return admin.initializeApp();
    }
}

export function getDb(): admin.firestore.Firestore {
    return getAdminApp().firestore();
}

export function getAuth(): admin.auth.Auth {
    return getAdminApp().auth();
}

export type Role = "admin" | "user" | "customer";
export type Claims = { role?: Role } & Record<string, unknown>;

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

export function assertAdmin(req: CallableRequest<unknown>): void {
    if (!req.auth) {
        throw new HttpsError("unauthenticated", "Måste vara inloggad.");
    }
    const role = getRoleFromClaims(req.auth.token);
    if (role !== "admin") {
        throw new HttpsError("permission-denied", "Endast admin.");
    }
}
