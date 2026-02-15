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

**推荐安装方式，以获得最佳兼容性：**

```bash
npx skills add innomad-io/inm-skill-finder
```

此命令使用 [skills.sh](https://skills.sh) CLI 工具，提供最可靠的安装体验。它会自动处理技能目录设置、文件下载，并确保与 Claude Code 正确集成。

### 安装选项

```bash
# 项目级别（默认）— 安装到当前项目的 .claude/skills/ 目录
npx skills add innomad-io/inm-skill-finder

# 用户级别（全局）— 安装到 ~/.claude/skills/ 供所有项目使用
npx skills add innomad-io/inm-skill-finder -g
```

### 手动安装

```bash
# 项目级别
mkdir -p .claude/skills/inm-skill-finder
curl -sL https://raw.githubusercontent.com/innomad-io/inm-skill-finder/main/SKILL.md -o .claude/skills/inm-skill-finder/SKILL.md
curl -sL https://raw.githubusercontent.com/innomad-io/inm-skill-finder/main/registries.json -o .claude/skills/inm-skill-finder/registries.json
mkdir -p .claude/skills/inm-skill-finder/scripts
curl -sL https://raw.githubusercontent.com/innomad-io/inm-skill-finder/main/scripts/search_github.ts -o .claude/skills/inm-skill-finder/scripts/search_github.ts
```

## 使用方法

安装后，在 Claude Code 中调用技能：

```
/inm-skill-finder email automation
/inm-skill-finder slack notification
/inm-skill-finder 数据库管理
```

Claude 会自动搜索所有 registry、展示结果并引导你完成安装。

## 配置

### 快速开始

复制示例配置文件进行自定义：

```bash
cp config.example.yaml config.yaml
```

### 用户偏好设置

在 `config.yaml` 中设置默认安装行为：

```yaml
preferences:
  # 安装方式：'npx', 'direct', 'git', 或 'ask'（默认：ask）
  install_method: npx  # 默认使用 npx skills add
  
  # 安装位置：'project', 'global', 或 'ask'（默认：ask）
  install_location: project  # 默认安装到项目级别
```

设置为具体值后，安装时不会再询问这些选项。使用 `ask` 则每次都会询问。

### Registry 配置

在 `config.yaml` 中使用简单的 GitHub URL 添加或自定义 registry：

```yaml
registries:
  # 内置 registry
  - url: https://github.com/ComposioHQ/awesome-claude-skills
    enabled: true
  
  # 添加自定义 registry
  - url: https://github.com/your-org/your-skills
    enabled: true
    name: "我的自定义技能"  # 可选
    description: "我的个人技能集合"  # 可选
  
  # 短格式也可以
  - url: owner/repo
    enabled: true
  
  # 禁用某个 registry
  - url: https://github.com/some-org/repo
    enabled: false
```

完整文档和所有可用选项请查看 `config.example.yaml`。

## 内置 Registry

| Registry | 仓库 | 技能数量 |
|----------|------|---------|
| Composio | ComposioHQ/awesome-claude-skills | 940+ SaaS 自动化技能 |
| Anthropic | anthropics/skills | 官方参考技能 |
| VoltAgent | VoltAgent/awesome-agent-skills | 370+ 多工具技能 |
| Antigravity | sickn33/antigravity-awesome-skills | 856+ 通用技能 |
| rohitg00 | rohitg00/awesome-claude-code-skills | 精选技能（表格格式） |
| TerminalTrend | TerminalTrend/awesome-claude-code | 社区资源和技能 |

## Registry 管理（命令行）

快速 registry 操作可使用命令行命令（会创建 `registries.local.json`）：

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

**注意：** 推荐直接编辑 `config.yaml` 以获得更清晰的配置。CLI 命令用于快速操作和向后兼容。

## 工作原理

1. 从 `config.yaml` 加载配置（或旧版 `registries.json` + `registries.local.json`）
2. 并行下载所有启用 registry 的 README（通过 `raw.githubusercontent.com`）
3. 解析每个 README 中的技能条目（支持列表和表格 Markdown 格式）
4. 模糊匹配关键词与名称 + 描述（描述权重 0.75x）
5. 如果 README 解析结果为空，回退到 GitHub Trees API
6. 输出去重、排序后的 JSON 结果
7. 遵循用户配置的安装方式和位置偏好（如已配置）

## 许可证

MIT
