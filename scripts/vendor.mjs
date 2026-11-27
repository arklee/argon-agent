#!/usr/bin/env node
/**
 * Vendored third-party code (decisions D18): only the files Argon uses, with small local changes, kept in
 * sync with upstream by a three-way merge. Each vendor lives in packages/backend/vendor/<name>/ with a
 * vendor.json:
 *
 *   {
 *     "source": "npm:@scope/pkg" | "github:owner/repo",
 *     "ref": "main",                 // github only: branch that `check` and `sync` follow
 *     "version": "1.2.3" | "<commit>",
 *     "license": "LICENSE",          // upstream path, copied to <vendor>/LICENSE
 *     "files": { "src/a.ts": "src/a.ts" },   // local path -> upstream path
 *     "notes": "what was dropped or changed, and why"
 *   }
 *
 * Upstream snapshots are not stored: npm versions and commits are immutable, so the old base is
 * downloaded again when needed. Files in the vendor folder that are not in `files` are Argon's own.
 *
 *   npm run vendor -- add <name> <source> <version|latest> <local=upstream | path>...   import files
 *   npm run vendor -- check [name]                                               list newer upstream versions
 *   npm run vendor -- diff <name>                                                local changes vs. the base
 *   npm run vendor -- sync <name> [version]                                      merge upstream changes
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = join(root, "packages", "backend", "vendor");
const cacheRoot = join(tmpdir(), "argon-vendor-cache");

function fail(message) {
	console.error(`vendor: ${message}`);
	process.exit(1);
}

function run(command, args, options = {}) {
	return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function parseSource(source) {
	const npm = /^npm:(.+)$/.exec(source);
	if (npm) return { kind: "npm", name: npm[1] };
	const github = /^github:([\w.-]+)\/([\w.-]+)$/.exec(source);
	if (github) return { kind: "github", owner: github[1], repo: github[2] };
	fail(`unsupported source "${source}" (use npm:<package> or github:<owner>/<repo>)`);
}

function readManifest(name) {
	const path = join(vendorRoot, name, "vendor.json");
	if (!existsSync(path)) fail(`no vendor named "${name}" (${relative(root, path)} is missing)`);
	return JSON.parse(readFileSync(path, "utf8"));
}

function writeManifest(name, manifest) {
	writeFileSync(join(vendorRoot, name, "vendor.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
}

function vendorNames() {
	if (!existsSync(vendorRoot)) return [];
	return readdirSync(vendorRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(vendorRoot, entry.name, "vendor.json")))
		.map((entry) => entry.name);
}

/** The newest upstream version: the npm `latest` tag, or the head commit of `ref`. */
function latestVersion(manifest) {
	const source = parseSource(manifest.source);
	if (source.kind === "npm") return run("npm", ["view", `${source.name}@latest`, "version"]);
	const ref = manifest.ref ?? "HEAD";
	const line = run("git", ["ls-remote", `https://github.com/${source.owner}/${source.repo}`, ref]).split("\n")[0];
	const commit = line?.split(/\s/)[0];
	if (!commit) fail(`could not resolve ${manifest.source} ${ref}`);
	return commit;
}

/** Fetch an upstream snapshot (cached); returns the folder holding the package or repository root. */
async function snapshot(manifest, version, paths) {
	const source = parseSource(manifest.source);
	const key = `${manifest.source}@${version}`.replace(/[^\w.@-]+/g, "_");
	const dir = join(cacheRoot, key);
	if (source.kind === "npm") {
		if (existsSync(join(dir, "package.json"))) return dir;
		mkdirSync(dir, { recursive: true });
		const work = mkdtempSync(join(tmpdir(), "argon-vendor-"));
		const file = run("npm", ["pack", `${source.name}@${version}`, "--silent", "--pack-destination", work]);
		run("tar", ["xzf", join(work, file.split("\n").at(-1)), "-C", dir, "--strip-components=1"]);
		return dir;
	}
	// GitHub: fetch only the files needed, not the whole repository.
	for (const path of paths) {
		const target = join(dir, path);
		if (existsSync(target)) continue;
		const url = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${version}/${path}`;
		const response = await fetch(url);
		if (response.status === 404) continue;
		if (!response.ok) fail(`${url}: HTTP ${response.status}`);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, Buffer.from(await response.arrayBuffer()));
	}
	return dir;
}

function upstreamPaths(manifest) {
	return [...Object.values(manifest.files ?? {}), ...(manifest.license ? [manifest.license] : [])];
}

function copy(from, to) {
	mkdirSync(dirname(to), { recursive: true });
	writeFileSync(to, readFileSync(from));
}

async function add(name, sourceArg, rest) {
	if (!name || !sourceArg || rest.length < 2)
		fail("usage: add <name> <source> <version|latest> <local=upstream | path>...");
	const dir = join(vendorRoot, name);
	if (existsSync(join(dir, "vendor.json"))) fail(`${name} already exists; use sync`);
	parseSource(sourceArg);
	const manifest = { source: sourceArg, version: "", license: undefined, files: {}, notes: "" };
	if (sourceArg.startsWith("github:")) manifest.ref = "HEAD";
	const version = rest.shift();
	manifest.version = version === "latest" ? latestVersion(manifest) : version;
	for (const spec of rest) {
		const [local, upstream] = spec.includes("=") ? spec.split("=") : [spec, spec];
		manifest.files[local] = upstream;
	}
	if (!Object.keys(manifest.files).length) fail("name at least one file");
	const candidates = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE"];
	const base = await snapshot(manifest, manifest.version, [...Object.values(manifest.files), ...candidates]);
	manifest.license = candidates.find((path) => existsSync(join(base, path)));
	if (!manifest.license) console.warn("vendor: no LICENSE found upstream; set `license` by hand");
	for (const [local, upstream] of Object.entries(manifest.files)) {
		if (!existsSync(join(base, upstream))) fail(`${upstream} does not exist in ${sourceArg}@${manifest.version}`);
		copy(join(base, upstream), join(dir, local));
	}
	if (manifest.license) copy(join(base, manifest.license), join(dir, "LICENSE"));
	writeManifest(name, manifest);
	console.log(
		`vendor: added ${name} from ${sourceArg}@${manifest.version} (${Object.keys(manifest.files).length} files)`,
	);
}

function check(names) {
	let outdated = 0;
	for (const name of names.length ? names : vendorNames()) {
		const manifest = readManifest(name);
		const latest = latestVersion(manifest);
		const current = latest === manifest.version;
		if (!current) outdated++;
		console.log(
			`${current ? "up to date" : "outdated  "}  ${name}  ${manifest.version}${current ? "" : ` -> ${latest}`}`,
		);
	}
	if (outdated) console.log(`\n${outdated} outdated; run: npm run vendor -- sync <name>`);
}

async function diff(name) {
	if (!name) fail("usage: diff <name>");
	const manifest = readManifest(name);
	const base = await snapshot(manifest, manifest.version, upstreamPaths(manifest));
	let changed = 0;
	for (const [local, upstream] of Object.entries(manifest.files)) {
		const result = spawnSync(
			"git",
			["diff", "--no-index", "--no-color", "--no-prefix", join(base, upstream), join(vendorRoot, name, local)],
			{ encoding: "utf8" },
		);
		if (result.status === 0) continue;
		changed++;
		process.stdout.write(result.stdout.replaceAll(base, `upstream@${manifest.version}`).replaceAll(root, "."));
	}
	console.error(`vendor: ${changed} of ${Object.keys(manifest.files).length} files differ from upstream`);
}

async function sync(name, target) {
	if (!name) fail("usage: sync <name> [version]");
	const manifest = readManifest(name);
	const version = target ?? latestVersion(manifest);
	if (version === manifest.version) {
		console.log(`vendor: ${name} is already at ${version}`);
		return;
	}
	const paths = upstreamPaths(manifest);
	const base = await snapshot(manifest, manifest.version, paths);
	const next = await snapshot(manifest, version, paths);
	const conflicts = [];
	const removed = [];
	for (const [local, upstream] of Object.entries(manifest.files)) {
		const ours = join(vendorRoot, name, local);
		const theirs = join(next, upstream);
		if (!existsSync(theirs)) {
			removed.push(upstream);
			continue;
		}
		if (!existsSync(join(base, upstream)) || !existsSync(ours)) {
			copy(theirs, ours);
			continue;
		}
		// Writes the merge into `ours`; the exit code is the number of conflicts (negative on error).
		const result = spawnSync(
			"git",
			[
				"merge-file",
				"-L",
				"argon",
				"-L",
				`upstream@${manifest.version}`,
				"-L",
				`upstream@${version}`,
				ours,
				join(base, upstream),
				theirs,
			],
			{ encoding: "utf8" },
		);
		if (result.status === null || result.status < 0 || result.status > 127)
			fail(`merge failed for ${local}: ${result.stderr}`);
		if (result.status > 0) conflicts.push(`${local} (${result.status})`);
	}
	if (manifest.license && existsSync(join(next, manifest.license)))
		copy(join(next, manifest.license), join(vendorRoot, name, "LICENSE"));
	manifest.version = version;
	writeManifest(name, manifest);
	console.log(`vendor: ${name} merged to ${version}`);
	if (removed.length) console.warn(`vendor: gone upstream (kept as is, check by hand): ${removed.join(", ")}`);
	if (conflicts.length) {
		console.warn(`vendor: conflicts to resolve: ${conflicts.join(", ")}`);
		process.exitCode = 1;
	}
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
	case "add":
		await add(args[0], args[1], args.slice(2));
		break;
	case "check":
		check(args);
		break;
	case "diff":
		await diff(args[0]);
		break;
	case "sync":
		await sync(args[0], args[1]);
		break;
	default:
		fail("usage: vendor add | check [name] | diff <name> | sync <name> [version]");
}
