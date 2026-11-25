import { Activity, Home, Moon, ScanLine, Sun, Volume2 } from "lucide-react";
import { AppRoute, ThemeMode } from "../types/api";

interface TopBarProps {
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  backendBadge?: { connected: boolean; label: string } | null;
}

export function TopBar({
  route,
  onNavigate,
  theme,
  onToggleTheme,
  backendBadge,
}: TopBarProps) {
  const navItems: Array<{
    key: AppRoute;
    label: string;
    mobileLabel: string;
    Icon: typeof Home;
  }> = [
    { key: "select", label: "Home & Profile", mobileLabel: "Home", Icon: Home },
    { key: "nani", label: "Grandparents Mode", mobileLabel: "Elders", Icon: Volume2 },
    { key: "caregiver", label: "Caregiver Mode", mobileLabel: "Caregiver", Icon: ScanLine },
    { key: "vitals", label: "Vitals & Summary", mobileLabel: "Vitals", Icon: Activity },
  ];

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Brand Wordmark */}
          <button
            type="button"
            onClick={() => onNavigate("select")}
            className="font-display text-lg sm:text-xl font-extrabold tracking-tight text-slate-950 dark:text-white whitespace-nowrap shrink-0 cursor-pointer hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
          >
            NaniCare
          </button>

          {/* Desktop Navigation */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-6 text-sm font-semibold"
          >
            {navItems.map((item) => {
              const active = route === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => onNavigate(item.key)}
                  className={`py-2 px-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors border-b-2 ${
                    active
                      ? "text-teal-800 dark:text-teal-300 border-teal-700 dark:border-teal-400"
                      : "text-slate-700 dark:text-slate-300 border-transparent hover:text-slate-950 dark:hover:text-white"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Status Indicator & Theme Toggle */}
          <div className="flex items-center gap-2 shrink-0">
            {backendBadge && (
              <span
                className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border whitespace-nowrap ${
                  backendBadge.connected
                    ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200"
                    : "border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    backendBadge.connected ? "bg-emerald-600" : "bg-slate-500"
                  }`}
                  aria-hidden="true"
                />
                <span>{backendBadge.label}</span>
              </span>
            )}
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="inline-flex items-center gap-2 min-h-[44px] px-3 sm:px-3.5 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs sm:text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {theme === "dark" ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
                  <span className="hidden xs:inline sm:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-slate-700" aria-hidden="true" />
                  <span className="hidden xs:inline sm:inline">Dark</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar (< 768px) for 1-hand WCAG touch access */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 grid grid-cols-4"
      >
        {navItems.map(({ key, mobileLabel, Icon }) => {
          const active = route === key;
          return (
            <button
              key={key}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(key)}
              className={`min-h-[60px] flex flex-col items-center justify-center gap-1 px-1 py-2 text-xs font-bold transition-colors cursor-pointer border-t-2 ${
                active
                  ? "border-teal-700 dark:border-teal-400 bg-teal-50 dark:bg-teal-950/40 text-teal-900 dark:text-teal-200"
                  : "border-transparent text-slate-700 dark:text-slate-300"
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>{mobileLabel}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
