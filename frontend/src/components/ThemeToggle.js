import React, { useEffect, useRef, useState } from "react";

// =========================================================
// THEME TOGGLE — day / night
//
// The current theme lives on <html data-theme="day|night">
// (set before React loads by the script in public/index.html,
// so there's no flash on refresh). Switching saves the choice
// and, where the browser supports View Transitions, sweeps the
// new theme across the screen as a circle of light spreading
// out from the toggle.
// =========================================================

const STORAGE_KEY = "seatsure_theme";

function readTheme() {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "night" ? "night" : "day";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "night" ? "#0E1511" : "#EDEFEA");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch (e) {
    // storage blocked (private window etc.) — theme still applies for this visit
  }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(readTheme);
  const buttonRef = useRef(null);

  // Keep meta theme-color in sync on first load too.
  useEffect(() => {
    applyTheme(readTheme());
  }, []);

  const toggle = () => {
    const next = theme === "night" ? "day" : "night";

    const reduceMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!document.startViewTransition || reduceMotion) {
      applyTheme(next);
      setTheme(next);
      return;
    }

    const rect = buttonRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const transition = document.startViewTransition(() => {
      applyTheme(next);
      setTheme(next);
    });

    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${radius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 700,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            pseudoElement: "::view-transition-new(root)",
          }
        );
      })
      .catch(() => {});
  };

  const isNight = theme === "night";

  return (
    <button
      ref={buttonRef}
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-pressed={isNight}
      aria-label={isNight ? "Switch to day theme" : "Switch to night theme"}
      title={isNight ? "Switch to day" : "Switch to night"}
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <span className="theme-toggle-knob" />
      </span>
      <span className="theme-toggle-label">{isNight ? "Night" : "Day"}</span>
    </button>
  );
}
