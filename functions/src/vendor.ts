// functions/src/vendor.ts
// Lätt vendor-lookup (ingen puppeteer): normaliserar serienummer och ger ev. garanti-deeplink.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { REGION } from "./_admin";

type VendorLookupRequest = {
    manufacturer?: string; // "HP" | "Lenovo" | "Dell" | "Apple" | ...
    serial?: string;
};

type VendorLookupResponse = {
    ok: true;
    normalizedSerial: string;
    deepLink: string | null;
    model: null;              // reserverat för framtiden
    warrantyStartDate: null;  // reserverat för framtiden
    notes?: string;
};

// Normalisera serienummer: ta bort whitespace/separatorer + versaler
function normalizeSerialKey(s: string): string {
    return String(s || "")
        .trim()
        .toUpperCase()
        .replace(/[\s\-_.:/\\]/g, "");
}

// Bygg leverantörslänk (SE/SV där det är rimligt)
function buildVendorDeepLink(manuRaw: string, sn: string): string | null {
    const m = (manuRaw || "").trim().toLowerCase();

    if (["hp", "hewlett-packard", "hewlett packard"].includes(m)) {
        return `https://support.hp.com/se-sv/check-warranty?serialnumber=${encodeURIComponent(sn)}`;
    }
    if (["lenovo", "ibm"].includes(m)) {
        return `https://pcsupport.lenovo.com/se/sv/warrantylookup?serial=${encodeURIComponent(sn)}`;
    }
    if (m === "dell") {
        return `https://www.dell.com/support/home/sv-se?app=warranty&servicetag=${encodeURIComponent(sn)}`;
    }
    if (m === "apple") {
        return `https://checkcoverage.apple.com/?sn=${encodeURIComponent(sn)}`;
    }
    return null;
}

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
        };
    }
);
