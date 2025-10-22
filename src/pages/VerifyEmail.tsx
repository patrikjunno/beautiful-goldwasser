import React from "react";
import { auth, EMAIL_VERIFICATION_ACS } from "../firebase";
import { applyActionCode, reload, sendEmailVerification } from "firebase/auth";

export default function VerifyEmail() {
    type State =
        | { kind: "checking" }
        | { kind: "success" }
        | { kind: "already" }
        | { kind: "error"; code?: string; message?: string }
        | { kind: "need-login" }
        | { kind: "resent" };

    const [state, setState] = React.useState<State>({ kind: "checking" });

    // Kör bara verify-flödet en gång (skydd mot dubbelmount/dubbla triggers)
    const didRunRef = React.useRef(false);

    // Debugg på ?debug=1
    const DEBUG =
        typeof window !== "undefined" &&
        new URLSearchParams(location.search).get("debug") === "1";

    React.useEffect(() => {
        if (didRunRef.current) return;
        didRunRef.current = true;

        const qs = new URLSearchParams(window.location.search);
        const mode = qs.get("mode");
        const oobCode = qs.get("oobCode");

        // Endast verifyEmail-händelser hanteras här
        if (mode !== "verifyEmail" || !oobCode) {
            if (DEBUG) console.log("[VerifyEmail] invalid query", { mode, oobCode });
            setState({ kind: "error", message: "Ogiltig länk." });
            return;
        }

        // Om redan inloggad och verifierad, var klar direkt
        const u = auth.currentUser;
        if (u?.emailVerified) {
            if (DEBUG) console.log("[VerifyEmail] already verified");
            setState({ kind: "already" });
            return;
        }

        // Försök applicera koden (en gång)
        (async () => {
            try {
                if (DEBUG) console.log("[VerifyEmail] applying action code…");
                await applyActionCode(auth, oobCode);

                // uppdatera användaren om vi har en inloggning
                if (auth.currentUser) {
                    await reload(auth.currentUser);
                }

                if (DEBUG) console.log("[VerifyEmail] success");
                setState({ kind: "success" });
            } catch (e: any) {
                const code: string = e?.code || "";
                if (DEBUG) console.warn("[VerifyEmail] error", code, e?.message);

                // Vanliga fel: auth/expired-action-code, auth/invalid-action-code
                if (!auth.currentUser) {
                    setState({ kind: "need-login" });
                } else {
                    setState({ kind: "error", code, message: e?.message });
                }
            }
        })();
    }, [DEBUG]);

    const resend = async () => {
        const u = auth.currentUser;
        if (!u) {
            setState({ kind: "need-login" });
            return;
        }
        try {
            if (DEBUG) console.log("[VerifyEmail] sending new link…");
            await sendEmailVerification(u, EMAIL_VERIFICATION_ACS);
            setState({ kind: "resent" });
        } catch (e: any) {
            if (DEBUG) console.warn("[VerifyEmail] resend error", e?.code, e?.message);
            setState({ kind: "error", code: e?.code, message: e?.message });
        }
    };

    return (
        <div style={{ maxWidth: 560, margin: "64px auto", padding: 16 }} className="gw-card">
            {state.kind === "checking" && <p>Verifierar länk…</p>}

            {state.kind === "success" && (
                <>
                    <h2 style={{ marginTop: 0 }}>E-post verifierad 🎉</h2>
                    <p>
                        Du kan nu återvända till fliken där du var – den uppdateras automatiskt.
                    </p>
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
