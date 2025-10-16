// src/pages/UserAdmin.tsx
import React, { useEffect, useState } from "react";
import { collection, getDocs, getDoc, doc } from "firebase/firestore";
import { httpsCallable, getFunctions } from "firebase/functions";
import { db } from "../firebase";

/**
 * Bindningar till Cloud Functions
 * (namnen här ska matcha dina deployade CF-funktionsnamn)
 */
const functions = getFunctions(undefined, "europe-west1");
const fnListUsers = httpsCallable<any, any>(functions, "listUsers");
const fnDeleteUser = httpsCallable<any, any>(functions, "deleteUser");
const fnTriggerReset = httpsCallable<any, any>(functions, "triggerPasswordReset");
const setUserClaims = httpsCallable<any, any>(functions, "setUserClaims");

export default function UsersAdmin() {
    type AdminUserRow = {
        uid: string;
        email?: string;
        displayName?: string;
        disabled: boolean;
        role: "admin" | "user";
        emailVerified: boolean;
        createdAt?: string;
        lastLoginAt?: string;
    };

    type CustomerOpt = { key: string; name: string };

    const [rows, setRows] = useState<AdminUserRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    const [customers, setCustomers] = useState<CustomerOpt[]>([]);
    const [saving, setSaving] = useState(false);

    // Redigeringspanelens state
    const [edit, setEdit] = useState<{
        uid: string;
        email?: string;
        role: "admin" | "user" | "customer";
        status: "pending" | "active" | "disabled";
        customerKeys: string[];
    } | null>(null);

    // ---- Ladda användare + kunder ----
    const load = async () => {
        setLoading(true);
        try {
            const res: any = await fnListUsers({});
            setRows((res?.data?.users as AdminUserRow[]) || []);
            setMsg(null);
        } catch (e: any) {
            setMsg(e?.message || "Kunde inte hämta användare.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
        void loadCustomers();
    }, []);

    async function loadCustomers() {
        try {
            const snap = await getDocs(collection(db, "customers"));
            const opts: { key: string; name: string }[] = snap.docs
                .map((d) => {
                    const data = d.data() as any;
                    const name = (data?.name || d.id) as string;
                    // VIKTIGT: använd "name" som key eftersom itInventory.customer verkar vara sparad som namn
                    const keyForItems = name;
                    return { key: keyForItems, name };
                })
                .sort((a, b) => a.name.localeCompare(b.name, "sv"));
            setCustomers(opts);
        } catch (e) {
            console.warn("Kunde inte ladda customers:", e);
        }
    }

    // Alias så att din befintliga kod som refererar till customerListOpts fungerar rakt av.
    const customerListOpts = customers;

    // --- Helper: mappa ev. namn → IDs med hjälp av customerListOpts
    function toIdKeys(keys: unknown, opts: Array<{ key: string; name: string }>): string[] {
        const src = Array.isArray(keys) ? keys.map(String) : [];
        const byName = new Map(opts.map(o => [o.name.toLowerCase(), o.key]));
        const idSet = new Set(opts.map(o => o.key));
        return src.map(k => {
            const kk = k.trim();
            if (idSet.has(kk)) return kk;                         // redan ett ID
            const asId = byName.get(kk.toLowerCase());            // matcha på namn → id
            return asId ?? kk;                                     // fallback: lämna orört
        });
    }

    // ---- Åtgärder ----
    const doDelete = async (uid: string) => {
        if (!confirm("Radera användare permanent?")) return;
        await fnDeleteUser({ uid });
        await load();
    };

    const sendReset = async (email: string) => {
        const res: any = await fnTriggerReset({ email });
        const link = res.data.resetLink as string;
        setMsg(`Reset-länk genererad: ${link}`);
    };

    // Öppna redigeringspanel; läs users/<uid> och förkryssa nuvarande kunder (alltid som IDs)
    async function openEdit(u: AdminUserRow) {
        let role: "admin" | "user" | "customer" = u.role;
        let status: "pending" | "active" | "disabled" = (u as any).status ?? "active";

        // 1) Hämta rå-keys från users/<uid> (kan vara id/ids/customers/customerKeys)
        let rawKeys: string[] = [];
        try {
            const snap = await getDoc(doc(db, "users", u.uid));
            if (snap.exists()) {
                const d = snap.data() as any;
                role = d.role ?? role;
                status = d.status ?? status;

                if (Array.isArray(d.customerKeys)) rawKeys = d.customerKeys.map(String);
                else if (Array.isArray(d.customerIds)) rawKeys = d.customerIds.map(String);
                else if (d.customers && typeof d.customers === "object") {
                    rawKeys = Object.keys(d.customers).filter((k) => !!d.customers[k]).map(String);
                }
            }
        } catch {
            /* ignorera läsfel – vi faller tillbaka nedan */
        }

        // 2) Fallback från tabellraden om users/<uid> saknar info
        if (rawKeys.length === 0) {
            const row: any = u;
            if (Array.isArray(row.customerKeys)) rawKeys = row.customerKeys.map(String);
            else if (Array.isArray(row.customerIds)) rawKeys = row.customerIds.map(String);
            else if (row.customers && typeof row.customers === "object") {
                rawKeys = Object.keys(row.customers).filter((k) => !!row.customers[k]).map(String);
            }
        }

        // 3) Normalisera till customers/{id} med hjälp av customerListOpts (ID + name)
        const toIdKeys = (keys: string[], opts: Array<{ key: string; name: string }>): string[] => {
            const byName = new Map(opts.map(o => [o.name.toLowerCase(), o.key]));
            const idSet = new Set(opts.map(o => o.key));
            return Array.from(new Set(keys.map(k => {
                const kk = String(k).trim();
                if (idSet.has(kk)) return kk;                          // redan ett ID
                const asId = byName.get(kk.toLowerCase());             // namn → id
                return asId ?? kk;                                      // fallback: lämna orört
            })));
        };

        const idKeys = toIdKeys(rawKeys, customerListOpts);

        // 4) Sätt edit-state (alltid IDs i customerKeys)
        setEdit({
            uid: u.uid,
            email: u.email || "",
            role,
            status,
            customerKeys: idKeys, // ✅ IDs
        } as any);
    }

    // --- Toggle-funktion: håll alltid IDs i edit.customerKeys ---
    const toggleCustomerKey = (id: string) => {
        setEdit((p) => {
            if (!p) return p;
            const has = Array.isArray(p.customerKeys) && p.customerKeys.includes(id);
            return {
                ...p,
                customerKeys: has
                    ? p.customerKeys.filter((k: string) => k !== id)
                    : [...(p.customerKeys || []), id],
            };
        });
    };

    async function onSaveClaims() {
        if (!edit) return;
        if (edit.role === "customer" && (!Array.isArray(edit.customerKeys) || edit.customerKeys.length === 0)) {
            alert("Välj minst en kund för kundroll.");
            return;
        }
        setSaving(true);
        try {
            // Normalisera till IDs med hjälp av customerListOpts
            const byName = new Map(customerListOpts.map(o => [o.name.toLowerCase(), o.key]));
            const idSet = new Set(customerListOpts.map(o => o.key));
            const idKeys = (Array.isArray(edit.customerKeys) ? edit.customerKeys : [])
                .map(String)
                .map(k => {
                    const kk = k.trim();
                    if (idSet.has(kk)) return kk;                 // redan ID
                    const asId = byName.get(kk.toLowerCase());    // namn → id
                    return asId ?? kk;                             // fallback
                });

            await setUserClaims({
                uid: edit.uid,
                role: edit.role,
                status: edit.status,
                customerKeys: edit.role === "customer" ? idKeys : undefined,
            });

            setEdit(null);
            await load();
            alert("Behörighet uppdaterad. Be användaren logga in igen.");
        } catch (e: any) {
            console.error(e);
            alert("Kunde inte spara: " + (e?.message || String(e)));
        } finally {
            setSaving(false);
        }
    }

    return (
        <div style={{ padding: 16 }}>
            <h2>Användare</h2>

            {msg && (
                <div
                    style={{
                        background: "#f1f5ff",
                        border: "1px solid #dbe4ff",
                        padding: 10,
                        borderRadius: 8,
                        marginBottom: 12,
                    }}
                >
                    {msg}
                </div>
            )}

            {loading ? (
                <div>Laddar…</div>
            ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Namn</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>E-post</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Verifierad</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Roll</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Senast inloggad</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Åtgärder</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((u) => (
                            <tr key={u.uid}>
                                <td style={{ padding: 8 }}>{u.displayName || "-"}</td>
                                <td style={{ padding: 8 }}>{u.email}</td>
                                <td style={{ padding: 8 }}>{u.emailVerified ? "Ja" : "Nej"}</td>
                                <td style={{ padding: 8 }}>{u.role}</td>
                                <td style={{ padding: 8 }}>{u.lastLoginAt || "-"}</td>
                                <td style={{ padding: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    <div className="gw-section-actions">
                                        <button
                                            type="button"
                                            className="btn btn-primary"
                                            onClick={() => sendReset(u.email!)}
                                        >
                                            Skicka reset-länk
                                        </button>

                                        <button
                                            type="button"
                                            className="btn"
                                            onClick={() => openEdit(u)}
                                        >
                                            Ändra behörighet
                                        </button>

                                        <button
                                            type="button"
                                            className="btn btn-danger"
                                            onClick={() => doDelete(u.uid)}
                                        >
                                            Radera
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={6} style={{ padding: 12, color: "#6b7280" }}>
                                    Inga användare hittades.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            )}

            <div style={{ marginTop: 12 }}>
                <button onClick={load}>Uppdatera</button>
            </div>

            {/* Redigeringspanel */}
            {edit && (
                <div className="gw-card" style={{ marginTop: 16 }}>
                    {/* Header */}
                    <div className="gw-section-header" style={{ marginBottom: 8 }}>
                        <div>
                            <div className="gw-h3" style={{ margin: 0 }}>Redigera behörighet</div>
                            <div className="text-muted">{edit.email || edit.uid}</div>
                        </div>
                        <div className="gw-section-actions">
                            <button
                                type="button"
                                className="btn"
                                onClick={() => setEdit(null)}
                                disabled={saving}
                            >
                                Avbryt
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={onSaveClaims}
                                disabled={saving}
                            >
                                {saving ? "Sparar…" : "Spara behörighet"}
                            </button>
                        </div>
                    </div>

                    {/* Roll & Status */}
                    <div className="gw-form-grid-2">
                        <div>
                            <label className="gw-form-label">Roll</label>
                            <select
                                className="gw-input"
                                value={edit.role}
                                onChange={(e) =>
                                    setEdit((p) => (p ? { ...p, role: e.target.value as "admin" | "user" | "customer" } : p))
                                }
                            >
                                <option value="admin">admin</option>
                                <option value="user">user</option>
                                <option value="customer">customer</option>
                            </select>
                        </div>

                        <div>
                            <label className="gw-form-label">Status</label>
                            <select
                                className="gw-input"
                                value={(edit as any).status || "active"}
                                onChange={(e) =>
                                    setEdit((p) => (p ? { ...p, status: e.target.value as "active" | "disabled" } : p))
                                }
                            >
                                <option value="active">active</option>
                                <option value="disabled">disabled</option>
                            </select>
                        </div>
                    </div>

                    {/* Kunder (visas bara om roll = customer) */}
                    {edit?.role === "customer" && (
                        <div className="gw-section" style={{ marginTop: 12 }}>
                            <div className="gw-form-label">Kunder (välj en eller flera)</div>
                            <div style={{ display: "grid", gap: 8 }}>
                                {customerListOpts.map((opt) => {
                                    const id = String(opt.key);     // ✅ customers/{doc.id}
                                    const name = String(opt.name);  // visningsnamn

                                    const checked =
                                        Array.isArray(edit?.customerKeys) && edit!.customerKeys.includes(id);

                                    return (
                                        <label key={id} className="gw-check-inline">
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleCustomerKey(id)}  // ✅ toggla på ID
                                            />
                                            <span>
                                                {name} <span className="text-muted">({id})</span>
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="text-muted" style={{ marginTop: 12 }}>
                        Sparandet uppdaterar claims + spegeln <code>users/&lt;uid&gt;</code>. Användaren kan
                        behöva logga in igen.
                    </div>
                </div>
            )}
        </div>
    );
}

export { };
