import { defineConfig } from "vite";

/**
 * Vite config used by the visual-regression harness (test/visual/).
 *
 * Vite is *only* used to serve the harness page during Playwright runs —
 * sterk's own build is still `tsc -p tsconfig.build.json`. We rely on Vite
 * to resolve the `ace-builds` bare specifier (imported transitively by
 * sterk's `dist/`) for the browser without needing to vendor it manually.
 *
 * The harness page at `test/visual/harness/index.html` imports sterk via
 * `../../../dist/index.js` — i.e. the actual shipped artifact — so visual
 * tests catch regressions in what consumers will install, not just src.
 */
export default defineConfig({
	server: {
		host: "127.0.0.1",
		port: 4173,
		strictPort: true,
	},
	preview: {
		host: "127.0.0.1",
		port: 4173,
		strictPort: true,
	},
	optimizeDeps: {
		include: ["ace-builds"],
	},
});
