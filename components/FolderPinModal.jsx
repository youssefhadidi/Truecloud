/** @format */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { FiLock, FiX } from 'react-icons/fi';
import axios from '@/lib/axiosConfig';

function formatRetry(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.ceil(seconds / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.ceil(m / 60);
  return `${h} hour${h === 1 ? '' : 's'}`;
}

/**
 * PIN entry for opening a passcode-locked folder. The actual verification
 * happens via a probe request to /api/files?path={folderPath} with the PIN
 * attached as the X-Folder-Pin header. On 200 the PIN is correct; the
 * parent receives it via onSuccess and is responsible for routing.
 *
 * The PIN is NEVER stored anywhere outside the parent's memory — every
 * navigation back into the folder must re-prompt (the agreed behavior).
 */
export default function FolderPinModal({ folderPath, folderName, onSuccess, onCancel }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Tick the lockout countdown every second while active.
  useEffect(() => {
    if (!lockoutUntil || lockoutUntil <= Date.now()) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockoutUntil]);

  const lockoutRemaining = lockoutUntil > now ? Math.ceil((lockoutUntil - now) / 1000) : 0;
  const isLockedOut = lockoutRemaining > 0;

  const submit = useCallback(
    async (value) => {
      setBusy(true);
      setError('');
      try {
        // Probe the listing endpoint — if the PIN is correct it returns 200
        // and we hand the PIN back to the parent for the real navigation.
        await axios.get(`/api/files?path=${encodeURIComponent(folderPath)}`, {
          headers: { 'X-Folder-Pin': value },
        });
        onSuccess(value);
      } catch (err) {
        const status = err.response?.status;
        const data = err.response?.data;
        if (status === 429 && data?.retryAfter) {
          setLockoutUntil(Date.now() + data.retryAfter * 1000);
          setNow(Date.now());
          setError(`Too many attempts. Try again in ${formatRetry(data.retryAfter)}.`);
        } else if (status === 401) {
          setError('Incorrect PIN');
        } else {
          setError(data?.error || 'Could not verify PIN');
        }
        setPin('');
      } finally {
        setBusy(false);
      }
    },
    [folderPath, onSuccess],
  );

  const handleChange = (val) => {
    const cleaned = val.replace(/\D/g, '').slice(0, 4);
    setPin(cleaned);
    setError('');
    if (cleaned.length === 4 && !busy && !isLockedOut) {
      submit(cleaned);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <FiLock className="text-amber-400" size={20} />
            <h3 className="text-lg font-semibold text-white truncate">{folderName || folderPath}</h3>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-200">
            <FiX size={20} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-300">Enter the 4-digit PIN to open this folder.</p>
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={4}
            value={pin}
            disabled={busy || isLockedOut}
            onChange={(e) => handleChange(e.target.value)}
            className="w-full text-center text-3xl tracking-[0.5em] font-mono px-3 py-3 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white disabled:opacity-50"
            placeholder="••••"
          />
          {error && <div className="text-red-400 text-sm text-center">{error}</div>}
          {isLockedOut && (
            <div className="text-amber-400 text-xs text-center">
              Locked out for {formatRetry(lockoutRemaining)} more.
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2 text-sm border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
