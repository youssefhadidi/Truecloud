/** @format */

'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  FiLock, FiX, FiShield, FiPlus, FiFolder, FiChevronRight, FiHome, FiArrowUp,
  FiAlertTriangle,
} from 'react-icons/fi';
import {
  useFolderLocks,
  useSetFolderLock,
  useChangeFolderLockPin,
  useDeleteFolderLock,
  useBrowseLockableFolders,
} from '@/lib/api/folderLocks';
import { useNotifications } from '@/contexts/NotificationsContext';

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

function PinSetModal({ title, subtitle, submitLabel, onSubmit, onClose, busy }) {
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
            <FiX size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {subtitle && (
            <div className="text-sm text-gray-400 break-all">
              Folder: <span className="font-mono text-gray-200">{subtitle}</span>
            </div>
          )}
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">Remove folder lock?</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
            <FiX size={20} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-300">
            <span className="font-mono text-white break-all">{folder}</span> will be openable
            without a PIN by anyone with access. You'll need to set a new PIN to re-lock it.
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

// Folder picker that lets the admin walk the tree and choose a path to lock.
// Folders that would violate the no-nested-locks rule are shown disabled
// (with a reason) instead of hidden — admins should see why a path is
// off-limits rather than have it silently missing.
function PickFolderModal({ onPicked, onClose }) {
  const [path, setPath] = useState('');
  const { data, isFetching } = useBrowseLockableFolders(path);

  const breadcrumb = useMemo(() => (path ? path.split('/') : []), [path]);

  const current = data?.current;
  const canLockHere =
    current?.isLockable &&
    !current?.isLocked &&
    !current?.hasAncestorLock &&
    !current?.hasDescendantLock &&
    path.length > 0;

  const lockHereReason = !path
    ? 'Pick a folder first — the root cannot be locked'
    : !current?.isLockable
      ? 'This path is not lockable (trash or private user folder)'
      : current?.isLocked
        ? 'Already locked'
        : current?.hasAncestorLock
          ? `Inside an already-locked folder ("${current.ancestorLockPath}")`
          : current?.hasDescendantLock
            ? `Contains a locked folder ("${current.descendantLockPath}")`
            : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-xl">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">Pick a folder to lock</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
            <FiX size={20} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {/* Breadcrumb */}
          <div className="flex items-center flex-wrap gap-1 text-sm">
            <button
              onClick={() => setPath('')}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded ${path === '' ? 'text-white bg-gray-700' : 'text-gray-400 hover:text-white'}`}
            >
              <FiHome size={13} /> Root
            </button>
            {breadcrumb.map((part, i) => {
              const subPath = breadcrumb.slice(0, i + 1).join('/');
              const isLast = i === breadcrumb.length - 1;
              return (
                <span key={`${part}-${i}`} className="inline-flex items-center gap-1">
                  <FiChevronRight size={12} className="text-gray-500" />
                  <button
                    onClick={() => setPath(subPath)}
                    className={`px-2 py-1 rounded ${isLast ? 'text-white bg-gray-700' : 'text-gray-400 hover:text-white'}`}
                  >
                    {part}
                  </button>
                </span>
              );
            })}
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setPath(path.split('/').slice(0, -1).join('/'))}
              disabled={!path}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-600 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-40"
            >
              <FiArrowUp size={13} /> Up one level
            </button>
            <button
              onClick={() => onPicked(path)}
              disabled={!canLockHere}
              title={lockHereReason || ''}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Lock this folder
            </button>
          </div>
          {lockHereReason && path && (
            <div className="flex items-start gap-2 text-xs text-amber-400">
              <FiAlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{lockHereReason}</span>
            </div>
          )}

          {/* Folder list */}
          <div className="border border-gray-700 rounded bg-gray-900/40 max-h-80 overflow-y-auto">
            {isFetching ? (
              <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
            ) : !data?.folders?.length ? (
              <div className="p-6 text-center text-sm text-gray-400">No sub-folders here.</div>
            ) : (
              data.folders.map((f) => {
                const disabledReason = f.hasAncestorLock
                  ? 'Inside a locked folder'
                  : null;
                // Folders WITH ancestor locks can't be navigated (admin would
                // need the PIN to see their contents). All others are navigable;
                // locked folders themselves are navigable (to remove the lock
                // or to manage what's inside via the actions row, just not via
                // this picker).
                const navigable = !f.hasAncestorLock;
                return (
                  <div
                    key={f.path}
                    className={`flex items-center gap-2 px-3 py-2 border-b border-gray-700 last:border-0 ${navigable ? 'hover:bg-gray-700/50 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
                    onClick={() => navigable && setPath(f.path)}
                  >
                    <FiFolder
                      size={16}
                      className={f.isLocked ? 'text-amber-400' : 'text-blue-400'}
                    />
                    <span className="text-sm text-white flex-1 truncate">{f.name}</span>
                    {f.isLocked && (
                      <span className="text-xs bg-amber-900/50 text-amber-200 px-2 py-0.5 rounded">
                        Locked
                      </span>
                    )}
                    {f.hasDescendantLock && !f.isLocked && (
                      <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">
                        Contains locks
                      </span>
                    )}
                    {disabledReason ? (
                      <span className="text-xs text-gray-500" title={disabledReason}>
                        —
                      </span>
                    ) : (
                      <FiChevronRight size={14} className="text-gray-500" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SecurityPage() {
  const { addNotification } = useNotifications();
  const { data: locks = [], isLoading: locksLoading } = useFolderLocks();
  const setLock = useSetFolderLock();
  const changePin = useChangeFolderLockPin();
  const deleteLock = useDeleteFolderLock();

  const [pickingPath, setPickingPath] = useState(false);
  const [pendingNewLock, setPendingNewLock] = useState(null); // path being locked
  const [changingPinFor, setChangingPinFor] = useState(null);
  const [removing, setRemoving] = useState(null);

  const handlePicked = useCallback((path) => {
    setPickingPath(false);
    setPendingNewLock(path);
  }, []);

  const handleSubmitNewLock = useCallback(
    async (pin) => {
      try {
        await setLock.mutateAsync({ path: pendingNewLock, pin });
        addNotification('success', `${pendingNewLock} is now locked`);
        setPendingNewLock(null);
      } catch (err) {
        addNotification('error', err.response?.data?.error || 'Failed to set lock');
      }
    },
    [pendingNewLock, setLock, addNotification],
  );

  const handleSubmitChangePin = useCallback(
    async (pin) => {
      try {
        await changePin.mutateAsync({ path: changingPinFor, pin });
        addNotification('success', `PIN updated for ${changingPinFor}`);
        setChangingPinFor(null);
      } catch (err) {
        addNotification('error', err.response?.data?.error || 'Failed to change PIN');
      }
    },
    [changingPinFor, changePin, addNotification],
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

  if (locksLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading…</div>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-2 gap-4">
        <div className="flex items-center gap-3">
          <FiShield className="text-blue-400" size={28} />
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white">Folder Locks</h1>
        </div>
        <button
          onClick={() => setPickingPath(true)}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <FiPlus size={16} /> Add Lock
        </button>
      </div>
      <p className="text-sm text-gray-400 mb-6 max-w-2xl">
        Lock any folder behind a 4-digit PIN. Every user — including admins — must enter the PIN to
        view its contents. Locks can't nest, and private user folders or the trash can't be locked.
      </p>

      <div className="bg-gray-800 rounded-lg shadow">
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-700">
          <h2 className="text-base sm:text-lg font-semibold text-white">
            Active locks ({locks.length})
          </h2>
        </div>

        {locks.length === 0 ? (
          <div className="px-4 sm:px-6 py-8 text-sm text-gray-400 text-center">
            No folders are locked. Use <span className="text-blue-400">Add Lock</span> to gate one.
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {locks.map((lock) => (
              <div
                key={lock.id}
                className="px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <FiLock className="text-amber-400 flex-shrink-0" size={20} />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-white text-sm break-all">{lock.path}</div>
                  <div className="text-xs text-gray-400">
                    Locked
                    {lock.createdByUsername && <> by {lock.createdByUsername}</>}
                    {lock.updatedAt && (
                      <> · updated {new Date(lock.updatedAt).toLocaleDateString()}</>
                    )}
                    {lock.pinFailures > 0 && (
                      <> · <span className="text-amber-400">{lock.pinFailures} recent miss(es)</span></>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setChangingPinFor(lock.path)}
                    className="px-3 py-1.5 text-sm border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700"
                  >
                    Change PIN
                  </button>
                  <button
                    onClick={() => setRemoving(lock.path)}
                    className="px-3 py-1.5 text-sm bg-red-900/40 text-red-300 border border-red-900 rounded-lg hover:bg-red-900/60"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pickingPath && (
        <PickFolderModal onPicked={handlePicked} onClose={() => setPickingPath(false)} />
      )}
      {pendingNewLock && (
        <PinSetModal
          title="Set PIN for new lock"
          subtitle={pendingNewLock}
          submitLabel="Lock Folder"
          busy={setLock.isPending}
          onClose={() => setPendingNewLock(null)}
          onSubmit={handleSubmitNewLock}
        />
      )}
      {changingPinFor && (
        <PinSetModal
          title="Change PIN"
          subtitle={changingPinFor}
          submitLabel="Update PIN"
          busy={changePin.isPending}
          onClose={() => setChangingPinFor(null)}
          onSubmit={handleSubmitChangePin}
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
