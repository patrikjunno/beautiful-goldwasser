// src/services/productTypes.ts
// ------------------------------------------------------
// Läser productTypes från Firestore och matar in i impact-cachen.
// Kopplas in från t.ex. rapportvyns useEffect senare.
// ------------------------------------------------------
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { primeProductTypesFromData } from "../lib/impact";
import type { ProductTypeDoc } from "../lib/impact";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

/**
 * Hämtar alla productTypes och prime:ar impact-modulens cache.
 * Returnerar antal inlästa dokument.
 */
export async function loadProductTypesForImpact(): Promise<number> {
  const snap = await getDocs(collection(db, "productTypes"));
  const docs: ProductTypeDoc[] = [];

  snap.forEach((d) => {
    const data = d.data() as any;
    // Kartlägg säkert; kräver att dokumentets id matchar ProductType
    const doc: ProductTypeDoc = {
      id: d.id as ProductTypeDoc["id"],
      medianWeightKg: Number(data?.medianWeightKg ?? 0),
      co2PerUnitKg: Number(data?.co2PerUnitKg ?? 0),
      label: typeof data?.label === "string" ? data.label : undefined,
      schemaVersion:
        typeof data?.schemaVersion === "number" ? data.schemaVersion : undefined,
    };
    docs.push(doc);
  });

  primeProductTypesFromData(docs);
  return docs.length;
}
/**
 * Säkerställ att en productType finns i DB. Skapar doc om den saknas.
 * - id: lowercase slug (t.ex. "laptop")
 * - label: visningsnamn ("Laptop"), om ej satt används id
 * - defaults: valfria startvärden (om okända, sätt 0/konservativt)
 */
export async function ensureProductTypeInDb(
  id: string,
  label?: string,
  defaults?: { medianWeightKg?: number; co2PerUnitKg?: number }
): Promise<void> {
  const cleanId = String(id || "").trim().toLowerCase();
  if (!cleanId) return;

  const ref = doc(db, "productTypes", cleanId);
  const snap = await getDoc(ref);
  if (snap.exists()) return; // redan finns → klart

  const medianWeightKg = Number(defaults?.medianWeightKg ?? 0);
  const co2PerUnitKg = Number(defaults?.co2PerUnitKg ?? 0);

  await setDoc(ref, {
    label: label && label.trim() ? label.trim() : cleanId,
    medianWeightKg,
    co2PerUnitKg,
    schemaVersion: 1,
    updatedAt: serverTimestamp(),
    updatedBy: "system", // kan bytas till auth.currentUser?.uid om du vill
  });
}
