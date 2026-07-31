# pi-statusline-lite

[![test](https://github.com/Hariketsu/pi-statusline-lite/actions/workflows/test.yml/badge.svg)](https://github.com/Hariketsu/pi-statusline-lite/actions/workflows/test.yml)

A minimal plain-text footer (statusline) for [pi](https://github.com/earendil-works/pi).
No powerline decorations, no background color blocks — just text.

Written as a lean replacement for `@narumitw/pi-statusline` for environments
where powerline glyphs are unsupported (e.g. Termux) and configuration should
stay simple.

```
🐋 V4F | home | main | 12.3%/200k
```

## Features

- **model** — shortened model id (`deepseek-v4-flash` → `V4F`, `claude-sonnet-4-5` → `sonnet-4-5`, …)
- **cwd** — basename of the current directory, follows `tool_call`/`user_bash` events
- **branch** — git branch name with dirty count (`main ~2` = staged+unstaged+untracked), hidden outside git repos
- **context** — context window usage (`12.3%/200k`, `?` when unknown)
- Theme-aware: follows pi's `muted` token, adapts to light/dark themes, no background
- Responsive: when the width is too small, segments are dropped lowest-priority first
  (`context(120) > model(110) > branch(100) > cwd(80)`)
- Zero runtime dependencies; `node --test` based test suite (57 cases)

## Requirements

- pi 0.8x (TUI mode)
- Node.js >= 18

## Installation

```sh
git clone https://github.com/Hariketsu/pi-statusline-lite
cd pi-statusline-lite
pi install .            # register with pi (settings.json)
```

Restart pi. To verify it is loaded, the footer should appear at the bottom of
the TUI.

### Manual / development mode (hot-reload)

Put a wrapper file in pi's auto-discovery directory (supports `/reload`,
unlike `settings.json` entries which are only loaded at startup):

`~/.pi/agent/extensions/pi-statusline-lite.ts`:

```ts
// Wrapper: loads the extension from the dev workspace so /reload picks up changes.
export { default } from "/absolute/path/to/pi-statusline-lite/src/index.ts";
```

Then run `/reload` inside pi.

## Development

```sh
npm test    # node --test — zero dependencies
```

- `src/core.ts` — pure logic (model shortening, width fitting, git parsing), no pi imports, fully unit-tested
- `src/index.ts` — thin wrapper wiring the footer into pi's `ctx.ui.setFooter`
- `test/integration.test.mjs` — drives the extension through a simulated pi runtime

## License

[MIT](./LICENSE)
