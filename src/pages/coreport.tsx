// === Mikrosteg 8: ersätt importblocket i src/pages/coreport.tsx med detta ===
import React, { useState } from "react";
import type { PreparedImpactDisplay } from "../lib/impact";

// Behåll Firestore-läs-importer om de används i denna fil (listningar/preview mm)
import { getFirestore, collection, onSnapshot, orderBy, query } from "firebase/firestore";

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { PDFPage } from "pdf-lib";

// Lägg till Functions-anropet (server-skrivning av manifest)
import { getFunctions, httpsCallable } from "firebase/functions";




/* ===== Hjälpare ===== */
function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ===== Små tabellstilar ===== */
const TH: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid #e5e7eb",
  padding: "6px 8px",
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
};
const THnum: React.CSSProperties = { ...TH, textAlign: "right" };

const TD: React.CSSProperties = {
  borderBottom: "1px solid #f1f5f9",
  padding: "6px 8px",
  fontSize: 13,
};
const TDnum: React.CSSProperties = { ...TD, textAlign: "right", whiteSpace: "nowrap" };


// === Auto-titel för export ===
function autoReportTitle(from: string, to: string, customerKeys: string[], opts: { customers: { key: string; name: string }[] }) {
  const names = customerKeys
    .map(k => opts.customers.find(c => c.key === k)?.name || k)
    .filter(Boolean);
  const span = from && to ? `${from}–${to}` : "";
  if (names.length === 1) return `Klimatrapport ${names[0]} ${span}`.trim();
  if (names.length > 1) return `Klimatrapport ${names.length} kunder ${span}`.trim();
  return `Klimatrapport ${span}`.trim();
}


// === Server-side preview helper ===
const BUILD_CO2_PREVIEW_URL = "https://europe-west1-it-returns.cloudfunctions.net/buildCO2Preview";

type ServerPreview = {
  filters: {
    fromDate: string;
    toDate: string;
    basis: "completedAt";
    customerIds: string[];
    productTypeIds?: string[];
    factorPolicy?: "latest";
  };
  customersIncluded: Record<string, string>;
  factorsUsed: Record<string, { label: string; medianWeightKg: number; co2PerUnitKg: number; schemaVersion: number }>;
  perCustomer: Array<{
    customerId: string;
    customerName: string;
    rows: Array<{
      productTypeId: string;
      productType: string;
      A: number; B: number; C: number; D: number; E: number;
      total: number;
      eWasteKg: number;
      recycledKg: number;
      co2Kg: number;
    }>;
    totals: { A: number; B: number; C: number; D: number; E: number; eWasteKg: number; recycledKg: number; co2Kg: number; total: number };
  }>;
  grandTotals: { A: number; B: number; C: number; D: number; E: number; eWasteKg: number; recycledKg: number; co2Kg: number; total: number };
  selection: { itemIds: string[] };
};

async function fetchServerPreview(params: {
  fromDate: string;
  toDate: string;
  customerIds: string[];
  productTypeIds?: string[];
  basis?: "completedAt";
  factorPolicy?: "latest";
}): Promise<ServerPreview> {
  const payload = {
    fromDate: params.fromDate,
    toDate: params.toDate,
    basis: params.basis ?? "completedAt",
    customerIds: params.customerIds,
    productTypeIds: params.productTypeIds && params.productTypeIds.length ? params.productTypeIds : undefined,
    factorPolicy: params.factorPolicy ?? "latest",
  };
  const res = await fetch(BUILD_CO2_PREVIEW_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "omit",
    mode: "cors",
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`buildCO2Preview failed: ${res.status} ${res.statusText} ${txt}`);
  }
  return res.json();
}

// --- NYTT: lokal state för server-preview ---
const [serverPreview, setServerPreview] = useState<ServerPreview | null>(null);

// --- NYTT: översätt serverns svar till samma "platta" rader som tabellen förväntar sig ---
function flattenRowsFromServer(sp: ServerPreview) {
  // summera per produkttyp över alla valda kunder
  const byType = new Map<string, {
    productTypeId: string;
    productType: string;
    A: number; B: number; C: number; D: number; E: number;
    total: number; eWasteKg: number; recycledKg: number; co2Kg: number;
  }>();

  for (const bucket of sp.perCustomer) {
    for (const r of bucket.rows) {
      const key = r.productTypeId || r.productType;
      if (!byType.has(key)) {
        byType.set(key, {
          productTypeId: r.productTypeId,
          productType: r.productType,
          A: 0, B: 0, C: 0, D: 0, E: 0,
          total: 0, eWasteKg: 0, recycledKg: 0, co2Kg: 0,
        });
      }
      const acc = byType.get(key)!;
      acc.A += r.A; acc.B += r.B; acc.C += r.C; acc.D += r.D; acc.E += r.E;
      acc.total += r.total;
      acc.eWasteKg += r.eWasteKg;
      acc.recycledKg += r.recycledKg;
      acc.co2Kg += r.co2Kg;
    }
  }

  // returnera i en stabil ordning på etikett
  return Array.from(byType.values()).sort((a, b) =>
    a.productType.localeCompare(b.productType, "sv"));
}






/* ===== Typer som styr filtret ===== */
type OptCustomer = { key: string; name: string };
type OptType = { id: string; label: string };

type COReportProps = {
  /* Kontrolleras uppifrån (App) – alla valfria */
  from?: string;
  to?: string;
  customerOpts?: OptCustomer[];
  typeOpts?: OptType[];
  selectedCustomers?: string[];
  selectedTypes?: string[];

  /* Laddning/fel + data */
  loading?: boolean;
  error?: string | null;
  preview?: PreparedImpactDisplay | null;

  /* Actions */
  onRun?: () => void | Promise<void>;
  onSave?: () => void | Promise<void>;

  /* Kontrollerade inputs (om App vill äga state) */
  onChangeFrom?: (v: string) => void;
  onChangeTo?: (v: string) => void;
  onToggleCustomer?: (key: string) => void;
  onToggleType?: (id: string) => void;
};

export default function COReport(props: COReportProps) {
  const { loading, error } = props;

  /* -------- Lokal fallback-state (om props inte skickas) -------- */
  const [localFrom, setLocalFrom] = useState<string>(
    props.from ?? toYMD(new Date(Date.now() - 30 * 86400000))
  );
  const [localTo, setLocalTo] = useState<string>(props.to ?? toYMD(new Date()));
  const [localSelCustomers, setLocalSelCustomers] = useState<string[]>(
    props.selectedCustomers ?? []
  );
  const [localSelTypes, setLocalSelTypes] = useState<string[]>(
    props.selectedTypes ?? []
  );


  // liten helper överst i filen eller lokalt här
  function eighty(n: number) { return n; }




  /* -------- Värden som visas i UI (props prioriteras) -------- */
  const vFrom = props.from ?? localFrom;
  const vTo = props.to ?? localTo;
  const vCustomers = props.selectedCustomers ?? localSelCustomers;
  const vTypes = props.selectedTypes ?? localSelTypes;

  const customerOpts = props.customerOpts ?? [];
  const typeOpts = props.typeOpts ?? [];
  // Om vi har ett server-svar: platta ut raderna därifrån och använd dem i render
  const previewFromServer = serverPreview
    ? {
      // minimalt “preview-objekt” för tabellen nedan:
      rows: flattenRowsFromServer(serverPreview),
      totals: serverPreview.grandTotals,
      processed: Number(serverPreview.grandTotals?.total ?? 0),
      skipped: 0,
      schemaVersion: 1,
    }
    : null;

  // Fallback till props.preview (gamla klient-beräkningen) om vi inte har server-svar
  const preview = previewFromServer ?? (props.preview ?? null);


  /* -------- Handlers (delegation till props, annars lokalt) -------- */
  const setFrom = (v: string) => (props.onChangeFrom ? props.onChangeFrom(v) : setLocalFrom(v));
  const setTo = (v: string) => (props.onChangeTo ? props.onChangeTo(v) : setLocalTo(v));

  const [typeQuery, setTypeQuery] = useState("");

  const filteredTypeOpts = (typeOpts ?? []).filter((t) => {
    const q = typeQuery.trim().toLowerCase();
    return !q || t.label.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
  });

  const toggleCustomer = (key: string) => {
    if (props.onToggleCustomer) return props.onToggleCustomer(key);
    setLocalSelCustomers((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const toggleType = (id: string) => {
    if (props.onToggleType) return props.onToggleType(id);
    setLocalSelTypes((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  

  // Begränsa valen till de ids som faktiskt finns i typeOpts
  const availableTypeIds = React.useMemo(
    () => new Set((typeOpts ?? []).map((t) => t.id)),
    [typeOpts]
  );

  const safeSelectedTypes = React.useMemo(
    () => (props.selectedTypes ?? vTypes).filter((id) => availableTypeIds.has(id)),
    [props.selectedTypes, vTypes, availableTypeIds]
  );

  // Sök/filter för kunder
  const [customerQuery, setCustomerQuery] = useState("");

  const filteredCustomerOpts = (customerOpts ?? []).filter((c) => {
    const q = customerQuery.trim().toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || c.key.toLowerCase().includes(q);
  });

  // Sanera valda kunder mot faktisk lista (tar bort spök-ids)
  const availableCustomerKeys = React.useMemo(
    () => new Set((customerOpts ?? []).map((c) => c.key)),
    [customerOpts]
  );

  const safeSelectedCustomers = React.useMemo(
    () => (props.selectedCustomers ?? vCustomers).filter((k) => availableCustomerKeys.has(k)),
    [props.selectedCustomers, vCustomers, availableCustomerKeys]
  );

  // Auto-städa lokalt state om App inte kontrollerar
  React.useEffect(() => {
    if (!props.selectedCustomers) {
      setLocalSelCustomers((prev) => prev.filter((k) => availableCustomerKeys.has(k)));
    }
  }, [availableCustomerKeys, props.selectedCustomers]);





  /* -------- Modal: Om rapporten -------- */
  const [showInfo, setShowInfo] = useState(false);

  // Rader för modalens faktortabell (hämtas live när modalen öppnas)
  const [ptRows, setPtRows] = useState<Array<{
    id: string;
    label: string;
    medianWeightKg: number;
    co2PerUnitKg: number;
    schemaVersion?: number;
  }>>([]);

  // Ladda productTypes när modalen öppnas
  React.useEffect(() => {
    if (!showInfo) return; // hämta bara när modalen visas
    const db = getFirestore();
    const colRef = collection(db, "productTypes");
    const unsub = onSnapshot(
      query(colRef, orderBy("label")),
      (snap) => {
        const ptList = snap.docs
          .map((d) => {
            const x: any = d.data();
            if (x?.active === false) return null;
            return {
              id: d.id,
              label: typeof x?.label === "string" ? x.label : d.id,
              medianWeightKg: Number(x?.medianWeightKg ?? 0),
              co2PerUnitKg: Number(x?.co2PerUnitKg ?? 0),
              schemaVersion: Number(x?.schemaVersion ?? 1),
            };
          })
          .filter(Boolean) as Array<{
            id: string; label: string; medianWeightKg: number; co2PerUnitKg: number; schemaVersion?: number;
          }>;
        setPtRows(ptList); // ← rätt variabel
      }
    );
    return () => unsub();
  }, [showInfo]);

  // ——— Preview = lås: snapshot-meta av senaste förhandsvisningen ———
  const [snapshotMeta, setSnapshotMeta] = React.useState<{
    timestamp: number;
    count: number;
    filters: { from: string; to: string; customers: string[]; types: string[] };
    itemIds: string[];
    selectionHash: string;
  } | null>(null);

  // Hjälpare för array-jämförelse (ordning spelar roll i våra UI-listor)
  function sameArray(a: string[], b: string[]) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // Hjälpfunktion: SHA-256 → hex-sträng
  async function sha256Hex(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // Markera om preview-snapshot är inaktuell pga filter ändrats
  const isStale = React.useMemo(() => {
    if (!snapshotMeta) return true; // ingen snapshot än
    return (
      snapshotMeta.filters.from !== vFrom ||
      snapshotMeta.filters.to !== vTo ||
      !sameArray(snapshotMeta.filters.customers, vCustomers) ||
      !sameArray(snapshotMeta.filters.types, vTypes)
    );
  }, [snapshotMeta, vFrom, vTo, vCustomers, vTypes]);

  // När en ny preview kommer in (och inte laddar/felar) → ta snapshot = "lås urval"
  React.useEffect(() => {
    if (!props.preview || loading || error) return;

    // Antag att preview innehåller selection.ids (lista av itemIds)
    const ids: string[] = (props.preview as any)?.selection?.ids ?? [];

    const count =
      (props.preview as any)?.totals?.total ??
      (props.preview as any)?.total ??
      ids.length;

    // Beräkna hash på sorterade ids
    sha256Hex(JSON.stringify([...ids].sort())).then((hash) => {
      setSnapshotMeta({
        timestamp: Date.now(),
        count,
        filters: {
          from: vFrom,
          to: vTo,
          customers: [...vCustomers],
          types: [...vTypes],
        },
        itemIds: [...ids],
        selectionHash: hash,
      });
    });
  }, [props.preview, loading, error]);



  // Vi kräver inte längre "per-kund" i preview – backend fixar det vid export.
  const previewDisplay = (preview as any)?.display ?? preview;
  const canExport = !!snapshotMeta && !isStale && !error;

  function normalizeRowsForPdf(display: any, customerOpts: OptCustomer[], selectedCustomerKeys?: string[]) {
    const asNum = (v: any) => Number(v ?? 0);
    const findName = (key: string) =>
      customerOpts.find((c) => String(c.key) === String(key))?.name ?? key ?? "";

    const out: any[] = [];

    // CASE A: display.rows finns redan och HAR kundfält → mappa rakt av
    if (Array.isArray(display?.rows) && display.rows.some((r: any) => r.customerKey || r.customerId || r.customerName || r.customer)) {
      for (const r of display.rows) {
        const customerKey = String(r.customerKey ?? r.customerId ?? r.customer ?? "").trim();
        const customerName = String(r.customerName ?? findName(customerKey)).trim();

        out.push({
          // kund
          customerKey,
          customerName,

          // typ
          productTypeId: String(r.productTypeId ?? r.productType ?? r.id ?? "").trim(),
          productType: String(r.productType ?? r.label ?? r.productTypeId ?? "").trim(),

          // antal/grader/vikter/co2
          total: asNum(r.total ?? r.count),
          A: asNum(r.A), B: asNum(r.B), C: asNum(r.C), D: asNum(r.D), E: asNum(r.E),
          eWasteKg: asNum(r.eWasteKg),
          recycledKg: asNum(r.recycledKg),
          co2Kg: asNum(r.co2Kg),
        });
      }
      return out;
    }

    // CASE B: display.byCustomer eller display.perCustomer (objekt) → flatten
    const byCust = display?.byCustomer ?? display?.perCustomer;
    if (byCust && typeof byCust === "object") {
      for (const key of Object.keys(byCust)) {
        const bucket = byCust[key] ?? {};
        const customerKey = String(key).trim();
        const customerName = String(bucket.customerName ?? findName(customerKey)).trim();

        // B1: bucket.rows som array
        if (Array.isArray(bucket.rows)) {
          for (const r of bucket.rows) {
            out.push({
              customerKey,
              customerName,
              productTypeId: String(r.productTypeId ?? r.productType ?? r.id ?? "").trim(),
              productType: String(r.productType ?? r.label ?? r.productTypeId ?? "").trim(),
              total: asNum(r.total ?? r.count),
              A: asNum(r.A), B: asNum(r.B), C: asNum(r.C), D: asNum(r.D), E: asNum(r.E),
              eWasteKg: asNum(r.eWasteKg),
              recycledKg: asNum(r.recycledKg),
              co2Kg: asNum(r.co2Kg),
            });
          }
        }

        // B2: bucket.perType / bucket.byType som objekt
        const perType = bucket.perType ?? bucket.byType;
        if (perType && typeof perType === "object") {
          for (const typeId of Object.keys(perType)) {
            const r = perType[typeId] ?? {};
            out.push({
              customerKey,
              customerName,
              productTypeId: String(typeId).trim(),
              productType: String(r.label ?? r.productType ?? typeId).trim(),
              total: asNum(r.total ?? r.count),
              A: asNum(r.A), B: asNum(r.B), C: asNum(r.C), D: asNum(r.D), E: asNum(r.E),
              eWasteKg: asNum(r.eWasteKg),
              recycledKg: asNum(r.recycledKg),
              co2Kg: asNum(r.co2Kg),
            });
          }
        }
      }
      return out;
    }
    // CASE C: Endast per-typ (utan kund) → fallback
    if (Array.isArray(display?.rows)) {
      const singleKey = Array.isArray(selectedCustomerKeys) && selectedCustomerKeys.length === 1
        ? String(selectedCustomerKeys[0])
        : "";

      for (const r of display.rows) {
        const customerKey = singleKey;                    // ⬅️ attribuera om 1 kund vald
        const customerName = singleKey ? findName(singleKey) : "";
        out.push({
          customerKey,
          customerName,
          productTypeId: String(r.productTypeId ?? r.productType ?? r.id ?? "").trim(),
          productType: String(r.productType ?? r.label ?? r.productTypeId ?? "").trim(),
          total: asNum(r.total ?? r.count),
          A: asNum(r.A), B: asNum(r.B), C: asNum(r.C), D: asNum(r.D), E: asNum(r.E),
          eWasteKg: asNum(r.eWasteKg),
          recycledKg: asNum(r.recycledKg),
          co2Kg: asNum(r.co2Kg),
        });
      }
      return out;
    }

    return out;
  }

  const [exporting, setExporting] = React.useState(false);


  function buildExportPayload() {
    const snap = snapshotMeta!;
    const pv: any = props.preview ?? {};
    const display = pv?.display ?? pv;

    const normRows: any[] = normalizeRowsForPdf(display, customerOpts, snap.filters.customers);

    const reportFormatVersion = "1.0.0";
    const calculationSchemaVersion = Number(pv?.schemaVersion ?? 1);
    const factorsUsed = display?.factorsUsed ?? pv?.factorsUsed ?? null;

    const sum = (k: string) => normRows.reduce((acc, r) => acc + Number(r?.[k] ?? 0), 0);
    const safeTotals = display?.totals
      ? {
        ...display.totals,
        A: display.totals.A ?? sum("A"),
        B: display.totals.B ?? sum("B"),
        C: display.totals.C ?? sum("C"),
        D: display.totals.D ?? sum("D"),
        E: display.totals.E ?? sum("E"),
      }
      : {
        total: sum("total"),
        eWasteKg: sum("eWasteKg"),
        recycledKg: sum("recycledKg"),
        co2Kg: sum("co2Kg"),
        A: sum("A"), B: sum("B"), C: sum("C"), D: sum("D"), E: sum("E"),
      };

    // Auto-genererade UI-fält (ingen modal)
    const title = autoReportTitle(
      snap.filters.from,
      snap.filters.to,
      snap.filters.customers,
      { customers: customerOpts }
    );
    const description = "";
    const logoUrl = "";
    const policy: "latest" = "latest";

    return {
      title, description, logoUrl, policy,
      manifestPreview: {
        reportFormatVersion,
        calculationSchemaVersion,
        appBuild: (window as any)?.GIT_SHA ?? null,
        createdAt: new Date().toISOString(),
        filtersUsed: {
          from: snap.filters.from,
          to: snap.filters.to,
          customers: [...snap.filters.customers],
          types: [...snap.filters.types],
        },
        selection: {
          ids: [...snap.itemIds],
          count: Number(safeTotals?.total ?? snap.count ?? snap.itemIds.length),
          hash: snap.selectionHash,
        },
        factorsUsed,
        totals: safeTotals,
        rows: normRows,
      },
    };
  }



  // ——— Hämta Convit-logga från public/ (PNG) → bytes ———
  async function fetchConvitLogoPngBytes(): Promise<Uint8Array | null> {
    try {
      // Runtime-URL för public-filen: /branding/logo.png
      const res = await fetch("/branding/logo.png", { cache: "reload" });
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      return new Uint8Array(ab);
    } catch {
      return null;
    }
  }

  // --- Hjälpfunktion: generera PDF (titel + beskrivning + Convit-logga överst) ---

  // Mjuk skandinavisk palett för bakgrunder (ljusa färger)
  const PALETTE = [
    rgb(0.95, 0.98, 1.00), // blå-tint
    rgb(0.96, 0.99, 0.96), // grön-tint
    rgb(1.00, 0.97, 0.95), // varm/korall-tint
    rgb(0.98, 0.96, 1.00), // lila-tint
  ];


  async function generateReportPdf(manifestJson: any) {
    const num = (v: any, def = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : def;
    };

    try {
      console.debug("[PDF] create doc");
      const pdfDoc = await PDFDocument.create();
      let page: PDFPage = pdfDoc.addPage([595, 842]); // A4
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      let yCursor = 800;

      // 1) Logga (valfritt)
      try {
        console.debug("[PDF] logo");
        const logoBytes = await fetchConvitLogoPngBytes();
        if (logoBytes) {
          const png = await pdfDoc.embedPng(logoBytes);
          const maxW = 140;
          const scale = Math.min(1, maxW / num(png.width, 1));
          const drawW = num(png.width * scale, 0);
          const drawH = num(png.height * scale, 0);
          if (drawW > 0 && drawH > 0) {
            page.drawImage(png, { x: 50, y: yCursor - drawH, width: drawW, height: drawH });
            yCursor = yCursor - drawH - 16;
          }
        }
      } catch (e) {
        console.error("[PDF] logo failed", e);
        // fortsätt ändå
      }

      // 2) Titel + beskrivning
      try {
        console.debug("[PDF] title/desc");
        const title = String(manifestJson?.ui?.title || "Klimatrapport");
        page.drawText(title, { x: 50, y: yCursor, size: 24, font, color: rgb(0, 0.53, 0.71) });
        yCursor -= 30;

        const desc = String(manifestJson?.ui?.description || "");
        if (desc) {
          // enkel radbrytning (pdf-lib wrappar inte automatiskt säkert)
          const maxWidth = 500;
          const words = desc.split(/\s+/);
          let line = "";
          const lineH = 14;
          words.forEach((w) => {
            const test = line ? line + " " + w : w;
            const width = font.widthOfTextAtSize(test, 12);
            if (width > maxWidth) {
              page.drawText(line, { x: 50, y: yCursor, size: 12, font, color: rgb(0, 0, 0) });
              yCursor -= lineH;
              line = w;
            } else {
              line = test;
            }
          });
          if (line) {
            page.drawText(line, { x: 50, y: yCursor, size: 12, font, color: rgb(0, 0, 0) });
            yCursor -= lineH;
          }
          yCursor -= 10;
        }
      } catch (e) {
        console.error("[PDF] title/desc failed", e);
        throw new Error("PDF: title/desc");
      }

      // 3) KPI-box
      try {
        console.debug("[PDF] KPI box");
        const totals = manifestJson?.totals ?? {};
        const enheter = num(totals?.total ?? manifestJson?.selection?.count, 0);
        const eWasteKg = num(totals?.eWasteKg, 0);
        const recycledKg = num(totals?.recycledKg, 0);
        const co2Kg = num(totals?.co2Kg, 0);

        const boxX = 50;
        const boxW = 495;
        const boxH = 55;
        let boxY = yCursor - 6;
        const colW = boxW / 4;

        page.drawRectangle({
          x: boxX, y: boxY - boxH, width: boxW, height: boxH,
          borderWidth: 0.5, color: rgb(1, 1, 1), borderColor: rgb(0.85, 0.85, 0.9),
        });

        // --- Färgade bakgrundsrutor per KPI (läggs in FÖRE texter) ---
        for (let i = 0; i < 4; i++) {
          page.drawRectangle({
            x: boxX + i * colW + 2,     // liten inner-marginal
            y: boxY - boxH + 2,
            width: colW - 4,
            height: boxH - 4,
            color: PALETTE[i % PALETTE.length],
          });
        }

        // (valfritt) tunn outline runt hela KPI-blocket (behåll din befintliga om du vill)
        page.drawRectangle({
          x: boxX, y: boxY - boxH, width: boxW, height: boxH,
          borderWidth: 0.5, color: rgb(1, 1, 1), borderColor: rgb(0.85, 0.85, 0.9),
        });

        const drawKpi = (i: number, label: string, value: string) => {
          const x = boxX + i * colW;
          page.drawText(label, { x: x + 10, y: boxY - 16, size: 9.5, font, color: rgb(0.35, 0.35, 0.4) }); // 10 → 9.5, -18 → -16
          page.drawText(value, { x: x + 10, y: boxY - 44, size: 18, font, color: rgb(0.05, 0.2, 0.3) });   // 20 → 18, -48 → -44
        };
        const kg = (n: number) => `${Math.round(num(n, 0))} kg`;

        drawKpi(0, "Enheter", String(Math.round(enheter)));
        drawKpi(1, "Undviket e-waste", kg(eWasteKg));
        drawKpi(2, "Återvunnet avfall", kg(recycledKg));
        drawKpi(3, "Undvikna CO2-utsläpp", kg(co2Kg));

        yCursor = boxY - boxH - 12;
      } catch (e) {
        console.error("[PDF] KPI failed", e);
        throw new Error("PDF: KPI");
      }

      // 4) Fot
      try {
        console.debug("[PDF] footer");
        const footY = 40;
        const hash = String(manifestJson?.selection?.hash ?? "");
        const policy = String(manifestJson?.factorPolicy ?? "-");
        const from = String(manifestJson?.filtersUsed?.from ?? "");
        const to = String(manifestJson?.filtersUsed?.to ?? "");
        const selCount = num(manifestJson?.selection?.count ?? manifestJson?.totals?.total, 0);

        page.drawLine({
          start: { x: 50, y: footY + 10 },
          end: { x: 545, y: footY + 10 },
          thickness: 0.5,
          color: rgb(0.85, 0.85, 0.9),
        });

        const footLeft =
          `Urval: ${selCount} enheter • Hash: ${hash.slice(0, 8)}…` +
          ` • Policy: ${policy}${from && to ? ` • Intervall: ${from}–${to}` : ""}`;

        page.drawText(footLeft, { x: 50, y: footY, size: 9, font, color: rgb(0.35, 0.35, 0.4) });
      } catch (e) {
        console.error("[PDF] footer failed", e);
        throw new Error("PDF: footer");
      }

      // ===== Enspalt under KPI (fullbredd + auto-sidbryt) =====
      {
        const pageW = 595, marginX = 50;
        const usableW = pageW - marginX - marginX;
        const minY = 80;
        let y = yCursor;

        // EXTRA LUFT EFTER KPI:
        y -= 16;

        // Gemensamma mått/spacing
        const TABLE_TOTAL_W = usableW;   // exakt samma bredd för alla tabeller
        const SECTION_GAP = 38;       // var 20
        const PAD_H = 3;         // horisontell padding i celler

        // Hjälpare
        const line = (x1: number, y1: number, x2: number, y2: number, w = 0.5) =>
          page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: w, color: rgb(0.85, 0.85, 0.9) });

        const drawText = (txt: string, x: number, yTop: number, size = 10, color = rgb(0.05, 0.2, 0.3)) =>
          page.drawText(txt, { x, y: yTop, size, font, color });

        // ALLT NUMERISKT → HÖGERSTÄLLT
        const drawRight = (txt: string, xLeft: number, colW: number, yTop: number, size = 10, pad = PAD_H, color = rgb(0.05, 0.2, 0.3)) => {
          const w = font.widthOfTextAtSize(txt, size);
          page.drawText(txt, { x: xLeft + colW - pad - w, y: yTop, size, font, color });
        };
        const drawRightBold = (txt: string, xLeft: number, colW: number, yTop: number, size = 10, pad = PAD_H) => {
          const w = font.widthOfTextAtSize(txt, size);
          page.drawText(txt, { x: xLeft + colW - pad - w, y: yTop, size, font, color: rgb(0, 0, 0) });
        };

        const wrapText = (text: string, maxW: number, size: number) => {
          const words = String(text).split(/\s+/), rows: string[] = [];
          let buf = "";
          words.forEach(w => {
            const t = buf ? buf + " " + w : w;
            if (font.widthOfTextAtSize(t, size) > maxW) { if (buf) rows.push(buf); buf = w; } else buf = t;
          });
          if (buf) rows.push(buf);
          return rows;
        };

        const fmtInt = (n: any) => String(Math.round(Number(n || 0)));
        const fmtKg = (n: any) => String(Math.round(Number(n || 0)));

        // Sidbrytare
        const ensureSpace = (need: number) => {
          if (y - need < minY) {
            const newPage = pdfDoc.addPage([595, 842]);
            page = newPage;
            y = 800;
          }
        };

        // --- Kolumnhjälpare: håll EXAKT TABLE_TOTAL_W utan overflow ---
        type Col = { label: string; width: number; align: "left" | "right" };

        const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

        // Returnerar kolumner där sista kolumnen anpassas så att TOTAL = TABLE_TOTAL_W
        const withDynamicLast = (fixed: Omit<Col, "align">[] & { label: string; width: number }[], lastLabel: string, firstTextColIndex = 0): Col[] => {
          const fixedWidth = sum(fixed.map(c => c.width));
          let lastWidth = TABLE_TOTAL_W - fixedWidth;
          const cols: Col[] = fixed.map((c, i) => ({ label: c.label, width: c.width, align: i === firstTextColIndex ? "left" : "right" }));

          if (lastWidth >= 0) {
            cols.push({ label: lastLabel, width: lastWidth, align: "right" });
            return cols;
          } else {
            // overflow → krymp första textkolumnen (min 120 px)
            const MIN_TEXT_W = 120;
            const needReduce = -lastWidth;
            const textW = cols[firstTextColIndex].width;
            const canReduce = Math.max(0, textW - MIN_TEXT_W);
            const reduceBy = Math.min(needReduce, canReduce);
            cols[firstTextColIndex].width = textW - reduceBy;
            lastWidth = TABLE_TOTAL_W - (fixedWidth - reduceBy);
            cols.push({ label: lastLabel, width: Math.max(0, lastWidth), align: "right" });
            return cols;
          }
        };

        const drawHeaderAligned = (cols: Col[], fontSize = 9) => {
          const headBaseline = y;
          let x = marginX;
          cols.forEach(c => {
            const txt = c.label;
            const w = font.widthOfTextAtSize(txt, fontSize);
            const hx = (c.align === "right") ? (x + c.width - PAD_H - w) : (x + PAD_H);
            page.drawText(txt, { x: hx, y: headBaseline - 12, size: fontSize, font, color: rgb(0.35, 0.35, 0.4) });
            x += c.width;
          });
          line(marginX, headBaseline - 14, marginX + TABLE_TOTAL_W, headBaseline - 14);
          y = headBaseline - 16; // radstart
        };

        // Tvåradig header för utvalda kolumner
        const drawHeaderAlignedWrapped = (
          cols: Col[],
          wraps: Record<number, [string, string]>,
          opts?: { fontSize1?: number; fontSize2?: number; gap?: number }
        ) => {
          const fs1 = opts?.fontSize1 ?? 9;
          const fs2 = opts?.fontSize2 ?? 8.8;
          const gap = opts?.gap ?? 2;

          const headTop = y;
          ensureSpace(fs1 + fs2 + gap + 18);

          let x = marginX;
          cols.forEach((c, i) => {
            const firstY = headTop - 10;
            const secondY = firstY - (fs1 + gap);

            if (wraps[i]) {
              const [l1, l2] = wraps[i];
              const w1 = font.widthOfTextAtSize(l1, fs1);
              const w2 = font.widthOfTextAtSize(l2, fs2);
              let x1 = x + PAD_H, x2 = x + PAD_H;
              if (c.align === "right") {
                x1 = x + c.width - PAD_H - w1;
                x2 = x + c.width - PAD_H - w2;
              }
              page.drawText(l1, { x: x1, y: firstY, size: fs1, font, color: rgb(0.35, 0.35, 0.4) });
              page.drawText(l2, { x: x2, y: secondY, size: fs2, font, color: rgb(0.35, 0.35, 0.4) });
            } else {
              const txt = c.label;
              const w = font.widthOfTextAtSize(txt, fs1);
              const hx = (c.align === "right") ? (x + c.width - PAD_H - w) : (x + PAD_H);
              page.drawText(txt, { x: hx, y: headTop - 12, size: fs1, font, color: rgb(0.35, 0.35, 0.4) });
            }
            x += c.width;
          });

          const sepY = headTop - (fs1 + fs2 + gap + 12);
          line(marginX, sepY, marginX + TABLE_TOTAL_W, sepY);
          y = sepY - 2;
        };

        // === Blockvis höjdmätning ===
        const TR_H = 14;
        const T1_HEADER_H = 24; // tvåradig
        const T2_HEADER_H = 16; // enkelradig
        const TOTAL_ROW_H = 14;
        const GAP_BETWEEN_TABLES = SECTION_GAP;
        const GAP_BEFORE_BLOCK = 28;  // var 10
        const CUSTOMER_HEADER_H = 31;

        const estimateTable1Height = (rowCount: number) => T1_HEADER_H + rowCount * TR_H + TOTAL_ROW_H;
        const estimateTable2Height = (rowCount: number) => T2_HEADER_H + rowCount * TR_H + TOTAL_ROW_H;
        const estimateCustomerBlockHeight = (rowsT1: number, rowsT2: number) =>
          GAP_BEFORE_BLOCK + CUSTOMER_HEADER_H + estimateTable1Height(rowsT1) + GAP_BETWEEN_TABLES + estimateTable2Height(rowsT2);

        const ensureBlockFits = (needed: number) => {
          if (y - needed < minY) {
            const newPage = pdfDoc.addPage([595, 842]);
            page = newPage;
            y = 800;
          }
        };

        // === Rendera ett helt kundblock (huvud + tabell1 + tabell2) på EN sida, eller "ingen data" ===
        const renderCustomerBlock = (cust: { name?: string; id?: string; key?: string }, rowsAll: any[], factors: any) => {
          // Filtrera rader för kunden (på key/id/namn med OR)
          const norm = (s: any) => String(s ?? "").trim().toLowerCase();

          const forCust = (rowsAll || []).filter(r => {
            const rKey = norm(r.customerKey);
            const rId = norm(r.customerId);
            const rNm = norm(r.customerName || r.customer);

            const cKey = norm(cust.key);
            const cId = norm(cust.id);
            const cNm = norm(cust.name);

            return (
              (cKey && rKey && rKey === cKey) ||
              (cId && rId && rId === cId) ||
              (cNm && rNm && rNm === cNm)
            );
          });



          const t1Rows = forCust.filter(r => {
            const anyCount = Number(r.total ?? 0) > 0;
            const anyMass = Number(r.eWasteKg ?? 0) > 0 || Number(r.recycledKg ?? 0) > 0;
            const anyCo2 = Number(r.co2Kg ?? 0) > 0;
            return anyCount || anyMass || anyCo2;
          });

          const t2Rows = forCust.filter(r => {
            const refurbished = Number(r.A ?? 0) + Number(r.B ?? 0) + Number(r.C ?? 0) + Number(r.D ?? 0);
            const co2Total = Number(r?.co2Kg ?? 0);
            return refurbished > 0 || co2Total > 0;
          });

          // --- Om helt utan data: visa kundhuvud + snygg info-rad
          if (t1Rows.length === 0 && t2Rows.length === 0) {
            const NO_DATA_H = GAP_BEFORE_BLOCK + CUSTOMER_HEADER_H + 24; // header + badge
            ensureBlockFits(NO_DATA_H);

            // Luft före block
            y -= GAP_BEFORE_BLOCK;

            // Kundhuvud (återanvänd helpern)
            drawCustomerHeader(cust.name || cust.key || "Okänd kund");

            // Ljus inramad “ingen data”-rad
            const badgeH = 18;
            page.drawRectangle({
              x: marginX,
              y: y - badgeH,
              width: TABLE_TOTAL_W,
              height: badgeH,
              color: rgb(0.98, 0.985, 0.995),
              borderWidth: 0.5,
              borderColor: rgb(0.9, 0.92, 0.96),
            });
            page.drawText("Ingen data i valt intervall för denna kund.", {
              x: marginX + 8, y: y - badgeH + 4, size: 10, font, color: rgb(0.05, 0.2, 0.3),
            });
            y -= (badgeH + 6); // liten luft efter

            return;
          }

          // --- Compact mode (shrink-to-fit) om ett helt block inte får plats på en sida ---
          const pageMaxUsable = 800 - minY; // en helt ny sida har y=800 ned till minY
          let compact = false;

          // Standard-metrik
          let rowH = TR_H;
          let head1H = T1_HEADER_H;
          let head2H = T2_HEADER_H;
          let totalRowH = TOTAL_ROW_H;

          // Typsnittsstorlekar vid standard/compact
          let fsText = 9.5;     // rader (värden)
          let fsHead1 = 9.0;    // header rad 1
          let fsHead2 = 8.8;    // header rad 2 (wrap-kolumner)
          let fsHeadSimple = 9; // enkel header (tabell 2)

          const needHNormal = estimateCustomerBlockHeight(t1Rows.length, t2Rows.length);

          // Om ett nytt blad inte räcker ens i normal storlek → aktivera compact
          if (needHNormal > pageMaxUsable) {
            compact = true;
            rowH = 12;            // istället för 14
            head1H = 20;          // tvåradig header lite kompaktare
            head2H = 14;          // enkel header lite kompaktare
            totalRowH = 12;

            fsText = 8.8;
            fsHead1 = 8.6;
            fsHead2 = 8.2;
            fsHeadSimple = 8.6;
          }

          // Ny estimator som matchar aktuella metrik
          const estimateBlockWithMetrics = (rows1: number, rows2: number) =>
            GAP_BEFORE_BLOCK + CUSTOMER_HEADER_H +
            (head1H + rows1 * rowH + totalRowH) +
            GAP_BETWEEN_TABLES +
            (head2H + rows2 * rowH + totalRowH);



          // Blocket måste rymmas på en sida (med ev. compact-metrik)
          const needH = estimateBlockWithMetrics(t1Rows.length, t2Rows.length);
          ensureBlockFits(needH);
          y -= GAP_BEFORE_BLOCK;

          // Kundhuvud
          drawCustomerHeader(cust.name || cust.key || "Okänd kund");

          // Tabell 1
          {
            drawText("E-waste & återvunnet per produkttyp", marginX, y, 12, rgb(0, 0, 0));
            y -= 6;

            const cols1 = withDynamicLast([
              { label: "Typ", width: 180 },
              { label: "A", width: 24 },
              { label: "B", width: 24 },
              { label: "C", width: 24 },
              { label: "D", width: 24 },
              { label: "E", width: 24 },
              { label: "Antal", width: 50 },
              { label: "Undviket e-waste (kg)", width: 96 },
            ], "Återvunnet (kg)");

            drawHeaderAlignedWrapped(
              cols1 as any,
              { 7: ["Undviket", "e-waste (kg)"], 8: ["Återvunnet", "(kg)"] },
              { fontSize1: fsHead1, fontSize2: fsHead2, gap: 2 }
            );

            const trH = rowH;
            t1Rows.forEach(r => {
              ensureSpace(trH + 2);
              let cx = marginX;

              // kolumn 1 (text)
              page.drawText(String(r.productType ?? r.label ?? ""), { x: cx + PAD_H, y: y - trH + 3, size: fsText, font, color: rgb(0.05, 0.2, 0.3) });
              cx += cols1[0].width;

              // numeriska
              [fmtInt(r.A), fmtInt(r.B), fmtInt(r.C), fmtInt(r.D), fmtInt(r.E), fmtInt(r.total), fmtKg(r.eWasteKg), fmtKg(r.recycledKg)]
                .forEach((txt, i) => {
                  const col = cols1[i + 1];
                  drawRight(txt, cx, col.width, y - trH + 3, fsText);
                  cx += col.width;
                });

              line(marginX, y - trH, marginX + TABLE_TOTAL_W, y - trH, 0.3);
              y -= trH;
            });

            // totals
            const t1 = t1Rows.reduce((acc, r) => {
              const add = (k: string, v: number) => (acc[k] = (acc[k] || 0) + Number(v || 0));
              ["A", "B", "C", "D", "E", "total", "eWasteKg", "recycledKg"].forEach(k => add(k, r[k]));
              return acc;
            }, {} as any);

            ensureSpace(totalRowH + 2);
            page.drawRectangle({
              x: marginX, y: y - totalRowH, width: TABLE_TOTAL_W, height: totalRowH, color: rgb(0.965, 0.975, 0.99)
            });
            let cx = marginX;
            page.drawText("Totalt", { x: cx + PAD_H, y: y - totalRowH + 3, size: fsText, font, color: rgb(0, 0, 0) });
            cx += cols1[0].width;

            [fmtInt(t1.A), fmtInt(t1.B), fmtInt(t1.C), fmtInt(t1.D), fmtInt(t1.E), fmtInt(t1.total), fmtKg(t1.eWasteKg), fmtKg(t1.recycledKg)]
              .forEach((txt, i) => {
                const col = cols1[i + 1];
                drawRightBold(txt, cx, col.width, y - totalRowH + 3, fsText);
                cx += col.width;
              });
            line(marginX, y - totalRowH, marginX + TABLE_TOTAL_W, y - totalRowH, 0.5);
            y -= totalRowH;
          }

          // Gap
          y -= GAP_BETWEEN_TABLES;

          // Tabell 2
          {
            drawText("CO2-equivalent emissions avoided", marginX, y, 12, rgb(0, 0, 0));
            y -= 6;

            const cols2 = withDynamicLast([
              { label: "Produktgrupp", width: 220 },
              { label: "Refurbished (A–D)", width: 130 },
              { label: "CO2 kg/enhet", width: 100 },
            ], "Totalt (kg)", 0);

            drawHeaderAligned(cols2, fsHeadSimple);
            const trH = rowH;

            t2Rows.forEach(r => {
              ensureSpace(trH + 2);

              const refurbished = Number(r.A ?? 0) + Number(r.B ?? 0) + Number(r.C ?? 0) + Number(r.D ?? 0);

              // robust faktor-lookup + fallback
              const key1 = String(r.productTypeId ?? r.productType ?? "").toLowerCase();
              let f: any = (manifestJson?.factorsUsed ?? {})[key1] ?? (manifestJson?.factorsUsed ?? {})[String(r.productType ?? "").toLowerCase()] ?? null;
              if (!f) {
                const target = String(r.productType ?? "").toLowerCase();
                const match = Object.values(manifestJson?.factorsUsed || {}).find((v: any) => String(v?.label ?? "").toLowerCase() === target);
                if (match) f = match;
              }
              let co2PerDevice = Number(f?.co2PerUnitKg ?? f?.co2 ?? 0);
              if (!co2PerDevice && refurbished > 0 && Number(r?.co2Kg ?? 0) > 0) {
                co2PerDevice = Number(r.co2Kg) / refurbished;
              }
              const co2Total = Number(r?.co2Kg ?? (refurbished * co2PerDevice));

              let cx = marginX;
              page.drawText(String(r.productType ?? r.label ?? ""), { x: cx + PAD_H, y: y - trH + 3, size: fsText, font, color: rgb(0.05, 0.2, 0.3) });
              cx += cols2[0].width;

              [fmtInt(refurbished), fmtKg(co2PerDevice), fmtKg(co2Total)].forEach((txt, i) => {
                const col = cols2[i + 1];
                drawRight(txt, cx, col.width, y - trH + 3, fsText);
                cx += col.width;
              });

              line(marginX, y - trH, marginX + TABLE_TOTAL_W, y - trH, 0.3);
              y -= trH;
            });

            // totals
            const tt = t2Rows.reduce((acc, r) => {
              const refurbished = Number(r.A ?? 0) + Number(r.B ?? 0) + Number(r.C ?? 0) + Number(r.D ?? 0);
              acc.ref = (acc.ref || 0) + refurbished;
              acc.co2 = (acc.co2 || 0) + Number(r?.co2Kg ?? 0);
              return acc;
            }, {} as any);

            ensureSpace(totalRowH + 2);
            page.drawRectangle({
              x: marginX, y: y - totalRowH, width: TABLE_TOTAL_W, height: totalRowH, color: rgb(0.965, 0.975, 0.99)
            });
            let cx2 = marginX;
            page.drawText("Total CO2 avoided", { x: cx2 + PAD_H, y: y - totalRowH + 3, size: fsText, font, color: rgb(0, 0, 0) });
            cx2 += cols2[0].width;
            [fmtInt(tt.ref || 0), "", fmtKg(tt.co2 || 0)].forEach((txt, i) => {
              const col = cols2[i + 1];
              drawRightBold(txt || "", cx2, col.width, y - totalRowH + 3, fsText);
              cx2 += col.width;
            });
            line(marginX, y - totalRowH, marginX + TABLE_TOTAL_W, y - totalRowH, 0.5);
            y -= totalRowH;
          }
        };

        // ===== Multi-kund: samla, sortera, rendera block =====
        const allRows: any[] = Array.isArray(manifestJson?.rows) ? manifestJson.rows : [];
        const hasT1Row = (r: any) => Number(r.total ?? 0) > 0 || Number(r.eWasteKg ?? 0) > 0 || Number(r.recycledKg ?? 0) > 0 || Number(r.co2Kg ?? 0) > 0;
        const hasT2Row = (r: any) => (Number(r.A ?? 0) + Number(r.B ?? 0) + Number(r.C ?? 0) + Number(r.D ?? 0)) > 0 || Number(r?.co2Kg ?? 0) > 0;

        type Cust = { key: string; name?: string; id?: string };
        const selectedKeys: string[] = Array.isArray(manifestJson?.filtersUsed?.customers) ? manifestJson.filtersUsed.customers : [];

        const byKey: Map<string, Cust> = new Map();
        const dataFlag: Map<string, { t1: boolean; t2: boolean }> = new Map();

        // från rader
        for (const r of allRows) {
          const key = String(r.customerKey ?? r.customerId ?? r.customer ?? "").trim();
          if (!key) continue;
          const name = String(r.customerName ?? r.customer ?? key).trim();
          if (!byKey.has(key)) byKey.set(key, { key, name, id: String(r.customerId ?? "").trim() || undefined });

          const f = dataFlag.get(key) ?? { t1: false, t2: false };
          if (hasT1Row(r)) f.t1 = true;
          if (hasT2Row(r)) f.t2 = true;
          dataFlag.set(key, f);
        }

        // från urval (om vald men saknar rader)
        for (const k of selectedKeys) {
          if (!byKey.has(k)) {
            // Försök hitta visningsnamn från customerOpts, annars lämna tomt
            const optName = (customerOpts || []).find(c => String(c.key) === String(k))?.name;
            byKey.set(k, { key: k, name: optName || undefined });
            dataFlag.set(k, { t1: false, t2: false });
          }
        }

        const allCustomers: Cust[] = Array.from(byKey.values());
        const withData: Cust[] = [];
        const withoutData: Cust[] = [];
        for (const c of allCustomers) {
          const f = dataFlag.get(c.key) ?? { t1: false, t2: false };
          if (f.t1 || f.t2) withData.push(c); else withoutData.push(c);
        }
        withData.sort((a, b) =>
          (a.name ?? a.key ?? "").localeCompare((b.name ?? b.key ?? ""), "sv")
        );
        withoutData.sort((a, b) =>
          (a.name ?? a.key ?? "").localeCompare((b.name ?? b.key ?? ""), "sv")
        );

        // --- Helper: kundhuvud (namn + period + tunn separator) ---
        // --- Kundhuvud: bakgrundsband över full bredd + extra luft under ---
        const drawCustomerHeader = (custName: string) => {
          const periodFrom = String(manifestJson?.filtersUsed?.from ?? "");
          const periodTo = String(manifestJson?.filtersUsed?.to ?? "");

          const HEADER_BAND_H = 36;        // höjd på bandet
          const HEADER_GAP_AFTER = 14;     // extra luft efter bandet

          const bandTop = y; // nuvarande topp

          // Bandets bakgrund (full tabellbredd)
          page.drawRectangle({
            x: marginX,
            y: bandTop - HEADER_BAND_H + 6,
            width: TABLE_TOTAL_W,
            height: HEADER_BAND_H,
            color: rgb(0.975, 0.98, 0.995),
            borderWidth: 0.5,
            borderColor: rgb(0.90, 0.92, 0.96),
          });

          // Kundnamn
          page.drawText(custName || "Okänd kund", {
            x: marginX + 10,
            y: bandTop - 12,
            size: 14,
            font,
            color: rgb(0, 0, 0),
          });

          // Period
          page.drawText(
            periodFrom && periodTo ? `Period: ${periodFrom}–${periodTo}` : `Period: –`,
            { x: marginX + 10, y: bandTop - 24, size: 10, font, color: rgb(0.35, 0.35, 0.4) }
          );

          // Tunn linje under bandet
          page.drawLine({
            start: { x: marginX, y: bandTop - HEADER_BAND_H + 6 },
            end: { x: marginX + TABLE_TOTAL_W, y: bandTop - HEADER_BAND_H + 6 },
            thickness: 0.4,
            color: rgb(0.85, 0.85, 0.9),
          });

          // Flytta ner y så att det blir luft innan rubriken “E-waste …”
          y = bandTop - HEADER_BAND_H - HEADER_GAP_AFTER;
        };



        const ordered = [...withData, ...withoutData];
        for (const cust of ordered) {
          renderCustomerBlock(cust, allRows, manifestJson?.factorsUsed ?? {});
        }

        // ===== “Om denna rapport” sist (på samma sida om plats finns) =====
        const renderAbout = () => {
          const section = () => {
            drawText("Om denna rapport", marginX, y, 12, rgb(0, 0, 0));
            y -= 18;

            wrapText("Denna sida sammanfattar e-waste/återvinning per typ och CO2 som undvikits tack vare återbruk (A–D).", usableW, 10)
              .forEach(r => { ensureSpace(12); drawText(r, marginX, y); y -= 12; });

            y -= 4;
            drawText("Definitioner", marginX, y, 11, rgb(0, 0, 0)); y -= 14;
            [
              "Undviket e-waste: A–D × medianvikt per typ.",
              "Återvunnet avfall: E × medianvikt per typ.",
              "CO2 avoided: återbrukade enheter × CO2-faktor per typ."
            ].forEach(b => {
              wrapText("• " + b, usableW, 10).forEach(r => { ensureSpace(12); drawText(r, marginX, y); y -= 12; });
            });

            y -= 4;
            drawText("Policy & faktorer", marginX, y, 11, rgb(0, 0, 0)); y -= 14;
            const from = String(manifestJson?.filtersUsed?.from ?? "");
            const to = String(manifestJson?.filtersUsed?.to ?? "");
            const policy = String(manifestJson?.factorPolicy ?? "-");
            const p2 = `Policy: ${policy}. Intervall: ${from && to ? `${from}–${to}` : "–"}. Faktorer (medianvikt, CO2/enhet) är frysta i denna export.`;
            wrapText(p2, usableW, 10).forEach(r => { ensureSpace(12); drawText(r, marginX, y); y -= 12; });
          };

          const ABOUT_MIN_H = 120;
          if (y - ABOUT_MIN_H < minY) {
            const newPage = pdfDoc.addPage([595, 842]);
            page = newPage;
            y = 800;
          }
          section();
        };

        // mjuk luft före "Om denna rapport"
        const GAP_BEFORE_ABOUT = 14;
        if (y - GAP_BEFORE_ABOUT < minY) {
          const newPage = pdfDoc.addPage([595, 842]);
          page = newPage;
          y = 800;
        }
        y -= GAP_BEFORE_ABOUT;

        renderAbout();


        // Avsluta blocket
        yCursor = y;
      }











      // 6) Sidnummer
      try {
        console.debug("[PDF] page numbers");
        const pages = pdfDoc.getPages();
        const total = pages.length;
        const leftX = 50, rightX = 545, y = 30;
        pages.forEach((p, idx) => {
          p.drawLine({ start: { x: leftX, y: y + 10 }, end: { x: rightX, y: y + 10 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.9) });
          const text = `Sida ${idx + 1} av ${total}`;
          p.drawText(text, { x: rightX - (text.length * 5.2), y, size: 9, font, color: rgb(0.35, 0.35, 0.4) });
        });
      } catch (e) {
        console.error("[PDF] page numbers failed", e);
        throw new Error("PDF: page numbers");
      }

      console.debug("[PDF] save");
      const pdfBytes = await pdfDoc.save();

      // Ladda ner
      const title = String(manifestJson?.ui?.title || "Klimatrapport");
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[PDF] generation failed (top)", err);
      throw err; // bubbla upp så handleExportClick kan visa alert
    }
  }





  async function handleExportClick() {
    if (exporting || !canExport) return;
    setExporting(true);

    const payload = buildExportPayload();

    // små hjälpare
    const asMsg = (err: unknown) =>
      err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);

    try {
      console.debug("[EXPORT] start");

      // Org-id enligt din befintliga logik (används i PDF/manifestvisning – inte för ID-beräkning längre)
      const orgId =
        (window as any)?.ORG_ID ||
        (window as any)?.goldwasserOrgId ||
        "org";

      // Behåll tidigare urvalshash (från preview-snapshoten)
      const selectionHash =
        payload.manifestPreview?.selection?.hash ?? (snapshotMeta?.selectionHash ?? "");

      // ===== 1) Hämta server-side preview (per kund) =====
      const PREVIEW_URL = BUILD_CO2_PREVIEW_URL;

      // Hämta filter direkt från låsta fält i UI (vFrom/vTo/vCustomers/vTypes),
      // fallback till det som ligger i payload.manifestPreview om de saknas.
      const fromDate =
        (typeof (vFrom as any) === "string" && vFrom) ||
        (payload.manifestPreview as any)?.filtersUsed?.from ||
        (payload.manifestPreview as any)?.filters?.fromDate || "";
      const toDate =
        (typeof (vTo as any) === "string" && vTo) ||
        (payload.manifestPreview as any)?.filtersUsed?.to ||
        (payload.manifestPreview as any)?.filters?.toDate || "";
      const customerIds: string[] =
        (Array.isArray(vCustomers) && vCustomers.length ? vCustomers : undefined) ||
        (payload.manifestPreview as any)?.filtersUsed?.customers ||
        (payload.manifestPreview as any)?.filters?.customerIds || [];
      const productTypeIds: string[] | undefined =
        (Array.isArray(vTypes) && vTypes.length ? vTypes : undefined) ||
        (payload.manifestPreview as any)?.filtersUsed?.types ||
        (payload.manifestPreview as any)?.filters?.productTypeIds || undefined;

      const serverPayload = {
        fromDate,
        toDate,
        basis: "completedAt" as const,
        customerIds,
        productTypeIds: productTypeIds && productTypeIds.length ? productTypeIds : undefined,
        factorPolicy: "latest" as const,
      };

      console.debug("[EXPORT] POST buildCO2Preview", serverPayload);
      const res = await fetch(PREVIEW_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serverPayload),
        credentials: "omit",
        mode: "cors",
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`buildCO2Preview failed: ${res.status} ${res.statusText} ${txt}`);
      }
      const serverPreview = await res.json() as {
        filters: { fromDate: string; toDate: string; basis: "completedAt"; customerIds: string[]; productTypeIds?: string[]; factorPolicy?: "latest" };
        customersIncluded: Record<string, string>;
        factorsUsed: Record<string, { label: string; medianWeightKg: number; co2PerUnitKg: number; schemaVersion: number }>;
        perCustomer: Array<{
          customerId: string;
          customerName: string;
          rows: Array<{
            productTypeId: string;
            productType: string;
            A: number; B: number; C: number; D: number; E: number;
            total: number;
            eWasteKg: number;
            recycledKg: number;
            co2Kg: number;
          }>;
          totals: { A: number; B: number; C: number; D: number; E: number; eWasteKg: number; recycledKg: number; co2Kg: number; total: number };
        }>;
        grandTotals: { A: number; B: number; C: number; D: number; E: number; eWasteKg: number; recycledKg: number; co2Kg: number; total: number };
        selection: { itemIds: string[] };
      };

      // ===== 2) Bygg rader (flatten per kund × typ) =====
      const builtRows = serverPreview.perCustomer.flatMap((bucket) =>
        bucket.rows.map((r) => ({
          customerId: bucket.customerId,
          customerName: bucket.customerName,
          productTypeId: r.productTypeId,
          productType: r.productType,
          total: r.total,
          A: r.A, B: r.B, C: r.C, D: r.D, E: r.E,
          eWasteKg: r.eWasteKg,
          recycledKg: r.recycledKg,
          co2Kg: r.co2Kg,
        }))
      );

      // ===== 3) Manifest till PDF (behåll metadata + ersätt data med serverns) =====
      const manifestJson = {
        ...payload.manifestPreview,
        orgId,
        factorPolicy: payload.policy,
        ui: {
          title: payload.title,
          description: payload.description,
          logoUrl: payload.logoUrl,
        },
        filtersUsed: {
          from: serverPreview.filters.fromDate,
          to: serverPreview.filters.toDate,
          customers: [...customerIds],
          types: productTypeIds ? [...productTypeIds] : [],
        },
        factorsUsed: serverPreview.factorsUsed,
        totals: serverPreview.grandTotals,
        rows: builtRows,
        selection: {
          ids: serverPreview.selection.itemIds,
          count: Number(serverPreview.grandTotals?.total ?? serverPreview.selection.itemIds.length),
          hash: selectionHash,
        },
      };

      // ===== 4) Generera PDF lokalt (trigga nedladdning, släpp UI snabbt) =====
      console.debug("[EXPORT] generating PDF locally…");
      try {
        await Promise.race([
          (async () => { await generateReportPdf(manifestJson); })(),
          // om generateReportPdf inte resolve:ar (a.click()), släpp UI efter kort delay
          new Promise<void>((resolve) => setTimeout(resolve, 400)),
        ]);
        console.debug("[EXPORT] PDF download triggered");
      } catch (e) {
        const msg = e instanceof Error ? (e.stack || e.message) : typeof e === "string" ? e : JSON.stringify(e);
        console.error("[EXPORT] PDF generation failed:", e);
        alert("PDF-generering misslyckades:\n\n" + msg);
        return;
      }

      // 🔓 Släpp knappen direkt – manifest-sparandet körs i bakgrunden via Cloud Function
      setExporting(false);

      // ===== 5) Spara manifest i bakgrunden via Cloud Function =====
      void (async () => {
        try {
          console.debug("[EXPORT/bg] calling saveReportManifest (CF) …");
          const functions = getFunctions(undefined, "europe-west1");
          const fn = httpsCallable(functions, "saveReportManifest");
          const result = await fn({
            policy: payload.policy,
            selectionHash,
            selection: payload.manifestPreview?.selection ?? null,
            manifest: manifestJson, // skicka det vi just ritade PDF från
          });
          console.debug("[EXPORT/bg] manifest saved", (result as any)?.data ?? result);
        } catch (e) {
          const msg = e instanceof Error ? (e.stack || e.message) : typeof e === "string" ? e : JSON.stringify(e);
          console.error("[EXPORT/bg] manifest save failed (CF):", e);
          alert("Kunde inte spara manifestet i bakgrunden (server):\n\n" + msg);
        }
      })();

      console.debug("[EXPORT] done (background CF save running)");
    } catch (err) {
      console.error("[EXPORT] error", err);
      alert("Exporten misslyckades:\n\n" + asMsg(err));
    } finally {
      // om något ovan return:ade innan "släpp UI" – säkerställ att vi inte fastnar
      setExporting(false);
    }
  }








  /* -------- Render -------- */
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
      <h1 className="gw-h1" style={{ marginBottom: 12 }}>Rapporter</h1>

      {error && (
        <div className="gw-banner gw-banner--danger" style={{ marginBottom: 12 }}>
          {String(error)}
        </div>
      )}
      {loading && !preview && (
        <div className="gw-banner gw-banner--info" style={{ marginBottom: 12 }}>
          Laddar förhandsvisning…
        </div>
      )}

      {/* -------- Filterpanelen -------- */}
      <div className="gw-card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="gw-form-grid-3">
          <div>
            <label className="gw-form-label">Från datum</label>
            <input type="date" className="gw-input" value={vFrom} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="gw-form-label">Till datum</label>
            <input type="date" className="gw-input" value={vTo} onChange={(e) => setTo(e.target.value)} />
          </div>

          {/* Skeleton för totals + tabell när loading=true */}
          {loading && (
            <>
              <div className="gw-card" style={{ padding: 16, marginBottom: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
                      <div style={{ height: 12, background: "#eee", borderRadius: 6, marginBottom: 8 }} />
                      <div style={{ height: 20, background: "#f2f2f2", borderRadius: 6 }} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="gw-card" style={{ padding: 16, marginBottom: 16 }}>
                <h3 className="gw-h3" style={{ marginBottom: 8 }}>Per produkttyp</h3>
                <div style={{ border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
                  {Array.from({ length: 6 }).map((_, row) => (
                    <div
                      key={row}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
                        gap: 12,
                        padding: "10px 12px",
                        borderTop: row === 0 ? "none" : "1px solid #f0f0f0",
                      }}
                    >
                      {Array.from({ length: 5 }).map((__, col) => (
                        <div
                          key={col}
                          style={{
                            height: 12,
                            background: row === 0 ? "#eee" : "#f5f5f5",
                            borderRadius: 6,
                          }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div>
            <label className="gw-form-label">Kunder</label>

            {/* Sök + badge + markera/avmarkera för KUNDER */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <div className="gw-clearable" style={{ flex: 1 }}>
                <input
                  type="search"
                  className="gw-input"
                  placeholder="Sök kund…"
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                />
                {customerQuery && (
                  <button className="gw-clear-btn" onClick={() => setCustomerQuery("")} aria-label="Rensa sök">×</button>
                )}
              </div>

              {/* ✅ RÄTT badge för kunder */}
              <span className="gw-badge">
                {safeSelectedCustomers.length}/{customerOpts.length} valda
              </span>

              {/* ✅ Markera alla bland FILTRERADE kunder */}
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const ids = filteredCustomerOpts.map((c) => c.key);
                  const setAll = new Set([...safeSelectedCustomers, ...ids]);
                  if (props.onToggleCustomer) {
                    ids.forEach((id) => !safeSelectedCustomers.includes(id) && props.onToggleCustomer!(id));
                  } else {
                    setLocalSelCustomers(Array.from(setAll));
                  }
                }}
              >
                Markera alla
              </button>

              {/* ✅ Avmarkera bara de FILTRERADE kunderna */}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  const toClear = new Set(filteredCustomerOpts.map((c) => c.key));
                  const next = safeSelectedCustomers.filter((id) => !toClear.has(id));
                  if (props.onToggleCustomer) {
                    safeSelectedCustomers
                      .filter((id) => toClear.has(id))
                      .forEach((id) => props.onToggleCustomer!(id));
                  } else {
                    setLocalSelCustomers(next);
                  }
                }}
              >
                Avmarkera
              </button>
            </div>


            {/* Grid med pills */}
            <div
              style={{
                display: "grid",
                gap: 8,
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                maxHeight: 180,
                overflow: "auto",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: 8,
                marginBottom: 12,
              }}
            >
              {filteredCustomerOpts.length === 0 ? (
                <div className="text-muted">Inga kunder</div>
              ) : (
                filteredCustomerOpts.map((c) => {
                  const selected = safeSelectedCustomers.includes(c.key);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => toggleCustomer(c.key)}
                      aria-pressed={selected ? "true" : "false"}
                      className={`gw-pill ${selected ? "is-selected" : ""}`}
                      title={c.name}
                    >
                      {selected ? "✔︎ " : ""}{c.name}
                    </button>
                  );
                })
              )}

            </div>

          </div>
        </div>

        <div className="gw-form-grid-3" style={{ marginTop: 12 }}>
          <div>
            <label className="gw-form-label">Produkttyper</label>

            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <div className="gw-clearable" style={{ flex: 1 }}>
                <input
                  type="search"
                  className="gw-input"
                  placeholder="Sök typ…"
                  value={typeQuery}
                  onChange={(e) => setTypeQuery(e.target.value)}
                />
                {typeQuery && (
                  <button className="gw-clear-btn" onClick={() => setTypeQuery("")} aria-label="Rensa sök">×</button>
                )}
              </div>

              <span className="gw-badge">
                {(props.selectedTypes ?? vTypes).length}/{typeOpts.length} valda
              </span>

              <button
                type="button"
                className="btn"
                onClick={() => {
                  const ids = filteredTypeOpts.map((t) => t.id);
                  const setAll = new Set([...(props.selectedTypes ?? vTypes), ...ids]);
                  if (props.onToggleType) {
                    ids.forEach((id) => !vTypes.includes(id) && props.onToggleType!(id));
                  } else {
                    setLocalSelTypes(Array.from(setAll));
                  }
                }}
              >
                Markera alla
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  const toClear = new Set(filteredTypeOpts.map((t) => t.id));
                  const next = (props.selectedTypes ?? vTypes).filter((id) => !toClear.has(id));
                  if (props.onToggleType) {
                    (props.selectedTypes ?? vTypes)
                      .filter((id) => toClear.has(id))
                      .forEach((id) => props.onToggleType!(id));
                  } else {
                    setLocalSelTypes(next);
                  }
                }}
              >
                Avmarkera
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gap: 8,
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                maxHeight: 180,
                overflow: "auto",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: 8,
                marginBottom: 12, // ← luft under griden
              }}
            >
              {filteredTypeOpts.length === 0 ? (
                <div className="text-muted">Inga typer</div>
              ) : (
                filteredTypeOpts.map((t) => {
                  const selected = vTypes.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleType(t.id)}
                      aria-pressed={selected ? "true" : "false"}
                      className={`gw-pill ${selected ? "is-selected" : ""}`}
                      title={t.label}
                    >
                      {selected ? "✔︎ " : ""}{t.label}
                    </button>
                  );
                })
              )}
            </div>


          </div>

          {/* Oförändrad kör-knapp i högerkolumnen */}
          <div style={{ alignSelf: "end" }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                try {
                  const payload = {
                    fromDate: vFrom,
                    toDate: vTo,
                    customerIds: vCustomers,                // exakt de valda kunderna
                    productTypeIds: vTypes.length ? vTypes : undefined,
                    basis: "completedAt" as const,
                    factorPolicy: "latest" as const,
                  };

                  const res = await fetch(BUILD_CO2_PREVIEW_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                    credentials: "omit",
                    mode: "cors",
                  });

                  if (!res.ok) {
                    const txt = await res.text().catch(() => "");
                    throw new Error(`buildCO2Preview failed: ${res.status} ${res.statusText} ${txt}`);
                  }

                  const sp: ServerPreview = await res.json();
                  setServerPreview(sp);                     // <- NYCKELN: lagra svaret
                } catch (e) {
                  console.error(e);
                  alert(e instanceof Error ? e.message : String(e));
                }
              }}
              disabled={
                loading ||
                safeSelectedCustomers.length === 0 ||
                safeSelectedTypes.length === 0
              }
              title="Kör förhandsberäkning"
            >
              {loading ? "Laddar…" : "Ladda förhandsvisning"}
            </button>
          </div>
        </div>

        {error && (
          <div className="gw-banner gw-banner--warn" style={{ marginTop: 12 }}>
            {error}








          </div>




        )}







      </div>

      {/* -------- Preview: totals + tabell -------- */}
      {preview ? (
        <div className="gw-card" style={{ padding: 16 }}>
          {/* Topp-rad: tidsstämpel + knappar */}
          <div style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 12 }}>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {snapshotMeta ? (
                <>
                  Förhandsvisning från{" "}
                  {new Date(snapshotMeta.timestamp).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                  {" • "}{snapshotMeta.count} enheter
                  {isStale && <span className="gw-badge" style={{ marginLeft: 8 }}>Inaktuell – ladda om</span>}
                </>
              ) : (
                "Ingen förhandsvisning ännu"
              )}
            </div>

            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  if (exporting) return;
                  setExporting(true);
                  try {
                    await handleExportClick();
                  } finally {
                    setExporting(false);
                  }
                }}
                disabled={!canExport || exporting}
                aria-busy={exporting ? "true" : "false"}
                title={
                  exporting
                    ? "Exporterar…"
                    : !snapshotMeta
                      ? "Ladda förhandsvisning först"
                      : isStale
                        ? "Filter ändrade – ladda förhandsvisning igen"
                        : "Exportera PDF"
                }
                style={{ minWidth: 140 }}
              >
                {exporting ? "Exporterar…" : "Exportera PDF"}
              </button>


              <button className="btn" onClick={() => setShowInfo(true)}>Om rapporten</button>
            </div>
          </div>

          {/* Vanliga totals */}
          <div style={{ marginBottom: 8 }}>
            <b>Processed:</b> {(preview as any)?.processed ?? 0} • <b>Skipped:</b> {(preview as any)?.skipped ?? 0} •{" "}
            <b>Schema v</b>{(preview as any)?.schemaVersion ?? 1}
          </div>

          <div>
            {(() => {
              const d: any = (preview as any)?.display ?? {};
              const t = d?.totals ?? {};
              return (
                <>
                  Totalt — Enheter: <b>{t?.total ?? 0}</b>,{" "}
                  <span title="Uppskattad vikt som INTE blivit avfall tack vare återbruk (grader A–D).">
                    Undviket e-waste:
                  </span>{" "}
                  <b>{t?.eWasteKg ?? 0} kg</b>,{" "}
                  <span title="Uppskattad vikt som gått till återvinning när enheter inte var återbrukbara (grad E).">
                    Återvunnet avfall:
                  </span>{" "}
                  <b>{t?.recycledKg ?? 0} kg</b>,{" "}
                  <span title="Beräknat på resålda enheter × CO2-schablon per produkttyp. Re-used = 0 kg.">
                    Undvikna CO2-utsläpp:
                  </span>{" "}
                  <b>{t?.co2Kg ?? 0} kg</b>
                </>
              );
            })()}
          </div>

          {/* Tabell per produkttyp */}
          <div style={{ marginTop: 16 }}>
            <h3 className="gw-h3" style={{ margin: "8px 0" }}>Per produkttyp</h3>

            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th>Typ</th>
                  <th>Antal</th>
                  <th>A</th>
                  <th>B</th>
                  <th>C</th>
                  <th>D</th>
                  <th>E</th>
                  <th><span title="Uppskattad vikt som INTE blivit avfall tack vare återbruk (grader A–D).">Undviket e-waste (kg)</span></th>
                  <th><span title="Uppskattad vikt som gått till återvinning när enheter inte var återbrukbara (grad E).">Återvunnet avfall (kg)</span></th>
                  <th><span title="Beräknat på resålda enheter × CO2-schablon per produkttyp. Re-used = 0 kg.">Undvikna CO2-utsläpp (kg)</span></th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const d: any = (preview as any)?.display ?? {};
                  const rows: any[] | null = Array.isArray(d.rows) ? d.rows : null;

                  const entries: Array<[string, any]> = rows
                    ? rows.map((r) => [
                      String(r.productType ?? r.label ?? "okänd"),
                      {
                        label: r.label ?? r.productType,
                        count: r.total ?? r.count ?? 0,
                        grades: { A: r.A ?? 0, B: r.B ?? 0, C: r.C ?? 0, D: r.D ?? 0, E: r.E ?? 0 },
                        eWasteKg: r.eWasteKg ?? 0,
                        recycledKg: r.recycledKg ?? 0,
                        co2Kg: r.co2Kg ?? 0,
                      },
                    ])
                    : Object.entries(d.perType ?? d.byType ?? {});

                  return entries.map(([id, row]) => {
                    const g = (row?.grades ?? {}) as Partial<Record<"A" | "B" | "C" | "D" | "E", number>>;
                    return (
                      <tr key={id}>
                        <td style={TD}>{row?.label ?? id}</td>
                        <td style={TDnum}>{row?.count ?? 0}</td>
                        <td style={TDnum}>{g.A ?? 0}</td>
                        <td style={TDnum}>{g.B ?? 0}</td>
                        <td style={TDnum}>{g.C ?? 0}</td>
                        <td style={TDnum}>{g.D ?? 0}</td>
                        <td style={TDnum}>{g.E ?? 0}</td>
                        <td style={TDnum}>{row?.eWasteKg ?? 0}</td>
                        <td style={TDnum}>{row?.recycledKg ?? 0}</td>
                        <td style={TDnum}>{row?.co2Kg ?? 0}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-muted">Ingen förhandsvisning ännu.</div>
      )}

      {/* Modal: förklaring + faktorer (LIVE från productTypes) */}
      {showInfo && (() => {
        const TH = { textAlign: "left" as const, padding: "10px 12px", borderBottom: "1px solid var(--border)", fontWeight: 700 };
        const THnum = { ...TH, textAlign: "right" as const };
        const TD = { padding: "10px 12px", borderTop: "1px solid var(--border)" };
        const TDnum = { ...TD, textAlign: "right" as const };

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Om klimatrapporten"
            onClick={() => setShowInfo(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "grid", placeItems: "center", padding: 16 }}
          >
            <div
              className="gw-card"
              onClick={(e) => e.stopPropagation()}
              style={{ width: "min(800px, 96vw)", maxHeight: "90vh", overflow: "auto", padding: 20 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <h3 className="gw-h3" style={{ margin: 0 }}>Så läser du klimatrapporten</h3>
                <div style={{ marginLeft: "auto" }}>
                  <button className="gw-button" onClick={() => setShowInfo(false)}>Stäng</button>
                </div>
              </div>

              {/* Förklarande text */}
              <p style={{ marginTop: 12, marginBottom: 0, fontWeight: 600 }}>
                Så här beräknas våra CO₂- och e-waste-värden
              </p>
              <p style={{ marginTop: 6 }}>
                För att våra rapporter ska vara jämförbara och trovärdiga använder vi en tvåstegsmodell.
                Vi kombinerar schablonvikter per produkttyp med CO₂-faktorer per enhet.
              </p>

              <h4 className="gw-h4" style={{ marginTop: 12 }}>Undviket e-waste (kg)</h4>
              <p>
                <strong>Undviket e-waste</strong> avser den mängd elektronikavfall som <em>inte</em> uppstår
                tack vare återbruk (grader A–D). Vi utgår från <strong>medianvikter</strong> per produkttyp
                (t.ex. laptop, desktop, monitor). Vikterna representerar en “typisk” enhet.
              </p>

              <h4 className="gw-h4" style={{ marginTop: 12 }}>Undvikna CO₂-utsläpp (kg)</h4>
              <p>
                <strong>Undvikna CO₂-utsläpp</strong> uppstår när en enhet återbrukas/ersätter nyproduktion.
                Vi använder <strong>Life Cycle Assessments (LCA)</strong> från tillverkare och öppna källor
                som täcker tillverkning, transporter, användning och återvinning.
              </p>

              <h4 className="gw-h4" style={{ marginTop: 12 }}>Återvunnet avfall (kg)</h4>
              <p>
                <strong>Återvunnet avfall</strong> avser den mängd som faktiskt går till materialåtervinning
                (grad E) när en enhet inte är återbrukbar. Detta redovisas separat från undviket e-waste.
              </p>

              <p style={{ marginTop: 12 }}>Sammanfattning:</p>
              <ul className="gw-list">
                <li><strong>Undviket e-waste (kg):</strong> återbrukade enheter (A–D) × medianvikt per typ.</li>
                <li><strong>Återvunnet avfall (kg):</strong> skrotade enheter (E) × medianvikt per typ.</li>
                <li><strong>Undvikna CO₂-utsläpp (kg):</strong> resålda/återbrukade enheter × CO₂-faktor per typ (Re-used = 0 kg).</li>
              </ul>
              <p><em>Värdena är riktvärden baserade på medianer; de möjliggör jämförelser över tid.</em></p>

              {/* Faktor-tabell (LIVE) */}
              <h4 className="gw-h4" style={{ marginTop: 16 }}>Faktorer som används just nu</h4>
              <p className="text-muted" style={{ marginTop: 4 }}>
                Tabellen hämtas live från <code>productTypes</code> och uppdateras om värden ändras i admin.
                Exporterad PDF fryser faktorer och policy i manifestet.
              </p>

              <div style={{ overflowX: "auto", marginTop: 8 }}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={TH}>Produkttyp</th>
                      <th style={TH}>ID (slug)</th>
                      <th style={THnum}>Medianvikt (kg)</th>
                      <th style={THnum}>CO₂ per enhet (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ptRows.length === 0 ? (
                      <tr>
                        <td style={TD} colSpan={4}>Inga produkttyper funna.</td>
                      </tr>
                    ) : (
                      ptRows.map((r) => (
                        <tr key={r.id}>
                          <td style={TD}>{r.label}</td>
                          <td style={TD}><code>{r.id}</code></td>
                          <td style={TDnum}>{Number(r.medianWeightKg ?? 0).toLocaleString("sv-SE", { maximumFractionDigits: 2 })}</td>
                          <td style={TDnum}>{Number(r.co2PerUnitKg ?? 0).toLocaleString("sv-SE", { maximumFractionDigits: 2 })}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}




    </div>



  );
}


