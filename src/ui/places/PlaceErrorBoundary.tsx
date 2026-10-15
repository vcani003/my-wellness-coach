"use client";
/**
 * One error boundary per place and per Today card (0018): if one throws while rendering, only it
 * shows "Couldn't load this · Retry"; the chat, the dock and the rest keep working.
 */
import { Component, type ReactNode } from "react";

interface Props {
  placeId: string;
  fallback: (retry: () => void) => ReactNode;
  onRetry?: () => void;
  children: ReactNode;
}

export class PlaceErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Logged so it can be fixed (0018); a server-side client-error log comes later.
    console.error(`place ${this.props.placeId} failed to render`, error);
  }

  retry = () => {
    this.props.onRetry?.();
    this.setState({ failed: false });
  };

  render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}
