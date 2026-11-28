// Generates every Argon icon from one parametric design: three shells of an argon atom
// (2 · 8 · 8 electrons), each electron drawn as one glowing segment of a neon ring.
//
//   npm run icons -w @argon/desktop
//
// Runs inside Electron so rasterising uses Chromium's SVG renderer (no extra dependencies).
// Outputs: build/Argon.icon (macOS 26+, light + dark), build/icon.{svg,icns,ico,png}, resources/tray*.png, web/public/{favicon.svg,apple-touch-icon.png}.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = resolve(desktop, "../web");

// Lavender argon glow. Dark is the primary look (and the fallback wherever the OS has no
// appearance-aware icons); light keeps the glow but tighter and more saturated so it reads
// as coloured light on paper rather than a grey smudge.
const themes = {
	dark: {
		bg: ["#26252b", "#18171c"],
		halo: "#8d78d8",
		glow: "#7a66c8",
		glowOpacity: 0.85,
		glowBlur: 0.022,
		core: "#fbfaff",
		shells: ["#efeaff", "#cbbcf2", "#a895e4"],
	},
	light: {
		bg: ["#ffffff", "#f6f6f8"],
		halo: "#d6c9fa",
		glow: "#8a66ff",
		glowOpacity: 0.55,
		glowBlur: 0.0134,
		core: "#4a37a3",
		shells: ["#5844b3", "#7360c8", "#8f7dda"],
	},
};

const f = (n) => Number(n.toFixed(2));

/** One shell: `n` electrons as arc segments, centred on `centerDeg` (−90 = 12 o'clock). */
function shell({ c, r, n, stroke, gap, centerDeg, color }) {
	const per = (2 * Math.PI * r) / n;
	const dash = per - gap - stroke; // round caps add stroke/2 at each end
	const start = centerDeg - ((dash / 2 / r) * 180) / Math.PI;
	return `<circle cx="${c}" cy="${c}" r="${f(r)}" fill="none" stroke="${color}" stroke-width="${f(stroke)}" stroke-linecap="round" stroke-dasharray="${f(dash)} ${f(per - dash)}" transform="rotate(${f(start)} ${c} ${c})"/>`;
}

/**
 * Inner markup (defs + shapes) of one icon, so several can share an <svg> (see favicon).
 * @param size        canvas size
 * @param inset       transparent margin around the tile (macOS grid uses ~10%)
 * @param detail      "full" = all three shells; "small" = outer octet only, for ≤ 32 px
 * @param theme       "dark" | "light" | "mono" (black glyph on transparent: macOS tray template)
 * @param background  false = glyph only (Icon Composer supplies the tile)
 * @param id          prefix for defs ids
 */
function artParts({ size = 1024, inset = 0, detail = "full", theme = "dark", background = true, id = theme }) {
	const B = size - inset * 2;
	const c = size / 2;
	const mono = theme === "mono";
	const t = themes[theme];
	const defs = [];
	const body = [];

	const shells =
		detail === "full"
			? [
					{ r: 0.1117 * B, n: 2, centerDeg: -90 },
					{ r: 0.2306 * B, n: 8, centerDeg: -90 },
					{ r: 0.352 * B, n: 8, centerDeg: -67.5 },
				]
			: [{ r: (mono ? 0.4 : 0.31) * B, n: 8, centerDeg: -67.5, idx: 1 }];
	shells.forEach((s, i) => {
		s.color = mono ? "#000" : t.shells[s.idx ?? i];
		delete s.idx;
	});
	const stroke = detail === "full" ? 0.0364 * B : (mono ? 0.13 : 0.1) * B;
	const gap = detail === "full" ? 0.0437 * B : (mono ? 0.1 : 0.075) * B;
	const coreR = detail === "full" ? 0.0534 * B : (mono ? 0.15 : 0.12) * B;

	if (!mono) {
		defs.push(
			`<radialGradient id="${id}-bg" cx="50%" cy="46%" r="70%"><stop offset="0" stop-color="${t.bg[0]}"/><stop offset="1" stop-color="${t.bg[1]}"/></radialGradient>`,
			`<radialGradient id="${id}-halo"><stop offset="0" stop-color="${t.halo}" stop-opacity="0.55"/><stop offset="0.45" stop-color="${t.halo}" stop-opacity="0.16"/><stop offset="1" stop-color="${t.halo}" stop-opacity="0"/></radialGradient>`,
			`<filter id="${id}-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${f(B * t.glowBlur)}"/></filter>`,
		);
		if (background) {
			body.push(
				`<rect x="${inset}" y="${inset}" width="${B}" height="${B}" rx="${f(B * 0.225)}" fill="url(#${id}-bg)"/>`,
			);
		}
		body.push(`<circle cx="${c}" cy="${c}" r="${f(B * 0.46)}" fill="url(#${id}-halo)"/>`);
		if (detail === "full") {
			// Neon bloom: a wider, blurred copy of every segment underneath the crisp one.
			body.push(
				`<g filter="url(#${id}-glow)" opacity="${t.glowOpacity}">${shells
					.map((s) => shell({ c, stroke: stroke * 2.2, gap: gap - stroke * 1.2, ...s, color: t.glow }))
					.join("")}<circle cx="${c}" cy="${c}" r="${f(coreR * 2.2)}" fill="${t.halo}"/></g>`,
			);
		}
	}
	for (const s of shells) body.push(shell({ c, stroke, gap, ...s }));
	body.push(`<circle cx="${c}" cy="${c}" r="${f(coreR)}" fill="${mono ? "#000" : t.core}"/>`);
	return { defs: defs.join(""), body: body.join("") };
}

const svg = (size, inner, style = "") =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><title>Argon</title>${style}${inner}</svg>\n`;

function art(opts) {
	const { defs, body } = artParts(opts);
	return svg(opts.size ?? 1024, `${defs ? `<defs>${defs}</defs>` : ""}${body}`);
}

/** Light by default, dark under `prefers-color-scheme: dark` (browsers honour this in SVG favicons). */
function adaptive(opts) {
	const light = artParts({ ...opts, theme: "light" });
	const dark = artParts({ ...opts, theme: "dark" });
	return svg(
		opts.size ?? 1024,
		`<defs>${light.defs}${dark.defs}</defs><g class="light">${light.body}</g><g class="dark">${dark.body}</g>`,
		"<style>.dark{display:none}@media (prefers-color-scheme:dark){.light{display:none}.dark{display:inline}}</style>",
	);
}

const variants = {
	mac: art({ inset: 100 }), // macOS: 824 tile on a 1024 canvas
	macLight: art({ inset: 100, theme: "light" }),
	full: art({}), // Windows / Linux / touch icons: tile fills the canvas
	small: art({ detail: "small" }), // ≤ 32 px
	tray: art({ detail: "small", theme: "mono" }),
};

/**
 * Icon Composer document (macOS 26+): the system draws the tile and switches between our
 * light and dark glyphs with the appearance (and derives tinted / clear from them).
 * Glass effects are off so the baked-in glow is shown as designed.
 */
function iconComposer() {
	const color = (hex) =>
		`srgb:${[1, 3, 5].map((i) => (Number.parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(",")},1.00000`;
	return `${JSON.stringify(
		{
			"fill-specializations": [
				{ value: { "linear-gradient": [color(themes.light.bg[0]), color(themes.light.bg[1])] } },
				{ appearance: "dark", value: { "linear-gradient": [color(themes.dark.bg[0]), color(themes.dark.bg[1])] } },
			],
			groups: [
				{
					layers: [
						{
							name: "atom",
							"image-name-specializations": [
								{ value: "atom-light.png" },
								{ appearance: "dark", value: "atom-dark.png" },
								// Tinted / clear derive from luminance: the dark glyph keeps the core brightest.
								{ appearance: "tinted", value: "atom-dark.png" },
							],
							glass: false,
						},
					],
					shadow: { kind: "none", opacity: 0 },
					specular: false,
					translucency: { enabled: false, value: 0 },
				},
			],
			"supported-platforms": { squares: ["macOS"] },
		},
		null,
		"\t",
	)}\n`;
}

async function render(win, svg, size) {
	const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
	const data = await win.webContents.executeJavaScript(`(async () => {
		const img = new Image(); img.src = ${JSON.stringify(url)}; await img.decode();
		const cv = document.createElement("canvas"); cv.width = cv.height = ${size};
		const cx = cv.getContext("2d"); cx.imageSmoothingQuality = "high";
		cx.drawImage(img, 0, 0, ${size}, ${size});
		return cv.toDataURL("image/png");
	})()`);
	return Buffer.from(data.split(",")[1], "base64");
}

/** ICO with PNG-compressed entries (Windows Vista+). */
function ico(entries) {
	const header = Buffer.alloc(6 + entries.length * 16);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(entries.length, 4);
	let offset = header.length;
	entries.forEach(({ size, png }, i) => {
		const e = 6 + i * 16;
		header.writeUInt8(size >= 256 ? 0 : size, e);
		header.writeUInt8(size >= 256 ? 0 : size, e + 1);
		header.writeUInt16LE(1, e + 4);
		header.writeUInt16LE(32, e + 6);
		header.writeUInt32LE(png.length, e + 8);
		header.writeUInt32LE(offset, e + 12);
		offset += png.length;
	});
	return Buffer.concat([header, ...entries.map((e) => e.png)]);
}

app.dock?.hide();
app
	.whenReady()
	.then(main)
	.catch((err) => {
		console.error(err);
		app.exit(1);
	});

async function main() {
	const win = new BrowserWindow({ show: false });
	await win.loadURL("about:blank");

	const build = join(desktop, "build");
	mkdirSync(build, { recursive: true });
	const write = (path, data) => {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, data);
		console.log("wrote", path.replace(`${resolve(desktop, "../..")}/`, ""));
	};

	// Sources, kept alongside the rasters so the design can be inspected or edited by hand.
	write(join(build, "icon.svg"), variants.mac);
	write(join(build, "icon-light.svg"), variants.macLight);
	write(join(build, "icon-full.svg"), variants.full);
	write(join(build, "icon-small.svg"), variants.small);

	// macOS 26+ appearance-aware icon.
	const doc = join(build, "Argon.icon");
	rmSync(doc, { recursive: true, force: true });
	write(join(doc, "icon.json"), iconComposer());
	for (const theme of ["light", "dark"]) {
		write(
			join(doc, "Assets", `atom-${theme}.png`),
			await render(win, art({ theme, inset: 100, background: false }), 1024),
		);
	}

	// macOS .icns (pre-26 fallback) — small sizes switch to the simplified glyph.
	const iconset = join(mkdtempSync(join(tmpdir(), "argon-icon-")), "icon.iconset");
	mkdirSync(iconset);
	for (const [base, scales] of [
		[16, [1, 2]],
		[32, [1, 2]],
		[128, [1, 2]],
		[256, [1, 2]],
		[512, [1, 2]],
	]) {
		for (const s of scales) {
			const px = base * s;
			const svg = px <= 32 ? art({ size: 1024, inset: 100, detail: "small" }) : variants.mac;
			writeFileSync(join(iconset, `icon_${base}x${base}${s === 2 ? "@2x" : ""}.png`), await render(win, svg, px));
		}
	}
	execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(build, "icon.icns")]);
	rmSync(dirname(iconset), { recursive: true, force: true });
	console.log("wrote packages/desktop/build/icon.icns");

	// Windows .ico and Linux .png.
	const icoEntries = [];
	for (const size of [16, 24, 32, 48, 64, 128, 256]) {
		icoEntries.push({ size, png: await render(win, size <= 32 ? variants.small : variants.full, size) });
	}
	write(join(build, "icon.ico"), ico(icoEntries));
	write(join(build, "icon.png"), await render(win, variants.mac, 1024));

	// Tray: macOS template (black + alpha) and a coloured one for Windows / Linux.
	const resources = join(desktop, "resources");
	write(join(resources, "trayTemplate.png"), await render(win, variants.tray, 16));
	write(join(resources, "trayTemplate@2x.png"), await render(win, variants.tray, 32));
	write(join(resources, "tray.png"), await render(win, variants.small, 16));
	write(join(resources, "tray@2x.png"), await render(win, variants.small, 32));

	// Web.
	write(join(web, "public/favicon.svg"), adaptive({ detail: "small" }));
	write(join(web, "public/apple-touch-icon.png"), await render(win, variants.full, 180));

	app.quit();
}
