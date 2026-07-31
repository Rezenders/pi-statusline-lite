// Integration test: drive the extension through a simulated pi runtime.
// Covers the full chain: extension() -> session_start -> setFooter factory
// -> render (with real git status exec and theme fg).
import { test } from "node:test";
import assert from "node:assert/strict";
import extension from "../src/index.ts";

function createPi() {
	const handlers = new Map();
	return {
		on: (event, fn) => {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event).push(fn);
		},
		handlers,
	};
}

function createContext({ branch = null, cwd = process.cwd() } = {}) {
	let footerFactory = null;
	const ctx = {
		mode: "tui",
		cwd,
		model: { id: "deepseek-v4-flash", contextWindow: 200000 },
		getContextUsage: () => ({ percent: 12.3 }),
		ui: {
			setFooter: (factory) => {
				footerFactory = factory;
			},
		},
	};
	return {
		ctx,
		getFooterFactory: () => footerFactory,
	};
}

test("integration: extension registers events and a footer", () => {
	const pi = createPi();
	extension(pi);
	assert.ok(pi.handlers.has("session_start"), "session_start registered");
	// tool_call / user_bash are registered inside the session_start handler.
	const { ctx } = createContext();
	for (const fn of pi.handlers.get("session_start")) fn({}, ctx);
	for (const event of ["tool_call", "user_bash"]) {
		assert.ok(pi.handlers.has(event), `event ${event} registered`);
	}
});

test("integration: session_start registers footer and render works (no git)", () => {
	const pi = createPi();
	extension(pi);
	const { ctx, getFooterFactory } = createContext();
	for (const fn of pi.handlers.get("session_start")) fn({}, ctx);

	const factory = getFooterFactory();
	assert.equal(typeof factory, "function");

	const tui = { requestRender: () => {} };
	const theme = { fg: (color, text) => `[[${color}:${text}]]` };
	const footerData = {
		getGitBranch: () => null,
		onBranchChange: () => () => {},
	};
	const component = factory(tui, theme, footerData);
	const lines = component.render(120);
	assert.equal(lines.length, 1);
	assert.match(lines[0], /muted:/); // theme.fg("muted", ...) applied
	assert.match(lines[0], /V4F/);
	assert.ok(!lines[0].includes("master")); // no branch segment without git
	component.dispose();
});

test("integration: render with git branch runs real git status", () => {
	const pi = createPi();
	extension(pi);
	const { ctx, getFooterFactory } = createContext({ branch: "master" });
	for (const fn of pi.handlers.get("session_start")) fn({}, ctx);

	const factory = getFooterFactory();
	const tui = { requestRender: () => {} };
	const theme = { fg: (color, text) => `[[${color}:${text}]]` };
	const footerData = {
		getGitBranch: () => "master",
		onBranchChange: () => () => {},
	};
	const component = factory(tui, theme, footerData);
	const lines = component.render(120);
	assert.equal(lines.length, 1);
	assert.match(lines[0], /master/);
	assert.match(lines[0], /muted:/);
	component.dispose();
});

test("integration: cwd change via tool_call triggers re-render", () => {
	const pi = createPi();
	extension(pi);
	const { ctx, getFooterFactory } = createContext({ cwd: "/a" });
	for (const fn of pi.handlers.get("session_start")) fn({}, ctx);

	const factory = getFooterFactory();
	let renders = 0;
	const tui = { requestRender: () => { renders += 1; } };
	const theme = { fg: (color, text) => `[[${color}:${text}]]` };
	const footerData = {
		getGitBranch: () => null,
		onBranchChange: () => () => {},
	};
	const component = factory(tui, theme, footerData);

	// Same cwd: no re-render.
	for (const fn of pi.handlers.get("tool_call")) fn({}, ctx);
	assert.equal(renders, 0);

	// Changed cwd: re-render requested and render() shows the new basename.
	ctx.cwd = "/b";
	for (const fn of pi.handlers.get("tool_call")) fn({}, ctx);
	assert.equal(renders, 1);
	const lines = component.render(120);
	assert.match(lines[0], /b/);
	assert.ok(!lines[0].includes("| a "));
	component.dispose();
});
