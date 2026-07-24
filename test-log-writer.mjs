import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const writerPath = join(repoRoot, "log-writer.mjs");
const root = await mkdtemp(join(tmpdir(), "pi-tmux-log-writer-"));

function runWriter(name, maxBytes, input) {
	const logPath = join(root, `${name}.log`);
	const drainedPath = join(root, `${name}.drained`);
	const truncatedPath = join(root, `${name}.truncated`);
	return new Promise((resolvePromise, reject) => {
		const child = spawn(process.execPath, [
			writerPath,
			"--log",
			logPath,
			"--drained",
			drainedPath,
			"--truncated",
			truncatedPath,
			"--max-bytes",
			String(maxBytes),
		]);
		let stderr = "";
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", reject);
		child.on("close", (code) => resolvePromise({ code, stderr, logPath, drainedPath, truncatedPath }));
		child.stdin.end(input);
	});
}

try {
	const oversized = Buffer.from(Array.from({ length: 100_000 }, (_, index) => String(index % 10)).join(""));
	const capped = await runWriter("capped", 4096, oversized);
	assert.equal(capped.code, 0, capped.stderr);
	assert.equal((await stat(capped.logPath)).size, 4096);
	assert.deepEqual(await readFile(capped.logPath), oversized.subarray(oversized.length - 4096));
	assert.equal(await readFile(capped.drainedPath, "utf8"), "drained\n");
	assert.equal(await readFile(capped.truncatedPath, "utf8"), "true\n");

	const unlimited = await runWriter("unlimited", 0, oversized);
	assert.equal(unlimited.code, 0, unlimited.stderr);
	assert.deepEqual(await readFile(unlimited.logPath), oversized);
	assert.equal((await stat(unlimited.logPath)).size, oversized.length);
} finally {
	await rm(root, { recursive: true, force: true });
}

console.log("bounded and unlimited log-writer tests passed");
