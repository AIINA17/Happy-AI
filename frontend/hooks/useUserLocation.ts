"use client";

import { useCallback, useEffect, useState } from "react";

// Legacy localStorage key — older builds persisted the city across days.
// We now resolve fresh on every mount, but we still clean up this key on
// first use so stale values from previous installs don't sit in the user's
// browser forever.
const LEGACY_CACHE_KEY = "user_city";

type Status = "idle" | "loading" | "granted" | "denied" | "error";

function getInitialState(): { city: string | null; status: Status } {
  // Always start fresh — do NOT read the city from localStorage. Previously
  // we cached for 24h, so a user who moved cities mid-day (e.g. Jogja ->
  // Jakarta) would still see Jogja-based recommendations for up to a day.
  // Now every mount (new page load / new session start) re-fetches
  // geolocation so the agent always has an accurate "where am I".
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(LEGACY_CACHE_KEY);
    } catch {}
  }

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { city: null, status: "error" };
  }

  return { city: null, status: "loading" };
}

function fetchAndStoreLocation(
  setCity: (city: string | null) => void,
  setStatus: (status: Status) => void,
) {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
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

        // No longer persisted to localStorage — the city lives in React
        // state only, and resets on the next page load / session start.
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
      maximumAge: 0,
    },
  );
}

export function useUserLocation() {
  const [initial] = useState(getInitialState);
  const [city, setCity] = useState<string | null>(initial.city);
  const [status, setStatus] = useState<Status>(initial.status);

  useEffect(() => {
    if (status !== "loading") return;
    fetchAndStoreLocation(setCity, setStatus);
  }, [status]);

  const refresh = useCallback(() => {
    // Nothing cached to clear anymore — just re-run the geolocation flow.
    // Kept exported so callers can force a re-detect mid-session (e.g. if
    // the user wants to update their city without reloading the page).
    fetchAndStoreLocation(setCity, setStatus);
  }, []);

  return { city, status, refresh };
}
