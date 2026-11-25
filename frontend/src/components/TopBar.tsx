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
      <header className="sticky top-0 z-40 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-4">
          {/* Brand Wordmark */}
          <button
            type="button"
            onClick={() => onNavigate("select")}
            className="font-display text-lg font-bold tracking-tight text-slate-950 dark:text-white whitespace-nowrap shrink-0 cursor-pointer hover:text-blue-700 dark:hover:text-blue-400 transition-colors"
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
                      ? "text-blue-800 dark:text-blue-300 border-blue-700 dark:border-blue-400"
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
                className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-medium border whitespace-nowrap ${
                  backendBadge.connected
                    ? "border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-green-900 dark:text-green-200"
                    : "border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    backendBadge.connected ? "bg-green-700 dark:bg-green-400" : "bg-slate-500"
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
              className="inline-flex items-center gap-2 min-h-[44px] px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs sm:text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {theme === "dark" ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
                  <span className="hidden sm:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-slate-700" aria-hidden="true" />
                  <span className="hidden sm:inline">Dark</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar (< 768px) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 grid grid-cols-4 pb-[env(safe-area-inset-bottom)]"
      >
        {navItems.map(({ key, mobileLabel, Icon }) => {
          const active = route === key;
          return (
            <button
              key={key}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(key)}
              className={`min-h-[58px] flex flex-col items-center justify-center gap-1 px-1 py-2 text-xs font-semibold transition-colors cursor-pointer border-t-2 ${
                active
                  ? "border-blue-700 dark:border-blue-400 bg-blue-50/70 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200"
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
