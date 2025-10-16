// src/services/inventory.ts
// ------------------------------------------------------
// Hämtar färdigställda poster för rapporter (completedAt/invoicedAt),
// stödjer kundgrupper (customerIds), datumintervall och productTypes.
// Not: status/grade kan (vid behov) efterfiltreras i minnet.
// ------------------------------------------------------
import {
    collection,
    getDocs,
    query,
    where,
    Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import type { ReportFilters } from "../lib/schema";

// Hjälpare: parse "YYYY-MM-DD" som UTC-midnatt, returnera JS Date
function parseYMD_UTC(s: string): Date {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0, 0));
}

// Exklusivt end-datum (YYYY-MM-DD → +1 dag i UTC)
function nextDayUTC(s: string): Date {
    const dt = parseYMD_UTC(s);
    dt.setUTCDate(dt.getUTCDate() + 1);
    return dt;
}

// Firestore tillåter max 10 värden i "in"-operatorn.
// Chunkar listor till bitar om de är större.
function chunk<T>(arr: T[], size: number): T[][] {
    const res: T[][] = [];
    for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
    return res;
}

export type InventoryQueryResult = {
    items: Array<{
        id: string;
        productType?: unknown;
        grade?: unknown;
        reuse?: unknown;
        resold?: unknown;
        scrap?: unknown;
        // ...ev. fler fält som UI vill visa
    }>;
    itemIds: string[];
};

/**
 * Hämtar färdigställda poster för givna filter.
 * - basis: "completedAt" (rekommenderat) eller "invoicedAt"
 * - customerIds: en eller flera (kundgrupp)
 * - fromDate/toDate: "YYYY-MM-DD" inkl. gränser (to tolkas inklusivt)
 * - productTypes: valfritt (filtreras med where in om ≤10, annars chunkas)
 *
 * Obs: status/grade-filter i ReportFilters (om använt) görs enklast klient-side
 * efter hämtning, då Firestore saknar OR över flera fält.
 */
export async function queryInventoryForReport(
    filters: ReportFilters
): Promise<InventoryQueryResult> {
    const {
        fromDate,
        toDate,
        basis,
        customerIds,
        productTypes,
    } = filters;

    const basisField = basis === "invoicedAt" ? "invoicedAt" : "completedAt";

    // Datumgränser (UTC) → Firestore Timestamp
    const start = Timestamp.fromDate(parseYMD_UTC(fromDate));
    const endExclusive = Timestamp.fromDate(nextDayUTC(toDate));

    // Kundgrupper: måste finnas minst en
    const custChunks = chunk(customerIds && customerIds.length ? customerIds : ["__none__"], 10);
    const typeChunks = chunk(productTypes && productTypes.length ? productTypes : [undefined as any], 10);

    const allItems: InventoryQueryResult["items"] = [];

    // Kör kartesiska kombinationer av kund- och typ-chunks (begränsas av Firestore index)
    for (const cust10 of custChunks) {
        for (const type10 of typeChunks) {
            const conds: any[] = [
                where("customerId", "in", cust10),
                where(basisField, ">=", start),
                where(basisField, "<", endExclusive),
            ];

            // Produkt­typ filtreras på klientsidan (casing kan variera: "Laptop"/"laptop").
            // Därför ingen Firestore-where på productType här.

            const q = query(collection(db, "itInventory"), ...conds);
            const snap = await getDocs(q);

            snap.forEach((d) => {
                const data = d.data() as any;
                allItems.push({
                    id: d.id,
                    productType: data?.productType,
                    grade: data?.grade,
                    reuse: data?.reuse,
                    resold: data?.resold,
                    scrap: data?.scrap,
                });
            });
        }
    }

    // (Valfritt) Klient-sida efterfilter om filters.status / filters.grade är satta
    let filtered = allItems;
    // Klientsidefilter på productTypes (case-insensitivt)
    if (productTypes && productTypes.length) {
        const allowed = new Set(productTypes.map((t: any) => String(t).toLowerCase()));
        filtered = filtered.filter((it) =>
            allowed.has(String(it.productType || "").trim().toLowerCase())
        );
    }

    if (filters.status && filters.status.length) {
        filtered = filtered.filter((it) => {
            const s = (it.scrap ? "scraped" : it.resold ? "resold" : it.reuse ? "reused" : null) as
                | "reused"
                | "resold"
                | "scraped"
                | null;
            return s ? filters.status!.includes(s) : false;
        });
    }
    if (filters.grade && filters.grade.length) {
        filtered = filtered.filter((it) => typeof it.grade === "string" && filters.grade!.includes(it.grade as any));
    }

    return { items: filtered, itemIds: filtered.map((x) => x.id) };
}
