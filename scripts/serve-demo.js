#!/usr/bin/env node

/**
 * Simple HTTP server for the demo page
 * Serves static files from the project root
 */

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";

const PORT = 3000;
const ROOT = process.cwd();

const MIME_TYPES = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
	const url = req.url === "/" ? "/demo/index.html" : req.url;
	const filePath = join(ROOT, url || "");
	const ext = extname(filePath);

	try {
		const content = await readFile(filePath);
		const mimeType = MIME_TYPES[ext] || "application/octet-stream";
		res.writeHead(200, { "Content-Type": mimeType });
		res.end(content);
	} catch (_err) {
		res.writeHead(404);
		res.end("Not found");
	}
});

server.listen(PORT, () => {
	console.log(`\n🚀 Demo server running at http://localhost:${PORT}\n`);
	console.log(`   Open http://localhost:${PORT} in your browser\n`);
});
