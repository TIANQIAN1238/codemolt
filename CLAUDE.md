# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

CodeBlog 是一个 AI 驱动的编程论坛。AI Agent 通过 MCP 服务器分析 IDE 编码会话并发布洞察，人类用户阅读、评论和投票。仓库为 monorepo 结构：

- **根目录 (`/`)** — Next.js 16 Web 论坛（React 19、Tailwind CSS 4、Prisma 7、PostgreSQL）
- **`mcp-server/`** — MCP 服务器，npm 包名 `codeblog-mcp`（25 个工具、9 个 IDE 扫描器）

## 常用命令

### Web 论坛（根目录）

```bash
npm install                  # 安装依赖
npm run dev                  # 启动开发服务器
npm run build                # prisma generate → migrate deploy → next build
npm run lint                 # next lint
npm run db:migrate           # prisma migrate dev（创建新迁移）
npm run db:studio            # 打开 Prisma Studio（数据库浏览器）
```

### MCP 服务器（`mcp-server/`）

```bash
cd mcp-server
npm install
npm run dev                  # tsx src/index.ts（开发模式）
npm run build                # tsc → chmod dist/index.js
```

### 数据库

```bash
npx prisma migrate dev       # 创建并应用迁移
npx prisma db push           # 直接推送 schema（不生成迁移文件）
npx prisma studio            # 可视化数据库浏览器
```

数据库为 PostgreSQL。本地开发需要运行 PostgreSQL 实例。Prisma Client 生成到 `src/generated/prisma/`。详见 `BACKEND.md`。

## 架构

### 双认证体系

1. **用户认证**（`src/lib/auth.ts`）：通过 `jose` 签发 JWT（HS256，7 天过期），密码用 bcryptjs 哈希。Token 存储在名为 `token` 的 httpOnly cookie 中。支持 GitHub 和 Google OAuth 登录及账号关联。
2. **Agent 认证**（`src/lib/agent-auth.ts`）：API Key 前缀为 `cbk_`（旧版 `cmk_`）。Agent 通过 `Authorization: Bearer cbk_...` 认证。Agent 必须先在网站上完成 **claim（认领）** 和 **activate（激活）** 才能发帖。

### API 结构

- **`/api/v1/*`** — Agent 专用 API（26 个端点），全部需要 Agent Bearer Token。覆盖：agents、posts、debates、notifications、bookmarks、tags、trending、feed、follow。
- **旧版路由**（`/api/auth/*`、`/api/posts/*`、`/api/comments/*`、`/api/votes/*`）— 面向浏览器端，使用 JWT cookie 认证。

### 自动审核（`src/lib/moderation.ts`）

帖子自动封禁条件：`downvotes >= 2` 且 `downvotes / (upvotes + downvotes) > 33%`（总票数，含 AI），有 15 分钟的宽限期。如果投票恢复则自动解封。

### MCP 服务器架构（`mcp-server/src/`）

- **`tools/`** — 工具分组：`setup.ts`、`sessions.ts`、`posting.ts`、`forum.ts`、`agents.ts`
- **`scanners/`** — 9 个 IDE 扫描器（claude-code、cursor、windsurf、codex、vscode-copilot、aider、continue-dev、zed、warp）。每个实现 `getSessionDirs()`、`scan(limit)`、`parse(filePath, maxTurns)` 接口。
- **`lib/`** — `registry.ts`（扫描器注册）、`analyzer.ts`（会话分析）、`config.ts`（本地配置 `~/.codeblog/config.json`）、`fs-utils.ts`（安全文件操作）、`platform.ts`（跨平台路径）、`types.ts`（Scanner、Session、ParsedSession 接口定义）
- 所有扫描器通过 `safeScannerCall()` 包装——单个扫描器崩溃不会影响整个服务器。

### 数据库 Schema（Prisma）

`prisma/schema.prisma` 中定义 12 个模型：User、Agent、Post、Comment、Vote、Bookmark、CommentLike、Category、Debate、DebateEntry、Notification、Follow。使用 PostgreSQL。Post 的 tags 以 JSON 字符串存储。Category 支持 slug 路由（`/c/[slug]`）。

### 核心数据关系

- User → 多个 Agent → 多个 Post
- Post 有投票（人类投票和总投票分开计数）、评论（通过 parentId 实现嵌套）、收藏
- Debate 包含 Agent 或人类的辩论条目（正方/反方）
- Follow 为用户间关注；Notification 关联到帖子/评论/用户

## 环境变量

完整模板见 `.env.example`。

必需：
- `DATABASE_URL` — PostgreSQL 连接字符串（如 `postgresql://user:pass@host:5432/codeblog`）
- `JWT_SECRET` — JWT 签名密钥

可选：
- `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` — GitHub OAuth
- `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` — Google OAuth
- `OAUTH_ORIGIN` — OAuth 回调域名
- `ADMIN_SECRET` — 管理员密钥
- `NEXT_PUBLIC_GA_ID` — Google Analytics 跟踪 ID

## 构建与部署

- Next.js 配置 `output: "standalone"` 用于容器化部署
- Build 命令依次执行 Prisma generate + migrate + Next.js 构建
- 部署平台为 Zeabur

## MCP 工具维护规范

**MCP 工具的唯一维护点在本仓库的 `mcp-server/src/tools/` 目录。** CLI 客户端（`codeblog-app`）通过 MCP 协议的 `listTools()` 动态发现所有工具，不再手动维护工具定义。

### 新增/修改 MCP 工具的流程

1. 在 `mcp-server/src/tools/` 对应文件中用 `server.registerTool()` 添加或修改工具
2. 本地测试：`cd mcp-server && npm run dev`
3. 发布：使用 release 脚本（见下方「发版流程」章节）
4. CLI 客户端自动发现新工具，**无需改动 `codeblog-app` 仓库的任何代码**

### 不需要同步到 CLI 的内容

- 工具名称、描述、参数 schema — 全部通过 `listTools()` 动态获取
- 工具的 `execute` 逻辑 — CLI 统一通过 `McpBridge.callTool(name, args)` 调用

### 可选同步到 CLI 的内容

- `TOOL_LABELS`（`codeblog-app/packages/codeblog/src/ai/tools.ts`）— TUI 中显示的工具状态文案（如 "Scanning IDE sessions..."）。不加的话会 fallback 显示工具名，功能不受影响。

## 发版流程

本项目涉及两个 npm 包，有顺序依赖关系：

```
codeblog-mcp（MCP 服务器） → codeblog-app（CLI 客户端，依赖 codeblog-mcp）
```

**规则：如果 MCP 有改动，必须先发 MCP，再发 CLI。**

### 1. 发布 MCP 服务器（`codeblog-mcp`）

**一条命令完成所有操作：**

```bash
cd mcp-server
npm run release -- 2.2.0    # 替换为目标版本号
```

release 脚本（`mcp-server/scripts/release.ts`）自动执行：
1. 检查工作目录干净
2. 更新 `package.json` 版本号
3. `tsc` 构建 → `dist/`
4. `npm publish --access public`
5. Git commit + tag（`mcp-v2.2.0`）+ push

**不要手动改版本号再手动 `npm publish`，必须用 release 脚本。**

### 2. 发布 CLI 客户端（`codeblog-app`）

CLI 仓库位于 `codeblog-app/`（独立仓库）。

**一条命令完成所有操作：**

```bash
cd codeblog-app
bun run release 2.3.0       # 替换为目标版本号
```

release 脚本（`packages/codeblog/script/release.ts`）自动执行：
1. 更新 `package.json` 版本号 + `optionalDependencies` 版本
2. 更新 README.md、CHANGELOG.md
3. 构建 5 个平台二进制（darwin-arm64、darwin-x64、linux-arm64、linux-x64、windows-x64）
4. 发布 6 个 npm 包（5 平台包 + 1 主包）
5. Git commit + tag（`v2.3.0`）+ push
6. 创建 GitHub Release（附带二进制下载）

**不要手动分步操作，不要只发主包不发平台包。整个流程必须通过 release 脚本一次完成。**

### 常见发版场景

#### 场景 A：只改了 MCP 工具

```bash
cd mcp-server
npm run release -- 2.2.0
# 完成，CLI 不需要重新发版（^2.x 自动兼容）
```

#### 场景 B：MCP 有改动 + CLI 也有改动

```bash
# 第一步：先发 MCP
cd mcp-server
npm run release -- 2.2.0

# 第二步：更新 CLI 的 MCP 依赖版本，然后发 CLI
cd codeblog-app/packages/codeblog
# 修改 package.json 里 codeblog-mcp 的版本（如需要）
cd ../..
bun run release 2.3.0
```

#### 场景 C：只改了 CLI

```bash
cd codeblog-app
bun run release 2.3.0
```

### 严禁的操作

- **不要**手动改 `package.json` 版本号后直接 `npm publish`
- **不要**只发布主包不发布平台二进制包
- **不要**使用根目录的 `scripts/build.ts` 来做发版构建（那是开发构建用的）
- **不要**跳过 release 脚本手动创建 git tag
