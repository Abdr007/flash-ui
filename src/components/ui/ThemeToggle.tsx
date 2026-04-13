"use client";

import { useState, useEffect, useCallback } from "react";

type Theme = "system" | "dark" | "light";

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem("flash-theme") as Theme) ?? "system";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark-mode", "light-mode");
    if (theme === "dark") root.classList.add("dark-mode");
    else if (theme === "light") root.classList.add("light-mode");
    localStorage.setItem("flash-theme", theme);
  }, [theme]);

  const next = useCallback(() => {
    setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"));
  }, []);

  const icon = theme === "light" ? "\u2600" : theme === "dark" ? "\uD83C\uDF19" : "\u2699";

  return (
    <button
      onClick={next}
      aria-label={`Theme: ${theme}`}
      className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer
        text-[14px] transition-all duration-200 hover:bg-white/[0.06]"
      style={{ color: "var(--color-text-tertiary)" }}
      title={`Theme: ${theme}`}
    >
      {icon}
    </button>
  );
}
