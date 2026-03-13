import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/sora/400.css";
import "@fontsource/sora/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

type CrashState = {
  message: string;
  stack?: string;
};

function isRecoverableNetworkError(error: Error) {
  return (
    error.name === "AbortError" ||
    /Failed to fetch/i.test(error.message) ||
    /NetworkError/i.test(error.message) ||
    /Load failed/i.test(error.message)
  );
}

class AppErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: CrashState | null }
> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown) {
    const nextError =
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: String(error) };

    return { error: nextError };
  }

  componentDidCatch(error: unknown) {
    console.error("Codex UI render crash:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash-screen">
          <h1>Frontend crash</h1>
          <p>{this.state.error.message}</p>
          {this.state.error.stack ? <pre>{this.state.error.stack}</pre> : null}
        </div>
      );
    }

    return this.props.children;
  }
}

function renderGlobalCrash(message: string, stack?: string) {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }

  root.innerHTML = `
    <div class="crash-screen">
      <h1>Frontend crash</h1>
      <p>${message}</p>
      ${stack ? `<pre>${stack}</pre>` : ""}
    </div>
  `;
}

window.addEventListener("error", (event) => {
  console.error("Codex UI global error:", event.error ?? event.message);
  renderGlobalCrash(String(event.message ?? "Unknown error"), event.error?.stack);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
  console.error("Codex UI unhandled rejection:", reason);

  if (isRecoverableNetworkError(reason)) {
    event.preventDefault();
    return;
  }

  renderGlobalCrash(reason.message, reason.stack);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
