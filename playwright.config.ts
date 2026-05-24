import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for sterk's visual-regression harness (D1).
 *
 * Single project: Pixel 7 mobile emulation in real Chromium. This locks
 * the baselines to the device shape mobux actually ships on. Tablet /
 * desktop projects can be added later under separate baseline trees.
 *
 * See `test/visual/harness/index.html` for the driven test surface and
 * issue https://github.com/kattebak/sterk/issues/21 for the DoD plan.
 */
export default defineConfig({
	testDir: "test/visual",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: 0,
	workers: 1,
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
	use: {
		baseURL: "http://127.0.0.1:4173",
		trace: "retain-on-failure",
	},
	expect: {
		toHaveScreenshot: {
			maxDiffPixelRatio: 0.02,
			animations: "disabled",
			caret: "hide",
		},
	},
	projects: [
		{
			name: "mobile",
			use: { ...devices["Pixel 7"] },
		},
	],
	webServer: {
		command: "npx vite --port 4173 --strictPort",
		url: "http://127.0.0.1:4173/test/visual/harness/index.html",
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
		stdout: "pipe",
		stderr: "pipe",
	},
});
