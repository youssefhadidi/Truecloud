/** @format */

'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useSessionLock } from '@/contexts/SessionLockContext';
import { FiLock } from 'react-icons/fi';
import { signOut } from 'next-auth/react';
import Spinner from '@/components/ui/Spinner';

export default function SessionLockScreen({ children }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isLocked, isLoading, unlock } = useSessionLock();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const inputRef = useRef(null);

  const handleKeyDown = useCallback(
    async (e) => {
      if (!isLocked) return;
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
          const success = await unlock(newPin);
          if (!success) {
            setPin('');
            setError('Incorrect PIN');
            setIsShaking(true);
            setTimeout(() => setIsShaking(false), 500);
          }
        }
      }
    },
    [isLocked, pin, unlock],
  );

  useEffect(() => {
    if (!isLocked) {
      setPin('');
      setError('');
    }
  }, [isLocked]);

  useEffect(() => {
    if (!isLocked) return undefined;
    window.addEventListener('keydown', handleKeyDown);
    if (inputRef.current) inputRef.current.focus();
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLocked, handleKeyDown]);

  const handleInputChange = useCallback(
    async (e) => {
      const value = e.target.value.replace(/\D/g, '').slice(0, 4);
      setPin(value);
      setError('');
      if (value.length === 4) {
        const success = await unlock(value);
        if (!success) {
          e.target.value = '';
          setPin('');
          setError('Incorrect PIN');
          setIsShaking(true);
          setTimeout(() => setIsShaking(false), 500);
        } else {
          e.target.value = '';
        }
      }
    },
    [unlock],
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
              {error}
            </p>
          )}

          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-3)', margin: '0 0 20px' }}>
            Type your 4-digit PIN using your keyboard.
          </p>

          <button
            onClick={async () => {
              await signOut({ redirect: false });
              await queryClient.invalidateQueries({ queryKey: ['session'] });
              router.push('/auth/login');
            }}
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
