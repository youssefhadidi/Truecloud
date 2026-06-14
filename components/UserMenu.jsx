/** @format */

'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  FiChevronDown, FiUser, FiDownload, FiLogOut, FiShare2, FiTrash2,
  FiSettings, FiLock, FiSun, FiMoon,
} from 'react-icons/fi';
import { useSessionLock } from '@/contexts/SessionLockContext';
import { useTheme } from '@/components/ThemeProvider';
import { useTranslation } from '@/components/LanguageProvider';
import { useLogout } from '@/hooks/useLogout';
import Badge from '@/components/ui/Badge';
import Divider from '@/components/ui/Divider';
import Toggle from '@/components/ui/Toggle';

function MenuItem({ icon: Icon, label, onClick, danger, right }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '10px 16px',
        fontSize: 13,
        fontWeight: 500,
        border: 'none',
        cursor: 'pointer',
        background: 'transparent',
        color: danger ? 'var(--danger)' : 'var(--text)',
        transition: 'background 120ms',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {Icon && <Icon size={14} color={danger ? 'var(--danger)' : 'var(--text-2)'} />}
      <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
      {right}
    </button>
  );
}

function gradientFromEmail(email) {
  if (!email) return 'linear-gradient(135deg,#6366f1,#8b5cf6)';
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (a + 50) % 360;
  return `linear-gradient(135deg, hsl(${a},70%,55%), hsl(${b},65%,60%))`;
}

export default function UserMenu({ email, isAdmin = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const router = useRouter();
  const pathname = usePathname();
  const { settings, lockNow } = useSessionLock();
  const { theme, toggle } = useTheme();
  const { t } = useTranslation();
  const logout = useLogout();

  useEffect(() => {
    if (isOpen) setIsOpen(false);
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const initial = (email || '?').trim().charAt(0).toUpperCase();
  const displayName = email ? email.split('@')[0] : t('shell.account');

  const close = () => setIsOpen(false);
  const go = (path) => {
    router.push(path);
  };

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px 4px 4px',
          borderRadius: 'var(--r-sm)',
          border: 'none',
          cursor: 'pointer',
          background: isOpen ? 'var(--surface-2)' : 'transparent',
          transition: 'background 150ms',
          color: 'var(--text)',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
        onMouseLeave={(e) => {
          if (!isOpen) e.currentTarget.style.background = 'transparent';
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 99,
            background: gradientFromEmail(email),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{initial}</span>
        </div>
        <span
          className="tc-truncate"
          style={{ fontSize: 13, fontWeight: 600, maxWidth: 140, display: 'none' }}
          data-show-on-sm
        >
          {displayName}
        </span>
        <FiChevronDown
          size={13}
          color="var(--text-3)"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}
        />
      </button>

      {isOpen && (
        <div
          className="tc-anim-scale"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 7000,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-xl)',
            width: 240,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
            <div className="tc-truncate" style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
              {email || t('shell.notSignedIn')}
            </div>
            {isAdmin && (
              <div style={{ marginTop: 6 }}>
                <Badge color="accent">{t('shell.administrator')}</Badge>
              </div>
            )}
          </div>

          <div style={{ padding: '4px 0' }}>
            {isAdmin && (
              <>
                <MenuItem icon={FiSettings} label={t('shell.adminPanel')} onClick={() => go('/admin/monitoring')} />
                <Divider />
              </>
            )}
            <MenuItem icon={FiShare2}    label={t('shell.myShares')}  onClick={() => go('/files/shares')} />
            <MenuItem icon={FiDownload}  label={t('shell.downloads')} onClick={() => go('/files/downloads')} />
            <MenuItem icon={FiTrash2}    label={t('shell.trash')}     onClick={() => go('/files/list?path=trash')} />
            <Divider />
            <MenuItem icon={FiSettings} label={t('shell.accountSettings')} onClick={() => go('/account')} />
            <MenuItem
              icon={theme === 'dark' ? FiMoon : FiSun}
              label={theme === 'dark' ? t('shell.darkMode') : t('shell.lightMode')}
              onClick={() => toggle()}
              right={<Toggle value={theme === 'dark'} onChange={() => toggle()} />}
            />
            {settings?.sessionLockEnabled && (
              <MenuItem icon={FiLock} label={t('shell.lockNow')} onClick={() => { lockNow(); close(); }} />
            )}
            <Divider />
            <MenuItem
              icon={FiLogOut}
              label={t('shell.signOut')}
              danger
              onClick={async () => {
                close();
                await logout();
              }}
            />
          </div>
        </div>
      )}

      <style jsx>{`
        @media (min-width: 640px) {
          [data-show-on-sm] {
            display: inline !important;
          }
        }
      `}</style>
    </div>
  );
}
