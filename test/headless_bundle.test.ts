// @vitest-environment node
import { fileURLToPath } from "node:url";
import type { Rollup } from "vite";
import { build } from "vite";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HEADLESS_BUDGET_KB = 120;

interface Bundle {
	modules: string[];
	bytes: number;
}

async function bundle(entry: string): Promise<Bundle> {
	const result = await build({
		root: ROOT,
		configFile: false,
		logLevel: "silent",
		build: {
			write: false,
			minify: true,
			lib: { entry, formats: ["es"], fileName: "bundle" },
		},
	});
	const outputs = (
		Array.isArray(result) ? result : [result]
	) as Rollup.RollupOutput[];
	const chunks = outputs
		.flatMap((output) => output.output)
		.filter((item): item is Rollup.OutputChunk => item.type === "chunk");
	return {
		modules: chunks.flatMap((chunk) => Object.keys(chunk.modules)),
		bytes: chunks.reduce(
			(sum, chunk) => sum + Buffer.byteLength(chunk.code),
			0,
		),
	};
}

const isAce = (id: string): boolean =>
	id.includes("/ace-builds/") ||
	/\/renderer\/ace_(renderer|surface)\.ts$/.test(id);

describe("headless bundle", () => {
	it("pulls no Ace code and stays within budget", async () => {
		const { modules, bytes } = await bundle("src/headless.ts");
		expect(modules.filter(isAce)).toEqual([]);
		expect(modules.some((id) => id.endsWith("/src/parser/vt_parser.ts"))).toBe(
			true,
		);
		expect(bytes / 1024).toBeLessThan(HEADLESS_BUDGET_KB);
	}, 120_000);

	it("detects Ace in the main entry", async () => {
		const { modules } = await bundle("src/index.ts");
		expect(modules.some(isAce)).toBe(true);
	}, 120_000);
});
