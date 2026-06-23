"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

/**
 * Toggles the editorial light / gallery-dark themes. The initial theme is set
 * before paint by an inline script in the layout (localStorage → system pref),
 * so this only mirrors and updates that state — no flash, no hydration mismatch.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    setTheme(current === "dark" ? "dark" : "light");
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("trove-theme", next);
    } catch {
      // ignore (private mode, etc.)
    }
    setTheme(next);
  };

  return (
    <button className="themetoggle" onClick={toggle} aria-label="Toggle dark mode">
      {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
