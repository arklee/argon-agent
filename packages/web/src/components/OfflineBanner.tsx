import { useEffect, useState } from "react";

export function OfflineBanner({ retryInMs }: { retryInMs?: number }) {
	const [seconds, setSeconds] = useState(Math.ceil((retryInMs ?? 0) / 1000));
	useEffect(() => {
		if (retryInMs === undefined) return;
		const deadline = Date.now() + retryInMs;
		const timer = window.setInterval(() => setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
		return () => window.clearInterval(timer);
	}, [retryInMs]);
	return (
		<div role="status" className="border-b bg-amber-500/10 px-4 py-1.5 text-sm">
			Disconnected from the backend — reconnecting… {retryInMs !== undefined && `(${seconds}s)`}
		</div>
	);
}
