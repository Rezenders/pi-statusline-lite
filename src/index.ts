// pi-statusline-lite — minimal plain-text footer for pi.
// Renders: 🐋 model | cwd | git branch | ctx usage, white text, no decorations.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderFooter } from "./core.mjs";

const FOOTER_KEY = "pi-statusline-lite";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const cwd = ctx.cwd;

		ctx.ui.setFooter((tui, _theme, footerData) => {
			let disposed = false;
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose() {
					disposed = true;
					unsubscribe();
				},
				invalidate() {},
				render(width: number): string[] {
					if (disposed) return [];
					const usage = ctx.getContextUsage();
					const line = renderFooter(
						{
							model: ctx.model?.id,
							cwd,
							branch: footerData.getGitBranch() ?? undefined,
							contextPercent: usage?.percent,
							contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow,
						},
						{ width },
					);
					return line ? [line] : [];
				},
			};
		});
	});
}
