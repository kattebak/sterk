import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "happy-dom",
		// The Playwright visual harness lives under test/visual/ and is run by
		// `npm run test:visual` against real Chromium — keep vitest out of it.
		exclude: ["**/node_modules/**", "**/dist/**", "test/visual/**"],
	},
});
