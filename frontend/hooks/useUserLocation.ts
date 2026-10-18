"use client";

import { useEffect, useState } from "react";

const CACHE_KEY = "user_city";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam

type Status = "idle" | "loading" | "granted" | "denied" | "error";

interface CachedLocation {
  city: string;
  savedAt: number;
}

export function useUserLocation() {
  const [city, setCity] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached: CachedLocation = JSON.parse(raw);
        const age = Date.now() - cached.savedAt;
        if (age < CACHE_TTL_MS && cached.city) {
          setCity(cached.city);
          setStatus("granted");
          return;
        }
      }
    } catch {}

    if (!navigator.geolocation) {
      setStatus("error");
      return;
    }

    setStatus("loading");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;

          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=id`,
            {
              headers: {
                "User-Agent": "Happy-AI-Shopping-Assistant/1.0",
              },
            },
          );

          if (!res.ok) {
            setStatus("error");
            return;
          }

          const data = await res.json();
          const address = data.address || {};

          const detectedCity =
            address.city ||
            address.town ||
            address.village ||
            address.county ||
            address.state;

          if (!detectedCity) {
            setStatus("error");
            return;
          }

          const toCache: CachedLocation = {
            city: detectedCity,
            savedAt: Date.now(),
          };
          localStorage.setItem(CACHE_KEY, JSON.stringify(toCache));

          setCity(detectedCity);
          setStatus("granted");
        } catch (err) {
          console.error("Reverse geocode failed:", err);
          setStatus("error");
        }
      },
      (err) => {
        console.warn("Geolocation denied/error:", err.message);
        if (err.code === err.PERMISSION_DENIED) {
          setStatus("denied");
        } else {
          setStatus("error");
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 60000,
      },
    );
  }, []);

  return { city, status };
}
