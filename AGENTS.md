# AGENTS.md

Instructions for AI coding agents working on this repository.

## General

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch is `main`.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Monorepo Collaboration

This repo (`codeblog`) contains the **Web forum + MCP server**. It works alongside a sibling repo:

| Repo | Path | Description |
|------|------|-------------|
| `codeblog` | `/Users/zhaoyifei/VibeCodingWork/codeblog` | Next.js Web 论坛 + MCP 服务器（本仓库） |
| `codeblog-app` | `/Users/zhaoyifei/VibeCodingWork/codeblog-app` | CLI/TUI 客户端 |

- `codeblog-app` 通过 HTTP API 与本仓库后端通信（`/api/v1/*` 端点）
- MCP 服务器在 `mcp-server/` 目录，npm 包名 `codeblog-mcp`
- 修改 API 接口或 MCP 工具时需要同步两个仓库

## ⚠️ 发布工作流（强制执行）

**每次完成功能开发或 bug 修复后，必须检查并执行发布流程。不允许跳过。**

### 发布顺序（严格按此顺序）

#### Step 1: MCP 服务器（本仓库）

如果修改了 `mcp-server/` 下的任何代码：

```bash
cd mcp-server
# 1. 更新 package.json version
# 2. 构建
npm run build
# 3. 发布
npm publish --access public
# 4. 验证
npm view codeblog-mcp version
```

#### Step 2: CLI 客户端（codeblog-app 仓库）

MCP 发布后，**必须**同步更新 CLI 客户端：

```bash
cd /Users/zhaoyifei/VibeCodingWork/codeblog-app/packages/codeblog
# 1. 更新 package.json version
# 2. 构建 5 个平台二进制 + 发布（一条命令搞定）
bun run script/build.ts --publish
# 3. 清理
rm -rf dist/
cd ../.. && git checkout -- bun.lock
# 4. 验证
npm view codeblog-app version
```

#### Step 3: 验证 curl 安装

```bash
curl -fsSL https://registry.npmjs.org/codeblog-app/latest | grep -o '"version":"[^"]*"'
```

### 5 个平台二进制包

`codeblog-app` 通过 curl 安装，依赖 5 个平台包：
- `codeblog-app-darwin-arm64`
- `codeblog-app-darwin-x64`
- `codeblog-app-linux-arm64`
- `codeblog-app-linux-x64`
- `codeblog-app-windows-x64`

由 `bun run script/build.ts --publish` 一并构建和发布。

### 完成工作后的检查清单

- [ ] 修改了 `mcp-server/` → 发布 `codeblog-mcp`
- [ ] 发布了 MCP → 同步更新并发布 `codeblog-app`（含 5 个平台二进制）
- [ ] 修改了 Web 前端/API → 部署到 Zeabur
- [ ] 验证 `npm view` 版本号正确
- [ ] 验证 curl 安装能获取最新版本
- [ ] 清理构建产物，恢复 `bun.lock`

## Web 论坛部署

- 部署平台：Zeabur
- 配置：`output: "standalone"`
- 修改 Web 前端或 API 后，推送到 `main` 分支即自动部署

## Testing

```bash
npm run lint                 # ESLint
npm run build                # 完整构建测试
cd mcp-server && npm run build  # MCP 构建测试
```
