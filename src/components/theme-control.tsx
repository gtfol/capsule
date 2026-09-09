"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { getResolvedTheme, getServerResolvedTheme, setThemePreference, subscribeTheme } from "@/lib/theme";

export function ThemeControl() {
  const theme = useSyncExternalStore(subscribeTheme, getResolvedTheme, getServerResolvedTheme);
  const next = theme === "dark" ? "light" : "dark";
  return <button type="button" className="nav-button flex items-center justify-center" aria-label={`Switch to ${next} mode`} title="Toggle theme" onClick={() => setThemePreference(next)}>
    {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
  </button>;
}
