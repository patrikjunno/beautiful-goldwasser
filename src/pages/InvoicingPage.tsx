// src/pages/InvoicingPage.tsx
import React from "react";

type AnyObject = Record<string, any>;
type Item = { id: string } & AnyObject;

type CustomerOpt = { key: string; name: string };

export type InvoicingPageProps = {
    // Access/role
    user: any;
    isCustomer: (user: any) => boolean;

    // Filter + listor
    billingCustomerFilter: string;
    setBillingCustomerFilter: (value: string) => void;
    billingFilteredItems: Item[];
    allFilteredMarked: boolean;

    // Tillstånd/flaggar
    isMarkingAll: boolean;
    creatingReport: boolean;
    setCreatingReport: (v: boolean) => void;

    // Åtgärder
    toggleMarkAllInFiltered: (checked: boolean) => Promise<void> | void;
    setMarkedForInvoice: (id: string, checked: boolean) => Promise<void>;

    // Behövs för optimistisk UI (speglar ditt setItems i App.tsx)
    updateItemsState: (updater: (prev: Item[]) => Item[]) => void;

    // Data för dropdown
    customerListOpts: CustomerOpt[];

    // Helpers (samma som du använder i App.tsx)
    computeBillingSteps: (opts: { reuse: boolean; resold: boolean; scrap: boolean }) => {
        f3Procedure: number;
        endpointRemoval: number;
        osReinstall: number;
        endpointWipe: number;
        postWipeBootTest: number;
        dataErasure: number;
        refurbish: number;
    };
    fmtDateOnly: (d: any) => string;
    formatSerialForDisplay: (s: any) => string;
    toEpochMillis: (d: any) => number;

    // Rapportgenerering (din existerande CF-wrapper) + refresh
    createInvoiceReportCF: (selectedIds: string[]) => Promise<{ name: string; count: number } & Record<string, any>>;
    createInvoiceReportLocal?: () => Promise<{ reportId: string; name: string; count: number; customer: string }>;

    fetchFirstPage: () => Promise<void>;
};

export default function InvoicingPage(props: InvoicingPageProps) {
    const {
        user,
        isCustomer,

        billingCustomerFilter,
        setBillingCustomerFilter,
        billingFilteredItems,
        allFilteredMarked,

        isMarkingAll,
        creatingReport,
        setCreatingReport,

        toggleMarkAllInFiltered,
        setMarkedForInvoice,

        updateItemsState,

        customerListOpts,

        computeBillingSteps,
        fmtDateOnly,
        formatSerialForDisplay,
        toEpochMillis,

        createInvoiceReportCF,
        createInvoiceReportLocal,
        fetchFirstPage,
    } = props;

    return (
        <section className="gw-page">
            <div className="gw-section-header">
                {/* Vänster: filter + markera alla */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        Kund:
                        <select
                            value={billingCustomerFilter}
                            onChange={(e) => setBillingCustomerFilter(e.target.value)}
                            className="gw-input"
                            aria-label="Filtrera på kund"
                        >
                            <option value="">Alla kunder</option>
                            {customerListOpts.map((o) => (
                                <option key={o.key} value={o.key}>
                                    {o.name}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <input
                            type="checkbox"
                            checked={allFilteredMarked}
                            disabled={isMarkingAll || billingFilteredItems.length === 0}
                            onChange={(e) => toggleMarkAllInFiltered(e.currentTarget.checked)}
                            aria-label="Markera alla enheter i listan"
                        />
                        <span>Markera alla i listan ({billingFilteredItems.length})</span>
                    </label>
                </div>

                {/* Höger: knappen – oförändrat beteende */}
                {!isCustomer(user) && (
                    <div className="gw-section-actions">
                        <button
                            type="button"
                            className="btn btn-primary"
                            disabled={creatingReport || billingFilteredItems.every((it) => !(it as any).markedForInvoice)}
                            onClick={async () => {
                                const selectedIds = billingFilteredItems
                                    .filter((it: any) => !!it.markedForInvoice)
                                    .map((it) => String(it.id));

                                try {
                                    if (selectedIds.length === 0) {
                                        alert("Inga markerade poster.");
                                        return;
                                    }
                                    setCreatingReport(true);

                                    const useLocal = typeof createInvoiceReportLocal === "function";
                                    console.log("[InvoicingPage] Using", useLocal ? "LOCAL report creator" : "CLOUD FUNCTION report creator");

                                    const res = useLocal
                                        ? await createInvoiceReportLocal!()
                                        : await createInvoiceReportCF(selectedIds);

                                    alert(`✅ Fakturarapport skapad: ${res.name} (${res.count} enheter)`);
                                    await fetchFirstPage();


                                } catch (e: any) {
                                    console.error("createInvoiceReportCF error:", {
                                        code: e?.code,
                                        message: e?.message,
                                        details: e?.details,
                                    });
                                    alert("Fel vid skapande av fakturarapport: " + (e?.message || "okänt fel"));
                                } finally {
                                    setCreatingReport(false);
                                }
                            }}
                        >
                            {creatingReport ? "Skapar…" : "Generera fakturarapport"}
                        </button>
                    </div>
                )}
            </div>

            <div className="gw-card">
                <p className="text-muted" style={{ marginTop: 0 }}>
                    Visar enheter markerade som <strong>Färdig</strong>
                    {billingCustomerFilter ? (
                        <>
                            {" "}
                            för <strong>{billingCustomerFilter}</strong>
                        </>
                    ) : null}
                    .
                </p>

                {billingFilteredItems.length === 0 ? (
                    <div className="text-muted">Inga färdigställda enheter i den här vyn.</div>
                ) : (
                    <div className="gw-table-wrap">
                        <table className="gw-table-compact">
                            <thead>
                                <tr>
                                    <th className="td-center td-narrow">Fakturera</th>
                                    <th>Ordernr</th>
                                    <th>Tillverkare</th>
                                    <th>Modell</th>
                                    <th className="td-narrow">Serienr</th>
                                    <th>Kund</th>
                                    <th>Klart av</th>
                                    <th className="td-narrow">Datum</th>
                                    <th className="td-narrow">Status</th>
                                    <th className="td-narrow">F3-procedur</th>
                                    <th className="td-narrow">Borttagning i Endpoint</th>
                                    <th className="td-narrow">Ominstallation</th>
                                    <th className="td-narrow">Endpoint-wipe</th>
                                    <th className="td-narrow">Boot-test</th>
                                    <th className="td-narrow">Dataradering</th>
                                    <th className="td-narrow">Refurbish</th>
                                </tr>
                            </thead>
                            <tbody>
                                {billingFilteredItems
                                    .slice()
                                    .sort((a, b) => props.toEpochMillis((b as any).completedAt) - props.toEpochMillis((a as any).completedAt))
                                    .map((it) => {
                                        const anyIt = it as any;
                                        const statusParts: string[] = [];
                                        if (anyIt.reuse) statusParts.push("Återbruk");
                                        if (anyIt.resold) statusParts.push("Vidaresålt");
                                        if (anyIt.scrap) statusParts.push("Skrotad");
                                        const status = statusParts.join(" / ") || "-";

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
                                            : props.computeBillingSteps({
                                                reuse: !!anyIt.reuse,
                                                resold: !!anyIt.resold,
                                                scrap: !!anyIt.scrap,
                                            });

                                        return (
                                            <tr key={it.id}>
                                                <td className="td-center td-narrow">
                                                    <input
                                                        type="checkbox"
                                                        checked={!!it.markedForInvoice}
                                                        disabled={isMarkingAll || creatingReport}
                                                        onChange={async (e) => {
                                                            const checked = e.currentTarget.checked;
                                                            // Optimistisk UI (identisk strategi som i App.tsx)
                                                            updateItemsState((prev) =>
                                                                prev.map((x) => (x.id === it.id ? { ...x, markedForInvoice: checked } : x))
                                                            );
                                                            try {
                                                                await setMarkedForInvoice(it.id, checked);
                                                            } catch {
                                                                // Rulla tillbaka vid fel — exakt samma mönster
                                                                updateItemsState((prev) =>
                                                                    prev.map((x) => (x.id === it.id ? { ...x, markedForInvoice: !checked } : x))
                                                                );
                                                            }
                                                        }}
                                                    />
                                                </td>
                                                <td>{it.orderNumber || "-"}</td>
                                                <td>{it.manufacturer || "-"}</td>
                                                <td>{it.model || "-"}</td>
                                                <td className="td-narrow">{props.formatSerialForDisplay(it.serial)}</td>
                                                <td>{anyIt.customer || "-"}</td>
                                                <td className="td-truncate" title={it.completedBy || "-"}>
                                                    {it.completedBy || "-"}
                                                </td>
                                                <td className="td-narrow">{it.completedAt ? props.fmtDateOnly(it.completedAt) : "-"}</td>
                                                <td className="td-narrow">{status}</td>
                                                <td className="td-narrow">{steps.f3Procedure}</td>
                                                <td className="td-narrow">{steps.endpointRemoval}</td>
                                                <td className="td-narrow">{steps.osReinstall}</td>
                                                <td className="td-narrow">{steps.endpointWipe}</td>
                                                <td className="td-narrow">{steps.postWipeBootTest}</td>
                                                <td className="td-narrow">{steps.dataErasure}</td>
                                                <td className="td-narrow">{steps.refurbish}</td>
                                            </tr>
                                        );
                                    })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </section>
    );
}

export { };
