import { useState, useEffect } from "react";

const DEFAULT_BASE_FEE = 0.71;
const FEE_PERCENT = 0.0035;

// Module-level cache so every hook instance shares a single fetch
let feePromise: Promise<{ baseFee: number; solPrice?: number }> | null = null;

export function getCachedFee() {
  if (!feePromise) {
    feePromise = fetch("/api/fee")
      .then((r) => r.json())
      .catch(() => ({ baseFee: DEFAULT_BASE_FEE }));
  }
  return feePromise;
}

export function useFee() {
  const [baseFee, setBaseFee] = useState(DEFAULT_BASE_FEE);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCachedFee()
      .then((data) => {
        if (data.baseFee != null) setBaseFee(data.baseFee);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  return { baseFee, feePercent: FEE_PERCENT, isLoading, error };
}
