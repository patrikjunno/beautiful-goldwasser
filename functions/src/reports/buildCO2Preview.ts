// functions/src/reports/buildCO2Preview.ts
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import type { Query } from "firebase-admin/firestore";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type Factor = {
    label: string;
    medianWeightKg: number;
    co2PerUnitKg: number;
    schemaVersion: number;
};

type BuildPreviewRequest = {
    fromDate: string;          // "YYYY-MM-DD" eller ISO
    toDate: string;            // "YYYY-MM-DD" eller ISO
    basis?: "completedAt";     // vi stödjer completedAt nu (kan byggas ut)
    customerIds: string[];     // kund-ID:n/keys som ska ingå
    productTypeIds?: string[]; // valfritt filter
    factorPolicy?: "latest";   // lämnar öppen för framtida policies
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

function ymdToDate(s: string): Date {
    // Tillåt "YYYY-MM-DD" och ISO, normaliserar till 00:00:00 och 23:59:59
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

export async function buildCO2PreviewHandler(req: any, res: any): Promise<void> {
    try {
        // ---- CORS: sätt headrar först, för ALLA svar ----
        const origin = String(req.headers.origin || "");
        const allowedOrigins = new Set([
            "http://localhost:3000",
            // lägg till din proddomän här, t.ex:
            // "https://app.dindomän.se",
        ]);

        // Tillåt specifika origins (rekommenderat). För snabbtest: använd "*" (utan credentials).
        if (allowedOrigins.has(origin)) {
            res.set("Access-Control-Allow-Origin", origin);
            res.set("Vary", "Origin");
        } else {
            // fallback, funkar när du kör utan credentials i fetch (du gör credentials: "omit")
            res.set("Access-Control-Allow-Origin", "*");
        }

        res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

        // Echo tillbaka de headers browsern begär i preflight
        const reqHeaders = req.headers["access-control-request-headers"];
        if (reqHeaders) {
            res.set("Access-Control-Allow-Headers", String(reqHeaders));
        } else {
            res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
        }

        res.set("Access-Control-Max-Age", "86400"); // cachea preflight

        // ---- Preflight ----
        if (req.method === "OPTIONS") {
            res.status(204).send();
            return;
        }

        if (req.method !== "POST") {
            res.status(405).json({ error: "Use POST" });
            return;
        }

        if (req.method !== "POST") {
            res.status(405).json({ error: "Use POST" });
            return;
        }

        // ...resten av din kod oförändrad...


        const body = req.body as BuildPreviewRequest;
        const {
            fromDate,
            toDate,
            basis = "completedAt",
            customerIds,
            productTypeIds,
            factorPolicy = "latest",
        } = body || {};

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

        // (1) LÄS FAKTORER (productTypes) — fryses i svaret
        const ptSnap = await db.collection("productTypes").get();
        const factorsUsed: Record<string, Factor> = {};
        ptSnap.forEach(doc => {
            const d = doc.data() || {};
            const id = doc.id;
            factorsUsed[id] = {
                label: String(d.label ?? id),
                medianWeightKg: Number(d.medianWeightKg ?? 0),
                co2PerUnitKg: Number(d.co2PerUnitKg ?? (d as any).co2 ?? 0),
                schemaVersion: Number(d.schemaVersion ?? 1),
            };
        });

        // (2) LÄS KUNDNAMN (om ni har en customers-collection) — annars härled via ID
        const customersIncluded: Record<string, string> = {};
        const custChunks = chunk(customerIds, 10);
        for (const ch of custChunks) {
            const qs = await db
                .collection("customers")
                .where(admin.firestore.FieldPath.documentId(), "in", ch)
                .get()
                .catch(() => null);
            if (qs) {
                qs.forEach(doc => {
                    const d = doc.data() || {};
                    customersIncluded[doc.id] = String((d as any).name ?? (d as any).label ?? doc.id);
                });
            } else {
                ch.forEach(id => { if (!customersIncluded[id]) customersIncluded[id] = id; });
            }
        }
        customerIds.forEach(id => { if (!customersIncluded[id]) customersIncluded[id] = id; });

        // (3) QUERY INVENTORY inom period & kund(er)
        const from = ymdToDate(fromDate);
        const to = endOfDay(ymdToDate(toDate));

        // För snabb typ-check vid klientfilter i minnet
        const typeAllow: Set<string> | null =
            Array.isArray(productTypeIds) && productTypeIds.length
                ? new Set(productTypeIds.map(String))
                : null;

        const itemIds: string[] = [];
        type AggKey = `${string}|${string}`; // customerId|productTypeId
        const buckets = new Map<AggKey, { A: number; B: number; C: number; D: number; E: number }>();

        for (const group of chunk(customerIds, 10)) {
            // OBS: ENDAST ETT "in" → på customerId. Typ filtreras i minnet.
            let q: Query = db
                .collection("itInventory")
                .where("completed", "==", true)
                .where("completedAt", ">=", from)
                .where("completedAt", "<=", to)
                .where("customerId", "in", group as any);

            const snap = await q.get();

            snap.forEach(doc => {
                const d = doc.data() || {};
                const custId = String((d as any).customerId ?? (d as any).customer ?? "").trim();
                const typeId = String((d as any).productTypeId ?? (d as any).productType ?? "").trim();
                if (!custId || !typeId) return;

                // Klientfilter på typ (i minnet) för att undvika 2x "in" i samma query
                if (typeAllow && !typeAllow.has(typeId)) return;

                const grade = String((d as any).grade ?? "").toUpperCase() as "A" | "B" | "C" | "D" | "E";
                const key = `${custId}|${typeId}` as AggKey;

                if (!buckets.has(key)) buckets.set(key, { A: 0, B: 0, C: 0, D: 0, E: 0 });
                const row = buckets.get(key)!;
                if (["A", "B", "C", "D", "E"].includes(grade)) (row as any)[grade] += 1;

                itemIds.push(doc.id);
            });
        }

        // (4) Bygg perCustomer-rows med massor/CO2 från frysta faktorer
        const perCustomerMap = new Map<string, Row[]>();
        for (const [key, counts] of buckets.entries()) {
            const [customerId, productTypeId] = key.split("|");
            const f =
                factorsUsed[productTypeId] ??
                Object.values(factorsUsed).find(x => x.label.toLowerCase() === productTypeId.toLowerCase());

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

        // (5) Summera per kund + grand totals (tomma kunder får tomma rows)
        const perCustomer: CustomerBucket[] = [];
        const grand = { A: 0, B: 0, C: 0, D: 0, E: 0, eWasteKg: 0, recycledKg: 0, co2Kg: 0, total: 0 };

        for (const custId of customerIds) {
            const rows = perCustomerMap.get(custId) ?? [];
            const totals = rows.reduce((acc, r) => ({
                A: acc.A + r.A,
                B: acc.B + r.B,
                C: acc.C + r.C,
                D: acc.D + r.D,
                E: acc.E + r.E,
                eWasteKg: acc.eWasteKg + r.eWasteKg,
                recycledKg: acc.recycledKg + r.recycledKg,
                co2Kg: acc.co2Kg + r.co2Kg,
                total: acc.total + r.total,
            }), { A: 0, B: 0, C: 0, D: 0, E: 0, eWasteKg: 0, recycledKg: 0, co2Kg: 0, total: 0 });

            (Object.keys(grand) as (keyof typeof grand)[]).forEach(k => {
                (grand as any)[k] += (totals as any)[k] ?? 0;
            });

            perCustomer.push({
                customerId: custId,
                customerName: customersIncluded[custId] ?? custId,
                rows,
                totals,
            });
        }

        const response: BuildPreviewResponse = {
            filters: { fromDate, toDate, basis, customerIds, productTypeIds, factorPolicy },
            customersIncluded,
            factorsUsed,
            perCustomer,
            grandTotals: grand,
            selection: { itemIds },
        };

        res.status(200).json(response);
        return;

    } catch (err: any) {
        console.error("[buildCO2Preview] error:", err);
        res.status(500).json({ error: err?.message ?? "Internal error" });
        return;
    }
}
