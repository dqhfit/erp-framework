import { createLegacyMenuClient } from "@erp-framework/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const QUERY_KEY = ["navTree"] as const;

export function useNavTree() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => createLegacyMenuClient("").navTree(),
    staleTime: 10_000,
    gcTime: 5 * 60_000,
  });
}

export function useInvalidateNavTree() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
}
