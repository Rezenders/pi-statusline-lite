# HANDOFF — pi-statusline-lite

> 状态：开发中（功能可用，已验证大部分）。最后更新：2026-07-31

## 项目概览

极简纯文字底部状态栏（footer）扩展，替代 `@narumitw/pi-statusline`（在 Termux 下
问题太多：powerline 字符显示为方框、背景色块占地方、配置系统不支持模型名自定义）。

- **代码位置**：`~/dev/pi-statusline-lite/`（git 仓库，3 次提交）
- **安装方式**：`~/.pi/agent/extensions/pi-statusline-lite.ts` 包装文件（绝对路径
  re-export 开发目录，支持 `/reload` 热重载）
- **当前效果**：`🐋 V4F | pi-statusline-lite | master ~3 | 8.4%/1000k`
  （颜色跟随主题、` | ` 分隔、无背景色、无装饰符号）

## 已完成的

### 功能
- [x] 模型缩写：`deepseek-v4-flash → V4F`（🐋 前缀；`deepseek-v4 → V4`、
      `deepseek-v3.2 → V3.2`、`deepseek-reasoner → DS reasoner` 兜底，
      claude/gpt 规则沿用原插件）
- [x] cwd 段：显示 basename
- [x] cwd 跟随：`tool_call`/`user_bash` 事件里 `createCwdTracker().update(ctx.cwd)`，变化即重绘
- [x] branch 段：来自 pi `footerData.getGitBranch()`（非 git 仓库时自动隐藏）
- [x] git 状态：`git status --porcelain` 计数，`main ~2` 表示 2 个未提交改动（2s TTL 缓存）
- [x] context 段：`8.4%/1000k`（无 "ctx" 前缀；未知时显示 `?`）
- [x] 响应式裁剪：宽度不足时按优先级丢段
      `context(120) > model(110) > branch(100) > cwd(80)`
- [x] 颜色：跟随 pi 主题的 muted token（`theme.fg("muted")`，浅色/深色自动适配）
- [x] 分隔符：` | `

### 工程
- [x] TDD 流程：先写测试 → 跑失败 → 实现 → 全绿
- [x] `test/core.test.mjs`：53 个用例（node:test 内置 runner，零依赖）
- [x] `src/core.mjs`：纯逻辑（不依赖 pi，可直接 node 测试）
- [x] `src/index.ts`：薄封装（`session_start` → `ctx.ui.setFooter`）
- [x] git 提交历史：`0dce128`（初始）→ `64fe989`（灰/竖线/去ctx前缀）→
      `c05049e`（文档：安装方式）

## 试过什么没成功（重要教训）

1. **`settings.json` 的 `extensions` 字段 + `/reload`** → ❌ 不生效。
   文档明确：`settings.json` 里的扩展路径**只在 pi 启动时加载**，不支持热重载。
   只有 `~/.pi/agent/extensions/`（自动发现目录）里的扩展支持 `/reload`。
2. **symlink 到自动发现目录** → ❌ jiti 基于 symlink 路径解析相对导入，
   找不到 `./core.mjs`（`Cannot find module './core.mjs'`）。
   解决：用**包装文件**（真实文件 + 绝对路径 re-export）。
3. **给 `@narumitw/pi-statusline` 打补丁**（node_modules 里改源码）→ ⚠️ 能工作，
   但：配置系统不支持模型显示名覆盖（只能 prefix/suffix）；`pi update --all`
   或重装会还原补丁；Appearance 配色菜单在去背景色后完全失效。→ 放弃，自研。
4. **npm 官方 registry** → ❌ 本机网络连不上 `registry.npmjs.org`
   （ECONNRESET，TLS 被断）。**必须用镜像**：
   `npm_config_registry=https://registry.npmmirror.com pi install <pkg>`
5. **`node --test test/`（目录参数）** → ❌ Node 26 不接受目录参数。
   正确：`node --test`（自动发现 `test/` 下 `*.test.mjs`）。

## 当前已知问题 / 待办

### 0. 2026-07-31：issue-1 修复（重绘风暴）
- **TUI 层**（pi-tui 0.83.0 dist 补丁，见 `~/dev/fix/issue-1-fix.md`）：
  `firstChanged < viewportTop` 不再无条件全量重绘，clamp 到可视窗口差量重绘；
  scrollback 过期内容由下次全量重绘修正。重启 pi 生效。
- **本扩展**：
  - 0.83.0 无组件级渲染 API（无 `requestComponentRender`），改为**内容去重**：
    tool_call/user_bash / onBranchChange 先重算 footer 行，与上次渲染内容不同才
    调一次 `tui.requestRender()`（事件洪泛不再触发渲染）。
  - `render()` 恒定返回 1 行（空内容返回 `[""]` 占位），避免行数变化扩大 TUI diff 范围。
  - 启动自检：`session_start` 时检查 pi-tui 的 issue-1 补丁标记，缺失且无上游
    alt-screen 时 `ui.notify` 警告。**默认关闭**（开源友好）：
    `PI_ISSUE1_SELFCHECK=1 pi` 启用；路径从 `which pi` 自动推导，可用
    `PI_TUI_DIST` 覆盖。
  - 57 个测试全绿，真实会话冒烟通过。
- **更新防护**：`pi update` 会覆盖 dist 补丁 → 每次更新后跑一次
  `~/dev/fix/patch-kit/reapply.sh`（幂等、dry-run 保护、自动回滚）；
  上游 `--alt` 发布后脚本自动检测并跳过。详见 `~/dev/fix/issue-1-fix.md` 第 8 节。

### 1. git 状态刷新时机（轻微）
- `git status --porcelain` 在 render 时执行（2s TTL 缓存），文件改动后最多延迟 2s 反映。
  工具执行（tool_call）不触发 render，仅分支切换/窗口事件触发。可接受的折衷。

### 2. 浅色主题验证（未验证）
- 颜色已改用 `theme.fg("muted")` 跟随主题，但本机未配置浅色主题，实际效果未目验。
  理论上浅色主题的 muted token 为深色。

## 常用命令

```bash
cd ~/dev/pi-statusline-lite
npm test                    # 跑全部测试（53 个用例）
git add -A && git commit    # 提交
```

改完代码后在 pi 里 `/reload` 即可生效（自动发现目录 + 包装文件的优势）。

## 关键文件

| 文件 | 作用 |
|------|------|
| `src/core.mjs` | 纯逻辑：shortenModel / visibleWidth / fitSegments / renderFooter / createCwdTracker / parseGitStatus / formatGitBranch |
| `src/index.ts` | pi 扩展入口（TUI footer 注册、cwd 事件跟随、git 执行） |
| `test/core.test.mjs` | 53 个测试用例 |
| `package.json` | `npm test` = `node --test` |
| `~/.pi/agent/extensions/pi-statusline-lite.ts` | 安装包装文件（勿删） |
