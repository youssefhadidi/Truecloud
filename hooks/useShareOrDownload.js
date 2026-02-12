/** @format */

import { useCallback } from 'react';
import { useNotifications } from '@/contexts/NotificationsContext';

/**
 * Hook for handling file downloads with Web Share API fallback
 * - Uses Web Share API (navigator.share) if available
 * - Falls back to traditional blob download
 * - Works on iOS, Android, and Desktop
 */
export function useShareOrDownload() {
  const { addNotification } = useNotifications();

  const handleShareOrDownload = useCallback(
    async (fileUrl, fileName) => {
      try {
        // Fetch the file as a blob
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.status}`);
        }

        const blob = await response.blob();

        // Check if Web Share API is available
        if (navigator.share) {
          try {
            // Create a File object for sharing
            const file = new File([blob], fileName, { type: blob.type });

            // Check if this device can share files
            // Note: canShare is not available in all browsers, so we wrap in try-catch
            if (navigator.canShare && !navigator.canShare({ files: [file] })) {
              // Device doesn't support file sharing, fall back to download
              performDownload(blob, fileName);
            } else {
              // Attempt to share
              await navigator.share({
                files: [file],
              });
            }
          } catch (shareError) {
            // Share API cancelled by user or not supported, fall back to download
            if (shareError.name !== 'AbortError') {
              console.warn('Share failed, falling back to download:', shareError);
            }
            performDownload(blob, fileName);
          }
        } else {
          // Web Share API not available, use traditional download
          performDownload(blob, fileName);
        }
      } catch (error) {
        console.error('Download/share error:', error);
        addNotification('error', `Failed to download ${fileName}`);
      }
    },
    [addNotification]
  );

  return { handleShareOrDownload };
}

/**
 * Perform traditional browser download using blob URL
 */
function performDownload(blob, fileName) {
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(blobUrl);
}
