/** @format */

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useQueryClient } from '@tanstack/react-query';
import { useDispatch } from 'react-redux';
import { clearAllTransfers, setTransferring } from '@/lib/redux/slices/transfersSlice';
import { clearAll as clearFileOps } from '@/lib/redux/slices/fileOpsSlice';
import { clearSelection } from '@/lib/redux/slices/selectionSlice';
import { closeAllModals } from '@/lib/redux/slices/modalsSlice';
import { resetFolderCreation } from '@/lib/redux/slices/folderCreationSlice';

/**
 * Sign the user out and wipe in-memory client state that should not persist
 * across sessions (React Query cache, Redux slices for file ops / selection /
 * modals / transfers / folder creation). Browser-level prefs in localStorage
 * (viewMode, sortBy) are intentionally kept.
 */
export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const dispatch = useDispatch();

  return useCallback(async () => {
    await signOut({ redirect: false });

    queryClient.clear();

    dispatch(clearAllTransfers());
    dispatch(setTransferring(false));
    dispatch(clearFileOps());
    dispatch(clearSelection());
    dispatch(closeAllModals());
    dispatch(resetFolderCreation());

    router.push('/auth/login');
  }, [router, queryClient, dispatch]);
}
