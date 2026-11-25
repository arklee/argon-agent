import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ConnectionConfig, DEFAULT_BACKEND_URL } from "@/lib/connection";

export function ConnectScreen({ error, onConnect }: { error?: string; onConnect: (config: ConnectionConfig) => void }) {
	const [url, setUrl] = useState(DEFAULT_BACKEND_URL);
	const [token, setToken] = useState("");
	return (
		<div className="flex h-full items-center justify-center p-6">
			<form
				className="w-full max-w-sm space-y-4"
				onSubmit={(e) => {
					e.preventDefault();
					if (token.trim()) onConnect({ url: url.trim(), token: token.trim() });
				}}
			>
				<div className="space-y-1">
					<h1 className="text-xl font-semibold">Connect to Argon</h1>
					<p className="text-sm text-muted-foreground">
						Start the backend with <code className="rounded bg-muted px-1">npm run dev</code> and open the link it
						prints, or paste the token here.
					</p>
				</div>
				{error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
				<div className="space-y-1.5">
					<label htmlFor="argon-backend-url" className="text-sm font-medium">
						Backend URL
					</label>
					<Input id="argon-backend-url" value={url} onChange={(e) => setUrl(e.target.value)} />
				</div>
				<div className="space-y-1.5">
					<label htmlFor="argon-token" className="text-sm font-medium">
						Token
					</label>
					<Input id="argon-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
				</div>
				<Button type="submit" className="w-full" disabled={!token.trim()}>
					Connect
				</Button>
			</form>
		</div>
	);
}
