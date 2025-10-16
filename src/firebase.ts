import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import type { FirebaseStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || "",
  authDomain: "it-returns.firebaseapp.com",
  projectId: "it-returns",
  storageBucket: "it-returns.firebasestorage.app", // kontrollera i Firebase Console
  messagingSenderId: "368686698016",
  appId: "1:368686698016:web:e376727b2881acdab93645",
};

// Initiera appen endast om den inte redan är initierad
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const db: Firestore = getFirestore(app);
export const storage: FirebaseStorage = getStorage(app);
export const auth = getAuth(app); // ⬅️ lägg till
