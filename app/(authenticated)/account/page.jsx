/** @format */

'use client';

import { useState, useEffect } from 'react';
import { useSessionLock } from '@/contexts/SessionLockContext';
import { FiLock, FiCheckCircle, FiAlertCircle, FiKey, FiSun, FiMoon } from 'react-icons/fi';
import axios from '@/lib/axiosConfig';
import Card, { PageHeader } from '@/components/ui/Card';
import Field from '@/components/ui/Field';
import Btn from '@/components/ui/Btn';
import Toggle from '@/components/ui/Toggle';
import Spinner from '@/components/ui/Spinner';
import { useTheme } from '@/components/ThemeProvider';

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
      if (newPin !== confirmPin) { setPinError('PINs do not match'); return; }
      if (newPin.length !== 4 || !/^\d+$/.test(newPin)) {
        setPinError('PIN must be exactly 4 digits');
        return;
      }
    }

    if (lockIsConfigured) {
      if (currentPin.length !== 4 || !/^\d+$/.test(currentPin)) {
        setPinError('Enter your current 4-digit PIN to save changes');
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
      setSuccessMessage('Settings saved successfully');
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      window.setTimeout(() => setSuccessMessage(''), 3000);
    } else {
      setPinError(result.error || 'Failed to save settings');
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    if (newPassword !== confirmPassword) { setPasswordError('New passwords do not match'); return; }
    if (newPassword.length < 6) { setPasswordError('New password must be at least 6 characters'); return; }
    setIsChangingPassword(true);
    try {
      await axios.put('/api/account/password', { currentPassword, newPassword });
      setPasswordSuccess('Password changed successfully');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      window.setTimeout(() => setPasswordSuccess(''), 4000);
    } catch (err) {
      setPasswordError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)', padding: '24px 16px 48px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <PageHeader title="Account Settings" subtitle="Manage your profile, security, and preferences" />

        {/* Security card */}
        <Card
          title="Security"
          subtitle="Session lock and PIN protection"
          style={{ marginBottom: 16 }}
          padding={0}
        >
          <form onSubmit={handleSaveSessionLock} style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <FiLock size={18} color="var(--accent)" />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Enable Session Lock</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Lock your session after a period of inactivity</div>
                </div>
              </div>
              <Toggle value={isEnabled} onChange={setIsEnabled} />
            </div>

            {isEnabled && (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>
                    Inactivity Timeout
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
                      return <option key={mins} value={mins}>{hours} hour{hours !== 1 ? 's' : ''}</option>;
                    })}
                  </select>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                    Your session will be locked after this much inactivity.
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>
                    Set or change PIN
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Field
                      label="New PIN (4 digits)"
                      type="text"
                      value={newPin}
                      onChange={(v) => setNewPin(v.replace(/\D/g, '').slice(0, 4))}
                      placeholder="0000"
                    />
                    <Field
                      label="Confirm PIN"
                      type="text"
                      value={confirmPin}
                      onChange={(v) => setConfirmPin(v.replace(/\D/g, '').slice(0, 4))}
                      placeholder="0000"
                    />
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      Enter the same 4-digit PIN twice. This unlocks your session.
                    </div>
                  </div>
                </div>
              </>
            )}

            {lockIsConfigured && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <Field
                  label="Current PIN"
                  type="password"
                  value={currentPin}
                  onChange={(v) => setCurrentPin(v.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••"
                  autoComplete="off"
                />
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                  Required to change any lock setting or disable the lock.
                </div>
              </div>
            )}

            {pinError && <StatusMessage kind="error">{pinError}</StatusMessage>}
            {successMessage && <StatusMessage kind="success">{successMessage}</StatusMessage>}

            <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <Btn variant="primary" size="md" type="submit" disabled={isSaving}>
                {isSaving ? <><Spinner /> Saving…</> : 'Save Settings'}
              </Btn>
              {isEnabled && (
                <Btn variant="outline" size="md" onClick={lockNow}>
                  <FiLock size={13} /> Lock now
                </Btn>
              )}
            </div>
          </form>
        </Card>

        {/* Password card */}
        <Card
          title="Change Password"
          subtitle="Use a strong password and don't reuse it elsewhere"
          style={{ marginBottom: 16 }}
          padding={0}
        >
          <form onSubmit={handleChangePassword} style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Current Password" type="password" value={currentPassword} onChange={setCurrentPassword} required autoComplete="current-password" />
            <Field label="New Password"     type="password" value={newPassword}     onChange={setNewPassword}     required autoComplete="new-password" />
            <Field label="Confirm New Password" type="password" value={confirmPassword} onChange={setConfirmPassword} required autoComplete="new-password" />
            {passwordError && <StatusMessage kind="error">{passwordError}</StatusMessage>}
            {passwordSuccess && <StatusMessage kind="success">{passwordSuccess}</StatusMessage>}
            <div style={{ paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              <Btn variant="primary" size="md" type="submit" disabled={isChangingPassword}>
                <FiKey size={13} />
                {isChangingPassword ? <><Spinner /> Changing…</> : 'Change Password'}
              </Btn>
            </div>
          </form>
        </Card>

        {/* Preferences card */}
        <Card title="Preferences" subtitle="UI and display options" padding={0}>
          <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {theme === 'dark' ? <FiMoon size={16} color="var(--text-2)" /> : <FiSun size={16} color="var(--text-2)" />}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Dark mode</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Use dark theme by default</div>
                </div>
              </div>
              <Toggle value={theme === 'dark'} onChange={(v) => setTheme(v ? 'dark' : 'light')} />
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
          <strong>Note:</strong> Your session is automatically unlocked after entering the correct PIN. Make sure you remember your PIN!
        </div>
      </div>
    </div>
  );
}
