import { useState, useEffect } from "react";

const MOBILE_BREAKPOINT = 1100;

/**
 * Возвращает true при ширине viewport <= 1100px (мобильная полоса навигации в style.css).
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const handler = () => setIsMobile(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isMobile;
}
