import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Keeps a rendering failure (a markdown edge case, a lazy chunk that failed to load) inside the piece
 * that failed, instead of blanking the whole app. Tries again when `resetKey` changes.
 */
export class RenderBoundary extends Component<
	{ children: ReactNode; fallback: (error: Error) => ReactNode; resetKey?: unknown },
	{ error: Error | undefined; resetKey: unknown }
> {
	override state = { error: undefined as Error | undefined, resetKey: this.props.resetKey };

	static getDerivedStateFromError(error: unknown) {
		return { error: error instanceof Error ? error : new Error(String(error)) };
	}

	static getDerivedStateFromProps(
		props: { resetKey?: unknown },
		state: { error: Error | undefined; resetKey: unknown },
	) {
		return props.resetKey === state.resetKey ? null : { error: undefined, resetKey: props.resetKey };
	}

	override componentDidCatch(error: unknown, info: ErrorInfo) {
		console.error("Render failed", error, info.componentStack);
	}

	override render() {
		return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
	}
}
