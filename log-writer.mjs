import { open, writeFile } from "node:fs/promises";

function argument(name) {
	const index = process.argv.indexOf(name);
	if (index === -1 || index === process.argv.length - 1) throw new Error(`Missing ${name}`);
	return process.argv[index + 1];
}

async function writeAll(handle, buffer, position) {
	let offset = 0;
	while (offset < buffer.length) {
		const result = await handle.write(buffer, offset, buffer.length - offset, position + offset);
		if (result.bytesWritten === 0) throw new Error("Unable to make progress writing terminal log");
		offset += result.bytesWritten;
	}
}

async function writeUnlimited(logPath) {
	const handle = await open(logPath, "a", 0o600);
	try {
		for await (const value of process.stdin) {
			const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
			await writeAll(handle, chunk, 0);
		}
	} finally {
		await handle.close();
	}
}

async function writeBounded(logPath, truncatedPath, maxBytes) {
	await writeFile(logPath, "", { flag: "a", mode: 0o600 });
	const handle = await open(logPath, "r+");
	let size = (await handle.stat()).size;
	let markedTruncated = false;

	async function markTruncated() {
		if (markedTruncated) return;
		markedTruncated = true;
		await writeFile(truncatedPath, "true\n", { mode: 0o600 });
	}

	try {
		for await (const value of process.stdin) {
			const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
			if (chunk.length >= maxBytes) {
				if (size > 0 || chunk.length > maxBytes) await markTruncated();
				const tail = chunk.subarray(chunk.length - maxBytes);
				await handle.truncate(0);
				await writeAll(handle, tail, 0);
				size = tail.length;
				continue;
			}

			if (size + chunk.length <= maxBytes) {
				await writeAll(handle, chunk, size);
				size += chunk.length;
				continue;
			}

			await markTruncated();
			const retainedBytes = maxBytes - chunk.length;
			const retained = Buffer.allocUnsafe(retainedBytes);
			if (retainedBytes > 0) {
				const result = await handle.read(retained, 0, retainedBytes, size - retainedBytes);
				if (result.bytesRead !== retainedBytes) throw new Error("Unable to read retained terminal-log tail");
			}
			await handle.truncate(0);
			if (retainedBytes > 0) await writeAll(handle, retained, 0);
			await writeAll(handle, chunk, retainedBytes);
			size = maxBytes;
		}
	} finally {
		await handle.close();
	}
}

const logPath = argument("--log");
const drainedPath = argument("--drained");
const truncatedPath = argument("--truncated");
const maxBytes = Number.parseInt(argument("--max-bytes"), 10);

try {
	if (maxBytes === 0) await writeUnlimited(logPath);
	else await writeBounded(logPath, truncatedPath, maxBytes);
	await writeFile(drainedPath, "drained\n", { mode: 0o600 });
} catch (error) {
	console.error(`[tmux-job logger] ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
