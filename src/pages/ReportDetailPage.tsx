// src/pages/ReportDetailPage.tsx
import React, { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { computeBillingSteps } from "../lib/billing";
import type { BillingSteps } from "../lib/billing";

/* ===== Lokala typer/konstanter (självbärande) ===== */
type Item = { id: string } & Record<string, any>;

type InvoiceSummary = {
    totalItems: number;
    reusedCount: number;
    resoldCount: number;
    scrappedCount: number;
};

type InvoiceReport = {
    name: string;
    customer: string;
    createdAt: string;
    createdBy: string | null;
    itemIds: string[];
    summary: InvoiceSummary;
};


const REPORTS_COLLECTION = "reports";
const INVOICE_SUBCOLLECTION = "fakturor";


const H1: React.CSSProperties = { marginTop: 0 };
const TABLE_COMPACT: React.CSSProperties = {
    display: "inline-table",
    width: "auto",
    borderCollapse: "collapse",
    marginTop: 10,
    tableLayout: "auto",
};
const THC: React.CSSProperties = { border: "1px solid #ccc", padding: "4px 6px", whiteSpace: "nowrap" };
const TDC: React.CSSProperties = { border: "1px solid #ccc", padding: "4px 6px", whiteSpace: "nowrap" };
const THC_NARROW: React.CSSProperties = { ...THC, width: "1%" };
const TDC_NARROW: React.CSSProperties = { ...TDC, width: "1%" };

function fmtDateOnly(d: any): string {
    if (!d) return "—";
    const date: Date =
        typeof d?.toDate === "function" ? d.toDate() :
            typeof d === "string" ? new Date(d) :
                d instanceof Date ? d : new Date(NaN);
    return isNaN(date.getTime()) ? "—" : date.toLocaleDateString("sv-SE");
}

/* ===== Själva sidan ===== */
export default function ReportDetailPage({ reportId, authReady }: { reportId: string; authReady: boolean }) {
    const [report, setReport] = useState<({ id: string } & InvoiceReport) | null>(null);
    const [itemsForReport, setItemsForReport] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!authReady) return;

        (async () => {
            setLoading(true);
            setError(null);
            try {
                const rDoc = await getDoc(doc(db, REPORTS_COLLECTION, "root", INVOICE_SUBCOLLECTION, reportId));
                if (!rDoc.exists()) {
                    setReport(null);
                    setItemsForReport([]);
                    return;
                }
                const r = { id: rDoc.id, ...(rDoc.data() as InvoiceReport) };
                setReport(r);

                const arr: Item[] = [];
                for (const id of r.itemIds) {
                    try {
                        const s = await getDoc(doc(db, "itInventory", id));
                        if (s.exists()) arr.push({ id: s.id, ...(s.data() as any) } as Item);
                    } catch (e: any) {
                        console.warn("Kunde inte läsa item", id, e?.message || e);
                    }
                }
                setItemsForReport(arr);
            } catch (e: any) {
                setError(e?.message || "Kunde inte läsa rapport.");
            } finally {
                setLoading(false);
            }
        })();
    }, [reportId, authReady]);

    if (!authReady) return <div style={{ color: "#6b7280" }}>Laddar inloggning…</div>;
    if (loading) return <div style={{ color: "#6b7280" }}>Laddar rapport…</div>;
    if (error) return <div style={{ color: "#b91c1c" }}>Fel: {error}</div>;
    if (!report) return <div style={{ color: "#6b7280" }}>Rapporten hittades inte.</div>;

    const totals = (() => {
        const t = { f3Procedure: 0, endpointRemoval: 0, osReinstall: 0, endpointWipe: 0, postWipeBootTest: 0, dataErasure: 0, refurbish: 0 };
        for (const it of itemsForReport) {
            const anyIt = it as any;
            const hasSteps = typeof anyIt.f3Procedure === "number";
            const steps = hasSteps
                ? {
                    f3Procedure: anyIt.f3Procedure ?? 0,
                    endpointRemoval: anyIt.endpointRemoval ?? 0,
                    osReinstall: anyIt.osReinstall ?? 0,
                    endpointWipe: anyIt.endpointWipe ?? 0,
                    postWipeBootTest: anyIt.postWipeBootTest ?? 0,
                    dataErasure: anyIt.dataErasure ?? 0,
                    refurbish: anyIt.refurbish ?? 0,
                }
                : computeBillingSteps({ reuse: !!anyIt.reuse, resold: !!anyIt.resold, scrap: !!anyIt.scrap });
            t.f3Procedure += steps.f3Procedure;
            t.endpointRemoval += steps.endpointRemoval;
            t.osReinstall += steps.osReinstall;
            t.endpointWipe += steps.endpointWipe;
            t.postWipeBootTest += steps.postWipeBootTest;
            t.dataErasure += steps.dataErasure;
            t.refurbish += steps.refurbish;
        }
        return t;
    })();

    return (
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <h1 style={H1}>{report.name}</h1>
            <div style={{ marginBottom: 8, color: "#374151" }}>
                Kund: <strong>{report.customer}</strong> • Skapad: {new Date(report.createdAt).toLocaleString("sv-SE")}
            </div>

            <div style={{ fontSize: 13, margin: "8px 0 12px" }}>
                <strong>Summering:</strong>{" "}
                F3-procedur: {totals.f3Procedure} • Borttagning i Endpoint: {totals.endpointRemoval} •{" "}
                Ominstallation OS: {totals.osReinstall} • Wipe i Endpoint: {totals.endpointWipe} •{" "}
                Uppstartstest efter Wipe: {totals.postWipeBootTest} • Dataradering: {totals.dataErasure} •{" "}
                Refurbish: {totals.refurbish}
            </div>

            <table style={TABLE_COMPACT}>
                <thead>
                    <tr>
                        <th style={THC}>Ordernr</th>
                        <th style={THC}>Tillverkare</th>
                        <th style={THC}>Modell</th>
                        <th style={THC}>Serienr</th>
                        <th style={THC}>Kund</th>
                        <th style={THC}>Klart av</th>
                        <th style={THC}>Datum</th>
                        <th style={THC}>Status</th>
                        <th style={THC_NARROW}>F3-procedur</th>
                        <th style={THC_NARROW}>Borttagning i Endpoint</th>
                        <th style={THC_NARROW}>Ominstallation OS</th>
                        <th style={THC_NARROW}>Wipe i Endpoint</th>
                        <th style={THC_NARROW}>Uppstartstest efter Wipe</th>
                        <th style={THC_NARROW}>Dataradering</th>
                        <th style={THC_NARROW}>Refurbish</th>
                    </tr>
                </thead>
                <tbody>
                    {itemsForReport
                        .slice()
                        .sort((a, b) => String(b.completedAt || "").localeCompare(String(a.completedAt || "")))
                        .map((it) => {
                            const anyIt = it as any;
                            const hasSteps = typeof anyIt.f3Procedure === "number";
                            const steps = hasSteps
                                ? {
                                    f3Procedure: anyIt.f3Procedure,
                                    endpointRemoval: anyIt.endpointRemoval,
                                    osReinstall: anyIt.osReinstall,
                                    endpointWipe: anyIt.endpointWipe,
                                    postWipeBootTest: anyIt.postWipeBootTest,
                                    dataErasure: anyIt.dataErasure,
                                    refurbish: anyIt.refurbish,
                                }
                                : computeBillingSteps({ reuse: !!anyIt.reuse, resold: !!anyIt.resold, scrap: !!anyIt.scrap });

                            const statusParts: string[] = [];
                            if (anyIt.reuse) statusParts.push("Återbruk");
                            if (anyIt.resold) statusParts.push("Vidaresålt");
                            if (anyIt.scrap) statusParts.push("Skrotad");
                            const status = statusParts.join(" / ") || "-";

                            return (
                                <tr key={it.id}>
                                    <td style={TDC}>{it.orderNumber}</td>
                                    <td style={TDC}>{it.manufacturer}</td>
                                    <td style={TDC}>{it.model}</td>
                                    <td style={TDC}>{it.serial}</td>
                                    <td style={TDC}>{anyIt.customer}</td>
                                    <td style={TDC}>{it.completedBy}</td>
                                    <td style={TDC}>{fmtDateOnly(it.completedAt)}</td>
                                    <td style={TDC}>{status}</td>
                                    <td style={TDC_NARROW}>{steps.f3Procedure}</td>
                                    <td style={TDC_NARROW}>{steps.endpointRemoval}</td>
                                    <td style={TDC_NARROW}>{steps.osReinstall}</td>
                                    <td style={TDC_NARROW}>{steps.endpointWipe}</td>
                                    <td style={TDC_NARROW}>{steps.postWipeBootTest}</td>
                                    <td style={TDC_NARROW}>{steps.dataErasure}</td>
                                    <td style={TDC_NARROW}>{steps.refurbish}</td>
                                </tr>
                            );
                        })}
                </tbody>
            </table>
        </div>
    );
}

export { };

