// src/firebase.ts
import { initializeApp, getApps } from "firebase/app";

import { getFirestore } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";

import { getStorage } from "firebase/storage";
import type { FirebaseStorage } from "firebase/storage";

import { getAuth } from "firebase/auth";

import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

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
  // SDK använder appspot.com
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || "it-returns.appspot.com",
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || "368686698016",
  appId: process.env.REACT_APP_FIREBASE_APP_ID || "1:368686698016:web:e376727b2881acdab93645",
};

// ---- Slutlig config: env som bas, runtime får prioritet ----
const firebaseConfig = { ...envCfg, ...runtimeCfg };

// ---- Initiera appen endast en gång ----
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// ---- App Check (reCAPTCHA v3) ----
// Site key tas från .env.production (CRA) eller ev. runtime-config om det finns
const appCheckSiteKey =
  process.env.REACT_APP_RECAPTCHA_SITE_KEY ||
  (typeof window !== "undefined" &&
    (window as any).__GOLDWASSER_CONFIG__?.appCheck?.siteKey) ||
  "";

if (appCheckSiteKey) {
  try {
    // Valfritt: lokal debug (sätt window.__APPCHECK_DEBUG_TOKEN__ i dev-konsolen)
    // @ts-ignore
    if (process.env.NODE_ENV !== "production" && (window as any).__APPCHECK_DEBUG_TOKEN__) {
      // @ts-ignore
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = (window as any).__APPCHECK_DEBUG_TOKEN__;
    }

    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn("[AppCheck] init failed:", err);
  }
}


// ---- Init Auth, Firestore och Storage ----
export const auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export const storage: FirebaseStorage = getStorage(app);

// Gör auth tillgänglig i DevTools i dev-läge
if (process.env.NODE_ENV !== "production") {
  (window as any).auth = auth;
}