import { useState, useCallback } from "react";

export function usePairing() {
  const [paired, setPaired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const pairWithHost = useCallback(async (host: string, code: string) => {
    setLoading(true);
    setError(null);

    const cleanHost = host.trim().replace(/^https?:\/\//, "").replace(/:\d+$/, "");
    const url = `http://${cleanHost}:8765/pair`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setPaired(true);
        setLoading(false);
        return true;
      } else {
        setError(data.message || "Invalid pairing PIN");
        setLoading(false);
        return false;
      }
    } catch (err) {
      setError(`Connection failed: Check IP & ensure SPRYGEN desktop is running.`);
      setLoading(false);
      return false;
    }
  }, []);

  return { paired, error, loading, pairWithHost };
}
