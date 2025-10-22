// src/services/reports.ts
// ------------------------------------------------------
// Bygger ett hållbarhets-snapshot från en redan filtrerad item-lista.
// (Ingen Firestore-write ännu; det tar vi i nästa steg.)
// ------------------------------------------------------
import { addDoc, collection } from "firebase/firestore";
import { db } from "../firebase";
import { buildImpactSnapshotFromRaw } from "../lib/impact";
import type { RawImpactItem } from "../lib/impact";
import type { ReportFilters, ReportSnapshotDoc } from "../lib/schema";

/**
 * Konvertera "item"-objekt (som du har i minnet) till RawImpactItem
 * och bygg ett komplett ReportSnapshotDoc som kan sparas senare.
 *
 * @param filters  De filter som användes (sparas i snapshotet)
 * @param items    Lista av poster (måste innehålla minst fälten nedan)
 * @param itemIds  Exakta id:n som ingår (för spårbarhet)
 * @param createdBy (valfritt) uid/email
 */
export function buildSustainabilityReportSnapshot(
  filters: ReportFilters,
  items: Array<{
    id?: string;
    productType?: unknown;
    grade?: unknown;
    reuse?: unknown;
    resold?: unknown;
    scrap?: unknown;
  }>,
  itemIds: string[],
  createdBy?: string
): { doc: ReportSnapshotDoc; processed: number; skipped: number } {
  const raws: RawImpactItem[] = items.map((it) => ({
    productType: it.productType,
    grade: it.grade,
    reuse: it.reuse,
    resold: it.resold,
    scrap: it.scrap,
  }));

  const { snapshot, processed, skipped } = buildImpactSnapshotFromRaw(raws);

  const doc: ReportSnapshotDoc = {
    type: "sustainability",
    filters,
    snapshot,
    itemIds,
    meta: {
      createdAt: Date.now(),
      createdBy,
      schemaVersion: snapshot.schemaVersion,
    },
  };

  return { doc, processed, skipped };
}

// --- Firestore-write: spara snapshot i "reports" ---


/**
 * Sparar ett färdigt ReportSnapshotDoc i collection "reports".
 * Returnerar skapade dokumentets id.
 */
export async function saveReportSnapshotDoc(doc: ReportSnapshotDoc): Promise<string> {
  const ref = await addDoc(collection(db, "reports"), doc as any);
  return ref.id;
}
