import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = await mkdtemp(join(tmpdir(), "pi-tmux-package-"));
const installRoot = join(root, "install");
const agentDirectory = join(root, "agent");

try {
	const { stdout: packOutput } = await execFileAsync(
		"npm",
		["pack", "--json", "--pack-destination", root],
		{ cwd: repoRoot, maxBuffer: 1024 * 1024 },
	);
	const packed = JSON.parse(packOutput)[0];
	const tarball = join(root, packed.filename);
	const packedPaths = new Set(packed.files.map((file) => file.path));
	for (const required of [
		"index.ts",
		"agent-adapters.ts",
		"completion-notifier.ts",
		"job-manager.ts",
		"model-registry.ts",
		"extension-manifest.json",
		"README.md",
	]) {
		assert.ok(packedPaths.has(required), `packed package is missing ${required}`);
	}

	await mkdir(installRoot, { recursive: true });
	await execFileAsync(
		"npm",
		[
			"install",
			"--offline",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"--no-package-lock",
			"--legacy-peer-deps",
			tarball,
		],
		{ cwd: installRoot, maxBuffer: 1024 * 1024 },
	);

	for (const dependency of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "typebox"]) {
		const source = join(repoRoot, "node_modules", dependency);
		const target = join(installRoot, "node_modules", dependency);
		await mkdir(dirname(target), { recursive: true });
		await symlink(source, target, "dir");
	}

	const packageRoot = join(installRoot, "node_modules", "pi-tmux-job");
	const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
	const manifest = JSON.parse(await readFile(join(packageRoot, "extension-manifest.json"), "utf8"));
	const readme = await readFile(join(packageRoot, "README.md"), "utf8");
	assert.equal(packageJson.version, "1.1.0");
	assert.deepEqual(packageJson.pi.extensions, ["./index.ts"]);
	assert.equal(manifest.version, packageJson.version);
	assert.deepEqual(manifest.provides.tools, ["tmux_job", "tmux_agent"]);
	for (const documented of [
		/`pi`, `claude`, or `hermes`/,
		/litellm\/deep/,
		/normal configuration, rules, memory, skills, and plugins/,
		/Hermes exception/,
		/old session's watcher is cancelled/,
		/## Non-goals/,
	]) {
		assert.match(readme, documented);
	}

	await mkdir(agentDirectory, { recursive: true });
	const loaded = await discoverAndLoadExtensions([join(packageRoot, "index.ts")], repoRoot, agentDirectory);
	assert.deepEqual(loaded.errors, []);
	const extension = loaded.extensions.find((item) => item.path === join(packageRoot, "index.ts"));
	assert.ok(extension, "installed extension was not discovered");
	assert.ok(extension.tools.has("tmux_job"));
	assert.ok(extension.tools.has("tmux_agent"));
} finally {
	await rm(root, { recursive: true, force: true });
}

console.log("packed-package install and tool discovery passed");
