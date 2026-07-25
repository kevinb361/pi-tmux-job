import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
	DefaultResourceLoader,
	InteractiveMode,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	createAgentSession,
} from "@earendil-works/pi-coding-agent";
import { fauxProvider } from "@earendil-works/pi-ai";
import { TmuxJobManager } from "./job-manager.ts";
import { projectJobStatus } from "./job-status.ts";
import { startJobStatusSession } from "./job-status-ui.ts";
import { STATUS_UI_KEY, STATUS_WIDGET_KEY } from "./job-status-ui.ts";

function exec(command, args, options = {}) {
	return new Promise((resolvePromise) => {
		const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let killed = false;
		const kill = () => {
			killed = true;
			child.kill("SIGTERM");
		};
		if (options.signal) {
			if (options.signal.aborted) kill();
			else options.signal.addEventListener("abort", kill, { once: true });
		}
		const timer = options.timeout ? setTimeout(kill, options.timeout) : undefined;
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("close", (code) => {
			if (timer) clearTimeout(timer);
			resolvePromise({ stdout, stderr, code: code ?? 1, killed });
		});
	});
}

async function waitUntil(predicate, message, timeoutMs = 6000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
	}
	throw new Error(message);
}

function rendered(component, width = 160) {
	return component.render(width).map((line) => stripVTControlCharacters(line)).join("\n");
}

function statusText(mode) {
	return stripVTControlCharacters(
		mode.footerDataProvider.getExtensionStatuses().get(STATUS_UI_KEY) ?? "",
	);
}

function widgetText(mode) {
	const widget = mode.extensionWidgetsBelow.get(STATUS_WIDGET_KEY);
	return widget ? rendered(widget) : "";
}

function jobLine(mode, name) {
	return widgetText(mode)
		.split("\n")
		.find((line) => line.includes(name));
}

function footerRendersPublishedStatus(mode) {
	const status = statusText(mode);
	return status.length > 0 && rendered(mode.footer).includes(status);
}

const root = await mkdtemp(join(tmpdir(), "pi-tmux-real-tui-"));
const agentDirectory = join(root, "agent");
const jobDirectory = join(root, "jobs");
await mkdir(agentDirectory);
const windowName = `pi-real-tui-${process.pid}`;
const manager = new TmuxJobManager(exec, { rootDirectory: jobDirectory });
const openTargets = new Set();
let monitor;
let mode;
let session;
let modelRuntime;
let modelProvider;
let modelProviderId;

try {
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: false },
		quietStartup: true,
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: root,
		agentDir: agentDirectory,
		settingsManager,
	});
	await resourceLoader.reload();
	modelProvider = fauxProvider({ provider: `faux-real-tui-${process.pid}` });
	const model = modelProvider.getModel();
	modelProviderId = model.provider;
	modelRuntime = await ModelRuntime.create({
		authPath: join(agentDirectory, "auth.json"),
		modelsPath: join(agentDirectory, "models.json"),
	});
	modelRuntime.registerNativeProvider(modelProvider.provider);
	const created = await createAgentSession({
		cwd: root,
		agentDir: agentDirectory,
		model,
		modelRuntime,
		thinkingLevel: "off",
		tools: [],
		resourceLoader,
		sessionManager: SessionManager.inMemory(root),
		settingsManager,
	});
	session = created.session;
	const runtimeHost = {
		session,
		setBeforeSessionInvalidate() {},
		setRebindSession() {},
	};
	mode = new InteractiveMode(runtimeHost, { verbose: false });
	// Keep the real InteractiveMode UI storage/components while suppressing terminal repaint bytes.
	mode.ui.requestRender = () => {};
	const ui = mode.createExtensionUIContext();

	const lifecycleName = `real-tui-lifecycle-${process.pid}`;
	await manager.start({
		name: lifecycleName,
		command: "sleep 1.2",
		cwd: root,
		windowName,
	});
	openTargets.add(lifecycleName);
	monitor = startJobStatusSession(
		{ mode: "tui", ui },
		() => manager.list(),
		{ intervalMs: 100, originPane: manager.originPane, successVisibilityMs: 3_000 },
	);
	assert.ok(monitor);

	await waitUntil(
		() => jobLine(mode, lifecycleName)?.includes("cmd · running") && footerRendersPublishedStatus(mode),
		"real InteractiveMode did not render the owned running job in its footer/widget surfaces",
	);
	assert.match(jobLine(mode, lifecycleName), /cmd · running · workspace=-/);

	const waited = await manager.wait(lifecycleName, 5);
	assert.equal(waited.timedOut, false);
	assert.equal(waited.job.exitCode, 0);
	await waitUntil(
		() => jobLine(mode, lifecycleName)?.includes("cmd · exit=0") && footerRendersPublishedStatus(mode),
		"real InteractiveMode did not render the owned exited job in its footer/widget surfaces",
	);
	await waitUntil(
		() => !jobLine(mode, lifecycleName),
		"real InteractiveMode did not quietly expire the successful job from passive status",
	);
	assert.equal((await manager.resolve(lifecycleName))?.paneId, waited.job.paneId, "status expiry closed the pane");

	await manager.close(lifecycleName, false);
	openTargets.delete(lifecycleName);
	const remainingView = projectJobStatus(await manager.list(), undefined, {
		originPane: manager.originPane,
		successVisibilityMs: 3_000,
	});
	if (remainingView.statusText === undefined) {
		assert.equal(mode.footerDataProvider.getExtensionStatuses().has(STATUS_UI_KEY), false);
		assert.equal(mode.extensionWidgetsBelow.has(STATUS_WIDGET_KEY), false);
	} else {
		assert.equal(statusText(mode), remainingView.statusText);
		assert.equal(footerRendersPublishedStatus(mode), true);
	}

	const stopName = `real-tui-stop-${process.pid}`;
	await manager.start({ name: stopName, command: "sleep 30", cwd: root, windowName });
	openTargets.add(stopName);
	await waitUntil(
		() => jobLine(mode, stopName)?.includes("cmd · running") && footerRendersPublishedStatus(mode),
		"second running job was not rendered before monitor stop",
	);
	monitor.stop();
	monitor = undefined;
	assert.equal(mode.footerDataProvider.getExtensionStatuses().has(STATUS_UI_KEY), false);
	assert.equal(mode.extensionWidgetsBelow.has(STATUS_WIDGET_KEY), false);
	await manager.close(stopName, true);
	openTargets.delete(stopName);
} finally {
	monitor?.stop();
	for (const target of openTargets) {
		try {
			await manager.close(target, true);
		} catch {
			// Best-effort cleanup after an assertion failure.
		}
	}
	mode?.stop();
	session?.dispose();
	if (modelRuntime && modelProviderId) modelRuntime.unregisterProvider(modelProviderId);
	await exec("tmux", ["kill-window", "-t", windowName]);
	await rm(root, { recursive: true, force: true });
}

console.log("real Pi InteractiveMode running, exited, closed, and stop status proof passed");
