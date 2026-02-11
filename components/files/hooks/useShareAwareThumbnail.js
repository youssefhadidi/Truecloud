/** @format */

import { useThumbnail, useShareThumbnail } from '@/lib/api/files';

export function useShareAwareThumbnail(file, currentPath, enabled, shareToken, sharePassword) {
  const authenticated = useThumbnail(file.id, currentPath, enabled && !shareToken);
  const shared = useShareThumbnail(shareToken, file.name, currentPath, sharePassword, enabled && !!shareToken);
  return shareToken ? shared : authenticated;
}
