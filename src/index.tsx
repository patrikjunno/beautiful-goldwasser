import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import './styles.css';

const rootElement = document.getElementById("root")!;
const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// --- DEV HELPERS: registrera på window (endast i dev) ---
if (process.env.NODE_ENV !== "production") {
  (function initDevHelpers() {
    const ensureAuthReady = async () => {
      const w = window as any;
      if (!w.auth) throw new Error("Auth/App saknas. Ladda om och logga in.");
      if (!w.auth.currentUser) {
        await new Promise<void>((resolve) => {
          const off = w.auth.onAuthStateChanged((u: any) => { if (u) { off(); resolve(); } });
        });
      }
      await w.auth.currentUser.getIdToken(true);
      return w.auth.app;
    };

    const getFns = async () => {
      const app = await ensureAuthReady();
      const { getFunctions } = await import("firebase/functions");
      return getFunctions(app, "europe-west1");
    };

    (window as any).callFn = async (name: string, data: any = {}) => {
      const fns = await getFns();
      const { httpsCallable } = await import("firebase/functions"); // ✅ denna
      const call = httpsCallable(fns, name);                        // ✅ bara namn
      const res = await call(data);
      console.log(`[callFn:${name}]`, res.data);
      return res.data;
    };

    (window as any).whoAmI = () => (window as any).callFn("whoAmI", {});
    (window as any).wipeAllTestData = async () => {
      const data = await (window as any).callFn("wipeAllTestData", {});
      alert("Wipe DONE (server).");
      return data;
    };

    console.log("[dev-helpers] callFn, whoAmI, wipeAllTestData registrerade på window (index.tsx)");
  })();
}
// --- END DEV HELPERS ---
