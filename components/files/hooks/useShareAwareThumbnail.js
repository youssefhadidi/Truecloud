/** @format */

import { getThumbnailUrl, getShareThumbnailUrl } from '@/lib/api/files';

export function useShareAwareThumbnail(file, currentPath, enabled, shareToken, sharePassword) {
  if (!enabled) return null;
  return shareToken
    ? getShareThumbnailUrl(shareToken, file.name, currentPath, sharePassword)
    : getThumbnailUrl(file.id, currentPath);
}
