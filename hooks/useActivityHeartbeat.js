/** @format */

'use client';

import { useEffect, useRef } from 'react';
import axios from '@/lib/axiosConfig';

/**
 * Sends an activity heartbeat to the server when the user is actually
 * present, so the session-lock inactivity timer reflects real presence
 * (mouse/keyboard/touch) rather than just incidental API traffic.
 *
 * - Listens for mousemove, keydown, touchstart, and visibility events.
 * - At most one heartbeat is sent per HEARTBEAT_THROTTLE_MS.
 * - No heartbeat is sent while the tab is hidden or the session is locked.
 */
const HEARTBEAT_THROTTLE_MS = 60_000;

export function useActivityHeartbeat({ enabled }) {
  const lastSentRef = useRef(0);
  const pendingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    const sendHeartbeat = () => {
      if (pendingRef.current) return;
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastSentRef.current < HEARTBEAT_THROTTLE_MS) return;
      lastSentRef.current = now;
      pendingRef.current = true;
      axios
        .post('/api/account/heartbeat')
        .catch(() => {
          // Roll back so a subsequent input event retries.
          lastSentRef.current = 0;
        })
        .finally(() => {
          pendingRef.current = false;
        });
    };

    const onActivity = () => sendHeartbeat();

    window.addEventListener('mousemove', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    window.addEventListener('touchstart', onActivity, { passive: true });
    document.addEventListener('visibilitychange', onActivity);

    // Initial ping so the timer starts from "user opened the tab".
    sendHeartbeat();

    return () => {
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('touchstart', onActivity);
      document.removeEventListener('visibilitychange', onActivity);
    };
  }, [enabled]);
}
