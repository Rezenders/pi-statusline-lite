# HANDOFF — pi-statusline-lite

> 状态：开发中（功能可用，已验证大部分）。最后更新：2026-07-31

## 项目概览

极简纯文字底部状态栏（footer）扩展，替代 `@narumitw/pi-statusline`（在 Termux 下
问题太多：powerline 字符显示为方框、背景色块占地方、配置系统不支持模型名自定义）。

- **代码位置**：`~/dev/pi-statusline-lite/`（git 仓库，3 次提交）
- **安装方式**：`~/.pi/agent/extensions/pi-statusline-lite.ts` 包装文件（绝对路径
  re-export 开发目录，支持 `/reload` 热重载）
- **当前效果**：`🐋 V4F | pi-statusline-lite | master | 8.4%/1000k`
  （柔和灰 #b0b0b0、` | ` 分隔、无背景色、无装饰符号）

## 已完成的

### 功能
- [x] 模型缩写：`deepseek-v4-flash → V4F`（🐋 前缀；`deepseek-v4 → V4`、
      `deepseek-v3.2 → V3.2`、`deepseek-reasoner → DS reasoner` 兜底，
      claude/gpt 规则沿用原插件）
- [x] cwd 段：显示 basename
- [x] branch 段：来自 pi `footerData.getGitBranch()`（非 git 仓库时自动隐藏）
- [x] context 段：`8.4%/1000k`（无 "ctx" 前缀；未知时显示 `?`）
- [x] 响应式裁剪：宽度不足时按优先级丢段
      `context(120) > model(110) > branch(100) > cwd(80)`
- [x] 颜色：柔和灰 `#b0b0b0`（38;2;176;176;176），无背景色
- [x] 分隔符：` | `

### 工程
- [x] TDD 流程：先写测试 → 跑失败 → 实现 → 全绿
- [x] `test/core.test.mjs`：26 个用例（node:test 内置 runner，零依赖）
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

### 1. cwd 段不跟随目录切换（未解决）
- 现象：`src/index.ts` 在 `session_start` 时捕获 `ctx.cwd`，之后用户切换目录
  footer 的 cwd 段不变。
- 背景：pi 的 `FooterDataProvider` 有 `setCwd()` 会触发 `onBranchChange` 通知，
  但没有暴露"cwd 变化"事件；`ctx.ui.setFooter` 的 render 闭包拿不到新 cwd。
- 思路（未验证）：在 `before_agent_start` 或 `tool_call` 事件里对比
  `ctx.cwd` 与缓存的 cwd，变了就更新（这是最可能的可行方案）。

### 2. 验证 branch 段（进行中）
- 用户已执行 `!cd ~/dev/pi-statusline-lite`，**但这只是子 shell 的 cd**——
  pi 没有 `/cd` 命令，CLI 也没有 `--cd` 选项，pi 的 cwd 不会变。
- **验证方法**：退出 pi，在 `~/dev/pi-statusline-lite` 目录重新启动 pi，
  预期 footer 显示 `master` 分支段。

### 3. 浅色主题适配（未做）
- 颜色硬编码 `#b0b0b0`，适合 dark 主题。light 主题下需要换成深色。
- 思路：从 `setFooter((tui, theme, footerData))` 的 `theme` 参数取前景色。

### 4. git 状态增强（可选）
- 原插件有 `git-status.ts`（`main ~2` 表示 2 个未提交改动），已移除。
  如需可借鉴其逻辑加到 `core.mjs`（读 `git status --porcelain` 计数）。

## 常用命令

```bash
cd ~/dev/pi-statusline-lite
npm test                    # 跑全部测试（26 个用例）
git add -A && git commit    # 提交
```

改完代码后在 pi 里 `/reload` 即可生效（自动发现目录 + 包装文件的优势）。

## 关键文件

| 文件 | 作用 |
|------|------|
| `src/core.mjs` | 纯逻辑：shortenModel / visibleWidth / fitSegments / renderFooter |
| `src/index.ts` | pi 扩展入口（TUI footer 注册） |
| `test/core.test.mjs` | 26 个测试用例 |
| `package.json` | `npm test` = `node --test` |
| `~/.pi/agent/extensions/pi-statusline-lite.ts` | 安装包装文件（勿删） |
