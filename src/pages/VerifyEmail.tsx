import React from "react";
import { auth } from "../firebase";
import { applyActionCode, reload, sendEmailVerification } from "firebase/auth";
import { EMAIL_VERIFICATION_ACS } from "../firebase";

function useQuery() {
    return new URLSearchParams(window.location.search);
}

export default function VerifyEmail() {
    const [state, setState] = React.useState<
        | { kind: "checking" }
        | { kind: "success" }
        | { kind: "already" }
        | { kind: "error"; code?: string; message?: string }
        | { kind: "need-login" }
        | { kind: "resent" }
    >({ kind: "checking" });

    React.useEffect(() => {
        const qs = useQuery();
        const mode = qs.get("mode");
        const oobCode = qs.get("oobCode");

        // Endast verifyEmail-händelser hanteras här
        if (mode !== "verifyEmail" || !oobCode) {
            setState({ kind: "error", message: "Ogiltig länk." });
            return;
        }

        // Om redan inloggad och verifierad, var klar direkt
        const u = auth.currentUser;
        if (u?.emailVerified) {
            setState({ kind: "already" });
            return;
        }

        // Försök applicera koden
        (async () => {
            try {
                await applyActionCode(auth, oobCode);
                // uppdatera användaren om vi har en inloggning
                if (auth.currentUser) {
                    await reload(auth.currentUser);
                }
                setState({ kind: "success" });
            } catch (e: any) {
                const code: string = e?.code || "";
                // Vanliga fel: auth/expired-action-code, auth/invalid-action-code
                if (!auth.currentUser) {
                    setState({ kind: "need-login" });
                } else {
                    setState({ kind: "error", code, message: e?.message });
                }
            }
        })();
    }, []);

    const resend = async () => {
        const u = auth.currentUser;
        if (!u) {
            setState({ kind: "need-login" });
            return;
        }
        try {
            await sendEmailVerification(u, EMAIL_VERIFICATION_ACS);
            setState({ kind: "resent" });
        } catch (e: any) {
            setState({ kind: "error", code: e?.code, message: e?.message });
        }
    };

    return (
        <div style={{ maxWidth: 560, margin: "64px auto", padding: 16 }} className="gw-card">
            {state.kind === "checking" && <p>Verifierar länk…</p>}

            {state.kind === "success" && (
                <>
                    <h2 style={{ marginTop: 0 }}>E-post verifierad 🎉</h2>
                    <p>Du kan nu stänga denna sida och logga in.</p>
                </>
            )}

            {state.kind === "already" && (
                <>
                    <h2 style={{ marginTop: 0 }}>Redan verifierad</h2>
                    <p>Din e-postadress är redan verifierad.</p>
                </>
            )}

            {state.kind === "need-login" && (
                <>
                    <h2 style={{ marginTop: 0 }}>Logga in för att fortsätta</h2>
                    <p>Vi behöver att du loggar in, sedan kan du begära en ny verifieringslänk.</p>
                </>
            )}

            {state.kind === "resent" && (
                <>
                    <h2 style={{ marginTop: 0 }}>Ny länk skickad</h2>
                    <p>Kolla din inkorg. Länken leder tillbaka till denna sida.</p>
                </>
            )}

            {state.kind === "error" && (
                <>
                    <h2 style={{ marginTop: 0 }}>Kunde inte verifiera länken</h2>
                    <p style={{ color: "var(--danger)" }}>
                        {state.code ? <code>{state.code}</code> : null} {state.message ? " – " + state.message : ""}
                    </p>
                    <p>
                        Om länken har förbrukats (t.ex. öppnats av en säkerhetsskanner) kan du skicka en ny länk nedan.
                    </p>
                    <button className="btn" onClick={resend}>Skicka ny verifieringslänk</button>
                </>
            )}

            {state.kind !== "checking" && state.kind !== "resent" && (
                <div style={{ marginTop: 12 }}>
                    <button className="btn btn-secondary" onClick={() => (window.location.href = "/")}>
                        Till startsidan
                    </button>
                </div>
            )}
        </div>
    );
}
