/** @format */

'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionLock } from '@/contexts/SessionLockContext';
import { FiLock } from 'react-icons/fi';
import { signOut } from 'next-auth/react';

export default function SessionLockScreen({ children }) {
  const router = useRouter();
  const { isLocked, isLoading, unlock } = useSessionLock();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const inputRef = useRef(null);

  const handleKeyDown = useCallback(
    async (e) => {
      if (!isLocked) return;

      const key = e.key;

      // Handle backspace
      if (key === 'Backspace') {
        e.preventDefault();
        setPin((p) => p.slice(0, -1));
        setError('');
        return;
      }

      // Handle digits only
      if (!/^\d$/.test(key)) {
        return;
      }

      e.preventDefault();

      if (pin.length < 4) {
        const newPin = pin + key;
        setPin(newPin);
        setError('');

        // Auto-submit on 4th digit
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
    [isLocked, pin, unlock]
  );

  // Add keyboard listener and focus input when locked
  useEffect(() => {
    if (!isLocked) return;

    window.addEventListener('keydown', handleKeyDown);
    // Focus the hidden input on mobile to trigger keyboard
    if (inputRef.current) {
      inputRef.current.focus();
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLocked, handleKeyDown]);

  const handleInputChange = useCallback(
    async (e) => {
      const value = e.target.value.replace(/\D/g, '').slice(0, 4);
      setPin(value);
      setError('');

      // Auto-submit on 4th digit
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
    [unlock]
  );

  // While session is loading or signing out, don't render anything to prevent race conditions
  if (isLoading || isSigningOut) return null;

  // If not locked, render children normally
  if (!isLocked) return children;

  // If locked, show PIN input screen
  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex items-center justify-center">
      {/* Hidden input for mobile keyboard support */}
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={pin}
        onChange={handleInputChange}
        className="sr-only"
        aria-label="PIN input"
        autoComplete="off"
        maxLength="4"
      />

      <div
        className={`bg-gray-800 rounded-lg shadow-2xl p-8 max-w-md w-full mx-4 ${
          isShaking ? 'animate-pulse' : ''
        }`}
      >
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="bg-indigo-900/30 rounded-full p-4">
            <FiLock className="text-indigo-500" size={48} />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-center text-2xl font-bold text-white mb-2">
          Session Locked
        </h2>

        {/* Description */}
        <p className="text-center text-gray-400 mb-6">
          This session has been locked due to inactivity. Enter your 4-digit PIN to unlock.
        </p>

        {/* PIN Display */}
        <div
          className="flex justify-center gap-3 mb-6 cursor-pointer"
          onClick={() => inputRef.current?.focus()}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-12 h-12 rounded-lg border-2 flex items-center justify-center text-xl font-bold transition-colors ${
                i < pin.length
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-gray-700 border-gray-600 text-gray-400'
              }`}
            >
              {i < pin.length ? '●' : ''}
            </div>
          ))}
        </div>

        {/* Error Message */}
        {error && (
          <p className="text-center text-red-400 text-sm mb-4">{error}</p>
        )}

        {/* Instructions */}
        <p className="text-center text-gray-400 text-xs mb-6">
          Type your 4-digit PIN using your keyboard
        </p>

        {/* Sign Out Link */}
        <button
          onClick={async () => {
            setIsSigningOut(true);
            await signOut({ redirect: false });
            router.push('/auth/login');
          }}
          className="w-full text-center text-gray-400 hover:text-gray-300 text-sm py-2 transition-colors"
        >
          Sign out instead
        </button>
      </div>
    </div>
  );
}
