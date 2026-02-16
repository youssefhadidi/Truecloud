/** @format */

'use client';

import { useState, useEffect } from 'react';
import { useSessionLock } from '@/contexts/SessionLockContext';
import { FiLock, FiCheckCircle, FiAlertCircle } from 'react-icons/fi';

const TIMEOUT_OPTIONS = [60, 120, 240, 480, 720]; // 1h, 2h, 4h, 8h, 12h in minutes

export default function AccountPage() {
  const { settings, updateSettings, lockNow } = useSessionLock();
  const [isEnabled, setIsEnabled] = useState(false);
  const [timeout, setTimeout] = useState(60); // 1 hour default
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Initialize from settings
  useEffect(() => {
    if (settings) {
      setIsEnabled(settings.sessionLockEnabled);
      setTimeout(settings.sessionLockTimeout);
    }
  }, [settings]);

  const handleSaveSessionLock = async (e) => {
    e.preventDefault();
    setPinError('');
    setSuccessMessage('');

    // Validate PIN if provided
    if (newPin || confirmPin) {
      if (newPin !== confirmPin) {
        setPinError('PINs do not match');
        return;
      }

      if (newPin.length !== 4 || !/^\d+$/.test(newPin)) {
        setPinError('PIN must be exactly 4 digits');
        return;
      }
    }

    setIsSaving(true);

    const updateData = {
      sessionLockEnabled: isEnabled,
      sessionLockTimeout: timeout,
    };

    if (newPin) {
      updateData.sessionLockPin = newPin;
    }

    const success = await updateSettings(updateData);

    setIsSaving(false);

    if (success) {
      setSuccessMessage('Settings saved successfully');
      setNewPin('');
      setConfirmPin('');
      setTimeout(() => setSuccessMessage(''), 3000);
    } else {
      setPinError('Failed to save settings');
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-gray-900">
      <div className="max-w-2xl mx-auto p-6 sm:p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Account Settings</h1>
          <p className="text-gray-400">Manage your account and security preferences</p>
        </div>

        {/* Session Lock Section */}
        <div className="bg-gray-800 rounded-lg shadow-lg overflow-hidden mb-8">
          <div className="border-b border-gray-700 px-6 py-4 bg-gray-800/50">
            <div className="flex items-center gap-3">
              <FiLock className="text-indigo-500" size={24} />
              <h2 className="text-xl font-semibold text-white">Session Lock</h2>
            </div>
          </div>

          <form onSubmit={handleSaveSessionLock} className="p-6 space-y-6">
            {/* Enable Toggle */}
            <div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => setIsEnabled(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-600 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <p className="text-white font-medium">Enable Session Lock</p>
                  <p className="text-sm text-gray-400">
                    Lock your session after a period of inactivity
                  </p>
                </div>
              </label>
            </div>

            {isEnabled && (
              <>
                {/* Timeout Select */}
                <div>
                  <label className="block text-white font-medium mb-2">
                    Inactivity Timeout
                  </label>
                  <select
                    value={timeout}
                    onChange={(e) => setTimeout(Number(e.target.value))}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    {TIMEOUT_OPTIONS.map((mins) => {
                      const hours = mins / 60;
                      return (
                        <option key={mins} value={mins}>
                          {hours} hour{hours !== 1 ? 's' : ''}
                        </option>
                      );
                    })}
                  </select>
                  <p className="text-xs text-gray-400 mt-2">
                    Your session will be locked if there's no activity for this long
                  </p>
                </div>

                {/* PIN Section */}
                <div className="border-t border-gray-700 pt-6">
                  <h3 className="text-white font-medium mb-4">Set or Change PIN</h3>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-gray-300 text-sm font-medium mb-2">
                        New PIN (4 digits)
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength="4"
                        value={newPin}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                          setNewPin(val);
                        }}
                        placeholder="0000"
                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-center text-2xl letter-spacing-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-gray-300 text-sm font-medium mb-2">
                        Confirm PIN
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength="4"
                        value={confirmPin}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                          setConfirmPin(val);
                        }}
                        placeholder="0000"
                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-center text-2xl letter-spacing-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>

                    <p className="text-xs text-gray-400">
                      Enter the same 4-digit PIN twice. This PIN will unlock your session after inactivity.
                    </p>
                  </div>
                </div>
              </>
            )}

            {/* Error Message */}
            {pinError && (
              <div className="flex items-center gap-3 p-4 bg-red-900/20 border border-red-800 rounded-lg">
                <FiAlertCircle className="text-red-400" size={20} />
                <p className="text-red-300 text-sm">{pinError}</p>
              </div>
            )}

            {/* Success Message */}
            {successMessage && (
              <div className="flex items-center gap-3 p-4 bg-green-900/20 border border-green-800 rounded-lg">
                <FiCheckCircle className="text-green-400" size={20} />
                <p className="text-green-300 text-sm">{successMessage}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-4 pt-4 border-t border-gray-700">
              <button
                type="submit"
                disabled={isSaving}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {isSaving ? 'Saving...' : 'Save Settings'}
              </button>

              {isEnabled && (
                <button
                  type="button"
                  onClick={lockNow}
                  className="px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors font-medium"
                >
                  Lock Now
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Info Box */}
        <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4">
          <p className="text-blue-200 text-sm">
            <strong>Note:</strong> Your session is automatically unlocked after entering the correct PIN. Make sure you remember your PIN!
          </p>
        </div>
      </div>
    </div>
  );
}
