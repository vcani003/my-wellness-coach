"use client";
/**
 * One error boundary per widget (0018): if a widget throws while rendering, only that widget
 * shows "Couldn't load this · Retry"; chat and the other widgets keep working.
 */
import { Component, type ReactNode } from "react";

interface Props {
  widgetId: string;
  fallback: (retry: () => void) => ReactNode;
  onRetry?: () => void;
  children: ReactNode;
}

export class WidgetErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Logged so it can be fixed (0018); a server-side client-error log comes later.
    console.error(`widget ${this.props.widgetId} failed to render`, error);
  }

  retry = () => {
    this.props.onRetry?.();
    this.setState({ failed: false });
  };

  render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}
