import { test } from "node:test";
import assert from "node:assert/strict";

import {
	shortenModel,
	visibleWidth,
	stripAnsi,
	buildSegments,
	fitSegments,
	renderFooter,
	createCwdTracker,
	parseGitStatus,
	formatGitBranch,
} from "../src/core.ts";

// ---------- shortenModel ----------

test("shortenModel: deepseek-v4-flash → V4F", () => {
	assert.equal(shortenModel("deepseek-v4-flash"), "V4F");
});

test("shortenModel: deepseek-v4 → V4", () => {
	assert.equal(shortenModel("deepseek-v4"), "V4");
});

test("shortenModel: deepseek-v3.2 → V3.2", () => {
	assert.equal(shortenModel("deepseek-v3.2"), "V3.2");
});

test("shortenModel: deepseek-reasoner falls back to DS reasoner", () => {
	assert.equal(shortenModel("deepseek-reasoner"), "DS reasoner");
});

test("shortenModel: strips date suffix", () => {
	assert.equal(shortenModel("deepseek-v4-flash-20260731"), "V4F");
});

test("shortenModel: claude/gpt rules unchanged", () => {
	assert.equal(shortenModel("claude-sonnet-4"), "sonnet-4");
	assert.equal(shortenModel("gpt-4o"), "gpt 4o");
});

test("shortenModel: unknown model unchanged", () => {
	assert.equal(shortenModel("qwen3-max"), "qwen3-max");
});

test("shortenModel: empty string stays empty", () => {
	assert.equal(shortenModel(""), "");
});

// ---------- visibleWidth / stripAnsi ----------

test("visibleWidth: plain ASCII", () => {
	assert.equal(visibleWidth("abc def"), 7);
});

test("visibleWidth: wide characters count as 2 (emoji/CJK)", () => {
	assert.equal(visibleWidth("🐋 V4F"), 6); // whale(2) + space(1) + V4F(3)
	assert.equal(visibleWidth("中文"), 4);
});

test("visibleWidth: ANSI escape sequences are not counted", () => {
	const colored = "\u001b[38;2;255;255;255mhello\u001b[0m";
	assert.equal(visibleWidth(colored), 5);
});

test("stripAnsi: removes escape sequences", () => {
	assert.equal(stripAnsi("\u001b[38;2;1;2;3mtext\u001b[0m"), "text");
});

// ---------- buildSegments ----------

test("buildSegments: full set in display order", () => {
	const segments = buildSegments({
		model: "deepseek-v4-flash",
		cwd: "/home/user",
		branch: "main",
		contextPercent: 12.34,
		contextWindow: 200000,
	});
	assert.deepEqual(
		segments.map((s) => s.name),
		["model", "cwd", "branch", "context"],
	);
});

test("buildSegments: whale prefix for model, V4F short name", () => {
	const segments = buildSegments({
		model: "deepseek-v4-flash",
		cwd: "/home/user",
		branch: "main",
		contextPercent: 50,
		contextWindow: 200000,
	});
	const model = segments.find((s) => s.name === "model");
	assert.equal(model.text, "🐋 V4F");
});

test("buildSegments: cwd uses basename only", () => {
	const segments = buildSegments({
		model: "m",
		cwd: "/home/user",
		branch: "main",
	});
	const cwd = segments.find((s) => s.name === "cwd");
	assert.equal(cwd.text, "user");
});

test("buildSegments: no branch segment when branch is absent", () => {
	const segments = buildSegments({ model: "m", cwd: "/x", branch: undefined });
	assert.ok(!segments.some((s) => s.name === "branch"));
});

test("buildSegments: context format percent and window", () => {
	const segments = buildSegments({
		model: "m",
		cwd: "/x",
		contextPercent: 12.345,
		contextWindow: 200000,
	});
	const context = segments.find((s) => s.name === "context");
	assert.equal(context.text, "12.3%/200k");
});

test("buildSegments: unknown context shows ?", () => {
	const segments = buildSegments({ model: "m", cwd: "/x" });
	const context = segments.find((s) => s.name === "context");
	assert.equal(context.text, "?");
});

// ---------- fitSegments ----------

test("fitSegments: keeps all when width is enough", () => {
	const segments = buildSegments({
		model: "deepseek-v4-flash",
		cwd: "/x/home",
		branch: "main",
		contextPercent: 12.3,
		contextWindow: 200000,
	});
	const fitted = fitSegments(segments, 200);
	assert.equal(fitted.length, 4);
});

test("fitSegments: drops cwd first (lowest priority), then branch", () => {
	const segments = buildSegments({
		model: "deepseek-v4-flash",
		cwd: "/x/very-long-directory-name",
		branch: "feature/very-long-branch",
		contextPercent: 12.3,
		contextWindow: 200000,
	});
	// Narrow: cwd (priority 80) dropped first. 49 cols needed for model+branch+context.
	const fitted1 = fitSegments(segments, 50);
	assert.deepEqual(
		fitted1.map((s) => s.name),
		["model", "branch", "context"],
	);
	// Narrower: branch (priority 100) dropped next
	const fitted2 = fitSegments(segments, 40);
	assert.deepEqual(
		fitted2.map((s) => s.name),
		["model", "context"],
	);
});

test("fitSegments: model is dropped before context", () => {
	const segments = buildSegments({
		model: "deepseek-v4-flash",
		cwd: "/x",
		branch: "main",
		contextPercent: 12.3,
		contextWindow: 200000,
	});
	// model+context = 6+3+11 = 20 cols with " | "; context alone = 11
	const fitted = fitSegments(segments, 15);
	assert.deepEqual(
		fitted.map((s) => s.name),
		["context"],
	);
});

test("fitSegments: empty result when nothing fits", () => {
	const segments = buildSegments({
		model: "m",
		cwd: "/x",
		contextPercent: 99,
		contextWindow: 200000,
	});
	const fitted = fitSegments(segments, 3);
	assert.deepEqual(fitted, []);
});

// ---------- renderFooter ----------

test("renderFooter: joins fitted segments with | separators", () => {
	const line = stripAnsi(
		renderFooter(
			{
				model: "deepseek-v4-flash",
				cwd: "/x/home",
				branch: "main",
				contextPercent: 12.3,
				contextWindow: 200000,
			},
			{ width: 200 },
		),
	);
	assert.equal(line, "🐋 V4F | home | main | 12.3%/200k");
});

test("renderFooter: wraps the line in muted gray foreground ANSI", () => {
	const line = renderFooter(
		{ model: "m", cwd: "/x" },
		{ width: 200 },
	);
	assert.ok(line.startsWith("\u001b[38;2;176;176;176m"));
	assert.ok(line.endsWith("\u001b[0m"));
	assert.ok(!line.includes("48;2;"), "no background color codes");
});

test("renderFooter: returns empty string when width too small", () => {
	const line = renderFooter(
		{ model: "m", cwd: "/x", contextPercent: 99, contextWindow: 200000 },
		{ width: 3 },
	);
	assert.equal(line, "");
});

test("renderFooter: width 0 or negative returns empty", () => {
	assert.equal(renderFooter({ model: "m", cwd: "/x" }, { width: 0 }), "");
	assert.equal(renderFooter({ model: "m", cwd: "/x" }, { width: -5 }), "");
});

// ---------- createCwdTracker ----------

test("createCwdTracker: starts with given initial cwd", () => {
	const t = createCwdTracker("/a");
	assert.equal(t.get(), "/a");
});

test("createCwdTracker: starts null without initial cwd", () => {
	const t = createCwdTracker();
	assert.equal(t.get(), null);
});

test("createCwdTracker: first update returns true and stores", () => {
	const t = createCwdTracker();
	assert.equal(t.update("/a"), true);
	assert.equal(t.get(), "/a");
});

test("createCwdTracker: same cwd returns false (no change)", () => {
	const t = createCwdTracker("/a");
	assert.equal(t.update("/a"), false);
});

test("createCwdTracker: new cwd returns true and replaces", () => {
	const t = createCwdTracker("/a");
	assert.equal(t.update("/b"), true);
	assert.equal(t.get(), "/b");
});

test("createCwdTracker: empty values are ignored", () => {
	const t = createCwdTracker("/a");
	assert.equal(t.update(null), false);
	assert.equal(t.update(undefined), false);
	assert.equal(t.update(""), false);
	assert.equal(t.get(), "/a");
});

// ---------- parseGitStatus ----------

test("parseGitStatus: empty output is clean", () => {
	assert.deepEqual(parseGitStatus(""), {
		staged: 0,
		unstaged: 0,
		untracked: 0,
	});
});

test("parseGitStatus: ignores blank lines", () => {
	assert.deepEqual(parseGitStatus("\n  \n\n"), {
		staged: 0,
		unstaged: 0,
		untracked: 0,
	});
});

test("parseGitStatus: untracked files (??)", () => {
	assert.deepEqual(parseGitStatus("?? newfile.txt\n"), {
		staged: 0,
		unstaged: 0,
		untracked: 1,
	});
});

test("parseGitStatus: unstaged modification ( M)", () => {
	assert.deepEqual(parseGitStatus(" M src/core.mjs\n"), {
		staged: 0,
		unstaged: 1,
		untracked: 0,
	});
});

test("parseGitStatus: staged modification (M )", () => {
	assert.deepEqual(parseGitStatus("M  src/core.mjs\n"), {
		staged: 1,
		unstaged: 0,
		untracked: 0,
	});
});

test("parseGitStatus: staged + unstaged (MM)", () => {
	assert.deepEqual(parseGitStatus("MM src/core.mjs\n"), {
		staged: 1,
		unstaged: 1,
		untracked: 0,
	});
});

test("parseGitStatus: staged add (A )", () => {
	assert.deepEqual(parseGitStatus("A  src/new.mjs\n"), {
		staged: 1,
		unstaged: 0,
		untracked: 0,
	});
});

test("parseGitStatus: unstaged delete ( D)", () => {
	assert.deepEqual(parseGitStatus(" D src/old.mjs\n"), {
		staged: 0,
		unstaged: 1,
		untracked: 0,
	});
});

test("parseGitStatus: rename counts as staged", () => {
	assert.deepEqual(parseGitStatus("R  old.mjs -> new.mjs\n"), {
		staged: 1,
		unstaged: 0,
		untracked: 0,
	});
});

test("parseGitStatus: ignored files (!!) are not counted", () => {
	assert.deepEqual(parseGitStatus("!! node_modules/\n"), {
		staged: 0,
		unstaged: 0,
		untracked: 0,
	});
});

test("parseGitStatus: mixed output counts all categories", () => {
	const out = [
		"M  a.mjs",
		" M b.mjs",
		"MM c.mjs",
		"?? d.txt",
		" D e.mjs",
		"A  f.mjs",
		"",
	].join("\n");
	assert.deepEqual(parseGitStatus(out), {
		staged: 3,
		unstaged: 3,
		untracked: 1,
	});
});

// ---------- formatGitBranch ----------

test("formatGitBranch: null branch returns null", () => {
	assert.equal(
		formatGitBranch(null, { staged: 1, unstaged: 0, untracked: 0 }),
		null,
	);
});

test("formatGitBranch: clean branch has no suffix", () => {
	assert.equal(formatGitBranch("main"), "main");
	assert.equal(
		formatGitBranch("main", { staged: 0, unstaged: 0, untracked: 0 }),
		"main",
	);
});

test("formatGitBranch: dirty adds ~N total changes", () => {
	assert.equal(
		formatGitBranch("main", { staged: 0, unstaged: 2, untracked: 0 }),
		"main ~2",
	);
});

test("formatGitBranch: staged/untracked count into total", () => {
	assert.equal(
		formatGitBranch("main", { staged: 1, unstaged: 1, untracked: 2 }),
		"main ~4",
	);
});

// ---------- buildSegments with gitCounts ----------

test("buildSegments: branch segment includes dirty count", () => {
	const segments = buildSegments({
		model: "m",
		cwd: "/x",
		branch: "main",
		gitCounts: { staged: 0, unstaged: 1, untracked: 1 },
	});
	const branch = segments.find((s) => s.name === "branch");
	assert.equal(branch.text, "main ~2");
});

test("buildSegments: branch segment unchanged without gitCounts", () => {
	const segments = buildSegments({ model: "m", cwd: "/x", branch: "main" });
	const branch = segments.find((s) => s.name === "branch");
	assert.equal(branch.text, "main");
});

// ---------- renderFooter color injection ----------

test("renderFooter: custom color function receives final joined line", () => {
	let received = null;
	const line = renderFooter(
		{
			model: "deepseek-v4-flash",
			cwd: "/x/home",
			branch: "main",
			contextPercent: 12.3,
			contextWindow: 200000,
		},
		{ width: 200, color: (t) => {
			received = t;
			return `[[${t}]]`;
		} },
	);
	assert.equal(received, "🐋 V4F | home | main | 12.3%/200k");
	assert.equal(line, "[[🐋 V4F | home | main | 12.3%/200k]]");
});

test("renderFooter: default color remains muted gray", () => {
	const line = renderFooter({ model: "m", cwd: "/x" }, { width: 200 });
	assert.ok(line.startsWith("\u001b[38;2;176;176;176m"));
	assert.ok(line.endsWith("\u001b[0m"));
});

test("renderFooter: custom color ANSI does not affect fitting", () => {
	// Color wraps in ANSI; fitting must be based on visible text only.
	const line = renderFooter(
		{
			model: "deepseek-v4-flash",
			cwd: "/x/very-long-directory-name",
			branch: "feature/very-long-branch",
			contextPercent: 12.3,
			contextWindow: 200000,
		},
		{ width: 50, color: (t) => `\u001b[38;2;1;2;3m${t}\u001b[0m` },
	);
	// Same fitting as default: cwd dropped at width 50.
	assert.ok(line.includes("feature/very-long-branch"));
	assert.ok(!line.includes("very-long-directory-name"));
});

test("renderFooter: git counts flow through to rendered line", () => {
	const line = stripAnsi(
		renderFooter(
			{
				model: "deepseek-v4-flash",
				cwd: "/x",
				branch: "main",
				gitCounts: { staged: 0, unstaged: 2, untracked: 1 },
				contextPercent: 12.3,
				contextWindow: 200000,
			},
			{ width: 200 },
		),
	);
	assert.equal(line, "🐋 V4F | x | main ~3 | 12.3%/200k");
});
