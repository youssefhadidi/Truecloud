/** @format */

import { getThumbnailUrl, getShareThumbnailUrl, fileVersion } from '@/lib/api/files';

export function useShareAwareThumbnail(file, currentPath, enabled, shareToken, sharePassword) {
  if (!enabled) return null;
  return shareToken
    ? getShareThumbnailUrl(shareToken, file.name, currentPath, sharePassword, fileVersion(file))
    : getThumbnailUrl(file.id, currentPath, fileVersion(file));
}
