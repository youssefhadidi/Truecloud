/** @format */

'use client';

import { useState, useEffect } from 'react';
import { useSessionLock } from '@/contexts/SessionLockContext';
import { FiLock, FiCheckCircle, FiAlertCircle, FiKey, FiSun, FiMoon, FiGlobe } from 'react-icons/fi';
import axios from '@/lib/axiosConfig';
import Card, { PageHeader } from '@/components/ui/Card';
import Field from '@/components/ui/Field';
import Btn from '@/components/ui/Btn';
import Toggle from '@/components/ui/Toggle';
import Spinner from '@/components/ui/Spinner';
import { useTheme } from '@/components/ThemeProvider';
import { useTranslation } from '@/components/LanguageProvider';
import { LANG_LABELS } from '@/lib/i18n/config';

const TIMEOUT_OPTIONS = [60, 120, 240, 480, 720];

function StatusMessage({ kind, children }) {
  const isError = kind === 'error';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 'var(--r-sm)',
        background: isError ? 'var(--danger-light)' : 'var(--success-light)',
        color: isError ? 'var(--danger)' : 'var(--success)',
        fontSize: 13,
        fontWeight: 500,
        border: `1px solid color-mix(in oklab, ${isError ? 'var(--danger)' : 'var(--success)'} 25%, transparent)`,
      }}
    >
      {isError ? <FiAlertCircle size={14} /> : <FiCheckCircle size={14} />}
      {children}
    </div>
  );
}

export default function AccountPage() {
  const { settings, updateSettings, lockNow } = useSessionLock();
  const { theme, setTheme } = useTheme();
  const { t, lang, setLanguage, locales } = useTranslation();
  const [isEnabled, setIsEnabled] = useState(false);
  const [timeoutMins, setTimeoutMins] = useState(60);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // True if the user already has a PIN configured server-side. In that case
  // we must prompt for the current PIN before any change is applied.
  const lockIsConfigured = !!settings?.sessionLockEnabled;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    if (settings) {
      setIsEnabled(settings.sessionLockEnabled);
      setTimeoutMins(settings.sessionLockTimeout);
    }
  }, [settings]);

  const handleSaveSessionLock = async (e) => {
    e.preventDefault();
    setPinError('');
    setSuccessMessage('');

    if (newPin || confirmPin) {
      if (newPin !== confirmPin) { setPinError(t('account.security.pinsDoNotMatch')); return; }
      if (newPin.length !== 4 || !/^\d+$/.test(newPin)) {
        setPinError(t('account.security.pinFourDigits'));
        return;
      }
    }

    if (lockIsConfigured) {
      if (currentPin.length !== 4 || !/^\d+$/.test(currentPin)) {
        setPinError(t('account.security.enterCurrentPin'));
        return;
      }
    }

    setIsSaving(true);
    const updateData = { sessionLockEnabled: isEnabled, sessionLockTimeout: timeoutMins };
    if (newPin) updateData.sessionLockPin = newPin;
    if (lockIsConfigured) updateData.currentPin = currentPin;
    const result = await updateSettings(updateData);
    setIsSaving(false);

    if (result.success) {
      setSuccessMessage(t('account.security.saved'));
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      window.setTimeout(() => setSuccessMessage(''), 3000);
    } else {
      setPinError(result.error || t('account.security.saveFailed'));
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    if (newPassword !== confirmPassword) { setPasswordError(t('account.password.doNotMatch')); return; }
    if (newPassword.length < 6) { setPasswordError(t('account.password.tooShort')); return; }
    setIsChangingPassword(true);
    try {
      await axios.put('/api/account/password', { currentPassword, newPassword });
      setPasswordSuccess(t('account.password.changed'));
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      window.setTimeout(() => setPasswordSuccess(''), 4000);
    } catch (err) {
      setPasswordError(err.response?.data?.error || t('account.password.changeFailed'));
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)', padding: '24px 16px 48px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <PageHeader title={t('account.title')} subtitle={t('account.subtitle')} />

        {/* Security card */}
        <Card
          title={t('account.security.title')}
          subtitle={t('account.security.subtitle')}
          style={{ marginBottom: 16 }}
          padding={0}
        >
          <form onSubmit={handleSaveSessionLock} style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <FiLock size={18} color="var(--accent)" />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t('account.security.enableLock')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{t('account.security.enableLockHint')}</div>
                </div>
              </div>
              <Toggle value={isEnabled} onChange={setIsEnabled} />
            </div>

            {isEnabled && (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>
                    {t('account.security.inactivityTimeout')}
                  </label>
                  <select
                    value={timeoutMins}
                    onChange={(e) => setTimeoutMins(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      borderRadius: 'var(--r-md)',
                      fontFamily: 'inherit',
                      fontSize: 13,
                    }}
                  >
                    {TIMEOUT_OPTIONS.map((mins) => {
                      const hours = mins / 60;
                      const label = hours === 1
                        ? t('account.security.hours', { count: hours })
                        : t('account.security.hoursPlural', { count: hours });
                      return <option key={mins} value={mins}>{label}</option>;
                    })}
                  </select>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                    {t('account.security.timeoutHint')}
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>
                    {t('account.security.setOrChangePin')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Field
                      label={t('account.security.newPin')}
                      type="text"
                      value={newPin}
                      onChange={(v) => setNewPin(v.replace(/\D/g, '').slice(0, 4))}
                      placeholder="0000"
                    />
                    <Field
                      label={t('account.security.confirmPin')}
                      type="text"
                      value={confirmPin}
                      onChange={(v) => setConfirmPin(v.replace(/\D/g, '').slice(0, 4))}
                      placeholder="0000"
                    />
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {t('account.security.pinHint')}
                    </div>
                  </div>
                </div>
              </>
            )}

            {lockIsConfigured && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <Field
                  label={t('account.security.currentPin')}
                  type="password"
                  value={currentPin}
                  onChange={(v) => setCurrentPin(v.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••"
                  autoComplete="off"
                />
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                  {t('account.security.currentPinHint')}
                </div>
              </div>
            )}

            {pinError && <StatusMessage kind="error">{pinError}</StatusMessage>}
            {successMessage && <StatusMessage kind="success">{successMessage}</StatusMessage>}

            <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <Btn variant="primary" size="md" type="submit" disabled={isSaving}>
                {isSaving ? <><Spinner /> {t('common.saving')}</> : t('account.security.saveSettings')}
              </Btn>
              {isEnabled && (
                <Btn variant="outline" size="md" onClick={lockNow}>
                  <FiLock size={13} /> {t('account.security.lockNow')}
                </Btn>
              )}
            </div>
          </form>
        </Card>

        {/* Password card */}
        <Card
          title={t('account.password.title')}
          subtitle={t('account.password.subtitle')}
          style={{ marginBottom: 16 }}
          padding={0}
        >
          <form onSubmit={handleChangePassword} style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label={t('account.password.current')} type="password" value={currentPassword} onChange={setCurrentPassword} required autoComplete="current-password" />
            <Field label={t('account.password.new')}     type="password" value={newPassword}     onChange={setNewPassword}     required autoComplete="new-password" />
            <Field label={t('account.password.confirm')} type="password" value={confirmPassword} onChange={setConfirmPassword} required autoComplete="new-password" />
            {passwordError && <StatusMessage kind="error">{passwordError}</StatusMessage>}
            {passwordSuccess && <StatusMessage kind="success">{passwordSuccess}</StatusMessage>}
            <div style={{ paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              <Btn variant="primary" size="md" type="submit" disabled={isChangingPassword}>
                <FiKey size={13} />
                {isChangingPassword ? <><Spinner /> {t('account.password.changing')}</> : t('account.password.change')}
              </Btn>
            </div>
          </form>
        </Card>

        {/* Preferences card */}
        <Card title={t('account.preferences.title')} subtitle={t('account.preferences.subtitle')} padding={0}>
          <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {theme === 'dark' ? <FiMoon size={16} color="var(--text-2)" /> : <FiSun size={16} color="var(--text-2)" />}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t('account.preferences.darkMode')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{t('account.preferences.darkModeHint')}</div>
                </div>
              </div>
              <Toggle value={theme === 'dark'} onChange={(v) => setTheme(v ? 'dark' : 'light')} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FiGlobe size={16} color="var(--text-2)" />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t('account.preferences.language')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{t('account.preferences.languageHint')}</div>
                </div>
              </div>
              <select
                value={lang}
                onChange={(e) => setLanguage(e.target.value)}
                style={{
                  padding: '8px 12px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  borderRadius: 'var(--r-md)',
                  fontFamily: 'inherit',
                  fontSize: 13,
                }}
              >
                {locales.map((code) => (
                  <option key={code} value={code}>{LANG_LABELS[code] || code}</option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        <div
          style={{
            marginTop: 16,
            padding: '12px 14px',
            background: 'var(--accent-light)',
            border: '1px solid color-mix(in oklab, var(--accent) 30%, transparent)',
            borderRadius: 'var(--r-md)',
            color: 'var(--accent)',
            fontSize: 12,
          }}
        >
          <strong>{t('account.security.note')}</strong> {t('account.security.noteBody')}
        </div>
      </div>
    </div>
  );
}
