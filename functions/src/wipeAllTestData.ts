import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

function getDb() {
    try {
        return admin.app().firestore();
    } catch {
        const app = admin.initializeApp();
        return app.firestore();
    }
}

// Platt batch-delete (snabbt och billigt)
async function deleteQueryInBatches(colName: string, batchSize = 250) {
    const db = getDb();
    while (true) {
        const snap = await db.collection(colName).orderBy("__name__").limit(batchSize).get();
        if (snap.empty) break;
        const batch = db.batch();
        for (const d of snap.docs) batch.delete(d.ref);
        await batch.commit();
    }
}

// Endast för kollektioner som kan ha subkollektioner (för att undvika “orphans”)
async function recursiveDeleteCollection(colName: string) {
    const db = getDb();
    // Admin SDK stödjer recursiveDelete på collection refs
    await db.recursiveDelete(db.collection(colName));
}

// Ping för diagnos (frivillig info)
async function tryPingFirestore() {
    const db = getDb();
    const cols = await db.listCollections();
    return cols.map((c) => c.id).sort();
}

export const wipeAllTestData = onCall(
    { region: "europe-west1", cors: true, maxInstances: 1, enforceAppCheck: false },
    async (req) => {
        if (!req.auth?.uid) throw new HttpsError("unauthenticated", "No auth");

        const info: Record<string, any> = {};
        try {
            info.startedAt = new Date().toISOString();

            // 1) Diagnos: vilka topp-kollektioner finns just nu?
            info.collections = await tryPingFirestore();

            // 2) dryRun-stöd (default = true)
            const dryRun = (req.data?.dryRun ?? true) !== false;
            info.dryRun = dryRun;

            // 3) Rensningsordning: källor först → index/derivat sist
            //    (lägg gärna till fler här senare om behov)
            const flat: string[] = [
                "itInventory",
                "models",
                "articles",
                "customers",
                "Manufacturers", // case-känsligt
            ];
            const recursive: string[] = [
                "reports", // har/kan ha subkollektioner (t.ex. root/fakturor)
            ];
            const derivedLast: string[] = [
                "serialIndex",
            ];

            if (dryRun) {
                info.willClear = { flat, recursive, derivedLast };
            } else {
                // Platta först
                for (const col of flat) {
                    await deleteQueryInBatches(col);
                }
                // Djup-rensa de kollektioner som kan ha subkollektioner
                for (const col of recursive) {
                    await recursiveDeleteCollection(col);
                }
                // Till sist derivat/index
                for (const col of derivedLast) {
                    await deleteQueryInBatches(col);
                }
            }

            info.finishedAt = new Date().toISOString();
            return { ok: true as const, info };
        } catch (err: any) {
            // returnera fel i payload (för enkel felsökning i klient)
            return {
                ok: false as const,
                error: {
                    message: err?.message ?? String(err),
                    code: err?.code ?? null,
                    stack: err?.stack?.split("\n").slice(0, 5).join("\n") ?? null,
                },
                info,
            };
        }
    }
);
