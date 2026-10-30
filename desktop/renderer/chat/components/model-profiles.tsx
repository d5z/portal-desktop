import { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicModelProfile } from "../../../shared/types";
import type { ChatRuntime } from "../models/chat";

type Runtime = Pick<ChatRuntime, "loadLlmConfig" | "applyConfigChange"> & Partial<Pick<ChatRuntime, "request">>;

/**
 * Loads only public route metadata. A stored key is used by the main process
 * when the next config PATCH omits api_key; it is never returned to this hook.
 */
export function useModelProfiles({
  runtime,
  open,
  enabled,
}: {
  runtime: Runtime;
  open: boolean;
  enabled: boolean;
}) {
  const api = enabled && typeof window !== "undefined" ? window.beings?.modelProfiles : undefined;
  const [profiles, setProfiles] = useState<PublicModelProfile[]>([]);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const result = await api({ action: "list" });
      if (result.ok) setProfiles(result.profiles);
    } catch {
      // Local memory is an enhancement. A malformed or unavailable store must
      // not disable the existing model settings flow.
    }
  }, [api]);

  useEffect(() => {
    if (!open || !api) return;
    void refresh();
  }, [api, open, refresh]);

  const profileFor = useCallback(
    (provider: string) => profiles.find(profile => profile.provider === provider),
    [profiles],
  );

  const wrappedRuntime = useMemo<Runtime>(() => {
    if (!api) return runtime;
    return {
      ...runtime,
      async applyConfigChange(patch) {
        const result = await runtime.applyConfigChange(patch);
        if (result?.ok && !result.rolled_back && !result.needs_key) void refresh();
        return result;
      },
    };
  }, [api, refresh, runtime]);

  return { runtime: wrappedRuntime, profileFor };
}
