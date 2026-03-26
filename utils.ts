/**
 * Pure utility functions for pi-plan extension.
 */

import { basename } from "node:path";
import { createHash } from "node:crypto";

export interface PlanStep {
	step: number;
	text: string;
}

/**
 * Parse numbered steps from the "## Steps" section of a plan.
 */
export function parsePlanSteps(content: string): PlanStep[] {
	const steps: PlanStep[] = [];

	// Find the ## Steps section
	const stepsMatch = content.match(/^##\s+Steps\s*$/m);
	if (!stepsMatch) return steps;

	const stepsStart = content.indexOf(stepsMatch[0]) + stepsMatch[0].length;

	// Extract until the next ## heading or end of file
	const nextHeading = content.slice(stepsStart).match(/^##\s+/m);
	const stepsSection = nextHeading
		? content.slice(stepsStart, stepsStart + nextHeading.index!)
		: content.slice(stepsStart);

	// Match numbered steps (e.g., "1. Step description")
	const numberedPattern = /^\s*(\d+)[.)]\s+(.+)/gm;
	for (const match of stepsSection.matchAll(numberedPattern)) {
		const stepNum = parseInt(match[1], 10);
		const text = match[2].trim();
		if (text.length > 0) {
			steps.push({ step: stepNum, text });
		}
	}

	return steps;
}

/**
 * Extract the plan title from "# Plan: <title>".
 */
export function extractPlanTitle(content: string): string | null {
	const match = content.match(/^#\s+Plan:\s*(.+)/m);
	return match ? match[1].trim() : null;
}

/**
 * Derive a safe directory name from the session file path.
 * Uses the basename without extension, or a hash fallback.
 */
export function deriveSessionId(sessionFile: string | null): string {
	if (!sessionFile) {
		// Fallback for ephemeral sessions
		const hash = createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex");
		return hash.slice(0, 16);
	}

	const base = basename(sessionFile);
	// Remove extension (.json, .jsonl, etc.)
	const withoutExt = base.replace(/\.[^.]+$/, "");
	// Sanitize: only allow alphanumeric, hyphens, underscores
	const sanitized = withoutExt.replace(/[^a-zA-Z0-9_-]/g, "_");
	return sanitized || createHash("sha256").update(sessionFile).digest("hex").slice(0, 16);
}


