import { expect, test } from "vitest";
import { VERSION } from "../src/index.js";

test("VERSION is defined", () => {
	expect(VERSION).toBe("0.0.0");
});
