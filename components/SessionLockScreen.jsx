/** @format */

'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSessionLock } from '@/contexts/SessionLockContext';
import { FiLock } from 'react-icons/fi';
import { useLogout } from '@/hooks/useLogout';
import Spinner from '@/components/ui/Spinner';

function formatRetry(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.ceil(seconds / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.ceil(m / 60);
  return `${h} hour${h === 1 ? '' : 's'}`;
}

export default function SessionLockScreen({ children }) {
  const logout = useLogout();
  const { isLocked, isLoading, unlock } = useSessionLock();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const [lockoutUntil, setLockoutUntil] = useState(0); // epoch ms
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef(null);

  // Tick once per second while a lockout window is active so the countdown
  // re-renders. Stops when the window expires.
  useEffect(() => {
    if (!lockoutUntil || lockoutUntil <= Date.now()) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockoutUntil]);

  const lockoutRemaining = lockoutUntil > now ? Math.ceil((lockoutUntil - now) / 1000) : 0;
  const isLockedOut = lockoutRemaining > 0;

  const handleKeyDown = useCallback(
    async (e) => {
      if (!isLocked || isLockedOut) return;
      const key = e.key;
      if (key === 'Backspace') {
        e.preventDefault();
        setPin((p) => p.slice(0, -1));
        setError('');
        return;
      }
      if (!/^\d$/.test(key)) return;
      e.preventDefault();
      if (pin.length < 4) {
        const newPin = pin + key;
        setPin(newPin);
        setError('');
        if (newPin.length === 4) {
          const result = await unlock(newPin);
          if (!result.success) {
            setPin('');
            setIsShaking(true);
            setTimeout(() => setIsShaking(false), 500);
            if (result.lockedOut) {
              setLockoutUntil(Date.now() + (result.retryAfter || 30) * 1000);
              setNow(Date.now());
              setError(`Too many attempts. Try again in ${formatRetry(result.retryAfter || 30)}.`);
            } else {
              setError('Incorrect PIN');
            }
          }
        }
      }
    },
    [isLocked, isLockedOut, pin, unlock],
  );

  useEffect(() => {
    if (!isLocked) {
      setPin('');
      setError('');
    }
  }, [isLocked]);

  // Pause any audio/video the moment the session locks. The lock screen is
  // an overlay, so without this an in-flight stream would continue playing
  // audibly behind it.
  useEffect(() => {
    if (!isLocked) return;
    const media = document.querySelectorAll('audio, video');
    media.forEach((el) => {
      try { el.pause(); } catch {}
    });
  }, [isLocked]);

  useEffect(() => {
    if (!isLocked) return undefined;
    window.addEventListener('keydown', handleKeyDown);
    if (inputRef.current) inputRef.current.focus();
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLocked, handleKeyDown]);

  const handleInputChange = useCallback(
    async (e) => {
      if (isLockedOut) {
        e.target.value = '';
        return;
      }
      const value = e.target.value.replace(/\D/g, '').slice(0, 4);
      setPin(value);
      setError('');
      if (value.length === 4) {
        const result = await unlock(value);
        e.target.value = '';
        if (!result.success) {
          setPin('');
          setIsShaking(true);
          setTimeout(() => setIsShaking(false), 500);
          if (result.lockedOut) {
            setLockoutUntil(Date.now() + (result.retryAfter || 30) * 1000);
            setNow(Date.now());
            setError(`Too many attempts. Try again in ${formatRetry(result.retryAfter || 30)}.`);
          } else {
            setError('Incorrect PIN');
          }
        }
      }
    },
    [isLockedOut, unlock],
  );

  if (isLoading) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--bg)',
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Spinner size={36} color="var(--accent)" borderColor="var(--border)" thickness={3} />
      </div>
    );
  }

  if (isLocked) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--bg)',
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          value={pin}
          onChange={handleInputChange}
          aria-label="PIN input"
          autoComplete="off"
          maxLength="4"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />

        <div
          className={isShaking ? 'tc-anim-fade' : ''}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-xl)',
            boxShadow: 'var(--shadow-xl)',
            padding: 32,
            maxWidth: 420,
            width: '100%',
            animation: isShaking ? 'tc-pulse 250ms ease 2' : undefined,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <div
              style={{
                background: 'var(--accent-light)',
                color: 'var(--accent)',
                borderRadius: 99,
                padding: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FiLock size={36} />
            </div>
          </div>

          <h2
            style={{
              textAlign: 'center',
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--text)',
              margin: '0 0 6px',
              letterSpacing: '-0.02em',
            }}
          >
            Session Locked
          </h2>
          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-2)', margin: '0 0 24px' }}>
            This session was locked due to inactivity. Enter your 4-digit PIN to unlock.
          </p>

          <div
            style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 20, cursor: 'pointer' }}
            onClick={() => inputRef.current?.focus()}
          >
            {[0, 1, 2, 3].map((i) => {
              const filled = i < pin.length;
              return (
                <div
                  key={i}
                  style={{
                    width: 44,
                    height: 52,
                    borderRadius: 'var(--r-md)',
                    border: `1.5px solid ${filled ? 'var(--accent)' : 'var(--border)'}`,
                    background: filled ? 'var(--accent)' : 'var(--surface-2)',
                    color: filled ? '#fff' : 'var(--text-3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    fontWeight: 700,
                    transition: 'all 150ms',
                  }}
                >
                  {filled ? '●' : ''}
                </div>
              );
            })}
          </div>

          {error && (
            <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--danger)', margin: '0 0 16px' }}>
              {isLockedOut
                ? `Too many attempts. Try again in ${formatRetry(lockoutRemaining)}.`
                : error}
            </p>
          )}

          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-3)', margin: '0 0 20px' }}>
            {isLockedOut ? 'PIN entry is temporarily disabled.' : 'Type your 4-digit PIN using your keyboard.'}
          </p>

          <button
            onClick={() => logout()}
            style={{
              width: '100%',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-2)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '10px',
              borderRadius: 'var(--r-sm)',
              fontFamily: 'inherit',
              transition: 'background 120ms',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Sign out instead
          </button>
        </div>
      </div>
    );
  }

  return children;
}
