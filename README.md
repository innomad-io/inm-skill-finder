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

**Recommended method for best compatibility:**

```bash
npx skills add innomad-io/inm-skill-finder
```

This command uses the [skills.sh](https://skills.sh) CLI tool which provides the most reliable installation experience. It automatically handles skill directory setup, file downloads, and ensures proper integration with Claude Code.

### Installation Options

```bash
# Project-level (default) — installs to .claude/skills/ in current project
npx skills add innomad-io/inm-skill-finder

# User-level (global) — installs to ~/.claude/skills/ for all projects
npx skills add innomad-io/inm-skill-finder -g
```

### Manual installation

```bash
# Project-level
mkdir -p .claude/skills/inm-skill-finder
curl -sL https://raw.githubusercontent.com/innomad-io/inm-skill-finder/main/SKILL.md -o .claude/skills/inm-skill-finder/SKILL.md
curl -sL https://raw.githubusercontent.com/innomad-io/inm-skill-finder/main/registries.json -o .claude/skills/inm-skill-finder/registries.json
mkdir -p .claude/skills/inm-skill-finder/scripts
curl -sL https://raw.githubusercontent.com/innomad-io/inm-skill-finder/main/scripts/search_github.ts -o .claude/skills/inm-skill-finder/scripts/search_github.ts
```

## Usage

Once installed, invoke the skill in Claude Code:

```
/inm-skill-finder email automation
/inm-skill-finder slack notification
/inm-skill-finder database management
```

Claude will search across all registries, present results, and guide you through installation.

## Configuration

### Quick Start

Copy the example config to customize behavior:

```bash
cp config.example.yaml config.yaml
```

### User Preferences

Set default installation behavior in `config.yaml`:

```yaml
preferences:
  # Installation method: 'npx', 'direct', 'git', or 'ask' (default: ask)
  install_method: npx  # Use npx skills add by default
  
  # Installation location: 'project', 'global', or 'ask' (default: ask)
  install_location: project  # Always install to project by default
```

When set to specific values, you won't be prompted for these choices during installation. Use `ask` to be prompted each time.

### Registry Configuration

Add or customize registries in `config.yaml` using simple GitHub URLs:

```yaml
registries:
  # Built-in registries
  - url: https://github.com/ComposioHQ/awesome-claude-skills
    enabled: true
  
  # Add your custom registries
  - url: https://github.com/your-org/your-skills
    enabled: true
    name: "My Custom Skills"  # Optional
    description: "My personal collection"  # Optional
  
  # Short format also works
  - url: owner/repo
    enabled: true
  
  # Disable a registry
  - url: https://github.com/some-org/repo
    enabled: false
```

See `config.example.yaml` for full documentation and all available options.

## Built-in Registries

| Registry | Repo | Skills |
|----------|------|--------|
| Composio | ComposioHQ/awesome-claude-skills | 940+ SaaS automation skills |
| Anthropic | anthropics/skills | Official reference skills |
| VoltAgent | VoltAgent/awesome-agent-skills | 370+ multi-tool skills |
| Antigravity | sickn33/antigravity-awesome-skills | 856+ universal skills |
| rohitg00 | rohitg00/awesome-claude-code-skills | Curated skills (table format) |
| TerminalTrend | TerminalTrend/awesome-claude-code | Community resources and skills |

## Registry Management (CLI)

For quick registry operations, you can use CLI commands (creates `registries.local.json`):

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

**Note:** Editing `config.yaml` directly is recommended for a cleaner configuration. CLI commands are provided for quick operations and backward compatibility.

## How It Works

1. Load configuration from `config.yaml` (or legacy `registries.json` + `registries.local.json`)
2. Download READMEs from all enabled registries in parallel via `raw.githubusercontent.com`
3. Parse skill entries from each README (supports list and table markdown formats)
4. Fuzzy match keywords against name + description (description weighted at 0.75x)
5. Fall back to GitHub Trees API if README parsing yields zero entries
6. Output deduplicated, scored JSON results
7. Respect user preferences for installation method and location (if configured)

## License

MIT
