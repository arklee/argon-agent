import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { PermissionMode, SandboxSupport } from "@argon/shared";

export function sandboxSupport(platform: string = process.platform): SandboxSupport {
	return platform === "darwin"
		? { supported: true, mechanism: "seatbelt" }
		: { supported: false, reason: `The sandbox is not available on ${platform === "win32" ? "Windows" : "Linux"} yet` };
}

export function effectiveMode(mode: PermissionMode, support = sandboxSupport()): PermissionMode {
	return support.supported ? mode : "auto";
}

/** Resolve even new files against their nearest existing ancestor. Broken symlinks fail closed. */
export function canonicalPath(path: string): string {
	try {
		return realpathSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		try {
			if (lstatSync(path).isSymbolicLink()) throw new Error(`Unresolved symlink: ${path}`);
		} catch (statError) {
			if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
		}
		const parent = dirname(path);
		if (parent === path) throw error;
		return join(canonicalPath(parent), path.slice(parent.length));
	}
}

export function within(path: string, root: string): boolean {
	return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

export const PROTECTED_NAMES = [".git", ".argon", ".pi", ".mcp.json"];

/**
 * Resolve a file-tool path the way pi's file tools spell it (notably @, ~ and file://). Tools that write
 * files must resolve with this too, so the sandbox check sees the path that is written.
 */
export function resolveToolPath(path: string, cwd: string, home = homedir()): string {
	let normalized = path.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ").replace(/^@/, "");
	normalized = normalized.replace(/^~(?=$|\/)/, home);
	if (normalized.startsWith("file://")) normalized = fileURLToPath(normalized);
	return resolve(cwd, normalized);
}

export class SandboxPolicy {
	readonly writableRoots: string[];
	readonly readDeny: string[];
	readonly writeDeny: string[];

	constructor(
		readonly cwd: string,
		argonHome: string,
		readonly home = homedir(),
		temps = [tmpdir(), "/tmp", "/private/tmp"],
	) {
		this.writableRoots = [...new Set([cwd, ...temps].map((p) => canonicalPath(resolve(p))))];
		const aliases = (paths: string[]) => [...new Set(paths.flatMap((p) => [p, canonicalPath(p)]))];
		this.readDeny = aliases([
			resolve(argonHome),
			...[
				".ssh",
				".aws",
				".config/gcloud",
				".azure",
				".kube",
				".docker/config.json",
				".netrc",
				".npmrc",
				".pi/agent/auth.json",
			].map((p) => join(home, p)),
		]);
		this.writeDeny = aliases([
			...this.readDeny,
			...[".zshrc", ".bashrc", ".bash_profile", ".profile", ".zprofile", ".gitconfig"].map((p) => join(home, p)),
			...this.writableRoots.flatMap((root) => PROTECTED_NAMES.map((name) => join(root, name))),
		]);
		// A worktree's git metadata may live outside cwd (but within a temporary writable root).
		for (let dir = canonicalPath(resolve(cwd)); ; dir = dirname(dir)) {
			try {
				const match = /^gitdir:\s*(.+)\s*$/m.exec(readFileSync(join(dir, ".git"), "utf8"));
				if (match?.[1]) this.writeDeny.push(canonicalPath(resolve(dir, match[1].trim())));
			} catch (error) {
				if (!["ENOENT", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
			}
			if (dirname(dir) === dir) break;
		}
	}

	resolve(path: string): string {
		return resolveToolPath(path, this.cwd, this.home);
	}

	canRead(path: string, recursive = false): boolean {
		try {
			const absolute = this.resolve(path);
			// read also retries NFD and macOS screenshot spellings. Check every candidate.
			const candidates = [
				absolute,
				absolute.normalize("NFD"),
				absolute.replace(/'/g, "’"),
				absolute.normalize("NFD").replace(/'/g, "’"),
				absolute.replace(/ (AM|PM)\./gi, "\u202F$1."),
			];
			return candidates.every((candidate) => {
				const real = canonicalPath(candidate);
				return !this.readDeny.some(
					(deny) => within(candidate, deny) || within(real, deny) || (recursive && within(deny, real)),
				);
			});
		} catch {
			return false;
		}
	}

	canWrite(path: string): boolean {
		try {
			const absolute = this.resolve(path);
			const real = canonicalPath(absolute);
			return (
				this.writableRoots.some((root) => within(real, root)) &&
				![absolute, real].some((p) => p.split(sep).some((part) => PROTECTED_NAMES.includes(part.toLowerCase()))) &&
				!this.writeDeny.some((deny) => within(real, deny) || within(absolute, deny))
			);
		} catch {
			return false;
		}
	}
}
