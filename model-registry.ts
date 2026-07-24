import type { ExecFunction } from "./job-manager.ts";

export interface PiModelRecord {
	provider: string;
	model: string;
	id: string;
}

export function parsePiModelRegistry(output: string): PiModelRecord[] {
	const models: PiModelRecord[] = [];
	for (const line of output.split("\n")) {
		const [provider, model] = line.trim().split(/\s+/);
		if (!provider || !model || provider === "provider") continue;
		models.push({ provider, model, id: `${provider}/${model}` });
	}
	return models;
}

export async function validatePiModel(
	exec: ExecFunction,
	executable: string,
	requested: string,
	signal?: AbortSignal,
): Promise<string> {
	const model = requested.trim();
	if (!model) throw new Error("model must not be empty");
	const result = await exec(executable, ["--list-models"], { signal, timeout: 15_000 });
	if (result.code !== 0) {
		throw new Error(`Unable to read Pi model registry: ${result.stderr.trim() || result.stdout.trim()}`);
	}
	const models = parsePiModelRegistry(result.stdout);
	if (!model.includes("/")) {
		const matches = models.filter((candidate) => candidate.model === model);
		if (matches.length > 1) {
			throw new Error(`Ambiguous Pi model ${model}; use an exact provider/model: ${matches.map((item) => item.id).join(", ")}`);
		}
		if (matches.length === 1) {
			throw new Error(`Pi model must use an exact provider/model identifier; did you mean ${matches[0].id}?`);
		}
	}
	if (!models.some((candidate) => candidate.id === model)) {
		throw new Error(`Pi model is not present in the live registry: ${model}`);
	}
	return model;
}
