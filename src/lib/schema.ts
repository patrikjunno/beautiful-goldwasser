// src/lib/schema.ts
// ------------------------------------------------------
// Gemensamma typer för rapportfilter & rapportsnapshot-dokument
// ------------------------------------------------------
import type { ImpactSnapshot, ProductType } from "./impact";

export type PeriodBasis = "completedAt" | "invoicedAt"; // vi använder "completedAt" nu

export type ReportFilters = {
  fromDate: string;            // "YYYY-MM-DD" (inklusive)
  toDate: string;              // "YYYY-MM-DD" (inklusive)
  basis: PeriodBasis;          // normalt "completedAt"
  customerIds: string[];       // en eller flera kunder (kundgrupper)
  productTypes?: ProductType[];// valfri filtrering per typ
  status?: Array<"reused"|"resold"|"scraped">; // valfritt
  grade?: Array<"A"|"B"|"C"|"D"|"E">;          // valfritt
};

export type ReportMeta = {
  createdAt: number;          // Date.now()
  createdBy?: string;         // uid/email om ni vill
  schemaVersion: number;      // från snapshot.schemaVersion
  // Valfritt: human-readable titel/beskrivning
  title?: string;
  description?: string;
};

export type ReportSnapshotDoc = {
  type: "sustainability";
  filters: ReportFilters;       // exakt vilka filter som användes
  snapshot: ImpactSnapshot;     // byGroup/totals + factors + schemaVersion
  itemIds: string[];            // vilka poster ingick
  meta: ReportMeta;             // metadata för audit/visning
};
