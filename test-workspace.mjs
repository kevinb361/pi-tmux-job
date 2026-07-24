import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	ManagedWorkspaceManager,
	WorkspaceAllocator,
	decideWorkspace,
	describeWorkspace,
	inspectWorkspace,
} from "./workspace-manager.ts";

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

async function git(cwd, ...args) {
	const result = await exec("git", ["-C", cwd, ...args]);
	assert.equal(result.code, 0, result.stderr);
	return result.stdout.trim();
}

const root = await mkdtemp(join(tmpdir(), "pi-tmux-workspace-"));
const repository = join(root, "repository");
const linked = join(root, "linked");
const nonGit = join(root, "plain");

try {
	await mkdir(repository);
	await mkdir(nonGit);
	await git(repository, "init", "-b", "main");
	await git(repository, "config", "user.name", "Workspace Test");
	await git(repository, "config", "user.email", "workspace@example.invalid");
	await writeFile(join(repository, "tracked.txt"), "base\n");
	await git(repository, "add", "tracked.txt");
	await git(repository, "commit", "-m", "test base");
	const revision = await git(repository, "rev-parse", "HEAD");
	const nested = join(repository, "nested");
	await mkdir(nested);

	const clean = await inspectWorkspace(exec, nested, "write");
	assert.deepEqual(clean, {
		intent: "write",
		mode: "auto",
		kind: "current",
		requestedCwd: resolve(nested),
		isGit: true,
		repositoryRoot: resolve(repository),
		worktreeRoot: resolve(repository),
		branch: "main",
		revision,
		detached: false,
		dirty: false,
	});
	assert.equal(describeWorkspace(clean), " workspace=current:write:main:clean");

	await writeFile(join(repository, "untracked.txt"), "dirty\n");
	const dirty = await inspectWorkspace(exec, repository, "read");
	assert.equal(dirty.intent, "read");
	assert.equal(dirty.dirty, true);
	assert.equal(describeWorkspace(dirty), " workspace=current:read:main:dirty");
	await rm(join(repository, "untracked.txt"));

	await git(repository, "worktree", "add", "-b", "workspace-test", linked, revision);
	const linkedContext = await inspectWorkspace(exec, linked, "write");
	assert.equal(linkedContext.repositoryRoot, resolve(repository));
	assert.equal(linkedContext.worktreeRoot, resolve(linked));
	assert.equal(linkedContext.branch, "workspace-test");
	assert.equal(linkedContext.detached, false);
	assert.equal(linkedContext.dirty, false);

	await git(linked, "checkout", "--detach", revision);
	const detached = await inspectWorkspace(exec, linked, "read");
	assert.equal(detached.repositoryRoot, resolve(repository));
	assert.equal(detached.worktreeRoot, resolve(linked));
	assert.equal(detached.branch, undefined);
	assert.equal(detached.detached, true);
	assert.equal(detached.revision, revision);
	assert.equal(describeWorkspace(detached), ` workspace=current:read:@${revision.slice(0, 12)}:clean`);

	const plain = await inspectWorkspace(exec, nonGit, "write");
	assert.deepEqual(plain, {
		intent: "write",
		mode: "auto",
		kind: "current",
		requestedCwd: resolve(nonGit),
		isGit: false,
	});
	assert.equal(describeWorkspace(plain), " workspace=non-git:write");

	assert.deepEqual(decideWorkspace(clean, []), {
		kind: "current",
		reason: "sole-writer",
		conflictingWriters: 0,
	});
	const activeWriter = { state: "running", workspace: clean };
	assert.deepEqual(decideWorkspace({ ...clean, intent: "read" }, [activeWriter]), {
		kind: "current",
		reason: "read-sharing",
		conflictingWriters: 1,
	});
	assert.deepEqual(decideWorkspace(clean, [activeWriter]), {
		kind: "managed",
		reason: "writer-conflict",
		conflictingWriters: 1,
	});
	assert.throws(() => decideWorkspace({ ...clean, dirty: true }, []), /dirty Git worktree/);
	assert.deepEqual(decideWorkspace({ ...clean, mode: "current", dirty: true }, [activeWriter]), {
		kind: "current",
		reason: "explicit-current",
		conflictingWriters: 1,
	});
	assert.deepEqual(decideWorkspace({ ...clean, mode: "worktree" }, []), {
		kind: "managed",
		reason: "explicit-worktree",
		conflictingWriters: 0,
	});
	assert.throws(
		() => decideWorkspace({ ...plain, mode: "worktree" }, []),
		/workspace=worktree requires cwd to be inside a Git worktree/,
	);
	assert.throws(
		() => decideWorkspace(plain, [{ state: "launching", workspace: plain }]),
		/concurrent writers in the same non-Git directory/,
	);
	assert.deepEqual(decideWorkspace({ ...clean, worktreeRoot: `${clean.worktreeRoot}-other` }, [activeWriter]), {
		kind: "current",
		reason: "sole-writer",
		conflictingWriters: 0,
	});

	const managedRoot = join(root, "managed-root");
	const managedWorkspaces = new ManagedWorkspaceManager(exec, { rootDirectory: managedRoot });
	await assert.rejects(
		managedWorkspaces.create({ ...clean, requestedCwd: resolve(nonGit) }, "escape"),
		/Requested cwd escapes/,
	);
	const sourceRoot = { ...clean, requestedCwd: resolve(repository) };
	const managedOne = await managedWorkspaces.create(sourceRoot, "writer:one");
	const managedTwo = await managedWorkspaces.create(sourceRoot, "writer:one");
	assert.notEqual(managedOne.owner.id, managedTwo.owner.id);
	assert.notEqual(managedOne.owner.branch, managedTwo.owner.branch);
	assert.notEqual(managedOne.owner.worktreePath, managedTwo.owner.worktreePath);
	for (const managed of [managedOne, managedTwo]) {
		assert.equal(managed.workspace.kind, "managed");
		assert.equal(managed.workspace.baseRevision, revision);
		assert.equal(managed.workspace.worktreeRoot, managed.owner.worktreePath);
		assert.equal(managed.cwd, managed.owner.worktreePath);
		assert.equal(await readFile(join(managed.cwd, "tracked.txt"), "utf8"), "base\n");
		assert.equal((await stat(managed.workspace.ownerRecordPath)).mode & 0o777, 0o600);
		assert.equal((await stat(managedRoot)).mode & 0o777, 0o700);
		const owner = JSON.parse(await readFile(managed.workspace.ownerRecordPath, "utf8"));
		assert.equal(owner.managedBy, "pi-tmux-job");
		assert.equal(owner.repositoryRoot, resolve(repository));
		assert.equal(owner.baseRevision, revision);
		assert.equal(await git(repository, "rev-parse", `refs/heads/${managed.owner.branch}`), revision);
	}
	await assert.rejects(managedWorkspaces.cleanup(clean), /requires a managed tmux_agent workspace/);
	await assert.rejects(
		managedWorkspaces.cleanup({ ...managedOne.workspace, ownerRecordPath: join(root, "outside.json") }),
		/outside the operator-managed worktree root/,
	);
	const cleanCleanup = await managedWorkspaces.cleanup(managedOne.workspace);
	assert.deepEqual(cleanCleanup, {
		removed: true,
		worktreePath: managedOne.owner.worktreePath,
		branch: managedOne.owner.branch,
		branchDeleted: true,
	});
	assert.deepEqual(await managedWorkspaces.cleanup(managedOne.workspace), {
		...cleanCleanup,
		alreadyRemoved: true,
	});

	const ownerTwoRaw = await readFile(managedTwo.workspace.ownerRecordPath, "utf8");
	const ownerTwoMismatch = JSON.parse(ownerTwoRaw);
	ownerTwoMismatch.id = "not-the-owned-id";
	await writeFile(managedTwo.workspace.ownerRecordPath, `${JSON.stringify(ownerTwoMismatch)}\n`);
	await assert.rejects(managedWorkspaces.cleanup(managedTwo.workspace), /ownership record does not match/);
	await rm(managedTwo.workspace.ownerRecordPath);
	await assert.rejects(managedWorkspaces.cleanup(managedTwo.workspace), /Unable to read managed workspace ownership record/);
	await writeFile(managedTwo.workspace.ownerRecordPath, ownerTwoRaw, { mode: 0o600 });
	await writeFile(join(managedTwo.cwd, "untracked.txt"), "preserve me\n");
	const dirtyCleanup = await managedWorkspaces.cleanup(managedTwo.workspace);
	assert.deepEqual(dirtyCleanup, {
		removed: false,
		preservedReason: "dirty",
		worktreePath: managedTwo.owner.worktreePath,
		branch: managedTwo.owner.branch,
		branchDeleted: false,
	});
	assert.equal(await readFile(join(managedTwo.cwd, "untracked.txt"), "utf8"), "preserve me\n");
	await rm(join(managedTwo.cwd, "untracked.txt"));
	assert.equal((await managedWorkspaces.cleanup(managedTwo.workspace)).branchDeleted, true);

	const committed = await managedWorkspaces.create(sourceRoot, "writer-committed");
	await writeFile(join(committed.cwd, "tracked.txt"), "committed result\n");
	await git(committed.cwd, "add", "tracked.txt");
	await git(committed.cwd, "commit", "-m", "managed result");
	const committedTip = await git(committed.cwd, "rev-parse", "HEAD");
	const committedCleanup = await managedWorkspaces.cleanup(committed.workspace);
	assert.equal(committedCleanup.removed, true);
	assert.equal(committedCleanup.branchDeleted, false);
	assert.equal(await git(repository, "rev-parse", `refs/heads/${committed.owner.branch}`), committedTip);
	await assert.rejects(stat(committed.owner.worktreePath), /ENOENT/);
	await git(repository, "branch", "-D", committed.owner.branch);

	for (const managed of [managedOne, managedTwo, committed]) {
		await assert.rejects(stat(managed.owner.worktreePath), /ENOENT/);
		const tombstone = JSON.parse(await readFile(managed.workspace.ownerRecordPath, "utf8"));
		assert.equal(tombstone.state, "removed");
		assert.equal(typeof tombstone.removedAt, "string");
	}
	for (const managed of [managedOne, managedTwo]) {
		const branch = await exec("git", ["-C", repository, "show-ref", "--verify", `refs/heads/${managed.owner.branch}`]);
		assert.notEqual(branch.code, 0);
	}

	const allocator = new WorkspaceAllocator();
	const order = [];
	let releaseFirst;
	const first = allocator.run(async () => {
		order.push("first-start");
		await new Promise((resolvePromise) => {
			releaseFirst = resolvePromise;
		});
		order.push("first-end");
	});
	const second = allocator.run(async () => {
		order.push("second");
	});
	await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
	assert.deepEqual(order, ["first-start"]);
	releaseFirst();
	await Promise.all([first, second]);
	assert.deepEqual(order, ["first-start", "first-end", "second"]);
} finally {
	await rm(root, { recursive: true, force: true });
}

console.log("workspace identity inspection tests passed");
