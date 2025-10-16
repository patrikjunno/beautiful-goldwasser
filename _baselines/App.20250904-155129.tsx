const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const LOCK_STALE_MINUTES = 0.1;
const LOCK_STALE_MS = LOCK_STALE_MINUTES * 60 * 1000;
const QA_DISABLE_LOCK_WATCHER = false; // ← TILLFÄLLIGT för test
const LOCK_HEARTBEAT_MS = Math.max(5000, Math.min(60000, Math.floor(LOCK_STALE_MS / 2)));
import ThemeToggle from "./ThemeToggle";
import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { onSnapshot, Unsubscribe } from "firebase/firestore";
import type { WithFieldValue } from "firebase/firestore";

import { listAll } from "firebase/storage";

import type {
  Timestamp,
  UpdateData,
  QueryDocumentSnapshot,
  DocumentData,
} from "firebase/firestore";

import {
  collection,
  collectionGroup,
  addDoc,
  query,
  getDocs,
  getDoc,
  deleteDoc,
  doc,
  updateDoc,
  where,
  arrayUnion,
  runTransaction,
  serverTimestamp,
  deleteField,
  startAfter,
  orderBy,
  limit,

} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  ref as storageRef,
} from "firebase/storage";
import { db, storage, auth } from "./firebase";
import { uploadBytesResumable } from "firebase/storage";


import {
  onAuthStateChanged,
  getIdTokenResult,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
} from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import "./styles.css";
import { getAuth } from "firebase/auth";

type PhotoKey = "keyboard" | "screen" | "underside" | "topside";

// ===== Shared layout & button styles used by the wizard/table =====
const STEP_INDICATOR_WRAP: React.CSSProperties = { marginBottom: 16, textAlign: "center" };
const DOTS: React.CSSProperties = { display: "flex", justifyContent: "center", gap: 6 };
const DOT = (active: boolean): React.CSSProperties => ({
  width: 10,
  height: 10,
  borderRadius: 9999,
  background: active ? "#0b5cff" : "#d0d7e2",
});

const NAV_BAR: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 16,
  justifyContent: "space-between",
};

const BTN: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "#f8f8f8",
  cursor: "pointer",
};

const BTN_PRIMARY: React.CSSProperties = {
  ...BTN,
  background: "#0b5cff",
  color: "#fff",
  borderColor: "#0b5cff",
};

const TABLE_STYLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: 10,
  tableLayout: "fixed",
};

// === EditModal theme (teal / modern, LIGHT) ===
// Add once, near the top of App.tsx, below imports.
// === Modern, konsekvent styling för EditModal (prefix EM_) — TEAL THEME ===
const EM_TOKENS = {
  radius: 12,
  border: "#a7e0e5",
  surface: "#cfeff1",      // panel
  subtle: "#d9f3f5",       // header/footer
  inputBg: "#ffffff",
  inputBorder: "#9bd6db",
  inputFocus: "#55c0c9",   // <— NY: används som border-color vid focus
  text: "#0c2a33",
  muted: "#134863",
  primary: "#0ea5a6",
  primaryHover: "#0b8c92",
  danger: "#ef4444",
  overlay: "rgba(8, 24, 32, .35)",
  shadow: "0 14px 32px rgba(6, 94, 103, .18)",
};

const EM_OVERLAY: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: EM_TOKENS.overlay,
  display: "grid",
  placeItems: "center",
  zIndex: 9999,
  padding: 16,
};

const EM_PANEL: React.CSSProperties = {
  width: "min(920px, 96vw)",
  background: EM_TOKENS.surface,
  border: `1px solid ${EM_TOKENS.border}`,
  borderRadius: 16,
  boxShadow: EM_TOKENS.shadow,
  overflow: "hidden",
};

const EM_HEADER: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px 20px",
  background: EM_TOKENS.subtle,
  borderBottom: `1px solid ${EM_TOKENS.border}`,
};

const EM_TITLE: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 800,
  color: EM_TOKENS.text,
};

const EM_BODY: React.CSSProperties = { padding: 20, background: EM_TOKENS.surface };

const EM_GRID: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 };
const EM_FIELD: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const EM_LABEL: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: EM_TOKENS.muted };

const EM_INPUT_BASE: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: `1px solid ${EM_TOKENS.inputBorder}`,
  background: EM_TOKENS.inputBg,
  outline: "none",
  boxShadow: "0 1px 0 rgba(255,255,255,.45) inset",
};

const EM_SELECT = EM_INPUT_BASE;
const EM_INPUT = EM_INPUT_BASE;
const EM_TEXTAREA: React.CSSProperties = { ...EM_INPUT_BASE, minHeight: 110, resize: "vertical" };

const EM_CHECK_INLINE: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8 };
const EM_ROW_FULL: React.CSSProperties = { gridColumn: "1 / -1" };

// mörk logg med rundade hörn (yttre wrapper ger rundningen)
const EM_LOG: React.CSSProperties = {
  background: "#0b1f29",
  color: "#d8eef2",
  border: `1px solid ${EM_TOKENS.border}`,
  borderRadius: 12,
  padding: 0, // vi lägger padding på innerboxen som scrollar
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
  fontSize: 13,
};

const EM_FOOTER: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  justifyContent: "flex-end",
  padding: 16,
  background: EM_TOKENS.subtle,
  borderTop: `1px solid ${EM_TOKENS.border}`,
};

const EM_BTN_BASE: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: `1px solid ${EM_TOKENS.border}`,
  background: "#eaf7f8",
  color: EM_TOKENS.text,
  cursor: "pointer",
};

const EM_BTN_GHOST = EM_BTN_BASE;
const EM_BTN_PRIMARY: React.CSSProperties = { ...EM_BTN_BASE, background: EM_TOKENS.primary, color: "#fff", border: "none" };
const EM_BTN_DANGER: React.CSSProperties = { ...EM_BTN_BASE, background: EM_TOKENS.danger, color: "#fff", border: "none" };








/* =========================
   Typer
========================= */

type ThumbnailMap = Partial<Record<PhotoKey, string | null>>;
type PhotoURLMap = Record<string, string>;

type FirestoreDate = string | Date | Timestamp | null | undefined;


type InvoiceReport = {
  name: string;                 // "Kund YYMMDDHHMM"
  customer: string;             // exakt en kund per rapport (krav)
  createdAt: string;            // ISO
  createdBy: string | null;     // e-post/uid om du har
  itemIds: string[];            // markerade objekt som låses vid fakturering
  summary: InvoiceSummary;      // summering högst upp i rapporten
};

const REPORTS_COLLECTION = "reports";
const INVOICE_SUBCOLLECTION = "fakturor";


type AuditAction = "created" | "updated" | "completed" | "reopened" | "delete_marked" | "delete_unmarked";
interface AuditEntry {
  action: AuditAction;
  by: string | null;
  at: string; // ISO
}

// ---- Fakturering: härledda kolumner (1/0) från reuse/resold/scrap ----
type BillingSteps = {
  f3Procedure: number;
  endpointRemoval: number;
  osReinstall: number;
  endpointWipe: number;
  postWipeBootTest: number;
  dataErasure: number;
  refurbish: number;
};

/** Normalisera serienummer för indexnyckel (race-säker unikhet per nummer) */
function normalizeSerial(s: unknown): string {
  return String(s ?? "").trim().toUpperCase();
}

/** Bygg visningssträng:  ABC123  eller  ABC123*2 */
function buildDisplaySerial(rawSerial: string, visit: number): string {
  return visit > 1 ? `${rawSerial}*${visit}` : rawSerial;
}

/** Plocka ut bas + ev. *visit ur en sträng som "ABC123*3" */
function splitSerialParts(s: string) {
  const [raw, suffix] = String(s || "").split("*");
  const base = (raw || "").trim();
  const visit = Math.max(1, Number.parseInt(suffix || "", 10) || 1);
  return { base, visit };
}

function computeBillingSteps(opts: { reuse?: boolean; resold?: boolean; scrap?: boolean }): BillingSteps {
  const { reuse, resold, scrap } = opts;

  if (reuse) {
    // Återbruk
    return {
      f3Procedure: 0,
      endpointRemoval: 1,
      osReinstall: 1,
      endpointWipe: 0,
      postWipeBootTest: 0,
      dataErasure: 0,
      refurbish: 1,
    };
  }
  if (resold) {
    // Vidaresålt
    return {
      f3Procedure: 0,
      endpointRemoval: 1,
      osReinstall: 0,
      endpointWipe: 1,
      postWipeBootTest: 0,
      dataErasure: 1,
      refurbish: 1,
    };
  }
  if (scrap) {
    // Skrot
    return {
      f3Procedure: 0,
      endpointRemoval: 1,
      osReinstall: 0,
      endpointWipe: 1,
      postWipeBootTest: 0,
      dataErasure: 1,
      refurbish: 0,
    };
  }

  // Inget valt ännu → allt 0
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

// ===== Fakturering: skapa rapport från markerade poster =====
async function generateInvoiceReportForMarkedItems(
  allCompletedItems: Item[],
  currentUserEmail: string | null
): Promise<{ reportId: string; name: string; count: number; customer: string }> {
  // 1) Filtrera markerade och inte redan fakturerade
  const marked = allCompletedItems.filter(
    (it) => it.completed && it.markedForInvoice && !it.invoiceReportId
  );
  if (marked.length === 0) {
    throw new Error("Inga markerade objekt hittades.");
  }

  // 2) Exakt EN kund
  const customers = Array.from(new Set(marked.map((it) => String(it.customer || ""))));
  if (customers.length !== 1 || !customers[0]) {
    throw new Error("Endast en kund per rapport. Justera dina markeringar.");
  }
  const customer = customers[0];

  // 3) Namn: "Kund YYMMDDHHMM"
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const name = `${customer} ${String(now.getFullYear()).slice(2)}${pad(
    now.getMonth() + 1
  )}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;

  // 4) Summering
  const summary = buildInvoiceSummary(marked);

  // 5) Skriv rapporten
  // Firestore kräver ett dokument mellan samlingar → vi använder "reports/root/fakturor"
  const reportsParent = doc(db, REPORTS_COLLECTION, "root");
  const reportsCol = collection(reportsParent, INVOICE_SUBCOLLECTION);
  const reportRef = await addDoc(reportsCol, {
    name,
    customer,
    createdAt: serverTimestamp(),
    createdBy: currentUserEmail,
    itemIds: marked.map((m) => m.id),
    summary,
  } as WithFieldValue<InvoiceReport>);

  const reportId = reportRef.id;

  // 6) Uppdatera alla berörda items (rensa markering, sätt koppling + tidsstämpel)
  const updates = marked.map((it) =>
    updateDoc(doc(db, "itInventory", it.id), {
      markedForInvoice: false,
      invoiceReportId: reportId,
      invoicedAt: serverTimestamp(),          // <-- EFTER
      // ev. permanent låsning om du har ett särskilt fält för detta
      // permanentlyLocked: true,
    })
  );
  await Promise.all(updates);

  return { reportId, name, count: marked.length, customer };
}

interface BaseItem {
  orderNumber: string;
  manufacturer: string;
  model: string;
  serial: string; // final serial
  serialBase?: string;
  chargerIncluded: boolean;
  damageNotes: string;
  photos: PhotoURLMap;
  customer?: string;
  articleNumber?: string;
  createdAt: FirestoreDate;
  createdBy: string | null;
  auditLog: AuditEntry[];
  completed: boolean;
  completedAt: FirestoreDate;
  completedBy: string | null;
  lockedBy?: string | null;
  lockedAt?: string | null;

  // Statusval vid färdigställning
  reuse?: boolean;
  resold?: boolean;
  scrap?: boolean;

  // 🆕 Gradering A–D
  grade?: 'A' | 'B' | 'C' | 'D' | '';

  // Faktureringsfält
  markedForInvoice?: boolean;
  invoiceReportId?: string | null;
  invoicedAt?: string | null;

  deletePending?: boolean;
  deleteMarkedBy?: string | null;
  deleteMarkedAt?: string | null;


}

interface Item extends BaseItem {
  id: string;
}

interface FormState {
  orderNumber: string;
  manufacturer: string;
  model: string;
  serial: string;
  chargerIncluded: boolean;

  customer: string;
  articleNumber: string;
  damageNotes: string;
  photos: ThumbnailMap; // dataURL för UI:t
  // nya fält
  reuse: boolean;
  resold: boolean;
  scrap: boolean;

}

interface Filters {
  orderNumber: string;
  manufacturer: string;
  model: string;
  serial: string;
  chargerIncluded: string;
  createdAt: string;
  createdBy: string;
}

interface EditFormState extends Omit<BaseItem, "photos"> {
  photos: PhotoURLMap;
}

/* =========================
   Konstanter & små helpers
========================= */
// Dev: visa mina auth-claims i konsolen
; (window as any).showClaims = async () => {
  try {
    if (!auth.currentUser) {
      console.log("Inte inloggad");
      return null;
    }
    const t = await auth.currentUser.getIdTokenResult(true);
    console.log("claims:", t.claims);
    return t.claims;
  } catch (e) {
    console.error(e);
    return null;
  }
};

// Dev: rensa testdata (kräver admin-claim)
; (window as any).wipeAllTestData = async () => {
  try {
    if (!auth.currentUser) {
      alert("Inte inloggad.");
      return;
    }
    type TokenClaims = {
      admin?: boolean;
      role?: string;
      roles?: { admin?: boolean };
    };

    const t = await auth.currentUser.getIdTokenResult(true);
    const claims = (t.claims ?? {}) as TokenClaims;

    const isAdmin =
      claims.admin === true ||
      claims.role === "admin" ||
      claims.roles?.admin === true;

    if (!isAdmin) {
      alert("Du är inte admin enligt dina claims.");
      console.log("claims:", claims);
      return;
    }

    console.log("Rensar testdata…");

    // 1) itInventory (huvudkollektionen)
    {
      const qs = await getDocs(collection(db, "itInventory"));
      let n = 0;
      for (const d of qs.docs) {
        await deleteDoc(d.ref);
        n++;
      }
      console.log(`itInventory: raderade ${n} dokument`);
    }

    // 2) serialIndex (unikhetsindex för serienummer)
    {
      const qs = await getDocs(collection(db, "serialIndex"));
      let n = 0;
      for (const d of qs.docs) {
        await deleteDoc(d.ref);
        n++;
      }
      console.log(`serialIndex: raderade ${n} dokument`);
    }

    // 3) Rapporter: /reports/{root}/fakturor/{reportId}
    //    Använd collectionGroup för att hitta alla "fakturor" oavsett root.
    {
      const cg = await getDocs(collectionGroup(db, "fakturor"));
      let n = 0;
      for (const d of cg.docs) {
        await deleteDoc(d.ref);
        n++;
      }
      console.log(`reports/*/fakturor: raderade ${n} dokument`);
    }

    // 4) Övriga stödkollektioner (om du vill nollställa även dessa)
    for (const col of ["manufacturers", "models", "customers", "articles"]) {
      try {
        const qs = await getDocs(collection(db, col));
        let n = 0;
        for (const d of qs.docs) {
          await deleteDoc(d.ref);
          n++;
        }
        console.log(`${col}: raderade ${n} dokument`);
      } catch (e) {
        console.warn(`Kunde inte rensa ${col}:`, e);
      }
    }

    console.log("✅ Klar. Notera: bilder i Storage rensas inte här.");
  } catch (e: any) {
    console.error("wipeAllTestData: fel:", e);
    alert("Kunde inte rensa: " + (e?.message || e));
  }
};


const toKey = (s: string) => s.trim().toLocaleLowerCase("sv");

async function uploadDataUrlWithProgress(
  dataUrl: string,
  storagePath: string,
  onProgress: (pct: number) => void
): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  if (blob.size > MAX_IMAGE_SIZE) {
    throw new Error("Bilden är för stor efter komprimering.");
  }
  const storageRef = ref(storage, storagePath);
  const task = uploadBytesResumable(storageRef, blob);

  return await new Promise<string>((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        onProgress(pct);
      },
      reject,
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve(url);
      }
    );
  });
}


// Normaliserar serienummer till en nyckel för indexet (skiftläges- och separator-okänslig)
const normalizeSerialKey = (s: string): string =>
  (s || "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.:/\\]/g, ""); // tar bort mellanslag, bindestreck, punkt, kolon, slash, backslash

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

const PHOTO_LABELS: Record<PhotoKey, string> = {
  keyboard: "Keyboard",
  screen: "Screen",
  underside: "Underside",
  topside: "Topside",
};

// Visnings-format: ABC123*3 (oavsett hur det skrevs in)
const formatSerialForDisplay = (serial?: string | null): string => {
  if (!serial) return "—";
  const [base, suffix] = String(serial).split("*");
  const norm = normalizeSerialKey(base); // tar bort mellanslag/tecken + UPPERCASE
  return suffix ? `${norm}*${suffix}` : norm;
};



// Hjälpare: radera ALLA bilder under /photos
async function deleteAllPhotos() {
  const dirRef = ref(storage, "photos");
  try {
    const res = await listAll(dirRef);
    // radera filer i roten /photos
    await Promise.all(res.items.map(itemRef => deleteObject(itemRef)));
    // om du har undermappar i /photos, loopa och radera även där
    for (const prefix of res.prefixes) {
      const sub = await listAll(prefix);
      await Promise.all(sub.items.map(itemRef => deleteObject(itemRef)));
    }
  } catch (e) {
    console.warn("Kunde inte lista/radera alla foton:", e);
  }
}



// Visa endast datum (svensk formatering) från Firestore Timestamp / Date / string
const fmtDateOnly = (
  d: string | Date | Timestamp | null | undefined
): string => {
  if (!d) return "-";

  let dt: Date | null = null;

  if (d instanceof Date) {
    dt = d;
  } else if (typeof d === "string") {
    const t = new Date(d);
    dt = isNaN(t.getTime()) ? null : t;
  } else if (typeof (d as any)?.toDate === "function") {
    // Firestore Timestamp
    dt = (d as any).toDate();
  } else if ((d as any)?.seconds) {
    dt = new Date((d as any).seconds * 1000);
  }

  return dt ? dt.toLocaleDateString("sv-SE") : "-";
};




type InvoiceSummary = {
  totalItems: number;
  reusedCount: number;
  resoldCount: number;
  scrappedCount: number;
};

function buildInvoiceSummary(items: Array<Item>): InvoiceSummary {
  let reused = 0, resold = 0, scrapped = 0;

  for (const it of items) {
    const anyIt = it as any;

    const outcome =
      (typeof anyIt.completedOutcome === "string" && anyIt.completedOutcome.toLowerCase()) || null;

    const isReused =
      anyIt.reuse === true || anyIt.återbruk === true || outcome === "återbruk" || outcome === "reused";
    const isResold =
      anyIt.resold === true || anyIt.vidaressålt === true || outcome === "vidaressålt" || outcome === "resold";
    const isScrapped =
      anyIt.scrap === true || anyIt.skrotad === true || outcome === "skrotad" || outcome === "scrapped";

    if (isReused) reused++;
    if (isResold) resold++;
    if (isScrapped) scrapped++;
  }

  return {
    totalItems: items.length,
    reusedCount: reused,
    resoldCount: resold,
    scrappedCount: scrapped,
  };
}

const fmtDate = (d: FirestoreDate): string => {
  if (!d) return "-";
  if (d instanceof Date) return d.toLocaleString();
  if (typeof d === "string") {
    const t = new Date(d);
    return isNaN(t.getTime()) ? d : t.toLocaleString();
  }
  const ts = d as Timestamp;
  if (typeof ts?.toDate === "function") return ts.toDate().toLocaleString();
  if ((ts as any)?.seconds) return new Date((ts as any).seconds * 1000).toLocaleString();
  return "-";
};

function validateCompletionChoice(f: EditFormState): string | null {
  const choices = [!!f.reuse, !!f.resold, !!f.scrap];
  const count = choices.filter(Boolean).length;
  if (count !== 1) {
    return "Du måste välja exakt ett avslutsval: Återbruk, Vidaresålt eller Skrotad.";
    if (!f.grade) return "Välj gradering (A–D) innan du markerar som färdig.";
  }
  return null;
}

// Konverterar Firestore Timestamp | Date | ISO-string | null → millisekunder (number) eller null
const toMillis = (d: any): number | null => {
  if (!d) return null;

  // Firestore Timestamp (har toDate())
  if (typeof d?.toDate === "function") {
    return d.toDate().getTime();
  }

  // ISO-sträng
  if (typeof d === "string") {
    const t = Date.parse(d);
    return Number.isNaN(t) ? null : t;
  }

  // Date-objekt
  if (d instanceof Date) {
    return d.getTime();
  }

  // Timestamp-liknande { seconds: number }
  if (typeof d?.seconds === "number") {
    return d.seconds * 1000;
  }

  return null;
};

/* =========================
   Delade stilar
========================= */

const PAGE_STYLE: React.CSSProperties = { padding: 20, paddingTop: 64, fontFamily: "Arial" };
const WIZARD_WRAP: React.CSSProperties = { maxWidth: 600, margin: "0 auto" };
const CARD: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #eee",
  borderRadius: 12,
  padding: 16,
  boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
  overflowX: "auto",              // 👈 lägg till denna
  WebkitOverflowScrolling: "touch", // för mjuk scroll på mobil
};
const H1: React.CSSProperties = { marginTop: 0 };
const H3: React.CSSProperties = { marginTop: 0, marginBottom: 12 };
const INPUT_FULL: React.CSSProperties = { width: "100%", padding: 12, boxSizing: "border-box" };
const FIELD_MARGIN: React.CSSProperties = { marginBottom: 16 };


// --- Kompakt tabell för Fakturering ---
const TABLE_COMPACT: React.CSSProperties = {
  display: "inline-table", // krymp till innehållets bredd
  width: "auto",
  borderCollapse: "collapse",
  marginTop: 10,
  tableLayout: "auto",     // låt innehållet styra kolumnbredd
};

const THC: React.CSSProperties = { border: "1px solid #ccc", padding: "4px 6px", whiteSpace: "nowrap" };
const TDC: React.CSSProperties = { border: "1px solid #ccc", padding: "4px 6px", whiteSpace: "nowrap" };

const THC_NARROW: React.CSSProperties = { ...THC, width: "1%" }; // “krymper” naturligt
const TDC_NARROW: React.CSSProperties = { ...TDC, width: "1%" };

const TD_TRUNCATE: React.CSSProperties = {
  border: "1px solid #ccc",
  padding: "4px 6px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: 220, // justera vid behov
};

const TD: React.CSSProperties = { border: "1px solid #ccc", padding: "6px" };

const SERIAL_LINK_BTN: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  margin: 0,
  textDecoration: "underline",
  cursor: "pointer",
};

const EDIT_PANEL_STYLE: React.CSSProperties = {
  background: "#fff",
  padding: 16,
  borderRadius: 8,
  width: "min(960px, 95vw)",
  maxHeight: "90vh",
  overflowY: "auto",
  overflowX: "hidden",
  boxSizing: "border-box",
  minWidth: 0,
};
const EDIT_BACKDROP_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};
const EDIT_GRID: React.CSSProperties = { display: "grid", gap: 10 };
const EDIT_INPUT: React.CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  padding: 8,
};
const BADGE: React.CSSProperties = {
  display: "inline-block",
  fontSize: 12,
  background: "#e5e7eb",
  color: "#111827",
  padding: "2px 8px",
  borderRadius: 999,
};

/* ---- Mobil-specifika stilar för listan ---- */
const MOBILE_CARD: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 12,
  marginBottom: 10,
  background: "#fff",
  boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
};
const MOBILE_ROW: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "110px 1fr",
  alignItems: "baseline",
  columnGap: 10,
  rowGap: 6,
};
const MOBILE_LABEL: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  color: "#6b7280",
};
const MOBILE_TOPBAR: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
};
const MOBILE_FILTERS_WRAP: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 8,
  marginBottom: 12,
};

/* =========================
   EditModal
========================= */
interface EditModalProps {
  isOpen: boolean;
  onClose: () => void;
  manufacturerList: string[];
  editForm: EditFormState;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  onSave: () => Promise<void> | void;

  largeImage: string | null;
  setLargeImage: React.Dispatch<React.SetStateAction<string | null>>;

  onComplete: () => Promise<void>;
  isCompleted: boolean;
  onReopen?: () => void;

  isReadOnly?: boolean;            // true om fakturerad → låst läsläge
  invoiceReportId?: string | null; // rapport-id för länk
  isSaving?: boolean;

  onUnmarkDelete?: () => Promise<void>;

  // 🆕 behövs för att uppdatera photos i formuläret från modalen
  setEditForm: React.Dispatch<React.SetStateAction<EditFormState>>;
  itemId: string | null; // <-- NY
}



// Lägg gärna DIRTY_KEYS utanför komponenten (eller överst i den), men inte efter att funktionen stängts
const DIRTY_KEYS: (keyof EditFormState)[] = [
  "manufacturer", "model", "serial", "orderNumber",
  "chargerIncluded", "damageNotes", "reuse", "resold", "scrap",
  "grade"
];

function EditModal(props: EditModalProps) {
  if (!props.isOpen) return null;        // <— inga hooks i denna
  return <EditModalBody {...props} />;   // rendera kroppen bara när öppen
}

function EditModalBody({
  isOpen,
  onClose,
  manufacturerList,
  editForm,
  onChange,
  onSave,
  largeImage,
  setLargeImage,
  onComplete,
  isCompleted,
  onReopen,
  isReadOnly = false,
  invoiceReportId = null,
  isSaving = false,
  onUnmarkDelete,
  setEditForm,
  itemId,                 // ✅ ingen default här
}: EditModalProps) {




  // Flagga för om en bild-URL laddade OK i varje slot
  const [imgOk, setImgOk] = React.useState<Record<PhotoKey, boolean>>({
    keyboard: true,
    screen: true,
    underside: true,
    topside: true,
  });


  // Enforce exclusivity among Återbruk / Vidaresålt / Skrot checkboxes

  // Vilka fält ska räknas som "dirty" när de ändras
  const DIRTY_KEYS: (keyof EditFormState)[] = [
    "manufacturer", "model", "serial", "orderNumber",
    "chargerIncluded", "damageNotes", "reuse", "resold", "scrap", "grade"
  ];

  // Baseline av formuläret när modalen öppnas (inkl. photos)
  const baselineRef = React.useRef<{ form: Partial<EditFormState>; photos: Record<string, string> }>({
    form: {},
    photos: {}
  });

  // Sätt baseline när modalen öppnas (eller när du byter post)
  React.useEffect(() => {
    if (!isOpen) return;
    const baseForm: Partial<EditFormState> = {};
    for (const k of DIRTY_KEYS) (baseForm as any)[k] = (editForm as any)?.[k];
    baselineRef.current = {
      form: baseForm,
      photos: { ...(editForm?.photos || {}) },
    };
    // nollställ staging (säkerhetsbälte vid reopen)
    setPreviewUrls({});
    setPendingPhotoFiles({});
    setPendingDeletes({});
    setIsDirty(false);

    setImgOk({ keyboard: true, screen: true, underside: true, topside: true });

  }, [isOpen, itemId]); // byt id->ditt faktiska fält för itemId om du har

  async function commitStagedPhotos() {
    if (!itemId) return;

    const adds = Object.entries(pendingPhotoFiles);   // {type -> File}
    const dels = Object.keys(pendingDeletes);         // [type]

    if (adds.length === 0 && dels.length === 0) return;

    const itemRef = doc(db, "itInventory", itemId);

    // ⬇ HÅLL koll på tidigare URL:er för slots vi ändrar
    const prevUrls: Record<string, string | undefined> = {};
    for (const [type] of adds) {
      prevUrls[type] = (editForm?.photos as any)?.[type] as string | undefined;
    }
    for (const type of dels) {
      prevUrls[type] = (editForm?.photos as any)?.[type] as string | undefined;
    }

    // 1) Upload för alla "adds" till stabil path photos/{itemId}/{type}.jpg
    const urlPatch: Record<string, string> = {};
    for (const [type, file] of adds) {
      const blob = file; // (lägg komprimering här senare)
      const path = `photos/${itemId}/${type}.jpg`;
      const sref = storageRef(storage, path);
      await uploadBytes(sref, blob, { contentType: file.type || "image/jpeg" });
      const url = await getDownloadURL(sref);
      urlPatch[type] = url;

      // 🧹 Försök radera EV. tidigare fil om den låg på annan path
      const prevUrl = prevUrls[type];
      if (prevUrl) {
        try {
          const prevPath = decodeURIComponent(new URL(prevUrl).pathname.split("/o/")[1].split("?")[0]);
          if (prevPath && prevPath !== path) {
            await deleteObject(storageRef(storage, prevPath));
          }
        } catch { /* ignore */ }
      }
    }

    // 2) Patcha Firestore (adds + dels)
    const updates: any = { updatedAt: serverTimestamp() };
    for (const [type, url] of Object.entries(urlPatch)) {
      updates[`photos.${type}`] = url;
    }
    for (const type of dels) {
      updates[`photos.${type}`] = deleteField();
    }
    if (Object.keys(updates).length > 1) {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(itemRef);
        if (!snap.exists()) throw new Error("Posten finns inte längre.");
        const cur = snap.data() as any;

        // Permalås: blockera foto-ändringar om fakturerad
        if (cur.invoiceReportId) {
          throw new Error("Posten är fakturerad och kan inte ändras.");
        }
        // Blockera om markerad som färdig (extra skydd; UI gör detta redan)
        if (cur.completed) {
          throw new Error("Posten är markerad som färdig och kan inte ändras.");
        }

        // Respektera färskt lås hos annan (heartbeat/TTL)
        const me = auth.currentUser?.email ?? auth.currentUser?.uid ?? "unknown";
        const heldByOther = !!cur.lockedBy && cur.lockedBy !== me;
        const lockedAtMs = toMillis(cur.lockedAt);
        const isStale = lockedAtMs === null ? true : (Date.now() - lockedAtMs) > LOCK_STALE_MS;
        if (heldByOther && !isStale) {
          throw new Error(`Posten redigeras av ${cur.lockedBy}.`);
        }

        // Patcha fotofält + updatedAt atomiskt
        tx.update(itemRef, updates as any);
      });
    }

    // 3) 🧹 Radera fil(er) i Storage för deletions – utan onödig 404 i konsolen
    for (const type of dels) {
      const prevUrl = prevUrls[type];
      let deletedViaPrev = false;

      if (prevUrl) {
        try {
          const prevPath = decodeURIComponent(
            new URL(prevUrl).pathname.split("/o/")[1].split("?")[0]
          );
          if (prevPath) {
            await deleteObject(storageRef(storage, prevPath));
            deletedViaPrev = true;
          }
        } catch { /* ignorera (404 etc) */ }
      }

      // Om vi saknar prevUrl (ovanligt) – prova stabil path som fallback
      if (!deletedViaPrev) {
        try {
          await deleteObject(storageRef(storage, `photos/${itemId}/${type}.jpg`));
        } catch { /* ignorera */ }
      }
    }

    // 4) Uppdatera UI + städa staging
    setEditForm((prev) => {
      const nextPhotos = { ...(prev.photos || {}) } as Record<string, string>;
      for (const [type, url] of Object.entries(urlPatch)) nextPhotos[type] = url;
      for (const type of dels) delete nextPhotos[type];
      return { ...prev, photos: nextPhotos };
    });

    for (const [type] of adds) {
      const u = previewUrls[type];
      if (u?.startsWith?.("blob:")) { try { URL.revokeObjectURL(u); } catch { } }
    }
    setPreviewUrls({});
    setPendingPhotoFiles({});
    setPendingDeletes({});
  }



  // Exklusivt val för A–D (checkboxar som beter sig som radio)
  const setGrade = (letter: 'A' | 'B' | 'C' | 'D', checked: boolean) => {
    setEditForm((prev) => ({ ...prev, grade: checked ? letter : '' }));
    setIsDirty(true);
  };

  const setCheckbox = (name: 'reuse' | 'resold' | 'scrap', val: boolean) => {
    const fakeEvent = { target: { name, type: 'checkbox', checked: val } } as any;
    onChange(fakeEvent);
  };

  const isDeletePending = !!editForm.deletePending;
  const fieldsDisabled = isReadOnly || isCompleted || isDeletePending;
  const readOnlyStyle: React.CSSProperties = fieldsDisabled
    ? { background: "#f9fafb", cursor: "not-allowed" }
    : {};
  const exactlyOneSelected =
    Number(!!editForm.reuse) + Number(!!editForm.resold) + Number(!!editForm.scrap) === 1;

  const formComplete = Boolean(
    editForm.manufacturer &&
    editForm.model &&
    String(editForm.serial || "").trim() &&
    exactlyOneSelected &&
    !!editForm.grade
  );




  // Progress per fotoslot i EditModal (0–100)
  const [editUploadPct, setEditUploadPct] = useState<Record<string, number>>({});

  // Lokal komprimerare (DataURL) – enkel, självständig
  function compressImageForEdit(file: File, maxDim = 1920, quality = 0.9): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        const w = Math.round(width * scale);
        const h = Math.round(height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas 2D not supported"));
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }




  // Staging: välj/byt foto (ingen upload här – den sker i commitStagedPhotos)
  // Staging: välj/byt foto (ingen upload här – den sker i commitStagedPhotos)
  async function handleEditPhotoFile(photoType: string, file: File) {
    if (fieldsDisabled) return;

    try {
      // 1) Städa ev. tidigare blob-preview
      const prev = previewUrls[photoType];
      if (prev && prev.startsWith("blob:")) {
        try { URL.revokeObjectURL(prev); } catch { }
      }

      // 2) Förbered nästa staging-state
      const objectUrl = URL.createObjectURL(file);
      const nextPreview = { ...previewUrls, [photoType]: objectUrl };
      const nextPendingFiles = { ...pendingPhotoFiles, [photoType]: file };

      // Vid ersättning av bild: ta bort ev. delete-flagga för sloten
      const nextPendingDeletes = { ...pendingDeletes };
      delete nextPendingDeletes[photoType];

      // 3) Skriv staging-state
      setPreviewUrls(nextPreview);
      setPendingPhotoFiles(nextPendingFiles);
      setPendingDeletes(nextPendingDeletes);

      // 👇 NY RAD – säkerställ att sloten räknas som “OK” när ny fil valts
      setImgOk((s) => ({ ...s, [photoType as PhotoKey]: true }));

      // (UI) Nollställ progressindikatorn för sloten
      setEditUploadPct((prev) => ({ ...prev, [photoType]: 0 }));

      // ❌ Ingen lokal isDirty-beräkning här – computeNetDirty + useEffect tar över.
    } catch (e: any) {
      alert(e?.message || "Kunde inte förhandsvisa bilden.");
    }
  }

  // --- FOTO: helpers (lägg precis under handleEditPhotoFile) ---



  // Input-change för EditModal
  function handleEditPhotoChange(
    e: React.ChangeEvent<HTMLInputElement>,
    key: PhotoKey
  ) {
    const file = e.target.files?.[0];
    if (!file || fieldsDisabled) return;
    void handleEditPhotoFile(key, file);   // använder din staging-funktion
    e.currentTarget.value = "";            // tillåt välja samma fil igen
  }

  // Staga borttagning + uppdatera UI lokalt
  function handleEditRemovePhoto(key: PhotoKey) {
    if (fieldsDisabled) return;

    setPendingPhotoFiles(prev => {
      const next = { ...prev }; delete next[key]; return next;
    });

    setPendingDeletes(prev => ({ ...prev, [key]: true }));

    setPreviewUrls(prev => {
      const next = { ...prev };
      const u = next[key];
      if (u?.startsWith?.("blob:")) { try { URL.revokeObjectURL(u); } catch { } }
      delete next[key];
      return next;
    });

    setImgOk((s) => ({ ...s, [key]: true }));

    setEditForm(prev => {
      const photos = { ...(prev.photos || {}) } as Record<string, string>;
      delete photos[key];
      return { ...prev, photos };
    });

    setImgOk(s => ({ ...s, [key]: true }));
  }

  // Stabil renderare för en fotoplatts
  const renderPhotoSlot = (key: PhotoKey, label: string) => {
    const stagedUrl = previewUrls[key]; // blob om nyvald fil
    const savedUrl = (editForm.photos as any)?.[key] as string | undefined;
    const displayUrl = stagedUrl || savedUrl;
    const hasImage = !!displayUrl && imgOk[key];

    return (
      <div style={{ textAlign: "center" }}>
        <button
          type="button"
          onClick={() => document.getElementById(`edit-photo-${key}`)?.click()}
          className="btn"
          disabled={fieldsDisabled}
          style={{ padding: "8px 12px", marginBottom: 4, opacity: fieldsDisabled ? 0.6 : 1 }}
          title={fieldsDisabled ? "Fält är låst" : `Byt/Ladda upp ${label}`}
        >
          {label}
        </button>

        <input
          id={`edit-photo-${key}`}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => handleEditPhotoChange(e, key)}
        />

        <div style={{ position: "relative", display: "inline-block", width: 80, height: 80 }}>
          {hasImage ? (
            <>
              <img
                src={displayUrl}
                alt={`${label} preview`}
                onError={() => setImgOk(s => ({ ...s, [key]: false }))}
                style={{
                  width: 80, height: 80, objectFit: "cover",
                  borderRadius: 8, border: "1px solid #e5e7eb"
                }}
              />
              {!fieldsDisabled && (
                <button
                  type="button"
                  onClick={() => handleEditRemovePhoto(key)}
                  title="Ta bort bild"
                  style={{
                    position: "absolute", top: -8, right: -8,
                    background: "#ef4444", color: "#fff", border: "none",
                    borderRadius: "50%", width: 24, height: 24, lineHeight: "24px",
                    cursor: "pointer", fontSize: 14
                  }}
                >
                  ×
                </button>
              )}
            </>
          ) : (
            <div
              style={{
                width: 80, height: 80, borderRadius: 8, border: "1px solid #e5e7eb",
                display: "grid", placeItems: "center", fontSize: 11, color: "#6b7280"
              }}
            >
              Ingen bild
            </div>
          )}
        </div>
      </div>
    );
  };









  // --- [STEG 1] modell-alternativ för vald tillverkare ---
  const [modelOptions, setModelOptions] = React.useState<string[]>([]);

  // --- Commit-on-save: staging state ---
  const [isDirty, setIsDirty] = useState(false);

  // Filer som är valda i modalen men ännu inte uppladdade/sparade
  const [pendingPhotoFiles, setPendingPhotoFiles] = useState<Record<string, File>>({});

  // Lokala previews (ObjectURL/dataURL) så användaren ser bilden innan spar
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  // Markeringar för foton som ska tas bort vid "Spara"
  const [pendingDeletes, setPendingDeletes] = useState<Record<string, true>>({});

  // Håller isDirty uppdaterad utifrån fält + foton (staging vs baseline)
  const computeNetDirty = React.useCallback(() => {
    // 1) Fält: jämför mot baseline
    for (const k of DIRTY_KEYS) {
      const baseVal = (baselineRef.current.form as any)?.[k];
      const curVal = (editForm as any)?.[k];
      if (baseVal !== curVal) return true;
    }

    // 2) Foton: ny fil => smutsigt
    if (Object.keys(pendingPhotoFiles).length > 0) return true;

    // 3) Foton: delete räknas bara om baseline faktiskt hade en bild
    for (const t of Object.keys(pendingDeletes)) {
      if (baselineRef.current?.photos?.[t]) return true;
    }

    return false;
  }, [editForm, pendingPhotoFiles, pendingDeletes]);

  React.useEffect(() => {
    setIsDirty(computeNetDirty());
  }, [computeNetDirty]);

  // Städa upp blob: object URLs när preview-listan byts eller modalen stängs
  React.useEffect(() => {
    return () => {
      try {
        Object.values(previewUrls).forEach((u) => {
          if (typeof u === "string" && u.startsWith("blob:")) {
            URL.revokeObjectURL(u);
          }
        });
      } catch { }
    };
  }, [isOpen, previewUrls]);


  // Hjälpare: vilken bild ska UI visa för en given slot?
  // 1) pending preview om finns, 2) annars sparad DB-URL, 3) null/undefined => placeholder
  const getPhotoSrcForUI = (type: string): string | undefined => {
    if (previewUrls[type]) return previewUrls[type];
    if (pendingDeletes[type]) return undefined;
    const url = (editForm?.photos as any)?.[type] as string | undefined;
    return url;
  };

  // refs till dolda file inputs per fototyp
  const photoInputRefs = React.useRef<Record<string, HTMLInputElement | null>>({});

  // öppna systemets filväljare/kamera för given fototyp
  const triggerPhotoCapture = (type: string) => {
    if (fieldsDisabled) return; // 🔒 låst
    const el = photoInputRefs.current[type];
    if (el) el.click();
  };

  // Staging: ta bort foto → placeholder tills "Spara" (netto-tolkad, ingen lokal setIsDirty)
  async function removePhotoForType(type: string) {
    if (fieldsDisabled) return;

    // 1) Städa ev. lokal preview (blob-URL) för sloten
    const prev = previewUrls[type];
    if (prev && prev.startsWith("blob:")) {
      try { URL.revokeObjectURL(prev); } catch { }
    }

    // 2) Bestäm om baseline (sparad DB) hade bild för denna slot
    const hadBaseline = !!baselineRef.current?.photos?.[type];

    // 3) Räkna fram nästa staging-tillstånd
    const nextPreview = { ...previewUrls }; delete nextPreview[type];
    const nextPendingFiles = { ...pendingPhotoFiles }; delete nextPendingFiles[type];

    const nextPendingDeletes: Record<string, true> = { ...pendingDeletes };
    if (hadBaseline) {
      nextPendingDeletes[type] = true;   // radera sparad bild vid "Spara"
    } else {
      delete nextPendingDeletes[type];   // baseline saknade bild → ingen delete-markering
    }

    // 4) Skriv staging-state
    setPreviewUrls(nextPreview);
    setPendingPhotoFiles(nextPendingFiles);
    setPendingDeletes(nextPendingDeletes);

    // ❌ Ingen lokal isDirty-beräkning här – computeNetDirty + useEffect tar över.
  }





  React.useEffect(() => {
    if (!isOpen) return;

    const loadModelsForManufacturer = async () => {
      if (!editForm.manufacturer) { setModelOptions([]); return; }

      const slug = toKey(editForm.manufacturer);

      // 1) Försök med manufacturerKey (slug)
      let snap = await getDocs(
        query(collection(db, "models"), where("manufacturerKey", "==", slug))
      );

      // 2) Om tomt: försök med manufacturer (visningsnamn)
      if (snap.empty) {
        snap = await getDocs(
          query(collection(db, "models"), where("manufacturer", "==", editForm.manufacturer))
        );
      }

      // (Valfritt) Om du i stället lagrat modeller som subcollection:
      // snap = await getDocs(collection(db, "manufacturers", slug, "models"));

      const options = snap.docs
        .map(d => ((d.data() as any).name as string) || "")
        .filter(Boolean)
        .filter((v, i, a) => a.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i)
        .sort((a, b) => a.localeCompare(b, "sv"));

      setModelOptions(options);
      // Om nuvarande model inte finns bland alternativen för vald tillverkare: töm den
      if (editForm.model && !options.includes(editForm.model)) {
        onChange({
          target: { name: "model", value: "", type: "select-one" }
        } as React.ChangeEvent<HTMLSelectElement>);
      }
    };

    loadModelsForManufacturer();
  }, [isOpen, editForm.manufacturer]);

  const setExclusive = (name: 'reuse' | 'resold' | 'scrap', checked: boolean) => {
    setCheckbox(name, checked);
    if (checked) {
      (['reuse', 'resold', 'scrap'] as const).filter(n => n !== name).forEach(n => setCheckbox(n, false));
    }
  };



  const sortedLog = [...(editForm.auditLog || [])].sort(
    (a, b) => +new Date(b.at) - +new Date(a.at)
  );

  const labelForAction = (action: AuditAction): string => {
    if (action === "created") return "Skapad av";
    if (action === "updated") return "Ändrat av";
    if (action === "completed") return "Markerad som färdig av";
    return action;
  };

  const emitModelChange = (value: string) => {
    onChange({
      target: { name: "model", value, type: "select-one" }
    } as React.ChangeEvent<HTMLSelectElement>);
  };

  const requestClose = React.useCallback(() => {
    if (isDirty) {
      const ok = window.confirm("Du har osparade ändringar. Vill du kasta dem?");
      if (!ok) return;
      // städa alla blob-URLs
      Object.values(previewUrls).forEach((u) => { if (u?.startsWith?.("blob:")) { try { URL.revokeObjectURL(u); } catch { } } });
      // nollställ staging
      setPreviewUrls({});
      setPendingPhotoFiles({});
      setPendingDeletes({});
      setIsDirty(false);
    }
    onClose();
  }, [isDirty, previewUrls, onClose]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);










  return (
    <div
      className="gw-modal-overlay"
      onClick={requestClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="gw-modal-card gw-modal-card--wide"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="gw-modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h3 className="gw-modal-title">Redigera enhet</h3>
            {isCompleted && <span className="badge badge--done">Färdig</span>}
          </div>
        </div>

        <div className="gw-modal-body">  {/* ← öppna body här, som syskon till header */}

          {/* 🟨 Banner: fakturerad = read-only */}
          {isReadOnly && (
            <div
              className="gw-banner gw-banner--warn"
              role="status"
              aria-live="polite"
            >
              <div style={{ marginBottom: 8 }}>
                <strong>Denna enhet är fakturerad.</strong> Fälten är låsta men du kan se historik och bilder.
              </div>

              {invoiceReportId && (
                <a
                  href={`#/rapport/${encodeURIComponent(invoiceReportId)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn"
                  title="Öppna fakturarapport"
                >
                  Öppna fakturarapport →
                </a>
              )}
            </div>
          )}

          {/* 🟥 Banner: markerad för radering = spärrad */}
          {isDeletePending && (
            <div
              className="gw-banner gw-banner--danger"
              role="alert"
              aria-live="assertive"
            >
              <div style={{ marginBottom: 8 }}>
                <strong>Denna enhet är markerad för radering.</strong> Alla fält är låsta tills raderingen
                avmarkeras i listan på startsidan.
              </div>
              <div style={{ fontSize: 13, opacity: 0.9 }}>
                Markerad av {editForm.deleteMarkedBy || "okänd"}
                {editForm.deleteMarkedAt ? ` • ${new Date(editForm.deleteMarkedAt).toLocaleString()}` : ""}
              </div>
            </div>
          )}

          <div className="gw-form-grid">
            {/* Tillverkare + Modell (sida vid sida) */}
            <label className="gw-form-field">
              <div className="gw-form-label">Tillverkare</div>
              <select
                name="manufacturer"
                value={editForm.manufacturer || ""}
                onChange={(e) => {
                  // skriv tillverkare…
                  onChange(e);
                  // …och nollställ modell när tillverkare byts
                  onChange({
                    target: { name: "model", value: "" },
                  } as unknown as React.ChangeEvent<HTMLSelectElement>);
                }}
                disabled={fieldsDisabled}
                className="gw-input"
              >
                <option value="">Välj tillverkare</option>
                {manufacturerList.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>

            <label className="gw-form-field">
              <div className="gw-form-label">Modell</div>
              <select
                name="model"
                value={editForm.model || ""}
                onChange={onChange}
                disabled={!editForm.manufacturer || fieldsDisabled}
                className="gw-input"
              >
                <option value="">{editForm.manufacturer ? "Välj modell" : "Välj tillverkare först"}</option>
                {modelOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>

            {/* Ordernummer + Serienummer (sida vid sida) */}
            <label className="gw-form-field">
              <div className="gw-form-label">Ordernummer</div>
              <input
                type="text"
                name="orderNumber"
                value={editForm.orderNumber || ""}
                onChange={onChange}
                disabled={fieldsDisabled}
                className="gw-input"
                placeholder="Ordernummer"
              />
            </label>

            <label className="gw-form-field">
              <div className="gw-form-label">Serienummer</div>
              <input
                type="text"
                name="serial"
                value={editForm.serial || ""}
                onChange={onChange}
                disabled={fieldsDisabled}
                className="gw-input"
                placeholder="Serienummer"
              />
            </label>

            {/* Adapter + Skador (rad-bredd) */}
            <label className="gw-form-field gw-form-row-full">
              <div className="gw-check-inline">
                <input
                  type="checkbox"
                  name="chargerIncluded"
                  checked={!!editForm.chargerIncluded}
                  onChange={onChange}
                  disabled={fieldsDisabled}
                />
                <span>Adapter medföljer</span>
              </div>
            </label>

            <label className="gw-form-field gw-form-row-full">
              <div className="gw-form-label">Eventuella skador</div>
              <textarea
                name="damageNotes"
                value={editForm.damageNotes || ""}
                onChange={onChange}
                disabled={fieldsDisabled}
                className="gw-input"
                placeholder="Beskriv skador…"
                style={{ minHeight: 88 }}
              />
            </label>
          </div>


          {/* Status + Gradering (inramade) */}
          <div className="gw-form-row-compact">
            {/* Status */}
            <fieldset className="gw-fieldset gw-form-field" style={{ flex: "0 1 50%" }}>
              <legend className="gw-fieldset-legend">Status</legend>
              <div className="gw-inline-checks">
                <label className="gw-check-inline">
                  <input
                    type="checkbox"
                    name="reuse"
                    checked={!!editForm.reuse}
                    onChange={(e) => setExclusive("reuse", (e.target as HTMLInputElement).checked)}
                    disabled={fieldsDisabled}
                  />
                  <span>Återbruk</span>
                </label>

                <label className="gw-check-inline">
                  <input
                    type="checkbox"
                    name="resold"
                    checked={!!editForm.resold}
                    onChange={(e) => setExclusive("resold", (e.target as HTMLInputElement).checked)}
                    disabled={fieldsDisabled}
                  />
                  <span>Vidaresålt</span>
                </label>

                <label className="gw-check-inline">
                  <input
                    type="checkbox"
                    name="scrap"
                    checked={!!editForm.scrap}
                    onChange={(e) => setExclusive("scrap", (e.target as HTMLInputElement).checked)}
                    disabled={fieldsDisabled}
                  />
                  <span>Skrotad</span>
                </label>
              </div>
            </fieldset>

            {/* Gradering */}
            <fieldset className="gw-fieldset gw-form-field" style={{ flex: "0 1 50%" }}>
              <legend className="gw-fieldset-legend">Gradering</legend>
              <div className="gw-inline-checks">
                <label className="gw-check-inline">
                  <input
                    type="checkbox"
                    checked={editForm.grade === 'A'}
                    onChange={(e) => setGrade('A', (e.target as HTMLInputElement).checked)}
                    disabled={fieldsDisabled}
                  />
                  <span>A</span>
                </label>
                <label className="gw-check-inline">
                  <input
                    type="checkbox"
                    checked={editForm.grade === 'B'}
                    onChange={(e) => setGrade('B', (e.target as HTMLInputElement).checked)}
                    disabled={fieldsDisabled}
                  />
                  <span>B</span>
                </label>
                <label className="gw-check-inline">
                  <input
                    type="checkbox"
                    checked={editForm.grade === 'C'}
                    onChange={(e) => setGrade('C', (e.target as HTMLInputElement).checked)}
                    disabled={fieldsDisabled}
                  />
                  <span>C</span>
                </label>
                <label className="gw-check-inline">
                  <input
                    type="checkbox"
                    checked={editForm.grade === 'D'}
                    onChange={(e) => setGrade('D', (e.target as HTMLInputElement).checked)}
                    disabled={fieldsDisabled}
                  />
                  <span>D</span>
                </label>
              </div>
            </fieldset>
          </div>



          {/* Bilder */}
          {(() => {
            const allTypes = Object.keys(PHOTO_LABELS || {}) as string[];
            if (!allTypes.length) return null;

            return (
              <div style={{ marginTop: 4 }}>
                <h4 style={{ margin: "4px 0 6px" }}>Bilder</h4>

                {/* Dolda inputs för kamera/filväljare – en per fototyp */}
                {allTypes.map((type) => (
                  <input
                    key={`file-${type}`}
                    ref={(el) => { photoInputRefs.current[type] = el; }}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.currentTarget.files?.[0];
                      if (f) handleEditPhotoFile(type, f);
                      e.currentTarget.value = ""; // möjliggör val av samma fil igen
                    }}
                  />
                ))}

                <div className="gw-photo-grid">
                  {allTypes.map((type) => {
                    const label = (PHOTO_LABELS as any)[type] || type;

                    // ✨ Hämta vad UI ska visa utifrån staging/DB
                    const url = getPhotoSrcForUI(type);
                    const isPendingAdd = !!pendingPhotoFiles[type];
                    const isPendingDelete = !!pendingDeletes[type];
                    const key = type as PhotoKey;                      // NEW
                    const showImg = !!url && imgOk[key] !== false;     // NEW

                    // Finns något att visa (preview-URL eller sparad DB-URL)
                    if (showImg) {
                      return (
                        <div
                          key={type}
                          className="gw-photo-card"
                          onClick={() => setLargeImage(url!)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === "Enter") setLargeImage(url!); }}
                          title={`Visa ${label} i stort format`}
                        >
                          {!fieldsDisabled && (
                            <button
                              type="button"
                              className="gw-photo-remove"
                              aria-label={`Ta bort ${label}`}
                              onClick={(e) => { e.stopPropagation(); removePhotoForType(type); }}
                              title="Ta bort"
                            >
                              ×
                            </button>
                          )}

                          {/* ✨ NYTT: onError fallback */}
                          <img
                            src={url!}
                            alt={label}
                            className="gw-photo-img"
                            onError={() => setImgOk(s => ({ ...s, [key]: false }))}
                          />

                          {isPendingAdd && (
                            <div style={{
                              position: "absolute", top: 6, left: 6, padding: "2px 8px",
                              borderRadius: 999, background: "rgba(17,24,39,0.85)",
                              color: "#fff", fontSize: 12
                            }}>
                              Ej sparat
                            </div>
                          )}

                          <div className="gw-photo-title">{label}</div>
                        </div>
                      );
                    }

                    // ⬇️ Placeholder när url saknas ELLER när onError slagit imgOk[key] = false
                    return (
                      <button
                        key={type}
                        type="button"
                        className={`gw-photo-card ${fieldsDisabled ? "is-disabled" : ""}`}
                        onClick={() => triggerPhotoCapture(type)}
                        title={`Lägg till ${label}`}
                        disabled={fieldsDisabled}
                      >
                        <div className="gw-photo-placeholder">
                          <div>
                            {isPendingDelete ? "Raderas vid spara" : (fieldsDisabled ? "Låst läge" : "Tryck för att fota/ladda upp")}
                            <br />
                            <strong>{label}</strong>
                          </div>
                        </div>
                        <div className="gw-photo-title">{label}</div>
                      </button>
                    );
                  })}
                </div>

                {/* Fullskärmsvisning av bild */}
                {largeImage && (
                  <div
                    onClick={() => setLargeImage(null)}
                    style={{
                      position: "fixed",
                      inset: 0,
                      background: "rgba(0,0,0,0.6)",
                      display: "grid",
                      placeItems: "center",
                      zIndex: 9999,
                      padding: 20,
                    }}
                  >
                    <img
                      src={largeImage}
                      alt="Förhandsvisning"
                      style={{
                        maxWidth: "95vw",
                        maxHeight: "90vh",
                        borderRadius: 12,
                        boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })()}




          {/* Logg */}
          <section className="gw-form-field gw-form-row-full gw-log-section">
            <div className="gw-form-label">Logg</div>

            <div className="gw-log gw-logbox gw-mb-16 gw-log-scroll">
              {sortedLog.length === 0 ? (
                <div style={{ color: "#6b7280" }}>Ingen historik ännu.</div>
              ) : (
                (sortedLog as AuditEntry[]).map((entry, idx) => (
                  <div key={idx} style={{ padding: "6px 8px", borderBottom: "1px solid #eee" }}>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      {new Date(entry.at).toLocaleString("sv-SE")}
                    </div>
                    <div>
                      <strong>{labelForAction(entry.action as AuditAction)}</strong>{" "}
                      {entry.by || "—"}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>





        </div>  {/* ← NY RAD: stänger .gw-modal-body */}

        {/* Footer */}
        <div className="gw-modal-footer">
          {/* Vänster: länk till fakturarapport + osparat-indikator */}
          <div>
            {invoiceReportId && (
              <button
                type="button"
                onClick={() => {
                  // respektera osparat
                  if (isDirty) {
                    const ok = window.confirm("Du har osparade ändringar. Vill du kasta dem?");
                    if (!ok) return;

                    // samma städning som i requestClose
                    Object.values(previewUrls).forEach((u) => {
                      if (u?.startsWith?.("blob:")) { try { URL.revokeObjectURL(u); } catch { } }
                    });
                    setPreviewUrls({});
                    setPendingPhotoFiles({});
                    setPendingDeletes({});
                    setIsDirty(false);
                  }

                  onClose(); // stäng modalen
                  window.location.hash = `#/rapport/${encodeURIComponent(invoiceReportId!)}`; // navigera
                }}
                className="btn"
                title="Öppna fakturarapport"
                disabled={isSaving}
              >
                Öppna fakturarapport →
              </button>
            )}

            {isDirty && (
              <span
                style={{
                  marginLeft: 8,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "rgba(17,24,39,0.08)",
                  color: "#111827",
                  fontSize: 12,
                }}
              >
                Ej sparade ändringar
              </span>
            )}
          </div>


          {/* Höger: åtgärdsknappar */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {isReadOnly ? (
              // Läs-läge (fakturerad)
              <button type="button" className="btn" onClick={requestClose} disabled={isSaving}>
                Stäng
              </button>
            ) : isCompleted ? (
              // Färdig (ej fakturerad)
              <>
                {onReopen && (
                  <button
                    type="button"
                    className="btn"
                    onClick={onReopen}
                    disabled={isSaving}
                  >
                    Öppna för editering
                  </button>
                )}
                <button type="button" className="btn" onClick={requestClose} disabled={isSaving}>
                  Avbryt
                </button>
              </>
            ) : (
              // Ej färdig
              <>
                <button
                  className="btn"
                  onClick={onComplete}
                  disabled={fieldsDisabled || !formComplete || isSaving}
                  title={
                    formComplete
                      ? "Markera som färdig"
                      : "Fyll i tillverkare, modell, serienummer och välj exakt ett alternativ"
                  }
                >
                  {isSaving ? "Sparar…" : "Markera som färdig"}
                </button>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => { await commitStagedPhotos(); await onSave(); }}
                  disabled={fieldsDisabled || isSaving}
                  title={isSaving ? "Sparar…" : "Spara ändringar"}
                >
                  {isSaving ? "Sparar…" : "Spara ändringar"}
                </button>

                <button type="button" className="btn" onClick={requestClose} disabled={isSaving}>
                  Avbryt
                </button>
              </>
            )}
          </div>
        </div>


        {/* stänger EM_PANEL */}
      </div>

    </div>
  );
}

// === Flytande "Till toppen"-knapp (visas efter ~500px scroll) ===
function BackToTopButton() {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 500);
    onScroll(); // init-state
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="btn"
      aria-label="Till toppen"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 1000,
        borderRadius: 999,
        padding: "10px 12px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
      }}
    >
      ↑ Till toppen
    </button>
  );
}



// === ClearableInput (med stöd för inputProps) ===
type ClearableInputProps = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string; // default: "gw-input"
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
};

const ClearableInput: React.FC<ClearableInputProps> = ({
  value,
  onChange,
  placeholder,
  className = "gw-input",
  inputProps,
}) => {
  return (
    <div className="gw-clearable">
      <input
        {...inputProps}
        className={className}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value?.trim() ? (
        <button
          type="button"
          className="gw-clear-btn"
          aria-label="Rensa fält"
          title="Rensa"
          onClick={() => onChange("")}
        >
          ×
        </button>
      ) : null}
    </div>
  );
};





/* =========================
   App
========================= */


// ===== ReportDetailPage (fristående vy) =====
function ReportDetailPage({ reportId, authReady }: { reportId: string; authReady: boolean }) {
  const [report, setReport] = useState<({ id: string } & InvoiceReport) | null>(null);
  const [itemsForReport, setItemsForReport] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Vänta tills auth är redo (inloggningsstatus känd)
    if (!authReady) return;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Hämta rapporten
        const rDoc = await getDoc(
          doc(db, REPORTS_COLLECTION, "root", INVOICE_SUBCOLLECTION, reportId)
        );
        if (!rDoc.exists()) {
          setReport(null);
          setItemsForReport([]);
          return;
        }
        const r = { id: rDoc.id, ...(rDoc.data() as InvoiceReport) };
        setReport(r);

        // Hämta alla items i rapporten
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

  // Summering 1/0-kolumner
  const totals = (() => {
    const t = {
      f3Procedure: 0,
      endpointRemoval: 0,
      osReinstall: 0,
      endpointWipe: 0,
      postWipeBootTest: 0,
      dataErasure: 0,
      refurbish: 0,
    };
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
  })();

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={H1}>{report.name}</h1>
      <div style={{ marginBottom: 8, color: "#374151" }}>
        Kund: <strong>{report.customer}</strong> • Skapad:{" "}
        {new Date(report.createdAt).toLocaleString("sv-SE")}
      </div>

      <div style={{ fontSize: 13, margin: "8px 0 12px" }}>
        <strong>Summering:</strong>{" "}
        F3-procedur: {totals.f3Procedure} • Borttagning i Endpoint: {totals.endpointRemoval} •{" "}
        Ominstallation OS: {totals.osReinstall} • Wipe i Endpoint: {totals.endpointWipe} •{" "}
        Uppstartstest efter Wipe: {totals.postWipeBootTest} • Dataradering: {totals.dataErasure} •{" "}
        Refurbish: {totals.refurbish}
      </div>

      {/* Tabell (samma som i Fakturering, utan checkbox) */}
      <table style={TABLE_COMPACT}>
        <thead>
          <tr>
            <th>Ordernr</th>
            <th>Tillverkare</th>
            <th>Modell</th>
            <th>Serienr</th>
            <th>Kund</th>
            <th>Klart av</th>
            <th>Datum</th>
            <th>Status</th>
            <th>F3-procedur</th>
            <th>Borttagning i Endpoint</th>
            <th>Ominstallation OS</th>
            <th>Wipe i Endpoint</th>
            <th>Uppstartstest efter Wipe</th>
            <th>Dataradering</th>
            <th>Refurbish</th>
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
                : computeBillingSteps({
                  reuse: !!anyIt.reuse,
                  resold: !!anyIt.resold,
                  scrap: !!anyIt.scrap,
                });

              const statusParts: string[] = [];
              if (anyIt.reuse) statusParts.push("Återbruk");
              if (anyIt.resold) statusParts.push("Vidaresålt");
              if (anyIt.scrap) statusParts.push("Skrotad");
              const status = statusParts.join(" / ") || "-";

              return (
                <tr key={it.id}>
                  <td>{it.orderNumber}</td>
                  <td>{it.manufacturer}</td>
                  <td>{it.model}</td>
                  <td>{it.serial}</td>
                  <td>{anyIt.customer}</td>
                  <td>{it.completedBy}</td>
                  <td>{fmtDateOnly(it.completedAt)}</td>
                  <td>{status}</td>
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

function ReportsPage() {
  const [invoiceReports, setInvoiceReports] = useState<Array<{ id: string } & InvoiceReport>>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reportItems, setReportItems] = useState<Record<string, Item[]>>({}); // cache: reportId -> items[]
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const q = await getDocs(
          collection(doc(db, REPORTS_COLLECTION, "root"), INVOICE_SUBCOLLECTION)
        );
        const docs = q.docs.map((d) => ({ id: d.id, ...(d.data() as InvoiceReport) }));
        docs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        setInvoiceReports(docs);
      } catch (err) {
        console.error("Kunde inte läsa fakturarapporter", err);
      }
    })();
  }, []);

  // Summera 1/0-kolumner för en rapports items
  function calcReportStepTotals(items: Item[]) {
    const totals = {
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

      totals.f3Procedure += steps.f3Procedure;
      totals.endpointRemoval += steps.endpointRemoval;
      totals.osReinstall += steps.osReinstall;
      totals.endpointWipe += steps.endpointWipe;
      totals.postWipeBootTest += steps.postWipeBootTest;
      totals.dataErasure += steps.dataErasure;
      totals.refurbish += steps.refurbish;
    }

    return totals;
  }

  // Ladda items för en rapport (enkel & robust: hämta per id och cacha)
  const loadReportItems = async (r: { id: string } & InvoiceReport) => {
    if (reportItems[r.id]) return; // redan laddad
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

  return (
    <div>
      <h1 style={H1}>Rapporter</h1>

      {invoiceReports.length === 0 ? (
        <div style={{ color: "#6b7280" }}>Inga fakturarapporter skapade ännu.</div>
      ) : (
        <ul style={{ marginTop: 8, listStyle: "none", padding: 0 }}>
          {invoiceReports.map((r) => {
            const isOpen = expandedId === r.id;
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

                {/* 🆕 LÄGG DENNA LÄNK DIREKT HÄR UNDER */}
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

                {/* Summering */}
                <div style={{ fontSize: 13, color: "#374151", marginBottom: 8 }}>
                  Antal: {r.summary.totalItems}, Återbruk: {r.summary.reusedCount}, Vidaresålt:{" "}
                  {r.summary.resoldCount}, Skrotad: {r.summary.scrappedCount}
                </div>

                {/* Detaljtabell – samma kolumner som Fakturering, utan “Fakturera” */}
                {isOpen && (
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                    {loadingDetail === r.id ? (
                      <div style={{ color: "#6b7280" }}>Laddar detaljer…</div>
                    ) : (reportItems[r.id]?.length ?? 0) === 0 ? (
                      <div style={{ color: "#6b7280" }}>Inga poster i denna rapport.</div>
                    ) : (
                      <table style={TABLE_COMPACT}>
                        <thead>
                          <tr>
                            <th>Ordernr</th>
                            <th>Tillverkare</th>
                            <th>Modell</th>
                            <th>Serienr</th>
                            <th>Kund</th>
                            <th>Klart av</th>
                            <th>Datum</th>
                            <th>Status</th>
                            <th>F3-procedur</th>
                            <th>Borttagning i Endpoint</th>
                            <th>Ominstallation OS</th>
                            <th>Wipe i Endpoint</th>
                            <th>Uppstartstest efter Wipe</th>
                            <th>Dataradering</th>
                            <th>Refurbish</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportItems[r.id]!
                            .slice()
                            .sort((a, b) =>
                              String(b.completedAt || "").localeCompare(String(a.completedAt || ""))
                            )
                            .map((it) => {
                              // Status-text
                              const statusParts: string[] = [];
                              if ((it as any).reuse) statusParts.push("Återbruk");
                              if ((it as any).resold) statusParts.push("Vidaresålt");
                              if ((it as any).scrap) statusParts.push("Skrotad");
                              const status = statusParts.join(" / ") || "-";

                              // 1/0-kolumner: ta befintliga om de finns, annars härled
                              const hasSteps = typeof (it as any).f3Procedure === "number";
                              const steps = hasSteps
                                ? {
                                  f3Procedure: (it as any).f3Procedure,
                                  endpointRemoval: (it as any).endpointRemoval,
                                  osReinstall: (it as any).osReinstall,
                                  endpointWipe: (it as any).endpointWipe,
                                  postWipeBootTest: (it as any).postWipeBootTest,
                                  dataErasure: (it as any).dataErasure,
                                  refurbish: (it as any).refurbish,
                                }
                                : computeBillingSteps({
                                  reuse: !!(it as any).reuse,
                                  resold: !!(it as any).resold,
                                  scrap: !!(it as any).scrap,
                                });

                              return (
                                <tr key={it.id}>
                                  <td>{it.orderNumber}</td>
                                  <td>{it.manufacturer}</td>
                                  <td>{it.model}</td>
                                  <td>{it.serial}</td>
                                  <td>{(it as any).customer}</td>
                                  <td>{it.completedBy}</td>
                                  <td>{fmtDateOnly(it.completedAt)}</td>
                                  <td>{status}</td>
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
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function UsersAdmin() {
  return <div style={{ padding: 24 }}>Användaradministration (kommer snart)</div>;



}

export default function App(): JSX.Element {

  // Auth & Roles
  type Role = "admin" | "user";
  type AppUser = { uid: string; email: string; emailVerified: boolean; role: Role };
  const [user, setUser] = useState<AppUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { setUser(null); setAuthReady(true); return; }
      const token = await getIdTokenResult(u, true);
      const role = (token.claims.role as Role) || "user";
      setUser({ uid: u.uid, email: u.email || "", emailVerified: u.emailVerified, role });
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const [reportIdFromHash, setReportIdFromHash] = useState<string | null>(null);
  useEffect(() => {
    const parseHash = () => {
      const m = window.location.hash.match(/^#\/rapport\/([^/?#]+)/i);
      setReportIdFromHash(m ? decodeURIComponent(m[1]) : null);
    };
    parseHash(); // init vid laddning
    window.addEventListener("hashchange", parseHash);
    return () => window.removeEventListener("hashchange", parseHash);
  }, []);

  const isReportView = !!reportIdFromHash;





  // === Menykomponenter (homogent utseende) ===
  type PageKey = "home" | "users" | "fakturering" | "rapporter";
  type MenuEntry = { key: PageKey; label: string; visible?: () => boolean };




  // --- Placering 2: TIDIG RETURN i App ---







  const MenuItem: React.FC<{
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }> = ({ active, onClick, children }) => (
    <button
      className={`menu-item${active ? " active" : ""}`}
      onClick={onClick}
      type="button"
      style={{
        width: "100%",
        textAlign: "left",
        padding: "10px 12px",
        background: active ? "#f0f5ff" : "transparent",
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
        margin: "8px 0",
      }}
    >
      {children}
    </button>
  );


  const MENU: MenuEntry[] = [
    { key: "home", label: "Hem" },
    { key: "users", label: "Användare", visible: () => user?.role === "admin" },
    { key: "fakturering", label: "Fakturering" },
    { key: "rapporter", label: "Rapporter" }
  ];


  // Enhetlig meny-stil för alla knappar
  const menuItemStyle = (active: boolean): React.CSSProperties => ({
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    background: active ? "#f4f6fa" : "transparent",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    margin: "8px 0",
  });


  // Vem är inloggad? (för logg/metadata)
  const currentUserString = (): string | null => {
    const u = auth.currentUser;
    if (!u) return null;
    return u.email || u.uid || null;
  };


  // Logga ut-knapp
  const handleLogout = async () => {
    try { await signOut(auth); }
    catch (e) { console.error("Logout misslyckades:", e); }
  };

  // ERSÄTT din nuvarande closeEdit med denna version
  const closeEdit = async (): Promise<void> => {
    stopLockHeartbeat(); // ← stoppa pulsen direkt
    stopLockWatcher();     // ← NY RAD
    try {
      // Släpp låset bara om posten inte visades i read-only (dvs ej fakturerad)
      if (editId && !editIsReadOnly) {
        const ref = doc(db, "itInventory", editId);
        await updateDoc(ref, { lockedBy: null, lockedAt: null } as any);
      }
    } catch (e: any) {
      // Ignorera ev. rättighetsfel vid stängning
      console.warn("Kunde inte släppa låset vid stängning:", e?.message || e);
    } finally {
      setIsEditOpen(false);
      setEditId(null);
      setEditIsReadOnly(false);
      setEditInvoiceReportId(null);
    }
  };




  // Tillfällig: gör mig (whitelistad e-post) till admin
  const makeMeAdmin = async () => {
    try {
      const fns = getFunctions(undefined, "europe-west1");
      await httpsCallable(fns, "bootstrapMakeMeAdmin")({});
      await auth.currentUser?.getIdToken(true);
      window.location.reload();
    } catch (e: any) {
      console.error(e);
      alert("Kunde inte göra admin: " + (e?.message || String(e)));
    }
  };



  // Cloud Functions (same region as backend)
  const fns = getFunctions(undefined, "europe-west1");
  const fnListUsers = httpsCallable(fns, "listUsers");
  const fnDeleteUser = httpsCallable(fns, "deleteUser");
  const fnSetUserRole = httpsCallable(fns, "setUserRole");
  const fnTriggerReset = httpsCallable(fns, "triggerPasswordReset");

  const [items, setItems] = useState<Item[]>([]);

  // --- Paginering (Hem-listan) ---
  const [pageIsLoading, setPageIsLoading] = useState(false);
  const [pageLastDoc, setPageLastDoc] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [pageHasNext, setPageHasNext] = useState<boolean>(false);

  const [pageIndex, setPageIndex] = useState(1);

  // sentinel för auto-load (används av IntersectionObserver)
  const loadMoreRef = React.useRef<HTMLDivElement | null>(null);

  // Visuell flagga: det har tillkommit nya poster sedan vi gick till sida 2+
  const [hasNewTopItems, setHasNewTopItems] = useState(false);

  // Refs för att kunna läsa aktuell vy/sida inne i sentineln utan att resubscriba
  const activePageRef = React.useRef<"home" | "fakturering" | "users" | "rapporter">("home");


  const pageLastDocRef = React.useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  useEffect(() => { pageLastDocRef.current = pageLastDoc; }, [pageLastDoc]);

  const PAGE_SIZE = 25;

  const baseListQuery = () =>
    query(
      collection(db, "itInventory"),
      orderBy("updatedAt", "desc"),
      orderBy("createdAt", "desc"),
      limit(PAGE_SIZE)
    );

  // --- Senast uppdaterad (ms-since-epoch) ---
  const [pageLastRefreshAt, setPageLastRefreshAt] = useState<number | null>(null);

  function fmtUpdateTime(ms: number | null): string {
    if (!ms) return "—";
    return new Date(ms).toLocaleTimeString("sv-SE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }


  async function fetchFirstPage() {
    setPageIsLoading(true);
    try {
      const snap = await getDocs(baseListQuery());
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Item[];
      setItems(rows);
      setPageLastDoc(snap.docs.length ? snap.docs[snap.docs.length - 1] : null);
      setPageHasNext(snap.docs.length === PAGE_SIZE);
      setPageIndex(1);               // ← vi är på första sidan
      setHasNewTopItems(false);      // ← ta bort ev. banner
      setPageLastRefreshAt(Date.now());
    } finally {
      setPageIsLoading(false);
    }
  }

  async function fetchNextPage() {
    if (!pageLastDoc) return;
    setPageIsLoading(true);
    try {
      const q = query(
        collection(db, "itInventory"),
        orderBy("updatedAt", "desc"),
        orderBy("createdAt", "desc"),
        startAfter(pageLastDoc),
        limit(PAGE_SIZE),
      );
      const snap = await getDocs(q);
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Item[];
      setItems(prev => [...prev, ...rows]); // ← append
      setPageLastDoc(snap.docs.length ? snap.docs[snap.docs.length - 1] : null);
      setPageHasNext(snap.docs.length === PAGE_SIZE);
      setPageIndex(p => p + 1); // ← nu är vi på sida 2+
    } finally {
      setPageIsLoading(false);
    }
  }






  // --- Auto-refresh sentinel (lyssnar på senaste updatedAt) ---
  const homeSentinelUnsub = React.useRef<Unsubscribe | null>(null);
  const lastRefreshAtRef = React.useRef<number>(0);
  // NY: spara senast observerade top.updatedAt i ms
  const lastTopUpdatedAtRef = React.useRef<number>(0);

  function stopHomeSentinel() {
    if (homeSentinelUnsub.current) {
      homeSentinelUnsub.current();
      homeSentinelUnsub.current = null;
    }
  }

  function startHomeSentinel() {
    stopHomeSentinel();

    const qTop = query(
      collection(db, "itInventory"),
      orderBy("updatedAt", "desc"),
      limit(1)
    );

    let first = true;
    homeSentinelUnsub.current = onSnapshot(qTop, (snap) => {
      if (first) { first = false; return; }

      const topDoc = snap.docs[0];
      if (!topDoc) return;

      const d = topDoc.data() as any;

      // Ignorera wizard-utkast och mitt eget pågående utkast
      if (d?.isDraft === true) return;
      if (draftItemId && topDoc.id === draftItemId) return;

      // Enkel throttling
      const now = Date.now();
      if (now - lastRefreshAtRef.current < 1500) return;

      // Bara om vi står på Hem
      if (activePageRef.current !== "home") return;

      // Är vi på första sidan? → auto-refresh direkt.
      // Annars (sida 2+) visa bara banner.
      if (pageIndex <= 1) {
        lastRefreshAtRef.current = now;
        fetchFirstPage();
      } else {
        setHasNewTopItems(true);
      }
    });
  }









  // Sidor/meny
  const [activePage, setActivePage] = useState<"home" | "fakturering" | "users" | "rapporter">("home");
  const [menuOpen, setMenuOpen] = useState<boolean>(false);

  // Starta/stäng sentinel baserat på vy & auth (HOOK PÅ TOPPNIVÅ)
  useEffect(() => {
    if (!authReady) return;

    if (activePage !== "home") {
      // lämnat Hem → stäng lyssnaren
      stopHomeSentinel();
      return;
    }

    // på Hem → starta lyssnaren
    startHomeSentinel();
    return () => stopHomeSentinel();
  }, [authReady, activePage]);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => { activePageRef.current = activePage; }, [activePage]);

  const { eligibleMarked, hasAnyMarked, exactlyOneCustomer } = useMemo(() => {
    const eligible = items.filter(
      (i) => i.completed && !i.invoiceReportId && i.markedForInvoice
    );
    const customers = new Set(eligible.map((i) => String(i.customer || "")));
    const onlyCustomer = customers.size === 1 ? Array.from(customers)[0] : "";

    return {
      eligibleMarked: eligible,
      hasAnyMarked: eligible.length > 0,
      exactlyOneCustomer: customers.size === 1 && onlyCustomer !== "",
    };
  }, [items]);

  // Ladda första sidan av Hem-listan när auth är klart och Hem-fliken är aktiv
  useEffect(() => {
    if (!authReady) return;
    if (activePage !== "home") return;
    fetchFirstPage();
  }, [authReady, activePage]);



  // Wizard
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [entryMode, setEntryMode] = useState<"wizard" | "snabb">("wizard");
  const quickOrderRef = React.useRef<HTMLInputElement | null>(null);
  const TOTAL_STEPS = 9;

  // Draft-post i DB så att wizarden kan få ett stabilt itemId tidigt
  const [draftItemId, setDraftItemId] = useState<string | null>(null);

  // Hjälpare: patcha utkastet om det finns
  const updateDraftMeta = async (patch: any) => {
    if (!draftItemId) return;
    try {
      await updateDoc(doc(db, "itInventory", draftItemId), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.debug("[Wizard] draft update skipped:", e);
    }
  };

  // Skapa utkast första gången man går vidare
  async function ensureDraftItem(): Promise<string> {
    if (draftItemId) return draftItemId;

    const refDoc = await addDoc(collection(db, "itInventory"), {
      isDraft: true,
      wizardStep: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: currentUserString(),
      completed: false,
      photos: {}, // inga foton än
      expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
      auditLog: [
        { action: "draft-created", by: currentUserString(), at: new Date().toISOString() },
      ],
    });
    setDraftItemId(refDoc.id);
    return refDoc.id;
  }

  const nextStep = async () => {
    console.debug("[Wizard] nextStep from", currentStep, "draftItemId =", draftItemId);
    if (currentStep === 1 && !draftItemId) {
      await ensureDraftItem(); // skapa draft och få stabilt itemId tidigt
    }
    const newStep = Math.min(currentStep + 1, TOTAL_STEPS);
    setCurrentStep(newStep);
    await updateDraftMeta({ wizardStep: newStep });
  };

  const prevStep = async () => {
    const newStep = Math.max(currentStep - 1, 1);
    setCurrentStep(newStep);
    await updateDraftMeta({ wizardStep: newStep });
  };



  // Data & UI state
  const [manufacturerList, setManufacturerList] = useState<string[]>([
    "Lenovo",
    "HP",
    "Dell",
    "Apple",
    "Asus",
  ]);
  const [newManufacturer, setNewManufacturer] = useState<string>("");
  const [isLoadingItems, setIsLoadingItems] = useState<boolean>(false);
  const [showNewManufacturerInput, setShowNewManufacturerInput] = useState<boolean>(false);
  const manufacturerExists = useMemo(() => {
    const v = newManufacturer.trim();
    if (!v) return false;
    return manufacturerList.some((m) => toKey(m) === toKey(v));
  }, [manufacturerList, newManufacturer]);

  const [form, setForm] = useState<FormState>({
    orderNumber: "",
    manufacturer: "",
    model: "",
    serial: "",
    chargerIncluded: false,
    damageNotes: "",
    customer: "",
    articleNumber: "",
    photos: { keyboard: null, screen: null, underside: null, topside: null },

    reuse: false,
    resold: false,
    scrap: false,
  });

  const [thumbnailPreviews, setThumbnailPreviews] = useState<ThumbnailMap>({});
  const [selectedItems, setSelectedItems] = useState<string[]>([]);

  const [filters, setFilters] = useState<Filters>({
    orderNumber: "",
    manufacturer: "",
    model: "",
    serial: "",
    chargerIncluded: "",
    createdAt: "",
    createdBy: "",
  });

  const [largeImage, setLargeImage] = useState<string | null>(null);
  const [isEditOpen, setIsEditOpen] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [editIsReadOnly, setEditIsReadOnly] = useState(false);
  const [editInvoiceReportId, setEditInvoiceReportId] = useState<string | null>(null);
  const lockWatcherUnsub = React.useRef<Unsubscribe | null>(null);

  // --- Heartbeat för lås medan Edit-modalen är öppen ---
  const lockHeartbeatRef = React.useRef<number | null>(null);

  function stopLockHeartbeat() {
    if (lockHeartbeatRef.current != null) {
      clearInterval(lockHeartbeatRef.current);
      lockHeartbeatRef.current = null;
    }
  }

  function startLockHeartbeat(itemId: string) {
    // starta alltid om (id kan bytas om man öppnar annan post)
    stopLockHeartbeat();
    lockHeartbeatRef.current = window.setInterval(async () => {
      try {
        // Håll låset fräscht endast om JAG fortfarande håller det
        await runTransaction(db, async (tx) => {
          const r = doc(db, "itInventory", itemId);
          const s = await tx.get(r);
          if (!s.exists()) return;
          const cur = s.data() as any;
          if (cur.lockedBy === currentUserString()) {
            tx.update(r, { lockedAt: serverTimestamp() } as any);
          }
        });
      } catch {
        // tyst – nätverksglitchar tillåts; nästa puls försöker igen
      }
    }, LOCK_HEARTBEAT_MS);
  }

  // --- Real-time lock watcher (växlar till read-only om du tappar låset) ---
  function stopLockWatcher() {
    if (lockWatcherUnsub.current) {
      lockWatcherUnsub.current();       // avregistrera onSnapshot
      lockWatcherUnsub.current = null;
    }
  }

  function startLockWatcher(itemId: string) {
    // starta alltid om (nytt itemId kan väljas)
    stopLockWatcher();

    const r = doc(db, "itInventory", itemId);
    lockWatcherUnsub.current = onSnapshot(r, (snap) => {
      if (!snap.exists()) return;
      const cur = snap.data() as any;
      const me = currentUserString?.() ?? null;

      // Om någon annan tar låset ELLER posten blir fakturerad → växla till read-only och avisera
      const takenByOther = !!cur.lockedBy && cur.lockedBy !== me;
      const nowInvoiced = !!cur.invoiceReportId;

      if ((takenByOther || nowInvoiced) && !editIsReadOnly) {
        // sluta skicka heartbeat om vi inte längre äger låset
        stopLockHeartbeat();
        setEditIsReadOnly(true);

        // enkel avisering (kan ersättas med UI-banner senare)
        if (nowInvoiced) {
          alert("Posten låstes för fakturering under tiden. Fönstret är nu skrivskyddat.");
        } else {
          alert(`Låset togs över av ${cur.lockedBy}. Fönstret är nu skrivskyddat.`);
        }
      }


    });
  }


  useEffect(() => {
    if (!isEditOpen) {
      stopLockHeartbeat();
      stopLockWatcher();
    }
  }, [isEditOpen]);



  // Sammanlagd procent från alla bild-uploads
  const progressValues = Object.values(uploadProgress || {});
  const overallProgress = progressValues.length
    ? Math.round(progressValues.reduce((a, b) => a + b, 0) / progressValues.length)
    : 0;

  // Mobil: visa/dölj filter-panel
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState<boolean>(false);
  const [editForm, setEditForm] = useState<EditFormState>({
    orderNumber: "",
    manufacturer: "",
    model: "",
    serial: "",
    chargerIncluded: false,
    damageNotes: "",
    createdBy: null,
    createdAt: null,
    auditLog: [],
    photos: {},
    completed: false,
    completedAt: null,
    completedBy: null,
    reuse: false,
    resold: false,
    scrap: false,
    grade: ""
  });


  // Modeller per tillverkare
  const [modelList, setModelList] = useState<string[]>([]);
  const [newModel, setNewModel] = useState<string>("");
  const [showNewModelInput, setShowNewModelInput] = useState<boolean>(false);

  const [customerList, setCustomerList] = useState<string[]>(["Samhall"]);
  const [newCustomer, setNewCustomer] = useState("");
  const [showNewCustomerInput, setShowNewCustomerInput] = useState(false);

  // Artiklar per kund
  const [articleList, setArticleList] = useState<string[]>([]);
  const [newArticle, setNewArticle] = useState("");
  const [showNewArticleInput, setShowNewArticleInput] = useState(false);

  const modelExistsForThisManufacturer = useMemo(() => {
    const v = newModel.trim();
    if (!v) return false;
    return modelList.some((m) => toKey(m) === toKey(v));
  }, [modelList, newModel]);

  // Mobilbrytarstate (uppdateras vid resize)
  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* Effects */
  useEffect(() => {
    fetchItems();
    fetchManufacturers();
    fetchCustomers(); // ny
  }, []);

  useEffect(() => {
    // Om man råkar hamna efter steg 2 utan vald kund: tvinga tillbaka till steg 2
    if (activePage === "home" && currentStep > 2 && !form.customer.trim()) {
      setCurrentStep(2);
    }
  }, [activePage, currentStep, form.customer]);


  useEffect(() => {
    fetchModelsFor(form.manufacturer);
    setForm((prev) => ({ ...prev, model: "" }));
    setShowNewModelInput(false);
    setNewModel("");
  }, [form.manufacturer]);

  useEffect(() => {
    fetchArticlesFor(form.customer);
    setForm(prev => ({ ...prev, articleNumber: "" }));
    setShowNewArticleInput(false);
    setNewArticle("");
  }, [form.customer]);

  useEffect(() => {
    fetchArticlesFor(form.customer);
    setForm(prev => ({ ...prev, articleNumber: "" }));
    setShowNewArticleInput(false);
    setNewArticle("");
  }, [form.customer]);

  /* Fetchers */
  const fetchItems = async (): Promise<void> => {
    setIsLoadingItems(true);
    try {
      const qs = await getDocs(query(collection(db, "itInventory")));
      const mapped: Item[] = qs.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Item[];
      setItems(mapped);
    } finally {
      setIsLoadingItems(false);
    }
  };

  const fetchManufacturers = async (): Promise<void> => {
    try {
      const qs = await getDocs(query(collection(db, "manufacturers")));
      const names = qs.docs.map((d) => (d.data() as any).name as string).filter(Boolean);
      const seen = new Set<string>();
      const unique: string[] = [];
      for (const n of names) {
        const k = toKey(n);
        if (!seen.has(k)) { seen.add(k); unique.push(n); }
      }
      setManufacturerList(
        unique.sort((a, b) => a.localeCompare(b, "sv", { sensitivity: "base" }))
      );
    } catch (e: any) {
      console.error("Kunde inte hämta tillverkare:", e.message);
    }
  };

  const fetchModelsFor = async (manufacturer: string): Promise<void> => {
    if (!manufacturer) { setModelList([]); return; }
    try {
      const qs = await getDocs(
        query(collection(db, "models"), where("manufacturer", "==", manufacturer))
      );
      const names = qs.docs.map((d) => (d.data() as any)?.name as string).filter(Boolean);

      // case-insensitiv dedupe
      const seen = new Set<string>();
      const unique: string[] = [];
      for (const n of names) {
        const k = toKey(n);
        if (!seen.has(k)) { seen.add(k); unique.push(n); }
      }

      setModelList(unique.sort((a, b) => a.localeCompare(b, "sv", { sensitivity: "base" })));
    } catch (err: any) {
      console.error("Kunde inte hämta modeller:", err.message);
    }
  };

  /* Helpers */
  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ): void => {
    const t = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const { name, type, value } = t;
    const v = type === "checkbox" ? (t as HTMLInputElement).checked : value;
    setForm((prev) => ({ ...prev, [name]: v }));
  };


  const handleNewManufacturerAdd = async (): Promise<void> => {
    const trimmed = newManufacturer.trim();
    if (!trimmed) return;
    try {
      await addDoc(collection(db, "manufacturers"), { name: trimmed });
      setManufacturerList((prev) => [...prev, trimmed]);
      setForm((prevForm) => ({ ...prevForm, manufacturer: trimmed }));
      setNewManufacturer("");
      setShowNewManufacturerInput(false);
    } catch (err: any) {
      console.error("Kunde inte lägga till tillverkare:", err.message);
      alert("Fel vid tillägg av tillverkare");
    }
  };

  // Hämta kunder (case-dedupe)
  const fetchCustomers = async (): Promise<void> => {
    try {
      const qs = await getDocs(query(collection(db, "customers")));
      const names = qs.docs.map(d => (d.data() as any).name as string).filter(Boolean);

      const seen = new Set<string>(); const unique: string[] = [];
      for (const n of [...customerList, ...names]) {
        const k = toKey(n); if (!seen.has(k)) { seen.add(k); unique.push(n); }
      }
      setCustomerList(unique.sort((a, b) => a.localeCompare(b, "sv", { sensitivity: "base" })));
    } catch (e: any) {
      console.error("Kunde inte hämta kunder:", e.message);
    }
  };

  // Hämta artiklar för vald kund (case-dedupe + Samhall-defaults)
  const fetchArticlesFor = async (customer: string): Promise<void> => {
    if (!customer) { setArticleList([]); return; }
    try {
      const qs = await getDocs(query(collection(db, "articles"), where("customer", "==", customer)));
      const names = qs.docs.map(d => (d.data() as any).name as string).filter(Boolean);

      const seen = new Set<string>(); const unique: string[] = [];
      for (const n of names) { const k = toKey(n); if (!seen.has(k)) { seen.add(k); unique.push(n); } }

      const defaults = customer === "Samhall"
        ? ["Samhall_PC_Large", "Samhall_PC_Medium", "Samhall_PC_Small"] : [];
      for (const n of defaults) { const k = toKey(n); if (!seen.has(k)) { seen.add(k); unique.push(n); } }

      setArticleList(unique.sort((a, b) => a.localeCompare(b, "sv", { sensitivity: "base" })));
    } catch (e: any) {
      console.error("Kunde inte hämta artiklar:", e.message);
    }
  };


  // Lägg till ny artikel (per kund) – varna om den finns hos annan kund
  const handleNewArticleAdd = async (): Promise<void> => {
    const trimmed = newArticle.trim(); if (!trimmed || !form.customer) return;
    const key = toKey(trimmed);

    if (articleList.some(a => toKey(a) === key)) {
      alert("Modell/artikel finns redan för kunden.");
      setForm(p => ({ ...p, articleNumber: articleList.find(a => toKey(a) === key)! }));
      setNewArticle(""); setShowNewArticleInput(false);
      return;
    }
    try {
      const all = await getDocs(query(collection(db, "articles")));
      const hit = all.docs.map(d => d.data() as any).find(r => r?.name && toKey(r.name) === key);

      if (hit) {
        const other = String(hit.customer || "");
        if (toKey(other) !== toKey(form.customer)) {
          if (!window.confirm(`Artikeln finns redan hos "${other}". Vill du spara ändå för "${form.customer}"?`)) return;
        } else {
          alert("Modell/artikel finns redan för kunden.");
          setForm(p => ({ ...p, articleNumber: hit.name as string }));
          setNewArticle(""); setShowNewArticleInput(false);
          await fetchArticlesFor(form.customer);
          return;
        }
      }

      await addDoc(collection(db, "articles"), { customer: form.customer, name: trimmed });
      await fetchArticlesFor(form.customer);
      setForm(p => ({ ...p, articleNumber: trimmed }));
      setNewArticle(""); setShowNewArticleInput(false);
    } catch (e: any) {
      alert("Fel vid tillägg av artikel");
    }
  };

  const handleNewModelAdd = async (): Promise<void> => {
    const trimmed = newModel.trim();
    const manufacturer = form.manufacturer;
    if (!trimmed || !manufacturer) return;

    const key = toKey(trimmed);

    // 1) Lokal koll mot vald tillverkare
    if (modelExistsForThisManufacturer) {
      alert("Modell finns redan för tillverkare.");
      // välj befintlig kanonisk stavning
      const existing = modelList.find((m) => toKey(m) === key)!;
      setForm((prev) => ({ ...prev, model: existing }));
      setNewModel("");
      setShowNewModelInput(false);
      return;
    }

    try {
      // 2) Kolla om modellen redan finns i någon annan tillverkare
      const all = await getDocs(query(collection(db, "models")));
      // Hitta första träffen med samma modellnamn (case-insensitivt)
      const hit = all.docs
        .map((d) => d.data() as any)
        .find((r) => r?.name && toKey(r.name) === key);

      if (hit) {
        const otherMan = String(hit.manufacturer || "");
        if (toKey(otherMan) !== toKey(manufacturer)) {
          const ok = window.confirm(
            `Modellen finns redan för tillverkare "${otherMan}". Vill du spara ändå för "${manufacturer}"?`
          );
          if (!ok) return; // avbryt utan att spara
        } else {
          // Säkerhetsbälte om lokala listan släpat efter
          alert("Modell finns redan för tillverkare.");
          const existing = hit.name as string;
          setForm((prev) => ({ ...prev, model: existing }));
          setNewModel("");
          setShowNewModelInput(false);
          await fetchModelsFor(manufacturer);
          return;
        }
      }

      // 3) Lägg till modellen för vald tillverkare
      await addDoc(collection(db, "models"), { manufacturer, name: trimmed });
      await fetchModelsFor(manufacturer); // uppdatera lista (med dedupe)
      setForm((prev) => ({ ...prev, model: trimmed }));
      setNewModel("");
      setShowNewModelInput(false);
    } catch (err: any) {
      console.error("Kunde inte lägga till modell:", err.message);
      alert("Fel vid tillägg av modell");
    }
  };

  // Lägg till ny kund (dublettskydd)
  const handleNewCustomerAdd = async (): Promise<void> => {
    const trimmed = newCustomer.trim(); if (!trimmed) return;
    const key = toKey(trimmed);

    if (customerList.some(c => toKey(c) === key)) {
      alert("Kunden finns redan.");
      setForm(p => ({ ...p, customer: customerList.find(c => toKey(c) === key)! }));
      setNewCustomer(""); setShowNewCustomerInput(false);
      return;
    }
    try {
      const qs = await getDocs(query(collection(db, "customers")));
      const remote = qs.docs.map(d => (d.data() as any).name as string).find(n => toKey(n) === key);
      if (remote) {
        alert("Kunden finns redan.");
        setForm(p => ({ ...p, customer: remote }));
        setNewCustomer(""); setShowNewCustomerInput(false);
        await fetchCustomers();
        return;
      }
      await addDoc(collection(db, "customers"), { name: trimmed });
      await fetchCustomers();
      setForm(p => ({ ...p, customer: trimmed }));
      setNewCustomer(""); setShowNewCustomerInput(false);
    } catch (e: any) {
      alert("Fel vid tillägg av kund");
    }
  };

  const compressImage = (file: File, quality = 0.9, maxDim = 1920): Promise<string> =>
    new Promise((resolve) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = (e) => {
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          let { width, height } = img;

          if (width > maxDim || height > maxDim) {
            const ratio = width > height ? maxDim / width : maxDim / height;
            width *= ratio;
            height *= ratio;
          }

          canvas.width = width;
          canvas.height = height;
          ctx?.drawImage(img, 0, 0, width, height);

          const tryCompress = (q: number) => {
            const dataUrl = canvas.toDataURL("image/jpeg", q);
            const byteLength = atob(dataUrl.split(",")[1]).length;
            if (byteLength <= MAX_IMAGE_SIZE || q <= 0.3) resolve(dataUrl);
            else tryCompress(q - 0.1);
          };
          tryCompress(quality);
        };
        img.src = (e.target as FileReader).result as string;
      };
      reader.readAsDataURL(file);
    });

  const handlePhotoChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
    photoType: PhotoKey
  ): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    const compressedDataUrl = await compressImage(file);
    setForm((prev) => ({ ...prev, photos: { ...prev.photos, [photoType]: compressedDataUrl }, }));
    setThumbnailPreviews((prev) => ({
      ...prev,
      [photoType]: compressedDataUrl,
    }));
  };

  const handleRemovePhoto = (photoType: PhotoKey): void => {
    setForm((prev) => ({ ...prev, photos: { ...prev.photos, [photoType]: null }, }));
    setThumbnailPreviews((prev) => ({ ...prev, [photoType]: null }));
  };

  const saveData = async (): Promise<void> => {
    if (isSaving) return; // 🛑 skydd mot dubbelklick

    if (!form.manufacturer || !form.model || !form.serial) {
      alert("Fyll i tillverkare, modell och serienummer.");
      return;
    }

    setIsSaving(true);
    setUploadProgress({}); // nollställ eventuell gamal progresstv

    // ⛑️ W1d: Safety net – se till att vi har ett draft-ID innan spar
    if (!draftItemId) {
      await ensureDraftItem();
    }

    const steps = computeBillingSteps({
      reuse: !!form.reuse,
      resold: !!form.resold,
      scrap: !!form.scrap,
    });

    // Bas & nyckel för index
    const baseSerial = (form.serial || "").trim();
    const baseKey = normalizeSerialKey(baseSerial);

    try {
      // 1) Reservér nästa visit + skapa posten (utan photos) i en transaction
      const { itemRef, finalSerial } = await runTransaction(db, async (tx) => {
        const indexRef = doc(collection(db, "serialIndex"), baseKey);
        const indexSnap = await tx.get(indexRef);

        const prevVisits = indexSnap.exists()
          ? Number(((indexSnap.data() as any).visits || 0))
          : 0;
        const prevActive = indexSnap.exists()
          ? Number(((indexSnap.data() as any).active || 0))
          : 0;

        // ✅ Skapa itemRef först så vi kan använda id i claim
        const newItemRef = draftItemId
          ? doc(db, "itInventory", draftItemId)
          : doc(collection(db, "itInventory"));

        // Claim:a första lediga visit för denna serialBase
        let visitCandidate = prevVisits + 1;
        while (true) {
          const claimRef = doc(db, "serialIndex", baseKey, "claims", String(visitCandidate));
          const claimSnap = await tx.get(claimRef);
          if (!claimSnap.exists()) {
            tx.set(claimRef, {
              itemId: newItemRef.id,
              at: serverTimestamp(),
              by: currentUserString(),
            });
            break;
          }
          visitCandidate++;
        }

        // Använd den faktiskt claimade visiten
        const nextVisit = visitCandidate;
        const nextActive = prevActive + 1;
        const final = nextVisit > 1 ? `${baseSerial}*${nextVisit}` : baseSerial;


        // Sätt själva itemet, utan photos (vi patchar in senare efter upload)
        tx.set(newItemRef, {
          orderNumber: form.orderNumber || "",
          manufacturer: form.manufacturer,
          model: form.model,

          isDraft: false, // ⬅️ lägg till denna rad
          wizardStep: null,      // ← lägg till denna

          // 👇 viktiga fält
          serial: final,              // t.ex. "ABC123*2"
          serialBase: baseSerial,     // "ABC123"
          serialBaseKey: baseKey,     // "ABC123"
          serialVisit: nextVisit,     // 1, 2, 3, ...

          chargerIncluded: form.chargerIncluded,
          damageNotes: form.damageNotes,
          photos: {}, // patchas efter upload

          createdAt: serverTimestamp(),
          createdBy: currentUserString(),
          lockedBy: null,
          lockedAt: null,
          deletePending: false,
          deleteMarkedBy: null,
          deleteMarkedAt: null,

          customer: form.customer,
          articleNumber: form.articleNumber,

          reuse: !!form.reuse,
          resold: !!form.resold,
          scrap: !!form.scrap,

          ...steps,

          auditLog: [
            { action: "created", by: currentUserString(), at: new Date().toISOString() },
          ] as AuditEntry[],

          completed: false,
          completedAt: null,
          completedBy: null,
        } as WithFieldValue<BaseItem>);

        // Uppdatera/Skapa indexet
        tx.set(
          indexRef,
          {
            visits: nextVisit,
            active: nextActive,
            lastItemId: newItemRef.id,
            updatedAt: serverTimestamp(), // import finns redan högst upp
          },
          { merge: true }
        );

        // Returvärden från transaction
        return { itemRef: newItemRef, finalSerial: final };
      });

      await updateDoc(itemRef, { expiresAt: deleteField(), updatedAt: serverTimestamp() });

      // 2) Ladda upp bilder (om några) och patcha in URLs — med progress
      const photoURLs: PhotoURLMap = {};
      setUploadProgress({}); // nollställ progress-kartan

      for (const [key, dataUrl] of Object.entries(form.photos)) {
        if (!dataUrl) continue;

        // initiera 0% för denna nyckel
        setUploadProgress((prev) => ({ ...prev, [key]: 0 }));

        try {
          const url = await uploadDataUrlWithProgress(
            dataUrl,
            `photos/${itemRef.id}/${key}.jpg`,
            (pct) => setUploadProgress((prev) => ({ ...prev, [key]: pct }))
          );
          photoURLs[key] = url;
        } catch (e: any) {
          console.warn(`Uppladdning misslyckades för ${key}:`, e?.message || e);
          // hoppa över just den bilden och fortsätt med resten
        }
      }

      if (Object.keys(photoURLs).length > 0) {
        const updates: any = { updatedAt: serverTimestamp() };
        for (const [type, url] of Object.entries(photoURLs)) {
          updates[`photos.${type}`] = url;   // patcha slot för slot
        }
        await updateDoc(itemRef, updates);
      }

      alert(`Enhet sparad som ${finalSerial}.`);

      // 3) Återställ formuläret
      setForm({
        orderNumber: "",
        manufacturer: "",
        model: "",
        serial: "",
        chargerIncluded: false,
        damageNotes: "",
        customer: "",
        articleNumber: "",
        photos: { keyboard: null, screen: null, underside: null, topside: null },
        reuse: false,
        resold: false,
        scrap: false,
      });
      setDraftItemId(null); // viktigt: så nästa wizard-start får ett nytt draft-ID
      setThumbnailPreviews({});
      fetchItems();
      setCurrentStep(1);
    } catch (err: any) {
      console.error(err);
      alert("Kunde inte spara: " + (err?.message || err));
    } finally {
      setIsSaving(false); // ✅ återaktivera UI
    }
  };




  /* Delete */
  const toggleSelection = (id: string): void => {
    setSelectedItems((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  // === Delete: härled vilka markerade (deletePending) som faktiskt går att radera nu ===
  const pendingDeletableIds = useMemo<string[]>(() => {
    return items
      .filter((it) =>
        it.deletePending &&
        !it.completed &&
        (!it.lockedBy || it.lockedBy === currentUserString()))
      .map((it) => it.id);
  }, [items]);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const openDeleteModal = (): void => {
    if (pendingDeletableIds.length === 0) return;
    setDeleteConfirmText("");
    setShowDeleteModal(true);
  };

  const cancelDeleteModal = (): void => {
    setShowDeleteModal(false);
    setDeleteConfirmText("");
  };

  const confirmDeleteModal = async (): Promise<void> => {
    if (deleteConfirmText !== "DELETE") return;
    await deletePendingMarked(); // din befintliga raderingsfunktion (utan lösenordsprompt)
    setShowDeleteModal(false);
    setDeleteConfirmText("");
  };

  const deletePendingMarked = async (): Promise<void> => {
    const ids = pendingDeletableIds.slice(); // snapshot av nu

    if (ids.length === 0) {
      alert("Inget att radera.");
      return;
    }

    // Bygg raderingsordning: gruppera per bas och sortera visit fallande
    type DeletionItem = { id: string; baseKey: string; visitNum: number };

    const deletions: DeletionItem[] = ids
      .map((id) => {
        const it = items.find((x) => x.id === id);
        if (!it) return null;
        const { base: baseFromSerial, visit: visitFromSerial } = splitSerialParts(String(it.serial || ""));
        const baseKey = (it as any).serialBaseKey ?? normalizeSerialKey(baseFromSerial || "");
        const visitNum = Number((it as any).serialVisit ?? visitFromSerial ?? 1);
        return { id, baseKey, visitNum };
      })
      .filter(Boolean) as DeletionItem[];

    // Sortera per bas, och inom bas: högsta visit först
    deletions.sort((a, b) => {
      if (a.baseKey < b.baseKey) return -1;
      if (a.baseKey > b.baseKey) return 1;
      return b.visitNum - a.visitNum;
    });

    // Behåll URL:er lokalt för efterföljande bildradering (utanför transaktionen)
    const photoMap: Record<string, string[]> = {};
    for (const { id } of deletions) {
      const it = items.find(i => i.id === id);
      if (it?.photos) {
        photoMap[id] = Object.values(it.photos).filter(Boolean) as string[];
      }
    }

    let ok = 0;
    for (const { id } of deletions) {
      try {
        await runTransaction(db, async (tx) => {
          const itemRef = doc(db, "itInventory", id);
          const snap = await tx.get(itemRef);
          if (!snap.exists()) return; // redan borta

          const cur = snap.data() as any;

          // Sista spärrar i transaktionen
          if (cur.completed) throw new Error("Kan inte radera – enheten är markerad som färdig.");
          if (cur.invoiceReportId) throw new Error("Kan inte radera – enheten är fakturerad.");
          if (cur.markedForInvoice === true && !cur.invoiceReportId) {
            throw new Error("Kan inte radera – enheten är markerad för fakturering.");
          }
          if (cur.lockedBy && cur.lockedBy !== currentUserString()) {
            throw new Error(`Kan inte radera – posten redigeras av ${cur.lockedBy}.`);
          }

          // --- Bestäm bas och visit för posten som raderas ---
          const { base: baseFromSerial, visit: visitFromSerial } = splitSerialParts(String(cur.serial || ""));
          const baseKey: string = cur.serialBaseKey || normalizeSerialKey(baseFromSerial || "");
          const visitNum: number = Number(cur.serialVisit || visitFromSerial || 1);

          // --- Läs & uppdatera index FÖRE delete (alla reads före writes per tx) ---
          if (baseKey) {
            const idxRef = doc(collection(db, "serialIndex"), baseKey);
            const idxSnap = await tx.get(idxRef);

            const prevVisits = idxSnap.exists() ? Number(((idxSnap.data() as any).visits || 0)) : 0;
            const prevActive = idxSnap.exists() ? Number(((idxSnap.data() as any).active || 0)) : 0;

            // active-- alltid när posten lämnar basen
            const nextActive = Math.max(0, prevActive - 1);

            // poppa topp-visit om denna post var topp; annars lämna
            let nextVisits = prevVisits;
            if (prevVisits === visitNum) {
              nextVisits = Math.max(0, prevVisits - 1);
            }

            // om basen blir tom → nolla visits
            if (nextActive === 0) {
              nextVisits = 0;
            }

            tx.set(
              idxRef,
              { active: nextActive, visits: nextVisits, updatedAt: serverTimestamp() },
              { merge: true }
            );
          }

          // --- Delete själva itemet ---
          tx.delete(itemRef);
        });

        const urls = photoMap[id] || [];
        for (const url of urls) {
          try {
            const path = new URL(url).pathname.split("/o/")[1].split("?")[0];
            const storageRefObj = ref(storage, decodeURIComponent(path));
            await deleteObject(storageRefObj);
          } catch (err: any) {
            // Tysta 404 (fil fanns inte); logga bara andra fel mjukt
            if (err?.code !== "storage/object-not-found") {
              console.debug("Delete (by URL) misslyckades:", err?.code || err);
            }
          }
        }

        ok += 1;
      } catch (e: any) {
        console.warn(`Kunde inte radera ${id}:`, e?.message || e);
        // fortsätt med nästa id
      }
    }

    // Sammanfattning + refresh
    alert(`Raderade ${ok} av ${deletions.length} markerad(e) enhet(er).`);
    setSelectedItems([]);
    fetchItems();

  };


  const deleteSelected = async (): Promise<void> => {
    // Filtrera bort färdiga/fakturerade (defense-in-depth)
    const deletableIds = selectedItems.filter((id) => {
      const it = items.find((i) => i.id === id);
      return it && !it.completed && !it.invoiceReportId && !it.markedForInvoice;
    });

    if (deletableIds.length === 0) {
      alert("Inga valda enheter kan raderas (färdiga/fakturerade kan inte raderas).");
      return;
    }
    if (deletableIds.length !== selectedItems.length) {
      console.info("Hoppar över färdiga/fakturerade enheter vid radering.");
    }

    for (const id of deletableIds) {
      // 0) Plocka foton före tx (för efterföljande Storage-delete)
      let photosToDelete: string[] = [];
      try {
        const preSnap = await getDoc(doc(db, "itInventory", id));
        if (!preSnap.exists()) continue;
        const pre = preSnap.data() as any;

        if (pre.completed || pre.invoiceReportId) continue;
        if (pre.lockedBy && pre.lockedBy !== currentUserString()) {
          console.warn(`Skippar radering för ${id} – låst av ${pre.lockedBy}`);
          continue;
        }
        photosToDelete = Object.values(pre.photos || {}).filter(Boolean) as string[];
      } catch (e) {
        console.warn("Förladdning av foton misslyckades, fortsätter ändå:", e);
      }

      try {
        // 1) Transaktion: ev. POP i serialIndex, sen DELETE av item
        await runTransaction(db, async (tx) => {
          const itemRef = doc(db, "itInventory", id);
          const itemSnap = await tx.get(itemRef);
          if (!itemSnap.exists()) return; // redan borta
          const cur = itemSnap.data() as any;

          // spärrar i tx
          if (cur.completed) throw new Error("Kan inte radera – enheten är markerad som färdig.");
          if (cur.invoiceReportId) throw new Error("Kan inte radera – enheten är fakturerad.");

          if (cur.markedForInvoice === true && !cur.invoiceReportId) {
            throw new Error("Kan inte radera – enheten är markerad för fakturering.");
          }



          if (cur.lockedBy && cur.lockedBy !== currentUserString()) {
            throw new Error(`Kan inte radera – posten redigeras av ${cur.lockedBy}.`);
          }

          // nyckel + visit för basen som lämnas
          const { base: oldBase, visit: parsedVisit } = splitSerialParts(String(cur.serial || ""));
          const oldKey = normalizeSerialKey(oldBase);
          const oldVisit = Number(cur.serialVisit || parsedVisit || 1);

          // Läs index FÖRE några writes
          if (oldKey) {
            const oldRef = doc(collection(db, "serialIndex"), oldKey);
            const oldIdxSnap = await tx.get(oldRef);
            const oldVisits = oldIdxSnap.exists()
              ? Number(((oldIdxSnap.data() as any).visits || 0))
              : 0;

            // POP endast om denna post hade topp-visit på gamla basen
            if (oldVisits === Number(oldVisit || 0)) {
              const dec = Math.max(0, oldVisits - 1);
              tx.set(oldRef, { visits: dec, updatedAt: new Date() }, { merge: true });
            }
          }

          // Själva raderingen av posten
          tx.delete(itemRef);

        });

        // 2) Efter commit: radera foton i Storage (best effort)
        for (const url of photosToDelete) {
          try {
            const path = new URL(url).pathname.split("/o/")[1].split("?")[0];
            const storageRef = ref(storage, decodeURIComponent(path));
            await deleteObject(storageRef);
          } catch (err: any) {
            console.warn("Kunde inte radera bild:", err?.message || err);
          }
        }
      } catch (err: any) {
        console.error("Raderingsfel för", id, err);
        alert(`Kunde inte radera en post: ${err?.message || err}`);
      }
    }

    alert("Markerade enheter raderade.");
    setSelectedItems([]);
    fetchItems();
  };

  /* Edit */
  const openEdit = async (item: Item): Promise<void> => {
    try {
      const ref = doc(db, "itInventory", item.id);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        alert("Kunde inte öppna – posten finns inte längre.");
        return;
      }
      const data = snap.
        data() as any;

      // 🔒 Tillfällig spärr: markerad för faktura (ej fakturerad)
      if (data.markedForInvoice === true && !data.invoiceReportId) {
        alert("Detta objekt är markerat för fakturering och är tillfälligt spärrat för editering. Avmarkera i Fakturering för att öppna igen.");
        return;
      }

      // 🧾 Fakturerad = öppna i read-only + spara report-id
      if (data.invoiceReportId) {
        setEditIsReadOnly(true);
        setEditInvoiceReportId(String(data.invoiceReportId));
      } else {
        setEditIsReadOnly(false);
        setEditInvoiceReportId(null);

        // 🔐 CAS-låsning + TTL – vem som helst kan låsa om ledigt, eller ta över om låset är gammalt
        if (!data.completed) {
          try {
            await runTransaction(db, async (tx) => {
              const fresh = await tx.get(ref);
              if (!fresh.exists()) throw new Error("Posten finns inte längre.");
              const cur = fresh.data() as any;

              // Blockera fakturerad/permalåst
              if (cur.invoiceReportId) {
                throw new Error("Enheten är fakturerad och permalåst.");
              }

              // TTL-bedömning
              const heldByOther = !!cur.lockedBy && cur.lockedBy !== currentUserString();
              const lockedAtMs = toMillis(cur.lockedAt);
              const isStale = lockedAtMs === null ? true : (Date.now() - lockedAtMs) > LOCK_STALE_MS;

              if (heldByOther && !isStale) {
                throw new Error(`Posten redigeras av ${cur.lockedBy}.`);
              }

              // Ta/övertag lås
              tx.update(ref, {
                lockedBy: currentUserString(),
                lockedAt: serverTimestamp(),
              } as any);
            });

            startLockHeartbeat(item.id);

          } catch (e: any) {
            alert(e?.message ?? "Kunde inte låsa posten för redigering.");
            return; // öppna inte edit-modalen om vi inte fick lås
          }
        }
        startLockWatcher(item.id);
      }


      // ✅ Fyll form från färska data och öppna

      setEditId(item.id);
      setEditForm({
        orderNumber: data.orderNumber || "",
        manufacturer: data.manufacturer || "",
        model: data.model || "",
        serial: data.serial || "",
        chargerIncluded: !!data.chargerIncluded,
        damageNotes: data.damageNotes || "",
        createdBy: data.createdBy || data.initials || null,
        createdAt: data.createdAt || null,
        auditLog: Array.isArray(data.auditLog) ? data.auditLog : [],
        photos: data.photos || {},
        completed: !!data.completed,
        completedAt: data.completedAt || null,
        deletePending: !!data.deletePending,
        deleteMarkedBy: data.deleteMarkedBy || null,
        deleteMarkedAt: data.deleteMarkedAt || null,
        completedBy: data.completedBy || null,
        reuse: !!data.reuse,
        resold: !!data.resold,
        scrap: !!data.scrap,
        grade: data.grade || ""
      });
      setIsEditOpen(true);
    } catch (e: any) {
      console.error(e);
    }
  };


  const handleEditChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ): void => {
    const t = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const { name, type, value } = t;
    const v = type === "checkbox" ? (t as HTMLInputElement).checked : value;
    setEditForm((prev) => ({ ...prev, [name]: v }));
  };


  const saveEdit = async (): Promise<void> => {
    // Samma spärrar som du har idag
    if (editForm.deletePending) { alert("Denna enhet är markerad för radering ..."); return; }
    if (!editId) return;
    if (editIsReadOnly) { alert("Denna enhet är fakturerad ..."); return; }
    if (editForm.completed) { alert("Denna enhet är markerad som färdig ..."); return; }

    const selectedCount =
      Number(!!editForm.reuse) + Number(!!editForm.resold) + Number(!!editForm.scrap);
    if (selectedCount > 1) { alert("Du kan inte spara med mer än ett alternativ markerat."); return; }

    // Tillfällig spärr om markerad för fakturering (samma som idag)
    const preRef = doc(db, "itInventory", editId);
    try {
      const preSnap = await getDoc(preRef);
      const pre = preSnap.exists() ? (preSnap.data() as any) : null;
      if (pre?.markedForInvoice === true && !pre?.invoiceReportId) {
        alert("Detta objekt är markerat för fakturering och kan inte redigeras nu.");
        return;
      }
    } catch { }

    setIsSaving(true);
    try {
      const nowIso = new Date().toISOString();

      await runTransaction(db, async (tx) => {
        const itemRef = doc(db, "itInventory", editId);
        const snap = await tx.get(itemRef);
        if (!snap.exists()) throw new Error("Posten finns inte längre.");
        const cur = snap.data() as any;

        // Defense-in-depth
        if (cur.invoiceReportId) throw new Error("Enheten är fakturerad och permalåst.");
        if (cur.completed) throw new Error("Enheten är markerad som färdig och kan inte ändras.");
        {
          const heldByOther = !!cur.lockedBy && cur.lockedBy !== currentUserString();
          const lockedAtMs = toMillis(cur.lockedAt);
          const isStale = lockedAtMs === null ? true : (Date.now() - lockedAtMs) > LOCK_STALE_MS;
          if (heldByOther && !isStale) {
            throw new Error(`Posten redigeras av ${cur.lockedBy}.`);
          }
        }

        if (cur.lockedBy && cur.lockedBy !== currentUserString()) {
          throw new Error(`Posten redigeras av ${cur.lockedBy}.`);
        }

        // Faktureringssteg från status
        const steps = computeBillingSteps({
          reuse: !!editForm.reuse,
          resold: !!editForm.resold,
          scrap: !!editForm.scrap,
        }); // :contentReference[oaicite:3]{index=3}

        // --- Serial-hantering ---
        const { base: oldBase, visit: oldVisit } = splitSerialParts(String(cur.serial || ""));
        const oldKey = normalizeSerialKey(oldBase); // finns redan hos dig :contentReference[oaicite:4]{index=4}

        const { base: inputBase } = splitSerialParts(String(editForm.serial || ""));
        if (!inputBase) throw new Error("Serienummer saknas.");
        const newKey = normalizeSerialKey(inputBase);

        let serialVisit = Number(cur.serialVisit || oldVisit || 1);
        let serialBase = inputBase.trim();
        let serialBaseKey = newKey;

        if (newKey !== oldKey) {
          // --- PUSH på NY bas ---
          const newRef = doc(collection(db, "serialIndex"), newKey);
          const oldRef = doc(collection(db, "serialIndex"), oldKey);

          // 🔎 Läs ALLT före några writes (krav i Firestore-transaktioner)
          const [newSnap, oldSnap] = await Promise.all([tx.get(newRef), tx.get(oldRef)]);

          // --- Läs föregående värden ---
          const prevNewVisits = newSnap.exists() ? Number(((newSnap.data() as any).visits || 0)) : 0;
          const prevNewActive = newSnap.exists() ? Number(((newSnap.data() as any).active || 0)) : 0;

          const prevOldVisits = oldSnap.exists() ? Number(((oldSnap.data() as any).visits || 0)) : 0;
          const prevOldActive = oldSnap.exists() ? Number(((oldSnap.data() as any).active || 0)) : 0;

          // --- NY bas: visits++ och active++ ---
          const newVisits = prevNewVisits + 1;
          const newActive = prevNewActive + 1;
          serialVisit = newVisits; // visit för nya basen

          // ✍️ skriv NYA basens index
          tx.set(
            newRef,
            { visits: newVisits, active: newActive, lastItemId: editId, updatedAt: serverTimestamp() },
            { merge: true }
          );

          // --- GAMMAL bas: ev. pop och alltid active-- ---
          let nextOldActive = Math.max(0, prevOldActive - 1);
          let nextOldVisits = prevOldVisits;

          // Poppa ett steg om denna post hade topp-visit på gamla basen
          if (prevOldVisits === Number(oldVisit || 0)) {
            nextOldVisits = Math.max(0, prevOldVisits - 1);
          }

          // Om basen blir TOM (active -> 0) nollar vi visits helt
          if (nextOldActive === 0) {
            nextOldVisits = 0;
          }

          // ✍️ skriv GAMLA basens index
          tx.set(
            oldRef,
            { active: nextOldActive, visits: nextOldVisits, updatedAt: serverTimestamp() },
            { merge: true }
          );

        } else {
          // Samma bas → behåll visit (även om användaren skrivit t.ex. "*7" i UI)
        }


        const serial = buildDisplaySerial(serialBase, serialVisit); // finns redan hos dig :contentReference[oaicite:5]{index=5}

        // Skriv ALLT atomiskt
        tx.update(itemRef, {
          orderNumber: editForm.orderNumber || "",
          manufacturer: editForm.manufacturer || "",
          model: editForm.model || "",
          updatedAt: serverTimestamp(),

          // Serial + indexfält
          serial,
          serialBase,
          serialBaseKey,
          serialVisit,

          chargerIncluded: !!editForm.chargerIncluded,
          damageNotes: editForm.damageNotes ?? "",


          // Status
          reuse: !!editForm.reuse,
          resold: !!editForm.resold,
          scrap: !!editForm.scrap,

          grade: editForm.grade || "",

          // 1/0-kolumner
          ...(steps as any),

          // Audit
          auditLog: arrayUnion({ action: "updated", by: currentUserString(), at: nowIso }),
        } as any);
      });

      stopLockHeartbeat(); // ← stoppa pulsen nu
      stopLockWatcher();   // ← NY RAD

      // Släpp lås efter commit (samma som idag)
      try { await updateDoc(doc(db, "itInventory", editId), { lockedBy: null, lockedAt: null } as any); } catch { }

      alert("Enheten uppdaterad.");
      setIsEditOpen(false);
      setEditId(null);
      fetchItems();
    } catch (err: any) {
      console.error(err);
      alert("Kunde inte spara ändringar: " + (err?.message || err));
    } finally {
      setIsSaving(false);
    }
  };

  // Markera/avmarkera "för radering" från listan, utan att bumpa updatedAt
  const onToggleDeleteFromList = async (item: Item, toChecked: boolean) => {
    try {
      const ref = doc(db, "itInventory", item.id);
      const nowIso = new Date().toISOString();
      const me = currentUserString();

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Posten finns inte längre.");
        const cur = snap.data() as any;

        // Blockera fakturerad/färdig
        if (cur.invoiceReportId) throw new Error("Kan inte ändra – posten är fakturerad.");
        if (cur.completed) throw new Error("Kan inte ändra – posten är markerad som färdig.");

        // Låskontroll (TTL)
        const heldByOther = !!cur.lockedBy && cur.lockedBy !== me;
        const lockedAtMs = toMillis(cur.lockedAt);
        const isStale = lockedAtMs === null ? true : (Date.now() - lockedAtMs) > LOCK_STALE_MS;
        if (heldByOther && !isStale) {
          throw new Error(`Posten redigeras av ${cur.lockedBy}.`);
        }

        // No-op om samma status redan
        if (!!cur.deletePending === !!toChecked) return;

        // Skriv endast delete-fält + audit (ingen updatedAt här)
        tx.update(ref, {
          deletePending: toChecked,
          deleteMarkedBy: toChecked ? me : null,
          deleteMarkedAt: toChecked ? nowIso : null,
          auditLog: arrayUnion({
            action: toChecked ? "delete_marked" : "delete_unmarked",
            by: me,
            at: nowIso,
          }),
        } as UpdateData<BaseItem>);
      });

      // Optimistisk lokal uppdatering
      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id
            ? {
              ...it,
              deletePending: toChecked,
              deleteMarkedBy: toChecked ? me : null,
              deleteMarkedAt: toChecked ? nowIso : null,
              auditLog: Array.isArray((it as any).auditLog)
                ? [
                  ...(it as any).auditLog,
                  { action: toChecked ? "delete_marked" : "delete_unmarked", by: me, at: nowIso },
                ]
                : [{ action: toChecked ? "delete_marked" : "delete_unmarked", by: me, at: nowIso }],
            }
            : it
        )
      );
    } catch (e: any) {
      alert(e?.message || "Kunde inte ändra raderingsmarkeringen.");
    }
  };


  // ===== Fakturering: helper för att toggla markering på ett item =====
  async function setMarkedForInvoice(itemId: string, checked: boolean) {
    const user = currentUserString();
    const nowIso = new Date().toISOString();
    const ref = doc(db, "itInventory", itemId);

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Posten finns inte längre.");
        const cur = snap.data() as any;

        // 1) Permalås: redan fakturerad?
        if (cur.invoiceReportId) {
          throw new Error("Kan inte ändra — posten är fakturerad och permalåst.");
        }

        // 2) Låskontroll: respektera färskt lås hos annan (heartbeat)
        const heldByOther = !!cur.lockedBy && cur.lockedBy !== user;
        const lockedAtMs = toMillis(cur.lockedAt);
        const isStale = lockedAtMs === null ? true : (Date.now() - lockedAtMs) > LOCK_STALE_MS;
        if (heldByOther && !isStale) {
          throw new Error(`Kan inte ändra — posten redigeras av ${cur.lockedBy}.`);
        }

        // 3) Sätt reglerna för toggling
        if (checked === true) {
          // Markera för faktura kräver completed == true
          if (!cur.completed) {
            throw new Error("Objektet måste vara färdigmarkerat innan det kan markeras för fakturering.");
          }
          // (valfritt men rekommenderat) rensa raderingsflagga vid markering
          tx.update(ref, {
            markedForInvoice: true,
            deletePending: false,
            deleteMarkedBy: null,
            deleteMarkedAt: null,
            auditLog: arrayUnion({
              action: "marked_for_invoice",
              by: user,
              at: nowIso,
            }),
          });
        } else {
          // Avmarkering
          tx.update(ref, {
            markedForInvoice: false,
            auditLog: arrayUnion({
              action: "unmarked_for_invoice",
              by: user,
              at: nowIso,
            }),
          });
        }
      });
    } catch (err: any) {
      console.error("Kunde inte uppdatera markedForInvoice", err);
      alert(err?.message || "Kunde inte uppdatera markeringen. Försök igen.");
      throw err; // låt anroparen kunna rulla tillbaka optimistisk UI-state
    }
  }



  const markAsCompleted = async (): Promise<void> => {
    // blockera allt om posten är markerad för radering
    if (editForm.deletePending) {
      alert("Denna enhet är markerad för radering och kan inte ändras förrän raderingen avmarkeras i listan.");
      return;
    }

    if (!editId) return;

    // 🛑 Hårdvalidering (endast vid markera som färdig)
    const err = validateCompletionChoice(editForm);
    if (err) {
      alert(err);
      return;
    }


    try {
      const nowIso = new Date().toISOString();
      const user = currentUserString();

      // 1/0-kolumner för fakturering baserat på vald status
      const steps = computeBillingSteps({
        reuse: !!editForm.reuse,
        resold: !!editForm.resold,
        scrap: !!editForm.scrap,
      });

      const ref = doc(db, "itInventory", editId);

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Posten finns inte längre.");
        const cur = snap.data() as any;

        // Blockera fakturerad/permalåst
        if (cur.invoiceReportId) {
          throw new Error("Posten är redan låst för fakturering.");
        }

        // Låskontroll med TTL (tillåt inte spar om annan har färskt lås)
        const heldByOther = !!cur.lockedBy && cur.lockedBy !== user;
        const lockedAtMs = toMillis(cur.lockedAt);
        const isStale = lockedAtMs === null ? true : (Date.now() - lockedAtMs) > LOCK_STALE_MS;
        if (heldByOther && !isStale) {
          throw new Error(`Posten redigeras av ${cur.lockedBy}.`);
        }

        // Skriv status + completed + släpp lås + 1/0-kolumner + audit
        tx.update(ref, {
          // statusflaggor
          reuse: !!editForm.reuse,
          resold: !!editForm.resold,
          scrap: !!editForm.scrap,
          grade: editForm.grade || "",

          // markera som färdig
          completed: true,
          completedAt: serverTimestamp(), // <-- tidigare: nowIso
          completedBy: user,

          // släpp lås
          lockedBy: null,
          lockedAt: null,

          // 1/0-kolumner
          ...steps,

          // logg
          auditLog: arrayUnion({
            action: "completed",
            by: user,
            at: nowIso, // behåll din befintliga nowIso för loggradens texttid
          }),
        } as UpdateData<BaseItem>);
      });


      // Lokalt UI-state
      setEditForm(prev => ({
        ...prev,
        completed: true,
        completedAt: nowIso,
        completedBy: user,
        auditLog: [
          ...(Array.isArray(prev.auditLog) ? prev.auditLog : []),
          { action: "completed", by: user, at: nowIso },
        ],
      }));

      setIsEditOpen(false);
      setEditId(null);
      fetchItems();
    } catch (err: any) {
      alert("Kunde inte markera som färdig: " + (err?.message ?? err));
    }
  };



  const reopenForEditing = async (): Promise<void> => {
    if (!editId) return;
    try {
      // 🧱 Permalås: stoppa reopen om enheten är fakturerad
      const ref = doc(db, "itInventory", editId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        alert("Kunde inte låsa upp – posten finns inte längre.");
        return;
      }
      const data = snap.data() as any;
      if (data.invoiceReportId) {
        alert("Kan inte öppna för editering – posten är redan fakturerad och är permalåst.");
        return;
      }

      const nowIso = new Date().toISOString();

      await runTransaction(db, async (tx) => {
        const ref = doc(db, "itInventory", editId);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Posten finns inte längre.");

        const cur = snap.data() as any;
        const user = currentUserString();

        // 1) Permalås: redan fakturerad?
        if (cur.invoiceReportId) {
          throw new Error("Kan inte öppna för editering – posten är fakturerad och permalåst.");
        }

        // 2) Låskontroll (respektera färskt lås hos annan)
        const heldByOther = !!cur.lockedBy && cur.lockedBy !== user;
        const lockedAtMs = toMillis(cur.lockedAt);
        const isStale = lockedAtMs === null ? true : (Date.now() - lockedAtMs) > LOCK_STALE_MS;
        if (heldByOther && !isStale) {
          throw new Error(`Posten redigeras av ${cur.lockedBy}.`);
        }

        // 3) Skriv alla fält atomiskt + ta lås för mig
        tx.update(ref, {
          completed: false,
          completedAt: null,
          completedBy: null,

          markedForInvoice: false,
          invoiceReportId: null,
          invoicedAt: null,

          lockedBy: user,
          lockedAt: serverTimestamp(),

          auditLog: arrayUnion({
            action: "reopened",
            by: user,
            at: nowIso, // behåll din befintliga texttid
          }),
        } as UpdateData<BaseItem>);
      });


      setEditForm((prev) => ({
        ...prev, completed: false,
        completedAt: null,
        completedBy: null,
        auditLog: [...(Array.isArray(prev.auditLog) ? prev.auditLog : []), { action: "reopened", by: currentUserString(), at: nowIso },],
      }));

      fetchItems();
    } catch (err: any) {
      alert("Kunde inte låsa upp för editering: " + err.message);
    }
  };

  const unmarkDelete = async (): Promise<void> => {
    if (!editId) return;
    try {
      setIsSaving(true);
      const nowIso = new Date().toISOString();

      await updateDoc(doc(db, "itInventory", editId), {
        deletePending: false,
        deleteMarkedBy: null,
        deleteMarkedAt: null,
        auditLog: arrayUnion({
          action: "delete_unmarked",
          by: currentUserString(),
          at: nowIso
        })
      } as UpdateData<BaseItem>);

      // Uppdatera lokalt UI-state direkt
      setEditForm(prev => ({
        ...prev,
        deletePending: false,
        deleteMarkedBy: null,
        deleteMarkedAt: null,
        auditLog: [
          ...(Array.isArray(prev.auditLog) ? prev.auditLog : []),
          { action: "delete_unmarked", by: currentUserString(), at: nowIso }
        ]
      }));
    } catch (e: any) {
      alert("Kunde inte avmarkera radering: " + (e?.message || e));
    } finally {
      setIsSaving(false);
    }
  };


  const handleSave = async (): Promise<void> => { await saveData(); };




  type RowState = "open" | "ready" | "invoiced";

  const getRowState = (it: Item): RowState => {
    if ((it as any).invoiceReportId) return "invoiced";
    if (it.completed) return "ready";
    return "open";
  };

  const cmpDateDesc = (a?: any, b?: any) =>
    String(b || "").localeCompare(String(a || ""));


  const visibleItems = useMemo<Item[]>(() => {
    const q = (s?: string) => (s || "").trim().toLowerCase();



    const fOrd = q(filters.orderNumber);
    const fMan = q(filters.manufacturer);
    const fMod = q(filters.model);
    const fAda = q(filters.chargerIncluded);
    const fCre = q(filters.createdAt);
    const fBy = q(filters.createdBy);
    // behåll din serial-normalisering
    const fSerKey = normalizeSerialKey(filters.serial || "");

    const filtered = items.filter((it) => {
      // Dölj ofullständiga wizard-utkast
      if ((it as any).isDraft === true) return false;

      const createdText = fmtDate(it.createdAt);
      const byText = (it.createdBy || (it as any).initials || "").toString();
      const adaText = it.chargerIncluded ? "ja yes true 1" : "nej no false 0";
      const serialMatch =
        !fSerKey || normalizeSerialKey(it.serial || "").includes(fSerKey);

      return (
        (!fOrd || q(it.orderNumber).includes(fOrd)) &&
        (!fMan || q(it.manufacturer).includes(fMan)) &&
        (!fMod || q(it.model).includes(fMod)) &&
        serialMatch &&
        (!fAda || adaText.includes(fAda)) &&
        (!fCre || q(createdText).includes(fCre)) &&
        (!fBy || q(byText).includes(fBy))
      );
    });

    // 1) öppna (ej completed, ej fakturerade) – sortera nyast skapade överst
    const openItems = filtered
      .filter((it) => getRowState(it) === "open")
      .sort((a, b) => cmpDateDesc(a.createdAt, b.createdAt));

    // 2) färdiga (completed men ej fakturerade) – sortera nyast färdigställda överst
    const readyItems = filtered
      .filter((it) => getRowState(it) === "ready")
      .sort((a, b) => cmpDateDesc(a.completedAt, b.completedAt));

    // 3) fakturerade – sortera nyast färdigställda överst
    const invoicedItems = filtered
      .filter((it) => getRowState(it) === "invoiced")
      .sort((a, b) => cmpDateDesc(a.completedAt, b.completedAt));

    return [...openItems, ...readyItems, ...invoicedItems];
  }, [items, filters]);


  /* Stegindikator */
  const StepIndicator: React.FC = () => (
    <div style={STEP_INDICATOR_WRAP}>
      <div style={{ fontSize: 14, marginBottom: 8 }}>
        Steg {currentStep} av {TOTAL_STEPS}
      </div>
      <div style={DOTS}>
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div key={i} style={DOT(i + 1 === currentStep)} />
        ))}
      </div>
    </div>
  );

  /* ---- Validering för knappen "Nästa" ---- */
  const stepValid: boolean =
    (currentStep === 1 && form.orderNumber.trim() !== "") ||
    (currentStep === 2 && form.customer.trim() !== "") ||        // Kund är nu steg 2
    (currentStep === 3 && form.manufacturer.trim() !== "") ||    // Tillverkare -> 3
    (currentStep === 4 && form.model.trim() !== "") ||           // Modell -> 4
    (currentStep === 5 && form.serial.trim() !== "") ||          // Serienummer -> 5
    currentStep === 6 ||                                         // Adapter & skador -> 6 (alltid ok)
    (currentStep === 7 && form.articleNumber.trim() !== "") ||   // Artikelnummer
    currentStep === 8 ||                                         // Bilder
    currentStep === 9;                                           // Sammanfattning


  // MENU BUTTON (öppna menyn)
  const MENU_BUTTON = (
    <button
      className="gw-menu-btn"
      aria-label="Öppna meny"
      aria-expanded={menuOpen}
      aria-controls="gw-side-menu"
      onClick={() => setMenuOpen(true)}
    >
      ☰
    </button>
  );

  // SIDE MENU (overlay + panel via portal)
  const SIDE_MENU = menuOpen
    ? createPortal(
      <>
        {/* Overlay – klick utanför stänger menyn */}
        <div
          className="gw-menu-overlay"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
          // Fallback med tema-variabler om CSS ännu ej laddats
          style={{ position: "fixed", inset: 0, background: "var(--overlay)", zIndex: 1000 }}
        />

        {/* Själva sidomenyn */}
        <aside
          id="gw-side-menu"
          className="gw-side-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Meny"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}
          // Fallback med tema-variabler om CSS ännu ej laddats
          style={{
            position: "fixed",
            top: 0,
            bottom: 0,
            left: 0,
            width: 280,
            maxWidth: "85vw",
            background: "var(--surface)",
            color: "var(--text)",
            borderRight: "1px solid var(--border)",
            boxShadow: "2px 0 12px rgba(0,0,0,.15)",
            padding: 16,
            zIndex: 1001,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <strong style={{ fontSize: 18 }}>Meny</strong>
            <button
              type="button"
              className="btn"
              onClick={() => setMenuOpen(false)}
              aria-label="Stäng meny"
              style={{ padding: 6, width: 32, height: 32, borderRadius: 8 }}
            >
              ✕
            </button>
          </div>

          {/* Menylänkar */}
          <nav className="menu-list" style={{ display: "grid", gap: 8, overflow: "auto" }}>
            {MENU.filter((m) => !m.visible || m.visible()).map((m) => {
              const active = activePage === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  className={`menu-item${active ? " is-active" : ""}`}
                  onClick={() => {
                    setActivePage(m.key);
                    setMenuOpen(false);
                  }}
                  // Fallback med tema-variabler
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid transparent",
                    background: "transparent",
                    color: "var(--text)",
                    ...(active ? { background: "var(--surface-2)", border: "1px solid var(--border)" } : null),
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </nav>

          {/* Footer – logga ut */}
          {user && (
            <div style={{ marginTop: "auto" }}>
              <button className="btn" onClick={handleLogout} style={{ width: "100%" }}>
                Logga ut
              </button>
            </div>
          )}
        </aside>
      </>,
      document.body
    )
    : null;





  function AuthForm() {
    const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [msg, setMsg] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const err = (e: any) => e?.message?.replace("Firebase:", "").trim();
    const doLogin = async () => {
      setBusy(true); setMsg(null);
      try {
        const { user } = await signInWithEmailAndPassword(auth, email, password);
        if (!user.emailVerified) { await signOut(auth); setMsg("E-post ej verifierad. Verifiera via länken i mailet först."); }
      } catch (e) { setMsg(err(e)); } finally { setBusy(false); }
    };
    const doSignup = async () => {
      setBusy(true); setMsg(null);
      try {
        const { user } = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(user);
        setMsg("Konto skapat. Vi har skickat ett verifieringsmail – verifiera och logga in.");
        setMode("login");
      } catch (e) { setMsg(err(e)); } finally { setBusy(false); }
    };
    const doReset = async () => {
      setBusy(true); setMsg(null);
      try { await sendPasswordResetEmail(auth, email); setMsg("Återställningsmail skickat om adressen finns."); }
      catch (e) { setMsg(err(e)); } finally { setBusy(false); }
    };
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ width: 380, maxWidth: "92vw", background: "#fff", border: "1px solid #eee", borderRadius: 12, padding: 20 }}>
          <h2 style={{ margin: 0 }}>{mode === "login" ? "Logga in" : mode === "signup" ? "Skapa konto" : "Återställ lösenord"}</h2>
          <div style={{ marginTop: 12 }}>
            <label>E-post</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />
          </div>
          {mode !== "reset" && (
            <div style={{ marginTop: 12 }}>
              <label>Lösenord</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />
            </div>
          )}
          {msg && <div style={{ marginTop: 12, background: "#f1f5ff", border: "1px solid #dbe4ff", padding: 10, borderRadius: 8 }}>{msg}</div>}
          <div style={{ marginTop: 16 }}>
            {mode === "login" && <button onClick={doLogin} disabled={busy} style={{ width: "100%", padding: 12, borderRadius: 8, border: "1px solid #ddd", background: "#0b5cff", color: "#fff" }}>Logga in</button>}
            {mode === "signup" && <button onClick={doSignup} disabled={busy} style={{ width: "100%", padding: 12, borderRadius: 8, border: "1px solid #ddd", background: "#0b5cff", color: "#fff" }}>Skapa konto</button>}
            {mode === "reset" && <button onClick={doReset} disabled={busy} style={{ width: "100%", padding: 12, borderRadius: 8, border: "1px solid #ddd", background: "#0b5cff", color: "#fff" }}>Skicka återställningsmail</button>}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            {mode !== "login"
              ? <button onClick={() => setMode("login")} style={{ background: "transparent", border: "none", textDecoration: "underline", cursor: "pointer" }}>Har konto? Logga in</button>
              : <button onClick={() => setMode("signup")} style={{ background: "transparent", border: "none", textDecoration: "underline", cursor: "pointer" }}>Skapa konto</button>}
            {mode !== "reset" && <button onClick={() => setMode("reset")} style={{ background: "transparent", border: "none", textDecoration: "underline", cursor: "pointer" }}>Glömt lösenord?</button>}
          </div>
        </div>
      </div>
    );
  }

  function UsersAdmin() {
    const [rows, setRows] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    const load = async () => {
      setLoading(true);
      try {
        const res: any = await fnListUsers({});
        setRows(res.data.users || []);
      } catch (e: any) {
        setMsg(e.message || "Kunde inte hämta användare.");
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      load();
    }, []); // <-- viktigt: kör bara en gång

    const doDelete = async (uid: string) => {
      if (!confirm("Radera användare permanent?")) return;
      await fnDeleteUser({ uid });
      await load();
    };

    const changeRole = async (uid: string, role: "admin" | "user") => {
      await fnSetUserRole({ uid, role });
      setMsg("Roll uppdaterad. Be användaren logga ut/in för att få ny roll.");
      await load();
    };

    const sendReset = async (email: string) => {
      const res: any = await fnTriggerReset({ email });
      const link = res.data.resetLink as string;
      setMsg(`Reset-länk genererad: ${link}`);
    };

    return (
      <div style={{ padding: 16 }}>
        <h2>Användare</h2>
        {loading && <div>Laddar…</div>}
        {msg && <div style={{ background: "#f1f5ff", border: "1px solid #dbe4ff", padding: 10, borderRadius: 8, marginBottom: 12 }}>{msg}</div>}

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
            {rows.map(u => (
              <tr key={u.uid}>
                <td style={{ padding: 8 }}>{u.displayName || "-"}</td>
                <td style={{ padding: 8 }}>{u.email}</td>
                <td style={{ padding: 8 }}>{u.emailVerified ? "Ja" : "Nej"}</td>
                <td style={{ padding: 8 }}>
                  <select value={u.role} onChange={(e) => changeRole(u.uid, e.target.value as "admin" | "user")}>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td style={{ padding: 8 }}>{u.lastLoginAt || "-"}</td>
                <td style={{ padding: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => sendReset(u.email)} style={{ padding: "6px 10px" }}>Skicka reset-länk</button>
                  <button onClick={() => doDelete(u.uid)} style={{ padding: "6px 10px", background: "#fee2e2", border: "1px solid #fecaca" }}>Radera</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: 12 }}>
          <button onClick={load}>Uppdatera</button>
        </div>
      </div>
    );
  }


  /* =========================
     UI: Sidor (Home/Fakturering)
  ========================= */

  // Flagga baserat på hashroute (du har redan reportIdFromHash tidigare i App)


  // ===== Auth Gate =====
  if (!authReady) return <div style={{ padding: 24 }}>Startar…</div>;
  if (!user) return <AuthForm />;
  if (!user.emailVerified) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ width: 420, maxWidth: "92vw", background: "#fff", border: "1px solid #eee", borderRadius: 12, padding: 20 }}>
          <h3>Verifiera din e-post</h3>
          <p>Kolla din inkorg och klicka på länken. Ladda sedan om sidan.</p>
          <button onClick={() => signOut(auth)} style={{ marginTop: 8, padding: 10, borderRadius: 8, border: "1px solid #ddd" }}>
            Logga ut
          </button>
        </div>
      </div>
    );
  }

  // ===== RENDER: rapport-detaljvy ELLER vanliga appen =====
  return (
    <div className="goldwasser-app">
      {isReportView ? (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); window.location.hash = ""; }}
              title="Till Rapporter"
              style={{ textDecoration: "none" }}
            >
              ← Till Rapporter
            </a>
          </div>
          <ReportDetailPage reportId={reportIdFromHash!} authReady={authReady} />
        </div>
      ) : (
        <div className="gw-shell">
          {MENU_BUTTON}
          {SIDE_MENU}

          <div className="gw-container">
            <div className="gw-topbar">
              <div style={{ marginLeft: "auto" }}>
                <ThemeToggle />
              </div>
            </div>

            {/* HOME */}
            {activePage === "home" && (
              <>
                <div
                  style={
                    entryMode === "snabb"
                      ? { maxWidth: 1180, margin: "0 auto", padding: "0 12px" } // bredare för snabbinmatning
                      : WIZARD_WRAP                                             // oförändrat för wizard
                  }
                >

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                    <h1 className="gw-h1" style={{ margin: 0 }}>Registrera IT-Retur</h1>

                    <div className="gw-inline" role="group" aria-label="Växla inmatningsläge">
                      <label className="gw-check-inline" style={{ marginRight: 12 }}>
                        <input
                          type="radio"
                          name="entryMode"
                          value="wizard"
                          checked={entryMode === "wizard"}
                          onChange={() => setEntryMode("wizard")}
                        />
                        <span>Wizard</span>
                      </label>
                      <label className="gw-check-inline">
                        <input
                          type="radio"
                          name="entryMode"
                          value="snabb"
                          checked={entryMode === "snabb"}
                          onChange={() => setEntryMode("snabb")}
                        />
                        <span>Snabbinmatning</span>
                      </label>
                    </div>
                  </div>

                  {/* Visa stegindikatorn bara i wizard-läget */}
                  {entryMode === "wizard" && <StepIndicator />}

                  {/* Visa wizard-stegen endast i wizard-läget */}
                  {entryMode === "wizard" && (
                    <>


                      {/* STEG 1: Ordernummer */}
                      {currentStep === 1 && (
                        <div className="gw-card">
                          <h3 className="gw-h3">Ordernummer</h3>
                          <div style={FIELD_MARGIN}>
                            <input
                              name="orderNumber"
                              type="text"
                              placeholder="Ordernummer"
                              value={form.orderNumber}
                              onChange={handleInputChange}
                              className="gw-input"
                            />
                          </div>
                          <div className="gw-actions">
                            <div />
                            <button onClick={nextStep} className="btn btn-primary" disabled={!stepValid}>
                              Nästa
                            </button>
                          </div>
                        </div>
                      )}


                      {/* STEG 2: Kund */}
                      {currentStep === 2 && (
                        <div className="gw-card">
                          <h3 className="gw-h3">Välj kund</h3>

                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <select
                              value={form.customer}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "new") {
                                  setShowNewCustomerInput(true);
                                  setForm((p) => ({ ...p, customer: "" }));
                                } else {
                                  setShowNewCustomerInput(false);
                                  setForm((p) => ({ ...p, customer: v }));
                                }
                              }}
                              className="gw-input"
                              style={{ maxWidth: "100%" }}
                            >
                              <option value="">Kund</option>
                              {customerList.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                              <option value="new">Lägg till ny kund</option>
                            </select>

                            {showNewCustomerInput && (
                              <>
                                <input
                                  type="text"
                                  placeholder="Ny kund"
                                  value={newCustomer}
                                  onChange={(e) => setNewCustomer(e.target.value)}
                                  className="gw-input"
                                />
                                <button onClick={handleNewCustomerAdd} className="btn">Lägg till</button>
                              </>
                            )}
                          </div>

                          <div className="gw-actions">
                            <button onClick={prevStep} className="btn">Tillbaka</button>
                            <button onClick={nextStep} className="btn btn-primary" disabled={!form.customer.trim()}>
                              Nästa
                            </button>
                          </div>
                        </div>
                      )}

                      {/* STEG 3: Tillverkare */}
                      {currentStep === 3 && (
                        <div className="gw-card">
                          <h3 className="gw-h3">Välj tillverkare</h3>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <select
                              value={form.manufacturer}
                              onChange={(e) => {
                                const value = e.target.value;
                                if (value === "new") {
                                  setShowNewManufacturerInput(true);
                                  setForm((prev) => ({ ...prev, manufacturer: "" }));
                                } else {
                                  setShowNewManufacturerInput(false);
                                  setForm((prev) => ({ ...prev, manufacturer: value }));
                                }
                              }}
                              className="gw-input"
                            >
                              <option value="">Tillverkare</option>
                              {manufacturerList.map((man) => (
                                <option key={man} value={man}>{man}</option>
                              ))}
                              <option value="new">Lägg till ny tillverkare</option>
                            </select>

                            {showNewManufacturerInput && (
                              <>
                                <input
                                  type="text"
                                  placeholder="Ny tillverkare"
                                  value={newManufacturer}
                                  onChange={(e) => setNewManufacturer(e.target.value)}
                                  className="gw-input"
                                />
                                {manufacturerExists && (
                                  <div style={{ color: "#b91c1c", fontSize: 13 }}>Tillverkaren finns redan.</div>
                                )}
                                <button
                                  onClick={handleNewManufacturerAdd}
                                  disabled={!newManufacturer.trim() || manufacturerExists}
                                  title={manufacturerExists ? "Dublett: kan inte spara" : "Lägg till"}
                                  className="btn btn-secondary"
                                >
                                  Lägg till
                                </button>
                              </>
                            )}
                          </div>

                          <div className="gw-actions">
                            <button onClick={prevStep} className="btn">Tillbaka</button>
                            <button onClick={nextStep} className="btn btn-primary" disabled={!stepValid}>Nästa</button>
                          </div>
                        </div>
                      )}

                      {/* STEG 4: Modell */}
                      {currentStep === 4 && (
                        <div className="gw-card">
                          <h3 className="gw-h3">Välj modell</h3>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <select
                              value={form.model}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === "new") {
                                  setShowNewModelInput(true);
                                  setForm((prev) => ({ ...prev, model: "" }));
                                } else {
                                  setShowNewModelInput(false);
                                  setForm((prev) => ({ ...prev, model: val }));
                                }
                              }}
                              className="gw-input"
                              disabled={!form.manufacturer}
                            >
                              <option value="">{form.manufacturer ? "Modell" : "Välj tillverkare först"}</option>
                              {modelList.map((m) => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                              {form.manufacturer && <option value="new">Lägg till ny modell</option>}
                            </select>

                            {showNewModelInput && (
                              <>
                                <input
                                  type="text"
                                  placeholder="Ny modell"
                                  value={newModel}
                                  onChange={(e) => setNewModel(e.target.value)}
                                  className="gw-input"
                                />
                                {modelExistsForThisManufacturer && (
                                  <div style={{ color: "#b91c1c", fontSize: 13 }}>Modell finns redan för tillverkare.</div>
                                )}
                                <button
                                  onClick={handleNewModelAdd}
                                  className="btn btn-secondary"
                                  disabled={!newModel.trim() || modelExistsForThisManufacturer}
                                  title={modelExistsForThisManufacturer ? "Dublett: kan inte spara" : "Lägg till"}
                                >
                                  Lägg till
                                </button>
                              </>
                            )}
                          </div>

                          <div className="gw-actions">
                            <button onClick={prevStep} className="btn">Tillbaka</button>
                            <button onClick={nextStep} className="btn btn-primary" disabled={!stepValid}>Nästa</button>
                          </div>
                        </div>
                      )}

                      {/* STEG 5: Serienummer */}
                      {currentStep === 5 && (
                        <div className="gw-card">
                          <h3 className="gw-h3">Serienummer</h3>
                          <div style={FIELD_MARGIN}>
                            <input
                              name="serial"
                              type="text"
                              placeholder="Serienummer"
                              value={form.serial}
                              onChange={handleInputChange}
                              className="gw-input"
                            />
                          </div>
                          <div className="gw-actions">
                            <button onClick={prevStep} className="btn">Tillbaka</button>
                            <button onClick={nextStep} className="btn btn-primary" disabled={!stepValid}>Nästa</button>
                          </div>
                        </div>
                      )}

                      {/* STEG 6: Adapter & Skador */}
                      {currentStep === 6 && (
                        <div className="gw-card">
                          <h3 className="gw-h3">Adapter & skador</h3>

                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <input
                                name="chargerIncluded"
                                type="checkbox"
                                checked={form.chargerIncluded}
                                onChange={handleInputChange}
                              />
                              Adapter medföljer
                            </label>
                          </div>

                          <div style={FIELD_MARGIN}>
                            <textarea
                              name="damageNotes"
                              placeholder="Eventuella skador"
                              value={form.damageNotes}
                              onChange={handleInputChange}
                              className="gw-input"
                              style={{ minHeight: 88 }}
                            />
                          </div>

                          <div className="gw-actions">
                            <button onClick={prevStep} className="btn">Tillbaka</button>
                            <button onClick={nextStep} className="btn btn-primary">Nästa</button>
                          </div>
                        </div>
                      )}



                      {/* STEG 7: Artikelnummer hos Convit */}
                      {currentStep === 7 && (
                        <div className="gw-card">
                          <h3 className="gw-h3">Artikelnummer hos Convit</h3>

                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <select
                              value={form.articleNumber}
                              disabled={!form.customer}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "new") {
                                  setShowNewArticleInput(true);
                                  setForm((p) => ({ ...p, articleNumber: "" }));
                                } else {
                                  setShowNewArticleInput(false);
                                  setForm((p) => ({ ...p, articleNumber: v }));
                                }
                              }}
                              className="gw-input"
                              style={{ maxWidth: "100%" }}
                            >
                              <option value="">{form.customer ? "Artikelnummer" : "Välj kund först"}</option>
                              {articleList.map((a) => (
                                <option key={a} value={a}>{a}</option>
                              ))}
                              {form.customer && <option value="new">Lägg till ny artikel</option>}
                            </select>

                            {showNewArticleInput && (
                              <>
                                <input
                                  type="text"
                                  placeholder="Ny artikel"
                                  value={newArticle}
                                  onChange={(e) => setNewArticle(e.target.value)}
                                  className="gw-input"
                                />
                                <button onClick={handleNewArticleAdd} className="btn">Lägg till</button>
                              </>
                            )}
                          </div>

                          <div className="gw-actions">
                            <button onClick={prevStep} className="btn">Tillbaka</button>
                            <button onClick={nextStep} className="btn btn-primary" disabled={!stepValid}>
                              Nästa
                            </button>
                          </div>
                        </div>
                      )}

                      {/* STEG 8: Bilder */}
                      {currentStep === 8 && (
                        <div className="gw-card">
                          <h3 className="gw-h3">Ladda upp bilder</h3>

                          <div className="gw-photo-grid">
                            {(["keyboard", "screen", "underside", "topside"] as PhotoKey[]).map((type) => {
                              const src = thumbnailPreviews[type];
                              const label =
                                type === "keyboard" ? "Tangentbord" :
                                  type === "screen" ? "Skärm" :
                                    type === "underside" ? "Undersida" : "Ovansida";

                              return (
                                <div key={type} className="gw-photo-card">
                                  <input
                                    id={`photo-${type}`}
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    style={{ display: "none" }}
                                    onChange={(e) => handlePhotoChange(e, type)}
                                  />

                                  <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => document.getElementById(`photo-${type}`)?.click()}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") document.getElementById(`photo-${type}`)?.click();
                                    }}
                                  >
                                    {src ? (
                                      <img className="gw-photo-img" src={src} alt={`${label} preview`} />
                                    ) : (
                                      <div className="gw-photo-placeholder">
                                        Klicka för att lägga till<br />{label.toLowerCase()}
                                      </div>
                                    )}
                                  </div>

                                  {src && (
                                    <button
                                      type="button"
                                      className="gw-photo-remove"
                                      onClick={() => handleRemovePhoto(type)}
                                      title="Ta bort bild"
                                      aria-label={`Ta bort ${label}`}
                                    >
                                      ×
                                    </button>
                                  )}

                                  <div className="gw-photo-title">{label}</div>
                                </div>
                              );
                            })}
                          </div>

                          <div className="gw-actions">
                            <button onClick={prevStep} className="btn">Tillbaka</button>
                            <button onClick={nextStep} className="btn btn-primary">Nästa</button>
                          </div>
                        </div>
                      )}

                      {/* STEG 9: Sammanfattning & Spara */}
                      {currentStep === 9 && (
                        <div className="gw-card" style={{ position: "relative" }}>
                          {isSaving && (
                            <div
                              style={{
                                position: "absolute",
                                inset: 0,
                                background: "rgba(255,255,255,0.7)",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                zIndex: 10,
                                borderRadius: 12,
                                gap: 12,
                              }}
                              aria-live="assertive"
                            >
                              <div style={{ width: "80%", height: 8, background: "#eee", borderRadius: 999, overflow: "hidden" }}>
                                <div
                                  style={{
                                    height: "100%",
                                    width: `${overallProgress}%`,
                                    background: "var(--brand-primary)",
                                    transition: "width 200ms linear",
                                  }}
                                />
                              </div>
                              <div style={{ fontSize: 14, color: "#374151" }}>
                                Sparar… {overallProgress}%
                              </div>
                            </div>
                          )}

                          <h3 className="gw-h3">Sammanfattning</h3>

                          <div style={{ lineHeight: 1.7 }}>
                            <div><b>Ordernr:</b> {form.orderNumber || "—"}</div>
                            <div><b>Tillverkare:</b> {form.manufacturer || "—"}</div>
                            <div><b>Modell:</b> {form.model || "—"}</div>
                            <div><b>Serienummer:</b> {form.serial || "—"}</div>
                            <div><b>Adapter medföljer:</b> {form.chargerIncluded ? "Ja" : "Nej"}</div>
                            <div><b>Skador:</b> {form.damageNotes || "—"}</div>
                            <div><b>Kund:</b> {form.customer || "—"}</div>
                            <div><b>Artikelnummer:</b> {form.articleNumber || "—"}</div>
                            <div style={{ marginTop: 8 }}>
                              <b>Bilder:</b>{" "}
                              {(Object.values(thumbnailPreviews || {}) as Array<string | undefined>).some(Boolean)
                                ? "Valda ✔"
                                : "Inga bilder valda"}
                            </div>
                          </div>

                          <div className="gw-actions">
                            <button onClick={prevStep} className="btn">Tillbaka</button>
                            <button type="button" onClick={saveData} className="btn btn-primary" disabled={isSaving}>
                              {isSaving ? "Sparar…" : "Spara enhet"}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {/* Snabbinmatning – placeholder (vi fyller fälten i nästa steg) */}
                  {entryMode === "snabb" && (
                    <div className="gw-card">
                      <h3 className="gw-h3">Snabbinmatning</h3>
                      {/* Valideringsrad */}
                      {(() => {
                        const missing: string[] = [];
                        if (!form.orderNumber.trim()) missing.push("Ordernummer");
                        if (!form.customer.trim()) missing.push("Kund");
                        if (!form.manufacturer.trim()) missing.push("Tillverkare");
                        if (!form.model.trim()) missing.push("Modell");
                        if (!form.serial.trim()) missing.push("Serienummer");
                        if (missing.length === 0) return null;
                        return (
                          <div
                            className="gw-banner gw-banner--warn"
                            role="status"
                            aria-live="polite"
                            style={{ margin: "8px 0 12px" }}
                          >
                            Saknas: {missing.join(", ")}
                          </div>
                        );
                      })()}

                      <div className="gw-form-grid gw-form-grid--quick">
                        {/* Rad 1 – sex fält (1 kol vardera) */}
                        <label className="gw-form-field gw-col-1">
                          <div className="gw-form-label">Ordernummer</div>
                          <input
                            ref={quickOrderRef}
                            name="orderNumber"
                            type="text"
                            placeholder="Ordernummer"
                            value={form.orderNumber}
                            onChange={handleInputChange}
                            className="gw-input"
                          />
                        </label>

                        {/* Kund – span 4 */}
                        <label className="gw-form-field gw-col-1">
                          <div className="gw-form-label">Kund</div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <select
                              value={form.customer}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "new") {
                                  setShowNewCustomerInput(true);
                                  setForm((p) => ({ ...p, customer: "" }));
                                } else {
                                  setShowNewCustomerInput(false);
                                  setForm((p) => ({ ...p, customer: v }));
                                }
                              }}
                              className="gw-input"
                              style={{ maxWidth: "100%" }}
                            >
                              <option value="">Kund</option>
                              {customerList.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                              <option value="new">Lägg till ny kund</option>
                            </select>

                            {showNewCustomerInput && (
                              <>
                                <input
                                  type="text"
                                  placeholder="Ny kund"
                                  value={newCustomer}
                                  onChange={(e) => setNewCustomer(e.target.value)}
                                  className="gw-input"
                                />
                                <button onClick={handleNewCustomerAdd} className="btn">Lägg till</button>
                              </>
                            )}
                          </div>
                        </label>

                        <label className="gw-form-field gw-col-1">
                          <div className="gw-form-label">Serienummer</div>
                          <input
                            name="serial"
                            type="text"
                            placeholder="Serienummer"
                            value={form.serial}
                            onChange={handleInputChange}
                            className="gw-input"
                          />
                        </label>

                        {/* Tillverkare – span 3 */}
                        <label className="gw-form-field gw-col-1">
                          <div className="gw-form-label">Tillverkare</div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <select
                              value={form.manufacturer}
                              onChange={(e) => {
                                const value = e.target.value;
                                if (value === "new") {
                                  setShowNewManufacturerInput(true);
                                  setForm((prev) => ({ ...prev, manufacturer: "" }));
                                } else {
                                  setShowNewManufacturerInput(false);
                                  setForm((prev) => ({ ...prev, manufacturer: value }));
                                }
                              }}
                              className="gw-input"
                            >
                              <option value="">Tillverkare</option>
                              {manufacturerList.map((man) => (
                                <option key={man} value={man}>{man}</option>
                              ))}
                              <option value="new">Lägg till ny tillverkare</option>
                            </select>

                            {showNewManufacturerInput && (
                              <>
                                <input
                                  type="text"
                                  placeholder="Ny tillverkare"
                                  value={newManufacturer}
                                  onChange={(e) => setNewManufacturer(e.target.value)}
                                  className="gw-input"
                                />
                                {manufacturerExists && (
                                  <div style={{ color: "#b91c1c", fontSize: 13 }}>Tillverkaren finns redan.</div>
                                )}
                                <button
                                  onClick={handleNewManufacturerAdd}
                                  disabled={!newManufacturer.trim() || manufacturerExists}
                                  title={manufacturerExists ? "Dublett: kan inte spara" : "Lägg till"}
                                  className="btn btn-secondary"
                                >
                                  Lägg till
                                </button>
                              </>
                            )}
                          </div>
                        </label>

                        <label className="gw-form-field gw-col-1">
                          <div className="gw-form-label">Modell</div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <select
                              value={form.model}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === "new") {
                                  setShowNewModelInput(true);
                                  setForm((prev) => ({ ...prev, model: "" }));
                                } else {
                                  setShowNewModelInput(false);
                                  setForm((prev) => ({ ...prev, model: val }));
                                }
                              }}
                              className="gw-input"
                              disabled={!form.manufacturer}
                            >
                              <option value="">{form.manufacturer ? "Modell" : "Välj tillverkare först"}</option>
                              {modelList.map((m) => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                              {form.manufacturer && <option value="new">Lägg till ny modell</option>}
                            </select>

                            {showNewModelInput && (
                              <>
                                <input
                                  type="text"
                                  placeholder="Ny modell"
                                  value={newModel}
                                  onChange={(e) => setNewModel(e.target.value)}
                                  className="gw-input"
                                />
                                {modelExistsForThisManufacturer && (
                                  <div style={{ color: "#b91c1c", fontSize: 13 }}>Modell finns redan för tillverkare.</div>
                                )}
                                <button
                                  onClick={handleNewModelAdd}
                                  className="btn btn-secondary"
                                  disabled={!newModel.trim() || modelExistsForThisManufacturer}
                                  title={modelExistsForThisManufacturer ? "Dublett: kan inte spara" : "Lägg till"}
                                >
                                  Lägg till
                                </button>
                              </>
                            )}
                          </div>
                        </label>



                        {/* Rad 3 */}


                        {/* Artikelnummer – 1 kol (så vi får 6 fält på raden) */}
                        <label className="gw-form-field gw-col-1">
                          <div className="gw-form-label">Artikelnummer hos Convit</div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <select
                              value={form.articleNumber}
                              disabled={!form.customer}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "new") {
                                  setShowNewArticleInput(true);
                                  setForm((p) => ({ ...p, articleNumber: "" }));
                                } else {
                                  setShowNewArticleInput(false);
                                  setForm((p) => ({ ...p, articleNumber: v }));
                                }
                              }}
                              className="gw-input"
                              style={{ maxWidth: "100%" }}
                            >
                              <option value="">{form.customer ? "Artikelnummer" : "Välj kund först"}</option>
                              {articleList.map((a) => (
                                <option key={a} value={a}>{a}</option>
                              ))}
                              {form.customer && <option value="new">Lägg till ny artikel</option>}
                            </select>

                            {showNewArticleInput && (
                              <>
                                <input
                                  type="text"
                                  placeholder="Ny artikel"
                                  value={newArticle}
                                  onChange={(e) => setNewArticle(e.target.value)}
                                  className="gw-input"
                                />
                                <button onClick={handleNewArticleAdd} className="btn">Lägg till</button>
                              </>
                            )}
                          </div>
                        </label>

                        {/* Adapter & Skador – span 8 */}
                        <label className="gw-form-field gw-col-3">
                          <div className="gw-form-label">Adapter & skador</div>

                          <textarea
                            name="damageNotes"
                            placeholder="Eventuella skador"
                            value={form.damageNotes}
                            onChange={handleInputChange}
                            className="gw-input"
                          />
                        </label>


                      </div>


                      {/* HÖGER: Bilder – 2 kolumner (kompakt 2×2) */}
                      <label className="gw-form-field gw-col-2">
                        <div className="gw-form-label">Bilder</div>

                        <div className="gw-photo-grid gw-photo-grid--quick">
                          {(["keyboard", "screen", "underside", "topside"] as PhotoKey[]).map((type) => {
                            const src = thumbnailPreviews[type];
                            const label =
                              type === "keyboard" ? "Tangentbord" :
                                type === "screen" ? "Skärm" :
                                  type === "underside" ? "Undersida" : "Ovansida";

                            return (
                              <div key={type} className="gw-photo-card">
                                <input
                                  id={`quick-photo-${type}`}
                                  type="file"
                                  accept="image/*"
                                  capture="environment"
                                  style={{ display: "none" }}
                                  onChange={(e) => handlePhotoChange(e, type)}
                                />

                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => document.getElementById(`quick-photo-${type}`)?.click()}
                                  onKeyDown={(e) => { if (e.key === "Enter") document.getElementById(`quick-photo-${type}`)?.click(); }}
                                >
                                  {src ? (
                                    <img className="gw-photo-img" src={src} alt={`${label} preview`} />
                                  ) : (
                                    <div className="gw-photo-placeholder">
                                      Klicka för att lägga till<br />{label.toLowerCase()}
                                    </div>
                                  )}
                                </div>

                                {src && (
                                  <button
                                    type="button"
                                    className="gw-photo-remove"
                                    onClick={() => handleRemovePhoto(type)}
                                    title={`Ta bort ${label}`}
                                    aria-label={`Ta bort ${label}`}
                                  >
                                    ×
                                  </button>
                                )}

                                <div className="gw-photo-title">{label}</div>
                              </div>
                            );
                          })}
                        </div>
                      </label>



                      {/* Actions (vi lägger fler fält + Spara i kommande steg) */}
                      <div className="gw-actions" style={{ marginTop: 8 }}>
                        <div />
                        <button
                          type="button"
                          onClick={saveData}
                          className="btn btn-primary"
                          disabled={
                            isSaving ||
                            !form.orderNumber.trim() ||
                            !form.customer.trim() ||
                            !form.manufacturer.trim() ||
                            !form.model.trim() ||
                            !form.serial.trim()
                          }
                          title={
                            !form.orderNumber.trim() ? "Fyll i ordernummer" :
                              !form.customer.trim() ? "Välj kund" :
                                !form.manufacturer.trim() ? "Välj tillverkare" :
                                  !form.model.trim() ? "Välj modell" :
                                    !form.serial.trim() ? "Fyll i serienummer" :
                                      "Spara enhet"
                          }
                        >
                          {isSaving ? "Sparar…" : "Spara enhet"}
                        </button>
                      </div>
                    </div>
                  )}

                </div> {/* end WIZARD_WRAP */}

                {/* Lista + edit-modal */}
                {isLoadingItems && (
                  <div className="gw-content" style={{ marginTop: 20, fontStyle: "italic", opacity: 0.8 }}>
                    Laddar enheter…
                  </div>
                )}

                {items.length > 0 && (
                  <div className="gw-content">
                    <section className="gw-section">
                      <div className="gw-section-header">
                        <h3 className="gw-h3" style={{ margin: 0 }}>Sparade enheter</h3>

                        <div className="gw-section-actions">
                          <button
                            onClick={openDeleteModal}
                            disabled={pendingDeletableIds.length === 0}
                            className="btn btn-danger"
                            title="Radera markerade"
                          >
                            Radera markerade
                          </button>
                        </div>

                        {hasNewTopItems && pageIndex > 1 && (
                          <div
                            role="status"
                            aria-live="polite"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 12,
                              padding: "8px 12px",
                              margin: "10px 0 6px",
                              borderRadius: 8,
                              background: "#FFF7D6",
                              border: "1px solid #F5E6A7",
                              fontSize: 14,
                            }}
                          >
                            <span>Det finns nya poster överst i listan.</span>
                            <button
                              className="btn"
                              onClick={() => { setHasNewTopItems(false); fetchFirstPage(); }}
                            >
                              Ladda nya
                            </button>
                          </div>
                        )}
                      </div>

                      {/* ---- MOBIL ---- */}
                      {isMobile ? (
                        <>
                          {/* Filterpanel */}
                          <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
                            <ClearableInput
                              placeholder="Sök ordernr…"
                              value={filters.orderNumber}
                              onChange={(v) => setFilters((f) => ({ ...f, orderNumber: v }))}
                              className="filter-input"
                            />
                            <ClearableInput
                              placeholder="Sök tillverkare…"
                              value={filters.manufacturer}
                              onChange={(v) => setFilters((f) => ({ ...f, manufacturer: v }))}
                              className="filter-input"
                            />
                            <ClearableInput
                              placeholder="Sök modell…"
                              value={filters.model}
                              onChange={(v) => setFilters((f) => ({ ...f, model: v }))}
                              className="filter-input"
                            />
                            <ClearableInput
                              placeholder="Sök serienr…"
                              value={filters.serial}
                              onChange={(v) => setFilters((f) => ({ ...f, serial: v }))}
                              className="filter-input"
                            />
                            <ClearableInput
                              placeholder="Skapad av…"
                              value={filters.createdBy}
                              onChange={(v) => setFilters((f) => ({ ...f, createdBy: v }))}
                              className="filter-input"
                            />
                          </div>

                          {/* Kortlista */}
                          <div>
                            {visibleItems.map((it) => {
                              const state = getRowState(it); // "open" | "ready" | "invoiced"
                              const lockedByOther = !!it.lockedBy && it.lockedBy !== currentUserString();
                              const lockHint = lockedByOther
                                ? `Redigeras av ${it.lockedBy}${it.lockedAt ? " sedan " + new Date(it.lockedAt as any).toLocaleString() : ""}`
                                : "";
                              const checkboxDisabled = state !== "open" || lockedByOther;

                              return (
                                <div key={it.id} className={`mobile-card row-${state}`}>
                                  <div className="mobile-topbar">
                                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                      <input
                                        type="checkbox"
                                        checked={selectedItems.includes(it.id)}
                                        onChange={(e) => { if (!checkboxDisabled) onToggleDeleteFromList(it, e.target.checked); }}
                                        disabled={checkboxDisabled}
                                        title={
                                          lockedByOther
                                            ? lockHint
                                            : state !== "open"
                                              ? "Kan inte raderas – enheten är färdig/fakturerad"
                                              : selectedItems.includes(it.id)
                                                ? "Avmarkera radering"
                                                : "Markera för radering"
                                        }
                                        style={checkboxDisabled ? { cursor: "not-allowed", opacity: 0.6 } : undefined}
                                      />
                                      <span style={{ fontWeight: 600 }}>
                                        {it.manufacturer || "-"} {it.model || ""}
                                      </span>
                                    </label>
                                  </div>

                                  <div className="mobile-row">
                                    <span className="mobile-label">Ordernr</span>
                                    <span>{it.orderNumber || "-"}</span>

                                    <span className="mobile-label">Serienr</span>
                                    <span>
                                      {it.serial ? (
                                        <button onClick={() => openEdit(it)} style={SERIAL_LINK_BTN} title="Visa/Redigera">
                                          {formatSerialForDisplay(it.serial)}
                                        </button>
                                      ) : "—"}
                                    </span>

                                    <span className="mobile-label">Adapter</span>
                                    <span>{it.chargerIncluded ? "Ja" : "Nej"}</span>

                                    <span className="mobile-label">Skapad</span>
                                    <span>{fmtDate(it.createdAt)}</span>

                                    <span className="mobile-label">Skapad av</span>
                                    <span>{it.createdBy || (it as any).initials || "-"}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        /* ---- DESKTOP: tabell ---- */
                        <div className="gw-table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th></th>
                                <th>Ordernr</th>
                                <th>Tillverkare</th>
                                <th>Modell</th>
                                <th>Serienr</th>
                                <th>Adapter</th>
                                <th>Skapad</th>
                                <th>Skapad av</th>
                              </tr>
                              <tr>
                                <th></th>
                                <th>
                                  <ClearableInput
                                    placeholder="Sök…"
                                    value={filters.orderNumber}
                                    onChange={(v) => setFilters((f) => ({ ...f, orderNumber: v }))}
                                    inputProps={{ "aria-label": "Filter Ordernr" }}
                                  />
                                </th>
                                <th>
                                  <ClearableInput
                                    placeholder="Sök…"
                                    value={filters.manufacturer}
                                    onChange={(v) => setFilters((f) => ({ ...f, manufacturer: v }))}
                                    inputProps={{ "aria-label": "Filter Tillverkare" }}
                                  />
                                </th>
                                <th>
                                  <ClearableInput
                                    placeholder="Sök…"
                                    value={filters.model}
                                    onChange={(v) => setFilters((f) => ({ ...f, model: v }))}
                                    inputProps={{ "aria-label": "Filter Modell" }}
                                  />
                                </th>
                                <th>
                                  <ClearableInput
                                    placeholder="Sök…"
                                    value={filters.serial}
                                    onChange={(v) => setFilters((f) => ({ ...f, serial: v }))}
                                    inputProps={{ "aria-label": "Filter Serienr" }}
                                  />
                                </th>
                                <th>
                                  <ClearableInput
                                    placeholder='t.ex. "ja"/"nej"'
                                    value={filters.chargerIncluded}
                                    onChange={(v) => setFilters((f) => ({ ...f, chargerIncluded: v.toLowerCase() }))}
                                    inputProps={{ "aria-label": "Filter Adapter" }}
                                  />
                                </th>
                                <th>
                                  <ClearableInput
                                    placeholder="Datum/tid"
                                    value={filters.createdAt}
                                    onChange={(v) => setFilters((f) => ({ ...f, createdAt: v }))}
                                    inputProps={{ "aria-label": "Filter Skapad" }}
                                  />
                                </th>
                                <th>
                                  <ClearableInput
                                    placeholder="Skapad av"
                                    value={filters.createdBy}
                                    onChange={(v) => setFilters((f) => ({ ...f, createdBy: v }))}
                                    inputProps={{ "aria-label": "Filter Skapad av" }}
                                  />
                                </th>
                              </tr>
                            </thead>


                            <tbody>
                              {visibleItems.map((it) => {
                                const state = getRowState(it); // "open" | "ready" | "invoiced"
                                const lockedByOther = !!it.lockedBy && it.lockedBy !== currentUserString();
                                const lockHint = lockedByOther
                                  ? `Redigeras av ${it.lockedBy}${it.lockedAt ? " sedan " + new Date(it.lockedAt as any).toLocaleString() : ""
                                  }`
                                  : "";

                                // checkbox disabled om ej "open" eller låst av annan
                                const checkboxDisabled = state !== "open" || lockedByOther;

                                return (
                                  <tr key={it.id} className={`row-${state}`}>
                                    <td style={{ textAlign: "center" }}>
                                      <input
                                        type="checkbox"
                                        checked={!!it.deletePending}
                                        onChange={(e) => onToggleDeleteFromList(it, e.target.checked)}
                                        disabled={checkboxDisabled}
                                        title={
                                          lockedByOther
                                            ? lockHint
                                            : state !== "open"
                                              ? "Kan inte raderas – enheten är färdig/fakturerad"
                                              : !!it.deletePending
                                                ? "Avmarkera radering"
                                                : "Markera för radering"
                                        }
                                        style={checkboxDisabled ? { cursor: "not-allowed", opacity: 0.6 } : undefined}
                                      />
                                    </td>

                                    <td>{it.orderNumber || "-"}</td>
                                    <td>{it.manufacturer || "-"}</td>
                                    <td>{it.model || "-"}</td>

                                    <td>
                                      {it.serial ? (
                                        <button onClick={() => openEdit(it)} style={SERIAL_LINK_BTN} title="Visa/Redigera">
                                          {formatSerialForDisplay(it.serial)}
                                        </button>
                                      ) : (
                                        "—"
                                      )}
                                    </td>

                                    <td>{it.chargerIncluded ? "Ja" : "Nej"}</td>
                                    <td>{fmtDate(it.createdAt)}</td>
                                    <td>
                                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                        <span>{it.createdBy || (it as any).initials || "-"}</span>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>

                          </table>
                        </div>
                      )}

                      {/* Auto-load sentinel (osynlig) – placera precis ovanför pagineringsfootern */}
                      <div ref={loadMoreRef} aria-hidden="true" style={{ height: 1 }} />


                      {/* Paginering-footer */}
                      <div
                        className="gw-section-footer"
                        style={{ display: "flex", justifyContent: "center", marginTop: 12 }}
                      >
                        {pageHasNext ? (
                          <button
                            className="btn"
                            onClick={fetchNextPage}
                            disabled={pageIsLoading}
                            aria-busy={pageIsLoading}
                          >
                            {pageIsLoading ? "Laddar…" : "Visa fler"}
                          </button>
                        ) : (
                          <span style={{ fontSize: 12, color: "#6b7280" }}>
                            {items.length > 0 ? "Inga fler poster." : "—"}
                          </span>
                        )}
                      </div>
                      {/* --- Paginering: kontroller under listan (auto-refresh aktiv) --- */}
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
                        <span style={{ color: "#6b7280" }}>
                          Uppdateras automatiskt — senast {fmtUpdateTime(pageLastRefreshAt)}
                          {pageIsLoading ? " (laddar…)" : ""}
                        </span>

                        <div style={{ marginLeft: "auto" }} />

                        <button
                          type="button"
                          className="btn"
                          onClick={fetchNextPage}
                          disabled={!pageHasNext || pageIsLoading}
                          title={pageHasNext ? "Hämta nästa sida" : "Inga fler poster"}
                        >
                          Nästa sida →
                        </button>
                      </div>

                      {/* Autoload-indikator (visas när infinite scroll/knappen laddar nästa sida) */}
                      {pageIsLoading && pageHasNext && (
                        <div role="status" aria-live="polite"
                          style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
                          <span style={{ fontSize: 12, color: "#6b7280" }}>Laddar fler…</span>
                        </div>
                      )}

                      <BackToTopButton />

                    </section>

                    {/* Edit-modal + Delete-modal (oförändrat) */}
                    <EditModal
                      isOpen={isEditOpen}
                      onClose={closeEdit}
                      manufacturerList={manufacturerList}
                      editForm={editForm}
                      onChange={handleEditChange}
                      onSave={saveEdit}
                      largeImage={largeImage}
                      setLargeImage={setLargeImage}
                      onComplete={markAsCompleted}
                      onReopen={reopenForEditing}
                      isCompleted={!!editForm.completed}
                      isReadOnly={editIsReadOnly}
                      invoiceReportId={editInvoiceReportId}
                      isSaving={isSaving}
                      onUnmarkDelete={unmarkDelete}
                      setEditForm={setEditForm}
                      itemId={editId!}
                    />

                    {showDeleteModal && createPortal(
                      <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="delete-title"
                        className="gw-modal-overlay"
                        onClick={cancelDeleteModal}
                      >
                        <div className="gw-modal-card" onClick={(e) => e.stopPropagation()}>
                          <h3 id="delete-title" className="gw-modal-title">Bekräfta radering</h3>
                          <p style={{ margin: "10px 0 16px" }}>
                            Du är på väg att radera <b>{pendingDeletableIds.length}</b> markerad(e) enhet(er).
                            Skriv <code>DELETE</code> med stora bokstäver för att bekräfta.
                          </p>
                          <input
                            type="text"
                            autoFocus
                            value={deleteConfirmText}
                            onChange={(e) => setDeleteConfirmText(e.target.value)}
                            placeholder='Skriv "DELETE"'
                            aria-label='Skriv "DELETE" för att bekräfta'
                            className="gw-input"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && deleteConfirmText === "DELETE") {
                                void confirmDeleteModal();
                              }
                            }}
                          />
                          <div className="gw-modal-actions">
                            <button onClick={cancelDeleteModal} className="btn">Avbryt</button>
                            <button
                              onClick={confirmDeleteModal}
                              disabled={deleteConfirmText !== "DELETE"}
                              className={`btn btn-danger${deleteConfirmText === "DELETE" ? " is-active" : ""}`}
                            >
                              Jag förstår – radera
                            </button>
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                )}

              </>
            )}

            {/* FAKTURERING */}
            {activePage === "fakturering" && (
              <section className="gw-page">
                <div className="gw-page-header">
                  <h1 className="gw-page-title">Fakturering</h1>
                  <button
                    className="btn btn-primary"
                    disabled={isGenerating}
                    onClick={async () => {
                      if (isGenerating) return;
                      setIsGenerating(true);
                      try {
                        const completedItems = items.filter((i) => i.completed && !i.invoiceReportId);
                        const userEmail =
                          (typeof auth !== "undefined" && auth?.currentUser?.email) ? auth.currentUser.email : null;

                        const { name, count, customer } =
                          await generateInvoiceReportForMarkedItems(completedItems, userEmail);

                        alert(`Rapport skapad: ${name} (${count} st) för kund ${customer}`);
                        await fetchItems();
                      } catch (err: any) {
                        alert(err?.message ?? "Kunde inte skapa rapport.");
                      } finally {
                        setIsGenerating(false);
                      }
                    }}
                  >
                    {isGenerating ? "Genererar…" : "Generera fakturarapport"}
                  </button>
                </div>

                <div className="gw-card">
                  <p className="text-muted" style={{ marginTop: 0 }}>
                    Visar enheter markerade som <strong>Färdig</strong>.
                  </p>

                  {items.filter(i => i.completed && !i.invoiceReportId).length === 0 ? (
                    <div className="text-muted">Inga färdigställda enheter ännu.</div>
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
                            <th className="td-narrow">Ominstallation OS</th>
                            <th className="td-narrow">Wipe i Endpoint</th>
                            <th className="td-narrow">Uppstartstest efter Wipe</th>
                            <th className="td-narrow">Dataradering</th>
                            <th className="td-narrow">Refurbish</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items
                            .filter((i) => i.completed && !i.invoiceReportId)
                            .sort((a, b) => String(b.completedAt || "").localeCompare(String(a.completedAt || "")))
                            .map((it) => {
                              const statusParts: string[] = [];
                              if (it.reuse) statusParts.push("Återbruk");
                              if (it.resold) statusParts.push("Vidaresålt");
                              if (it.scrap) statusParts.push("Skrotad");
                              const status = statusParts.join(" / ") || "-";

                              const hasSteps = typeof (it as any).f3Procedure === "number";
                              const steps = hasSteps
                                ? {
                                  f3Procedure: (it as any).f3Procedure,
                                  endpointRemoval: (it as any).endpointRemoval,
                                  osReinstall: (it as any).osReinstall,
                                  endpointWipe: (it as any).endpointWipe,
                                  postWipeBootTest: (it as any).postWipeBootTest,
                                  dataErasure: (it as any).dataErasure,
                                  refurbish: (it as any).refurbish,
                                }
                                : computeBillingSteps({
                                  reuse: !!(it as any).reuse,
                                  resold: !!(it as any).resold,
                                  scrap: !!(it as any).scrap,
                                });

                              return (
                                <tr key={it.id}>
                                  <td className="td-center td-narrow">
                                    <input
                                      type="checkbox"
                                      disabled={isGenerating}
                                      checked={!!it.markedForInvoice}
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => e.stopPropagation()}
                                      onChange={async (e) => {
                                        const checked = e.currentTarget.checked;
                                        setItems((prev: Item[]) =>
                                          prev.map((x) => (x.id === it.id ? { ...x, markedForInvoice: checked } : x))
                                        );
                                        try {
                                          await setMarkedForInvoice(it.id, checked);
                                        } catch {
                                          setItems((prev: Item[]) =>
                                            prev.map((x) => (x.id === it.id ? { ...x, markedForInvoice: !checked } : x))
                                          );
                                        }
                                      }}
                                    />
                                  </td>
                                  <td>{it.orderNumber || "-"}</td>
                                  <td>{it.manufacturer || "-"}</td>
                                  <td>{it.model || "-"}</td>
                                  <td className="td-narrow">{formatSerialForDisplay(it.serial)}</td>
                                  <td>{(it as any).customer || "-"}</td>
                                  <td className="td-truncate" title={it.completedBy || "-"}>
                                    {it.completedBy || "-"}
                                  </td>
                                  <td className="td-narrow">{it.completedAt ? fmtDateOnly(it.completedAt) : "-"}</td>
                                  <td className="td-narrow">{status}</td>

                                  {/* Stegkolumner (1/0) */}
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
            )}

            {/* ANVÄNDARE (endast admin) */}
            {activePage === "users" && user?.role === "admin" && <UsersAdmin />}

            {/* RAPPORTER */}
            {activePage === "rapporter" && <ReportsPage />}
          </div>
        </div>
      )
      }
    </div >
  );
} // end component