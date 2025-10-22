// src/lib/impact.ts
// ------------------------------------------------------
// Goldwasser – Impact policy & validering (steg 1)
// Rena typer + regler utan vikter/CO₂ (läggs till i senare steg)
// ------------------------------------------------------

// Versionering för beräkningsschema (kommer också sparas i rapport-snapshots)
export const SCHEMA_VERSION = 1 as const;

// Gradering: A–E (E = ej återbrukbar/skrot)
export type Grade = 'A' | 'B' | 'C' | 'D' | 'E';

// Status: exakt en ska väljas när enhet färdigställs
export type Status = 'reused' | 'resold' | 'scraped';

// ProductType definieras här redan nu (schabloner läggs senare)
export type ProductType =
  | 'copier' | 'dataprojector' | 'desktop' | 'laptop' | 'monitor'
  | 'network' | 'phone' | 'pos' | 'printer' | 'scanner' | 'server' | 'tablet';

// Policyswitchar för CO₂-kredit (används i senare steg)
export const POLICY = {
  co2ForReused: false,  // intern återanvändning ger 0 CO₂
  co2ForResold: true,   // extern återbruk ger CO₂-kredit
  co2ForScraped: false, // skrot ger ingen CO₂-kredit i nuläget
} as const;

// Hjälpare: är graden återbrukbar (A–D)?
export function isRefurbishable(grade: Grade): boolean {
  return grade !== 'E';
}

// Validera giltiga kombinationer av status och grade.
// - Scraped ⇒ Grade E
// - Re-used/Resold ⇒ Grade A–D
export function validateStatusGrade(
  status: Status,
  grade: Grade
): { ok: true } | { ok: false; error: string } {
  if (status === 'scraped' && grade !== 'E') {
    return { ok: false, error: 'Skrotad (Scraped) kräver gradering E.' };
  }
  if ((status === 'reused' || status === 'resold') && grade === 'E') {
    return { ok: false, error: 'Re-used/Resold kan inte ha gradering E.' };
  }
  return { ok: true };
}

// ------------------------------------------------------
// Schabloner – steg 2 (temporärt hårdkodade värden)
// Flyttas senare till Firestore via productTypes-admin.
// ------------------------------------------------------

export type ProductTypeFactors = {
  medianWeightKg: number;  // används för e-waste/recycled
  co2PerUnitKg: number;    // används för CO₂ (resold enligt policy)
};

// Hårdkodad tabell för första versionen.
// OBS: CO₂-värden saknas för flera typer i nuläget → 0 tills ni beslutar siffra.
export const PRODUCT_TYPE_DEFAULTS: Record<ProductType, ProductTypeFactors> = {
  copier: { medianWeightKg: 85.10, co2PerUnitKg: 0 },
  dataprojector: { medianWeightKg: 5.00, co2PerUnitKg: 0 },
  desktop: { medianWeightKg: 7.60, co2PerUnitKg: 235 },
  laptop: { medianWeightKg: 1.54, co2PerUnitKg: 194 },
  monitor: { medianWeightKg: 5.90, co2PerUnitKg: 312 },
  network: { medianWeightKg: 1.04, co2PerUnitKg: 0 },      // "Network product"
  phone: { medianWeightKg: 0.14, co2PerUnitKg: 121 },
  pos: { medianWeightKg: 7.25, co2PerUnitKg: 0 },      // "Point of sales"
  printer: { medianWeightKg: 10.40, co2PerUnitKg: 0 },
  scanner: { medianWeightKg: 2.34, co2PerUnitKg: 0 },
  server: { medianWeightKg: 23.13, co2PerUnitKg: 0 },
  tablet: { medianWeightKg: 0.47, co2PerUnitKg: 0 },
};

export function getProductTypeFactors(pt: ProductType): ProductTypeFactors {
  if (_productTypeFactorsCache && _productTypeFactorsCache.has(pt)) {
    const v = _productTypeFactorsCache.get(pt);
    if (v) return v; // säkert utan non-null assertion
  }
  return PRODUCT_TYPE_DEFAULTS[pt] ?? { medianWeightKg: 0, co2PerUnitKg: 0 };
}

// ------------------------------------------------------
// Per-enhet-beräkning – steg 3
// Räknar e-waste, recycled och CO₂ för EN post utifrån policy.
// ------------------------------------------------------

export type ItemImpact = {
  eWasteKg: number;    // A–D → medianvikt (undvikt e-waste)
  recycledKg: number;  // E (scraped) → medianvikt (återvunnet)
  co2Kg: number;       // enligt policy (resold > 0; reused/scraped enligt POLICY)
  refurbished: boolean; // true om A–D
};

export function computeItemImpact(
  productType: ProductType,
  grade: Grade,
  status: Status
): ItemImpact {
  const { medianWeightKg, co2PerUnitKg } = getProductTypeFactors(productType);

  const refurbished = grade !== 'E';
  const isResold = status === 'resold';
  const isReused = status === 'reused';
  const isScraped = status === 'scraped';

  // E-waste: A–D räknas som undvikt e-waste
  const eWasteKg = refurbished ? medianWeightKg : 0;

  // Recycled: endast scraped (E) räknas som återvunnet
  const recycledKg = isScraped ? medianWeightKg : 0;

  // CO₂ enligt policy
  let co2Kg = 0;
  if (isResold && refurbished && POLICY.co2ForResold) co2Kg += co2PerUnitKg;
  if (isReused && refurbished && POLICY.co2ForReused) co2Kg += co2PerUnitKg;  // hos er: false ⇒ 0
  if (isScraped && POLICY.co2ForScraped) co2Kg += co2PerUnitKg;               // hos er: false ⇒ 0

  return { eWasteKg, recycledKg, co2Kg, refurbished };
}
// ------------------------------------------------------
// Aggregat – steg 4
// Summerar en lista av poster till per-typ-buckets + totals.
// Avrundar kg till heltal för presentation.
// ------------------------------------------------------

export type GradesCount = Record<Grade, number>;

export type ImpactBucket = {
  productType: ProductType;
  grades: GradesCount;     // antal per grade A–E
  total: number;           // totalt antal
  refurbishedCount: number;// antal A–D
  eWasteKg: number;        // A–D * medianWeight
  recycledKg: number;      // E   * medianWeight
  co2Kg: number;           // enligt policy
};

export type ImpactTotals = {
  total: number;
  refurbishedCount: number;
  eWasteKg: number;
  recycledKg: number;
  co2Kg: number;
};

export type AggregatedImpact = {
  byGroup: Record<ProductType, ImpactBucket>;
  totals: ImpactTotals;
};

function emptyGrades(): GradesCount {
  return { A: 0, B: 0, C: 0, D: 0, E: 0 };
}

export function aggregateImpact(items: Array<{
  productType: ProductType;
  grade: Grade;
  status: Status;
}>): AggregatedImpact {
  const groups = Object.keys(PRODUCT_TYPE_DEFAULTS) as ProductType[];

  // Initiera buckets för alla kända typer (stabil tabell i UI)
  const byGroup: Record<ProductType, ImpactBucket> = Object.fromEntries(
    groups.map((pt) => [
      pt,
      {
        productType: pt,
        grades: emptyGrades(),
        total: 0,
        refurbishedCount: 0,
        eWasteKg: 0,
        recycledKg: 0,
        co2Kg: 0,
      },
    ])
  ) as Record<ProductType, ImpactBucket>;

  for (const it of items) {
    const b = byGroup[it.productType];
    if (!b) continue; // skydd om okänd typ skulle slinka igenom

    // räkna antal per grade & totals
    b.grades[it.grade] += 1;
    b.total += 1;

    const impact = computeItemImpact(it.productType, it.grade, it.status);
    if (impact.refurbished) b.refurbishedCount += 1;
    b.eWasteKg += impact.eWasteKg;
    b.recycledKg += impact.recycledKg;
    b.co2Kg += impact.co2Kg;
  }

  // Avrunda kg till heltal (matchar rapportformatet)
  for (const pt of groups) {
    byGroup[pt].eWasteKg = Math.round(byGroup[pt].eWasteKg);
    byGroup[pt].recycledKg = Math.round(byGroup[pt].recycledKg);
    byGroup[pt].co2Kg = Math.round(byGroup[pt].co2Kg);
  }

  // Totals
  const totals: ImpactTotals = {
    total: 0,
    refurbishedCount: 0,
    eWasteKg: 0,
    recycledKg: 0,
    co2Kg: 0,
  };

  for (const pt of groups) {
    const b = byGroup[pt];
    totals.total += b.total;
    totals.refurbishedCount += b.refurbishedCount;
    totals.eWasteKg += b.eWasteKg;
    totals.recycledKg += b.recycledKg;
    totals.co2Kg += b.co2Kg;
  }

  return { byGroup, totals };
}
// ------------------------------------------------------
// Adapter – steg 5
// Normaliserar "rå" item-objekt (från UI/DB) → impact-input,
// och erbjuder en hjälpare som direkt summerar en lista.
// ------------------------------------------------------

/** Tillåt synonymer/legacy-namn för productType */
const PRODUCT_TYPE_ALIASES: Record<string, ProductType> = {
  mobile: 'phone',
  smartphone: 'phone',
  handset: 'phone',
  cellphone: 'phone',
  'network product': 'network',
  'point of sales': 'pos',
  posdevice: 'pos',
  'data projector': 'dataprojector',
  beamer: 'dataprojector',
};

export function normalizeProductType(value: unknown): ProductType | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();

  // exakt träff
  if (key in PRODUCT_TYPE_DEFAULTS) return key as ProductType;

  // alias
  if (key in PRODUCT_TYPE_ALIASES) return PRODUCT_TYPE_ALIASES[key];

  return null;
}

export function normalizeGrade(value: unknown): Grade | null {
  if (typeof value !== 'string') return null;
  const g = value.trim().toUpperCase();
  if (g === 'A' || g === 'B' || g === 'C' || g === 'D' || g === 'E') return g;
  return null;
}

/** Stöd både status-fält och de tre booleanska flaggorna reuse/resold/scrap */
export function inferStatus(input: {
  status?: unknown;
  reuse?: unknown;
  resold?: unknown;
  scrap?: unknown;
}): Status | null {
  // 1) status-fält (sträng) vinner om giltigt
  if (typeof input.status === 'string') {
    const s = input.status.toLowerCase() as Status;
    if (s === 'reused' || s === 'resold' || s === 'scraped') return s;
  }

  // 2) booleans
  const rU = Boolean(input.reuse);
  const rS = Boolean(input.resold);
  const sc = Boolean(input.scrap);
  const count = Number(rU) + Number(rS) + Number(sc);
  if (count !== 1) return null;
  if (sc) return 'scraped';
  if (rS) return 'resold';
  if (rU) return 'reused';
  return null;
}

/** Minimal rå-input-typ; vi läser bara de fält vi behöver */
export type RawImpactItem = {
  id?: string;
  productType?: unknown;
  grade?: unknown;
  status?: unknown;
  reuse?: unknown;
  resold?: unknown;
  scrap?: unknown;
};

/** Försök normalisera en råpost. Returnerar null om något saknas/ogiltigt. */
export function toImpactInput(
  raw: RawImpactItem
): { productType: ProductType; grade: Grade; status: Status } | null {
  const pt = normalizeProductType(raw.productType);
  const gr = normalizeGrade(raw.grade);
  const st = inferStatus(raw);

  if (!pt || !gr || !st) return null;

  // Policysäkerhet: ogiltig kombination ska inte läcka vidare
  const chk = validateStatusGrade(st, gr);
  if ('ok' in chk && chk.ok) {
    return { productType: pt, grade: gr, status: st };
  }
  return null;
}

/** One-shot-hjälpare för UI: ta rålista → aggregation + antal passerade/skippade */
export function aggregateFromRawItems(
  raws: RawImpactItem[]
): { aggregation: AggregatedImpact; processed: number; skipped: number } {
  const prepared: Array<{ productType: ProductType; grade: Grade; status: Status }> = [];
  let skipped = 0;

  for (const r of raws) {
    const norm = toImpactInput(r);
    if (norm) prepared.push(norm);
    else skipped += 1;
  }

  const aggregation = aggregateImpact(prepared);
  return { aggregation, processed: prepared.length, skipped };
}
// ------------------------------------------------------
// Validering – steg 6
// En enda funktion att anropa innan "Markera som färdig".
// Säkerställer: exakt en status, grade finns, och Scraped ⇄ E-regeln.
// ------------------------------------------------------

export function validateCompletionChoice(input: {
  grade?: unknown;
  status?: unknown;
  reuse?: unknown;
  resold?: unknown;
  scrap?: unknown;
}): { ok: true } | { ok: false; error: string } {
  // 1) status: stöd både status-sträng och tre booleans
  const st = inferStatus({
    status: input.status,
    reuse: input.reuse,
    resold: input.resold,
    scrap: input.scrap,
  });
  if (!st) {
    return {
      ok: false,
      error: 'Välj precis ett av: Återbruk (Re-used), Vidaresålt (Resold) eller Skrotad (Scraped).',
    };
  }

  // 2) grade krävs
  const gr = normalizeGrade(input.grade);
  if (!gr) {
    return { ok: false, error: 'Välj gradering (A–E).' };
  }

  // 3) Scraped ⇄ E-regeln
  const chk = validateStatusGrade(st, gr);
  if ('ok' in chk && !chk.ok) {
    return { ok: false, error: ("error" in chk ? chk.error : "Unknown error") };
  }

  return { ok: true };
}
// ------------------------------------------------------
// Visningsmodell – steg 7
// Hjälper UI att rendera tabeller: rader per productType + % refurbished.
// ------------------------------------------------------

// Tillfälliga etiketter (ersätts senare av Firestore label från productTypes)
export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  copier: 'Copier',
  dataprojector: 'Data projector',
  desktop: 'Desktop',
  laptop: 'Laptop',
  monitor: 'Monitor',
  network: 'Network product',
  phone: 'Phone',
  pos: 'Point of sales',
  printer: 'Printer',
  scanner: 'Scanner',
  server: 'Server',
  tablet: 'Tablet',
};

export type ImpactDisplayRow = {
  productType: ProductType;
  label: string;
  A: number; B: number; C: number; D: number; E: number;
  total: number;
  percentRefurbished: number; // 0–100
  eWasteKg: number;
  recycledKg: number;
  co2Kg: number;
};

export type ImpactDisplay = {
  rows: ImpactDisplayRow[];
  totals: {
    total: number;
    refurbishedCount: number;
    percentRefurbished: number; // 0–100
    eWasteKg: number;
    recycledKg: number;
    co2Kg: number;
  };
};

function pct(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  // avrunda till närmaste heltal som i rapportexemplet
  return Math.round((numerator / denominator) * 100);
}

/**
 * Gör om AggregatedImpact → ImpactDisplay för enkel rendering i UI.
 * Radhar alla kända typer oavsett om total=0 (stabil tabell).
 */
export function toImpactDisplay(agg: AggregatedImpact): ImpactDisplay {
  const rows: ImpactDisplayRow[] = [];

  const types = Object.keys(PRODUCT_TYPE_DEFAULTS) as ProductType[];
  for (const pt of types) {
    const b = agg.byGroup[pt];
    const row: ImpactDisplayRow = {
      productType: pt,
      label: PRODUCT_TYPE_LABELS[pt] ?? pt,
      A: b.grades.A,
      B: b.grades.B,
      C: b.grades.C,
      D: b.grades.D,
      E: b.grades.E,
      total: b.total,
      percentRefurbished: pct(b.refurbishedCount, b.total),
      eWasteKg: b.eWasteKg,
      recycledKg: b.recycledKg,
      co2Kg: b.co2Kg,
    };
    rows.push(row);
  }

  const t = agg.totals;
  return {
    rows,
    totals: {
      total: t.total,
      refurbishedCount: t.refurbishedCount,
      percentRefurbished: pct(t.refurbishedCount, t.total),
      eWasteKg: t.eWasteKg,
      recycledKg: t.recycledKg,
      co2Kg: t.co2Kg,
    },
  };
}
// ------------------------------------------------------
// Facade – steg 8
// Ett enda UI-anrop: rålista → display + metadata (processed/skipped/version).
// ------------------------------------------------------

// Helper: dedupe RawImpactItem[] by Firestore doc id
function dedupeRawById<T extends { id?: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const id = (r.id ?? "").toString();
    if (!id) {
      // no id – let it pass (or handle differently if you prefer)
      out.push(r);
      continue;
    }
    if (!seen.has(id)) {
      seen.add(id);
      out.push(r);
    }
  }
  return out;
}

export type PreparedImpactDisplay = {
  display: ImpactDisplay;
  processed: number;
  skipped: number;
  schemaVersion: number;
};

/**
 * Tar råa item-objekt (så som UI/DB har dem) och returnerar:
 * - displaymodell för tabeller
 * - processed/skipped-räkning (för att kunna visa om något föll bort)
 * - schemaVersion (för att kunna visa vilken logik som använts)
 */
export function prepareImpactDisplayFromRaw(raws: RawImpactItem[]): PreparedImpactDisplay {
  // ✅ Deduplicera på doc-id för att undvika dubbelräkning om flera queries överlappar
  const unique = dedupeRawById(raws);
  const dropped = raws.length - unique.length;

  const { aggregation, processed, skipped } = aggregateFromRawItems(unique);
  const display = toImpactDisplay(aggregation);

  return {
    display,
    processed,                    // redan baserat på deduplicerad input
    skipped: skipped + dropped,   // vill du inte räkna dubbletter som 'skipped'? byt till bara `skipped`
    schemaVersion: getActiveSchemaVersion(),
  };
}

// ------------------------------------------------------
// Firestore-adapter (förberedelse) – steg 9
// Gör productTypes pluggbar via en enkel cache.
// - getProductTypeFactors() använder cache om satt, annars defaults.
// - Etiketter uppdateras också om label finns i datakällan.
// - schemaVersion från datakällan kan sparas separat.
// ------------------------------------------------------

export type ProductTypeDoc = {
  id: ProductType;
  medianWeightKg: number;
  co2PerUnitKg: number;
  label?: string;
  schemaVersion?: number;
};

let _productTypeFactorsCache: Map<ProductType, ProductTypeFactors> | null = null;
let _productTypesSchemaVersion: number | null = null;

/** Ladda in productTypes från extern källa (t.ex. Firestore) till minnescache. */
export function primeProductTypesFromData(docs: ProductTypeDoc[]): void {
  const m = new Map<ProductType, ProductTypeFactors>();
  let maxSchema = 0;

  for (const d of docs) {
    // Säkra id
    if (!d?.id) continue;
    const id = d.id;

    // Sätt faktorer i cache
    m.set(id, {
      medianWeightKg: typeof d.medianWeightKg === 'number' ? d.medianWeightKg : 0,
      co2PerUnitKg: typeof d.co2PerUnitKg === 'number' ? d.co2PerUnitKg : 0,
    });

    // Uppdatera visningslabel om tillgänglig (muterar vår label-karta)
    if (d.label && PRODUCT_TYPE_LABELS[id] !== undefined) {
      PRODUCT_TYPE_LABELS[id] = d.label;
    }

    // Håll koll på version (ta högsta förekomst)
    if (typeof d.schemaVersion === 'number') {
      maxSchema = Math.max(maxSchema, d.schemaVersion);
    }
  }

  _productTypeFactorsCache = m;
  _productTypesSchemaVersion = maxSchema || null;
}

/** Töm cache (återgå till hårdkodade defaults). */
export function clearProductTypesCache(): void {
  _productTypeFactorsCache = null;
  _productTypesSchemaVersion = null;
}

/** Hämtar ev. datakällans schemaVersion; faller tillbaka till vårt lokala SCHEMA_VERSION. */
export function getActiveSchemaVersion(): number {
  return _productTypesSchemaVersion ?? SCHEMA_VERSION;
}
// ------------------------------------------------------
// Snapshot – steg 10
// Bygger ett "färdigt" snapshot-objekt av en rålista som kan sparas i Firestore.
// Innehåller: schemaVersion, använda faktorer per productType, byGroup & totals.
// ------------------------------------------------------

export type ProductTypeFactorsSnapshot = Record<ProductType, ProductTypeFactors>;

export type ImpactSnapshot = {
  schemaVersion: number;
  factors: ProductTypeFactorsSnapshot; // vilka vikter/CO₂ som användes, per typ
  byGroup: Record<ProductType, ImpactBucket>;
  totals: ImpactTotals;
};

export function buildImpactSnapshotFromRaw(
  raws: RawImpactItem[]
): { snapshot: ImpactSnapshot; processed: number; skipped: number } {
  const { aggregation, processed, skipped } = aggregateFromRawItems(raws);

  // Frys vilka faktorer som används just nu (cache eller defaults)
  const factors: ProductTypeFactorsSnapshot = {} as ProductTypeFactorsSnapshot;
  const types = Object.keys(PRODUCT_TYPE_DEFAULTS) as ProductType[];
  for (const pt of types) {
    factors[pt] = getProductTypeFactors(pt);
  }

  const snapshot: ImpactSnapshot = {
    schemaVersion: getActiveSchemaVersion(),
    factors,
    byGroup: aggregation.byGroup,
    totals: aggregation.totals,
  };

  return { snapshot, processed, skipped };
}











