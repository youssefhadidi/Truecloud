/** @format */

'use client';

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { FiLock, FiUnlock, FiX, FiShield } from 'react-icons/fi';
import { useFiles } from '@/lib/api/files';
import { useFolderLocks, useSetFolderLock, useChangeFolderLockPin, useDeleteFolderLock } from '@/lib/api/folderLocks';
import { useNotifications } from '@/contexts/NotificationsContext';

function isLockableRootFolder(name) {
  if (!name) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name === 'trash') return false;
  if (name.startsWith('user_')) return false;
  if (name.startsWith('.')) return false;
  return true;
}

// 4-digit numeric input shared between "Set" and "Change" flows.
function PinInput({ value, onChange, autoFocus }) {
  const ref = useRef(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={4}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
      className="w-full text-center text-3xl tracking-[0.5em] font-mono px-3 py-3 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white"
      placeholder="••••"
    />
  );
}

function PinSetModal({ title, submitLabel, onSubmit, onClose, busy }) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (pin.length !== 4) return setError('PIN must be 4 digits');
    if (pin !== confirm) return setError('PINs do not match');
    setError('');
    onSubmit(pin);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
            <FiX size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-2">New 4-digit PIN</label>
            <PinInput value={pin} onChange={setPin} autoFocus />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-2">Confirm PIN</label>
            <PinInput value={confirm} onChange={setConfirm} />
          </div>
          {error && <div className="text-red-400 text-sm">{error}</div>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'Saving…' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmRemoveModal({ folder, onConfirm, onClose, busy }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">Remove folder lock?</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
            <FiX size={20} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-300">
            Anyone with file access will be able to open <span className="font-mono text-white">{folder}</span> without
            a PIN. This cannot be undone — you'll need to set a new PIN to re-lock the folder.
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700">
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className="flex-1 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? 'Removing…' : 'Remove Lock'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SecurityPage() {
  const { addNotification } = useNotifications();
  const { files: rootEntries, isLoading: filesLoading } = useFiles('');
  const { data: locks = [], isLoading: locksLoading } = useFolderLocks();
  const setLock = useSetFolderLock();
  const changePin = useChangeFolderLockPin();
  const deleteLock = useDeleteFolderLock();

  const [setting, setSetting] = useState(null); // folder name being set/changed
  const [removing, setRemoving] = useState(null);
  const [mode, setMode] = useState('set'); // 'set' | 'change'

  const lockByPath = useMemo(() => Object.fromEntries(locks.map((l) => [l.path, l])), [locks]);

  // Lockable folders = root-level directories that aren't user_*/trash.
  const lockableFolders = useMemo(
    () => rootEntries.filter((f) => f.isDirectory && isLockableRootFolder(f.name)),
    [rootEntries],
  );

  const handleSet = useCallback(
    async (pin) => {
      try {
        if (mode === 'change') {
          await changePin.mutateAsync({ path: setting, pin });
          addNotification('success', `PIN updated for ${setting}`);
        } else {
          await setLock.mutateAsync({ path: setting, pin });
          addNotification('success', `${setting} is now locked`);
        }
        setSetting(null);
      } catch (err) {
        addNotification('error', err.response?.data?.error || 'Failed to save PIN');
      }
    },
    [mode, setting, setLock, changePin, addNotification],
  );

  const handleRemove = useCallback(async () => {
    try {
      await deleteLock.mutateAsync(removing);
      addNotification('success', `Lock removed from ${removing}`);
      setRemoving(null);
    } catch (err) {
      addNotification('error', err.response?.data?.error || 'Failed to remove lock');
    }
  }, [removing, deleteLock, addNotification]);

  if (filesLoading || locksLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading…</div>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-2">
        <FiShield className="text-blue-400" size={28} />
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white">Folder Locks</h1>
      </div>
      <p className="text-sm text-gray-400 mb-6 max-w-2xl">
        Gate any root-level shared folder behind a 4-digit PIN. Every user — including admins — must enter the PIN to
        view the folder's contents. Private user folders and the trash cannot be locked.
      </p>

      <div className="bg-gray-800 rounded-lg shadow">
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-700">
          <h2 className="text-base sm:text-lg font-semibold text-white">
            Lockable folders ({lockableFolders.length})
          </h2>
        </div>

        {lockableFolders.length === 0 ? (
          <div className="px-4 sm:px-6 py-6 text-sm text-gray-400">
            No lockable root folders found. Create a shared folder at the root of the file browser first.
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {lockableFolders.map((f) => {
              const lock = lockByPath[f.name];
              const isLocked = !!lock;
              return (
                <div
                  key={f.name}
                  className="px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {isLocked ? (
                      <FiLock className="text-amber-400 flex-shrink-0" size={20} />
                    ) : (
                      <FiUnlock className="text-gray-500 flex-shrink-0" size={20} />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-white truncate">{f.name}</div>
                      <div className="text-xs text-gray-400">
                        {isLocked ? (
                          <>
                            Locked
                            {lock.createdByUsername && <> by {lock.createdByUsername}</>}
                            {lock.updatedAt && <> · updated {new Date(lock.updatedAt).toLocaleDateString()}</>}
                          </>
                        ) : (
                          'Open to all users with file access'
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isLocked ? (
                      <>
                        <button
                          onClick={() => {
                            setMode('change');
                            setSetting(f.name);
                          }}
                          className="px-3 py-1.5 text-sm border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700"
                        >
                          Change PIN
                        </button>
                        <button
                          onClick={() => setRemoving(f.name)}
                          className="px-3 py-1.5 text-sm bg-red-900/40 text-red-300 border border-red-900 rounded-lg hover:bg-red-900/60"
                        >
                          Remove Lock
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          setMode('set');
                          setSetting(f.name);
                        }}
                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        Set PIN
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {setting && (
        <PinSetModal
          title={`${mode === 'change' ? 'Change PIN for' : 'Lock folder'} "${setting}"`}
          submitLabel={mode === 'change' ? 'Update PIN' : 'Lock Folder'}
          busy={setLock.isPending || changePin.isPending}
          onClose={() => setSetting(null)}
          onSubmit={handleSet}
        />
      )}
      {removing && (
        <ConfirmRemoveModal
          folder={removing}
          busy={deleteLock.isPending}
          onClose={() => setRemoving(null)}
          onConfirm={handleRemove}
        />
      )}
    </>
  );
}
