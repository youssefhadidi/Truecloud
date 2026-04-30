/** @format */

'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { FiCloud, FiEye, FiEyeOff, FiLock, FiAlertCircle } from 'react-icons/fi';
import Field from '@/components/ui/Field';
import Spinner from '@/components/ui/Spinner';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    try {
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setError('Invalid email or password');
      } else {
        await queryClient.invalidateQueries({ queryKey: ['session'] });
        router.push('/files');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        width: '100%',
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Dotted background */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(currentColor 1.4px, transparent 1.4px)',
          backgroundSize: '28px 28px',
          color: 'var(--border-strong)',
          opacity: 0.45,
          pointerEvents: 'none',
        }}
      />
      {/* Radial fade */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse 55% 55% at 50% 50%, transparent 0%, var(--bg) 100%)',
          pointerEvents: 'none',
        }}
      />

      <div className="tc-anim-slide" style={{ width: '100%', maxWidth: 400, position: 'relative', zIndex: 1 }}>
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-xl)',
            padding: 32,
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 'var(--r-lg)',
                background: 'var(--accent)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 6px 20px rgba(99,102,241,.35)',
                marginBottom: 12,
              }}
            >
              <FiCloud size={22} color="#fff" />
            </div>
            <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: '-0.03em', color: 'var(--text)' }}>
              Truecloud
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
              Sign in to your self-hosted cloud
            </div>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field
              label="Email address"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
              autoFocus
              autoComplete="email"
              required
            />
            <Field
              label="Password"
              type={showPass ? 'text' : 'password'}
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              suffix={
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-3)',
                    display: 'flex',
                    padding: 0,
                  }}
                  title={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                </button>
              }
            />

            {error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 12px',
                  background: 'var(--danger-light)',
                  borderRadius: 'var(--r-sm)',
                  fontSize: 13,
                  color: 'var(--danger)',
                  border: '1px solid color-mix(in oklab, var(--danger) 25%, transparent)',
                }}
              >
                <FiAlertCircle size={14} style={{ flexShrink: 0 }} />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                height: 42,
                borderRadius: 'var(--r-md)',
                background: 'var(--accent)',
                color: '#fff',
                fontFamily: 'inherit',
                fontWeight: 600,
                fontSize: 14,
                border: 'none',
                cursor: loading ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transition: 'all 150ms',
                boxShadow: '0 2px 8px rgba(99,102,241,.35)',
                marginTop: 4,
                opacity: loading ? 0.85 : 1,
              }}
              onMouseEnter={(e) => {
                if (!loading) e.currentTarget.style.boxShadow = '0 4px 16px rgba(99,102,241,.45)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(99,102,241,.35)';
              }}
            >
              {loading ? <Spinner /> : <><FiLock size={15} />Sign in</>}
            </button>
          </form>
        </div>
        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--text-3)' }}>
          Self-hosted · Private · Secure
        </div>
      </div>
    </div>
  );
}
