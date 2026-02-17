/** @format */

import { useCallback } from 'react';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useTransfersDispatch } from '@/lib/redux/hooks';
import { useDownloadFileBlob } from '@/lib/api/publicShares';

/**
 * Hook for handling file downloads with Web Share API fallback
 * - Uses Web Share API (navigator.share) if available and device supports it
 * - Falls back to direct browser download without fetching
 * - Works on iOS, Android, and Desktop
 */
export function useShareOrDownload() {
  const { addNotification } = useNotifications();
  const { addTransfer, updateTransfer, removeTransfer } = useTransfersDispatch();
  const downloadMutation = useDownloadFileBlob();

  const handleShareOrDownload = useCallback(
    async (fileUrl, fileName) => {
      const downloadId = Date.now() + Math.random();

      try {
        // Add download to transfer list
        addTransfer({
          id: downloadId,
          fileName,
          progress: 0,
          status: 'downloading',
          type: 'download',
        });

        // Use Web Share API only on mobile devices (iOS/Android)
        // Desktop browsers also support navigator.share but we want normal downloads there
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const hasShareAPI = isMobile && !!navigator.share;

        if (hasShareAPI) {
          // Only fetch if we're going to use Web Share API
          try {
            const blob = await downloadMutation.mutateAsync({
              url: fileUrl,
              onProgress: (progressEvent) => {
                if (progressEvent.total) {
                  const progress = Math.round((progressEvent.loaded / progressEvent.total) * 100);
                  updateTransfer(downloadId, { progress });
                }
              },
            });

            const mimeType = blob.type || 'application/octet-stream';
            const file = new File([blob], fileName, { type: mimeType });

            // Check if this device can share files
            // Note: canShare is not available in all browsers, so we wrap in try-catch
            if (navigator.canShare && !navigator.canShare({ files: [file] })) {
              // Device doesn't support file sharing, fall back to direct browser download
              performDirectDownload(fileUrl, fileName);
              updateTransfer(downloadId, { status: 'success', progress: 100 });
              setTimeout(() => removeTransfer(downloadId), 3000);
            } else {
              // Attempt to share
              try {
                await navigator.share({
                  files: [file],
                });
                // Share was successful
                updateTransfer(downloadId, { status: 'success', progress: 100 });
                setTimeout(() => {
                  removeTransfer(downloadId);
                }, 3000);
              } catch (shareError) {
                // If user cancelled the share, treat as cancellation and do NOT
                // fall back to performing a direct download. For other errors,
                // fall back to direct download.
                if (shareError && shareError.name === 'AbortError') {
                  updateTransfer(downloadId, { status: 'cancelled' });
                  addNotification('info', `Download cancelled ${fileName ? `: ${fileName}` : ''}`);
                  setTimeout(() => removeTransfer(downloadId), 3000);
                  return;
                }

                console.warn('Share failed, falling back to download:', shareError);
                performDirectDownload(fileUrl, fileName);
                updateTransfer(downloadId, { status: 'success', progress: 100 });
                setTimeout(() => removeTransfer(downloadId), 3000);
              }
            }
          } catch (fetchError) {
            console.error('Failed to fetch file for sharing:', fetchError);
            addNotification('error', `Failed to download ${fileName}`);
            updateTransfer(downloadId, { status: 'error', error: fetchError.message });
          }
        } else {
          // Web Share API not available, use direct browser download (no fetch needed)
          performDirectDownload(fileUrl, fileName);
          updateTransfer(downloadId, { status: 'success', progress: 100 });
          setTimeout(() => removeTransfer(downloadId), 3000);
        }
      } catch (error) {
        console.error('Download/share error:', error);
        addNotification('error', `Failed to download ${fileName}`);
        updateTransfer(downloadId, { status: 'error', error: error.message });
      }
    },
    [addNotification, addTransfer, updateTransfer, removeTransfer, downloadMutation],
  );

  return { handleShareOrDownload };
}

/**
 * Perform direct browser download via link (no blob fetching)
 * Browser handles the download, respects Content-Disposition headers
 */
function performDirectDownload(fileUrl, fileName) {
  const link = document.createElement('a');
  link.href = fileUrl;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
