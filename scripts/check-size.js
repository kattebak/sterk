#!/usr/bin/env node
/**
 * Bundle size check script
 * Verifies that the packed dist size stays within budget
 */

import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Soft budget: < 355kB packed. The single biggest line item is the
// vendored fonts under assets/fonts/ (~200 kB total: 5 primary TUI-
// coverage subsets at 25–55 kB each + the shared `SterkTUISymbols`
// fallback at ~25 kB). The JS/dts payload is ~105 kB packed. We hold
// this as the line in the sand — anything above suggests an
// accidentally re-introduced unsubsetted font, a duplicated source
// map, or a dependency creep regression that should be investigated
// before publish.
//
// History: raised 350 → 355 kB (kattebak/sterk#36) for the xterm
// element/textarea/modes/unicode accessors + lineHeight/letterSpacing/
// tabStopWidth/wordSeparator options — pure public-API `.d.ts` growth,
// not a font/sourcemap/dependency regression.
const BUDGET_KB = 355;

/**
 * Get total size of dist/ directory
 */
function getDistSize() {
	const distPath = join(process.cwd(), "dist");
	let totalSize = 0;

	function walk(dir) {
		const files = readdirSync(dir);
		for (const file of files) {
			const filePath = join(dir, file);
			const stat = statSync(filePath);
			if (stat.isDirectory()) {
				walk(filePath);
			} else {
				totalSize += stat.size;
			}
		}
	}

	try {
		walk(distPath);
	} catch (_err) {
		console.error("Error: dist/ directory not found. Run npm run build first.");
		process.exit(1);
	}

	return totalSize;
}

/**
 * Get packed size using npm pack --dry-run
 */
function getPackedSize() {
	try {
		const output = execSync("npm pack --dry-run --json", {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		});

		const data = JSON.parse(output);
		if (Array.isArray(data) && data[0]?.size) {
			return data[0].size;
		}

		// Fallback: parse from text output
		const match = output.match(/(\d+)\s+bytes/i);
		if (match?.[1]) {
			return Number.parseInt(match[1], 10);
		}

		throw new Error("Could not parse packed size from npm pack output");
	} catch (err) {
		console.error(
			"Error running npm pack:",
			err instanceof Error ? err.message : String(err),
		);
		return getDistSize(); // Fallback to dist size
	}
}

/**
 * Format bytes as human-readable
 */
function formatSize(bytes) {
	const kb = bytes / 1024;
	return kb < 1 ? `${bytes} B` : `${kb.toFixed(2)} kB`;
}

/**
 * Main
 */
function main() {
	console.log("📦 Bundle Size Check\n");

	const distSize = getDistSize();
	console.log(`dist/ size: ${formatSize(distSize)}`);

	const packedSize = getPackedSize();
	const packedKB = packedSize / 1024;
	console.log(`Packed size: ${formatSize(packedSize)}`);

	console.log(`Budget: < ${BUDGET_KB} kB\n`);

	if (packedKB > BUDGET_KB) {
		console.error(
			`❌ FAILED: Packed size (${formatSize(packedSize)}) exceeds budget (${BUDGET_KB} kB)`,
		);
		process.exit(1);
	}

	const headroom = BUDGET_KB - packedKB;
	const headroomPercent = (headroom / BUDGET_KB) * 100;
	console.log(
		`✅ PASSED: ${formatSize(packedSize)} is within budget (${headroom.toFixed(2)} kB / ${headroomPercent.toFixed(1)}% headroom)`,
	);
}

main();
