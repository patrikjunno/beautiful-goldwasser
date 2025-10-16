// src/firebase.ts
import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import type { FirebaseStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

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
    __GOLDWASSER_CONFIG__?: {
      firebase?: RuntimeFirebaseConfig;
    };
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
  apiKey:
    process.env.REACT_APP_FIREBASE_API_KEY ||
    "",

  authDomain:
    process.env.REACT_APP_FIREBASE_AUTH_DOMAIN ||
    "it-returns.firebaseapp.com",

  projectId:
    process.env.REACT_APP_FIREBASE_PROJECT_ID ||
    "it-returns",

  // OBS: Bucket-namnet i Firebase brukar vara <project-id>.appspot.com.
  // Vi behåller ditt nuvarande default så att inget bryts här.
  storageBucket:
    process.env.REACT_APP_FIREBASE_STORAGE_BUCKET ||
    "it-returns.firebasestorage.app",

  messagingSenderId:
    process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID ||
    "368686698016",

  appId:
    process.env.REACT_APP_FIREBASE_APP_ID ||
    "1:368686698016:web:e376727b2881acdab93645",
};

// ---- Slutlig config: env som bas, runtime får prioritet (överskriver env) ----
const firebaseConfig = {
  ...envCfg,
  ...runtimeCfg,
};

// ---- Initiera appen endast en gång ----
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const db: Firestore = getFirestore(app);
export const storage: FirebaseStorage = getStorage(app);
export const auth = getAuth(app);
