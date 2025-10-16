// src/pages/ProductTypesAdmin.tsx
import React from "react";
import {
    collection,
    onSnapshot,
    query,
    orderBy,
    FirestoreError,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    serverTimestamp,
    deleteDoc,
    getCountFromServer,
    where,
} from "firebase/firestore";

import { auth, db } from "../firebase";

// Datamodell P0
export type ProductTypeDoc = {
    id: string;                 // doc id (slug, lowercase)
    label: string;              // visningsnamn
    medianWeightKg: number;     // default 0
    co2PerUnitKg: number;       // default 0
    schemaVersion: number;      // start 1, bump vid ändring av vikt/CO2
    active: boolean;            // soft delete via false
    updatedAt?: any | null;     // Timestamp|Date|string
    updatedBy?: string | null;  // uid/email
    // P1a: usage counters
    // usedUninvoiced?: number;
    // usedInvoiced?: number;
};

type SortKey = "label" | "updatedAt" | "active";

// Slugifiera: lowercase, ta bort diakritik, ersätt icke tillåtna tecken med '-', trimma och komprimera '-'
function toSlugId(s: string): string {
    return (s || "")
        .trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // ta bort accent
        .toLowerCase()
        .replace(/[^a-z0-9\-_. ]+/g, " ")                 // håll a-z, 0-9, - _ . och mellanslag
        .replace(/[\s.]+/g, "-")                          // ersätt space + punkt med '-'
        .replace(/\-+/g, "-")                             // komprimera flera '-'
        .replace(/^\-+|\-+$/g, "");                       // trim '-' i kanter
}

async function currentUserEmail(): Promise<string | null> {
    const u = auth.currentUser;
    if (!u) return null;
    return u.email || u.uid || null;
}


function fmtDate(val: any): string {
    if (!val) return "-";
    try {
        if (typeof val?.toDate === "function") {
            const d = val.toDate();
            return d.toLocaleString("sv-SE");
        }
        if (typeof val?.seconds === "number") {
            return new Date(val.seconds * 1000).toLocaleString("sv-SE");
        }
        if (typeof val === "string") {
            const d = new Date(val);
            return isNaN(d.getTime()) ? val : d.toLocaleString("sv-SE");
        }
        if (val instanceof Date) return val.toLocaleString("sv-SE");
    } catch {
        /* noop */
    }
    return "-";
}

function usageText(u?: { total: number; invoiced: number }, loading?: boolean) {
    if (loading) return "—";
    if (!u) return "—";
    return `${u.total}/${u.invoiced}`;
}


export default function ProductTypesAdmin() {
    const [rows, setRows] = React.useState<ProductTypeDoc[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    // UI-state
    const [qText, setQText] = React.useState("");
    const [showInactive, setShowInactive] = React.useState(false);
    const [sortKey, setSortKey] = React.useState<SortKey>("label");
    const [sortAsc, setSortAsc] = React.useState<boolean>(true);

    // Skapa-ny state
    const [createOpen, setCreateOpen] = React.useState(false);
    const [createId, setCreateId] = React.useState("");
    const [createLabel, setCreateLabel] = React.useState("");
    const [creating, setCreating] = React.useState(false);
    const [createError, setCreateError] = React.useState<string | null>(null);
    // Edit-modal state
    const [editOpen, setEditOpen] = React.useState(false);
    const [editError, setEditError] = React.useState<string | null>(null);
    const [savingEdit, setSavingEdit] = React.useState(false);

    const [editId, setEditId] = React.useState<string>("");
    const [editLabel, setEditLabel] = React.useState<string>("");
    const [editWeight, setEditWeight] = React.useState<string>("0");
    const [editCO2, setEditCO2] = React.useState<string>("0");
    const [editActive, setEditActive] = React.useState<boolean>(true);
    const [editSchemaVersion, setEditSchemaVersion] = React.useState<number>(1);
    const [bumpVersion, setBumpVersion] = React.useState<boolean>(false);

    // Öppna modal med radens data
    const openEdit = (row: ProductTypeDoc) => {
        setEditError(null);
        setEditId(row.id);
        setEditLabel(row.label || "");
        setEditWeight(String(row.medianWeightKg ?? 0));
        setEditCO2(String(row.co2PerUnitKg ?? 0));
        setEditActive(!!row.active);
        setEditSchemaVersion(Number.isFinite(row.schemaVersion) ? row.schemaVersion : 1);
        setBumpVersion(false);
        setEditOpen(true);
    };

    // Usage counters: { [productTypeId]: { total: number, invoiced: number } }
    const [usage, setUsage] = React.useState<Record<string, { total: number; invoiced: number }>>({});
    const [usageLoading, setUsageLoading] = React.useState(false);

    const handleUpdate = async () => {
        try {
            setEditError(null);

            const label = (editLabel || "").trim();
            if (!label) {
                setEditError("Label krävs.");
                return;
            }

            const weight = Number(editWeight);
            const co2 = Number(editCO2);
            if (!Number.isFinite(weight) || weight < 0) {
                setEditError("Vikt (kg) måste vara ett tal ≥ 0.");
                return;
            }
            if (!Number.isFinite(co2) || co2 < 0) {
                setEditError("CO₂/enhet (kg) måste vara ett tal ≥ 0.");
                return;
            }

            const original = rows.find((r) => r.id === editId);
            if (!original) {
                setEditError("Kunde inte hitta originalraden.");
                return;
            }

            const weightChanged = Number(original.medianWeightKg ?? 0) !== weight;
            const co2Changed = Number(original.co2PerUnitKg ?? 0) !== co2;

            // Om vikt/CO₂ ändras kräver vi att "Bump version" är ikryssad
            if ((weightChanged || co2Changed) && !bumpVersion) {
                setEditError("Du har ändrat vikt/CO₂. Kryssa i 'Bump version' för att öka schemaVersion.");
                return;
            }

            setSavingEdit(true);

            const by = await currentUserEmail();
            const ref = doc(db, "productTypes", editId);

            const nextVersion =
                (weightChanged || co2Changed) && bumpVersion
                    ? (Number.isFinite(editSchemaVersion) ? editSchemaVersion : 1) + 1
                    : (Number.isFinite(editSchemaVersion) ? editSchemaVersion : 1);

            await updateDoc(ref, {
                label,
                medianWeightKg: weight,
                co2PerUnitKg: co2,
                active: editActive,
                schemaVersion: nextVersion,
                updatedAt: serverTimestamp(),
                updatedBy: by ?? null,
            });

            setEditOpen(false);
        } catch (e: any) {
            console.error(e);
            setEditError(e?.message || "Kunde inte spara ändringen.");
        } finally {
            setSavingEdit(false);
        }
    };

    const handleToggleActive = async (row: ProductTypeDoc) => {
        try {
            const ref = doc(db, "productTypes", row.id);
            const by = await currentUserEmail();
            await updateDoc(ref, {
                active: !row.active,
                updatedAt: serverTimestamp(),
                updatedBy: by ?? null,
            });
        } catch (e) {
            console.error("toggle active failed", e);
            alert("Kunde inte växla active.");
        }
    };

    const handleHardDelete = async (row: ProductTypeDoc) => {
        try {
            // Bekräfta
            const input = window.prompt(
                `Hard delete av produkttyp '${row.id}'.\n\n` +
                `Villkoret är att den ALDRIG har använts: 0 ofakturerade / 0 fakturerade (0/0).\n\n` +
                `Skriv exakt: DELETE`
            );
            if (input === null) return;
            if (input.trim() !== "DELETE") {
                alert("Avbrutet. Du måste skriva exakt 'DELETE'.");
                return;
            }

            // Räkna hur många enheter som refererar typen
            const itRef = collection(db, "itInventory");

            // Totalt (alla enheter med denna typ)
            const qTotal = query(itRef, where("productTypeId", "==", row.id));
            const totalSnap = await getCountFromServer(qTotal);
            const total = totalSnap.data().count || 0;

            // Fakturerade (kräver index: productTypeId + invoiceReportId)
            const qInvoiced = query(
                itRef,
                where("productTypeId", "==", row.id),
                where("invoiceReportId", "!=", null),
                orderBy("invoiceReportId")
            );
            const invSnap = await getCountFromServer(qInvoiced);
            const invoiced = invSnap.data().count || 0;

            // 1) ALDRIG hard delete om typen förekommer i fakturerade enheter
            if (invoiced > 0) {
                alert(
                    "Kan inte ta bort: typen används i fakturerade enheter och måste bevaras för historik.\n" +
                    "Använd inaktivering (active=false) istället."
                );
                return;
            }

            // 2) Blockera om den används i ofakturerade enheter
            if (total > 0) {
                alert(
                    `Kan inte ta bort: typen används av ${total} enhet(er).\n\n` +
                    `Åtgärder:\n` +
                    `• Inaktivera i stället (soft delete), eller\n` +
                    `• Migrera ej fakturerade till annan typ och försök igen.`
                );
                return;
            }

            // 3) Endast 0/0 → tillåt hard delete
            await deleteDoc(doc(db, "productTypes", row.id));
            if (editOpen && editId === row.id) setEditOpen(false);
            alert(`Produkttyp '${row.id}' borttagen.`);
        } catch (e: any) {
            console.error("hard delete failed", e);
            alert(e?.message || "Hard delete misslyckades.");
        }
    };




    // Håll ID i synk när man skriver label (endast när användaren inte manuellt ändrat ID)
    const idManuallyEditedRef = React.useRef(false);
    React.useEffect(() => {
        if (!idManuallyEditedRef.current) {
            setCreateId(toSlugId(createLabel));
        }
    }, [createLabel]);

    const onEditIdManually = (v: string) => {
        idManuallyEditedRef.current = true;
        setCreateId(toSlugId(v)); // försäkra slug
    };

    // Live-lyssning productTypes (default: alla; vi filtrerar i klienten initialt)
    React.useEffect(() => {
        setLoading(true);
        setError(null);

        // Vi beställer i DB-ordning på label för deterministisk lista;
        // klienten kan sedan sortera om.
        const q = query(collection(db, "productTypes"), orderBy("label"));
        const unsub = onSnapshot(
            q,
            (snap) => {
                const next: ProductTypeDoc[] = snap.docs.map((d) => {
                    const data = d.data() as any;
                    return {
                        id: d.id,
                        label: String(data.label ?? ""),
                        medianWeightKg: Number(data.medianWeightKg ?? 0),
                        co2PerUnitKg: Number(data.co2PerUnitKg ?? 0),
                        schemaVersion: Number(data.schemaVersion ?? 1),
                        active: data.active !== false, // default true
                        updatedAt: data.updatedAt ?? null,
                        updatedBy: data.updatedBy ?? null,
                    };
                });
                setRows(next);
                setLoading(false);
            },
            (err: FirestoreError) => {
                console.error("productTypes snapshot error:", err);
                setError(err.message || "Kunde inte läsa productTypes.");
                setLoading(false);
            }
        );
        return () => unsub();
    }, []);

    React.useEffect(() => {
        let alive = true;
        (async () => {
            try {
                setUsageLoading(true);
                // ladda för varje typ som saknar cache
                for (const r of rows) {
                    if (!usage[r.id]) {
                        await loadUsageFor(r.id);
                        if (!alive) break;
                    }
                }
            } finally {
                setUsageLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [rows]); // kör om när listan uppdateras

    // Fritextsök (enkelt: sök i id/label)
    const filtered = React.useMemo(() => {
        const needle = qText.trim().toLowerCase();
        let list = rows.filter((r) =>
            (showInactive ? true : r.active) &&
            (needle
                ? r.id.toLowerCase().includes(needle) ||
                r.label.toLowerCase().includes(needle)
                : true)
        );

        // Sortering
        list = list.slice().sort((a, b) => {
            let av: any;
            let bv: any;
            switch (sortKey) {
                case "label":
                    av = (a.label || "").toLowerCase();
                    bv = (b.label || "").toLowerCase();
                    break;
                case "updatedAt": {
                    const at = (typeof a.updatedAt?.toMillis === "function")
                        ? a.updatedAt.toMillis()
                        : (a.updatedAt?.seconds ? a.updatedAt.seconds * 1000 : (a.updatedAt ? Date.parse(a.updatedAt) : 0));
                    const bt = (typeof b.updatedAt?.toMillis === "function")
                        ? b.updatedAt.toMillis()
                        : (b.updatedAt?.seconds ? b.updatedAt.seconds * 1000 : (b.updatedAt ? Date.parse(b.updatedAt) : 0));
                    av = at || 0;
                    bv = bt || 0;
                    break;
                }
                case "active":
                    av = a.active ? 1 : 0;
                    bv = b.active ? 1 : 0;
                    break;
                default:
                    av = a.label || "";
                    bv = b.label || "";
            }
            if (av < bv) return sortAsc ? -1 : 1;
            if (av > bv) return sortAsc ? 1 : -1;
            return 0;
        });

        return list;
    }, [rows, qText, showInactive, sortKey, sortAsc]);

    const toggleSort = (key: SortKey) => {
        if (key === sortKey) {
            setSortAsc((s) => !s);
        } else {
            setSortKey(key);
            setSortAsc(true);
        }
    };

    // Acceptera både ProductTypeDoc och string-id
    async function loadUsageFor(rowOrId: ProductTypeDoc | string) {
        try {
            setUsageLoading(true);

            const id = typeof rowOrId === "string" ? rowOrId : rowOrId.id;
            const itRef = collection(db, "itInventory");

            // Total
            const qTotal = query(itRef, where("productTypeId", "==", id));
            const totalSnap = await getCountFromServer(qTotal);
            const total = totalSnap.data().count || 0;

            // Fakturerade (kräver index: productTypeId + invoiceReportId)
            const qInvoiced = query(
                itRef,
                where("productTypeId", "==", id),
                where("invoiceReportId", "!=", null),
                orderBy("invoiceReportId")
            );
            const invSnap = await getCountFromServer(qInvoiced);
            const invoiced = invSnap.data().count || 0;

            setUsage(prev => ({ ...prev, [id]: { total, invoiced } }));
        } catch (e) {
            console.error("loadUsageFor failed", e);
        } finally {
            setUsageLoading(false);
        }
    }



    const handleCreate = async () => {
        try {
            setCreateError(null);

            const id = toSlugId(createId || createLabel);
            const label = (createLabel || "").trim();

            if (!label) {
                setCreateError("Label krävs.");
                return;
            }
            if (!id) {
                setCreateError("ID (slug) kan inte vara tomt.");
                return;
            }

            setCreating(true);

            // Kolla om finns
            const ref = doc(db, "productTypes", id);
            const snap = await getDoc(ref);
            if (snap.exists()) {
                setCreateError(`ID '${id}' finns redan.`);
                setCreating(false);
                return;
            }

            const by = await currentUserEmail();

            // Skapa med defaultfält enligt P0
            await setDoc(ref, {
                label,
                medianWeightKg: 0,
                co2PerUnitKg: 0,
                schemaVersion: 1,
                active: true,
                updatedAt: serverTimestamp(),
                updatedBy: by ?? null,
            });

            // Rensa och stäng panel
            setCreateOpen(false);
            setCreateId("");
            setCreateLabel("");
            idManuallyEditedRef.current = false;
        } catch (e: any) {
            console.error(e);
            setCreateError(e?.message || "Kunde inte skapa typen.");
        } finally {
            setCreating(false);
        }
    };


    return (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
            <h1 className="gw-h1" style={{ marginBottom: 12 }}>Produkttyper (Admin)</h1>

            {error && (
                <div className="gw-banner gw-banner--danger">
                    <strong>Fel:</strong>&nbsp;{error}
                </div>
            )}

            {loading && (
                <div className="gw-banner">
                    Laddar produkttyper…
                </div>
            )}

            {/* Filterrad */}
            <div className="gw-card" style={{ padding: 12, marginBottom: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8 }}>
                    <input
                        className="gw-input"
                        placeholder="Sök på ID eller Label…"
                        value={qText}
                        onChange={(e) => setQText(e.target.value)}
                    />
                    <label className="gw-check-inline" style={{ alignSelf: "center" }}>
                        <input
                            type="checkbox"
                            checked={showInactive}
                            onChange={(e) => setShowInactive(e.target.checked)}
                        />
                        <span>Visa inaktiva</span>
                    </label>

                    {/* Skapa ny tar vi i nästa mikrosteg */}
                    <button
                        className="btn btn-primary"
                        onClick={() => {
                            setCreateOpen((v) => !v);
                            setCreateError(null);
                            if (!createOpen) {
                                // öppnas → förifyll ID från label
                                idManuallyEditedRef.current = false;
                                setCreateId(toSlugId(createLabel));
                            }
                        }}
                    >
                        {createOpen ? "Stäng" : "+ Skapa ny"}
                    </button>
                </div>
            </div>

            {createOpen && (
                <div className="gw-card" style={{ padding: 16, marginBottom: 12 }}>
                    <h3 className="gw-h3" style={{ marginBottom: 8 }}>Skapa ny produkttyp</h3>
                    {createError && (
                        <div className="gw-banner gw-banner--danger" style={{ marginBottom: 8 }}>
                            <strong>Fel:</strong>&nbsp;{createError}
                        </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 8 }}>
                        <div>
                            <label className="gw-form-label">ID (slug, lowercase)</label>
                            <input
                                className="gw-input"
                                placeholder="t.ex. laptop, monitor, desktop"
                                value={createId}
                                onChange={(e) => onEditIdManually(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="gw-form-label">Label (visningsnamn)</label>
                            <input
                                className="gw-input"
                                placeholder="t.ex. Laptop, Skärm, Stationär dator"
                                value={createLabel}
                                onChange={(e) => setCreateLabel(e.target.value)}
                            />
                        </div>
                        <div style={{ alignSelf: "end", display: "flex", gap: 8 }}>
                            <button
                                className="btn"
                                onClick={() => {
                                    setCreateOpen(false);
                                    setCreateError(null);
                                }}
                                type="button"
                            >
                                Avbryt
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleCreate}
                                disabled={creating || !createLabel.trim() || !toSlugId(createId || createLabel)}
                                type="button"
                            >
                                {creating ? "Skapar…" : "Skapa"}
                            </button>
                        </div>
                    </div>
                    <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 13 }}>
                        Skapas med <code>medianWeightKg=0</code>, <code>co2PerUnitKg=0</code>, <code>schemaVersion=1</code>, <code>active=true</code>.
                        Faktorvärden justeras senare i Admin (P0a→P0d).
                    </div>
                </div>
            )}


            {/* Tabell */}
            <div className="gw-card" style={{ padding: 0 }}>
                <div className="gw-table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th style={{ whiteSpace: "nowrap" }}>ID (slug)</th>
                                <th>
                                    <button
                                        className="btn"
                                        onClick={() => toggleSort("label")}
                                        style={{ padding: "6px 10px" }}
                                        title="Sortera på Label"
                                    >
                                        Label {sortKey === "label" ? (sortAsc ? "▲" : "▼") : ""}
                                    </button>
                                </th>
                                <th style={{ whiteSpace: "nowrap" }}>Vikt (kg)</th>
                                <th style={{ whiteSpace: "nowrap" }}>CO₂/enhet (kg)</th>
                                <th style={{ whiteSpace: "nowrap" }}>Version</th>
                                <th>
                                    <button
                                        className="btn"
                                        onClick={() => toggleSort("active")}
                                        style={{ padding: "6px 10px" }}
                                        title="Sortera på Active"
                                    >
                                        Active {sortKey === "active" ? (sortAsc ? "▲" : "▼") : ""}
                                    </button>
                                </th>
                                <th>
                                    <button
                                        className="btn"
                                        onClick={() => toggleSort("updatedAt")}
                                        style={{ padding: "6px 10px" }}
                                        title="Sortera på Uppdaterad"
                                    >
                                        UpdatedAt/By {sortKey === "updatedAt" ? (sortAsc ? "▲" : "▼") : ""}
                                    </button>
                                </th>
                                {/* P1a: Används av (ej fakturerade / fakturerade) */}
                                <th style={{ whiteSpace: "nowrap" }}>Används av (ej fakturerade / fakturerade)</th>
                                {/* P1: Åtgärder (edit/soft-delete/hard-delete) */}
                                <th style={{ whiteSpace: "nowrap" }}>Åtgärder</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={9} style={{ padding: 16, color: "var(--muted)" }}>
                                        Inga resultat.
                                    </td>
                                </tr>
                            ) : (
                                filtered.map((r) => (
                                    <tr key={r.id} className={r.active ? "" : "row-invoiced"}>
                                        <td className="td-narrow" title={r.id}><code>{r.id}</code></td>
                                        <td>{r.label || <span style={{ color: "var(--muted)" }}>(saknas)</span>}</td>
                                        <td className="td-narrow">{Number(r.medianWeightKg || 0).toFixed(2)}</td>
                                        <td className="td-narrow">{Number(r.co2PerUnitKg || 0).toFixed(2)}</td>
                                        <td className="td-narrow">{r.schemaVersion ?? 1}</td>
                                        <td className="td-narrow">
                                            {r.active ? <span className="badge">true</span> : <span className="badge">false</span>}
                                        </td>
                                        <td title={r.updatedBy || ""}>
                                            {fmtDate(r.updatedAt)}{r.updatedBy ? ` · ${r.updatedBy}` : ""}
                                        </td>
                                        {/* Användningsräknare */}
                                        <td
                                            className="td-narrow"
                                            title={
                                                usage[r.id]
                                                    ? `Totalt: ${usage[r.id].total} • Fakturerade: ${usage[r.id].invoiced}`
                                                    : ""
                                            }
                                        >
                                            {usage[r.id]
                                                ? `${Math.max(usage[r.id].total - usage[r.id].invoiced, 0)}/${usage[r.id].invoiced}`
                                                : (usageLoading ? "—" : "—")}
                                        </td>
                                        {/* Actions */}
                                        <td className="td-narrow">
                                            <div style={{ display: "flex", gap: 6 }}>
                                                <button
                                                    className="btn btn-secondary"
                                                    onClick={() => openEdit(r)}
                                                    type="button"
                                                >
                                                    Ändra
                                                </button>
                                                <button
                                                    className="btn"
                                                    onClick={() => handleToggleActive(r)}
                                                    type="button"
                                                    title={r.active ? "Inaktivera" : "Aktivera"}
                                                >
                                                    {r.active ? "Inaktivera" : "Aktivera"}
                                                </button>
                                                <button
                                                    className="btn btn-danger"
                                                    onClick={() => handleHardDelete(r)}
                                                    type="button"
                                                    title="Permanent borttagning (kräver 0/0 användning)"
                                                >
                                                    Hard delete
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ADMIN: Edit-modal */}
            {editOpen && (
                <div className="gw-modal-overlay" role="dialog" aria-modal="true">
                    <div className="gw-modal-card" style={{ width: "min(720px, 95vw)" }}>
                        <div style={{ padding: 16, borderBottom: "1px solid var(--border)" }}>
                            <h2 className="gw-modal-title">Ändra produkttyp</h2>
                        </div>

                        <div style={{ padding: 16, overflow: "auto" }}>
                            {editError && (
                                <div className="gw-banner gw-banner--danger" style={{ marginBottom: 8 }}>
                                    <strong>Fel:</strong>&nbsp;{editError}
                                </div>
                            )}

                            <div className="gw-form-grid-3" style={{ gap: 10 }}>
                                <div>
                                    <label className="gw-form-label">ID (slug)</label>
                                    <input className="gw-input" value={editId} disabled />
                                </div>
                                <div style={{ gridColumn: "span 2" }}>
                                    <label className="gw-form-label">Label</label>
                                    <input
                                        className="gw-input"
                                        value={editLabel}
                                        onChange={(e) => setEditLabel(e.target.value)}
                                    />
                                </div>

                                <div>
                                    <label className="gw-form-label">Vikt (kg)</label>
                                    <input
                                        className="gw-input"
                                        type="number"
                                        inputMode="decimal"
                                        step="0.01"
                                        min="0"
                                        value={editWeight}
                                        onChange={(e) => setEditWeight(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="gw-form-label">CO₂/enhet (kg)</label>
                                    <input
                                        className="gw-input"
                                        type="number"
                                        inputMode="decimal"
                                        step="0.01"
                                        min="0"
                                        value={editCO2}
                                        onChange={(e) => setEditCO2(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="gw-form-label">Schema version</label>
                                    <input className="gw-input" value={editSchemaVersion} disabled />
                                </div>

                                <div style={{ gridColumn: "1 / -1", display: "flex", gap: 16, alignItems: "center" }}>
                                    <label className="gw-check-inline">
                                        <input
                                            type="checkbox"
                                            checked={editActive}
                                            onChange={(e) => setEditActive(e.target.checked)}
                                        />
                                        <span>Active</span>
                                    </label>

                                    <label className="gw-check-inline" title="Krävs om du ändrar vikt/CO₂">
                                        <input
                                            type="checkbox"
                                            checked={bumpVersion}
                                            onChange={(e) => setBumpVersion(e.target.checked)}
                                        />
                                        <span>Bump version</span>
                                    </label>
                                </div>
                            </div>

                            <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 13 }}>
                                Obs: Om du ändrar <b>Vikt</b> eller <b>CO₂/enhet</b> måste du kryssa i <b>Bump version</b>.
                            </div>
                        </div>

                        <div className="gw-modal-actions" style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
                            <button className="btn" onClick={() => setEditOpen(false)} disabled={savingEdit}>
                                Avbryt
                            </button>
                            <button className="btn btn-primary" onClick={handleUpdate} disabled={savingEdit}>
                                {savingEdit ? "Sparar…" : "Spara"}
                            </button>
                        </div>
                    </div>
                </div>
            )}


        </div>
    );
}
