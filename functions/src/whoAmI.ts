// functions/src/whoAmI.ts
// Diagnostik: returnerar uid, email och token-claims för inloggad användare.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { REGION } from "./_admin";

export const whoAmI = onCall({ region: REGION }, (req) => {
    if (!req.auth) {
        throw new HttpsError("unauthenticated", "Ingen ID-token mottagen.");
    }
    return {
        uid: req.auth.uid,
        email: (req.auth.token.email as string | undefined) ?? null,
        claims: req.auth.token,
    };
});
