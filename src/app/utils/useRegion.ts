'use client';

import { useEffect, useState } from 'react';

/**
 * useRegion — client hook for the inside/outside-Türkiye detection.
 * Fetches /api/geo once per browser session (sessionStorage cache) and
 * exposes { country, inTurkey, loading } so pages can personalise services.
 */

export type RegionInfo = {
  country: string | null;
  inTurkey: boolean;
  loading: boolean;
};

const CACHE_KEY = 'tg_region';

export function useRegion(): RegionInfo {
  const [region, setRegion] = useState<RegionInfo>({
    country: null,
    inTurkey: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        setRegion({ ...parsed, loading: false });
        return;
      }
    } catch {
      // no sessionStorage / corrupt cache — just fetch fresh
    }

    fetch('/api/geo')
      .then((res) => (res.ok ? res.json() : null))
      .then((geo) => {
        if (cancelled) return;
        const info: RegionInfo = {
          country: geo?.country ?? null,
          inTurkey: geo?.in_turkey === true,
          loading: false,
        };
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify(info));
        } catch {
          // ignore — cache is best-effort
        }
        setRegion(info);
      })
      .catch(() => {
        if (!cancelled) {
          setRegion({ country: null, inTurkey: false, loading: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return region;
}
