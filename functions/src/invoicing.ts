// functions/src/invoicing.ts
// Fakturerings-callables: createInvoiceReport + deleteInvoiceReport (soft-delete av rapport + rollback av items)

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { REGION, assertAdmin, getDb } from "./_admin";
import { FieldValue } from "firebase-admin/firestore";

/** Skapa fakturarapport av markerade itemIds (en kund per rapport, completed=true, ej redan fakturerade). */
export const createInvoiceReport = onCall<{ itemIds?: unknown }>(
    { region: REGION },
    async (req) => {
        assertAdmin(req);

        // 1) Inputvalidering
        const itemIds = Array.isArray(req.data?.itemIds)
            ? (req.data!.itemIds as unknown[]).map(String).filter(Boolean)
            : [];
        if (itemIds.length === 0) {
            throw new HttpsError("invalid-argument", "Saknar itemIds.");
        }

        const db = getDb();
        const uid = req.auth?.uid || "unknown";
        const email = (req.auth?.token?.email as string | undefined) || "unknown";
        console.log("[createInvoiceReport] input", { uid, email, count: itemIds.length });

        // 2) Snabbvalidering utanför transaktion (404 etc.)
        const refs = itemIds.map((id) => db.collection("itInventory").doc(id));
        const snaps = await Promise.all(refs.map((r) => r.get()));
        const missing = snaps.filter((s) => !s.exists).map((s) => s.id);
        if (missing.length) {
            throw new HttpsError("not-found", `Saknar poster: ${missing.join(", ")}`);
        }

        type ItItemForReport = {
            id: string;
            completed?: boolean;
            invoiceReportId?: string | null;
            customer?: string | null;

            status?: "reuse" | "resold" | "scrap" | string;
            disposition?: "reuse" | "resold" | "scrap" | string;
            reused?: boolean;
            resold?: boolean;
            scrap?: boolean;

            amount?: number;
            price?: number;
            billingTotal?: number;
            totalAmount?: number;
        };

        const items: ItItemForReport[] = snaps.map((s) => ({ id: s.id, ...(s.data() as any) }));

        // 3) Validera: completed, exakt en kund, ej redan fakturerad
        const customers = new Set<string>();
        for (const it of items) {
            if (it.completed !== true) {
                throw new HttpsError("failed-precondition", `Post ${it.id} är inte markerad som färdig.`);
            }
            if (it.invoiceReportId) {
                throw new HttpsError("failed-precondition", `Post ${it.id} är redan kopplad till en rapport.`);
            }
            const cust = String(it.customer || "").trim();
            if (!cust) throw new HttpsError("failed-precondition", `Post ${it.id} saknar kund.`);
            customers.add(cust);
        }
        if (customers.size !== 1) {
            throw new HttpsError("failed-precondition", "Endast en kund per rapport. Justera dina markeringar.");
        }

        // 4) Summering (matchar InvoiceReport.summary)
        const totalItems = items.length;

        const getDisposition = (x: ItItemForReport): "reuse" | "resold" | "scrap" | null => {
            const s = (x.status || x.disposition || "").toString().toLowerCase();
            if (s === "reuse") return "reuse";
            if (s === "resold") return "resold";
            if (s === "scrap") return "scrap";
            if (x.reused === true) return "reuse";
            if (x.resold === true) return "resold";
            if (x.scrap === true) return "scrap";
            return null;
        };

        let reused = 0, resold = 0, scrap = 0;
        for (const it of items) {
            const d = getDisposition(it);
            if (d === "reuse") reused++;
            else if (d === "resold") resold++;
            else if (d === "scrap") scrap++;
        }

        const pickAmount = (x: ItItemForReport): number =>
            Number(x.billingTotal ?? x.totalAmount ?? x.amount ?? x.price ?? 0) || 0;

        const totalAmount = items.reduce((sum, x) => sum + pickAmount(x), 0);
        const summary = { totalItems, reused, resold, scrap, totalAmount };

        // 5) Rapportnamn + transaktion (alla READS i tx före WRITES)
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const customer = [...customers][0];
        const name = `${customer} ${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;

        const reportsCol = db.collection("reports").doc("root").collection("fakturor");
        const reportRef = reportsCol.doc();

        await db.runTransaction(async (tx) => {
            // READS
            const itemSnaps = await Promise.all(itemIds.map((id) => tx.get(db.collection("itInventory").doc(id))));

            for (const snap of itemSnaps) {
                if (!snap.exists) throw new HttpsError("not-found", `Post ${snap.id} saknas.`);
                const cur = snap.data() || {};
                if (cur.completed !== true) throw new HttpsError("failed-precondition", `Post ${snap.id} är inte markerad som färdig.`);
                if (cur.invoiceReportId) throw new HttpsError("failed-precondition", `Post ${snap.id} är redan kopplad till en rapport.`);
            }

            // WRITES
            tx.set(reportRef, {
                name,
                customer,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: (req.auth?.token?.email as string | undefined) ?? req.auth?.uid ?? null,
                itemIds,
                summary,
                deletedAt: null,
                deletedBy: null
            });

            for (const snap of itemSnaps) {
                tx.update(snap.ref, {
                    markedForInvoice: false,
                    invoiceReportId: reportRef.id,
                    invoicedAt: FieldValue.serverTimestamp(),
                });
            }
        });

        console.log("[createInvoiceReport] ok", { reportId: reportRef.id, count: itemIds.length, summary });
        return { ok: true as const, reportId: reportRef.id, name, customer, count: itemIds.length };
    }
);

/** Soft-delete av fakturarapport + rollback av items till markerad-för-fakturering. */
export const deleteInvoiceReport = onCall<{ reportId?: unknown }>(
    { region: REGION },
    async (req) => {
        assertAdmin(req);

        const reportId = String(req.data?.reportId || "").trim();
        if (!reportId) throw new HttpsError("invalid-argument", "reportId saknas.");

        const db = getDb();
        const reportRef = db.collection("reports").doc("root").collection("fakturor").doc(reportId);

        await db.runTransaction(async (tx) => {
            // READS
            const reportSnap = await tx.get(reportRef);
            if (!reportSnap.exists) throw new HttpsError("not-found", "Rapporten finns inte.");

            const report = reportSnap.data() as any;
            if (report?.deletedAt) {
                throw new HttpsError("failed-precondition", "Rapporten är redan borttagen (soft-delete).");
            }

            const itemIds: string[] = Array.isArray(report.itemIds)
                ? report.itemIds.map(String).filter(Boolean)
                : [];

            const itemSnaps = await Promise.all(itemIds.map((id) => tx.get(db.collection("itInventory").doc(id))));

            // WRITES
            tx.update(reportRef, {
                deletedAt: FieldValue.serverTimestamp(),
                deletedBy: (req.auth?.token?.email as string | undefined) ?? req.auth?.uid ?? null,
            });

            for (const s of itemSnaps) {
                if (!s.exists) continue;
                tx.update(s.ref, {
                    invoiceReportId: FieldValue.delete(),
                    markedForInvoice: true,
                    invoicedAt: FieldValue.delete(),
                });
            }
        });

        return { ok: true as const, reportId };
    }
);
