import React from "react";

// Class component is required here — error boundaries have no hooks
// equivalent yet. Without this, an uncaught render error anywhere in the
// tree (a bad puzzle generation edge case, a null profile field, etc.)
// unmounts the whole app to a blank white screen with nothing the user can
// do but reload and hope. This catches it, shows a recoverable message,
// and gives them a "Try again" button that clears the failure state
// (`key` remount) without a full page reload.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Logged for visibility in the console/devtools; there's no telemetry
    // backend wired up to send this anywhere.
    console.error("Unhandled error caught by ErrorBoundary:", error, info?.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset && this.props.onReset();
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <div
          style={{ background: "#F1F3F7", minHeight: "100vh" }}
          className="flex items-center justify-center px-6"
        >
          <div className="flex flex-col items-center text-center gap-3" style={{ maxWidth: 360 }}>
            <span style={{ fontSize: 32 }}>😕</span>
            <div style={{ color: "#1B2129", fontWeight: 700 }}>Something went wrong</div>
            <div style={{ color: "#1B2129", opacity: 0.6, fontSize: 13 }}>
              That wasn't supposed to happen. You can try again — your progress on other games is safe.
            </div>
            <button
              onClick={this.reset}
              className="mt-1 rounded-full px-5 py-2 text-sm font-semibold"
              style={{ background: "#2F6FED", color: "#FFFFFF" }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
