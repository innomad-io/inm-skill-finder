# inm-skill-finder

[English](README.md)

一个 Claude Code 技能，从多个 GitHub registry 搜索和安装技能。通过下载 README 并在本地解析技能条目，对名称和描述进行模糊匹配——不消耗 GitHub API 配额。

## 特性

- **多 registry 搜索** — 并行搜索 6 个内置 registry，覆盖 2000+ 技能
- **基于 README 解析** — 从列表和表格格式中提取技能条目，匹配名称、描述和分类
- **模糊匹配** — 用近似关键词也能找到相关技能（例如搜索 "email" 可匹配到 `sendgrid-automation`）
- **可配置 registry** — 通过命令行或配置文件添加/移除/启用/禁用 registry
- **多语言支持** — 非英文关键词会自动翻译为英文以扩大匹配范围
- **Tree API 回退** — README 解析无结果时自动回退到 GitHub Trees API
- **零 API 配额** — 通过 `raw.githubusercontent.com` 获取 README，无需 GitHub API 调用

## 安装

### 作为 Claude Code 技能安装（推荐）

```bash
# 项目级别
npx skills add innomad-io/inm-skill-finder

# 用户级别（全局）
npx skills add innomad-io/inm-skill-finder -g
```

### 手动安装

```bash
# 项目级别
mkdir -p .claude/skills/find-skill
curl -sL https://raw.githubusercontent.com/innomad-io/inm-skill-finder/main/SKILL.md -o .claude/skills/find-skill/SKILL.md
curl -sL https://raw.githubusercontent.com/innomad-io/inm-skill-finder/main/registries.json -o .claude/skills/find-skill/registries.json
mkdir -p .claude/skills/find-skill/scripts
curl -sL https://raw.githubusercontent.com/innomad-io/inm-skill-finder/main/scripts/search_github.ts -o .claude/skills/find-skill/scripts/search_github.ts
```

## 使用方法

安装后，在 Claude Code 中调用技能：

```
/find-skill email automation
/find-skill slack notification
/find-skill 数据库管理
```

Claude 会自动搜索所有 registry、展示结果并引导你完成安装。

## 内置 Registry

| Registry | 仓库 | 技能数量 |
|----------|------|---------|
| Composio | ComposioHQ/awesome-claude-skills | 940+ SaaS 自动化技能 |
| Anthropic | anthropics/skills | 官方参考技能 |
| VoltAgent | VoltAgent/awesome-agent-skills | 370+ 多工具技能 |
| Antigravity | sickn33/antigravity-awesome-skills | 856+ 通用技能 |
| rohitg00 | rohitg00/awesome-claude-code-skills | 精选技能（表格格式） |
| TerminalTrend | TerminalTrend/awesome-claude-code | 社区资源和技能 |

## Registry 管理

```bash
# 列出所有 registry
npx -y bun run scripts/search_github.ts --list-registries

# 添加自定义 registry
npx -y bun run scripts/search_github.ts --add-registry owner/repo --name "My Skills"

# 移除自定义 registry
npx -y bun run scripts/search_github.ts --remove-registry owner/repo

# 禁用 / 启用 registry
npx -y bun run scripts/search_github.ts --disable-registry composio
npx -y bun run scripts/search_github.ts --enable-registry composio
```

自定义 registry 保存在 `registries.local.json`（与 `registries.json` 格式相同），运行时合并，local 条目优先。

## 工作原理

1. 从 `registries.json` + `registries.local.json` 加载 registry 配置
2. 并行下载所有启用 registry 的 README（通过 `raw.githubusercontent.com`）
3. 解析每个 README 中的技能条目（支持列表和表格 Markdown 格式）
4. 模糊匹配关键词与名称 + 描述（描述权重 0.75x）
5. 如果 README 解析结果为空，回退到 GitHub Trees API
6. 输出去重、排序后的 JSON 结果

## 许可证

MIT
