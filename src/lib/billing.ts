// src/lib/billing.ts

// === Typer ===
export type BillingSteps = {
  f3Procedure: 0 | 1;
  endpointRemoval: 0 | 1;
  osReinstall: 0 | 1;
  endpointWipe: 0 | 1;
  postWipeBootTest: 0 | 1;
  dataErasure: 0 | 1;
  refurbish: 0 | 1;
};

export type InvoiceSummary = {
  totalItems: number;
  reusedCount: number;
  resoldCount: number;
  scrappedCount: number;
  // OBS: totalAmount ingår inte i nuvarande skrivning – läggs till senare om/ när du vill spara belopp.
};

// === Single Source of Truth: computeBillingSteps ===
// Denna version matchar den du själv kodade i App.tsx (källsanning).
export function computeBillingSteps(opts: { reuse?: boolean; resold?: boolean; scrap?: boolean }): BillingSteps {
  const { reuse, resold, scrap } = opts || {};

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

  // Default om inget statusflagga satt (alla nollor)
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

// === Summering för rapportdokument ===
type MinimalItemForSummary = {
  // Minst en av dessa används i nuvarande data
  completionChoice?: "reused" | "resold" | "scrapped" | "scrap" | string | null | undefined;
  reuse?: boolean;
  resold?: boolean;
  scrap?: boolean;
};

export function buildInvoiceSummary(items: MinimalItemForSummary[]): InvoiceSummary {
  let reusedCount = 0;
  let resoldCount = 0;
  let scrappedCount = 0;

  for (const it of items || []) {
    const c = (it.completionChoice || "").toString().toLowerCase();
    const isReuse = it.reuse === true || c === "reused";
    const isResold = it.resold === true || c === "resold";
    // Hantera både "scrapped" och "scrap" som skrot
    const isScrap = it.scrap === true || c === "scrapped" || c === "scrap";

    if (isReuse) reusedCount++;
    else if (isResold) resoldCount++;
    else if (isScrap) scrappedCount++;
  }

  return {
    totalItems: items?.length ?? 0,
    reusedCount,
    resoldCount,
    scrappedCount,
  };
}

// ---- Normalisering av legacy summary-nycklar ----
export type ReportSummaryLike = Partial<{
  totalItems: number;
  reusedCount: number;
  resoldCount: number;
  scrappedCount: number;
  // legacy keys
  reused: number;
  resold: number;
  scrap: number;
  total: number;       // legacy totalItems
  totalAmount: number; // ev. framtida belopp
}>;

export function normalizeSummaryCounts(s: ReportSummaryLike | null | undefined) {
  const src = s || {};
  const totalItems =
    (typeof src.totalItems === "number" ? src.totalItems : undefined) ??
    (typeof src.total === "number" ? src.total : 0);

  const reusedCount =
    (typeof src.reusedCount === "number" ? src.reusedCount : undefined) ??
    (typeof src.reused === "number" ? src.reused : 0);

  const resoldCount =
    (typeof src.resoldCount === "number" ? src.resoldCount : undefined) ??
    (typeof src.resold === "number" ? src.resold : 0);

  const scrappedCount =
    (typeof src.scrappedCount === "number" ? src.scrappedCount : undefined) ??
    (typeof src.scrap === "number" ? src.scrap : 0);

  return { totalItems, reusedCount, resoldCount, scrappedCount };
}

