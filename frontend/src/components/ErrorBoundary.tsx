import { Component, ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("NaniCare UI error boundary caught:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main
          role="alert"
          className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6"
        >
          <div className="max-w-md w-full rounded-lg border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center space-y-4">
            <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
              Something went wrong
            </h1>
            <p className="text-sm text-slate-700 dark:text-slate-300">
              Please reload NaniCare to continue viewing your verified medication schedule.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-[48px] px-6 py-2.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white font-semibold cursor-pointer"
            >
              Reload Page
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
