import React from "react";

export default function PendingAccess() {
    return (
        <div className="login-screen">
            <div className="gw-card" style={{ maxWidth: 520, margin: "48px auto", padding: 20 }}>
                <h2 style={{ marginTop: 0 }}>Väntar på behörighet</h2>
                <p>
                    Ditt konto är skapat men saknar ännu behörigheter. En administratör behöver
                    tilldela dig en roll och (vid behov) knyta dig till kund(er) innan du kan använda appen.
                </p>
                <p className="text-muted" style={{ fontSize: 13 }}>
                    Tips: Kontakta admin om det brådskar. Du kan logga ut och logga in igen när du fått behörighet.
                </p>
                <div style={{ marginTop: 12 }}>
                    <button className="btn" onClick={() => location.reload()}>
                        Försök igen
                    </button>
                </div>
            </div>
        </div>
    );
}
