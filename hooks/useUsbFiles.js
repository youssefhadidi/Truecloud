/** @format */

import { useQuery } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';
import { parseUsbPath } from '@/lib/usbPath';

export function useUsbFiles(currentPath, enabled = true) {
  const parsed = parseUsbPath(currentPath);
  const mountpoint = parsed?.mountpoint || '';
  const subPath = parsed?.subPath || '';
  const active = enabled && !!mountpoint;

  const { data, isPending, isFetching, ...rest } = useQuery({
    queryKey: ['usb-files', mountpoint, subPath],
    queryFn: async () => {
      const url = `/api/usb-drives/ls?mountpoint=${encodeURIComponent(mountpoint)}&path=${encodeURIComponent(subPath)}`;
      const response = await axios.get(url);
      const items = response.data?.items || [];
      const files = items.map((item) => ({
        id: item.name,
        name: item.name,
        displayName: item.name,
        isDirectory: !!item.isDirectory,
        size: Number(item.size) || 0,
        createdAt: item.mtime ? new Date(item.mtime) : new Date(),
        updatedAt: item.mtime ? new Date(item.mtime) : new Date(),
        _usbReadOnly: true,
      }));
      return { files };
    },
    enabled: active,
  });

  const isLoading = active && isPending && !data;

  return {
    files: data?.files || [],
    isPending,
    isFetching,
    isLoading,
    ...rest,
  };
}
