// functions/src/index.ts
import {
  onCall,
  CallableRequest,
  HttpsError,
  onRequest,
} from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

initializeApp();

const REGION = "europe-west1";
type Role = "admin" | "user" | "customer";

type Claims = {
  role?: Role;
} & Record<string, unknown>;

function getRoleFromClaims(claims: unknown): Role {
  const c = claims as Claims | undefined;
  const isAdmin =
    c?.role === "admin" ||
    (c as any)?.admin === true ||
    ((c as any)?.roles && (c as any).roles.admin === true);

  if (isAdmin) return "admin";
  if (c?.role === "customer") return "customer";
  return "user";
}

// Endast inloggad admin får fortsätta
function assertAdmin(req: CallableRequest<unknown>): void {
  if (!req.auth) {
    throw new HttpsError("unauthenticated", "Måste vara inloggad.");
  }
  const role = getRoleFromClaims(req.auth.token);
  if (role !== "admin") {
    throw new HttpsError("permission-denied", "Endast admin.");
  }
}

/** Sätt roll: admin | user */
export const setUserRole = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);

  const data = req.data as { uid?: string; role?: Role };
  const uid = data.uid ?? "";
  const role = data.role;

  if (!uid || (role !== "admin" && role !== "user")) {
    throw new HttpsError("invalid-argument", "uid/role saknas eller ogiltig.");
  }

  await getAuth().setCustomUserClaims(uid, { role });
  return { ok: true as const };
});

export type PublicUser = {
  uid: string;
  email: string | undefined;
  displayName: string | undefined;
  disabled: boolean;
  role: Role;
  emailVerified: boolean;
  createdAt: string | undefined;
  lastLoginAt: string | undefined;
};

/** Lista alla användare (paginering server-side) */
export const listUsers = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);

  const users: PublicUser[] = [];
  let nextPageToken: string | undefined = undefined;

  do {
    const res = await getAuth().listUsers(1000, nextPageToken);
    for (const u of res.users) {
      const role = getRoleFromClaims(u.customClaims);
      users.push({
        uid: u.uid,
        email: u.email ?? undefined,
        displayName: u.displayName ?? undefined,
        disabled: u.disabled,
        role,
        emailVerified: u.emailVerified,
        createdAt: u.metadata.creationTime ?? undefined,
        lastLoginAt: u.metadata.lastSignInTime ?? undefined,
      });
    }
    nextPageToken = res.pageToken;
  } while (nextPageToken);

  return { users };
});

/** Radera användare */
export const deleteUser = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);

  const data = req.data as { uid?: string };
  const uid = data.uid ?? "";

  if (!uid) {
    throw new HttpsError("invalid-argument", "uid saknas.");
  }

  await getAuth().deleteUser(uid);
  return { ok: true as const };
});

/** Skapa återställningslänk (admin delar länken vidare) */
export const triggerPasswordReset = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);

  const data = req.data as { email?: string };
  const email = data.email ?? "";

  if (!email) {
    throw new HttpsError("invalid-argument", "email saknas.");
  }

  const link = await getAuth().generatePasswordResetLink(email);
  return { resetLink: link };
});

/** Tillfällig: gör EN e-post till admin (ta bort efter användning) */
const ALLOWED = ["patrik.junno@convit.se"].map((e) => e.toLowerCase());

export const bootstrapMakeMeAdmin = onCall({ region: REGION }, async (req) => {
  const uid = req.auth?.uid;
  const email =
    (req.auth?.token?.email as string | undefined)?.toLowerCase() ?? "";

  if (!uid) {
    throw new HttpsError("unauthenticated", "Måste vara inloggad.");
  }
  if (!ALLOWED.includes(email)) {
    throw new HttpsError(
      "permission-denied",
      "Endast whitelistan får köra detta."
    );
  }

  await getAuth().setCustomUserClaims(uid, { role: "admin" });
  return { ok: true as const };
});

// -------------------------------------------------------------
// vendorLookup: "lätt" API som bygger garanti-länk per leverantör
// -------------------------------------------------------------

type VendorLookupRequest = {
  manufacturer?: string; // t.ex. "HP", "Lenovo", "Dell", "Apple"
  serial?: string;       // valfritt format; normaliseras
};

type VendorLookupResponse = {
  ok: true;
  normalizedSerial: string;        // t.ex. "5CG02382XZ"
  deepLink: string | null;         // garanti/deeplink om känd, annars null
  model: string | null;            // reserverat (null i lätt-läget)
  warrantyStartDate: string | null;// reserverat (null i lätt-läget)
  notes?: string;
};

// Normalisera serienummer: ta bort mellanrum/separatorer + versaler
function normalizeSerialKey(s: string): string {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.:/\\]/g, "");
}

// Bygg leverantörslänk (SE/SV varianter där det är vettigt)
function buildVendorDeepLink(manuRaw: string, sn: string): string | null {
  const m = (manuRaw || "").trim().toLowerCase();

  // HP: stödjer query-prefill
  if (["hp", "hewlett-packard", "hewlett packard"].includes(m)) {
    return `https://support.hp.com/se-sv/check-warranty?serialnumber=${encodeURIComponent(sn)}`;
  }

  // Lenovo: warrantylookup med ?serial=
  if (["lenovo", "ibm"].includes(m)) {
    return `https://pcsupport.lenovo.com/se/sv/warrantylookup?serial=${encodeURIComponent(sn)}`;
  }

  // Dell: service tag i query
  if (m === "dell") {
    return `https://www.dell.com/support/home/sv-se?app=warranty&servicetag=${encodeURIComponent(sn)}`;
  }

  // Apple: ofta captcha, men länken hjälper användaren
  if (m === "apple") {
    return `https://checkcoverage.apple.com/?sn=${encodeURIComponent(sn)}`;
  }

  return null;
}

/**
 * Callable: httpsCallable('vendorLookup')
 * In:  { manufacturer, serial }
 * Ut:  { ok, normalizedSerial, deepLink, model: null, warrantyStartDate: null }
 */
export const vendorLookup = onCall<VendorLookupRequest, VendorLookupResponse>(
  { region: REGION },
  (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Måste vara inloggad.");
    }

    const manufacturer = String(req.data?.manufacturer ?? "").trim();
    const normalizedSerial = normalizeSerialKey(String(req.data?.serial ?? ""));

    if (!normalizedSerial) {
      throw new HttpsError("invalid-argument", "Serial saknas eller är ogiltig.");
    }

    const deepLink = buildVendorDeepLink(manufacturer, normalizedSerial);

    return {
      ok: true,
      normalizedSerial,
      deepLink,
      model: null,
      warrantyStartDate: null,
      notes: deepLink
        ? "Öppna länken för detaljer. Automatisk hämtning kräver scraping/partner-API."
        : "Ingen direktlänk för vald tillverkare.",
    } satisfies VendorLookupResponse;
  }
);

// --- POC: Öppna HP-sida med Puppeteer och returnera sidtitel ---


// Hjälp: normalisera serienummer (UPPERCASE + ta bort whitespace/separatorer)
const normalizeSerialKeySrv = (s: string) =>
  (s || "").trim().toUpperCase().replace(/[\s\-_.:/\\]/g, "");

// --- HP warrantyskrapning — puppeteer-core + @sparticuz/chromium med nätverkssniff (TS-säker i Node) ---
// --- HP warrantyskrapning — puppeteer-core + @sparticuz/chromium med nätverkssniff (filtrerad) ---
// --- HP warrantyskrapning — puppeteer-core + @sparticuz/chromium + debug-trace ---
export const vendorScrapeHp = onCall(
  { region: REGION, timeoutSeconds: 120, memory: "1GiB" },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Logga in först.");

    const manu = String((req.data as any)?.manufacturer ?? "").toLowerCase().trim();
    const rawSerial = String((req.data as any)?.serial ?? "");
    const wantDebug = Boolean((req.data as any)?.debug);
    if (!rawSerial) throw new HttpsError("invalid-argument", "serial saknas.");

    const serial = normalizeSerialKeySrv(rawSerial);
    if (manu && !(manu === "hp" || manu.includes("hewlett"))) {
      throw new HttpsError("invalid-argument", "Endast HP stöds i denna funktion.");
    }

    const deepLink = `https://support.hp.com/se-sv/check-warranty?serialnumber=${encodeURIComponent(serial)}`;

    // helpers
    const t0 = Date.now();
    const dt = () => `${(Date.now() - t0).toString().padStart(4, " ")}ms`;
    const trace: string[] = [];
    const note = (m: string) => { trace.push(`[${dt()}] ${m}`); };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const parseLooseDateToISO = (raw: string): string | null => {
      if (!raw) return null;
      const norm = (s: string) =>
        s.toLowerCase().replace(/\./g, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const MONTHS: Record<string, number> = {};
      const add = (n: number, ...names: string[]) => names.forEach((k) => (MONTHS[norm(k)] = n));
      add(1, "jan", "january", "januari");
      add(2, "feb", "february", "februari");
      add(3, "mar", "march", "mars");
      add(4, "apr", "april");
      add(5, "may", "maj");
      add(6, "jun", "june", "juni");
      add(7, "jul", "july", "juli");
      add(8, "aug", "august", "augusti");
      add(9, "sep", "sept", "september");
      add(10, "oct", "october", "okt", "oktober");
      add(11, "nov", "november");
      add(12, "dec", "december");
      const pad2 = (n: number) => String(n).padStart(2, "0");
      const valid = (y: number, m: number, d: number) => {
        const t = new Date(y, m - 1, d);
        return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
      };
      let s = raw.trim().replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1").replace(/\./g, "");
      {
        const m = s.match(/^\s*([A-Za-zÅÄÖåäö]+)\s+(\d{1,2})(?:,)?\s+(\d{4})\s*$/);
        if (m) { const mo = MONTHS[norm(m[1])], d = +m[2], y = +m[3]; if (mo && valid(y, mo, d)) return `${y}-${pad2(mo)}-${pad2(d)}`; }
      }
      {
        const m = s.match(/^\s*(\d{1,2})\s+([A-Za-zÅÄÖåäö]+)\s+(\d{4})\s*$/);
        if (m) { const d = +m[1], mo = MONTHS[norm(m[2])], y = +m[3]; if (mo && valid(y, mo, d)) return `${y}-${pad2(mo)}-${pad2(d)}`; }
      }
      {
        const m = s.match(/^\s*(\d{4})[.\-/ ](\d{1,2})[.\-/ ](\d{1,2})\s*$/);
        if (m) { const y = +m[1], mo = +m[2], d = +m[3]; if (valid(y, mo, d)) return `${y}-${pad2(mo)}-${pad2(d)}`; }
      }
      {
        const m = s.match(/^\s*(\d{1,2})[.\-/ ](\d{1,2})[.\-/ ](\d{4})\s*$/);
        if (m) { const d = +m[1], mo = +m[2], y = +m[3]; if (valid(y, mo, d)) return `${y}-${pad2(mo)}-${pad2(d)}`; }
      }
      return null;
    };

    const STOPWORDS = [
      /kontrollera din garanti/i, /tillagd till instrumentpanelen/i, /instrumentpanelen/i,
      /hp support/i, /kundsupport/i, /supportcenter/i, /linux/i, /windows/i, /example/i, /exempel/i,
    ];
    const looksLikeOs = (s: string) => /^(linux|windows|mac\s?os|android|ios)\b/i.test((s || "").trim());
    const looksLikeModel = (s: string) => {
      const t = (s || "").trim();
      if (!t) return false;
      if (STOPWORDS.some((r) => r.test(t))) return false;
      if (looksLikeOs(t)) return false;
      const hasAlphaNum = /(?=.*[A-Za-z])(?=.*\d)/.test(t);
      const hpFamilies = /(probook|elitebook|envy|spectre|omen|pavilion|zbook|elitedesk|prodesk|eliteone|proone)/i;
      return (hasAlphaNum || hpFamilies.test(t)) && t.length >= 4;
    };
    const cleanModelCandidate = (raw: string): string => {
      let s = String(raw || "").trim();
      if (/^\s*(example|exempel)\b/i.test(s)) return "";
      s = s.replace(/^(product\s*name|produktnamn|model|modell)\s*[:：-]\s*/i, "");
      s = s.replace(/\|\s*hp\s+support.*$/i, "").trim();
      s = s.replace(/\s{2,}/g, " ").trim();
      return s;
    };

    // launch Chromium (servervänligt)
    const executablePath = await chromium.executablePath();
    const browser = await puppeteer.launch({
      executablePath,
      headless: chromium.headless,
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
    });

    // sniff-state + debug-metrics
    const captures: { model?: string | null; startRaw?: string | null } = {};
    const metrics = {
      consentClosed: false,
      serialFieldFound: false,
      serialValueAfterType: "" as string | undefined,
      submitClicked: false,
      navigated: false,
      jsonSeen: 0,
      relevantJsonUrls: [] as string[],
    };

    try {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(60_000);

      // response sniff
      page.on("response", async (res) => {
        try {
          const url = res.url();
          const hostOkay = /support\.hp\.com/i.test(url);
          const looksRelevant = /(warranty|coverage|serial|product|check|services|supportdata)/i.test(url);
          const looksIrrelevant = /(akam|geo|consent|browser|os|analytics|tealium|optimizely|privacy|cmp|survey|ping|dashboard|profile)/i.test(url);
          if (!hostOkay || !looksRelevant || looksIrrelevant) return;

          const ct = (res.headers()["content-type"] || "").toLowerCase();
          if (!ct.includes("application/json")) return;

          const text = await res.text();
          if (!text || text.length > 1_000_000) return;

          metrics.jsonSeen++;
          if (metrics.relevantJsonUrls.length < 5) metrics.relevantJsonUrls.push(url);

          let data: any; try { data = JSON.parse(text); } catch { return; }
          // pick from JSON
          const pickFromJson = (root: any): { model?: string; startRaw?: string } => {
            let foundModel: string | undefined;
            let foundDate: string | undefined;
            const keyLooksLikeModel = (k: string) => /(model(Name)?|product(Name)?|platform(Name)?|systemFamily|family(Name)?)/i.test(k);
            const keyLooksLikeStartDate = (k: string) =>
              /(warranty|coverage|service)?.*(start|begin)?.*date/i.test(k) ||
              /(start|begin).*date/i.test(k) || /startdate|begindate/i.test(k);
            const walk = (val: any, pk?: string) => {
              if (!val || typeof val === "function") return;
              if (typeof val === "string") {
                if (!foundModel && pk && keyLooksLikeModel(pk)) {
                  const c = cleanModelCandidate(val); if (looksLikeModel(c)) foundModel = c;
                }
                if (!foundDate && pk && keyLooksLikeStartDate(pk)) foundDate = parseLooseDateToISO(val) || val;
                return;
              }
              if (Array.isArray(val)) { for (const x of val) walk(x, pk); return; }
              if (typeof val === "object") {
                for (const [k, v] of Object.entries(val)) {
                  if (!foundModel && keyLooksLikeModel(k) && typeof v === "string") {
                    const c = cleanModelCandidate(v); if (looksLikeModel(c)) foundModel = c;
                  }
                  if (!foundDate && keyLooksLikeStartDate(k)) {
                    if (typeof v === "string") foundDate = parseLooseDateToISO(v) || v;
                    else if (typeof v === "number") {
                      const d = new Date(String(v).length >= 13 ? v : (String(v).length >= 10 ? v * 1000 : NaN));
                      if (!isNaN(d.getTime())) {
                        const pad2 = (n: number) => String(n).padStart(2, "0");
                        foundDate = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
                      }
                    } else walk(v, k);
                  } else walk(v, k);
                }
              }
            };
            walk(root, undefined);
            return { model: foundModel, startRaw: foundDate };
          };

          const picked = pickFromJson(data);
          if (picked.model && !captures.model) captures.model = picked.model;
          if (picked.startRaw && !captures.startRaw) captures.startRaw = picked.startRaw;
        } catch { /* ignore */ }
      });

      note(`goto ${deepLink}`);
      await page.goto(deepLink, { waitUntil: "domcontentloaded", timeout: 60_000 });

      // Close consent if present
      try {
        const closed = await page.evaluate(() => {
          const doc: any = (globalThis as any).document;
          if (!doc?.querySelectorAll) return false;
          const btn: any = Array.from(doc.querySelectorAll("button") || []).find((b: any) =>
            /accept|consent|godkänn|acceptera/i.test(String((b as any)?.textContent || "")));
          if (btn && typeof (btn as any).click === "function") { (btn as any).click(); return true; }
          return false;
        });
        metrics.consentClosed = !!closed;
        if (closed) note("consent closed");
        await sleep(600);
      } catch { /* ignore */ }

      // Fill serial (verify by reading value back)
      let selectorUsed: string | null = null;
      try {
        const selectors = [
          'input[name="serialnumber"]',
          'input[id*="serial"]',
          'input[aria-label*="Serial"]',
          'input[placeholder*="serial"]',
          'input[placeholder*="Serienummer"]',
        ];
        for (const sel of selectors) {
          const handle = await page.$(sel);
          if (handle) {
            selectorUsed = sel;
            metrics.serialFieldFound = true;
            await handle.click({ clickCount: 3 }).catch(() => { });
            await handle.type(serial, { delay: 15 });
            // Läs tillbaka värdet
            const val = await page.$eval(sel, (el: any) => String((el as any).value || "").trim()).catch(() => "");
            metrics.serialValueAfterType = val || "";
            note(`typed serial into ${sel} → "${val}"`);
            break;
          }
        }
        if (!metrics.serialFieldFound) note("serial input not found (deep link may pre-fill server-side)");
      } catch {
        note("error while typing serial (ignored)");
      }

      // Click submit if we found a field (otherwise rely on deepLink result)
      if (metrics.serialFieldFound) {
        try {
          const submitSel = 'button[type="submit"], button[id*="submit"], form button';
          const submitHandle = await page.$(submitSel);
          if (submitHandle) {
            await submitHandle.click().catch(() => { });
            metrics.submitClicked = true;
            note(`submit clicked`);
            await Promise.race([
              page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60_000 }).then(() => { metrics.navigated = true; note("navigated after submit"); }).catch(() => { }),
              sleep(2_000),
            ]);
          } else {
            note("no submit button found");
          }
        } catch {
          note("submit attempt failed (ignored)");
        }
      }

      // Give XHRs a moment
      await sleep(2_000);

      // If we reached a warranty result page, use that as deepLink
      const curUrl = page.url();
      const landedOnResult = /\/warrantyresult\//i.test(curUrl);
      const finalDeepLink = landedOnResult ? curUrl : deepLink;
      note(`final URL: ${curUrl} (landedOnResult=${landedOnResult})`);

      // DOM fallback if still missing fields
      if (!captures.model || !captures.startRaw) {
        const domPick = await page.evaluate(() => {
          const doc: any = (globalThis as any).document;

          const dataNameEl: any = doc?.querySelector?.("[data-product-name]") || null;
          const dataName = (dataNameEl && dataNameEl.getAttribute?.("data-product-name")) || "";

          // JSON-LD Product
          let ldName = "";
          try {
            const scripts: any[] = Array.from(doc?.querySelectorAll?.('script[type="application/ld+json"]') || []);
            for (const s of scripts) {
              const txt = String(((s as any)?.textContent || (s as any)?.innerText || "")).trim();
              if (!txt) continue;
              let parsed: any;
              try { parsed = JSON.parse(txt); } catch { continue; }
              const arr = Array.isArray(parsed) ? parsed : [parsed];
              for (const node of arr) {
                if (node && typeof node === "object" && (node["@type"] === "Product" || node["@type"] === "product")) {
                  ldName = String((node as any).name || (node as any).model || (node as any).mpn || "");
                  if (ldName) break;
                }
              }
              if (ldName) break;
            }
          } catch { }

          const h1 = String(doc?.querySelector?.("h1")?.textContent || "").trim();
          const h2 = String(doc?.querySelector?.("h2")?.textContent || "").trim();
          const ogTitle = String(doc?.querySelector?.('meta[property="og:title"]')?.content || "").trim();

          const bodyText = String(doc?.body?.innerText || "");
          let startDateRaw = "";
          try {
            const LABELS = /(start\s*date|startdatum|coverage\s*start)/i;
            const blocks: any[] = Array.from(doc?.querySelectorAll?.("dl, table, section, article, div, li") || []);
            for (const el of blocks) {
              const t = String(((el as any)?.innerText || (el as any)?.textContent || "")).replace(/\s+/g, " ").trim();
              if (!LABELS.test(t)) continue;
              const m = t.match(
                /([A-Za-zÅÄÖåäö]+\.?\s+\d{1,2},?\s+\d{4})|(\d{1,2}\s+[A-Za-zÅÄÖåäö]+\s+\d{4})|(\d{4}[.\-/ ]\d{1,2}[.\-/ ]\d{1,2})|(\d{1,2}[.\-/ ]\d{1,2}[.\-/ ]\d{4})/
              );
              if (m) { startDateRaw = m[0]; break; }
            }
            if (!startDateRaw) {
              const m2 = bodyText.match(
                /(?:^|\s)(?:start\s*date|startdatum|coverage\s*start)(?:\s|:|$).*?((?:[A-Za-zÅÄÖåäö]+\.?\s+\d{1,2},?\s+\d{4})|(?:\d{1,2}\s+[A-Za-zÅÄÖåäö]+\s+\d{4})|(?:\d{4}[.\-/ ]\d{1,2}[.\-/ ]\d{1,2})|(?:\d{1,2}[.\-/ ]\d{1,2}[.\-/ ]\d{4}))/
              );
              if (m2) startDateRaw = m2[1];
            }
          } catch { }

          const candidateModelRaw = (dataName || ldName || h1 || h2 || ogTitle || "").trim();
          return { candidateModelRaw, startDateRaw };
        });

        if (domPick) {
          const cleaned = cleanModelCandidate(domPick.candidateModelRaw || "");
          if (cleaned && looksLikeModel(cleaned) && !captures.model) captures.model = cleaned;
          if (domPick.startDateRaw && !captures.startRaw) captures.startRaw = domPick.startDateRaw;
        }
      }

      const warrantyStartDate = captures.startRaw ? (parseLooseDateToISO(captures.startRaw) || null) : null;

      // optional debug assets
      let screenshotDataUrl: string | undefined;
      let htmlSnippet: string | undefined;
      if (wantDebug) {
        try {
          const buf = await page.screenshot({ type: "jpeg", quality: 50 });
          const b64 = Buffer.from(buf).toString("base64");
          screenshotDataUrl = `data:image/jpeg;base64,${b64.slice(0, 200000)}`; // ~200KB cap
        } catch { }
        try {
          const html = await page.content();
          htmlSnippet = html.slice(0, 100000); // cap
        } catch { }
      }

      const resp = {
        ok: true as const,
        normalizedSerial: serial,
        deepLink: finalDeepLink,
        model: captures.model || null,
        warrantyStartDate,
        notes: "",
        debug: wantDebug ? {
          steps: trace,
          consentClosed: metrics.consentClosed,
          serialFieldFound: metrics.serialFieldFound,
          serialValueAfterType: metrics.serialValueAfterType,
          submitClicked: metrics.submitClicked,
          navigated: metrics.navigated,
          jsonSeen: metrics.jsonSeen,
          relevantJsonUrls: metrics.relevantJsonUrls,
          selectorUsed,
          finalUrl: page.url(),
          landedOnResult: /\/warrantyresult\//i.test(page.url()),
          screenshotDataUrl,
          htmlSnippet,
        } : undefined,
      };

      // spegla trace i loggen också
      try { console.log("vendorScrapeHp trace:", { serial, steps: trace }); } catch { }
      return resp;

    } catch (e: any) {
      try { console.error("vendorScrapeHp error:", e); } catch { }
      return {
        ok: false as const,
        normalizedSerial: serial,
        deepLink,
        model: null,
        warrantyStartDate: null,
        notes: `Scrape error: ${e?.message || e}`,
      };
    } finally {
      try { await browser.close(); } catch { }
    }

    function normalizeSerialKeySrv(s: string): string {
      return (s || "").trim().toUpperCase().replace(/[\s\-_.:/\\]/g, "");
    }
  }
);

// --- setUserClaims: admin sätter roll/status + ev. customerKeys ---
// Anropas från Admin-UI: call('setUserClaims', { uid, role, status, customerKeys? })


type AccountRole = "admin" | "user" | "customer";
type AccountStatus = "pending" | "active" | "disabled";

// functions/src/index.ts

import { buildCO2PreviewHandler } from "./reports/buildCO2Preview";
export const buildCO2Preview = onRequest({ region: REGION }, buildCO2PreviewHandler);



export const setUserClaims = onCall(
  { region: REGION },
  async (req: CallableRequest<{ uid?: string; role?: AccountRole; status?: AccountStatus; customerKeys?: string[] }>) => {
    // 1) Endast admin får köra
    assertAdmin(req);

    const uid = String(req.data?.uid || "");
    const role = req.data?.role as AccountRole | undefined;
    const status = req.data?.status as AccountStatus | undefined;
    let customerKeys = req.data?.customerKeys;

    // 2) Validera indata
    if (!uid) throw new HttpsError("invalid-argument", "uid saknas.");
    const validRoles: AccountRole[] = ["admin", "user", "customer"];
    const validStatus: AccountStatus[] = ["pending", "active", "disabled"];
    if (!role || !validRoles.includes(role)) throw new HttpsError("invalid-argument", "Ogiltig roll.");
    if (!status || !validStatus.includes(status)) throw new HttpsError("invalid-argument", "Ogiltig status.");

    if (role === "customer") {
      if (!Array.isArray(customerKeys) || customerKeys.length === 0) {
        throw new HttpsError("invalid-argument", "customerKeys krävs för kundroll.");
      }
      customerKeys = customerKeys.map((k) => String(k).trim()).filter(Boolean);
      if (customerKeys.length === 0) {
        throw new HttpsError("invalid-argument", "customerKeys kan inte vara tom efter trim.");
      }

      // ✅ Hårdvalidera att varje key motsvarar ett customers/{id}-dokument
      const db = getFirestore();
      for (const key of customerKeys) {
        const snap = await db.doc(`customers/${key}`).get();
        if (!snap.exists) {
          throw new HttpsError("invalid-argument", `Okänd kund-id: ${key}`);
        }
      }
    } else {
      // Icke-kundroll → rensa ev. gamla kopplingar
      customerKeys = [];
    }

    // 3) Sätt custom claims i Auth
    await getAuth().setCustomUserClaims(uid, { role, status, customerKeys });

    // 4) Spegla till users/{uid} (för Admin-UI; ej säkerhetskritiskt)
    try {
      const db = getFirestore();
      await db.doc(`users/${uid}`).set(
        {
          role,
          status,
          customerKeys,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn("users/{uid} mirror failed:", e);
    }

    // 5) Svar till klient
    return {
      ok: true,
      applied: { role, status, customerKeys },
      requiresReauth: true,
    };
  }
);



export const createInvoiceReport = onCall({ region: REGION }, async (req) => {
  // 1) Endast admin
  assertAdmin(req);

  try {
    // 2) Input: itemIds krävs
    const itemIds = Array.isArray((req.data as any)?.itemIds)
      ? ((req.data as any).itemIds as unknown[]).map(String).filter(Boolean)
      : [];
    if (itemIds.length === 0) {
      throw new HttpsError("invalid-argument", "Saknar itemIds.");
    }

    const db = getFirestore();
    const uid = req.auth?.uid || "unknown";
    const email = (req.auth?.token?.email as string | undefined) || "unknown";
    console.log("[createInvoiceReport] input", { uid, email, count: itemIds.length, itemIds });

    // 3) Läs alla items (utanför transaktionen, för snabb 404/validering)
    const refs = itemIds.map((id) => db.collection("itInventory").doc(id));
    const snaps = await Promise.all(refs.map((r) => r.get()));
    const missing = snaps.filter((s) => !s.exists).map((s) => s.id);
    if (missing.length) {
      throw new HttpsError("not-found", `Saknar poster: ${missing.join(", ")}`);
    }

    type ItItemForReport = {
      id: string;
      completed?: boolean;
      invoiceReportId?: string | null;
      customer?: string | null;

      // möjliga fält för disposition & belopp (vi stödjer flera varianter)
      status?: "reuse" | "resold" | "scrap" | string;
      disposition?: "reuse" | "resold" | "scrap" | string;
      reused?: boolean;
      resold?: boolean;
      scrap?: boolean;
      amount?: number;
      price?: number;
      billingTotal?: number;
      totalAmount?: number;
    };

    const items: ItItemForReport[] = snaps.map((s) => ({ id: s.id, ...(s.data() as any) }));

    // 4) Validera: completed, exakt en kund, ej redan fakturerad
    const customers = new Set<string>();
    for (const it of items) {
      if (it.completed !== true) {
        throw new HttpsError("failed-precondition", `Post ${it.id} är inte markerad som färdig.`);
      }
      if (it.invoiceReportId) {
        throw new HttpsError("failed-precondition", `Post ${it.id} är redan kopplad till en rapport.`);
      }
      const cust = String(it.customer || "").trim();
      if (!cust) {
        throw new HttpsError("failed-precondition", `Post ${it.id} saknar kund.`);
      }
      customers.add(cust);
    }
    if (customers.size !== 1) {
      throw new HttpsError("failed-precondition", "Endast en kund per rapport. Justera dina markeringar.");
    }

    // 5) Summering (matchar din InvoiceReport.summary)
    const totalItems = items.length;

    const getDisposition = (x: ItItemForReport): "reuse" | "resold" | "scrap" | null => {
      const s = (x.status || x.disposition || "").toString().toLowerCase();
      if (s === "reuse") return "reuse";
      if (s === "resold") return "resold";
      if (s === "scrap") return "scrap";
      if (x.reused === true) return "reuse";
      if (x.resold === true) return "resold";
      if (x.scrap === true) return "scrap";
      return null;
    };

    let reused = 0, resold = 0, scrap = 0;
    for (const it of items) {
      const d = getDisposition(it);
      if (d === "reuse") reused++;
      else if (d === "resold") resold++;
      else if (d === "scrap") scrap++;
    }

    const pickAmount = (x: ItItemForReport): number =>
      Number(x.billingTotal ?? x.totalAmount ?? x.amount ?? x.price ?? 0) || 0;

    const totalAmount = items.reduce((sum, x) => sum + pickAmount(x), 0);

    const summary = { totalItems, reused, resold, scrap, totalAmount };

    // 6) Skapa namn + transaktion (ALLA READS före WRITES)
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const customer = [...customers][0];
    const name = `${customer} ${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;

    const reportsCol = db.collection("reports").doc("root").collection("fakturor");
    const reportRef = reportsCol.doc();

    await db.runTransaction(async (tx) => {
      // READS i transaktionen (skydd mot race)
      const itemSnaps = await Promise.all(
        itemIds.map((id) => tx.get(db.collection("itInventory").doc(id)))
      );

      for (const snap of itemSnaps) {
        if (!snap.exists) {
          throw new HttpsError("not-found", `Post ${snap.id} saknas.`);
        }
        const cur = snap.data() || {};
        if (cur.completed !== true) {
          throw new HttpsError("failed-precondition", `Post ${snap.id} är inte markerad som färdig.`);
        }
        if (cur.invoiceReportId) {
          throw new HttpsError("failed-precondition", `Post ${snap.id} är redan kopplad till en rapport.`);
        }
      }

      // WRITES
      tx.set(reportRef, {
        name,
        customer,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: (req.auth?.token?.email as string | undefined) ?? req.auth?.uid ?? null,
        itemIds: itemIds,
        summary,
        deletedAt: null,  // 🆕 soft-delete flagga
        deletedBy: null   // 🆕 vem tog bort (om null → aktiv rapport)
      });

      for (const snap of itemSnaps) {
        tx.update(snap.ref, {
          markedForInvoice: false,
          invoiceReportId: reportRef.id,
          invoicedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    console.log("[createInvoiceReport] ok", { reportId: reportRef.id, count: itemIds.length, summary });
    // 7) Svar
    return { ok: true as const, reportId: reportRef.id, name, customer, count: itemIds.length };

  } catch (err: any) {
    console.error("createInvoiceReport failed:", { message: err?.message, code: err?.code, stack: err?.stack });
    if (err?.constructor?.name === "HttpsError" || typeof err?.code === "string") throw err;
    throw new HttpsError("internal", err?.message || String(err) || "internal");
  }
});

export const deleteInvoiceReport = onCall({ region: REGION }, async (req) => {
  // Endast admin får köra
  assertAdmin(req);

  const reportId = String((req.data as any)?.reportId || "").trim();
  if (!reportId) {
    throw new HttpsError("invalid-argument", "reportId saknas.");
  }

  const db = getFirestore();
  const reportRef = db.collection("reports").doc("root").collection("fakturor").doc(reportId);

  await db.runTransaction(async (tx) => {
    // READS (måste ske före alla writes)
    const reportSnap = await tx.get(reportRef);
    if (!reportSnap.exists) {
      throw new HttpsError("not-found", "Rapporten finns inte.");
    }

    const report = reportSnap.data() as any;
    if (report?.deletedAt) {
      throw new HttpsError("failed-precondition", "Rapporten är redan borttagen (soft-delete).");
    }

    const itemIds: string[] = Array.isArray(report.itemIds)
      ? report.itemIds.map(String).filter(Boolean)
      : [];

    const itemSnaps = await Promise.all(
      itemIds.map((id) => tx.get(db.collection("itInventory").doc(id)))
    );

    // WRITES
    // 1) Markera rapporten som soft-deleted
    tx.update(reportRef, {
      deletedAt: FieldValue.serverTimestamp(),
      deletedBy:
        (req.auth?.token?.email as string | undefined) ??
        req.auth?.uid ??
        null,
    });

    // 2) Rulla tillbaka alla items: tillbaka till faktureringsvyn (markerade)
    for (const s of itemSnaps) {
      if (!s.exists) continue; // om något råkar vara raderat, hoppa över
      tx.update(s.ref, {
        // bort med koppling till rapporten
        invoiceReportId: FieldValue.delete(),
        // tillbaka till "markerad för fakturering"
        markedForInvoice: true,
        // ta bort ev. faktureringstid
        invoicedAt: FieldValue.delete(),
      });
    }
  });

  return { ok: true as const, reportId };
});


