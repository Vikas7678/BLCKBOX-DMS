import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; resetKey: string; fallback?: ReactNode };
type State = { error: Error | null };

/** Isolates OnlyOffice DOM crashes so the rest of the preview page stays up. */
export class PreviewErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[preview]", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <p className="muted preview-loading">Preview failed to load. Try Refresh.</p>
        )
      );
    }
    return this.props.children;
  }
}
