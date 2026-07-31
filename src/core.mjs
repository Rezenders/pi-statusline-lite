// pi-statusline-lite core: pure, dependency-free logic.
// No pi imports here so it can be tested with plain node --test.

// ---------------------------------------------------------------------------
// Model name shortening
// ---------------------------------------------------------------------------

/**
 * Shorten a provider model id for display:
 * - deepseek-v4-flash → V4F, deepseek-v4 → V4, deepseek-v3.2 → V3.2
 * - deepseek-reasoner → "DS reasoner" (fallback for other deepseek-* ids)
 * - claude-* / gpt-* keep the upstream rules from @narumitw/pi-statusline
 * - unknown models pass through unchanged
 */
export function shortenModel(model) {
	if (!model) return model ?? "";
	return model
		.replace(/^claude-/, "")
		.replace(/^gpt-/, "gpt ")
		.replace(/^deepseek-v(\d+(?:\.\d+)?)(?:-(\w+))?/, (_m, v, f) =>
			f ? `V${v}${f[0].toUpperCase()}` : `V${v}`,
		)
		.replace(/^deepseek-/, "DS ")
		.replace(/-20\d{6}$/, "")
		.replace(/-latest$/, "");
}

// ---------------------------------------------------------------------------
// Width helpers
// ---------------------------------------------------------------------------

const ANSI_RE = /\u001b\[[0-9;]*m/g;

/** Remove ANSI escape sequences from a string. */
export function stripAnsi(text) {
	return text.replace(ANSI_RE, "");
}

/**
 * Visible width of a string in terminal columns:
 * - ANSI escapes cost 0
 * - characters in the East Asian Wide/Fullwidth ranges cost 2
 * - everything else costs 1
 */
export function visibleWidth(text) {
	let width = 0;
	for (const ch of stripAnsi(text)) {
		const code = ch.codePointAt(0);
		// Wide ranges: CJK, emoji, fullwidth forms, etc.
		if (
			code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a ||
				(code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
				(code >= 0xac00 && code <= 0xd7a3) ||
				(code >= 0xf900 && code <= 0xfaff) ||
				(code >= 0xfe10 && code <= 0xfe19) ||
				(code >= 0xfe30 && code <= 0xfe6f) ||
				(code >= 0xff00 && code <= 0xff60) ||
				(code >= 0xffe0 && code <= 0xffe6) ||
				(code >= 0x1f300 && code <= 0x1faff) ||
				(code >= 0x1f900 && code <= 0x1f9ff) ||
				(code >= 0x20000 && code <= 0x3fffd))
		) {
			width += 2;
		} else {
			width += 1;
		}
	}
	return width;
}

/** Wrap text in muted gray foreground ANSI (dark-theme friendly, no background). */
export function muted(text) {
	return `\u001b[38;2;176;176;176m${text}\u001b[0m`;
}

// ---------------------------------------------------------------------------
// Cwd tracking
// ---------------------------------------------------------------------------

/**
 * Tracks the latest known cwd. `update()` returns true when the cwd changed.
 * pi exposes no cwd-change event, so callers poll with fresh ctx.cwd values
 * from other events (tool_call, user_bash, ...).
 */
export function createCwdTracker(initial = null) {
	let cwd = initial ?? null;
	return {
		update(latest) {
			if (latest && latest !== cwd) {
				cwd = latest;
				return true;
			}
			return false;
		},
		get() {
			return cwd;
		},
	};
}

// ---------------------------------------------------------------------------
// Git status
// ---------------------------------------------------------------------------

/**
 * Count changes from `git status --porcelain` output (v1 format).
 * Returns { staged, unstaged, untracked }.
 */
export function parseGitStatus(porcelain) {
	const counts = { staged: 0, unstaged: 0, untracked: 0 };
	for (const line of String(porcelain ?? "").split("\n")) {
		if (line.length < 2) continue;
		if (line.startsWith("??")) {
			counts.untracked += 1;
			continue;
		}
		const x = line[0];
		const y = line[1];
		// ' ' = unchanged, '?' = untracked (handled above), '.' = unmerged,
		// '!' = ignored -> none of these count as real changes.
		if (x !== " " && x !== "?" && x !== "." && x !== "!") counts.staged += 1;
		if (y !== " " && y !== "?" && y !== "." && y !== "!") counts.unstaged += 1;
	}
	return counts;
}

/**
 * Render the branch segment: "main" when clean, "main ~2" when 2 changes are
 * uncommitted (staged + unstaged + untracked). Returns null when not in a git
 * repo (branch is null) so the segment is hidden.
 */
export function formatGitBranch(branch, counts) {
	if (!branch) return null;
	const total = counts
		? counts.staged + counts.unstaged + counts.untracked
		: 0;
	return total > 0 ? `${branch} ~${total}` : branch;
}

// ---------------------------------------------------------------------------
// Segment model
// ---------------------------------------------------------------------------

export const SEGMENT_PRIORITY = {
	context: 120,
	model: 110,
	branch: 100,
	cwd: 80,
};

export function formatContext(percent, window) {
	if (percent === null || percent === undefined) return "?";
	const pct = Number.isFinite(percent) ? percent.toFixed(1) : "?";
	const win = window
		? window >= 1000
			? `${Math.round(window / 1000)}k`
			: String(window)
		: "";
	return `${pct}%${win ? "/" + win : ""}`;
}

/**
 * Build the ordered segment list from runtime data.
 * Each segment: { name, text } where text already includes prefix.
 */
export function buildSegments({ model, cwd, branch, gitCounts, contextPercent, contextWindow }) {
	const segments = [];
	segments.push({ name: "model", text: `🐋 ${shortenModel(model) || "?"}` });
	if (cwd) {
		const base = cwd.split("/").filter(Boolean).at(-1) || cwd;
		segments.push({ name: "cwd", text: base });
	}
	if (branch) {
		segments.push({ name: "branch", text: formatGitBranch(branch, gitCounts) ?? branch });
	}
	segments.push({
		name: "context",
		text: formatContext(contextPercent, contextWindow),
	});
	return segments;
}

const SEPARATOR = " | ";

/**
 * Responsive fitting: drop lowest-priority segments until the rendered line
 * fits the width. Never drops the last remaining segment.
 */
export function fitSegments(segments, width) {
	if (width <= 0 || segments.length === 0) return [];
	const fitted = [...segments];
	while (fitted.length > 1) {
		if (visibleWidth(fitted.map((s) => s.text).join(SEPARATOR)) <= width) return fitted;
		let dropIndex = 0;
		for (let i = 1; i < fitted.length; i += 1) {
			if (
				(SEGMENT_PRIORITY[fitted[i].name] ?? 0) <
				(SEGMENT_PRIORITY[fitted[dropIndex].name] ?? 0)
			) {
				dropIndex = i;
			}
		}
		fitted.splice(dropIndex, 1);
	}
	return visibleWidth(fitted[0].text) <= width ? fitted : [];
}

/**
 * Render the footer line, | separated, no decorations.
 * `color` wraps the final line (default: muted gray for dark themes); pass
 * e.g. `(t) => theme.fg("muted", t)` to follow the active pi theme.
 * Returns "" when nothing fits.
 */
export function renderFooter(data, { width, color = muted }) {
	const fitted = fitSegments(buildSegments(data), width);
	if (fitted.length === 0) return "";
	return color(fitted.map((s) => s.text).join(SEPARATOR));
}
