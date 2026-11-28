/** Regenerate pinned binary hashes. Only HTTP 404 omits a candidate; other errors abort without writing. */
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

const { downloadTool, extractTool, fileHash } = await tsImport(
	"../packages/backend/src/search-tools-transfer.ts",
	import.meta.url,
);
const destination = fileURLToPath(new URL("../packages/backend/src/search-tools-manifest.json", import.meta.url));
const manifest = JSON.parse(await readFile(destination, "utf8"));
const dir = await mkdtemp(join(tmpdir(), "argon-manifest-"));
try {
	for (const [tool, platforms] of Object.entries(manifest)) {
		for (const [platform, entry] of Object.entries(platforms)) {
			for (const [source, asset] of Object.entries(entry.sources)) {
				const archive = join(dir, "archive");
				const binary = join(dir, "binary");
				try {
					await downloadTool(asset.url, archive);
					await extractTool(
						archive,
						new URL(asset.url).pathname,
						tool + (platform.startsWith("win32-") ? ".exe" : ""),
						binary,
					);
					asset.sha256 = await fileHash(binary);
					console.error(`${tool} ${platform} ${source} ${asset.sha256}`);
				} catch (error) {
					if (!String(error).endsWith("HTTP 404")) throw error;
					console.error(`Absent: ${asset.url}`);
					delete entry.sources[source];
				} finally {
					await rm(archive, { force: true });
					await rm(binary, { force: true });
				}
			}
			if (!Object.keys(entry.sources).length) delete platforms[platform];
		}
	}
	await writeFile(`${destination}.tmp`, `${JSON.stringify(manifest, null, "\t")}\n`);
	await rename(`${destination}.tmp`, destination);
	for (const [platform, entry] of Object.entries(manifest.fd)) {
		console.error(
			`fd ${platform}: ${entry.sources.github && entry.sources.npmmirror ? (entry.sources.github.sha256 === entry.sources.npmmirror.sha256 ? "match" : "DIFFERENT") : "one source only"}`,
		);
	}
} finally {
	await rm(dir, { recursive: true, force: true });
}
