/* ==========================================================
   useDynamicModels — Hook load model list theo adapter + creds.
   - Tự fetch khi mount + khi adapter/apiKey/endpoint đổi
   - Trả về { models, loading, source, error, refresh }
   - source: "cache" | "api" | "fallback"
   ========================================================== */
import { useCallback, useEffect, useRef, useState } from "react";
import { FALLBACK_MODELS, type ListModelsResult, listModels } from "@/core/llm/list-models";

export interface UseDynamicModelsResult {
  models: string[];
  loading: boolean;
  source: ListModelsResult["source"] | null;
  error?: string;
  /** Force fetch, bỏ cache */
  refresh: () => Promise<void>;
}

export function useDynamicModels(
  adapter: string,
  opts: { apiKey?: string; endpoint?: string } = {},
): UseDynamicModelsResult {
  const [models, setModels] = useState<string[]>(FALLBACK_MODELS[adapter] ?? []);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<ListModelsResult["source"] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const reqId = useRef(0);

  const apiKey = opts.apiKey;
  const endpoint = opts.endpoint;
  const doFetch = useCallback(
    async (force: boolean) => {
      const myId = ++reqId.current;
      setLoading(true);
      setError(undefined);
      const res = await listModels(adapter, { apiKey, endpoint, force });
      // Tránh race: chỉ cập nhật khi vẫn là request mới nhất
      if (myId !== reqId.current) return;
      setModels(res.models);
      setSource(res.source);
      setError(res.error);
      setLoading(false);
    },
    [adapter, apiKey, endpoint],
  );

  // Auto-fetch khi adapter/key/endpoint đổi
  useEffect(() => {
    doFetch(false);
  }, [doFetch]);

  const refresh = useCallback(() => doFetch(true), [doFetch]);

  return { models, loading, source, error, refresh };
}
