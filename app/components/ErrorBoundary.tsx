"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { fallback: ReactNode; label?: string; children: ReactNode };
type State = { hasError: boolean };

/** Contains render errors in a subtree so they can't take down the whole page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ""}]`, error, info.componentStack);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
