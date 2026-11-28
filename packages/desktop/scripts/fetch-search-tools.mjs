import { chmod, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

const { downloadTool, extractTool, fileHash, mirrorUrl, toolsMirror } = await tsImport(
	"../../backend/src/search-tools-transfer.ts",
	import.meta.url,
);
const args = process.argv.slice(2);
let platform = process.platform;
let arch = process.arch;
while (args.length) {
	const flag = args.shift();
	const value = args.shift();
	if (!value || !["--platform", "--arch"].includes(flag))
		throw new Error("Usage: fetch-search-tools.mjs [--platform platform] [--arch arch]");
	if (flag === "--platform") platform = value;
	else arch = value;
}
const manifest = JSON.parse(
	await readFile(new URL("../../backend/src/search-tools-manifest.json", import.meta.url), "utf8"),
);
const directory = fileURLToPath(new URL("../.search-tools/", import.meta.url));
const mirror = toolsMirror(process.env.ARGON_TOOLS_MIRROR || "github");
await mkdir(directory, { recursive: true });
for (const tool of ["rg", "fd"]) {
	const entry = manifest[tool][`${platform}-${arch}`];
	const source = mirror === "npmmirror" ? "npmmirror" : "github";
	const asset = entry?.sources[source];
	if (!asset || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? ""))
		throw new Error(
			`No verified ${source} binary for ${tool} ${platform}-${arch}; run scripts/search-tools-manifest.mjs`,
		);
	const name = tool + (platform === "win32" ? ".exe" : "");
	const destination = join(directory, name);
	try {
		if ((await fileHash(destination)) === asset.sha256) {
			await chmod(destination, 0o755);
			console.error(`${name}: verified existing binary`);
			continue;
		}
	} catch {
		/* Fetch missing binary. */
	}
	const temp = await mkdtemp(join(directory, ".fetch-"));
	try {
		const archive = join(temp, "archive");
		const binary = join(temp, "binary");
		await downloadTool(source === "github" ? mirrorUrl(asset.url, mirror) : asset.url, archive);
		await extractTool(archive, new URL(asset.url).pathname, name, binary);
		if ((await fileHash(binary)) !== asset.sha256) throw new Error(`${asset.url}: SHA-256 mismatch`);
		await chmod(binary, 0o755);
		await rename(binary, destination);
		console.error(`${name}: installed and verified ${asset.sha256}`);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
}
