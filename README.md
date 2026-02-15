# inm-skill-finder

[中文版](README.zh-CN.md)

A Claude Code skill that searches and installs skills from multiple GitHub registries. It downloads READMEs, parses skill entries locally, and performs fuzzy matching on names and descriptions — no GitHub API quota consumed.

## Features

- **Multi-registry search** — searches 6 built-in registries in parallel, covering 2000+ skills
- **README-based parsing** — extracts skill entries from list and table formats, matching against names, descriptions, and categories
- **Fuzzy matching** — finds relevant skills even with approximate keywords (e.g. searching "email" matches `sendgrid-automation`)
- **Configurable registries** — add/remove/enable/disable registries via CLI or config file
- **Multi-language support** — non-English keywords are automatically translated for broader matching
- **Tree API fallback** — falls back to GitHub Trees API when README parsing yields no entries
- **Zero API quota** — READMEs fetched via `raw.githubusercontent.com`, no GitHub API calls needed

## Installation

### As a Claude Code skill (recommended)

```bash
# Project-level
npx skills add innomad-io/inm-skill-finder

# User-level (global)
npx skills add innomad-io/inm-skill-finder -g
```

### Manual installation

```bash
# Project-level
mkdir -p .claude/skills/find-skill
curl -sL https://raw.githubusercontent.com/innomad-io/inm-skill-finder/main/SKILL.md -o .claude/skills/find-skill/SKILL.md
curl -sL https://raw.githubusercontent.com/innomad-io/inm-skill-finder/main/registries.json -o .claude/skills/find-skill/registries.json
mkdir -p .claude/skills/find-skill/scripts
curl -sL https://raw.githubusercontent.com/innomad-io/inm-skill-finder/main/scripts/search_github.ts -o .claude/skills/find-skill/scripts/search_github.ts
```

## Usage

Once installed, invoke the skill in Claude Code:

```
/find-skill email automation
/find-skill slack notification
/find-skill database management
```

Claude will search across all registries, present results, and guide you through installation.

## Built-in Registries

| Registry | Repo | Skills |
|----------|------|--------|
| Composio | ComposioHQ/awesome-claude-skills | 940+ SaaS automation skills |
| Anthropic | anthropics/skills | Official reference skills |
| VoltAgent | VoltAgent/awesome-agent-skills | 370+ multi-tool skills |
| Antigravity | sickn33/antigravity-awesome-skills | 856+ universal skills |
| rohitg00 | rohitg00/awesome-claude-code-skills | Curated skills (table format) |
| TerminalTrend | TerminalTrend/awesome-claude-code | Community resources and skills |

## Registry Management

```bash
# List all registries
npx -y bun run scripts/search_github.ts --list-registries

# Add a custom registry
npx -y bun run scripts/search_github.ts --add-registry owner/repo --name "My Skills"

# Remove a custom registry
npx -y bun run scripts/search_github.ts --remove-registry owner/repo

# Disable / enable a registry
npx -y bun run scripts/search_github.ts --disable-registry composio
npx -y bun run scripts/search_github.ts --enable-registry composio
```

Custom registries are saved to `registries.local.json` (same format as `registries.json`), which is merged at runtime with local entries taking priority.

## How It Works

1. Load registries from `registries.json` + `registries.local.json`
2. Download READMEs from all enabled registries in parallel via `raw.githubusercontent.com`
3. Parse skill entries from each README (supports list and table markdown formats)
4. Fuzzy match keywords against name + description (description weighted at 0.75x)
5. Fall back to GitHub Trees API if README parsing yields zero entries
6. Output deduplicated, scored JSON results

## License

MIT
