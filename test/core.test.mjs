import { test } from "node:test";
import assert from "node:assert/strict";

import {
	shortenModel,
	visibleWidth,
	stripAnsi,
	buildSegments,
	fitSegments,
	renderFooter,
} from "../src/core.mjs";

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
		cwd: "/data/data/com.termux/files/home",
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
		cwd: "/data/data/com.termux/files/home",
		branch: "main",
	});
	const cwd = segments.find((s) => s.name === "cwd");
	assert.equal(cwd.text, "home");
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
