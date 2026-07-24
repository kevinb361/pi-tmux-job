import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve } from "node:path";

export const WORKSPACE_INTENTS = ["read", "write"] as const;
export type WorkspaceIntent = (typeof WORKSPACE_INTENTS)[number];
export const WORKSPACE_MODES = ["auto", "current", "worktree"] as const;
export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];

export interface JobWorkspaceMetadata {
	intent: WorkspaceIntent;
	mode: WorkspaceMode;
	kind: "current" | "managed";
	requestedCwd: string;
	managedId?: string;
	ownerRecordPath?: string;
	createdBranch?: string;
	baseRevision?: string;
	isGit: boolean;
	repositoryRoot?: string;
	worktreeRoot?: string;
	branch?: string;
	revision?: string;
	detached?: boolean;
	dirty?: boolean;
}

interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
	killed: boolean;
}

type ExecFunction = (
	command: string,
	args: string[],
	options?: { signal?: AbortSignal; timeout?: number; cwd?: string },
) => Promise<ExecResult>;

async function git(
	exec: ExecFunction,
	cwd: string,
	args: string[],
	signal?: AbortSignal,
): Promise<ExecResult> {
	return exec("git", ["-C", cwd, ...args], { signal, timeout: 5000 });
}

function requireGitResult(result: ExecResult, operation: string): string {
	if (result.code !== 0) {
		throw new Error(`Unable to inspect Git ${operation}: ${result.stderr.trim() || result.stdout.trim()}`);
	}
	return result.stdout.trim();
}

function mainWorktreeRoot(porcelain: string): string | undefined {
	const first = porcelain.split("\n").find((line) => line.startsWith("worktree "));
	return first?.slice("worktree ".length).trim();
}

export async function inspectWorkspace(
	exec: ExecFunction,
	cwd: string,
	intent: WorkspaceIntent,
	mode: WorkspaceMode = "auto",
	signal?: AbortSignal,
): Promise<JobWorkspaceMetadata> {
	const requestedCwd = resolve(cwd);
	const topLevel = await git(exec, requestedCwd, ["rev-parse", "--show-toplevel"], signal);
	if (topLevel.code !== 0) {
		return { intent, mode, kind: "current", requestedCwd, isGit: false };
	}

	const worktreeRoot = resolve(requireGitResult(topLevel, "worktree root"));
	const worktrees = await git(exec, requestedCwd, ["worktree", "list", "--porcelain"], signal);
	const repositoryRoot = mainWorktreeRoot(requireGitResult(worktrees, "worktree list"));
	if (!repositoryRoot) throw new Error("Unable to inspect Git repository root: worktree list was empty");

	const revisionResult = await git(exec, requestedCwd, ["rev-parse", "--verify", "HEAD"], signal);
	const revision = requireGitResult(revisionResult, "HEAD revision");
	const branchResult = await git(exec, requestedCwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], signal);
	if (branchResult.code !== 0 && branchResult.code !== 1) {
		throw new Error(
			`Unable to inspect Git branch: ${branchResult.stderr.trim() || branchResult.stdout.trim()}`,
		);
	}
	const branch = branchResult.code === 0 ? branchResult.stdout.trim() : undefined;
	const status = await git(exec, requestedCwd, ["status", "--porcelain=v1", "--untracked-files=normal"], signal);
	const dirty = requireGitResult(status, "status").length > 0;

	return {
		intent,
		mode,
		kind: "current",
		requestedCwd,
		isGit: true,
		repositoryRoot: resolve(repositoryRoot),
		worktreeRoot,
		branch,
		revision,
		detached: branch === undefined,
		dirty,
	};
}

interface ActiveWorkspaceJob {
	state: string;
	workspace?: JobWorkspaceMetadata;
}

export interface WorkspaceDecision {
	kind: "current" | "managed";
	reason: "explicit-current" | "read-sharing" | "sole-writer" | "explicit-worktree" | "writer-conflict";
	conflictingWriters: number;
}

function sameWorkspace(left: JobWorkspaceMetadata, right: JobWorkspaceMetadata): boolean {
	if (left.isGit !== right.isGit) return false;
	if (left.isGit) return left.worktreeRoot === right.worktreeRoot;
	return left.requestedCwd === right.requestedCwd;
}

export function decideWorkspace(
	workspace: JobWorkspaceMetadata,
	jobs: ActiveWorkspaceJob[],
): WorkspaceDecision {
	const conflictingWriters = jobs.filter(
		(job) =>
			["launching", "running"].includes(job.state) &&
			job.workspace?.intent === "write" &&
			sameWorkspace(workspace, job.workspace),
	).length;

	if (workspace.mode === "current") {
		return { kind: "current", reason: "explicit-current", conflictingWriters };
	}
	if (workspace.intent === "read" && workspace.mode === "auto") {
		return { kind: "current", reason: "read-sharing", conflictingWriters };
	}
	if (!workspace.isGit && workspace.mode === "worktree") {
		throw new Error("workspace=worktree requires cwd to be inside a Git worktree");
	}
	if (workspace.dirty) {
		throw new Error(
			"Refusing automatic writer/worktree allocation from a dirty Git worktree; commit/stash changes or explicitly select workspace=current",
		);
	}
	if (workspace.mode === "worktree") {
		return { kind: "managed", reason: "explicit-worktree", conflictingWriters };
	}
	if (conflictingWriters > 0) {
		if (!workspace.isGit) {
			throw new Error(
				"Refusing concurrent writers in the same non-Git directory; wait for the active writer or explicitly select workspace=current",
			);
		}
		return { kind: "managed", reason: "writer-conflict", conflictingWriters };
	}
	return { kind: "current", reason: "sole-writer", conflictingWriters };
}

interface ManagedWorkspaceOwner {
	schemaVersion: 1;
	managedBy: "pi-tmux-job";
	id: string;
	repositoryRoot: string;
	sourceWorktreeRoot: string;
	worktreePath: string;
	branch: string;
	baseRevision: string;
	createdAt: string;
	state: "active" | "removed";
	removedAt?: string;
	branchDeleted?: boolean;
}

export interface ManagedWorkspace {
	cwd: string;
	workspace: JobWorkspaceMetadata;
	owner: ManagedWorkspaceOwner;
}

export interface ManagedWorkspaceCleanup {
	removed: boolean;
	preservedReason?: "dirty";
	worktreePath: string;
	branch: string;
	branchDeleted: boolean;
	alreadyRemoved?: boolean;
}

function safeSlug(value: string, maxLength: number): string {
	const slug = value.replaceAll(/[^A-Za-z0-9._-]/g, "-").replaceAll(/-+/g, "-").replace(/^-|-$/g, "");
	return (slug || "workspace").slice(0, maxLength);
}

function repositoryKey(repositoryRoot: string): string {
	const hash = createHash("sha256").update(repositoryRoot).digest("hex").slice(0, 10);
	return `${safeSlug(basename(repositoryRoot), 32)}-${hash}`;
}

async function requireDirectory(path: string, description: string): Promise<void> {
	const entry = await stat(path);
	if (!entry.isDirectory()) throw new Error(`${description} is not a directory: ${path}`);
}

export class ManagedWorkspaceManager {
	private readonly rootDirectory: string;

	constructor(
		private readonly exec: ExecFunction,
		options: { rootDirectory?: string } = {},
	) {
		this.rootDirectory = resolve(
			options.rootDirectory ??
				process.env.PI_TMUX_WORKTREE_ROOT ??
				resolve(homedir(), ".pi", "agent", "tmux-worktrees"),
		);
	}

	async create(
		source: JobWorkspaceMetadata,
		jobName: string,
		signal?: AbortSignal,
	): Promise<ManagedWorkspace> {
		if (!source.isGit || !source.repositoryRoot || !source.worktreeRoot || !source.revision) {
			throw new Error("Managed worktree creation requires complete Git workspace metadata");
		}
		if (source.dirty) throw new Error("Refusing to create a managed worktree from a dirty source worktree");
		const relativeCwd = relative(source.worktreeRoot, source.requestedCwd);
		if (
			isAbsolute(relativeCwd) ||
			relativeCwd === ".." ||
			relativeCwd.startsWith("../") ||
			relativeCwd.startsWith("..\\")
		) {
			throw new Error("Requested cwd escapes its inspected Git worktree");
		}

		const id = `${safeSlug(jobName, 36)}-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
		const repositoryDirectory = resolve(this.rootDirectory, repositoryKey(source.repositoryRoot));
		const worktreesDirectory = resolve(repositoryDirectory, "worktrees");
		const ownersDirectory = resolve(repositoryDirectory, "owners");
		await mkdir(worktreesDirectory, { recursive: true, mode: 0o700 });
		await mkdir(ownersDirectory, { recursive: true, mode: 0o700 });
		for (const directory of [this.rootDirectory, repositoryDirectory, worktreesDirectory, ownersDirectory]) {
			await chmod(directory, 0o700);
		}

		const worktreePath = resolve(worktreesDirectory, id);
		const ownerRecordPath = resolve(ownersDirectory, `${id}.json`);
		const branch = `pi-tmux/${safeSlug(jobName, 36)}-${randomBytes(4).toString("hex")}`;
		const added = await git(
			this.exec,
			source.worktreeRoot,
			["worktree", "add", "-b", branch, worktreePath, source.revision],
			signal,
		);
		if (added.code !== 0) {
			throw new Error(`Unable to create managed worktree: ${added.stderr.trim() || added.stdout.trim()}`);
		}

		const owner: ManagedWorkspaceOwner = {
			schemaVersion: 1,
			managedBy: "pi-tmux-job",
			id,
			repositoryRoot: source.repositoryRoot,
			sourceWorktreeRoot: source.worktreeRoot,
			worktreePath,
			branch,
			baseRevision: source.revision,
			createdAt: new Date().toISOString(),
			state: "active",
		};
		let ownerWritten = false;
		try {
			await writeFile(ownerRecordPath, `${JSON.stringify(owner, null, 2)}\n`, {
				mode: 0o600,
				flag: "wx",
			});
			ownerWritten = true;
			const cwd = resolve(worktreePath, relativeCwd);
			await requireDirectory(cwd, "Managed workspace cwd");
			return {
				cwd,
				owner,
				workspace: {
					...source,
					kind: "managed",
					managedId: id,
					ownerRecordPath,
					createdBranch: branch,
					baseRevision: source.revision,
					worktreeRoot: worktreePath,
					branch,
					detached: false,
					dirty: false,
				},
			};
		} catch (error) {
			if (ownerWritten) await this.rollbackOwner(owner, ownerRecordPath).catch(() => undefined);
			else await this.rollbackFresh(owner, ownerRecordPath).catch(() => undefined);
			throw error;
		}
	}

	async cleanup(
		workspace: JobWorkspaceMetadata | undefined,
		signal?: AbortSignal,
	): Promise<ManagedWorkspaceCleanup> {
		if (
			!workspace ||
			workspace.kind !== "managed" ||
			!workspace.managedId ||
			!workspace.ownerRecordPath ||
			!workspace.worktreeRoot
		) {
			throw new Error("Workspace cleanup requires a managed tmux_agent workspace");
		}
		for (const [description, path] of [
			["ownership record", workspace.ownerRecordPath],
			["managed worktree", workspace.worktreeRoot],
		] as const) {
			const relativePath = relative(this.rootDirectory, resolve(path));
			if (
				relativePath === ".." ||
				relativePath.startsWith("../") ||
				relativePath.startsWith("..\\") ||
				isAbsolute(relativePath)
			) {
				throw new Error(`${description} is outside the operator-managed worktree root`);
			}
		}

		let owner: ManagedWorkspaceOwner;
		try {
			owner = JSON.parse(await readFile(workspace.ownerRecordPath, "utf8")) as ManagedWorkspaceOwner;
		} catch (error) {
			throw new Error(
				`Unable to read managed workspace ownership record: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		if (
			owner.schemaVersion !== 1 ||
			owner.managedBy !== "pi-tmux-job" ||
			owner.id !== workspace.managedId ||
			owner.worktreePath !== workspace.worktreeRoot ||
			owner.repositoryRoot !== workspace.repositoryRoot ||
			owner.branch !== workspace.createdBranch ||
			owner.baseRevision !== workspace.baseRevision
		) {
			throw new Error("Managed workspace ownership record does not match job metadata");
		}
		if (owner.state === "removed") {
			return {
				removed: true,
				worktreePath: owner.worktreePath,
				branch: owner.branch,
				branchDeleted: owner.branchDeleted === true,
				alreadyRemoved: true,
			};
		}
		if (owner.state !== "active") throw new Error("Managed workspace ownership record has an invalid state");
		const statusResult = await git(
			this.exec,
			owner.worktreePath,
			["status", "--porcelain=v1", "--untracked-files=all"],
			signal,
		);
		if (requireGitResult(statusResult, "managed worktree status")) {
			return {
				removed: false,
				preservedReason: "dirty",
				worktreePath: owner.worktreePath,
				branch: owner.branch,
				branchDeleted: false,
			};
		}
		const actualBranch = requireGitResult(
			await git(this.exec, owner.worktreePath, ["symbolic-ref", "--quiet", "--short", "HEAD"], signal),
			"managed worktree branch",
		);
		if (actualBranch !== owner.branch) throw new Error("Managed worktree branch no longer matches ownership");
		const tip = requireGitResult(
			await git(this.exec, owner.repositoryRoot, ["rev-parse", "--verify", `refs/heads/${owner.branch}`], signal),
			"managed branch tip",
		);
		const removed = await git(
			this.exec,
			owner.repositoryRoot,
			["worktree", "remove", owner.worktreePath],
			signal,
		);
		requireGitResult(removed, "managed worktree removal");
		const branchDeleted = tip === owner.baseRevision;
		if (branchDeleted) {
			const branchRemoved = await git(
				this.exec,
				owner.repositoryRoot,
				["update-ref", "-d", `refs/heads/${owner.branch}`, owner.baseRevision],
				signal,
			);
			requireGitResult(branchRemoved, "managed branch removal");
		}
		await writeFile(
			workspace.ownerRecordPath,
			`${JSON.stringify(
				{ ...owner, state: "removed", removedAt: new Date().toISOString(), branchDeleted },
				null,
				2,
			)}\n`,
			{ mode: 0o600 },
		);
		return {
			removed: true,
			worktreePath: owner.worktreePath,
			branch: owner.branch,
			branchDeleted,
		};
	}

	async rollback(workspace: ManagedWorkspace, cause: unknown): Promise<never> {
		try {
			await this.rollbackOwner(workspace.owner, workspace.workspace.ownerRecordPath ?? "");
		} catch (rollbackError) {
			throw new Error(
				`Agent launch failed and managed workspace was preserved because rollback was unsafe: ${workspace.owner.worktreePath}; ` +
				`launch=${cause instanceof Error ? cause.message : String(cause)}; ` +
				`rollback=${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
			);
		}
		throw cause;
	}

	private async rollbackFresh(owner: ManagedWorkspaceOwner, ownerRecordPath: string): Promise<void> {
		const statusResult = await git(this.exec, owner.worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"]);
		if (requireGitResult(statusResult, "new managed worktree status")) {
			throw new Error("new managed worktree contains unexpected changes");
		}
		const removed = await git(this.exec, owner.repositoryRoot, ["worktree", "remove", owner.worktreePath]);
		requireGitResult(removed, "new managed worktree removal");
		const branchRemoved = await git(this.exec, owner.repositoryRoot, [
			"update-ref",
			"-d",
			`refs/heads/${owner.branch}`,
			owner.baseRevision,
		]);
		requireGitResult(branchRemoved, "new managed branch removal");
		await rm(ownerRecordPath, { force: true });
	}

	private async rollbackOwner(owner: ManagedWorkspaceOwner, ownerRecordPath: string): Promise<void> {
		const rawOwner = JSON.parse(await readFile(ownerRecordPath, "utf8")) as ManagedWorkspaceOwner;
		if (
			rawOwner.managedBy !== "pi-tmux-job" ||
			rawOwner.id !== owner.id ||
			rawOwner.state !== "active" ||
			rawOwner.worktreePath !== owner.worktreePath ||
			rawOwner.repositoryRoot !== owner.repositoryRoot ||
			rawOwner.branch !== owner.branch ||
			rawOwner.baseRevision !== owner.baseRevision
		) {
			throw new Error("managed workspace ownership record does not match the requested rollback");
		}
		const statusResult = await git(this.exec, owner.worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"]);
		if (requireGitResult(statusResult, "managed worktree status")) {
			throw new Error("managed worktree contains uncommitted changes");
		}
		const tip = requireGitResult(
			await git(this.exec, owner.repositoryRoot, ["rev-parse", "--verify", `refs/heads/${owner.branch}`]),
			"managed branch tip",
		);
		if (tip !== owner.baseRevision) throw new Error("managed branch contains commits");
		const removed = await git(this.exec, owner.repositoryRoot, ["worktree", "remove", owner.worktreePath]);
		requireGitResult(removed, "managed worktree removal");
		const branchRemoved = await git(this.exec, owner.repositoryRoot, [
			"update-ref",
			"-d",
			`refs/heads/${owner.branch}`,
			owner.baseRevision,
		]);
		requireGitResult(branchRemoved, "managed branch removal");
		await unlink(ownerRecordPath);
		await rm(owner.worktreePath, { recursive: true, force: true });
	}
}

export class WorkspaceAllocator {
	private tail: Promise<void> = Promise.resolve();

	async run<T>(operation: () => Promise<T>): Promise<T> {
		let release!: () => void;
		const previous = this.tail;
		this.tail = new Promise<void>((resolvePromise) => {
			release = resolvePromise;
		});
		await previous;
		try {
			return await operation();
		} finally {
			release();
		}
	}
}

export function describeWorkspace(workspace: JobWorkspaceMetadata | undefined): string {
	if (!workspace) return "";
	if (!workspace.isGit) return ` workspace=non-git:${workspace.intent}`;
	const ref = workspace.branch ?? `@${workspace.revision?.slice(0, 12) ?? "unknown"}`;
	return ` workspace=${workspace.kind}:${workspace.intent}:${ref}:${workspace.dirty ? "dirty" : "clean"}`;
}
