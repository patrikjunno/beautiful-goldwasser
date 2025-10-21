/* 
=========================================================
 App.tsx — organized (comments-only; no logic changes)
 Generated: 2025-10-15T12:48:23Z
 Notes:
 - This file is a copy of your current App.tsx with a clear header.
 - No code was reordered or modified; only this header was added.
 - Use it as a starting point; we can iterate to add section banners
   or safely reorder types/styles to the top if you like.
=========================================================
*/


/* GW_SOURCE_OF_TRUTH
  file: src/App.tsx
  shortSHA: C515CD5A505147
  pinnedAt: 2025-09-08
*/

// Lås- och heartbeat-parametrar (stabilare för flera testare)
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const LOCK_STALE_MINUTES = 5; // ⬅︎ var 0.1 (~6 sek). Nu 5 min för rimlig TTL
const LOCK_STALE_MS = LOCK_STALE_MINUTES * 60 * 1000;

// håll koll var 5–60 s, och alltid < stale/2 för att förnya lås i tid
const LOCK_HEARTBEAT_MS = Math.max(5000, Math.min(60000, Math.floor(LOCK_STALE_MS / 2)));

// Låt watcher vara aktiv i test (behövs för att släppa lås som blitt gamla)
const QA_DISABLE_LOCK_WATCHER = false;

const IS_DEV_HOST = typeof location !== "undefined" && location.hostname === "localhost";

const isCustomer = (u: { role?: unknown } | null | undefined): boolean =>
  String((u as any)?.role) === "customer";




//import EditModal from "./components/edit/EditModal";

// React & DOM
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Pages
import COReport from "./pages/coreport";
import InvoicingPage from "./pages/InvoicingPage";
import ProductTypesAdmin from "./pages/ProductTypesAdmin";
import ReportDetailPage from "./pages/ReportDetailPage";
import ReportsPage from "./pages/ReportsPage";
import UserAdmin from "./pages/UserAdmin";

// Components
import ClearableInput from "./components/ClearableInput";
import ThemeToggle from "./ThemeToggle";

// Services & Lib
import { ensureProductTypeInDb, loadProductTypesForImpact } from "./services/productTypes";
import { queryInventoryForReport } from "./services/inventory";
import type { ReportFilters } from "./lib/schema";
import {
  prepareImpactDisplayFromRaw,
  validateCompletionChoice as impactValidateCompletionChoice,
} from "./lib/impact";
import type { PreparedImpactDisplay, ProductType, RawImpactItem } from "./lib/impact";
import { computeBillingSteps, buildInvoiceSummary } from "./lib/billing";
import type { InvoiceSummary } from "./lib/billing";
import { REPORTS_COLLECTION, INVOICE_SUBCOLLECTION } from "./lib/reports";

// Firebase app bindings
import { auth, db, storage } from "./firebase";

// Firebase — Firestore (types)
import type {
  DocumentData,
  FirestoreError,
  QueryDocumentSnapshot,
  QuerySnapshot,
  Unsubscribe,
  UpdateData,
  WithFieldValue,
} from "firebase/firestore";

// Firebase — Firestore (values)
import {
  addDoc,
  arrayUnion,
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

// Firebase — Storage
import {
  deleteObject,
  getDownloadURL,
  listAll,
  ref,
  ref as storageRef,
  uploadBytes,
  uploadBytesResumable,
} from "firebase/storage";

// Firebase — Auth & Functions
import {
  createUserWithEmailAndPassword,
  getAuth,
  getIdTokenResult,
  onAuthStateChanged,
  onIdTokenChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";

// Styles
import "./styles.css";



// ──────────────────────────────────────────────────────────────
// Helper: validera produkttyp innan "Markera som färdig"
// Kräver Firestore-importer: doc, getDoc  (lägg till i din import från "firebase/firestore" om de saknas)
// ──────────────────────────────────────────────────────────────
async function assertValidProductTypeOrExplain(
  productTypeId?: string | null,
  productTypeLabel?: string | null
): Promise<boolean> {
  try {
    // 1) Måste finnas ett id
    if (!productTypeId || !String(productTypeId).trim()) {
      alert(
        "Produkttyp saknar ID.\n" +
        "Gå till Rapporter → Produkttyper och säkerställ att typen har slug (productTypeId) samt faktorvärden."
      );
      return false;
    }

    // 2) Hämta typen
    const ref = doc(db, "productTypes", String(productTypeId));
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      alert(
        `Produkttypen (${productTypeLabel || productTypeId}) finns inte i 'productTypes'.\n` +
        "Skapa den i Rapporter → Produkttyper och ange vikt/CO₂."
      );
      return false;
    }

    const data = snap.data() as any;
    const active = data?.active !== false; // default true
    const weight = Number(data?.medianWeightKg ?? 0);
    const co2 = Number(data?.co2PerUnitKg ?? 0);

    // 3) Regler: aktiv + båda faktorerna > 0
    if (!active || weight <= 0 || co2 <= 0) {
      alert(
        `Produkttypen '${data?.label ?? productTypeLabel ?? productTypeId}' är ` +
        `${!active ? "inaktiv" : ""}${!active && (weight <= 0 || co2 <= 0) ? " och " : ""}` +
        `${(weight <= 0 || co2 <= 0) ? "saknar giltiga faktorvärden (vikt/CO₂ > 0)" : ""}.\n\n` +
        "Åtgärd: Öppna Rapporter → Produkttyper, aktivera typen och sätt vikt/CO₂, eller välj en annan typ."
      );
      return false;
    }

    return true;
  } catch (e) {
    console.error("assertValidProductTypeOrExplain failed:", e);
    alert("Kunde inte kontrollera produkttypens faktorer. Försök igen.");
    return false;
  }
}


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






type AuditAction = "created" | "updated" | "completed" | "reopened" | "delete_marked" | "delete_unmarked";
interface AuditEntry {
  action: AuditAction;
  by: string | null;
  at: string; // ISO
}


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



// ===== Fakturering: skapa rapport från markerade poster (ID-baserad kund) =====
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

  // 2) ID-baserad kundkontroll: exakt EN customerId
  const customerIds = Array.from(new Set(marked.map((it) => String(it.customerId || "")).filter(Boolean)));
  if (customerIds.length !== 1) {
    throw new Error("Endast en kund per rapport. Justera dina markeringar (kund-ID).");
  }
  const customerId = customerIds[0];

  // 3) Ta fram visningsnamn för rapporttiteln (fallback till ID om namn saknas)
  const firstForCustomer = marked.find((it) => String(it.customerId || "") === customerId);
  const customerName = (firstForCustomer?.customer && String(firstForCustomer.customer).trim()) || customerId;

  // 4) Namn: "Kund YYMMDDHHMM"
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const name = `${customerName} ${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;

  // 5) Summering
  const summary = buildInvoiceSummary(marked);

  // 6) Skriv rapporten (spara både customerId och customerName för spårbarhet)
  const reportsParent = doc(db, REPORTS_COLLECTION, "root");
  const reportsCol = collection(reportsParent, INVOICE_SUBCOLLECTION);
  const reportRef = await addDoc(reportsCol, {
    name,
    customer: customerName,      // behåll visningsnamn (bakåtkompatibelt)
    customerId,                  // ✅ NYTT: stabilt ID
    createdAt: serverTimestamp(),
    createdBy: currentUserEmail,
    itemIds: marked.map((m) => m.id),
    summary,
  });

  const reportId = reportRef.id;

  // 7) Uppdatera alla berörda items (rensa markering, sätt koppling + tidsstämpel)
  const updates = marked.map((it) =>
    updateDoc(doc(db, "itInventory", it.id), {
      markedForInvoice: false,
      invoiceReportId: reportId,
      invoicedAt: serverTimestamp(),
      // permanentlyLocked: true, // om du använder detta
    })
  );
  await Promise.all(updates);

  // Returnera kundens visningsnamn (signaturen förväntar 'customer: string')
  return { reportId, name, count: marked.length, customer: customerName };
}


interface BaseItem {
  orderNumber: string;
  manufacturer: string;
  model: string;
  productType?: string | null;
  warrantyStartDate?: string | null;
  serial: string; // final serial
  serialBase?: string;
  chargerIncluded: boolean;
  adapterYesNo?: "Yes" | "No" | "";   // 🆕 lagras som Yes/No
  damageNotes: string;
  photos: PhotoURLMap;
  customer?: string;
  customerId?: string | null;
  articleNumber?: string;
  createdAt: FirestoreDate;
  createdBy: string | null;
  auditLog: AuditEntry[];
  completed: boolean;
  completedAt: FirestoreDate;
  completedBy: string | null;
  lockedBy?: string | null;
  lockedAt?: string | null;
  productTypeId?: string | null;


  // Statusval vid färdigställning
  reuse?: boolean;
  resold?: boolean;
  scrap?: boolean;

  // 🆕 Gradering A–D
  grade?: 'A' | 'B' | 'C' | 'D' | 'E' | '';

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
  productType: string;
  warrantyStartDate: string;
  serial: string;
  chargerIncluded: boolean;
  adapterYesNo: string;

  customer: string;
  customerKey?: string;
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

// ---- Cloud Function: vendorLookup (client wrapper) ----
type VendorLookupResponse =
  | {
    ok: true;
    normalizedSerial: string;
    deepLink: string | null;
    model: string | null;
    warrantyStartDate: string | null;
    notes: string;
  }
  | {
    ok: false;
    normalizedSerial: string;        // vi skickar tillbaka det vi försökte med
    deepLink: null;
    model: null;
    warrantyStartDate: null;
    notes: string;                   // felmeddelande
  };

const functions = getFunctions(undefined, "europe-west1");
const vendorLookupCallable = httpsCallable<
  { manufacturer?: string; serial?: string },
  VendorLookupResponse
>(functions, "vendorLookup");

async function callVendorLookup(manufacturer: string, serialRaw: string): Promise<VendorLookupResponse> {
  // normalisera innan vi skickar
  const base = splitSerialParts(serialRaw || "").base;
  const serial = normalizeSerialKey(base);
  const manu = (manufacturer || "").trim();

  try {
    const res = await vendorLookupCallable({ manufacturer: manu, serial });
    return (res.data as VendorLookupResponse) ?? {
      ok: false,
      normalizedSerial: serial,
      deepLink: null,
      model: null,
      warrantyStartDate: null,
      notes: "Tomt svar från vendorLookup",
    };
  } catch (err: any) {
    // HttpsError hamnar här
    const msg =
      err?.message ||
      err?.details ||
      (typeof err === "string" ? err : "Anrop misslyckades");
    return {
      ok: false,
      normalizedSerial: serial,
      deepLink: null,
      model: null,
      warrantyStartDate: null,
      notes: msg,
    };
  }
}

// (frivilligt) snabbtest i dev-console:
; (window as any).testVendorLookup = async (m: string, s: string) => {
  const r = await callVendorLookup(m, s);
  console.log("vendorLookup →", r);
  return r;
};

// Dev helper: testa Cloud Function vendorScrapeHp från konsolen
; (window as any).testVendorScrapeHp = async (serial: string) => {
  const fns = getFunctions(undefined, "europe-west1");
  const call = httpsCallable(fns, "vendorScrapeHp");
  const res = await call({ manufacturer: "hp", serial }); // 👈 skicka med manufacturer
  console.log("scrapeHP →", res.data);
  return res.data;
};



// --- Robust månads-mapping (engelska + svenska) utan dubbletter ---

// Normalisera sträng för månadslookup (små bokstäver, ta bort diakritik & punkter)
const normalizeMonthToken = (s: string) =>
  s.toLowerCase().replace(/\./g, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Synonymer per månad
const MONTH_SYNONYMS: Array<[number, string[]]> = [
  [1, ["jan", "january", "januari"]],
  [2, ["feb", "february", "februari"]],
  [3, ["mar", "march", "mars"]],
  [4, ["apr", "april"]],
  [5, ["may", "maj"]],
  [6, ["jun", "june", "juni"]],
  [7, ["jul", "july", "juli"]],
  [8, ["aug", "august", "augusti"]],
  [9, ["sep", "sept", "september"]],
  [10, ["oct", "october", "okt", "oktober"]],
  [11, ["nov", "november"]],
  [12, ["dec", "december", "december"]],
];

// Bygg upp en lookup-tabell
const MONTH_NAME_TO_NUM: Record<string, number> = {};
for (const [num, names] of MONTH_SYNONYMS) {
  for (const name of names) {
    MONTH_NAME_TO_NUM[normalizeMonthToken(name)] = num;
  }
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const isValidYMD = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
};

/**
 * Tolkar lösa datumformat (t.ex. "June 15, 2020", "15 juni 2020", "2020-06-15", "15/6/2020")
 * och returnerar ISO "YYYY-MM-DD" eller null om otolkbart.
 */
function parseLooseDateToISO(raw: string): string | null {
  if (!raw) return null;

  // Trim + städa: ta bort ordningsändelser (1st/2nd/3rd/4th) och punkter i månadsabbrev (Oct.)
  let s = raw.trim()
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/\./g, "");

  // 1) Month-name first: "June 15, 2020" / "oktober 15, 2020"
  {
    const m = s.match(/^\s*([A-Za-zÅÄÖåäö]+)\s+(\d{1,2})(?:,)?\s+(\d{4})\s*$/);
    if (m) {
      const monthName = normalizeMonthToken(m[1]);
      const day = parseInt(m[2], 10);
      const year = parseInt(m[3], 10);
      const month = MONTH_NAME_TO_NUM[monthName];
      if (month && isValidYMD(year, month, day)) return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  // 2) Day first: "15 June 2020" / "15 juni 2020"
  {
    const m = s.match(/^\s*(\d{1,2})\s+([A-Za-zÅÄÖåäö]+)\s+(\d{4})\s*$/);
    if (m) {
      const day = parseInt(m[1], 10);
      const monthName = normalizeMonthToken(m[2]);
      const year = parseInt(m[3], 10);
      const month = MONTH_NAME_TO_NUM[monthName];
      if (month && isValidYMD(year, month, day)) return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  // 3) Numeriskt ISO/US: "2020-06-15" / "2020/6/15" / "2020.6.15"
  {
    const m = s.match(/^\s*(\d{4})[.\-/ ](\d{1,2})[.\-/ ](\d{1,2})\s*$/);
    if (m) {
      const year = parseInt(m[1], 10);
      const month = parseInt(m[2], 10);
      const day = parseInt(m[3], 10);
      if (isValidYMD(year, month, day)) return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  // 4) Numeriskt EU: "15-06-2020" / "15/6/2020" / "15.6.2020"
  {
    const m = s.match(/^\s*(\d{1,2})[.\-/ ](\d{1,2})[.\-/ ](\d{4})\s*$/);
    if (m) {
      const day = parseInt(m[1], 10);
      const month = parseInt(m[2], 10);
      const year = parseInt(m[3], 10);
      if (isValidYMD(year, month, day)) return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  return null;
}





function buildWarrantyLink(manufacturer: string, serialRaw: string): string | null {
  const manu = (manufacturer || "").trim().toLowerCase();
  const base = splitSerialParts(serialRaw || "").base;
  const serial = normalizeSerialKey(base); // UPPERCASE + utan separatorer
  if (!serial) return null;

  if (["hp", "hewlett-packard", "hewlett packard"].includes(manu)) {
    // HP:s “check warranty” (med bindestreck i pathen)
    return `https://support.hp.com/se-sv/check-warranty?serialnumber=${encodeURIComponent(serial)}`;
  }

  // 🆕 Microsoft / Surface → öppna Surface-portalen (ingen serial-param behövs)
  if (manu.includes("microsoft") || manu.includes("surface")) {
    return "https://mybusinessservice.surface.com/";
  }

  // Lenovo – öppna warranty lookup (vi kopierar serienr åt användaren)
  if (manu.includes("lenovo")) {
    return "https://pcsupport.lenovo.com/se/sv/warrantylookup";
  }

  return null;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback för äldre browsers
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch { }
    document.body.removeChild(ta);
  }
}



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
// ===== DEV: Wipe helpers (Firestore + Storage) =====

// Små utilities
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function deleteCollectionHard(collPath: string, batchSize = 400) {
  const collRef = collection(db, collPath);
  let totalDeleted = 0;

  while (true) {
    const snap = await getDocs(collRef);
    if (snap.empty) break;

    const docs = snap.docs.slice(0, batchSize);
    const b = writeBatch(db);
    for (const d of docs) b.delete(d.ref);
    await b.commit();

    totalDeleted += docs.length;
    console.log(`[wipe:${collPath}] deleted ${docs.length} (sum=${totalDeleted})`);
    await sleep(50);
  }

  console.log(`[wipe:${collPath}] DONE (sum=${totalDeleted})`);
}

async function deleteStorageFolderRecursive(path: string) {
  // vi använder din redan initierade `storage` från ../firebase
  const root = storageRef(storage, path);

  async function rec(node: ReturnType<typeof storageRef>) {
    const listing = await listAll(node);

    // ta bort filer
    for (const item of listing.items) {
      try {
        await deleteObject(item);
      } catch (e: any) {
        console.warn(`[storage] delete failed for ${item.fullPath}`, e?.message || e);
      }
    }
    // rekurs på undermappar
    for (const pref of listing.prefixes) {
      await rec(pref);
    }
  }

  await rec(root);
  console.log(`[storage:${path}] DONE`);
}

async function assertAdminOrThrow() {
  const u = auth.currentUser;
  if (!u) throw new Error("Ej inloggad.");
  const token = await u.getIdTokenResult(true);
  const claims: any = token.claims || {};
  const isAdmin =
    claims.admin === true ||
    claims.role === "admin" ||
    (claims.roles && claims.roles.admin === true);
  if (!isAdmin) throw new Error("Endast admin får köra wipe.");
}

// Dev: massuppdatera productTypes (kräver admin-claim)
; (window as any).seedProductTypes = async () => {
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
    const isAdmin = claims.admin === true || claims.role === "admin" || claims.roles?.admin === true;
    if (!isAdmin) {
      alert("Du är inte admin enligt dina claims.");
      console.log("claims:", claims);
      return;
    }

    // === DINA VÄRDEN ATT LÄGGA IN / UPPDATERA ===
    // Justera fritt om du vill.
    const types: Array<{
      id: string;
      label: string;
      medianWeightKg: number;
      co2PerUnitKg: number;
      active?: boolean;
      schemaVersion?: number;
    }> = [
        { id: "desktop", label: "Desktop", medianWeightKg: 7.60, co2PerUnitKg: 235, active: true, schemaVersion: 1 },
        { id: "laptop", label: "Laptop", medianWeightKg: 1.54, co2PerUnitKg: 194, active: true, schemaVersion: 1 },
        { id: "monitor", label: "Monitor", medianWeightKg: 5.90, co2PerUnitKg: 312, active: true, schemaVersion: 1 },
        { id: "printer", label: "Printer", medianWeightKg: 10.40, co2PerUnitKg: 452, active: true, schemaVersion: 1 },
        { id: "server", label: "Server", medianWeightKg: 23.13, co2PerUnitKg: 1200, active: true, schemaVersion: 1 },
        { id: "network", label: "Network product", medianWeightKg: 1.04, co2PerUnitKg: 85, active: true, schemaVersion: 1 },
        { id: "phone", label: "Phone", medianWeightKg: 0.14, co2PerUnitKg: 65, active: true, schemaVersion: 1 },
        { id: "tablet", label: "Tablet", medianWeightKg: 0.47, co2PerUnitKg: 121, active: true, schemaVersion: 1 },
        { id: "scanner", label: "Scanner", medianWeightKg: 2.34, co2PerUnitKg: 300, active: true, schemaVersion: 1 },
        { id: "pointofsales", label: "Point of sales", medianWeightKg: 7.25, co2PerUnitKg: 350, active: true, schemaVersion: 1 },
        { id: "copier", label: "Copier", medianWeightKg: 85.10, co2PerUnitKg: 2500, active: true, schemaVersion: 1 },
        { id: "dataprojector", label: "Data projector", medianWeightKg: 5.00, co2PerUnitKg: 250, active: true, schemaVersion: 1 },
      ];

    const by = auth.currentUser.email || auth.currentUser.uid || null;

    let ok = 0, fail = 0;
    for (const pt of types) {
      const ref = doc(db, "productTypes", pt.id);
      try {
        await setDoc(ref, {
          label: pt.label,
          medianWeightKg: pt.medianWeightKg,
          co2PerUnitKg: pt.co2PerUnitKg,
          schemaVersion: pt.schemaVersion ?? 1,
          active: pt.active ?? true,
          updatedAt: serverTimestamp(),
          updatedBy: by
        }, { merge: true }); // ← merge så vi inte tappar ev. befintliga fält
        ok++;
      } catch (e) {
        console.error("seed error for", pt.id, e);
        fail++;
      }
    }

    alert(`Seed klart. OK: ${ok}, Fel: ${fail}.`);
  } catch (e: any) {
    console.error("seedProductTypes:", e);
    alert("Kunde inte seeda productTypes: " + (e?.message || e));
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

// === SerialIndex: transaktions-helper vid CREATE ===
// Tilldelar nästa 'serialVisit' för en originalsträng (t.ex. "ABC 123"),
// uppdaterar serialIndex/{baseKey} atomiskt, och returnerar nycklar/visningssträng.
type SerialIndexDoc = {
  lastVisit?: number;   // senast tilldelade visit
  visits?: number;      // totalt (== lastVisit)
  active?: number;      // antal icke-raderade items
  lastSeen?: any;       // serverTimestamp()
  lastItemId?: string;  // senaste itemId som rörde indexet
};

async function allocateSerialVisitOnCreate(
  itemId: string,
  originalSerialRaw: string
): Promise<{ serialBaseKey: string; serialVisit: number; displaySerial: string }> {
  // Plocka ut "bas"-delen (utan ev. *N i input)
  const parts = splitSerialParts(originalSerialRaw || "");
  const rawBase = parts.base; // bevarar visningsformatet som användaren skrev (utan *suffix)
  const baseKey = normalizeSerialKey(rawBase); // UPPERCASE + utan separatorer → index-id

  if (!baseKey) {
    throw new Error("Serienummer saknas eller kan inte normaliseras.");
  }

  const indexRef = doc(db, "serialIndex", baseKey);

  const visit = await runTransaction(db, async (tx) => {
    const snap = await tx.get(indexRef);
    const cur = (snap.exists() ? (snap.data() as SerialIndexDoc) : {}) || {};
    const nextVisit = (typeof cur.lastVisit === "number" ? cur.lastVisit : 0) + 1;
    const nextActive = (typeof cur.active === "number" ? cur.active : 0) + 1;

    // Guardrails (telemetri-”varningar” i konsol; UI/observability kan plocka upp detta senare)
    if (typeof cur.visits === "number" && cur.visits < (cur.active ?? 0)) {
      console.warn("[serialIndex] invariant risk (före uppd): visits < active", { baseKey, cur });
    }

    const patch: SerialIndexDoc = {
      lastVisit: nextVisit,
      visits: nextVisit,           // vi sätter visits = lastVisit
      active: nextActive,
      lastSeen: serverTimestamp(),
      lastItemId: itemId,
    };

    if (snap.exists()) {
      tx.update(indexRef, patch as any);
    } else {
      tx.set(indexRef, patch as any);
    }

    // Guardrail: varna om invarianten bruten
    warnIfInvariantBroken({ where: "CREATE", baseKey, visits: nextVisit, active: nextActive });


    // Post-check (lokal konsolvarning)
    if (nextActive < 0 || nextVisit < nextActive) {
      console.warn("[serialIndex] invariant brott (efter uppd): visits < active", {
        baseKey, nextVisit, nextActive,
      });
    }

    return nextVisit;
  });

  // Formatera visningssträngen (ABC123*2 om visit > 1)
  const display = buildDisplaySerial(normalizeSerial(rawBase), visit);
  return { serialBaseKey: baseKey, serialVisit: visit, displaySerial: display };
}

// === SerialIndex helper: reallocateSerialOnEdit (ERSÄTT HELA FUNKTIONEN) ===
async function reallocateSerialOnEdit(
  itemId: string,
  prevBaseKey: string | null,
  nextSerial: string
): Promise<{
  changed: boolean;
  serialBaseKey: string;
  serialVisit: number;
  displaySerial: string;
}> {
  const { base: nextBaseRaw /*, visit: _ignored */ } = splitSerialParts(String(nextSerial || "").trim());
  const nextBaseKey = normalizeSerialKey(nextBaseRaw || "");

  if (!nextBaseKey) {
    throw new Error("[reallocateSerialOnEdit] nextBaseKey saknas (ogiltigt serienummer)");
  }

  // Om basen inte ändras: ingen indexskrivning; returnera bara normaliserad display med befintlig visit
  if (prevBaseKey && prevBaseKey === nextBaseKey) {
    const itemRef = doc(db, "itInventory", itemId);
    const itemSnap = await getDoc(itemRef);
    const curVisit = Number((itemSnap.data() as any)?.serialVisit ?? 0) || 0;
    const displaySerialSameBase = curVisit > 1 ? `${nextBaseRaw}*${curVisit}` : nextBaseRaw;

    return {
      changed: false,
      serialBaseKey: nextBaseKey,
      serialVisit: curVisit,
      displaySerial: displaySerialSameBase,
    };
  }

  // Transaktion: läs ALLT först → skriv sedan
  const itemRef = doc(db, "itInventory", itemId);
  const oldRef = prevBaseKey ? doc(db, "serialIndex", prevBaseKey) : null;
  const newRef = doc(db, "serialIndex", nextBaseKey);

  return await runTransaction(db, async (tx) => {
    // --- READS ---
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists()) {
      throw new Error("[reallocateSerialOnEdit] item saknas");
    }
    const oldSnap = oldRef ? await tx.get(oldRef) : null;
    const newSnap = await tx.get(newRef);

    const nowServer = serverTimestamp();

    // --- WRITE PLAN ---
    // 1) Decrement på gammal bas
    if (prevBaseKey && prevBaseKey !== nextBaseKey && oldRef) {
      if (oldSnap && oldSnap.exists()) {
        const o = oldSnap.data() as any;
        const nextActive = Math.max(0, Number(o.active ?? 0) - 1);
        tx.update(oldRef, {
          active: nextActive,
          lastSeen: nowServer,
          lastItemId: itemId,
        } as any);
      }
    }

    // 2) Increment på ny bas + räkna ut nextVisit
    let nextVisit: number;
    if (newSnap.exists()) {
      const n = newSnap.data() as any;
      const lastVisit = Number(n.lastVisit ?? n.visits ?? 0) || 0;
      nextVisit = lastVisit + 1;
      tx.update(newRef, {
        lastVisit: nextVisit,
        visits: nextVisit, // invarians: visits == lastVisit
        active: Number(n.active ?? 0) + 1,
        lastSeen: nowServer,
        lastItemId: itemId,
      } as any);
    } else {
      nextVisit = 1;
      tx.set(newRef, {
        lastVisit: nextVisit,
        visits: nextVisit,
        active: 1,
        lastSeen: nowServer,
        lastItemId: itemId,
      } as any);
    }

    // Bygg display *efter* att vi känner nextVisit
    const displaySerial = nextVisit > 1 ? `${nextBaseRaw}*${nextVisit}` : nextBaseRaw;

    // 3) Uppdatera item (serial + bas + visit)
    tx.update(itemRef, {
      serial: displaySerial,
      serialBase: nextBaseKey,
      serialBaseKey: nextBaseKey,
      serialVisit: nextVisit,
      updatedAt: nowServer,
    } as any);

    return {
      changed: true,
      serialBaseKey: nextBaseKey,
      serialVisit: nextVisit,
      displaySerial,
    };
  });
}




// === SerialIndex: guardrail/telemetri-helper ===
function warnIfInvariantBroken(ctx: {
  where: string;            // t.ex. "CREATE", "EDIT:new", "EDIT:old", "SOFT-DELETE", "UNDO-DELETE"
  baseKey: string;
  visits?: number | null;
  active?: number | null;
}) {
  const v = typeof ctx.visits === "number" ? ctx.visits : null;
  const a = typeof ctx.active === "number" ? ctx.active : null;

  if (a !== null && a < 0) {
    console.warn("[serialIndex] invariant: active < 0", ctx);
  }
  if (v !== null && a !== null && v < a) {
    console.warn("[serialIndex] invariant: visits < active", ctx);
  }
}



// === SerialIndex: soft-delete (active--) utan att röra visits/lastVisit ===
async function applySoftDeleteSerialIndex(
  itemId: string,
  serialBaseKey: string | null | undefined
): Promise<void> {
  const baseKey = String(serialBaseKey || "").trim();
  if (!baseKey) return;

  const idxRef = doc(db, "serialIndex", baseKey);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(idxRef);
    if (!snap.exists()) {
      console.warn("[serialIndex] index saknas vid soft-delete:", baseKey);
      return;
    }

    const cur = (snap.data() as any) || {};
    const nextActive = Math.max(0, Number(cur.active ?? 0) - 1);

    // visits/lastVisit lämnas orörda vid soft-delete (historik bevaras)
    const patch: any = {
      active: nextActive,
      lastSeen: serverTimestamp(),
      lastItemId: itemId,
    };

    tx.update(idxRef, patch);

    warnIfInvariantBroken({ where: "SOFT-DELETE", baseKey: idxRef.id, visits: (cur.visits ?? null), active: nextActive });


    if (nextActive < 0 || (typeof cur.visits === "number" && cur.visits < nextActive)) {
      console.warn("[serialIndex] invariant risk efter soft-delete", {
        baseKey,
        visits: cur.visits,
        nextActive,
      });
    }
  });
}

// === SerialIndex: undo soft-delete (active++) utan att röra visits/lastVisit ===
async function applyUndoSoftDeleteSerialIndex(
  itemId: string,
  serialBaseKey: string | null | undefined
): Promise<void> {
  const baseKey = String(serialBaseKey || "").trim();
  if (!baseKey) return;

  const idxRef = doc(db, "serialIndex", baseKey);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(idxRef);
    if (!snap.exists()) {
      console.warn("[serialIndex] index saknas vid undo-soft-delete:", baseKey);
      return;
    }

    const cur = (snap.data() as any) || {};
    const nextActive = Number(cur.active ?? 0) + 1;

    // visits/lastVisit rör vi inte vid undo; vi ökar bara active
    tx.update(idxRef, {
      active: nextActive,
      lastSeen: serverTimestamp(),
      lastItemId: itemId,
    } as any);

    warnIfInvariantBroken({ where: "UNDO-DELETE", baseKey: idxRef.id, visits: (cur.visits ?? null), active: nextActive });


    if (typeof cur.visits === "number" && cur.visits < nextActive) {
      console.warn("[serialIndex] invariant risk efter undo-soft-delete", {
        baseKey,
        visits: cur.visits,
        nextActive,
      });
    }
  });
}

// === DEV: Backfill/repair av serialIndex från itInventory ===
// - Läser alla poster i itInventory i batchar
// - Härleder baseKey + visit från item.serial (visningsfält "ABC123*2")
// - Räknar active = antal poster där !deletePending
// - Sätter lastVisit = max(visit), visits = lastVisit
// - Sätter lastItemId = itemId med högsta visit (eller valfri om lika)
// - lastSeen = serverTimestamp
async function backfillSerialIndex(opts?: { dryRun?: boolean; verbose?: boolean; batchSize?: number }) {
  const dryRun = opts?.dryRun ?? true;
  const verbose = opts?.verbose ?? true;
  const pageSize = Math.max(50, Math.min(500, opts?.batchSize ?? 200));

  type Row = { id: string; baseKey: string; visit: number; deletePending: boolean };
  const rows: Row[] = [];

  // 1) Paginera igenom itInventory (orderBy id för determinism)
  let cursor: any = null;
  while (true) {
    const baseQ = cursor
      ? query(collection(db, "itInventory"), orderBy("__name__"), startAfter(cursor), limit(pageSize))
      : query(collection(db, "itInventory"), orderBy("__name__"), limit(pageSize));

    const snap = await getDocs(baseQ);
    if (snap.empty) break;

    for (const d of snap.docs) {
      const x = d.data() as any;

      const parts = splitSerialParts(String(x?.serial ?? ""));
      const rawBase = parts.base;
      const visit = Math.max(1, Number(parts.visit || 1));
      const baseKey = normalizeSerialKey(rawBase);

      if (!baseKey) continue; // hoppa poster utan läsbart nummer

      rows.push({
        id: d.id,
        baseKey,
        visit,
        deletePending: !!x?.deletePending,
      });
    }

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  // 2) Gruppera per baseKey och räkna fram index
  const byBase = new Map<string, Row[]>();
  for (const r of rows) {
    const arr = byBase.get(r.baseKey) || [];
    arr.push(r);
    byBase.set(r.baseKey, arr);
  }

  if (verbose) console.log(`[backfillSerialIndex] found ${rows.length} items across ${byBase.size} baseKeys`);

  // 3) Skriv index i batchar
  const BATCH_LIMIT = 400;
  let batch = writeBatch(db);
  let pending = 0;
  let written = 0;

  // Undvik iteration över MapIterator (ES5-target) → använd Array.from(keys)
  const baseKeys: string[] = Array.from(byBase.keys());
  for (const baseKey of baseKeys) {
    const arr: Row[] = byBase.get(baseKey) || [];

    // active = antal icke-raderade
    const active: number = arr.filter((a: Row) => !a.deletePending).length;

    // lastVisit = max(visit); visits = lastVisit
    const lastVisit: number = arr.reduce((m: number, a: Row) => (a.visit > m ? a.visit : m), 0);
    const visits: number = lastVisit;

    // lastItemId = id för posten med högst visit (godtycklig vid lika)
    let lastItemId = "";
    let bestVisit = -1;
    for (const r of arr) {
      if (r.visit > bestVisit) {
        bestVisit = r.visit;
        lastItemId = r.id;
      }
    }

    const ref = doc(db, "serialIndex", baseKey);
    batch.set(
      ref,
      {
        lastVisit,
        visits,
        active,
        lastSeen: serverTimestamp(),
        lastItemId,
      },
      { merge: true }
    );

    pending++;
    if (pending >= BATCH_LIMIT) {
      if (!dryRun) await batch.commit();
      written += pending;
      if (verbose) console.log(`[backfillSerialIndex] committed ${written}`);
      batch = writeBatch(db);
      pending = 0;
    }
  }

  if (pending > 0) {
    if (!dryRun) await batch.commit();
    written += pending;
    if (verbose) console.log(`[backfillSerialIndex] committed ${written} (final)`);
  }

  if (verbose) console.log(`[backfillSerialIndex] DONE${dryRun ? " (dry-run: no writes)" : ""}`);

}


// Exponera i dev-konsolen
; (window as any).backfillSerialIndex = async (dry = true, verbose = true) => {
  return backfillSerialIndex({ dryRun: !!dry, verbose: !!verbose });
};

// === DEV: Skanna serialIndex för invariants och "hål" ===
// - Varna om visits < active eller active < 0
// - Flagga potentiella "hål" om lastVisit < (uppmätt maxVisit i itInventory)
//   (Obs: hål-kollen kräver att itInventory har korrekt *N; backfill gärna först.)
async function scanSerialIndexForIssues(opts?: { limitPerPage?: number; verbose?: boolean }) {
  const verbose = !!opts?.verbose;
  const pageSize = Math.max(50, Math.min(500, opts?.limitPerPage ?? 200));

  type Row = { id: string; visits: number; active: number; lastVisit: number; lastItemId?: string };
  const issues: Array<{ id: string; problem: string; visits: number; active: number; lastVisit: number }> = [];

  // 1) Läs alla serialIndex
  let idxRows: Row[] = [];
  let idxCursor: any = null;
  while (true) {
    const qIdx = idxCursor
      ? query(collection(db, "serialIndex"), orderBy("__name__"), startAfter(idxCursor), limit(pageSize))
      : query(collection(db, "serialIndex"), orderBy("__name__"), limit(pageSize));
    const snap = await getDocs(qIdx);
    if (snap.empty) break;

    for (const d of snap.docs) {
      const x: any = d.data() || {};
      idxRows.push({
        id: d.id,
        visits: Number(x.visits ?? 0),
        active: Number(x.active ?? 0),
        lastVisit: Number(x.lastVisit ?? 0),
        lastItemId: x.lastItemId,
      });
    }
    idxCursor = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  // 2) Snabb invariant-koll
  for (const r of idxRows) {
    if (r.active < 0) {
      issues.push({ id: r.id, problem: "active < 0", visits: r.visits, active: r.active, lastVisit: r.lastVisit });
    }
    if (r.visits < r.active) {
      issues.push({ id: r.id, problem: "visits < active", visits: r.visits, active: r.active, lastVisit: r.lastVisit });
    }
  }

  // 3) (Valfritt) "hål"-indikator via provtagning av itInventory
  //    För att undvika dyra fullscans: hämta top-visit per base via itInventory’s serial-fält.
  //    Kör bara om verbose är sant (annars hoppa).
  if (verbose) {
    // Läs itInventory (endast id+serial) i batchar och mät max visit per base
    type SRow = { baseKey: string; visit: number };
    const seenMax = new Map<string, number>();
    let invCursor: any = null;

    while (true) {
      const qInv = invCursor
        ? query(collection(db, "itInventory"), orderBy("__name__"), startAfter(invCursor), limit(pageSize))
        : query(collection(db, "itInventory"), orderBy("__name__"), limit(pageSize));
      const s = await getDocs(qInv);
      if (s.empty) break;

      for (const d of s.docs) {
        const data: any = d.data() || {};
        const parts = splitSerialParts(String(data.serial || ""));
        const baseKey = normalizeSerialKey(parts.base || "");
        if (!baseKey) continue;
        const v = Math.max(1, Number(parts.visit || 1));
        const prev = seenMax.get(baseKey) || 0;
        if (v > prev) seenMax.set(baseKey, v);
      }

      invCursor = s.docs[s.docs.length - 1];
      if (s.size < pageSize) break;
    }

    // Jämför mot indexets lastVisit
    for (const r of idxRows) {
      const measuredMax = seenMax.get(r.id) || 0;
      if (measuredMax > r.lastVisit) {
        issues.push({
          id: r.id,
          problem: `hole? lastVisit(${r.lastVisit}) < measuredMax(${measuredMax})`,
          visits: r.visits,
          active: r.active,
          lastVisit: r.lastVisit,
        });
      }
    }
  }

  if (issues.length === 0) {
    console.log("[scanSerialIndexForIssues] ✅ Inga problem hittades.");
  } else {
    console.table(issues);
    console.warn(`[scanSerialIndexForIssues] Totalt ${issues.length} potentiella problem.`);
  }

  return { scanned: idxRows.length, issues };
}

// Exponera i dev-konsolen
; (window as any).scanSerialIndexForIssues = async (verbose = false) => {
  return scanSerialIndexForIssues({ verbose: !!verbose });
};







const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

const PHOTO_LABELS: Record<PhotoKey, string> = {
  keyboard: "Keyboard",
  screen: "Screen",
  underside: "Underside",
  topside: "Topside",
};

const MAX_IMAGE_LONG_EDGE_PX = 1920;

const SHOW_DEV_REPORT = false; // slå på = true om du vill se rutan igen

// Visnings-format: ABC123*3 (oavsett hur det skrevs in)
const formatSerialForDisplay = (serial?: string | null): string => {
  if (!serial) return "—";
  const [base, suffix] = String(serial).split("*");
  const norm = normalizeSerialKey(base); // tar bort mellanslag/tecken + UPPERCASE
  return suffix ? `${norm}*${suffix}` : norm;
};

// Lägg i App.tsx (t.ex. bland dina andra helpers/funktionsanrop)
async function createInvoiceReportCF(itemIds: string[]) {
  const fns = getFunctions(undefined, "europe-west1");
  const fn = httpsCallable(fns, "createInvoiceReport");
  const res = await fn({ itemIds });
  // Typa svaret försiktigt
  const data = res?.data as
    | { ok: true; reportId: string; name: string; customer: string; count: number }
    | any;

  if (!data?.ok) {
    throw new Error(data?.message || "Kunde inte skapa fakturarapport.");
  }
  return data; // { ok, reportId, name, customer, count }
}

// Formaterar Date → "YYYY-MM-DD"
function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}




// Hjälpare: radera ALLA bilder under /photos

const toSlug = (s: string) =>
  String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._ -]+/g, " ")
    .replace(/[\s.]+/g, "-")
    .replace(/\-+/g, "-")
    .replace(/^\-+|\-+$/g, "");

function getImpactPreviewFromItems(list: any[]): PreparedImpactDisplay {
  const raws: RawImpactItem[] = list.map((it: any) => ({
    productType: it.productType,
    grade: it.grade,
    reuse: it.reuse,
    resold: it.resold,
    scrap: it.scrap,
  }));
  return prepareImpactDisplayFromRaw(raws);
}

// Importer högst upp om de inte redan finns:
// import { collection, query, where, getDocs, DocumentData, QuerySnapshot } from "firebase/firestore";
// import { prepareImpactDisplayFromRaw, type PreparedImpactDisplay, type ProductType } from "./lib/impact";

async function getImpactPreviewForFilters(
  filters: ReportFilters
): Promise<{ preview: PreparedImpactDisplay }> {
  const {
    fromDate,
    toDate,            // i din onRun har du redan gjort “+1 dag” exklusiv
    basis,             // "completedAt" | "createdAt"
    customerIds,       // string[]
    productTypes,      // ProductType[] | undefined
  } = filters;

  const col = collection(db, "itInventory");
  const dateField: "createdAt" | "completedAt" =
    String(basis) === "createdAt" ? "createdAt" : "completedAt";

  // helpers för Y-M-D strängar → Date (UTC)
  function parseYMD_UTC(s: string): Date {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0, 0));
  }
  function nextDayUTC(s: string): Date {
    const dt = parseYMD_UTC(s);
    dt.setUTCDate(dt.getUTCDate() + 1);
    return dt;
  }

  const dateWheres: any[] = [];
  if (fromDate && fromDate.trim()) {
    const fromTs = Timestamp.fromDate(parseYMD_UTC(fromDate));
    dateWheres.push(where(dateField, ">=", fromTs));
  }
  if (toDate && toDate.trim()) {
    // halvöppet intervall [from, to)
    const toExclusive = Timestamp.fromDate(nextDayUTC(toDate));
    dateWheres.push(where(dateField, "<", toExclusive));
  }


  // Helper: mappa doc -> “raw” rad med id för dedupe
  const mapDocToRaw = (d: any) => {
    const x = d.data() as any;
    return {
      id: d.id,                                                        // ✅ VIKTIGT
      productType: x.productTypeId ?? x.productType ?? "",
      grade: x.grade,
      reuse: !!x.reuse,
      resold: !!x.resold,
      scrap: !!x.scrap,
    };
  };

  let raws: any[] = [];

  if (productTypes && productTypes.length > 0) {
    // Firestore "in" tillåter max 10 värden → chunk:a vid behov
    const chunks: ProductType[][] = [];
    for (let i = 0; i < productTypes.length; i += 10) {
      chunks.push(productTypes.slice(i, i + 10));
    }

    const snaps: QuerySnapshot<DocumentData>[] = [];
    for (const chunk of chunks) {
      const ids = chunk.map((t: any) => typeof t === "string" ? t : t.id); // <— NYTT
      const qBase = query(col, ...dateWheres, where("productTypeId", "in", ids));
      snaps.push(await getDocs(qBase));
    }


    raws = snaps
      .flatMap(s => s.docs)
      .filter(d => {
        if (!customerIds || customerIds.length === 0) return true;
        const x = d.data() as any;
        const cid = String((x as any).customerId ?? (x as any).customer ?? "");
        return customerIds.includes(cid);
      })
      .map(mapDocToRaw);
  } else {
    // Ingen PT-filter: en basquery på datum; kund filtreras i minnet
    const qBase = query(col, ...dateWheres);
    const snap = await getDocs(qBase);
    raws = snap.docs
      .filter(d => {
        if (!customerIds || customerIds.length === 0) return true;
        const x = d.data() as any;
        const cid = String((x as any).customerId ?? (x as any).customer ?? "");
        return customerIds.includes(cid);
      })
      .map(mapDocToRaw);
  }

  // ➜ Dedupen sker inne i prepareImpactDisplayFromRaw tack vare id-fältet
  const preview = prepareImpactDisplayFromRaw(raws as any);
  return { preview };
}




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

// Normalisera datum/timestamps → epoch ms
function toEpochMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === "function") return v.toMillis(); // Firestore Timestamp
  if (typeof v.seconds === "number") { // ev. raw {seconds,nanoseconds}
    return v.seconds * 1000 + (v.nanoseconds ? Math.floor(v.nanoseconds / 1e6) : 0);
  }
  return 0;
}


function toSelectedIds(sel: any): string[] {
  if (!sel) return [];
  // Array av strängar eller objekt
  if (Array.isArray(sel)) {
    return sel
      .map((x) => (typeof x === "string" ? x : (x && x.id)))
      .filter(Boolean);
  }
  // Set<string>
  if (sel instanceof Set) {
    return Array.from(sel).filter((x): x is string => typeof x === "string");
  }
  // Record<string, boolean> eller liknande
  if (typeof sel === "object") {
    return Object.keys(sel).filter((k) => !!sel[k]);
  }
  return [];
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

  isCustomerAccount?: boolean;

  onUnmarkDelete?: () => Promise<void>;

  // 🆕 behövs för att uppdatera photos i formuläret från modalen
  setEditForm: React.Dispatch<React.SetStateAction<EditFormState>>;
  itemId: string | null; // <-- NY
}



// Lägg gärna DIRTY_KEYS utanför komponenten (eller överst i den), men inte efter att funktionen stängts
const DIRTY_KEYS: (keyof EditFormState)[] = [
  "manufacturer", "model", "serial", "orderNumber",
  "chargerIncluded", "damageNotes", "reuse", "resold", "scrap",
  "grade", "warrantyStartDate", "adapterYesNo"
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
  isCustomerAccount = false,
  onUnmarkDelete,
  setEditForm,
  itemId,                 // ✅ ingen default här
}: EditModalProps) {


  const [serialIndexMeta, setSerialIndexMeta] =
    React.useState<{ visits: number; active: number; lastVisit: number } | null>(null);


  // Validera innan "Markera som färdig"
  const handleCompleteValidated = async () => {
    // 1) Befintlig validering av val (grade/status/reuse/resold/scrap)
    const chk = impactValidateCompletionChoice({
      grade: editForm.grade,
      // stöd både status-sträng och dina tre booleans
      status: (editForm as any).status,
      reuse: editForm.reuse,
      resold: editForm.resold,
      scrap: editForm.scrap,
    });
    if (!chk.ok) {
      if ("error" in chk) alert(chk.error);
      return;
    }

    // 2) Datakvalitet (P0d): kräver giltig produkttyp
    const okPT = await assertValidProductTypeOrExplain(
      (editForm as any).productTypeId,
      (editForm as any).productType
    );
    if (!okPT) return;

    // 3) Kör originalets complete
    await onComplete();
  };



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
    "chargerIncluded", "damageNotes", "reuse", "resold", "scrap", "grade", "warrantyStartDate"
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

  // Rensa "old base"-källan när modalen stängs (så vi inte bär över mellan poster)
  React.useEffect(() => {
    if (!isOpen) {
      editOriginalRef.current = { serial: "", serialBaseKey: null, itemId: null };
    }
  }, [isOpen]);


  React.useEffect(() => {
    // Härled baseKey från fälten i formuläret
    const baseKey =
      (editForm as any)?.serialBaseKey
      ?? (editForm as any)?.serialBase
      ?? normalizeSerialKey(splitSerialParts(String(editForm?.serial || "")).base);

    if (!baseKey) { setSerialIndexMeta(null); return; }

    const ref = doc(db, "serialIndex", baseKey);
    const unsub = onSnapshot(ref, (snap) => {
      const x: any = snap.data() || {};
      setSerialIndexMeta({
        visits: Number(x?.visits ?? 0),
        active: Number(x?.active ?? 0),
        lastVisit: Number(x?.lastVisit ?? 0),
      });
    });

    return () => unsub();
  }, [
    editForm?.serial,
    (editForm as any)?.serialBaseKey,
    (editForm as any)?.serialBase,
  ]);



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












  // === SerialIndex: omallokera vid EDIT om serienumret ändrats (ERSÄTT HELA FUNKTIONEN) ===
  async function ensureSerialIndexReallocationIfChanged(): Promise<void> {
    if (!itemId) return; // kräver ett itemId i modalen

    try {
      // Old: från DB när Edit öppnades (sann källa)
      const origSerial: string = String(editOriginalRef.current?.serial ?? "").trim();
      const origBaseKey: string | null =
        editOriginalRef.current?.serialBaseKey
          ? String(editOriginalRef.current.serialBaseKey)
          : (origSerial
            ? normalizeSerialKey(splitSerialParts(origSerial).base)
            : null);

      // New: från formuläret just nu
      const nextSerial: string = String((editForm as any)?.serial ?? "").trim();
      const nextBaseKey: string | null =
        nextSerial ? normalizeSerialKey(splitSerialParts(nextSerial).base) : null;

      // 🔎 Byt till console.log så de alltid syns
      console.log("[serialIndex][EDIT] old", { origSerial, origBaseKey, itemIdFromRef: editOriginalRef.current?.itemId });
      console.log("[serialIndex][EDIT] new", { nextSerial, nextBaseKey });

      // Inget värde → inget att göra
      if (!nextSerial) return;

      // Kör EDIT-helpern som uppdaterar index (decrement på gamla, increment på nya)
      // (Helpern hanterar även fallet där basen inte ändras och returnerar changed=false)
      const alloc = await reallocateSerialOnEdit(itemId, origBaseKey, nextSerial);

      // 🔎 Debug: visa resultat från helpern
      console.debug("[serialIndex][EDIT] alloc result:", alloc);

      // 🔒 Spara undan senaste alloc-resultatet för saveEdit
      lastSerialAllocRef.current = alloc;

      // Patcha postens serial-fält beroende på om basnyckeln ändrats
      const itemRef = doc(db, "itInventory", itemId);

      if (alloc.changed) {
        // Basen byttes → patcha alla serial-fält
        await updateDoc(itemRef, {
          serial: alloc.displaySerial,
          serialBase: alloc.serialBaseKey,
          serialBaseKey: alloc.serialBaseKey,
          serialVisit: alloc.serialVisit,
          updatedAt: serverTimestamp(),
        });
      } else {
        // Basen är oförändrad → skriv bara om displayen om den faktiskt skiljer sig
        const currentInput = String((editForm as any)?.serial || "").trim();
        if (currentInput !== alloc.displaySerial) {
          await updateDoc(itemRef, {
            serial: alloc.displaySerial,
            updatedAt: serverTimestamp(),
          });
        }
        // annars no-op
      }
    } catch (err) {
      console.error("[ensureSerialIndexReallocationIfChanged] fel:", err);
      throw err;
    }
  }




  // === Spara-wrapper: kör alltid i rätt ordning (index → foton → fält) ===
  async function onSaveWithSerialIndex() {
    if (fieldsDisabled) return;

    try {
      await ensureSerialIndexReallocationIfChanged(); // 1) fixa index om serienumret ändrats
    } catch (e) {
      console.warn("[serialIndex] reallocation vid EDIT misslyckades:", e);
      // fortsätt ändå – övriga fält/foton ska få sparas
    }

    try {
      await commitStagedPhotos();                      // 2) ladda upp/radera foton
    } catch (e) {
      console.warn("[photos] commitStagedPhotos misslyckades:", e);
      // fortsätt ändå – fälten ska få sparas
    }

    await onSave();                                    // 3) spara övriga fält
  }





  // Exklusivt val för A–E (checkboxar som beter sig som radio)
  // Kopplar också E ⇄ Scraped så UI inte hamnar i ogiltigt läge.
  const setGrade = (letter: 'A' | 'B' | 'C' | 'D' | 'E', checked: boolean) => {
    if (fieldsDisabled) return;

    setEditForm(prev => {
      const next = { ...prev } as EditFormState;

      if (letter === 'E') {
        if (checked) {
          // Användaren väljer E → lås Scraped och nolla de andra statusarna
          next.grade = 'E';
          next.scrap = true;
          next.reuse = false;
          next.resold = false;
        } else {
          // Användaren avmarkerar E → lämna Scraped-läget och töm grade
          next.grade = '';
          next.scrap = false;
        }
        return next;
      }

      // A–D
      next.grade = checked ? letter : '';
      // Om vi råkar stå i Scraped-läget, lämna det (E får inte samsas med A–D)
      if (next.scrap) next.scrap = false;

      return next;
    });

    setIsDirty(true);
  };


  // ⬇️ ersätt din befintliga setCheckbox med denna
  const setCheckbox = (name: 'reuse' | 'resold' | 'scrap', val: boolean) => {
    if (fieldsDisabled) return;

    setEditForm(prev => {
      const next = { ...prev } as EditFormState;

      // Exklusivitet: nolla alla tre först
      next.reuse = false;
      next.resold = false;
      next.scrap = false;

      // Sätt vald
      (next as any)[name] = val;

      // Koppling status ⇄ Grade E
      if (next.scrap) {
        next.grade = 'E';         // Skrotad ⇒ lås E
      } else if (next.grade === 'E') {
        next.grade = '';          // Inte skrotad ⇒ E får inte vara vald
      }

      return next;
    });

    setIsDirty(true);
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





  // Hjälpare: normalisera kundlista
  function normalizeCustomers(input: any): { key: string; name: string }[] {
    if (!input) return [];
    // Arrayformer
    if (Array.isArray(input)) {
      return input.flatMap((c: any) => {
        if (!c) return [];
        if (typeof c === "string") return [{ key: c, name: c }];
        if (Array.isArray(c)) return [{ key: String(c[0]), name: String(c[1] ?? c[0]) }];
        if (typeof c === "object") {
          const key =
            c.id ?? c.key ?? c.customerId ?? c.uid ?? c.orgId ?? c.companyId ?? c._id;
          const name =
            c.name ?? c.label ?? c.displayName ?? c.companyName ?? c.orgName ?? key;
          return key ? [{ key: String(key), name: String(name) }] : [];
        }
        return [];
      });
    }
    // Map/objekt {id: name} eller {id: {...}}
    if (typeof input === "object") {
      return Object.entries(input).map(([k, v]: [string, any]) => ({
        key: String(k),
        name: String(
          (v as any)?.name ??
          (v as any)?.label ??
          (v as any)?.displayName ??
          (v as any) ??
          k
        ),
      }));
    }
    return [];
  }




  // === CO₂-rapport: state för preview (steg 2) ===
  const [reportPreview, setReportPreview] = useState<PreparedImpactDisplay | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  // === CO₂-rapport: val för kund och produkt-typ (steg 3) ===

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

          {/* 🟨 Banner: visa korrekt orsak till låsning */}
          {isCustomerAccount ? (
            <div className="gw-banner gw-banner--info" role="status" aria-live="polite">
              Läs-läge (kundkonto). Du kan se historik och bilder.
            </div>
          ) : invoiceReportId ? (
            <div className="gw-banner gw-banner--warn" role="status" aria-live="polite">
              <div style={{ marginBottom: 8 }}>
                <strong>Denna enhet är fakturerad.</strong> Fälten är låsta men du kan se historik och bilder.
              </div>
              <a
                href={`#/rapport/${encodeURIComponent(invoiceReportId)}`}
                target="_blank"
                rel="noreferrer"
                className="btn"
                title="Öppna fakturarapport"
              >
                Öppna fakturarapport →
              </a>
            </div>
          ) : isReadOnly ? (
            <div className="gw-banner gw-banner--warn" role="status" aria-live="polite">
              Posten är låst för redigering.
            </div>
          ) : null}



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
              <div className="gw-form-label">
                Serienummer
                {serialIndexMeta && (
                  <span
                    title={`Index: visits=${serialIndexMeta.visits}, active=${serialIndexMeta.active}, lastVisit=${serialIndexMeta.lastVisit}`}
                    style={{ marginLeft: 6, cursor: "help", opacity: 0.8 }}
                  >
                    ⓘ
                  </span>
                )}
              </div>
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
                    onChange={(e) => setCheckbox('reuse', (e.target as HTMLInputElement).checked)}
                    disabled={fieldsDisabled}
                  />
                  <span>Återbruk</span>
                </label>

                <label className="gw-check-inline">
                  <input
                    type="checkbox"
                    name="resold"
                    checked={!!editForm.resold}
                    onChange={(e) => setCheckbox('resold', (e.target as HTMLInputElement).checked)}
                    disabled={fieldsDisabled}
                  />
                  <span>Vidaresålt</span>
                </label>

                <label className="gw-check-inline">
                  <input
                    type="checkbox"
                    name="scrap"
                    checked={!!editForm.scrap}
                    onChange={(e) => setCheckbox('scrap', (e.target as HTMLInputElement).checked)}
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
                    disabled={fieldsDisabled || !!editForm.scrap}
                  />
                  <span>A</span>
                </label>
                <label className="gw-check-inline">
                  <input
                    type="checkbox"
                    checked={editForm.grade === 'B'}
                    onChange={(e) => setGrade('B', (e.target as HTMLInputElement).checked)}
                    disabled={fieldsDisabled || !!editForm.scrap}
                  />
                  <span>B</span>
                </label>
                <label className="gw-check-inline">
                  <input
                    type="checkbox"
                    checked={editForm.grade === 'C'}
                    onChange={(e) => setGrade('C', (e.target as HTMLInputElement).checked)}
                    disabled={fieldsDisabled || !!editForm.scrap}
                  />
                  <span>C</span>
                </label>
                <label className="gw-check-inline">
                  <input
                    type="checkbox"
                    checked={editForm.grade === 'D'}
                    onChange={(e) => setGrade('D', (e.target as HTMLInputElement).checked)}
                    disabled={fieldsDisabled || !!editForm.scrap}
                  />
                  <span>D</span>
                </label>
                <label className="gw-check-inline">
                  <input
                    type="checkbox"
                    checked={editForm.grade === 'E'}
                    onChange={(e) => setGrade('E', (e.target as HTMLInputElement).checked)}
                    disabled={fieldsDisabled || !editForm.scrap} // E bara tillåten när "Skrotad" är vald
                  />
                  <span>E</span>
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
                  onClick={handleCompleteValidated}
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
                  onClick={onSaveWithSerialIndex}
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





// === Shared store för original serial-info vid Edit (kan läsas/skrivas av App & EditModalBody) ===
type EditOriginalStore = {
  serial: string;
  serialBaseKey: string | null;
  itemId: string | null;
};

// OBS: inte React.useRef här (hooks får ej ligga utanför komponenter).
// Detta är en enkel, muterbar behållare som båda funktionerna kan dela.
const editOriginalRef: { current: EditOriginalStore } = {
  current: { serial: "", serialBaseKey: null, itemId: null }
};

// ✅ LÄGG IN DIREKT UNDER editOriginalRef (modulnivå, inte i en komponent)
type LastSerialAlloc = {
  changed: boolean;
  serialBaseKey: string;
  serialVisit: number;
  displaySerial: string;
};
const lastSerialAllocRef: { current: LastSerialAlloc | null } = { current: null };



/* =========================
   App
========================= */

// === [NYTT – TOP-LEVEL] Klient-anrop till Cloud Function: setUserClaims ===

type GwAccountRole = "admin" | "user" | "customer";
type GwAccountStatus = "pending" | "active" | "disabled";

type SetUserClaimsRequest = {
  uid: string;
  role: GwAccountRole;
  status: GwAccountStatus;
  customerKeys?: string[]; // krävs om role === "customer"
};

type SetUserClaimsResponse = {
  ok: true;
  applied: { role: GwAccountRole; status: GwAccountStatus; customerKeys: string[] };
  requiresReauth: true;
};

export async function gwSetUserClaims(req: SetUserClaimsRequest): Promise<SetUserClaimsResponse> {
  const fns = getFunctions(undefined, "europe-west1");
  const call = httpsCallable<SetUserClaimsRequest, SetUserClaimsResponse>(fns, "setUserClaims");
  const res = await call(req);
  return res.data;
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

  // --- Report preview state & loader (ingen UI ännu) ---
  const [reportPreview, setReportPreview] = React.useState<PreparedImpactDisplay | null>(null);
  const [reportItems, setReportItems] = React.useState<any[]>([]);
  const [reportItemIds, setReportItemIds] = React.useState<string[]>([]);
  const [reportLoading, setReportLoading] = React.useState(false);
  const [reportError, setReportError] = React.useState<string | null>(null);

  // Dev-filter för snabb test av preview (du kan byta default-datum)
  const [rpFrom, setRpFrom] = React.useState<string>(toYMD(new Date(Date.now() - 30 * 86400000)));
  const [rpCustomers, setRpCustomers] = React.useState<string>("");   // kommaseparerade customerIds
  const [rpTypes, setRpTypes] = React.useState<string>("");           // kommaseparerade productTypes

  async function handleLoadPreviewClick() {
    // Bygg filters av fältens innehåll
    const customerIds = rpCustomers.split(",").map(s => s.trim()).filter(Boolean);
    const productTypes = rpTypes.split(",").map(s => s.trim()).filter(Boolean);

    const filters: ReportFilters = {
      fromDate: toYMD(new Date()),
      toDate: toYMD(new Date()),
      basis: "completedAt",
      customerIds,                              // kräver minst ett id för att ge träffar
      productTypes: productTypes.length ? (productTypes as any) : undefined,
    };

    await loadReportPreview(filters);
  }

  /** Laddar förhandsvisning givet filters */
  async function loadReportPreview(filters: ReportFilters) {
    setReportLoading(true);
    setReportError(null);
    try {
      const { preview } = await getImpactPreviewForFilters(filters);
      setReportPreview(preview);
      // ❌ INTE längre:
      // setReportItems(items);
      // setReportItemIds(itemIds);
    } catch (e: any) {
      setReportPreview(null);
      setReportError(e?.message || "Kunde inte hämta rapportdata.");
      // ❌ INTE längre:
      // setReportItems([]);
      // setReportItemIds([]);
    } finally {
      setReportLoading(false);
    }
  }





  // Kundportal-claims i app-state
  const [isCustomerPortal, setIsCustomerPortal] = useState<boolean>(false);
  const [customerStatus, setCustomerStatus] = useState<"pending" | "active" | "disabled" | "none">("none");
  const [customerKeys, setCustomerKeys] = useState<string[]>([]);

  // Lyssna på token/claims och uppdatera state
  /* Effects — ersätt hela onIdTokenChanged-blocket */
  useEffect(() => {
    const unsub = onIdTokenChanged(auth, async (u) => {
      // stäng ev. lyssnare vid auth-skifte
      stopHomeSentinel?.();

      if (!u) {
        // nollställ både app-state och listor när ingen är inloggad
        setIsCustomerPortal(false);
        setCustomerStatus("none");
        setCustomerKeys([]);

        setItems([]);
        setManufacturerList([]);
        setCustomerList([]);
        return;
      }

      // --- LÄS CLAIMS → sätt app-state för kundläget ---
      const tok = await u.getIdTokenResult(true);
      const claims = tok.claims as any;
      const role = claims?.role as string | undefined;
      const status = claims?.status as ("pending" | "active" | "disabled") | undefined;
      const keysRaw = claims?.customerKeys as unknown;
      const keysArr = Array.isArray(keysRaw) ? (keysRaw as any[]).map(String) : [];

      setCustomerKeys(keysArr);
      setCustomerStatus(status ?? "none");
      setIsCustomerPortal(role === "customer" && status === "active");

      // Stödlistor (ok även om kund – de sväljer ev. permissions race)
      try {
        await Promise.all([
          fetchManufacturers().catch(() => { }),
          fetchCustomers().catch(() => { }),
        ]);
      } catch { }

      // Hem-listan:
      // admin/user → ladda direkt här
      // kund → vänta, vår andra hook (på isCustomerPortal/customerKeys) laddar filtrerat
      const isCustActive = role === "customer" && status === "active";
      if (activePageRef.current === "home" && !isCustActive) {
        await fetchFirstPage();
        startHomeSentinel?.();
      }
    });
    return () => unsub();
  }, []);



  // [NYTT] refresha Hem när kundläge/nycklar uppdateras (claims färdiga)
  useEffect(() => {
    if (!auth.currentUser) return;
    if (activePageRef.current !== "home") return;

    (async () => {
      await fetchFirstPage();   // kör om med korrekt kundfilter
      startHomeSentinel?.();    // starta om lyssnaren med samma filter
    })();
  }, [isCustomerPortal, JSON.stringify(customerKeys)]);

  // [UPPDATERAD] Tillåt kundkonton att vara på "home" ELLER "rapporter"
  useEffect(() => {
    if (!isCustomerPortal) return;

    // Om kunden hamnar på någon annan sida än home/rapporter → flytta tillbaka
    if (activePageRef.current !== "home" && activePageRef.current !== "rapporter") {
      setActivePage("home");           // ev. byt till "rapporter" om du vill landa där
      activePageRef.current = "home";
      // (ingen fetch här – home-effekten ovan sköter refresh när isCustomerPortal/customerKeys ändras)
    }
  }, [isCustomerPortal]);





  // === Menykomponenter (homogent utseende) ===
  type PageKey = "home" | "users" | "fakturering" | "rapporter" | "productTypesAdmin";
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
    { key: "rapporter", label: "Rapporter" },
    { key: "productTypesAdmin", label: "Produkttyper (Admin)", visible: () => user?.role === "admin" },
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

  // UI-gating inför "Markera som färdig":
  // Kollar att vald produkttyp finns, är aktiv och har giltiga faktorer (> 0).
  // Använd: if (!(await assertValidProductTypeOrExplain(item.productTypeId, item.productType))) return;
  async function assertValidProductTypeOrExplain(
    productTypeId?: string | null,
    productTypeLabel?: string | null
  ): Promise<boolean> {
    try {
      // 1) Måste finnas ett id
      if (!productTypeId || !String(productTypeId).trim()) {
        alert(
          `Produkttyp saknar ID.\n` +
          `Gå till Rapporter → Produkttyper och säkerställ att typen har slug (productTypeId) ` +
          `samt faktorvärden.`
        );
        return false;
      }

      // 2) Hämta typen
      const ref = doc(db, "productTypes", String(productTypeId));
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        alert(
          `Produkttypen (${productTypeLabel || productTypeId}) finns inte i 'productTypes'.\n` +
          `Skapa den i Rapporter → Produkttyper och ange vikt/CO₂.`
        );
        return false;
      }

      const data = snap.data() as any;
      const active = data?.active !== false; // default true
      const weight = Number(data?.medianWeightKg ?? 0);
      const co2 = Number(data?.co2PerUnitKg ?? 0);

      // 3) Regler: aktiv + båda faktorerna > 0
      if (!active || weight <= 0 || co2 <= 0) {
        alert(
          `Produkttypen '${data?.label ?? productTypeLabel ?? productTypeId}' är ` +
          `${!active ? "inaktiv" : ""}${!active && (weight <= 0 || co2 <= 0) ? " och " : ""}` +
          `${(weight <= 0 || co2 <= 0) ? "saknar giltiga faktorvärden (vikt/CO₂ > 0)" : ""}.\n\n` +
          `Åtgärd: Öppna Rapporter → Produkttyper, aktivera typen och sätt vikt/CO₂, ` +
          `eller välj en annan typ.`
        );
        return false;
      }

      return true;
    } catch (e) {
      console.error("assertValidProductTypeOrExplain failed:", e);
      alert("Kunde inte kontrollera produkttypens faktorer. Försök igen.");
      return false;
    }
  }





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
  const activePageRef = useRef<PageKey>("home");


  const pageLastDocRef = React.useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  useEffect(() => { pageLastDocRef.current = pageLastDoc; }, [pageLastDoc]);

  const PAGE_SIZE = 25;


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

  // [NYTT] En enhetlig “refresh” efter mutationer
  async function refreshHomeList() {
    await fetchFirstPage();    // använder ditt kundfilter + stale-guard
  }


  // [ERSÄTT HELA dina fetchFirstPage/fetchNextPage med detta]

  // Hjälpare för kundfilter (inline i båda funktionerna)
  function applyCustomerFilter(base: any) {
    if (!isCustomerPortal) return base;

    const keys = Array.isArray(customerKeys) ? customerKeys.filter(Boolean) : [];

    // Ger tomt resultat om kund saknar kopplingar
    if (keys.length === 0) {
      return query(base, where("customerId", "==", "__no_customer__"));
    }

    if (keys.length === 1) {
      return query(base, where("customerId", "==", keys[0]));
    }

    const top10 = keys.slice(0, 10);
    if (keys.length > 10) {
      console.warn("customerKeys > 10; visar de första 10 tills vidare.");
    }
    return query(base, where("customerId", "in", top10));
  }



  // [NYTT – lägg INNE i function App(...)]
  const querySigRef = React.useRef<string>("");

  function computeQuerySignature(): string {
    if (isCustomerPortal) {
      const keys = Array.isArray(customerKeys) ? [...customerKeys].filter(Boolean).sort() : [];
      return `cust:${keys.join("|")}`;
    }
    return "staff";
  }

  // ====== Uppdatera dina fetch-funktioner ======

  async function fetchFirstPage() {
    if (!auth.currentUser) {
      stopHomeSentinel?.();
      setItems([]);
      setPageLastDoc(null);
      setPageHasNext(false);
      setPageIndex(1);
      setHasNewTopItems(false);
      setPageLastRefreshAt(Date.now());
      return;
    }

    setPageIsLoading(true);

    // [NYTT] fånga signaturen för denna körning och märk den som "senaste"
    const sig = computeQuerySignature();
    querySigRef.current = sig;

    try {
      let q = query(collection(db, "itInventory"));
      q = applyCustomerFilter(q);
      q = query(q, orderBy("updatedAt", "desc"), orderBy("createdAt", "desc"), limit(PAGE_SIZE));

      const snap = await getDocs(q);

      // [NYTT] om en nyare query startat sedan vi började → ignorera detta resultat
      if (querySigRef.current !== sig) return;

      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Item[];
      setItems(rows);
      setPageLastDoc(snap.docs.length ? snap.docs[snap.docs.length - 1] : null);
      setPageHasNext(snap.docs.length === PAGE_SIZE);
      setPageIndex(1);
      setHasNewTopItems(false);
      setPageLastRefreshAt(Date.now());
    } catch (e) {
      console.error(e);
    } finally {
      // [OBS] vi vill alltid släcka laddning även om resultat ignorerades
      setPageIsLoading(false);
    }
  }

  // 🆕 Exponera refresh-funktion globalt för Rapporter-vyn
  useEffect(() => {
    (window as any).gwFetchFirstPage = fetchFirstPage;
    return () => {
      if ((window as any).gwFetchFirstPage === fetchFirstPage) {
        delete (window as any).gwFetchFirstPage;
      }
    };
  }, [fetchFirstPage]);

  async function fetchNextPage() {
    // Kör inte utan inloggad användare
    if (!auth.currentUser) return;
    if (!pageLastDoc) return;

    setPageIsLoading(true);

    // [NYTT] signatur för denna körning
    const sig = computeQuerySignature();

    try {
      let q = query(collection(db, "itInventory"));
      q = applyCustomerFilter(q);
      q = query(
        q,
        orderBy("updatedAt", "desc"),
        orderBy("createdAt", "desc"),
        startAfter(pageLastDoc),
        limit(PAGE_SIZE),
      );

      const snap = await getDocs(q);

      // [NYTT] ignorera om en nyare query har startat
      if (querySigRef.current !== sig) return;

      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Item[];
      setItems(prev => [...prev, ...rows]);
      setPageLastDoc(snap.docs.length ? snap.docs[snap.docs.length - 1] : null);
      setPageHasNext(snap.docs.length === PAGE_SIZE);
      setPageIndex(p => p + 1);
    } catch (e) {
      console.error(e);
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
    // Om ingen är inloggad – starta inte lyssnaren
    if (!auth.currentUser) {
      stopHomeSentinel();
      return;
    }

    stopHomeSentinel();

    // Basquery
    let q: any = query(collection(db, "itInventory"));

    // Kundfilter i kundläge
    if (isCustomerPortal) {
      const keys = Array.isArray(customerKeys) ? customerKeys.filter(Boolean) : [];
      if (keys.length === 0) {
        q = query(q, where("customer", "==", "__no_customer__"));
      } else if (keys.length === 1) {
        q = query(q, where("customer", "==", keys[0]));
      } else {
        const top10 = keys.slice(0, 10);
        if (keys.length > 10) console.warn("customerKeys > 10; lyssnar på första 10.");
        q = query(q, where("customer", "in", top10));
      }
    }

    // Lyssna på senaste post (för auto-refresh/banner)
    q = query(q, orderBy("updatedAt", "desc"), limit(1));

    let first = true;
    homeSentinelUnsub.current = onSnapshot(
      q,
      (snap: QuerySnapshot<DocumentData>) => {
        if (first) { first = false; return; }

        const topDoc = snap.docs[0];
        if (!topDoc) return;

        const d = topDoc.data() as any;

        // Ignorera wizard-utkast och mitt eget pågående utkast
        if (d?.isDraft === true) return;
        if (draftItemId && topDoc.id === draftItemId) return;

        // Throttling
        const now = Date.now();
        if (now - lastRefreshAtRef.current < 1500) return;

        // Bara om vi står på Hem
        if (activePageRef.current !== "home") return;

        // Är vi på första sidan? → auto-refresh direkt. Annars visa banner.
        if (pageIndex <= 1) {
          lastRefreshAtRef.current = now;
          fetchFirstPage();
        } else {
          setHasNewTopItems(true);
        }
      },
      (err: FirestoreError) => {
        // Vanligaste vid logout: permission-denied. Stäng lyssnaren tyst.
        if (err?.code === "permission-denied") {
          stopHomeSentinel();
          return;
        }
        console.warn("Home sentinel snapshot error:", err);
      }
    );
  }









  // Sidor/meny
  const [activePage, setActivePage] = useState<PageKey>("home");
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [creatingReport, setCreatingReport] = useState(false);

  useEffect(() => {
    if (isCustomer(user) && activePage === "fakturering") {
      setActivePage("home");
      activePageRef.current = "home";
    }
  }, [user?.role, activePage]);

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
  const TOTAL_STEPS = 11;

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
    productType: "",
    warrantyStartDate: "",
    serial: "",
    chargerIncluded: false,
    adapterYesNo: "",
    damageNotes: "",
    customer: "",
    customerKey: "",
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

  // --- Fakturering: UI-state ---
  const [billingCustomerFilter, setBillingCustomerFilter] = useState<string>(""); // "" = alla
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  // --- Kundoptions (ID + namn) måste deklareras före användning i billingFilteredItems ---
  const [customerListOpts, setCustomerListOpts] = useState<Array<{ key: string; name: string }>>([]);

  // Säkerställ att app-state alltid håller IDs i customerKeys (inte namn)
  useEffect(() => {
    if (!isCustomerPortal) return;
    if (!Array.isArray(customerKeys) || customerKeys.length === 0) return;
    if (!Array.isArray(customerListOpts) || customerListOpts.length === 0) return;

    const byName = new Map(customerListOpts.map(o => [o.name.toLowerCase(), o.key]));
    const idSet = new Set(customerListOpts.map(o => o.key));

    const normalized = customerKeys.map((k) => {
      const kk = String(k).trim();
      if (idSet.has(kk)) return kk;                 // redan ID
      const asId = byName.get(kk.toLowerCase());    // namn → id
      return asId ?? kk;                             // fallback
    });

    const changed =
      normalized.length !== customerKeys.length ||
      normalized.some((v, i) => v !== customerKeys[i]);

    if (changed) setCustomerKeys(normalized);
  }, [isCustomerPortal, customerKeys, customerListOpts]);

  // Ladda ID-baserade kundalternativ när Users-sidan öppnas (eller om listan är tom)
  useEffect(() => {
    if (activePage !== "users") return;
    // Om vi redan har laddat, gör inget
    if (Array.isArray(customerListOpts) && customerListOpts.length > 0) return;

    (async () => {
      try {
        await fetchCustomers(); // din uppdaterade fetchCustomers fyller customerListOpts
      } catch (e) {
        console.warn("Kunde inte ladda customers för Users-sidan:", e);
      }
    })();
  }, [activePage, customerListOpts]);




  // --- Fakturering: härleda listor ---
  const billingBaseItems = useMemo(
    () => items.filter(it => !!it.completed && !it.invoiceReportId),
    [items]
  );

  // Fakturering: filtrera på customerId, med fallback namn→id om item saknar customerId
  const billingFilteredItems = useMemo(() => {
    // snabb uppslagning: name(lower) → id
    const nameToId = new Map(customerListOpts.map(o => [o.name.toLowerCase(), o.key]));

    return billingBaseItems.filter((it) => {
      if (billingCustomerFilter) {
        const id = String((it as any).customerId || "");
        let effectiveId = id;

        // Fallback: om id saknas, försök slå upp via visningsnamn
        if (!effectiveId) {
          const nm = String((it as any).customer || "").trim().toLowerCase();
          effectiveId = nameToId.get(nm) || "";
        }

        if (effectiveId !== String(billingCustomerFilter)) return false;
      }

      return true;
    });
  }, [billingBaseItems, billingCustomerFilter, customerListOpts]);


  const allFilteredMarked = useMemo(
    () => billingFilteredItems.length > 0 && billingFilteredItems.every(it => !!it.markedForInvoice),
    [billingFilteredItems]
  );

  // “markera alla / avmarkera alla” på den filtrerade listan
  async function toggleMarkAllInFiltered(checked: boolean) {
    setIsMarkingAll(true);
    try {
      // Optimistisk UI först
      setItems(prev =>
        prev.map(x => billingFilteredItems.some(t => t.id === x.id) ? { ...x, markedForInvoice: checked } : x)
      );

      // Skriv per item (samma guardar som enkel-toggle använder)
      for (const it of billingFilteredItems) {
        try { await setMarkedForInvoice(it.id, checked); }
        catch { /* vid fel lämnar vi bara kvar optimistiken eller justerar manuellt vid behov */ }
      }
    } finally {
      setIsMarkingAll(false);
    }
  }

  // Nollställ faktureringsfiltret om valt värde inte finns bland kund-IDs
  useEffect(() => {
    if (!billingCustomerFilter) return;
    const exists = customerListOpts.some(o => o.key === billingCustomerFilter);
    if (!exists) {
      setBillingCustomerFilter(""); // fallback till "Alla kunder"
    }
  }, [billingCustomerFilter, customerListOpts]);



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

  const [customerList, setCustomerList] = useState<string[]>([]);
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

  // Ladda artiklar när vald kund (ID) ändras
  useEffect(() => {
    if (form.customerKey) {
      fetchArticlesFor(form.customerKey); // ✅ ID-baserat
    } else {
      setArticleList([]);
    }
  }, [form.customerKey]);


  /* Fetchers */

  // ERSÄTT hela fetchManufacturers med denna
  const fetchManufacturers = async (): Promise<void> => {
    // Kör inte utan inloggad användare
    if (!auth.currentUser) return;

    try {
      const qs = await getDocs(query(collection(db, "manufacturers")));
      const names = qs.docs
        .map((d) => (d.data() as any).name as string)
        .filter(Boolean);

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
      const code = e?.code || e?.name;
      if (code === "permission-denied" || code === "unauthenticated") {
        // tyst vid ut-/inloggningsrace
        return;
      }
      console.error("Kunde inte hämta tillverkare:", e?.message || e);
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



  // Hämta kunder: behåll befintlig namnlista (string[]) OCH bygg id-baserade options för Users-admin
  const fetchCustomers = async (): Promise<void> => {
    if (!auth.currentUser) return;

    try {
      const qs = await getDocs(query(collection(db, "customers"), orderBy("name")));

      // 1) ID-baserade options för Användare-flödet (detta ska vi använda där)
      const opts = qs.docs.map(d => {
        const data = d.data() as any;
        return {
          key: d.id,                               // ✅ customers/{doc.id}
          name: String(data?.name ?? d.id).trim(), // visningsnamn
        };
      });
      setCustomerListOpts(opts);

      // 2) Behåll din nuvarande namnlista (för bef. konsumenter)
      const names = opts.map(o => o.name).filter(Boolean);
      const seen = new Set<string>();
      const unique: string[] = [];
      for (const n of [...customerList, ...names]) {
        const k = toKey(n);
        if (!seen.has(k)) { seen.add(k); unique.push(n); }
      }
      setCustomerList(unique.sort((a, b) => a.localeCompare(b, "sv", { sensitivity: "base" })));
    } catch (e: any) {
      const code = e?.code || e?.name;
      if (code === "permission-denied" || code === "unauthenticated") return; // tyst vid auth-race
      console.error("Kunde inte hämta kunder:", e?.message || e);
      // fail-safe
      setCustomerListOpts([]);
    }
  };


  // Hämta artiklar för vald kund (ID först, fallback på namn) — utan Samhall-defaults
  const fetchArticlesFor = async (customerKeyOrName: string): Promise<void> => {
    const k = String(customerKeyOrName || "").trim();
    if (!k) { setArticleList([]); return; }

    // Om k är ett ID: hämta ev. visningsnamn (används bara för namn-fallbacken)
    const match = Array.isArray(customerListOpts) ? customerListOpts.find(o => o.key === k) : undefined;
    const displayName = match?.name || k;

    try {
      // 1) Försök via customerId
      const byIdSnap = await getDocs(query(collection(db, "articles"), where("customerId", "==", k)));
      let names = byIdSnap.docs.map(d => String((d.data() as any).name || "")).filter(Boolean);

      // 2) Fallback via visningsnamn (för äldre artiklar utan customerId)
      if (names.length === 0) {
        const byNameSnap = await getDocs(query(collection(db, "articles"), where("customer", "==", displayName)));
        names = byNameSnap.docs.map(d => String((d.data() as any).name || "")).filter(Boolean);
      }

      // 3) Unika + sorterade
      const uniq = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, "sv", { sensitivity: "base" }));
      setArticleList(uniq);
    } catch (e: any) {
      console.error("Kunde inte hämta artiklar:", e?.message || e);
      setArticleList([]);
    }
  };



  // Lägg till ny artikel (per kund) – varna om den finns hos annan kund
  // Lägg till ny artikel (per kund) – varna om den finns hos annan kund (ID-baserad)
  const handleNewArticleAdd = async (): Promise<void> => {
    const trimmed = newArticle.trim();
    if (!trimmed || !form.customerKey) return; // ✅ kräver vald kund-ID
    const key = toKey(trimmed);

    if (articleList.some(a => toKey(a) === key)) {
      alert("Modell/artikel finns redan för kunden.");
      setForm(p => ({ ...p, articleNumber: articleList.find(a => toKey(a) === key)! }));
      setNewArticle("");
      setShowNewArticleInput(false);
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
          setNewArticle("");
          setShowNewArticleInput(false);
          await fetchArticlesFor(form.customerKey); // ✅ använd ID
          return;
        }
      }

      // ✅ Lägg till ny artikel med både namn och customerId
      await addDoc(collection(db, "articles"), {
        name: trimmed,
        customer: form.customer || "",       // visningsnamn
        customerId: form.customerKey || "",  // stabilt ID
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || null,
      });

      await fetchArticlesFor(form.customerKey); // ✅ använd ID
      setForm(p => ({ ...p, articleNumber: trimmed }));
      setNewArticle("");
      setShowNewArticleInput(false);
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

  // Lägg till ny kund (dublettskydd) — uppdaterad: uppdaterar alla listor + förväljer direkt
  const handleNewCustomerAdd = async (): Promise<void> => {
    const trimmed = (newCustomer || "").trim();
    if (!trimmed) return;

    const slug = toKey(trimmed);

    // 1) Finns redan i ID-baserade options?
    const fromOpts = Array.isArray(customerListOpts)
      ? customerListOpts.find(o => toKey(o.name) === slug)
      : undefined;
    if (fromOpts) {
      setForm(p => ({ ...p, customer: fromOpts.name, customerKey: fromOpts.key }));
      setNewCustomer("");
      setShowNewCustomerInput(false);
      return;
    }

    // 2) Finns i ev. rpCustomerOpts (om den listan används på fler ställen)?
    const fromRp = Array.isArray(rpCustomerOpts)
      ? rpCustomerOpts.find(o => toKey(o.name) === slug)
      : undefined;
    if (fromRp) {
      setForm(p => ({ ...p, customer: fromRp.name, customerKey: fromRp.key }));
      setNewCustomer("");
      setShowNewCustomerInput(false);
      return;
    }

    // 3) Finns namnet redan i gamla namnlistan?
    if (customerList.some(n => toKey(n) === slug)) {
      // Försök hitta ID efter en snabb refresh (om fetchCustomers finns)
      try { await fetchCustomers?.(); } catch { }
      const after = Array.isArray(customerListOpts)
        ? customerListOpts.find(o => toKey(o.name) === slug)
        : undefined;
      setForm(p => ({ ...p, customer: trimmed, customerKey: after?.key ?? (p as any).customerKey ?? "" }));
      setNewCustomer("");
      setShowNewCustomerInput(false);
      return;
    }

    // 4) Sista koll mot backend (någon annan kan ha skapat nyss)
    try {
      const qs = await getDocs(query(collection(db, "customers")));
      const remoteHit = qs.docs
        .map(d => ({ id: d.id, name: String((d.data() as any)?.name || "") }))
        .find(r => toKey(r.name) === slug);

      if (remoteHit) {
        // Uppdatera lokala listor så den syns direkt
        setCustomerListOpts(prev => {
          const next = [...prev, { key: remoteHit.id, name: remoteHit.name }];
          next.sort((a, b) => a.name.localeCompare(b.name, "sv", { sensitivity: "base" }));
          return Array.from(new Map(next.map(x => [x.key, x])).values());
        });
        setRpCustomerOpts?.(prev => (Array.isArray(prev) ? [...prev, { key: remoteHit.id, name: remoteHit.name }] : [{ key: remoteHit.id, name: remoteHit.name }]));
        setCustomerList(prev => {
          const next = Array.from(new Set([...prev, remoteHit.name]));
          next.sort((a, b) => a.localeCompare(b, "sv", { sensitivity: "base" }));
          return next;
        });

        setForm(p => ({ ...p, customer: remoteHit.name, customerKey: remoteHit.id }));
        setNewCustomer(""); setShowNewCustomerInput(false);
        return;
      }
    } catch { /* tyst – vi försöker skapa i nästa steg */ }

    // 5) Skapa ny kund
    try {
      const ref = await addDoc(collection(db, "customers"), {
        name: trimmed,
        // createdAt/By valfritt – ta med om du redan använder dem:
        // createdAt: serverTimestamp(),
        // createdBy: auth.currentUser?.uid || null,
      });
      const id = ref.id;

      // Uppdatera ID-baserade options + ev. rp-opts + gamla namnlistan
      setCustomerListOpts(prev => {
        const next = [...prev, { key: id, name: trimmed }];
        next.sort((a, b) => a.name.localeCompare(b.name, "sv", { sensitivity: "base" }));
        return Array.from(new Map(next.map(x => [x.key, x])).values());
      });
      setRpCustomerOpts?.(prev => (Array.isArray(prev) ? [...prev, { key: id, name: trimmed }] : [{ key: id, name: trimmed }]));
      setCustomerList(prev => {
        const next = Array.from(new Set([...prev, trimmed]));
        next.sort((a, b) => a.localeCompare(b, "sv", { sensitivity: "base" }));
        return next;
      });

      // Förvälj i formuläret direkt
      setForm(p => ({ ...p, customer: trimmed, customerKey: id }));
      setNewCustomer("");
      setShowNewCustomerInput(false);
    } catch (e) {
      console.error("Fel vid tillägg av kund:", e);
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

    // Bas & nyckel för index — ignorera ev. manuellt *N i input
    const _parts = splitSerialParts(String(form.serial || ""));
    const baseSerial = _parts.base;            // t.ex. "ABC123" (utan *N)
    const baseKey = normalizeSerialKey(baseSerial);

    // Defensiv guard: om nyckeln inte kan normaliseras, avbryt på ett säkert sätt
    if (!baseKey) {
      console.warn("[saveData] Serienummer saknas eller kunde inte normaliseras – avbryter commit.");
      // Visa mjuk feedback i UI om du vill:
      try { (window as any).toast?.("Ange ett giltigt serienummer.", { type: "warning" }); } catch { }
      return; // no-op
    }


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
        const parts = splitSerialParts(String(form.serial || ""));
        const rawBase = parts.base; // ignorera ev. manuellt *N i input
        const final = buildDisplaySerial(normalizeSerial(rawBase), nextVisit); // t.ex. ABC123*2

        // ——— SÄKERSTÄLL PRODUKTTYP (slugga lokalt, lita inte på returvärde) ———
        const rawType = String(form.productType || "").trim();

        // Minimal slugifier (ingen import krävs)
        const toSlug = (s: string) =>
          s
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9._ -]+/g, " ")
            .replace(/[\s.]+/g, "-")
            .replace(/\-+/g, "-")
            .replace(/^\-+|\-+$/g, "");

        const productTypeLabel: string = rawType;                // t.ex. "Desktop"
        const productTypeId: string = rawType ? toSlug(rawType) : ""; // t.ex. "desktop"

        // Se till att typen finns i DB (skapa/uppdatera), returvärdet används inte
        if (productTypeId) {
          try {
            await ensureProductTypeInDb(productTypeLabel);
          } catch (e) {
            console.warn("ensureProductTypeInDb failed:", e);
          }
        }


        // Hämta stabilt kund-ID (key) från form eller från rpCustomerOpts (fallback via namn)
        const cid: string =
          (form as any).customerKey ??
          (
            Array.isArray(rpCustomerOpts)
              ? rpCustomerOpts.find((c: { key: string; name: string }) => String(c.name) === String(form.customer))?.key
              : ""
          ) ??
          "";

        // ——— Sätt själva itemet, utan photos (vi patchar in senare efter upload) ———
        tx.set(newItemRef, {
          orderNumber: form.orderNumber || "",
          manufacturer: form.manufacturer,
          model: form.model,

          // 🆕 Viktigt: skriv båda fälten (INGEN extra productType-rad någon annanstans i objektet)
          productTypeId: toSlug(form.productType || ""),   // slug (id, lowercase)
          productType: form.productType || "",             // label

          warrantyStartDate: form.warrantyStartDate || null,

          isDraft: false,
          wizardStep: null,

          // 👇 viktiga fält
          serial: final,
          serialBase: baseSerial,
          serialBaseKey: baseKey,
          serialVisit: nextVisit,

          adapterYesNo: form.adapterYesNo || (form.chargerIncluded ? "Yes" : "No"),
          chargerIncluded: form.chargerIncluded,
          damageNotes: form.damageNotes,
          photos: {},

          createdAt: serverTimestamp(),
          createdBy: currentUserString(),
          lockedBy: null,
          lockedAt: null,
          deletePending: false,
          deleteMarkedBy: null,
          deleteMarkedAt: null,

          customer: form.customer,
          // ⬇️ Viktigt: använd den *riktiga* kundnyckeln/ID:t (inte slug av namn)
          customerId: form.customerKey || cid || "",

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


        // Uppdatera/Skapa indexet — ny policy (lastVisit/visits/active/lastSeen)
        tx.set(
          indexRef,
          {
            lastVisit: nextVisit,            // senast tilldelade visit
            visits: nextVisit,               // totalt = lastVisit
            active: nextActive,              // antal icke-raderade
            lastItemId: newItemRef.id,       // spårbarhet
            lastSeen: serverTimestamp(),     // “ping” (indexets egen tidsstämpel)
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
        productType: "",
        warrantyStartDate: "",
        serial: "",
        chargerIncluded: false,
        adapterYesNo: "",
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
      await refreshHomeList();
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
            if (idxSnap.exists()) {
              const curIdx = idxSnap.data() as any;
              const nextActive = Math.max(0, Number(curIdx.active ?? 0) - 1);
              tx.update(idxRef, {
                active: nextActive,
                lastSeen: serverTimestamp(),
                lastItemId: itemRef.id,
              });
            }
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
    await refreshHomeList();

  };






  // === openEdit (ersätt hela funktionen) ===
  const openEdit = async (item: Item): Promise<void> => {
    try {
      const ref = doc(db, "itInventory", item.id);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        alert("Kunde inte öppna – posten finns inte längre.");
        return;
      }
      const data = snap.data() as any;


      // Minneslagra original serial + baseKey från DB för säker jämförelse vid EDIT
      try {
        const originalSerial: string = String(data?.serial ?? "");
        const derivedBaseKey =
          data?.serialBaseKey
            ? String(data.serialBaseKey)
            : (data?.serialBase ? String(data.serialBase) : (
              originalSerial
                ? normalizeSerialKey(splitSerialParts(originalSerial).base)
                : null
            ));

        // Starta rent inför denna edit-session
        lastSerialAllocRef.current = null;

        editOriginalRef.current = {
          serial: originalSerial,
          serialBaseKey: derivedBaseKey || null,
          itemId: item.id ?? null,
        };
      } catch (e) {
        console.error("[editOriginalRef] init misslyckades:", e);
        editOriginalRef.current = { serial: "", serialBaseKey: null, itemId: item.id ?? null };
      }





      // Baseline UI-state
      setEditIsReadOnly(false);
      setEditInvoiceReportId(null);

      // Läs-läge & fakturerad
      const isInvoiced = !!data.invoiceReportId;
      const readOnly = isCustomerPortal || isInvoiced;

      setEditIsReadOnly(readOnly);
      if (isInvoiced) setEditInvoiceReportId(String(data.invoiceReportId));

      // Spärr: markerad för fakturering (personal)
      if (!isCustomerPortal && data.markedForInvoice === true && !isInvoiced) {
        alert("Detta objekt är markerat för fakturering och är tillfälligt spärrat för editering. Avmarkera i Fakturering för att öppna igen.");
        return;
      }

      // Lås om vi får redigera
      if (!readOnly && !data.completed) {
        try {
          await runTransaction(db, async (tx) => {
            const fresh = await tx.get(ref);
            if (!fresh.exists()) throw new Error("Posten finns inte längre.");
            const cur = fresh.data() as any;

            if (cur.invoiceReportId) throw new Error("Enheten är fakturerad och permalåst.");

            const heldByOther = !!cur.lockedBy && cur.lockedBy !== currentUserString();
            const lockedAtMs = toMillis(cur.lockedAt);
            const isStale = lockedAtMs === null ? true : (Date.now() - lockedAtMs) > LOCK_STALE_MS;
            if (heldByOther && !isStale) throw new Error(`Posten redigeras av ${cur.lockedBy}.`);

            tx.update(ref, { lockedBy: currentUserString(), lockedAt: serverTimestamp() } as any);
          });
          startLockHeartbeat(item.id);
        } catch (e: any) {
          alert(e?.message ?? "Kunde inte låsa posten för redigering.");
          return;
        }
      }
      if (!readOnly) startLockWatcher(item.id);

      // Fyll formuläret
      setEditId(item.id);
      setEditForm({
        orderNumber: data.orderNumber || "",
        manufacturer: data.manufacturer || "",
        model: data.model || "",
        serial: data.serial || "",
        chargerIncluded: !!data.chargerIncluded,
        adapterYesNo: (data as any).adapterYesNo ?? (data.chargerIncluded ? "Yes" : "No"),
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
        grade: data.grade || "",
        productType: data.productType || "",
        productTypeId: data.productTypeId || (data.productType ? toSlug(data.productType) : ""),
      });
      setIsEditOpen(true);
    } catch (e: any) {
      console.error(e);
    }
  };

  // === handleEditChange (ersätt) ===
  const handleEditChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ): void => {
    const t = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const { name, type, value } = t;
    const v = type === "checkbox" ? (t as HTMLInputElement).checked : value;

    if (name === "productType") {
      const label = String(v || "");
      setEditForm(prev => ({
        ...prev,
        productType: label,
        productTypeId: label ? toSlug(label) : "",
      }));
    } else {
      setEditForm(prev => ({ ...prev, [name]: v }));
    }
  };

  // === saveEdit (ersätt hela funktionen) ===
  const saveEdit = async (): Promise<void> => {
    // Spärrar
    if (editForm.deletePending) { alert("Denna enhet är markerad för radering och kan inte editeras."); return; }
    if (!editId) return;
    if (editIsReadOnly) { alert("Denna enhet är fakturerad och kan inte editeras."); return; }
    if (editForm.completed) { alert("Denna enhet är markerad som färdig och kan inte editeras."); return; }

    const selectedCount =
      Number(!!editForm.reuse) + Number(!!editForm.resold) + Number(!!editForm.scrap);
    if (selectedCount > 1) { alert("Du kan inte spara med mer än ett alternativ markerat."); return; }

    // Spärr för markerad för fakturering
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
          if (heldByOther && !isStale) throw new Error(`Posten redigeras av ${cur.lockedBy}.`);
        }

        // Steg för fakturering (oförändrat)
        const steps = computeBillingSteps({
          reuse: !!editForm.reuse,
          resold: !!editForm.resold,
          scrap: !!editForm.scrap,
        });

        // --- Serial-hantering (ENKEL: saveEdit rör inte serialIndex; bara display inom samma bas) ---
        // 1) Hämta gammal bas/visit från DB-datan (cur)
        const { base: oldBase, visit: oldVisit } = splitSerialParts(String(cur.serial || ""));
        const oldKey: string =
          (cur.serialBaseKey && String(cur.serialBaseKey).trim()) ||
          normalizeSerialKey(oldBase || "");

        // 2) Hämta ny bas från formuläret (input)
        const { base: inputBase } = splitSerialParts(String(editForm.serial || ""));
        if (!inputBase) throw new Error("Serienummer saknas.");
        const newKey: string = normalizeSerialKey(inputBase);

        // Init: utgå från formens bas + nuvarande visit
        let serialBase: string = inputBase.trim();
        let serialBaseKey: string = newKey;
        let serialVisit: number = Number(cur.serialVisit || oldVisit || 1);


        // Bygg display endast för samma-bas-fallet (för baseChanged hanteras serial av ensure-fasen)
        const serial = buildDisplaySerial(serialBase, serialVisit);



        // Bygg serial-patch: om reallocation redan satte serialfält → skriv inte över dem här
        const serialPatch: any = lastSerialAllocRef.current?.changed
          ? {} // låt transaktionen (reallocateSerialOnEdit) vara "source of truth"
          : { serial, serialBase, serialBaseKey, serialVisit };

        // Skriv item atomiskt (utan att skriva över serialfält vid changed=true)
        tx.update(itemRef, {
          orderNumber: editForm.orderNumber || "",
          manufacturer: editForm.manufacturer || "",
          model: editForm.model || "",

          // Kundfält
          ...(String(editForm.customer || "").trim()
            ? {
              customer: String(editForm.customer).trim(),
              ...(String((editForm as any).customerId || "").trim()
                ? { customerId: String((editForm as any).customerId).trim() }
                : {}),
            }
            : {}),

          ...(String(editForm.productType || "").trim()
            ? { productType: String(editForm.productType).trim() }
            : {}),

          ...(String(editForm.productTypeId || "").trim()
            ? { productTypeId: String(editForm.productTypeId).trim() }
            : {}),

          warrantyStart: (editForm as any).warrantyStart ? String((editForm as any).warrantyStart).trim() : null,
          updatedAt: serverTimestamp(),

          // ⬇⬇⬇ Viktigt: serialfält endast om vi INTE redan omallokerat i ensure-funktionen
          ...serialPatch,

          adapterYesNo: (editForm as any).adapterYesNo || ((editForm as any).chargerIncluded ? "Yes" : "No"),
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

      // Nollställ "senaste alloc" efter lyckad sparning
      lastSerialAllocRef.current = null;

      stopLockHeartbeat();
      stopLockWatcher();
      try { await updateDoc(doc(db, "itInventory", editId), { lockedBy: null, lockedAt: null } as any); } catch { }

      alert("Enheten uppdaterad.");
      setIsEditOpen(false);
      setEditId(null);
      await refreshHomeList();
    } catch (err: any) {
      console.error(err);
      alert("Kunde inte spara ändringar: " + (err?.message || err));
    } finally {
      setIsSaving(false);
    }
  };

  // === onToggleDeleteFromList (ersätt) ===
  // Markerar/avmarkerar för radering – påverkar ENDAST item-fält (inte serialIndex)
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
        if (heldByOther && !isStale) throw new Error(`Posten redigeras av ${cur.lockedBy}.`);

        // No-op om samma status redan
        if (!!cur.deletePending === !!toChecked) return;

        // Skriv endast delete-fält + audit (utan updatedAt)
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
                ? [...(it as any).auditLog, { action: toChecked ? "delete_marked" : "delete_unmarked", by: me, at: nowIso }]
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
      await refreshHomeList();
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

      await refreshHomeList();
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
    (currentStep === 2 && form.customer.trim() !== "") ||
    (currentStep === 3 && form.manufacturer.trim() !== "") ||
    (currentStep === 4 && form.productType.trim() !== "") || // ← NYTT
    (currentStep === 5 && form.model.trim() !== "") ||
    (currentStep === 6 && form.serial.trim() !== "") ||
    (currentStep === 7 && !!form.warrantyStartDate) || // Garantistart krävs
    currentStep === 8 || // Adapter & skador – alltid OK (än så länge)
    (currentStep === 9 && (!form.customer || form.articleNumber.trim() !== "")) ||
    currentStep === 10 || // Bilder
    currentStep === 11;  // Sammanfattning


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

  // === Rapporter: undermeny-tillstånd (måste ligga före SIDE_MENU) ===
  const [reportsOpen, setReportsOpen] = useState(true);
  const [reportsView, setReportsView] = useState<"fakturor" | "klimat">("klimat");

  // === CO₂-rapport: flagga när productTypes-cache (impact) är primad ===
  const [rpTypesPrimed, setRpTypesPrimed] = useState(false);

  // Prima impact-cachen när vi öppnar Klimatrapporten (en gång)
  useEffect(() => {
    if (!authReady || !auth.currentUser) return;  // 👈 vänta tills inloggad
    if (rpTypesPrimed) return;
    if (reportsView !== "klimat") return;

    let cancelled = false;
    (async () => {
      try {
        await loadProductTypesForImpact();
        if (!cancelled) setRpTypesPrimed(true);
      } catch (e) {
        console.warn("Kunde inte prima productTypes för impact:", e);
      }
    })();

    return () => { cancelled = true; };
  }, [authReady, user?.uid, reportsView, rpTypesPrimed]); // 👈 + user?.uid


  // SIDE MENU (overlay + panel via portal)
  const SIDE_MENU = menuOpen
    ? createPortal(
      <>
        {/* Overlay – klick utanför stänger menyn */}
        <div
          className="gw-menu-overlay"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
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

          {/* Menylänkar + Rapporter som träd */}
          <nav className="menu-list" style={{ display: "grid", gap: 8, overflow: "auto" }}>
            {MENU
              // respektera ev. .visible()
              .filter((m) => (m.visible?.() ?? true))
              .map((m) => {
                // Dölj ENDAST fakturering helt för kund
                if (isCustomerPortal && m.key === "fakturering") return null;

                // Specialfall: Rapporter → träd med två subval
                if (m.key === "rapporter") {
                  const isRapporterActive = activePage === "rapporter";
                  return (
                    <div key="rapporter" style={{ display: "grid", gap: 6 }}>
                      <button
                        type="button"
                        className={`menu-item${isRapporterActive ? " is-active" : ""}`}
                        aria-expanded={reportsOpen}
                        onClick={() => setReportsOpen((o) => !o)}
                        style={{
                          textAlign: "left",
                          padding: "10px 12px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--surface-2)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <span>{m.label}</span>
                        <span style={{ opacity: 0.8 }}>{reportsOpen ? "▾" : "▸"}</span>
                      </button>

                      {reportsOpen && (
                        <div style={{ marginLeft: 8, display: "grid", gap: 6 }}>
                          {/* Dölj Fakturarapporter för kundkonton */}
                          {!isCustomerPortal && (
                            <button
                              type="button"
                              className="menu-item"
                              onClick={() => {
                                setActivePage("rapporter");
                                activePageRef.current = "rapporter";
                                setReportsView("fakturor");
                                setMenuOpen(false);
                                stopHomeSentinel?.();
                              }}
                              style={{
                                textAlign: "left",
                                padding: "8px 10px",
                                borderRadius: 8,
                                border: "1px solid transparent",
                                background:
                                  activePage === "rapporter" && reportsView === "fakturor"
                                    ? "var(--surface-2)"
                                    : "transparent",
                              }}
                            >
                              Fakturarapporter
                            </button>
                          )}

                          <button
                            type="button"
                            className="menu-item"
                            onClick={() => {
                              setActivePage("rapporter");
                              activePageRef.current = "rapporter";
                              setReportsView("klimat");
                              setMenuOpen(false);
                              stopHomeSentinel?.();
                            }}
                            style={{
                              textAlign: "left",
                              padding: "8px 10px",
                              borderRadius: 8,
                              border: "1px solid transparent",
                              background:
                                activePage === "rapporter" && reportsView === "klimat"
                                  ? "var(--surface-2)"
                                  : "transparent",
                            }}
                          >
                            Klimatrapport
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }

                // Övriga länkar som tidigare
                const active = activePage === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    className={`menu-item${active ? " is-active" : ""}`}
                    onClick={() => {
                      setActivePage(m.key);
                      activePageRef.current = m.key;
                      setMenuOpen(false);

                      if (m.key === "home") {
                        void fetchFirstPage();
                        startHomeSentinel?.();
                      } else {
                        stopHomeSentinel?.();
                      }
                    }}
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
      <div className="login-screen">

        <div className="gw-card login-card">
          <h2 style={{ margin: 0 }}>
            {mode === "login"
              ? "Logga in"
              : mode === "signup"
                ? "Skapa konto"
                : "Återställ lösenord"}
          </h2>

          <div style={{ marginTop: 12 }}>
            <label style={{ display: "block", marginBottom: 6 }}>E-post</label>
            <input
              className="gw-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="namn@exempel.se"
            />
          </div>

          {mode !== "reset" && (
            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", marginBottom: 6 }}>Lösenord</label>
              <input
                className="gw-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          )}

          {msg && (
            <div className="gw-banner gw-banner--warn" style={{ marginTop: 12 }}>
              {msg}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={
                mode === "login" ? doLogin : mode === "signup" ? doSignup : doReset
              }
              disabled={busy}
              style={{ width: "100%" }}
            >
              {mode === "login"
                ? "Logga in"
                : mode === "signup"
                  ? "Skapa konto"
                  : "Skicka återställningslänk"}
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            {mode !== "login" ? (
              <button
                type="button"
                onClick={() => setMode("login")}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--primary)",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                Har konto? Logga in
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMode("signup")}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--primary)",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                Skapa konto
              </button>
            )}

            {mode !== "reset" && (
              <button
                type="button"
                onClick={() => setMode("reset")}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--primary)",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                Glömt lösenord?
              </button>
            )}
          </div>
        </div>
      </div>
    );

  }





  /* =========================
     UI: Sidor (Home/Fakturering)
  ========================= */

  // Flagga baserat på hashroute (du har redan reportIdFromHash tidigare i App)


  const [rpTo, setRpTo] = useState<string>(toYMD(new Date()));

  // === CO₂-rapport: valda kunder (scope = samma som RAPPORTER-blocket) ===
  const [rpSelectedCustomers, setRpSelectedCustomers] = useState<string[]>([]);

  // === CO₂-rapport: valda produkttyper ===
  const [rpSelectedTypes, setRpSelectedTypes] = useState<string[]>([]);

  const [rpTypeOpts, setRpTypeOpts] = useState<{ id: string; label: string }[]>([]);

  // === CO₂-rapport: förvälj alla typer vid första laddning av rpTypeOpts ===
  useEffect(() => {
    if (rpSelectedTypes.length === 0 && rpTypeOpts.length > 0) {
      setRpSelectedTypes(rpTypeOpts.map((o) => o.id));
    }
  }, [rpTypeOpts]);

  // --- Produkttyp: UI-states (samma mönster som Tillverkare) ---
  const [showNewProductTypeInput, setShowNewProductTypeInput] = useState<boolean>(false);
  const [newProductType, setNewProductType] = useState<string>("");

  const productTypeExists = useMemo(() => {
    const v = newProductType.trim();
    if (!v) return false;
    return rpTypeOpts.some((t) => t.label.trim().toLowerCase() === v.toLowerCase());
  }, [newProductType, rpTypeOpts]);

  // === CO₂-rapport: kundlista från Firestore ===
  const [rpCustomerOpts, setRpCustomerOpts] = useState<{ key: string; name: string }[]>([]);

  // === CO₂-rapport: kundlista från Firestore ===
  useEffect(() => {
    if (!authReady || !auth.currentUser) return; // vänta tills inloggad

    let cancelled = false;

    (async () => {
      try {
        const snap = await getDocs(collection(db, "customers"));
        let opts = snap.docs
          .map((d) => {
            const data = d.data() as any;
            const name = String(data?.name ?? d.id);
            return { key: d.id, name }; // viktigt: key = doc.id (customerId)
          })
          .sort((a, b) => a.name.localeCompare(b.name, "sv"));

        if (isCustomerPortal) {
          const allowed = new Set((customerKeys ?? []).map(String));
          opts = opts.filter((o) => allowed.has(o.key));
        }

        if (!cancelled) {
          setRpCustomerOpts(opts);
          if (rpSelectedCustomers.length === 0 && opts.length > 0) {
            setRpSelectedCustomers(opts.map((o) => o.key));
          }
        }
      } catch (e) {
        console.warn("Kunde inte ladda customers:", e);
        if (!cancelled) setRpCustomerOpts([]);
      }
    })();

    return () => { cancelled = true; };
  }, [authReady, user?.uid, isCustomerPortal, JSON.stringify(customerKeys)]);




  // === CO₂-rapport: produkttyper från DB (productTypes) — live ===
  useEffect(() => {
    if (!authReady || !auth.currentUser) return;   // 👈 vänta tills inloggad
    let unsub: undefined | (() => void);

    try {
      const colRef = collection(db, "productTypes");
      unsub = onSnapshot(
        // HÄR: ta alla, sortera på label (ingen where)
        query(colRef, orderBy("label")),
        (snap) => {
          // Mappa + filtrera klient-side:
          // visa alla där active !== false (dvs. saknat fält tolkas som aktivt)
          const opts = snap.docs
            .map((d) => {
              const data = d.data() as any;
              const id = String(d.id);
              const label = typeof data?.label === "string" ? data.label : id;
              const active = data?.active;
              return { id, label, active };
            })
            .filter((o) => o.active !== false)
            .map(({ id, label }) => ({ id, label }))
            .sort((a, b) => a.label.localeCompare(b.label, "sv"));

          // uppdatera listboxens alternativ
          setRpTypeOpts(opts);

          // om inget valt ännu -> välj alla ids
          setRpSelectedTypes((prev) => (prev && prev.length > 0 ? prev : opts.map((o) => o.id)));
        }
      );
    } catch (e) {
      console.warn("Kunde inte live-ladda productTypes:", e);
      setRpTypeOpts([]);
    }


    return () => { if (unsub) unsub(); };
  }, [authReady, user?.uid, db]);    // 👈 + user?.uid


  // Förvälj alla första gången
  React.useEffect(() => {
    if (rpSelectedTypes.length === 0 && rpTypeOpts.length > 0) {
      setRpSelectedTypes(rpTypeOpts.map((o) => o.id));
    }
  }, [rpTypeOpts]);







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
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: 8 }}>
              <ThemeToggle />
            </div>
            {/* dev-rapport borttagen */}

            {/* RAPPORTER */}
            {activePage === "rapporter" && (
              reportsView === "klimat" ? (

                <COReport
                  from={rpFrom}
                  to={rpTo}


                  preview={reportPreview}
                  customerOpts={rpCustomerOpts}
                  selectedCustomers={rpSelectedCustomers}
                  onChangeFrom={setRpFrom}
                  onChangeTo={setRpTo}
                  onToggleCustomer={(key) =>
                    setRpSelectedCustomers((prev: string[]) =>
                      prev.includes(key) ? prev.filter((k: string) => k !== key) : [...prev, key]
                    )
                  }
                  typeOpts={rpTypeOpts}
                  selectedTypes={rpSelectedTypes}
                  onToggleType={(id) =>
                    setRpSelectedTypes((prev: string[]) =>
                      prev.includes(id) ? prev.filter((t: string) => t !== id) : [...prev, id]
                    )
                  }
                    onRun={async () => {
                      setReportLoading(true);
                      setReportError(null);
                      try {
                        // 👇 Säkerställ att productTypes-cachen är primad innan vi bygger preview
                        if (!rpTypesPrimed) {
                          try {
                            await loadProductTypesForImpact();
                            setRpTypesPrimed(true);
                          } catch (e) {
                            console.warn("Fallback-prime misslyckades:", e);
                          }
                        }

                        // 🔒 Lås kundurvalet till det som faktiskt finns i UI-listan
                        const allowedIds = new Set(rpCustomerOpts.map(o => o.key));
                        let customerIds = (
                          rpSelectedCustomers.length > 0
                            ? rpSelectedCustomers
                            : rpCustomerOpts.map(o => o.key)
                        ).filter(id => allowedIds.has(id));

                        // Kundläge: blockera körning om inget tillåtet val finns kvar
                        if (isCustomerPortal && customerIds.length === 0) {
                          setReportError("Inga behöriga kunder valda.");
                          setReportLoading(false);
                          return;
                        }

                        const productTypes: ProductType[] | undefined =
                          rpSelectedTypes.length > 0
                            ? (rpSelectedTypes as unknown as ProductType[])
                            : undefined;

                        const toYMD = (d: Date) => d.toISOString().slice(0, 10);
                        const toDateExclusive =
                          rpTo && rpTo.trim()
                            ? toYMD(new Date(new Date(rpTo).getTime() + 24 * 60 * 60 * 1000))
                            : undefined;

                        const filters: ReportFilters = {
                          fromDate: rpFrom,
                          toDate: toDateExclusive ?? rpTo,
                          basis: "completedAt",
                          customerIds,
                          productTypes,
                        };

                        const { preview } = await getImpactPreviewForFilters(filters);
                        setReportPreview(preview);
                      } catch (e: any) {
                        setReportError(e?.message || "Fel vid rapportförhandsvisning");
                      } finally {
                        setReportLoading(false);
                      }
                    }}


                  loading={reportLoading}
                  error={reportError || (rpTypeOpts.length === 0 ? "Inga produkttyper hittades i DB. Lägg till i 'productTypes' eller kontrollera åtkomst." : null)}

                />


              ) : (
                <ReportsPage />

              )


            )}

            {/* ADMIN: Produkttyper */}
            {activePage === "productTypesAdmin" && <ProductTypesAdmin />}

            {/* HOME */}
            {activePage === "home" && (
              <>

                {/* ADD: Dölj wizard/snabbinmatning för kundkonton */}
                {!isCustomerPortal && (
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
                                value={form.customerKey || ""} // ✅ bind mot kundens ID
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === "new") {
                                    setShowNewCustomerInput(true);
                                    setForm((p) => ({ ...p, customer: "", customerKey: "" }));
                                  } else {
                                    setShowNewCustomerInput(false);
                                    const opt = Array.isArray(customerListOpts)
                                      ? customerListOpts.find(o => o.key === v)
                                      : undefined;
                                    setForm((p) => ({
                                      ...p,
                                      customer: opt?.name ?? "",   // ✅ spara visningsnamn
                                      customerKey: opt?.key ?? ""  // ✅ spara ID
                                    }));
                                  }
                                }}
                                className="gw-input"
                                style={{ maxWidth: "100%" }}
                              >
                                <option value="">Kund</option>
                                {customerListOpts.map((opt) => (
                                  <option key={opt.key} value={opt.key}>
                                    {opt.name}
                                  </option>
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
                                  <button type="button" onClick={handleNewCustomerAdd} className="btn">Lägg till</button>
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

                        {/* STEG 4: Produkttyp */}
                        {currentStep === 4 && (
                          <div className="gw-card">
                            <h3 className="gw-h3">Välj produkttyp</h3>

                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <select
                                value={form.productType}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  if (value === "new") {
                                    setShowNewProductTypeInput(true);
                                    setForm((prev) => ({ ...prev, productType: "" }));
                                  } else {
                                    setShowNewProductTypeInput(false);
                                    setForm((prev) => ({ ...prev, productType: value }));
                                  }
                                }}
                                className="gw-input"
                              >
                                <option value="">Produkttyp</option>
                                {rpTypeOpts.map((t) => (
                                  <option key={t.id} value={t.label}>{t.label}</option>
                                ))}
                                <option value="new">Lägg till ny produkttyp</option>
                              </select>

                              {showNewProductTypeInput && (
                                <>
                                  <input
                                    type="text"
                                    placeholder="Ny produkttyp"
                                    value={newProductType}
                                    onChange={(e) => setNewProductType(e.target.value)}
                                    className="gw-input"
                                  />
                                  {productTypeExists && (
                                    <div style={{ color: "#b91c1c", fontSize: 13 }}>Produkttypen finns redan.</div>
                                  )}
                                  <button
                                    onClick={async () => {
                                      const name = newProductType.trim();
                                      if (!name || productTypeExists) return;
                                      try {
                                        await ensureProductTypeInDb(name, name); // skapa i DB med defaultvärden
                                        // uppdatera lokala options så den nya syns direkt
                                        setRpTypeOpts((prev) => {
                                          const id = name.toLowerCase();
                                          return prev.some((o) => o.id === id)
                                            ? prev
                                            : [...prev, { id, label: name }].sort((a, b) => a.label.localeCompare(b.label, "sv"));
                                        });
                                        setForm((prev) => ({ ...prev, productType: name })); // välj den direkt
                                        setShowNewProductTypeInput(false);
                                        setNewProductType("");
                                        setRpTypesPrimed(false); // prime:a om impact-cache vid behov
                                      } catch (err) {
                                        console.warn("Kunde inte skapa produkttyp:", err);
                                        alert("Kunde inte skapa produkttyp. Se konsolen för detaljer.");
                                      }
                                    }}
                                    disabled={!newProductType.trim() || productTypeExists}
                                    title={productTypeExists ? "Dublett: kan inte spara" : "Lägg till"}
                                    className="btn btn-secondary"
                                  >
                                    Lägg till
                                  </button>
                                </>
                              )}
                            </div>

                            <div className="gw-actions">
                              <button onClick={prevStep} className="btn">Tillbaka</button>
                              <button
                                onClick={nextStep}
                                className="btn btn-primary"
                                disabled={!form.productType.trim()}
                              >
                                Nästa
                              </button>
                            </div>
                          </div>
                        )}



                        {/* STEG 4: Modell */}
                        {currentStep === 5 && (
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
                        {currentStep === 6 && (
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

                        {/* STEG 7: Warranty start date */}
                        {currentStep === 7 && (
                          <div className="gw-card">
                            <h3 className="gw-h3">Garantistart (Warranty start date)</h3>

                            <div style={FIELD_MARGIN}>
                              <input
                                name="warrantyStartDate"
                                type="date"
                                value={form.warrantyStartDate}
                                onChange={handleInputChange}
                                onPaste={(e) => {
                                  const text = e.clipboardData?.getData("text") || "";
                                  const iso = parseLooseDateToISO(text);
                                  if (iso) {
                                    e.preventDefault();
                                    setForm((p) => ({ ...p, warrantyStartDate: iso }));
                                  }
                                }}
                                className="gw-input"
                              />
                            </div>

                            {/* Hjälpknapp: kopiera serienr + slå mot vendorLookup + öppna i nytt fönster */}
                            {(() => {
                              const serialBase = normalizeSerialKey(splitSerialParts(form.serial || "").base);
                              if (!serialBase) return null;

                              async function handleCopyLookupAndOpen() {
                                // 1) Kopiera serienummer
                                try { await copyToClipboard(serialBase); } catch { /* ignore */ }

                                // 2) Försök hämta deepLink via Cloud Function
                                let url: string | null = null;
                                try {
                                  const res = await callVendorLookup(form.manufacturer, serialBase);
                                  if (res?.ok && res.deepLink) url = res.deepLink;

                                  // 🧪 Autoifyll (om/när API börjar returnera data)
                                  if (res?.model && !form.model) {
                                    setForm((p) => ({ ...p, model: res.model as string }));
                                  }
                                  if (res?.warrantyStartDate && !form.warrantyStartDate) {
                                    setForm((p) => ({ ...p, warrantyStartDate: res.warrantyStartDate as string }));
                                  }
                                } catch { /* ignore */ }

                                // 3) Fallback till lokal länk-builder (HP m.fl.)
                                if (!url) url = buildWarrantyLink(form.manufacturer, serialBase);

                                // 4) Öppna i NYTT FÖNSTER (UA kan fortfarande välja flik beroende på policy)
                                if (url) {
                                  const w = window.open(
                                    url,
                                    "vendorWarrantyPopup",
                                    "noopener,noreferrer,width=1200,height=900,left=80,top=60,scrollbars=1,resizable=1"
                                  );
                                  w?.focus?.();
                                } else {
                                  alert("Kunde inte skapa garantilänk. Kontrollera tillverkare och serienummer.");
                                }
                              }

                              return (
                                <div style={{ marginTop: 8 }}>
                                  <button
                                    type="button"
                                    onClick={handleCopyLookupAndOpen}
                                    className="btn btn-primary"
                                    style={{ borderWidth: 2, fontWeight: 700 }}
                                    title={`Öppna garantisida & kopiera ${serialBase}`}
                                  >
                                    🔗 Öppna garantisida & kopiera serienummer
                                  </button>
                                  <div style={{ color: "#6b7280", marginTop: 6, fontSize: 13 }}>
                                    Serienumret kopieras automatiskt. Länken byggs via leverantörs-lookup (HP stöds nu) och
                                    faller tillbaka till generell sida om exakt länk inte kan tas fram.
                                  </div>
                                </div>
                              );
                            })()}


                            <div className="gw-actions">
                              <button onClick={prevStep} className="btn">Tillbaka</button>
                              <button
                                onClick={nextStep}
                                className="btn btn-primary"
                                disabled={!form.warrantyStartDate}   // lås “Nästa” tills datum finns
                                title={form.warrantyStartDate ? "Nästa" : "Fyll i garantistart först"}
                              >
                                Nästa
                              </button>
                            </div>
                          </div>
                        )}





                        {/* STEG 8: Adapter & Skador */}
                        {currentStep === 8 && (
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



                        {/* STEG 9: Artikelnummer hos Convit */}
                        {currentStep === 9 && (
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

                        {/* STEG 10: Bilder */}
                        {currentStep === 10 && (
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

                        {/* STEG 11: Sammanfattning & Spara */}
                        {currentStep === 11 && (
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
                              <div><b>Warranty start:</b> {form.warrantyStartDate || "—"}</div>
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
                                value={form.customerKey || ""} // ✅ bind mot kundens ID
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === "new") {
                                    setShowNewCustomerInput(true);
                                    setForm((p) => ({ ...p, customer: "", customerKey: "" }));
                                  } else {
                                    setShowNewCustomerInput(false);
                                    const opt = Array.isArray(customerListOpts)
                                      ? customerListOpts.find(o => o.key === v)
                                      : undefined;
                                    setForm((p) => ({
                                      ...p,
                                      customer: opt?.name ?? "",   // visningsnamn
                                      customerKey: opt?.key ?? "", // ✅ ID
                                    }));
                                  }
                                }}
                                className="gw-input"
                                style={{ maxWidth: "100%" }}
                              >
                                <option value="">Kund</option>
                                {customerListOpts.map((opt) => (
                                  <option key={opt.key} value={opt.key}>
                                    {opt.name}
                                  </option>
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
                                  <button type="button" onClick={handleNewCustomerAdd} className="btn">Lägg till</button>
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




                          {/* RAD 2 — Adapter (1), Produkttyp (1), Garantistart + Garantikoll (2) */}

                          <label className="gw-form-field gw-col-1">
                            <div className="gw-form-label">Adapter</div>
                            <select
                              name="adapterYesNo"
                              value={form.adapterYesNo}
                              onChange={(e) => {
                                const v = e.target.value as "Yes" | "No" | "";
                                setForm(p => ({ ...p, adapterYesNo: v, chargerIncluded: v === "Yes" })); // håll boolen i synk
                              }}
                              className="gw-input"
                            >
                              <option value="">Välj</option>
                              <option value="Yes">Ja</option>
                              <option value="No">Nej</option>
                            </select>
                          </label>

                          <label className="gw-form-field gw-col-1">
                            <div className="gw-form-label">Produkttyp</div>
                            <select
                              name="productType"
                              value={form.productType}
                              onChange={(e) => {
                                const value = e.target.value;
                                if (value === "new") {
                                  setShowNewProductTypeInput(true);
                                  setForm((p) => ({ ...p, productType: "" }));
                                } else {
                                  setShowNewProductTypeInput(false);
                                  setForm((p) => ({ ...p, productType: value }));
                                }
                              }}
                              className="gw-input"
                            >
                              <option value="">Välj kategori</option>
                              {rpTypeOpts.map((t) => (
                                <option key={t.id} value={t.label}>{t.label}</option>
                              ))}
                              <option value="new">Lägg till ny…</option>
                            </select>

                            {showNewProductTypeInput && (
                              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                                <input
                                  type="text"
                                  placeholder="Ny produkttyp"
                                  value={newProductType}
                                  onChange={(e) => setNewProductType(e.target.value)}
                                  className="gw-input"
                                />
                                <button
                                  onClick={async () => {
                                    const name = newProductType.trim();
                                    if (!name || productTypeExists) return;
                                    try {
                                      await ensureProductTypeInDb(name, name); // skapar doc med defaultvärden
                                      // uppdatera lokala options så nya syns direkt
                                      setRpTypeOpts((prev) => {
                                        const id = name.toLowerCase();
                                        return prev.some((o) => o.id === id)
                                          ? prev
                                          : [...prev, { id, label: name }].sort((a, b) => a.label.localeCompare(b.label, "sv"));
                                      });
                                      setForm((p) => ({ ...p, productType: name })); // välj direkt
                                      setShowNewProductTypeInput(false);
                                      setNewProductType("");
                                      setRpTypesPrimed(false); // prime:a om impact-cache vid behov
                                    } catch (err) {
                                      console.warn("Kunde inte skapa produkttyp:", err);
                                      alert("Kunde inte skapa produkttyp. Se konsolen för detaljer.");
                                    }
                                  }}
                                  disabled={!newProductType.trim() || productTypeExists}
                                  title={productTypeExists ? "Dublett: kan inte spara" : "Lägg till"}
                                  className="btn btn-secondary"
                                >
                                  Lägg till
                                </button>
                              </div>
                            )}
                          </label>


                          {/* Garantistart – 2 kol (endast input) */}
                          <label className="gw-form-field gw-col-2">
                            <div className="gw-form-label">Garantistart</div>
                            <input
                              name="warrantyStartDate"
                              type="date"
                              value={form.warrantyStartDate}
                              onChange={handleInputChange}
                              onPaste={(e) => {
                                const text = e.clipboardData?.getData("text") || "";
                                const iso = parseLooseDateToISO(text);
                                if (iso) { e.preventDefault(); setForm(p => ({ ...p, warrantyStartDate: iso })); }
                              }}
                              className="gw-input"
                            />
                          </label>

                          {/* Garantikoll – 2 kol (knapp) */}
                          <label className="gw-form-field gw-col-2">
                            <div className="gw-form-label">&nbsp;</div>
                            {(() => {
                              const manufacturer = (form.manufacturer || "").trim();
                              const serialBase = normalizeSerialKey(splitSerialParts(form.serial || "").base);

                              async function handleWarrantyClick() {
                                try { await copyToClipboard(serialBase); } catch { }
                                let url: string | null = null;
                                try {
                                  const res = await callVendorLookup(manufacturer, serialBase);
                                  if (res?.ok && res.deepLink) url = res.deepLink;
                                  if (res?.model && !form.model) setForm(p => ({ ...p, model: res.model as string }));
                                  if (res?.warrantyStartDate && !form.warrantyStartDate) setForm(p => ({ ...p, warrantyStartDate: res.warrantyStartDate as string }));
                                } catch { }
                                if (!url) url = buildWarrantyLink(manufacturer, serialBase);
                                if (url) {
                                  const w = window.open(url, "vendorWarrantyPopup", "noopener,noreferrer,width=1200,height=900,left=80,top=60,scrollbars=1,resizable=1");
                                  w?.focus?.();
                                } else {
                                  alert("Kunde inte skapa garantilänk. Kontrollera tillverkare och serienummer.");
                                }
                              }

                              const ready = !!manufacturer && !!serialBase;

                              return (
                                <button
                                  type="button"
                                  className="btn btn-primary"      // ← blå, samma stil som i wizarden
                                  onClick={handleWarrantyClick}
                                  disabled={!ready}
                                  title={
                                    !manufacturer ? "Välj tillverkare" :
                                      !serialBase ? "Fyll i serienummer" :
                                        `Öppna garantisida & kopiera ${serialBase}`
                                  }
                                  style={{ whiteSpace: "nowrap" }}
                                >
                                  Garantikoll
                                </button>
                              );
                            })()}
                          </label>


                          {/* RAD 3 — Skador (2) + Bilder (4) */}
                          <label className="gw-form-field gw-col-2">
                            <div className="gw-form-label">Skador</div>
                            <textarea
                              name="damageNotes"
                              placeholder="Eventuella skador"
                              value={form.damageNotes}
                              onChange={handleInputChange}
                              className="gw-input"
                              rows={7}
                            />
                          </label>

                          <label className="gw-form-field gw-col-4">
                            <div className="gw-form-label">Bilder</div>
                            {/* (oförändrat fotonät) */}
                            <div className="gw-photo-grid gw-photo-grid--auto">
                              {(["keyboard", "screen", "underside", "topside"] as PhotoKey[]).map((type) => {
                                const src = thumbnailPreviews[type];
                                const label = type === "keyboard" ? "Tangentbord" : type === "screen" ? "Skärm" : type === "underside" ? "Undersida" : "Ovansida";
                                return (
                                  <div key={type} className="gw-photo-card">
                                    <input id={`quick-photo-${type}`} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => handlePhotoChange(e, type)} />
                                    <div role="button" tabIndex={0} onClick={() => document.getElementById(`quick-photo-${type}`)?.click()} onKeyDown={(e) => { if (e.key === "Enter") document.getElementById(`quick-photo-${type}`)?.click(); }}>
                                      {src ? <img className="gw-photo-img" src={src} alt={`${label} preview`} /> : <div className="gw-photo-placeholder">Klicka för att lägga till<br />{label.toLowerCase()}</div>}
                                    </div>
                                    {src && (<button type="button" className="gw-photo-remove" onClick={() => handleRemovePhoto(type)} title={`Ta bort ${label}`} aria-label={`Ta bort ${label}`}>×</button>)}
                                    <div className="gw-photo-title">{label}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </label>


                        </div> {/* ← stänger .gw-form-grid gw-form-grid--quick (oförändrat) */}



                        <div
                          className="gw-actions"
                          style={{
                            marginTop: 8,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                            flexWrap: "wrap"
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
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
                                  style={{ margin: 0 }}
                                >
                                  Saknas: {missing.join(", ")}
                                </div>
                              );
                            })()}
                          </div>

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
                  </div>
                )} {/* END: Dölj för kundkonton */}

                {/* Lista + edit-modal */}
                {isLoadingItems && (
                  <div
                    className="gw-content"
                    style={{ marginTop: 20, fontStyle: "italic", opacity: 0.8 }}
                  >
                    Laddar enheter…
                  </div>
                )}


                {items.length > 0 && (
                  <div className="gw-content">
                    <section className="gw-section">
                      <div className="gw-section-header">
                        <h3 className="gw-h3" style={{ margin: 0 }}>Sparade enheter</h3>

                        <div className="gw-section-actions">
                          {!isCustomerPortal && (
                            <button
                              onClick={openDeleteModal}
                              disabled={pendingDeletableIds.length === 0}
                              className="btn btn-danger"
                              title="Radera markerade"
                            >
                              Radera markerade
                            </button>
                          )}
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
                                {!isCustomerPortal && <th className="td-narrow"></th>}
                                <th>Ordernr</th>
                                <th>Tillverkare</th>
                                <th>Modell</th>
                                <th>Serienr</th>
                                <th>Adapter</th>
                                <th>Skapad</th>
                                <th>Skapad av</th>
                              </tr>
                              <tr>
                                {!isCustomerPortal && <th className="td-narrow"></th>}
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
                                    {!isCustomerPortal && (
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
                                    )}

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
                      isReadOnly={isCustomerPortal || editIsReadOnly}
                      invoiceReportId={editInvoiceReportId}
                      isSaving={isSaving}
                      isCustomerAccount={isCustomerPortal}
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

              {activePage === "fakturering" && (
                <InvoicingPage
                  user={user}
                  isCustomer={isCustomer}
                  billingCustomerFilter={billingCustomerFilter}
                  setBillingCustomerFilter={setBillingCustomerFilter}
                  billingFilteredItems={billingFilteredItems}
                  allFilteredMarked={allFilteredMarked}
                  isMarkingAll={isMarkingAll}
                  creatingReport={creatingReport}
                  setCreatingReport={setCreatingReport}
                  toggleMarkAllInFiltered={toggleMarkAllInFiltered}
                  setMarkedForInvoice={setMarkedForInvoice}
                  updateItemsState={(updater) => setItems(prev => updater(prev as any) as any)}
                  customerListOpts={customerListOpts}
                  computeBillingSteps={computeBillingSteps}
                  fmtDateOnly={fmtDateOnly}
                  formatSerialForDisplay={formatSerialForDisplay}
                  toEpochMillis={toEpochMillis}
                  createInvoiceReportCF={createInvoiceReportCF}
                  createInvoiceReportLocal={async () =>
                    generateInvoiceReportForMarkedItems(
                      (items as any[]).filter((it: any) => it?.completed === true),
                      user?.email ?? null
                    )
                  }
                  fetchFirstPage={fetchFirstPage}
                />
              )}


            {/* ANVÄNDARE (endast admin) */}
            {activePage === "users" && user?.role === "admin" && <UserAdmin />}

          </div>
        </div>
      )
      }
    </div >
  );
} // end component