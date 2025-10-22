// src/hooks/useEmailVerificationPoll.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { auth } from "../firebase";
import { getIdTokenResult, reload, sendEmailVerification } from "firebase/auth";
import type { User } from "firebase/auth";

type PollState = {
    isVerified: boolean;
    isPolling: boolean;
    error?: string;
};

export function useEmailVerificationPoll() {
    const [state, setState] = useState<PollState>({
        isVerified: !!auth.currentUser?.emailVerified,
        isPolling: false,
    });

    const intervalRef = useRef<number | null>(null);
    const timeoutRef = useRef<number | null>(null);
    const mountedRef = useRef<boolean>(false);
    const startedRef = useRef<boolean>(false); // skydda mot React StrictMode (dubbel useEffect)

    const safeSetState = useCallback((updater: (s: PollState) => PollState) => {
        if (!mountedRef.current) return;
        setState(updater);
    }, []);

    const clearTimers = useCallback(() => {
        if (intervalRef.current) {
            window.clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (timeoutRef.current) {
            window.clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    }, []);

    const checkNow = useCallback(async () => {
        const u: User | null = auth.currentUser;
        if (!u) {
            safeSetState((s) => ({ ...s, error: "Inte inloggad." }));
            return false;
        }
        try {
            await reload(u);
            await getIdTokenResult(u, true); // force refresh av claims/verified
            const ok = !!u.emailVerified;
            safeSetState((s) => (s.isVerified === ok ? s : { ...s, isVerified: ok, error: undefined }));
            return ok;
        } catch (e: any) {
            const msg = e?.message ?? String(e);
            safeSetState((s) => ({ ...s, error: msg }));
            return false;
        }
    }, [safeSetState]);

    const startAutoPoll = useCallback(
        async (durationMs = 30000, intervalMs = 4000) => {
            // skydda: starta bara en gång tills man explicit stoppar
            if (startedRef.current) return;
            startedRef.current = true;

            clearTimers();
            safeSetState((s) => (s.isPolling ? s : { ...s, isPolling: true }));

            const firstOk = await checkNow();
            if (firstOk) {
                safeSetState((s) => ({ ...s, isPolling: false, isVerified: true }));
                return;
            }

            intervalRef.current = window.setInterval(async () => {
                const ok = await checkNow();
                if (ok) {
                    clearTimers();
                    safeSetState((s) => ({ ...s, isPolling: false, isVerified: true }));
                }
            }, intervalMs) as unknown as number;

            timeoutRef.current = window.setTimeout(() => {
                // avsluta polling efter duration
                clearTimers();
                safeSetState((s) => ({ ...s, isPolling: false }));
            }, durationMs) as unknown as number;
        },
        [checkNow, clearTimers, safeSetState]
    );

    const stopPoll = useCallback(() => {
        clearTimers();
        startedRef.current = false;
        safeSetState((s) => (s.isPolling ? { ...s, isPolling: false } : s));
    }, [clearTimers, safeSetState]);

    const resendEmail = useCallback(async () => {
        const u = auth.currentUser;
        if (!u) {
            safeSetState((s) => ({ ...s, error: "Inte inloggad." }));
            return;
        }
        try {
            // Skicka UTAN ActionCodeSettings – låt Firebase använda standard
            await sendEmailVerification(u);
            safeSetState((s) => ({ ...s, error: undefined }));
        } catch (e: any) {
            const msg = e?.code ? `${e.code}: ${e.message}` : e?.message ?? String(e);
            safeSetState((s) => ({ ...s, error: msg }));
        }
    }, [safeSetState]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            clearTimers();
            startedRef.current = false;
        };
    }, [clearTimers]);

    return {
        ...state,
        checkNow,
        startAutoPoll,
        stopPoll,
        resendEmail,
    };
}
