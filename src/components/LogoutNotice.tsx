// src/components/LogoutNotice.tsx
import React from "react";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";

type Props = {
    seconds?: number;         // startvärde (default 10)
    onLoggedOut?: () => void; // callback efter signOut
};

export default function LogoutNotice({ seconds = 10, onLoggedOut }: Props) {
    const [left, setLeft] = React.useState<number>(Math.max(0, seconds));

    React.useEffect(() => {
        if (left <= 0) return;
        const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
        return () => window.clearInterval(id);
    }, [left]);

    React.useEffect(() => {
        if (left === 0) {
            signOut(auth).finally(() => onLoggedOut?.());
        }
    }, [left, onLoggedOut]);

    const handleLogoutNow = async () => {
        setLeft(0);
        await signOut(auth);
        onLoggedOut?.();
    };

    return (
        <div
            role="alert"
            aria-live="assertive"
            style={{
                position: "fixed",
                right: 16,
                bottom: 16,
                zIndex: 9999,
                maxWidth: 420,

                // ✨ använd dina theme-tokens så mörkt/ljust matchar appen
                background: "var(--surface)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: "12px",
                boxShadow: "var(--shadow-md)",
                padding: 16,
            }}
            className="gw-card"
        >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
                Dina behörigheter har uppdaterats
            </div>
            <div style={{ opacity: 0.95 }}>
                Du loggas ut om <strong>{left}</strong> sekunder.
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                    type="button"
                    onClick={handleLogoutNow}
                    className="btn btn-primary"
                    style={{ padding: "8px 12px", borderRadius: 8 }}
                >
                    Logga ut nu
                </button>
            </div>
        </div>
    );
}
