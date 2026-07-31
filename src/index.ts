// pi-statusline-lite — minimal plain-text footer for pi.
// Renders: 🐋 model | cwd | git branch (~N dirty) | ctx usage.
// Follows the active pi theme (muted token), no decorations.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createCwdTracker,
	parseGitStatus,
	renderFooter,
} from "./core.ts";

const FOOTER_KEY = "pi-statusline-lite";
// Debounce for git status --porcelain (render can fire often on resize/input).
const GIT_STATUS_TTL_MS = 2000;

// ---------------------------------------------------------------------------
// Optional issue-1 (#7194) TUI patch self-check.
//
// Local-only tooling: off by default so upstream users are never bothered.
// Enable with PI_ISSUE1_SELFCHECK=1 (optionally PI_TUI_DIST=<dist dir> to
// point at a non-standard pi-tui install). When the installed pi-tui lacks
// both our viewport-clamp patch marker and the upstream alt-screen renderer,
// a warning is shown once at startup.
// ---------------------------------------------------------------------------
const ISSUE1_SELFCHECK = process.env.PI_ISSUE1_SELFCHECK === "1";

function findPiTuiDist(): string | undefined {
	const fromEnv = process.env.PI_TUI_DIST;
	if (fromEnv) return fromEnv;
	try {
		const bin = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
		const cliJs = realpathSync(bin);
		const pkgRoot = dirname(dirname(cliJs));
		const dist = join(
			pkgRoot,
			"node_modules",
			"@earendil-works",
			"pi-tui",
			"dist",
		);
		if (existsSync(join(dist, "tui.js"))) return dist;
	} catch {
		// best-effort
	}
	return undefined;
}

function checkIssue1Patch(ctx: { ui: { notify?: (m: string, t?: string) => void } }) {
	try {
		const dist = findPiTuiDist();
		if (!dist) return;
		const src = readFileSync(join(dist, "tui.js"), "utf8");
		const patched = src.includes("clampedRender");
		const upstreamFixed =
			src.includes("TuiAltScreen") || src.includes("alternate-screen");
		if (!patched && !upstreamFixed) {
			ctx.ui.notify?.(
				"issue-1 TUI 补丁缺失（可能被 pi update 覆盖）：运行 ~/dev/fix/patch-kit/reapply.sh 后重启 pi",
				"warning",
			);
		}
	} catch {
		// Best-effort check; never break the session.
	}
}

export default function (pi: ExtensionAPI) {
	// Latest known cwd. pi exposes no cwd-change event, so we refresh it from
	// events that carry a fresh ctx.cwd (tool_call, user_bash) and re-render
	// when it changes.
	let cwdTracker: ReturnType<typeof createCwdTracker> | null = null;
	// Set by the footer factory once the footer is mounted. Recomputes the
	// footer line and requests a render ONLY when the rendered content would
	// actually change (content-dedupe).
	let refreshFooter: (() => void) | null = null;

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (ISSUE1_SELFCHECK) checkIssue1Patch(ctx);
		cwdTracker = createCwdTracker(ctx.cwd);

		const onFreshCwd = () => {
			try {
				// Only act on a real cwd change: repeated tool_call/user_bash
				// events for the same cwd must not trigger renders.
				if (cwdTracker?.update(ctx.cwd)) refreshFooter?.();
			} catch {
				// Footer bookkeeping must never break the session.
			}
		};
		pi.on("tool_call", onFreshCwd);
		pi.on("user_bash", onFreshCwd);

		ctx.ui.setFooter((tui, theme, footerData) => {
			let disposed = false;
			let gitCache: {
				cwd: string;
				branch: string;
				counts: ReturnType<typeof parseGitStatus>;
				at: number;
			} | null = null;
			// Last line we actually rendered (and the width it was fitted to).
			// Used to dedupe event-driven refreshes so we never call the
			// global tui.requestRender() for a footer that would not change.
			let lastRenderedLine: string | null = null;
			let lastWidth = 80;

			const getGitCounts = (cwd: string, branch: string) => {
				const now = Date.now();
				if (
					gitCache &&
					gitCache.cwd === cwd &&
					gitCache.branch === branch &&
					now - gitCache.at < GIT_STATUS_TTL_MS
				) {
					return gitCache.counts;
				}
				let counts = { staged: 0, unstaged: 0, untracked: 0 };
				try {
					const out = execFileSync("git", ["status", "--porcelain"], {
						cwd,
						encoding: "utf8",
						stdio: ["ignore", "pipe", "ignore"],
					});
					counts = parseGitStatus(out);
				} catch {
					// Not a git repo or git missing: treat as clean.
				}
				gitCache = { cwd, branch, counts, at: now };
				return counts;
			};

			// Single source of truth for the footer content. render() and the
			// event-driven refresh both use this so their dedupe keys agree.
			const computeLine = (width: number): string => {
				if (disposed) return "";
				try {
					const cwd = cwdTracker?.get() ?? ctx.cwd;
					const branch = footerData.getGitBranch();
					const usage = ctx.getContextUsage();
					return renderFooter(
						{
							model: ctx.model?.id,
							cwd,
							branch: branch ?? undefined,
							gitCounts: branch ? getGitCounts(cwd, branch) : undefined,
							contextPercent: usage?.percent,
							contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow,
						},
						// Follow the active theme: muted token is dark on light themes.
						{ width, color: (text) => theme.fg("muted", text) },
					);
				} catch {
					// A footer must never crash the editor loop.
					return "";
				}
			};

			// pi-tui 0.83.0 has no component-scoped rendering API (no
			// requestComponentRender; invalidate() does not gate rendering),
			// so the only way to repaint the footer is the global
			// requestRender(). Keep that call rare: recompute the footer line
			// and render only when the content would actually differ. The
			// TUI's own render loop (spinners, input, streaming) refreshes
			// the footer anyway, so this only covers cwd/branch changes that
			// would otherwise sit stale until the next frame.
			const refreshIfChanged = () => {
				try {
					const line = computeLine(lastWidth);
					if (line !== lastRenderedLine) {
						lastRenderedLine = line;
						tui.requestRender();
					}
				} catch {
					// ignore
				}
			};
			refreshFooter = refreshIfChanged;

			const unsubscribe = footerData.onBranchChange(() => {
				try {
					refreshIfChanged();
				} catch {
					// ignore
				}
			});

			return {
				dispose() {
					disposed = true;
					refreshFooter = null;
					unsubscribe();
				},
				invalidate() {},
				render(width: number): string[] {
					lastWidth = width;
					const line = computeLine(width);
					lastRenderedLine = line;
					// Always exactly one line: a footer whose height changes
					// (or disappears) forces the TUI diff range to expand,
					// which widens the repaint area.
					return [line || ""];
				},
			};
		});
	});
}
