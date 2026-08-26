/** @format */

import { useQuery } from '@tanstack/react-query';
import axios from '@/lib/axiosConfig';

const BASE = '/api/admin/pilogs';

export const pilogsKeys = {
  report: (params) => ['pilogs', 'report', params],
};

/**
 * Per-client DNS category breakdown. The report scans FTL's database, so it is
 * comparatively expensive — keep it stale for a while and never poll it.
 */
export function usePiholeCategoryReport({ hours = 24, topDomains = 8 } = {}, { enabled = true } = {}) {
  return useQuery({
    queryKey: pilogsKeys.report({ hours, topDomains }),
    queryFn: async () => {
      const { data } = await axios.get(BASE, { params: { hours, topDomains } });
      return data;
    },
    staleTime: 60_000,
    placeholderData: (previous) => previous,
    enabled,
  });
}
