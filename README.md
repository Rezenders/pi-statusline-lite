# pi-statusline-lite

极简纯文字底部状态栏（footer）扩展，无 powerline 装饰、无背景色块。

针对 `@narumitw/pi-statusline` 在 Termux 环境下的问题（字体不支持 powerline 符号、
背景色块占地方、配置复杂）而编写。

## 显示内容

```
🐋 V4F | home | main | 12.3%/200k
```

| 段 | 内容 | 优先级（低→高丢弃） |
|----|----------------------|---------------------|
| model | 🐋 + 模型缩写（deepseek-v4-flash → V4F） | 110 |
| cwd | 当前目录 basename（跟随目录切换） | 80 |
| branch | git 分支名 + 未提交改动数（`main ~2`） | 100 |
| context | 百分比/窗口（未知时显示 ?） | 120 |

- 颜色跟随 pi 主题（`theme.fg("muted")`，浅色/深色主题自动适配），无背景色
- 段间以 ` | ` 分隔
- 宽度不足时按优先级从低到高丢弃段（响应式）
- 无 git 仓库时不显示 branch 段；有未提交改动时显示 `~N`（staged+unstaged+untracked 总数）
- cwd 变化跟随：`tool_call`/`user_bash` 事件里对比最新 `ctx.cwd`，变化即更新并重绘

## 开发

```bash
npm test          # 运行全部测试（node 内置 test runner，零依赖）
```

TDD 流程：先写 `test/core.test.mjs`，再实现 `src/core.mjs`（纯逻辑，不依赖 pi），
`src/index.ts` 只是薄封装（注册 footer）。

## 安装（开发模式）

扩展放在自动发现目录（支持 `/reload` 热重载，`settings.json` 的 `extensions` 字段只在启动时加载）：

`~/.pi/agent/extensions/pi-statusline-lite.ts`：

```ts
// Wrapper: loads the extension from the dev workspace so /reload picks up changes.
export { default } from "/data/data/com.termux/files/home/dev/pi-statusline-lite/src/index.ts";
```

然后在 pi 中执行 `/reload`。
