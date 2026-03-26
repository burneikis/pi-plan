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

/**
 * Check if a bash command is safe (read-only).
 */
export function isSafeCommand(command: string): boolean {
	const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
	const isSafe = SAFE_PATTERNS.some((p) => p.test(command));
	return !isDestructive && isSafe;
}

// Destructive commands blocked in plan mode
const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

// Safe read-only commands allowed in plan mode
const SAFE_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	/^\s*curl\s/i,
	/^\s*wget\s+-O\s*-/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
	/^\s*exa\b/,
];
