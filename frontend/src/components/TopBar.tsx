import { Moon, Sun } from "lucide-react";
import { AppRoute, ThemeMode } from "../types/api";

interface TopBarProps {
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
}

export function TopBar({ route, onNavigate, theme, onToggleTheme }: TopBarProps) {
  const navItems: Array<{ key: AppRoute; label: string }> = [
    { key: "select", label: "Choose Mode" },
    { key: "nani", label: "Grandparents Mode" },
    { key: "caregiver", label: "Caregiver Mode" },
    { key: "vitals", label: "Vitals" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-element brand wordmark */}
        <button
          type="button"
          onClick={() => onNavigate("select")}
          className="font-display text-xl font-extrabold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 cursor-pointer hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
        >
          NaniCare
        </button>

        {/* Zone 2: 4 concise single-line nav links */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-7 text-sm font-medium"
        >
          {navItems.map((item) => {
            const active = route === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate(item.key)}
                className={`py-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors border-b-2 ${
                  active
                    ? "text-teal-700 dark:text-teal-400 border-teal-700 dark:border-teal-400 font-semibold"
                    : "text-slate-600 dark:text-slate-300 border-transparent hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary theme switch */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {theme === "dark" ? (
              <>
                <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
                <span>Light Mode</span>
              </>
            ) : (
              <>
                <Moon className="w-4 h-4 text-slate-700" aria-hidden="true" />
                <span>Dark Mode</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
