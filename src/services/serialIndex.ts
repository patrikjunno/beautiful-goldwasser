// src/services/serialIndex.ts
// Samlar all logik för serialIndex: normalisering, CREATE/EDIT/DELETE/UNDO,
// samt dev-verktyg (backfill och scan). Ingen förändring av befintlig logik krävs
// i andra filer förrän du själv byter imports där.

// --- Firebase ---
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  getFirestore,
  collection,
  getDocs,
  orderBy,
  startAfter,
  limit,
  query,
  writeBatch,
} from "firebase/firestore";
import { db as _db } from "../firebase";

// Om du någon gång vill kunna byta instans, kan du byta 'db' här:
const db = _db ?? getFirestore();

// === Typer ===
export type SerialIndexDoc = {
  lastVisit?: number;   // senast tilldelade visit (brukar == visits)
  visits?: number;      // totalt antal besök (hålls == lastVisit)
  active?: number;      // antal icke-raderade items
  lastSeen?: any;       // serverTimestamp()
  lastItemId?: string;  // senaste itemId som rörde indexet
};

// === Bashelpers ===

/** Normaliserar till index-nyckel: UPPERCASE + tar bort whitespace/separatorer */
export const normalizeSerialKey = (s: string): string =>
  (s || "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.:/\\]/g, "");

/** Tar t.ex. “ABC123*2” → { base: "ABC123", visit: 2 } (visit = 1 om saknas/ogiltigt) */
export function splitSerialParts(input: string): { base: string; visit: number } {
  const s = String(input || "").trim();
  const m = s.match(/^(.*?)(?:\*(\d+))?$/);
  if (!m) return { base: s, visit: 1 };
  const base = (m[1] || "").trim();
  const v = m[2] ? Math.max(1, parseInt(m[2], 10) || 1) : 1;
  return { base, visit: v };
}

/** Lätt normalisering för visningsfältet: trim + kollapsa inre whitespace */
export function normalizeSerial(s: string): string {
  return (s || "").trim().replace(/\s+/g, " ");
}

/** Bygger visningssträngen: “BASE*visit” om visit > 1 annars “BASE” */
export function buildDisplaySerial(base: string, visit: number): string {
  const b = normalizeSerial(base);
  return visit > 1 ? `${b}*${visit}` : b;
}

// === Guardrail/telemetri ===
export function warnIfInvariantBroken(ctx: {
  where: string;            // "CREATE", "EDIT:new", "EDIT:old", "SOFT-DELETE", "UNDO-DELETE" etc.
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

// === CREATE: Tilldelar nästa serialVisit och uppdaterar index atomiskt ===
export async function allocateSerialVisitOnCreate(
  itemId: string,
  originalSerialRaw: string
): Promise<{ serialBaseKey: string; serialVisit: number; displaySerial: string }> {
  // Plocka basdelen (utan *N i input)
  const parts = splitSerialParts(originalSerialRaw || "");
  const rawBase = parts.base;                      // behåll visningsformatet utan *suffix
  const baseKey = normalizeSerialKey(rawBase);     // index-id

  if (!baseKey) {
    throw new Error("Serienummer saknas eller kan inte normaliseras.");
  }

  const indexRef = doc(db, "serialIndex", baseKey);

  const visit = await runTransaction(db, async (tx) => {
    const snap = await tx.get(indexRef);
    const cur = (snap.exists() ? (snap.data() as SerialIndexDoc) : {}) || {};
    const nextVisit = (typeof cur.lastVisit === "number" ? cur.lastVisit : 0) + 1;
    const nextActive = (typeof cur.active === "number" ? cur.active : 0) + 1;

    // Förvarning om möjligt invariantsbrott
    if (typeof cur.visits === "number" && cur.visits < (cur.active ?? 0)) {
      console.warn("[serialIndex] invariant risk (före uppd): visits < active", { baseKey, cur });
    }

    const patch: SerialIndexDoc = {
      lastVisit: nextVisit,
      visits: nextVisit,           // håll visits == lastVisit
      active: nextActive,
      lastSeen: serverTimestamp(),
      lastItemId: itemId,
    };

    if (snap.exists()) {
      tx.update(indexRef, patch as any);
    } else {
      tx.set(indexRef, patch as any);
    }

    warnIfInvariantBroken({ where: "CREATE", baseKey, visits: nextVisit, active: nextActive });

    // Lokal post-check
    if (nextActive < 0 || nextVisit < nextActive) {
      console.warn("[serialIndex] invariant brott (efter uppd): visits < active", {
        baseKey, nextVisit, nextActive,
      });
    }

    return nextVisit;
  });

  // Bygg visningssträngen (ABC123*2 om visit > 1)
  const display = buildDisplaySerial(normalizeSerial(rawBase), visit);
  return { serialBaseKey: baseKey, serialVisit: visit, displaySerial: display };
}

// === EDIT: Byte av serienummer (reallocate) ===
export async function reallocateSerialOnEdit(
  itemId: string,
  prevBaseKey: string | null,
  nextSerial: string
): Promise<{
  changed: boolean;
  serialBaseKey: string;
  serialVisit: number;
  displaySerial: string;
}> {
  const { base: nextBaseRaw } = splitSerialParts(String(nextSerial || "").trim());
  const nextBaseKey = normalizeSerialKey(nextBaseRaw || "");

  if (!nextBaseKey) {
    throw new Error("[reallocateSerialOnEdit] nextBaseKey saknas (ogiltigt serienummer)");
  }

  // Om basen inte ändras: returnera nuvarande visit och display (ingen indexskrivning)
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

  // Transaktion: decrement på gammal bas + increment på ny bas + uppdatera item
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
        // Telemetri
        warnIfInvariantBroken({
          where: "EDIT:old",
          baseKey: oldRef.id,
          visits: Number(o.visits ?? o.lastVisit ?? 0) || 0,
          active: nextActive,
        });
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
        visits: nextVisit, // håll visits == lastVisit
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

    const displaySerial = nextVisit > 1 ? `${nextBaseRaw}*${nextVisit}` : nextBaseRaw;

    // 3) Uppdatera item (serial + bas + visit)
    tx.update(itemRef, {
      serial: displaySerial,
      serialBase: nextBaseKey,    // behålls om du använder detta fält
      serialBaseKey: nextBaseKey,
      serialVisit: nextVisit,
      updatedAt: nowServer,
    } as any);

    // Telemetri
    warnIfInvariantBroken({
      where: "EDIT:new",
      baseKey: newRef.id,
      visits: nextVisit,
      active: (newSnap.exists() ? Number((newSnap.data() as any).active ?? 0) + 1 : 1),
    });

    return {
      changed: true,
      serialBaseKey: nextBaseKey,
      serialVisit: nextVisit,
      displaySerial,
    };
  });
}

// === DELETE: soft-delete (active--) utan att röra visits/lastVisit ===
export async function applySoftDeleteSerialIndex(
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

    // visits/lastVisit lämnas orörda
    tx.update(idxRef, {
      active: nextActive,
      lastSeen: serverTimestamp(),
      lastItemId: itemId,
    } as any);

    warnIfInvariantBroken({
      where: "SOFT-DELETE",
      baseKey: idxRef.id,
      visits: (cur.visits ?? null),
      active: nextActive,
    });

    if (nextActive < 0 || (typeof cur.visits === "number" && cur.visits < nextActive)) {
      console.warn("[serialIndex] invariant risk efter soft-delete", {
        baseKey,
        visits: cur.visits,
        nextActive,
      });
    }
  });
}

// === UNDO DELETE: active++ utan att röra visits/lastVisit ===
export async function applyUndoSoftDeleteSerialIndex(
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

    tx.update(idxRef, {
      active: nextActive,
      lastSeen: serverTimestamp(),
      lastItemId: itemId,
    } as any);

    warnIfInvariantBroken({
      where: "UNDO-DELETE",
      baseKey: idxRef.id,
      visits: (cur.visits ?? null),
      active: nextActive,
    });

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
export async function backfillSerialIndex(opts?: { dryRun?: boolean; verbose?: boolean; pageSize?: number }) {
  const dryRun = opts?.dryRun ?? true;
  const verbose = opts?.verbose ?? true;
  const pageSize = Math.max(50, Math.min(500, opts?.pageSize ?? 200));

  type RowAgg = { maxVisit: number; active: number; lastItemId: string | null };

  let lastDoc: any = null;
  let total = 0;
  const bucket = new Map<string, RowAgg>();

  while (true) {
    const q = lastDoc
      ? query(collection(db, "itInventory"), orderBy("__name__"), startAfter(lastDoc), limit(pageSize))
      : query(collection(db, "itInventory"), orderBy("__name__"), limit(pageSize));

    const snap = await getDocs(q);
    if (snap.empty) break;

    for (const docSnap of snap.docs) {
      const x = (docSnap.data() as any) || {};
      const id = docSnap.id;

      const displaySerial: string = String(x.serial ?? "");
      const { base, visit } = splitSerialParts(displaySerial);
      const baseKey = normalizeSerialKey(base);
      if (!baseKey) continue;

      const deletePending = !!x.deletePending;

      const agg = bucket.get(baseKey) ?? { maxVisit: 0, active: 0, lastItemId: null };
      if (visit > agg.maxVisit) {
        agg.maxVisit = visit;
        agg.lastItemId = id;
      }
      if (!deletePending) agg.active += 1;

      bucket.set(baseKey, agg);
      total++;
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  if (verbose) console.log(`[backfillSerialIndex] items lästa: ${total}, index-baser: ${bucket.size}`);

  if (dryRun) {
    if (verbose) {
      // @ts-ignore: node-konsol i dev
      console.table(Array.from(bucket.entries()).map(([k, v]) => ({
        baseKey: k, visits: v.maxVisit, active: v.active, lastItemId: v.lastItemId,
      })));
    }
    return;
  }

  // Skriv index-dokumenten i batchar
  let batch = writeBatch(db);
  let i = 0;

  const entries = Array.from(bucket.entries());
for (let i = 0; i < entries.length; i++) {
  const [baseKey, agg] = entries[i];
  const idxRef = doc(db, "serialIndex", baseKey);
  batch.set(
    idxRef,
    {
      lastVisit: agg.maxVisit,
      visits: agg.maxVisit,
      active: agg.active,
      lastSeen: serverTimestamp(),
      lastItemId: agg.lastItemId ?? null,
    } as SerialIndexDoc,
    { merge: true }
  );

  // Commit i chunkar (400 är en säker marginal)
  if ((i + 1) % 400 === 0) {
    await batch.commit();
    batch = writeBatch(db);
  }
}
await batch.commit();
  if (verbose) console.log("[backfillSerialIndex] backfill klart.");
}

// === DEV: Skanna index för invariants och enkel “hål”-hint ===
// (Riktig håldetektering kräver scan av items per baseKey; här gör vi grundkontroller.)
export async function scanSerialIndexForIssues(opts?: { verbose?: boolean }) {
  const verbose = opts?.verbose ?? true;
  const idxSnap = await getDocs(query(collection(db, "serialIndex"), limit(10000)));
  const issues: Array<{ baseKey: string; visits: number; lastVisit: number; active: number; problem: string }> = [];

  for (const d of idxSnap.docs) {
    const x = (d.data() as any) || {};
    const baseKey = d.id;
    const visits = Number(x.visits ?? 0) || 0;
    const lastVisit = Number(x.lastVisit ?? visits ?? 0) || 0;
    const active = Number(x.active ?? 0) || 0;

    if (active < 0 || visits < active || visits !== lastVisit) {
      issues.push({ baseKey, visits, lastVisit, active, problem: "invariant/hint" });
    }
  }

  if (verbose) {
    if (issues.length) {
      // @ts-ignore: node-konsol i dev
      console.table(issues);
    } else {
      console.log("[scanSerialIndexForIssues] inga uppenbara fel hittade.");
    }
  }
  return issues;
}
