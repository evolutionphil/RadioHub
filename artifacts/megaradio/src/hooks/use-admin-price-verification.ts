import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";

/** A verification belongs to one draft, never a later price or edit session. */
export function useAdminPriceVerification<T extends { valid: boolean; error?: string }>(endpoint: string) {
  const revision = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<T | null>(null);
  const reset = () => {
    revision.current++;
    controller.current?.abort();
    controller.current = null;
    setVerifying(false);
    setResult(null);
  };
  useEffect(() => () => { revision.current++; controller.current?.abort(); }, []);
  const verify = async (priceId: string, onVerified?: (result: T) => void) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const current = ++revision.current;
    setVerifying(true);
    setResult(null);
    try {
      const response = await apiRequest("POST", endpoint, { body: { priceId: priceId.trim() }, signal: request.signal });
      const data: T = await response.json();
      if (current !== revision.current || request.signal.aborted) return;
      setResult(data);
      onVerified?.(data);
    } catch (error) {
      if (current === revision.current && !request.signal.aborted) {
        setResult({ valid: false, error: error instanceof Error ? error.message : "Verification failed" } as T);
      }
    } finally {
      if (current === revision.current) { controller.current = null; setVerifying(false); }
    }
  };
  return { verifying, result, reset, verify };
}
