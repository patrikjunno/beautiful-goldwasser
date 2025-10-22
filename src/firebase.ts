// src/firebase.ts
import { initializeApp, getApps } from "firebase/app";

import { getFirestore } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";

import { getStorage } from "firebase/storage";
import type { FirebaseStorage } from "firebase/storage";

import { getAuth } from "firebase/auth";

// import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

// ---- Typer för runtime-config (från /config.js) ----
type RuntimeFirebaseConfig = {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
};

declare global {
  interface Window {
    __GOLDWASSER_CONFIG__?: { firebase?: RuntimeFirebaseConfig };
  }
}

// ---- Hämta runtime-config om den finns ----
const runtimeCfg: RuntimeFirebaseConfig =
  (typeof window !== "undefined" &&
    window.__GOLDWASSER_CONFIG__ &&
    window.__GOLDWASSER_CONFIG__.firebase) ||
  {};

// ---- Miljövariabler (CRA) med rimliga fallback-värden ----
const envCfg = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || "",
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || "it-returns.firebaseapp.com",
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || "it-returns",
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || "it-returns.firebasestorage.app",
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || "368686698016",
  appId: process.env.REACT_APP_FIREBASE_APP_ID || "1:368686698016:web:e376727b2881acdab93645",
};

// ---- Slutlig config: env som bas, runtime får prioritet ----
const firebaseConfig = { ...envCfg, ...runtimeCfg };

// ---- Initiera appen endast en gång ----
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// ===== Email verification settings =====
export const EMAIL_VERIFICATION_ACS = {
  url: "https://it-returns.web.app/verify", // sida i din app som tar emot oobCode
  handleCodeInApp: true,
};

// ---- App Check (reCAPTCHA v3) ----
const appCheckSiteKey =
  process.env.REACT_APP_RECAPTCHA_SITE_KEY ||
  (typeof window !== "undefined" && (window as any).__GOLDWASSER_CONFIG__?.appCheck?.siteKey) ||
  "";



  // ✅ Initiera bara i production (undvik X-Firebase-AppCheck i dev)
// if (process.env.NODE_ENV === "production" && appCheckSiteKey) {
 // try {
  //  initializeAppCheck(app, {
    //  provider: new ReCaptchaV3Provider(appCheckSiteKey),
     // isTokenAutoRefreshEnabled: true,
   // });
 // } catch (err) {
  //  console.warn("[AppCheck] init failed:", err);
 // }
// }



/*
// 🔕 DEV: inaktiverad för att undvika CORS/preflight i utveckling
try {
  const hasDebugToken =
    process.env.NODE_ENV !== "production" &&
    typeof window !== "undefined" &&
    (window as any).__APPCHECK_DEBUG_TOKEN__;

  if (hasDebugToken) {
    // @ts-ignore
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = (window as any).__APPCHECK_DEBUG_TOKEN__;
  }

  if (appCheckSiteKey || hasDebugToken) {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckSiteKey || "debug"),
      isTokenAutoRefreshEnabled: true,
    });
  }
} catch (err) {
  console.warn("[AppCheck] init failed:", err);
}
*/




// ---- Init Auth, Firestore och Storage ----
export const auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export const storage: FirebaseStorage = getStorage(app, "gs://it-returns.firebasestorage.app");


// --- Debug: visa endast om ?debug=1 OCH appen explicit tillåter (admin) ---
declare global { interface Window { __GW_DEBUG__?: any; __GW_DEBUG_ALLOWED__?: boolean } }

try {
  const DEBUG =
    typeof window !== "undefined" &&
    new URLSearchParams(location.search).get("debug") === "1";

  // liten helper så vi kan logga när appen ger klartecken
  const logDebug = () => {
    const safeOptions = { ...app.options, apiKey: "★redacted★" };
    (window as any).__GW_DEBUG__ = {
      firebaseOptions: safeOptions,
      projectId: app.options.projectId,
      storageBucket: app.options.storageBucket,
      authDomain: app.options.authDomain,
    };
    console.log("[env] firebase options", safeOptions);
    console.log("[build] commit", process.env.REACT_APP_COMMIT_SHA || "unknown");
    console.log("[build] time  ", process.env.REACT_APP_BUILD_TIME || "unknown");
  };

  // logga direkt om admin redan hunnit tillåta
  if (DEBUG && (window as any).__GW_DEBUG_ALLOWED__ === true) {
    logDebug();
  }

  // annars: vänta på “gw:debug-ready” från App.tsx (när vi vet att user är admin)
  if (DEBUG) {
    document.addEventListener("gw:debug-ready", () => {
      if ((window as any).__GW_DEBUG_ALLOWED__ === true) logDebug();
    }, { once: true });
  }
} catch { }


// Gör auth tillgänglig i DevTools i dev-läge
if (process.env.NODE_ENV !== "production") {
  (window as any).auth = auth;
}