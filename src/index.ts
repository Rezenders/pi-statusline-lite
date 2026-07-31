// pi-statusline-lite — minimal plain-text footer for pi.
// Renders: 🐋 model | cwd | git branch (~N dirty) | ctx usage.
// Follows the active pi theme (muted token), no decorations.
import { execFileSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createCwdTracker,
	parseGitStatus,
	renderFooter,
} from "./core.ts";

const FOOTER_KEY = "pi-statusline-lite";
// Debounce for git status --porcelain (render can fire often on resize/input).
const GIT_STATUS_TTL_MS = 2000;

export default function (pi: ExtensionAPI) {
	// Latest known cwd. pi exposes no cwd-change event, so we refresh it from
	// events that carry a fresh ctx.cwd (tool_call, user_bash) and re-render
	// when it changes.
	let cwdTracker: ReturnType<typeof createCwdTracker> | null = null;
	let tuiRef: { requestRender(): void } | null = null;

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		cwdTracker = createCwdTracker(ctx.cwd);

		const onFreshCwd = () => {
			try {
				if (cwdTracker?.update(ctx.cwd)) tuiRef?.requestRender();
			} catch {
				// Footer bookkeeping must never break the session.
			}
		};
		pi.on("tool_call", onFreshCwd);
		pi.on("user_bash", onFreshCwd);

		ctx.ui.setFooter((tui, theme, footerData) => {
			tuiRef = tui;
			let disposed = false;
			let gitCache: {
				cwd: string;
				branch: string;
				counts: ReturnType<typeof parseGitStatus>;
				at: number;
			} | null = null;
			const unsubscribe = footerData.onBranchChange(() => {
				try {
					tui.requestRender();
				} catch {
					// ignore
				}
			});

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

			return {
				dispose() {
					disposed = true;
					tuiRef = null;
					unsubscribe();
				},
				invalidate() {},
				render(width: number): string[] {
					if (disposed) return [];
					try {
						const cwd = cwdTracker?.get() ?? ctx.cwd;
						const branch = footerData.getGitBranch();
						const usage = ctx.getContextUsage();
						const line = renderFooter(
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
						return line ? [line] : [];
					} catch {
						// A footer must never crash the editor loop.
						return [];
					}
				},
			};
		});
	});
}
