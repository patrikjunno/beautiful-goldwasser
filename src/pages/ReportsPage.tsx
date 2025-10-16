console.log("[ReportsPage] loaded from pages/");

// src/pages/ReportsPage.tsx
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
    collection, doc, getDoc, getDocs, query, orderBy
} from "firebase/firestore";
import { httpsCallable, getFunctions } from "firebase/functions";
import { db } from "../firebase";

/* ===== Lokala typer/konstanter – kopierade från App.tsx ===== */

// Item (förenklad: id + övriga fält som any)
type Item = { id: string } & Record<string, any>;

// Fakturasummering
type InvoiceSummary = {
    totalItems: number;
    reusedCount: number;
    resoldCount: number;
    scrappedCount: number;
};

// Rapport-dokument
type InvoiceReport = {
    name: string;                 // "Kund YYMMDDHHMM"
    customer: string;             // exakt en kund per rapport
    createdAt: string;            // ISO
    createdBy: string | null;     // e-post/uid
    itemIds: string[];            // låsta objekt i rapporten
    summary: InvoiceSummary;      // summering högst upp
};

// Samma kolumn-typ som i App.tsx
type BillingSteps = {
    f3Procedure: number;
    endpointRemoval: number;
    osReinstall: number;
    endpointWipe: number;
    postWipeBootTest: number;
    dataErasure: number;
    refurbish: number;
};

// Konstanter (samma som i App.tsx)
const REPORTS_COLLECTION = "reports";
const INVOICE_SUBCOLLECTION = "fakturor";

// Härledning av 1/0-kolumner (kopierad från App.tsx)
function computeBillingSteps(opts: { reuse: boolean; resold: boolean; scrap: boolean }): BillingSteps {
    const { reuse, resold, scrap } = opts;
    if (reuse) {
        return {
            f3Procedure: 1,
            endpointRemoval: 1,
            osReinstall: 0,
            endpointWipe: 1,
            postWipeBootTest: 1,
            dataErasure: 1,
            refurbish: 1,
        };
    }
    if (resold) {
        return {
            f3Procedure: 1,
            endpointRemoval: 1,
            osReinstall: 1,
            endpointWipe: 1,
            postWipeBootTest: 1,
            dataErasure: 1,
            refurbish: 1,
        };
    }
    if (scrap) {
        return {
            f3Procedure: 0,
            endpointRemoval: 0,
            osReinstall: 0,
            endpointWipe: 0,
            postWipeBootTest: 0,
            dataErasure: 1,
            refurbish: 0,
        };
    }
    return {
        f3Procedure: 0,
        endpointRemoval: 0,
        osReinstall: 0,
        endpointWipe: 0,
        postWipeBootTest: 0,
        dataErasure: 0,
        refurbish: 0,
    };
}

/* ===== Små helpers/stilar som används i tabellen (kopierade från App.tsx) ===== */
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
    // stöd både ISO-string, Date och Firestore Timestamp
    const date: Date =
        typeof d?.toDate === "function" ? d.toDate() :
            typeof d === "string" ? new Date(d) :
                d instanceof Date ? d : new Date(NaN);
    return isNaN(date.getTime()) ? "—" : date.toLocaleDateString("sv-SE");
}

/* =========================
   Själva komponenten
   (oförändrad logik från App.tsx)
========================= */

export default function ReportsPage() {
    const functions = getFunctions(undefined, "europe-west1"); // används för deleteInvoiceReport

    const [invoiceReports, setInvoiceReports] = useState<Array<{ id: string } & InvoiceReport>>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [reportItems, setReportItems] = useState<Record<string, Item[]>>({});
    const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

    // Delete-modal
    const [showDeleteReportModal, setShowDeleteReportModal] = useState(false);
    const [reportDeleteConfirmText, setReportDeleteConfirmText] = useState("");
    const [pendingReportToDelete, setPendingReportToDelete] = useState<(InvoiceReport & { id: string }) | null>(null);

    function openDeleteReportModal(report: InvoiceReport & { id: string }) {
        setPendingReportToDelete(report);
        setReportDeleteConfirmText("");
        setShowDeleteReportModal(true);
    }
    function cancelDeleteReportModal() {
        setShowDeleteReportModal(false);
        setPendingReportToDelete(null);
        setReportDeleteConfirmText("");
    }
    async function confirmDeleteReportModal() {
        if (!pendingReportToDelete) return;
        if (reportDeleteConfirmText !== "DELETE") return;

        try {
            const fn = httpsCallable<any, any>(functions, "deleteInvoiceReport");
            await fn({ reportId: pendingReportToDelete.id });

            setInvoiceReports(prev => prev.filter(x => x.id !== pendingReportToDelete.id));
            setExpandedId(null);

            // Om startsidan har exponerat refresh (gwFetchFirstPage) – trigga den
            const w = window as any;
            if (typeof w.gwFetchFirstPage === "function") {
                await w.gwFetchFirstPage();
            }
        } catch (err) {
            console.error("Kunde inte ta bort rapport:", err);
            alert("Kunde inte ta bort rapporten.");
        } finally {
            cancelDeleteReportModal();
        }
    }

    // Hämta alla rapporter (enkelt: utan where/orderBy)
    useEffect(() => {
        (async () => {
            try {
                const colRef = collection(doc(db, REPORTS_COLLECTION, "root"), INVOICE_SUBCOLLECTION);
                const snap = await getDocs(colRef);

                const docs = snap.docs.map((d) => {
                    const raw = d.data() as any;
                    const createdAt =
                        raw.createdAt?.toDate?.() instanceof Date
                            ? (raw.createdAt.toDate() as Date).toISOString()
                            : typeof raw.createdAt === "string"
                                ? raw.createdAt
                                : "";
                    const deletedAt = typeof raw.deletedAt === "undefined" ? null : raw.deletedAt;
                    return {
                        id: d.id,
                        ...raw,
                        createdAt,
                        deletedAt,
                    } as unknown as InvoiceReport & { id: string; deletedAt: any };
                });

                docs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
                setInvoiceReports(docs.filter((r: any) => r.deletedAt === null));
            } catch (e) {
                console.error("Kunde inte hämta rapporter:", e);
                setInvoiceReports([]);
            }
        })();
    }, []);

    // Ladda items för en given rapport (cache per reportId)
    const loadReportItems = async (r: { id: string } & InvoiceReport) => {
        if (reportItems[r.id]) return;
        setLoadingDetail(r.id);
        try {
            const items: Item[] = [];
            for (const id of r.itemIds) {
                try {
                    const s = await getDoc(doc(db, "itInventory", id));
                    if (s.exists()) items.push({ id: s.id, ...(s.data() as any) } as Item);
                } catch (e) {
                    console.warn("Kunde inte läsa item", id, e);
                }
            }
            setReportItems((prev) => ({ ...prev, [r.id]: items }));
        } finally {
            setLoadingDetail(null);
        }
    };

    // Summera 1/0-kolumner för en rapports items
    function calcReportStepTotals(items: Item[]) {
        const t = {
            f3Procedure: 0,
            endpointRemoval: 0,
            osReinstall: 0,
            endpointWipe: 0,
            postWipeBootTest: 0,
            dataErasure: 0,
            refurbish: 0,
        };
        for (const it of items) {
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
                : computeBillingSteps({
                    reuse: !!anyIt.reuse,
                    resold: !!anyIt.resold,
                    scrap: !!anyIt.scrap,
                });
            t.f3Procedure += steps.f3Procedure;
            t.endpointRemoval += steps.endpointRemoval;
            t.osReinstall += steps.osReinstall;
            t.endpointWipe += steps.endpointWipe;
            t.postWipeBootTest += steps.postWipeBootTest;
            t.dataErasure += steps.dataErasure;
            t.refurbish += steps.refurbish;
        }
        return t;
    }

    return (
        <div>
            <h1 style={H1}>Rapporter</h1>


            {invoiceReports.length === 0 ? (
                <div style={{ color: "#6b7280" }}>Inga fakturarapporter skapade ännu.</div>
            ) : (
                <ul style={{ marginTop: 8, listStyle: "none", padding: 0 }}>
                    {invoiceReports.map((r) => {
                        const isOpen = expandedId === r.id;

                        const s: any = (r as any).summary ?? {};
                        const totalItems = s.totalItems ?? (Array.isArray(r.itemIds) ? r.itemIds.length : 0);
                        const reused = (s.reused ?? s.reusedCount) ?? 0;
                        const resold = (s.resold ?? s.resoldCount) ?? 0;
                        const scrap = (s.scrap ?? s.scrappedCount) ?? 0;
                        const totalAmount = (s.totalAmount ?? s.total);
                        const fmtSEK = (v: unknown) =>
                            typeof v === "number"
                                ? new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(v)
                                : null;

                        return (
                            <li key={r.id} style={{ marginBottom: 16 }}>
                                {/* Rubrikrad (klickbar) */}
                                <div
                                    onClick={async () => {
                                        const next = isOpen ? null : r.id;
                                        setExpandedId(next);
                                        if (next) await loadReportItems(r);
                                    }}
                                    style={{
                                        cursor: "pointer",
                                        fontWeight: 700,
                                        display: "inline-block",
                                        marginBottom: 4,
                                    }}
                                    title={isOpen ? "Klicka för att stänga" : "Klicka för att visa detaljer"}
                                >
                                    <strong>{r.name}</strong> — {r.customer} —{" "}
                                    {new Date(r.createdAt).toLocaleString("sv-SE")}
                                </div>

                                {/* (valfritt) direktlänk till detaljvy */}
                                <div style={{ fontSize: 13, marginBottom: 8 }}>
                                    <a
                                        href={`${window.location.origin}/#/rapport/${encodeURIComponent(r.id)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()} // hindra expand/collapse
                                    >
                                        Öppna i nytt fönster
                                    </a>
                                </div>

                                {/* Summeringsrad */}
                                <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
                                    {totalAmount != null && <span style={{ marginRight: 6 }}>{fmtSEK(totalAmount)}</span>}
                                    <span>• {totalItems} enheter</span>
                                    <span> • Återbruk: {reused}</span>
                                    <span> • Vidaresålt: {resold}</span>
                                    <span> • Skrotat: {scrap}</span>
                                </div>

                                {/* Detaljer */}
                                {isOpen && (
                                    <div>
                                        {!reportItems[r.id] ? (
                                            <div style={{ color: "#6b7280" }}>
                                                {loadingDetail === r.id ? "Laddar…" : "Ingen data."}
                                            </div>
                                        ) : (
                                            <>
                                                <div style={{ fontSize: 13, margin: "6px 0 10px" }}>
                                                    {(() => {
                                                        const t = calcReportStepTotals(reportItems[r.id]);
                                                        return (
                                                            <>
                                                                <strong>Summering:</strong>{" "}
                                                                F3-procedur: {t.f3Procedure} • Borttagning i Endpoint: {t.endpointRemoval} •{" "}
                                                                Ominstallation OS: {t.osReinstall} • Wipe i Endpoint: {t.endpointWipe} •{" "}
                                                                Uppstartstest efter Wipe: {t.postWipeBootTest} • Dataradering: {t.dataErasure} •{" "}
                                                                Refurbish: {t.refurbish}
                                                            </>
                                                        );
                                                    })()}
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
                                                        {reportItems[r.id]!
                                                            .slice()
                                                            .sort((a, b) => String(b.completedAt || "").localeCompare(String(a.completedAt || "")))
                                                            .map((it) => {
                                                                const statusParts: string[] = [];
                                                                if ((it as any).reuse) statusParts.push("Återbruk");
                                                                if ((it as any).resold) statusParts.push("Vidaresålt");
                                                                if ((it as any).scrap) statusParts.push("Skrotad");
                                                                const status = statusParts.join(" / ") || "-";

                                                                const hasSteps = typeof (it as any).f3Procedure === "number";
                                                                const steps = hasSteps
                                                                    ? {
                                                                        f3Procedure: (it as any).f3Procedure ?? 0,
                                                                        endpointRemoval: (it as any).endpointRemoval ?? 0,
                                                                        osReinstall: (it as any).osReinstall ?? 0,
                                                                        endpointWipe: (it as any).endpointWipe ?? 0,
                                                                        postWipeBootTest: (it as any).postWipeBootTest ?? 0,
                                                                        dataErasure: (it as any).dataErasure ?? 0,
                                                                        refurbish: (it as any).refurbish ?? 0,
                                                                    }
                                                                    : computeBillingSteps({
                                                                        reuse: !!(it as any).reuse,
                                                                        resold: !!(it as any).resold,
                                                                        scrap: !!(it as any).scrap,
                                                                    });

                                                                return (
                                                                    <tr key={it.id}>
                                                                        <td style={TDC}>{it.orderNumber}</td>
                                                                        <td style={TDC}>{it.manufacturer}</td>
                                                                        <td style={TDC}>{it.model}</td>
                                                                        <td style={TDC}>{it.serial}</td>
                                                                        <td style={TDC}>{(it as any).customer}</td>
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

                                                <div style={{ marginTop: 8 }}>
                                                    <button
                                                        type="button"
                                                        className="btn btn-danger"
                                                            onClick={() => openDeleteReportModal(r)}
                                                        title="Ta bort hela rapporten"
                                                    >
                                                        Ta bort rapport
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>

            )}

            {showDeleteReportModal && createPortal(
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="delete-report-title"
                    className="gw-modal-overlay"
                    onClick={cancelDeleteReportModal}
                >
                    <div
                        className="gw-modal-card gw-modal-card--narrow"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 id="delete-report-title" className="gw-modal-title">
                            Bekräfta radering av rapport
                        </h3>

                        <p>
                            Du är på väg att radera rapporten <b>{pendingReportToDelete?.name}</b>{" "}
                            ({pendingReportToDelete?.itemIds?.length || 0} enhet(er)).
                        </p>
                        <p>
                            Enheterna återgår till <b>Fakturering</b> och förblir färdigmarkerade.
                        </p>
                        <p>Skriv <code>DELETE</code> för att bekräfta.</p>

                        <input
                            type="text"
                            autoFocus
                            value={reportDeleteConfirmText}
                            onChange={(e) => setReportDeleteConfirmText(e.target.value)}
                            placeholder='Skriv "DELETE"'
                            aria-label='Skriv "DELETE" för att bekräfta'
                            className="gw-input"
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && reportDeleteConfirmText === "DELETE") {
                                    void confirmDeleteReportModal();
                                }
                            }}
                        />

                        <div className="gw-modal-actions">
                            <button onClick={cancelDeleteReportModal} className="btn">
                                Avbryt
                            </button>
                            <button
                                onClick={confirmDeleteReportModal}
                                disabled={reportDeleteConfirmText !== "DELETE"}
                                className={`btn btn-danger${reportDeleteConfirmText === "DELETE" ? " is-active" : ""}`}
                            >
                                Ja, radera
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

        </div>
    );
}

export { };
