// functions/src/reports/buildCO2Preview.ts
import { onRequest } from "firebase-functions/v2/https";
import { REGION, getDb, getAuth } from "../_admin";
import { FieldPath, Query } from "firebase-admin/firestore";

/* ========= Typer ========= */
type Factor = {
    label: string;
    medianWeightKg: number;
    co2PerUnitKg: number;
    schemaVersion: number;
};

type BuildPreviewRequest = {
    fromDate: string;          // "YYYY-MM-DD" eller ISO
    toDate: string;            // "YYYY-MM-DD" eller ISO
    basis?: "completedAt";     // nuvarande stöd
    customerIds: string[];     // kund-ID:n som ska ingå
    productTypeIds?: string[]; // valfritt filter
    factorPolicy?: "latest";   // reserverat för framtiden
};

type Row = {
    productTypeId: string;
    productType: string;
    A: number; B: number; C: number; D: number; E: number;
    total: number;
    eWasteKg: number;
    recycledKg: number;
    co2Kg: number;
};

type CustomerBucket = {
    customerId: string;
    customerName: string;
    rows: Row[];
    totals: Omit<Row, "productTypeId" | "productType"> & { total: number };
};

type BuildPreviewResponse = {
    filters: BuildPreviewRequest;
    customersIncluded: Record<string, string>;
    factorsUsed: Record<string, Factor>;
    perCustomer: CustomerBucket[];
    grandTotals: Omit<Row, "productTypeId" | "productType"> & { total: number };
    selection: { itemIds: string[] };
};

/* ========= Hjälpare ========= */
function ymdToDate(s: string): Date {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    const [y, m, day] = s.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, day ?? 1);
}
function endOfDay(d: Date): Date {
    const z = new Date(d);
    z.setHours(23, 59, 59, 999);
    return z;
}
function chunk<T>(arr: T[], size = 10): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

/* ========= Handler ========= */
export async function buildCO2PreviewHandler(req: any, res: any): Promise<void> {
    // Starttid för logg
    const t0 = Date.now();

    try {
        // ---- CORS ----
        const origin = String(req.headers.origin || "");
        const allowedOrigins = new Set([
            "http://localhost:3000",
            // "https://app.dindomän.se",
        ]);

        if (allowedOrigins.has(origin)) {
            res.set("Access-Control-Allow-Origin", origin);
            res.set("Vary", "Origin");
        } else {
            res.set("Access-Control-Allow-Origin", "*");
        }
        res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

        const reqHeaders = req.headers["access-control-request-headers"];
        if (reqHeaders) res.set("Access-Control-Allow-Headers", String(reqHeaders));
        else res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

        res.set("Access-Control-Max-Age", "86400");

        // Preflight
        if (req.method === "OPTIONS") {
            res.status(204).send();
            return;
        }
        if (req.method !== "POST") {
            res.status(405).json({ error: "Use POST" });
            return;
        }

        const db = getDb();

        // === Input ===
        const body = (req.body || {}) as BuildPreviewRequest;
        const {
            fromDate,
            toDate,
            basis = "completedAt",
            customerIds,
            productTypeIds,
            factorPolicy = "latest",
        } = body;

        if (!fromDate || !toDate) {
            res.status(400).json({ error: "fromDate and toDate are required" });
            return;
        }
        if (!Array.isArray(customerIds) || customerIds.length === 0) {
            res.status(400).json({ error: "customerIds[] is required" });
            return;
        }
        if (basis !== "completedAt") {
            res.status(400).json({ error: "Only basis=completedAt supported in this version" });
            return;
        }

        // === Token / behörighet (loggning + filtrering) ===
        const authHeader = String(req.headers.authorization || req.headers.Authorization || "");
        const hasBearer = /^Bearer\s+/i.test(authHeader);
        let uid: string | null = null;
        let role: string | null = null;
        let tokenCustomerKeys: string[] = [];

        if (hasBearer) {
            try {
                const token = await getAuth().verifyIdToken(authHeader.replace(/^Bearer\s+/i, "").trim());
                uid = token.uid;
                // Vi stödjer både "role" och "admin" flags i claims
                role =
                    (token as any).role ??
                    ((token as any).admin === true ? "admin" : null) ??
                    ((token as any).roles?.admin === true ? "admin" : null);
                tokenCustomerKeys = Array.isArray((token as any).customerKeys)
                    ? ((token as any).customerKeys as unknown[]).map(String)
                    : [];
            } catch (e) {
                console.warn("[buildCO2Preview] token verify failed:", (e as Error).message);
            }
        } else {
            console.warn("[buildCO2Preview] no Authorization header");
        }

        // Logga inkommande filter
        console.log("[buildCO2Preview] incoming", {
            hasBearer,
            uid,
            role,
            tokenCustomerKeysLen: tokenCustomerKeys.length,
            incomingCustomerIdsLen: customerIds.length,
            sampleCustomerIds: customerIds.slice(0, 3),
            fromDate,
            toDate,
            basis,
            factorPolicy,
            productTypeIdsLen: Array.isArray(productTypeIds) ? productTypeIds.length : 0,
        });

        // Effektiva kund-ID:n (admin = alla begärda; annars snitt mot token.customerKeys)
        let effectiveCustomerIds = customerIds.map(String);
        const isAdmin = role === "admin";
        if (!isAdmin && tokenCustomerKeys.length > 0) {
            const allow = new Set(tokenCustomerKeys);
            effectiveCustomerIds = effectiveCustomerIds.filter((id) => allow.has(id));
            if (effectiveCustomerIds.length === 0) {
                res.status(403).json({ error: "No access to requested customerIds" });
                return;
            }
        }

        console.log("[buildCO2Preview] effective", {
            effectiveCustomerIdsLen: effectiveCustomerIds.length,
            sample: effectiveCustomerIds.slice(0, 3),
            admin: isAdmin,
        });

        // (1) FAKTORER (productTypes) — frys i svaret
        const ptSnap = await db.collection("productTypes").get();
        const factorsUsed: Record<string, Factor> = {};
        ptSnap.forEach((doc) => {
            const d = doc.data() || {};
            const id = doc.id;
            factorsUsed[id] = {
                label: String(d.label ?? id),
                medianWeightKg: Number(d.medianWeightKg ?? 0),
                co2PerUnitKg: Number(d.co2PerUnitKg ?? (d as any).co2 ?? 0),
                schemaVersion: Number(d.schemaVersion ?? 1),
            };
        });

        // (2) KUNDNAMN (om customers-collection finns)
        const customersIncluded: Record<string, string> = {};
        for (const ch of chunk(effectiveCustomerIds, 10)) {
            const qs = await db
                .collection("customers")
                .where(FieldPath.documentId(), "in", ch as any)
                .get()
                .catch(() => null);
            if (qs) {
                qs.forEach((doc) => {
                    const d = doc.data() || {};
                    customersIncluded[doc.id] = String((d as any).name ?? (d as any).label ?? doc.id);
                });
            } else {
                ch.forEach((id) => {
                    if (!customersIncluded[id]) customersIncluded[id] = id;
                });
            }
        }
        effectiveCustomerIds.forEach((id) => {
            if (!customersIncluded[id]) customersIncluded[id] = id;
        });

        // (3) INVENTORY inom period & kund(er)
        const from = ymdToDate(fromDate);
        const to = endOfDay(ymdToDate(toDate));

        const typeAllow: Set<string> | null =
            Array.isArray(productTypeIds) && productTypeIds.length
                ? new Set(productTypeIds.map(String))
                : null;

        const itemIds: string[] = [];
        type AggKey = `${string}|${string}`; // customerId|productTypeId
        const buckets = new Map<AggKey, { A: number; B: number; C: number; D: number; E: number }>();

        for (const group of chunk(effectiveCustomerIds, 10)) {
            let q: Query = db
                .collection("itInventory")
                .where("completed", "==", true)
                .where("completedAt", ">=", from)
                .where("completedAt", "<=", to)
                .where("customerId", "in", group as any);

            const snap = await q.get();
            snap.forEach((doc) => {
                const d = doc.data() || {};
                const custId = String((d as any).customerId ?? (d as any).customer ?? "").trim();
                const typeId = String((d as any).productTypeId ?? (d as any).productType ?? "").trim();
                if (!custId || !typeId) return;

                if (typeAllow && !typeAllow.has(typeId)) return;

                const grade = String((d as any).grade ?? "").toUpperCase() as "A" | "B" | "C" | "D" | "E";
                const key = `${custId}|${typeId}` as AggKey;

                if (!buckets.has(key)) buckets.set(key, { A: 0, B: 0, C: 0, D: 0, E: 0 });
                const row = buckets.get(key)!;
                if (["A", "B", "C", "D", "E"].includes(grade)) (row as any)[grade] += 1;

                itemIds.push(doc.id);
            });
        }

        // (4) perCustomer-rows med massor/CO2 från frysta faktorer
        const perCustomerMap = new Map<string, Row[]>();
        for (const [key, counts] of buckets.entries()) {
            const [customerId, productTypeId] = key.split("|");
            const f =
                factorsUsed[productTypeId] ??
                Object.values(factorsUsed).find((x) => x.label.toLowerCase() === productTypeId.toLowerCase());

            const label = f?.label ?? productTypeId;
            const medianWeight = Number(f?.medianWeightKg ?? 0);
            const co2PerUnit = Number(f?.co2PerUnitKg ?? 0);
            const refurbished = (counts.A || 0) + (counts.B || 0) + (counts.C || 0) + (counts.D || 0);
            const total = refurbished + (counts.E || 0);

            const row: Row = {
                productTypeId,
                productType: label,
                A: counts.A, B: counts.B, C: counts.C, D: counts.D, E: counts.E,
                total,
                eWasteKg: Math.round(refurbished * medianWeight),
                recycledKg: Math.round((counts.E || 0) * medianWeight),
                co2Kg: Math.round(refurbished * co2PerUnit),
            };

            if (!perCustomerMap.has(customerId)) perCustomerMap.set(customerId, []);
            perCustomerMap.get(customerId)!.push(row);
        }

        // (5) Summera per kund + grand totals
        const perCustomer: CustomerBucket[] = [];
        const grand = { A: 0, B: 0, C: 0, D: 0, E: 0, eWasteKg: 0, recycledKg: 0, co2Kg: 0, total: 0 };

        for (const custId of effectiveCustomerIds) {
            const rows = perCustomerMap.get(custId) ?? [];
            const totals = rows.reduce(
                (acc, r) => ({
                    A: acc.A + r.A,
                    B: acc.B + r.B,
                    C: acc.C + r.C,
                    D: acc.D + r.D,
                    E: acc.E + r.E,
                    eWasteKg: acc.eWasteKg + r.eWasteKg,
                    recycledKg: acc.recycledKg + r.recycledKg,
                    co2Kg: acc.co2Kg + r.co2Kg,
                    total: acc.total + r.total,
                }),
                { A: 0, B: 0, C: 0, D: 0, E: 0, eWasteKg: 0, recycledKg: 0, co2Kg: 0, total: 0 }
            );

            (Object.keys(grand) as (keyof typeof grand)[]).forEach((k) => {
                (grand as any)[k] += (totals as any)[k] ?? 0;
            });

            perCustomer.push({
                customerId: custId,
                customerName: customersIncluded[custId] ?? custId,
                rows,
                totals,
            });
        }

        // Kort sammanfattningslogg
        console.log("[buildCO2Preview] selection", {
            itemIdsCount: itemIds.length,
            buckets: buckets.size,
            perCustomer: perCustomer.length,
        });

        const response: BuildPreviewResponse = {
            // returnera de "effektiva" (ev. filtrerade) id:na i filters
            filters: { fromDate, toDate, basis, customerIds: effectiveCustomerIds, productTypeIds, factorPolicy },
            customersIncluded,
            factorsUsed,
            perCustomer,
            grandTotals: grand,
            selection: { itemIds },
        };

        const ms = Date.now() - t0;
        console.log("[buildCO2Preview] done", {
            uid,
            role,
            ms,
            effectiveCustomerIdsLen: effectiveCustomerIds.length,
            items: itemIds.length,
        });

        res.status(200).json(response);
    } catch (err: any) {
        console.error("[buildCO2Preview] error:", err?.message ?? String(err));
        res.status(500).json({ error: err?.message ?? "Internal error" });
    }
}

/* ========= Cloud Function export ========= */
export const buildCO2Preview = onRequest({ region: REGION }, buildCO2PreviewHandler);
