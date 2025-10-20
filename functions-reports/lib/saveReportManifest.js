"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveReportManifest = void 0;
// functions/src/saveReportManifest.ts
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
if (!admin.apps.length)
    admin.initializeApp();
// --- Hjälpare: stabil serverside-hash av urvalet (sortera ALLT) ---
function canonicalSelectionKey(input) {
    const sort = (arr) => [...(arr ?? [])].map(String).sort();
    const keyObj = {
        orgId: String(input.orgId || ""),
        from: String(input.periodFrom || ""),
        to: String(input.periodTo || ""),
        customers: sort(input.customerIds),
        productTypes: sort(input.productTypeIds),
        items: sort(input.itemIds),
        factorPolicy: input.factorPolicy ?? "latest",
        schema: input.calculationSchemaVersion ?? 0,
    };
    return JSON.stringify(keyObj);
}
function sha256Hex(s) {
    return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}
exports.saveReportManifest = (0, https_1.onCall)({
    region: "europe-west1",
    cors: true,
    enforceAppCheck: false, // prod: på. Dev: använd debug token.
    timeoutSeconds: 20,
    memory: "256MiB",
}, async (req) => {
    // === 1) Auth krävs ===
    const uid = req.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Login required");
    // === 2) Läs & validera input ===
    const data = req.data;
    if (!data || typeof data !== "object") {
        throw new https_1.HttpsError("invalid-argument", "Invalid payload");
    }
    const { policy, selectionHash: clientSelectionHash, selection, manifest } = data;
    if (!policy || manifest == null) {
        throw new https_1.HttpsError("invalid-argument", "Missing fields: policy, manifest");
    }
    const manifestJsonRaw = JSON.stringify(manifest);
    if (manifestJsonRaw.length > 2000000) {
        throw new https_1.HttpsError("invalid-argument", "Manifest too large (>2MB)");
    }
    // === 3) orgId (v1: global “org”) ===
    const orgId = "org";
    // === 4) Plocka urval ur manifest (fallback: selection från input) ===
    const m = manifest ?? {};
    const filters = m?.filtersUsed ?? {};
    const periodFrom = String(filters?.period?.from ?? "");
    const periodTo = String(filters?.period?.to ?? "");
    const selectionNode = (m?.selection ?? selection ?? {});
    const customerIds = Array.isArray(selectionNode?.customerIds) ? selectionNode.customerIds : [];
    const productTypeIds = Array.isArray(selectionNode?.productTypeIds) ? selectionNode.productTypeIds : [];
    const itemIds = Array.isArray(selectionNode?.ids) ? selectionNode.ids : [];
    const factorPolicy = m?.factorPolicy ?? null;
    const calculationSchemaVersion = m?.calculationSchemaVersion ?? null;
    // === 5) Beräkna serverside selectionHash (ignorerar klientens hash för lagring) ===
    const selectionKey = canonicalSelectionKey({
        orgId,
        periodFrom,
        periodTo,
        customerIds,
        productTypeIds,
        itemIds,
        factorPolicy,
        calculationSchemaVersion,
    });
    const selectionHash = sha256Hex(selectionKey);
    // === 6) Manifest-ID (behåll samma formel men använd serverside-hash) ===
    const basis = `${orgId}|${policy}|${selectionHash}`;
    const manifestId = sha256Hex(basis);
    // === 7) Förbered paths: skriv både "versions" (append) och "latest" (overwrite) ===
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = now.getFullYear();
    const mm = pad(now.getMonth() + 1);
    const dd = pad(now.getDate());
    const hh = pad(now.getHours());
    const mi = pad(now.getMinutes());
    const ss = pad(now.getSeconds());
    const ms = String(now.getMilliseconds()).padStart(3, "0");
    const stamp = `${yyyy}${mm}${dd}-${hh}${mi}${ss}${ms}`;
    const base = `orgs/${orgId}/reports/${selectionHash}`;
    const latestPath = `${base}/latest.json`;
    const versionPath = `${base}/versions/${yyyy}/${mm}/${dd}/${stamp}.json`;
    // === 8) Skriv till Cloud Storage (Admin SDK) ===
    //  - Innehåll: samma manifest som input, men med serverside-hash injicerad
    const body = JSON.stringify({
        ...m,
        selection: {
            ...(m?.selection ?? {}),
            hash: selectionHash, // <-- serverns hash (stabil)
        },
        // Lämna övrig struktur orörd
    }, null, 2);
    const bucket = admin.storage().bucket(); // default bucket
    const commonOpts = {
        contentType: "application/json; charset=utf-8",
        resumable: false,
        metadata: {
            metadata: {
                orgId,
                policy,
                selectionHash, // serverside hash
                selectionHashClient: String(clientSelectionHash || ""), // för felsökning
                createdBy: uid,
            },
            cacheControl: "no-store",
        },
    };
    // 8a) Skriv versionsfil (append)
    await bucket.file(versionPath).save(body, commonOpts);
    // 8b) Skriv latest (overwrite/idempotent)
    await bucket.file(latestPath).save(body, commonOpts);
    // === 9) Skriv metadata till Firestore (behåll collection/format; uppdatera path) ===
    const db = admin.firestore();
    const nowTs = admin.firestore.FieldValue.serverTimestamp();
    await db
        .collection("orgs")
        .doc(orgId)
        .collection("report_manifests")
        .doc(manifestId)
        .set({
        orgId,
        manifestId,
        policy,
        selectionHash, // serverside
        selectionHashClient: String(clientSelectionHash || null),
        storagePath: latestPath, // behåll legacy-fältet: peka på latest
        storageVersionPath: versionPath, // ny pekare till versionen
        createdAt: nowTs,
        createdBy: uid,
        selection: selection ?? null,
        schema_version: 1,
        // valfritt i framtiden: totals för snabb listning
    }, { merge: true });
    // === 10) Svar ===
    return {
        ok: true,
        manifestId,
        selectionHash, // serverside
        paths: { latestPath, versionPath },
        storagePath: latestPath, // kompatibelt fält
    };
});
