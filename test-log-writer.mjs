import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const writerPath = join(repoRoot, "log-writer.mjs");
const root = await mkdtemp(join(tmpdir(), "pi-tmux-log-writer-"));

function writerPaths(name) {
	return {
		logPath: join(root, `${name}.log`),
		drainedPath: join(root, `${name}.drained`),
		truncatedPath: join(root, `${name}.truncated`),
	};
}

function writerArguments(paths, maxBytes) {
	return [
		writerPath,
		"--log",
		paths.logPath,
		"--drained",
		paths.drainedPath,
		"--truncated",
		paths.truncatedPath,
		"--max-bytes",
		String(maxBytes),
	];
}

async function waitForExactLog(logPath, expected) {
	const deadline = Date.now() + 3000;
	while (Date.now() < deadline) {
		try {
			if ((await readFile(logPath)).equals(expected)) return;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
	}
	assert.deepEqual(await readFile(logPath), expected);
}

function runWriter(name, maxBytes, input) {
	const paths = writerPaths(name);
	return new Promise((resolvePromise, reject) => {
		const child = spawn(process.execPath, writerArguments(paths, maxBytes));
		let stderr = "";
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", reject);
		child.on("close", (code) => resolvePromise({ code, stderr, ...paths }));
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

	const maxBytes = 128;
	const chunkedPaths = writerPaths("chunked");
	const child = spawn(process.execPath, writerArguments(chunkedPaths, maxBytes));
	let chunkedStderr = "";
	child.stderr.on("data", (chunk) => (chunkedStderr += chunk));
	const completion = new Promise((resolvePromise, reject) => {
		child.on("error", reject);
		child.on("close", (code) => resolvePromise(code));
	});
	const chunks = Array.from({ length: 10 }, (_, index) =>
		Buffer.from(`[chunk-${index}]${String(index).repeat(61)}\n`),
	);
	let completeInput = Buffer.alloc(0);
	for (const chunk of chunks) {
		await new Promise((resolvePromise, reject) => {
			child.stdin.write(chunk, (error) => (error ? reject(error) : resolvePromise()));
		});
		completeInput = Buffer.concat([completeInput, chunk]);
		await waitForExactLog(chunkedPaths.logPath, completeInput.subarray(-maxBytes));
	}
	child.stdin.end();
	assert.equal(await completion, 0, chunkedStderr);
	assert.deepEqual(await readFile(chunkedPaths.logPath), completeInput.subarray(-maxBytes));
	assert.equal((await stat(chunkedPaths.logPath)).size, maxBytes);
	assert.equal(await readFile(chunkedPaths.truncatedPath, "utf8"), "true\n");
	assert.equal(await readFile(chunkedPaths.drainedPath, "utf8"), "drained\n");
} finally {
	await rm(root, { recursive: true, force: true });
}

console.log("bounded, unlimited, and byte-exact chunked log-writer tests passed");
