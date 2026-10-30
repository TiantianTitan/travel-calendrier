"use client";

import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};

/** CSS alone cannot disable dnd-kit's Web Animations API drop motion. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => true);
}
