#!/usr/bin/env bun
/**
 * Search GitHub skill registries via README parsing + local fuzzy search.
 *
 * Downloads READMEs from configured registries (via raw.githubusercontent.com,
 * no API quota), parses skill entries, and performs fuzzy matching on
 * name + description + category. Falls back to GitHub Trees API when
 * README parsing yields no results.
 *
 * Configuration:
 *   config.yaml — unified YAML config (preferences + registries, committed to git)
 *   (Legacy: registries.json + registries.local.json still supported)
 *
 * Usage:
 *   npx -y bun run scripts/search_github.ts keyword1 keyword2
 *   npx -y bun run scripts/search_github.ts --list-registries
 *   npx -y bun run scripts/search_github.ts --add-registry owner/repo --name "My Skills"
 *   npx -y bun run scripts/search_github.ts --remove-registry owner/repo
 *   npx -y bun run scripts/search_github.ts --disable-registry composio
 *   npx -y bun run scripts/search_github.ts --enable-registry composio
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { parse as parseYAML } from "yaml";

// --- Types ---

interface Registry {
  id: string;
  repo: string;
  name: string;
  description: string;
  enabled: boolean;
}

interface RegistryConfig {
  registries: Registry[];
}

interface YAMLRegistrySimple {
  url: string;
  enabled?: boolean;
  name?: string;
  description?: string;
}

interface YAMLConfig {
  preferences?: {
    install_method?: 'npx' | 'direct' | 'git' | 'ask';
    install_location?: 'project' | 'global' | 'ask';
  };
  registries?: YAMLRegistrySimple[];
}

interface SkillEntry {
  name: string;
  description: string;
  category: string;
  url: string;
  source: string;
}

interface SkillResult {
  name: string;
  source: string;
  score: number;
  url: string;
  raw_url: string;
  branch: string;
  path: string;
  description?: string;
  category?: string;
}

interface GitHubTreeItem {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
}

interface SearchOutput {
  keywords: string[];
  total: number;
  results: SkillResult[];
}

interface CLIArgs {
  keywords: string[];
  descriptions: boolean;
  threshold: number;
  listRegistries: boolean;
  showPreferences: boolean;
  addRegistry: string | null;
  removeRegistry: string | null;
  enableRegistry: string | null;
  disableRegistry: string | null;
  registryName: string | null;
}

// --- Configuration ---

const MAX_RESULTS = 30;
const FETCH_TIMEOUT = 20_000;
const DESC_WEIGHT = 0.75;

const SCRIPT_DIR = dirname(resolve(process.argv[1] || __filename));
const BASE_DIR = resolve(SCRIPT_DIR, "..");
const CONFIG_PATH = resolve(BASE_DIR, "config.yaml");
const REGISTRIES_PATH = resolve(BASE_DIR, "registries.json");
const LOCAL_REGISTRIES_PATH = resolve(BASE_DIR, "registries.local.json");

function normalizeGitHubURL(url: string): string {
  const match = url.match(/github\.com[/:]([\w-]+)\/([\w.-]+)/);
  if (match) {
    return `${match[1]}/${match[2].replace(/\.git$/, '')}`;
  }
  if (url.includes('/') && !url.includes('github.com')) {
    return url.replace(/\.git$/, '');
  }
  return url;
}

function registryIDFromRepo(repo: string): string {
  return repo.replace(/\//g, '-').toLowerCase();
}

// --- Registry loading ---

function loadRegistries(): Registry[] {
  let registries: Registry[] = [];

  if (existsSync(CONFIG_PATH)) {
    try {
      const yamlContent = readFileSync(CONFIG_PATH, "utf-8");
      const config: YAMLConfig = parseYAML(yamlContent);
      
      if (config.registries) {
        registries = config.registries.map((r) => {
          const repo = normalizeGitHubURL(r.url);
          const id = registryIDFromRepo(repo);
          return {
            id,
            repo,
            name: r.name || repo,
            description: r.description || "",
            enabled: r.enabled !== false,
          };
        });
      }
      return registries;
    } catch (e) {
      console.error(
        JSON.stringify({ warning: `Failed to parse config.yaml: ${(e as Error).message}` })
      );
    }
  }

  if (existsSync(REGISTRIES_PATH)) {
    try {
      const data: RegistryConfig = JSON.parse(
        readFileSync(REGISTRIES_PATH, "utf-8")
      );
      registries = data.registries || [];
    } catch (e) {
      console.error(
        JSON.stringify({ warning: `Failed to parse registries.json: ${(e as Error).message}` })
      );
    }
  }

  if (existsSync(LOCAL_REGISTRIES_PATH)) {
    try {
      const local: RegistryConfig = JSON.parse(
        readFileSync(LOCAL_REGISTRIES_PATH, "utf-8")
      );
      const localRegs = local.registries || [];
      const merged = new Map<string, Registry>();
      for (const r of registries) merged.set(r.id, r);
      for (const r of localRegs) merged.set(r.id, r);
      registries = Array.from(merged.values());
    } catch (e) {
      console.error(
        JSON.stringify({ warning: `Failed to parse registries.local.json: ${(e as Error).message}` })
      );
    }
  }

  return registries;
}

function loadPreferences(): YAMLConfig['preferences'] | null {
  if (!existsSync(CONFIG_PATH)) return null;
  
  try {
    const yamlContent = readFileSync(CONFIG_PATH, "utf-8");
    const config: YAMLConfig = parseYAML(yamlContent);
    return config.preferences || null;
  } catch {
    return null;
  }
}

function saveLocalRegistries(registries: Registry[]): void {
  const config: RegistryConfig = { registries };
  writeFileSync(LOCAL_REGISTRIES_PATH, JSON.stringify(config, null, 2) + "\n");
}

function loadLocalRegistries(): Registry[] {
  if (!existsSync(LOCAL_REGISTRIES_PATH)) return [];
  try {
    const data: RegistryConfig = JSON.parse(
      readFileSync(LOCAL_REGISTRIES_PATH, "utf-8")
    );
    return data.registries || [];
  } catch {
    return [];
  }
}

// --- HTTP helpers ---

const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

async function githubFetch<T>(url: string): Promise<T | null> {
  const headers: Record<string, string> = {
    "User-Agent": "skill-finder/1.0",
    Accept: "application/vnd.github+json",
  };
  if (ghToken) headers.Authorization = `Bearer ${ghToken}`;

  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!res.ok) {
      if (res.status === 403) {
        console.error(
          JSON.stringify({
            warning:
              "GitHub API rate limit reached. Set GITHUB_TOKEN or GH_TOKEN for higher limits.",
          })
        );
      }
      return null;
    }
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function rawFetch(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "skill-finder/1.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// --- README parsing ---

/**
 * Parse skill entries from a README. Supports 3 formats:
 * 1. List: `- [name](url) - description`
 * 2. Table: `| [name](url) | description |`
 * 3. Mixed list: `- **name** - description` or `- [name](url): description`
 */
function parseReadme(content: string, repoSlug: string): SkillEntry[] {
  const entries: SkillEntry[] = [];
  const lines = content.split("\n");
  let currentCategory = "";

  for (const line of lines) {
    // Track headings as category
    const headingMatch = line.match(/^#{1,4}\s+(.+)/);
    if (headingMatch) {
      const heading = headingMatch[1].trim();
      // Skip generic headings
      if (
        !/^(table of contents|contributing|license|acknowledgment|getting started|installation|usage|about)/i.test(
          heading
        )
      ) {
        currentCategory = heading.replace(/[*_`]/g, "");
      }
      continue;
    }

    // Format 1: List with link — `- [name](url) - description` or `* [name](url) — description`
    const listLinkMatch = line.match(
      /^[\s]*[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*[-–—:]\s*(.+)/
    );
    if (listLinkMatch) {
      const href = listLinkMatch[2].trim();
      if (href.startsWith("#")) continue; // skip anchor-only links (TOC entries)
      entries.push({
        name: listLinkMatch[1].trim(),
        url: resolveUrl(href, repoSlug),
        description: listLinkMatch[3].trim(),
        category: currentCategory,
        source: repoSlug,
      });
      continue;
    }

    // Format 1b: List with link, no description — `- [name](url)`
    const listLinkOnlyMatch = line.match(
      /^[\s]*[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*$/
    );
    if (listLinkOnlyMatch) {
      const href = listLinkOnlyMatch[2].trim();
      if (href.startsWith("#")) continue; // skip anchor-only links (TOC entries)
      entries.push({
        name: listLinkOnlyMatch[1].trim(),
        url: resolveUrl(href, repoSlug),
        description: "",
        category: currentCategory,
        source: repoSlug,
      });
      continue;
    }

    // Format 2: Table row — `| [name](url) | description |` or `| name | description | url |`
    if (line.includes("|") && !line.match(/^[\s]*\|[\s-:|]+\|[\s]*$/)) {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length >= 2) {
        // Check if first cell has a link
        const cellLinkMatch = cells[0].match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (cellLinkMatch) {
          const href = cellLinkMatch[2].trim();
          if (href.startsWith("#")) continue; // skip anchor-only links
          const desc = cells
            .slice(1)
            .map((c) => c.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim())
            .filter((c) => c && !c.match(/^[\s-:|]+$/))
            .join(" — ");
          entries.push({
            name: cellLinkMatch[1].trim(),
            url: resolveUrl(href, repoSlug),
            description: desc,
            category: currentCategory,
            source: repoSlug,
          });
          continue;
        }
        // Check if any cell has a link
        for (let i = 0; i < cells.length; i++) {
          const innerMatch = cells[i].match(/\[([^\]]+)\]\(([^)]+)\)/);
          if (innerMatch) {
            const href = innerMatch[2].trim();
            if (href.startsWith("#")) break; // skip anchor-only links
            const otherCells = cells
              .filter((_, j) => j !== i)
              .map((c) => c.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim())
              .filter((c) => c && !c.match(/^[\s-:|]+$/));
            entries.push({
              name: innerMatch[1].trim(),
              url: resolveUrl(href, repoSlug),
              description: otherCells.join(" — "),
              category: currentCategory,
              source: repoSlug,
            });
            break;
          }
        }
      }
    }
  }

  return entries;
}

function resolveUrl(url: string, repoSlug: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  // Relative path — make absolute to GitHub
  const clean = url.replace(/^\.\//, "");
  return `https://github.com/${repoSlug}/tree/main/${clean}`;
}

// --- Fuzzy matching ---

function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  const lenA = a.length;
  const lenB = b.length;
  if (!lenA || !lenB) return 0;

  let prev = Array.from({ length: lenB + 1 }, (_, j) => j);
  let curr = new Array(lenB + 1);

  for (let i = 1; i <= lenA; i++) {
    curr[0] = i;
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return 1 - prev[lenB] / Math.max(lenA, lenB);
}

function fuzzyScore(keywords: string[], name: string, description?: string): number {
  const nameScore = fuzzyScoreField(keywords, name);
  if (!description) return nameScore;

  const descScore = fuzzyScoreField(keywords, description) * DESC_WEIGHT;
  return Math.max(nameScore, descScore);
}

function fuzzyScoreField(keywords: string[], text: string): number {
  const textClean = text.toLowerCase().replace(/[-_]/g, " ");
  const textParts = textClean.split(/\s+/).filter(Boolean);
  let best = 0;

  for (const rawKw of keywords) {
    const kw = rawKw.toLowerCase().trim();
    if (!kw) continue;

    // Exact full match
    if (kw === textClean || kw === text.toLowerCase()) return 1.0;

    // Keyword is substring of text
    if (textClean.includes(kw)) {
      best = Math.max(best, 0.9);
      continue;
    }

    // Text is substring of keyword
    if (kw.includes(textClean)) {
      best = Math.max(best, 0.7);
      continue;
    }

    // Part-level matching
    for (const part of textParts) {
      if (kw === part) {
        best = Math.max(best, 0.95);
      } else if (part.includes(kw)) {
        best = Math.max(best, 0.85);
      } else if (kw.includes(part)) {
        best = Math.max(best, 0.65);
      } else {
        const sim = levenshteinSimilarity(kw, part);
        if (sim > 0.6) {
          best = Math.max(best, sim * 0.75);
        }
      }
    }
  }

  return Math.round(best * 1000) / 1000;
}

// --- Tree API fallback ---

async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  const data = await githubFetch<{ default_branch?: string }>(
    `https://api.github.com/repos/${owner}/${repo}`
  );
  return data?.default_branch ?? "main";
}

async function getRepoTree(
  owner: string,
  repo: string,
  branch: string
): Promise<GitHubTreeItem[]> {
  const data = await githubFetch<{
    tree?: GitHubTreeItem[];
    truncated?: boolean;
  }>(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
  );
  if (data?.truncated) {
    console.error(
      JSON.stringify({ warning: `Tree for ${owner}/${repo} was truncated` })
    );
  }
  return data?.tree ?? [];
}

function findSkillDirs(tree: GitHubTreeItem[]): Map<string, string> {
  const skills = new Map<string, string>();
  for (const item of tree) {
    const p = item.path;
    if (p.toUpperCase().endsWith("/SKILL.MD") && item.type === "blob") {
      const dirPath = p.slice(0, p.lastIndexOf("/"));
      const name = dirPath.includes("/")
        ? dirPath.slice(dirPath.lastIndexOf("/") + 1)
        : dirPath;
      skills.set(name, dirPath);
    } else if (p.toUpperCase() === "SKILL.MD" && item.type === "blob") {
      skills.set("(root)", "");
    }
  }
  return skills;
}

function extractDescription(raw: string): string {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return "";
  const dm = m[1].match(/description:\s*["']?(.*?)["']?\s*$/m);
  return dm ? dm[1].trim().replace(/^["']|["']$/g, "") : "";
}

async function searchRepoViaTree(
  owner: string,
  repo: string,
  keywords: string[],
  fetchDescriptions: boolean,
  threshold: number
): Promise<SkillResult[]> {
  const branch = await getDefaultBranch(owner, repo);
  const tree = await getRepoTree(owner, repo, branch);
  if (!tree.length) return [];

  const skillDirs = findSkillDirs(tree);
  const results: SkillResult[] = [];

  for (const [name, path] of skillDirs) {
    if (name.startsWith(".") || name === "template" || name === "template-skill")
      continue;

    const score = fuzzyScore(keywords, name);
    if (score < threshold) continue;

    const skillUrl = path
      ? `https://github.com/${owner}/${repo}/tree/${branch}/${path}`
      : `https://github.com/${owner}/${repo}`;
    const rawUrl = path
      ? `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}/SKILL.md`
      : `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/SKILL.md`;

    results.push({
      name,
      source: `${owner}/${repo}`,
      score,
      url: skillUrl,
      raw_url: rawUrl,
      branch,
      path,
    });
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, MAX_RESULTS);

  if (fetchDescriptions) {
    await Promise.all(
      top.slice(0, 10).map(async (r) => {
        const content = await rawFetch(r.raw_url);
        if (content) {
          const desc = extractDescription(content);
          if (desc) r.description = desc;
        }
      })
    );
  }

  return top;
}

// --- Main search via README ---

async function searchRegistryViaReadme(
  registry: Registry,
  keywords: string[],
  threshold: number
): Promise<{ results: SkillResult[]; fallback: boolean }> {
  const [owner, repo] = registry.repo.split("/");
  const readmeUrls = [
    `https://raw.githubusercontent.com/${registry.repo}/main/README.md`,
    `https://raw.githubusercontent.com/${registry.repo}/master/README.md`,
  ];

  let readmeContent: string | null = null;
  let usedBranch = "main";

  for (const url of readmeUrls) {
    readmeContent = await rawFetch(url);
    if (readmeContent) {
      usedBranch = url.includes("/main/") ? "main" : "master";
      break;
    }
  }

  if (!readmeContent) {
    // Fallback to Tree API
    const treeResults = await searchRepoViaTree(
      owner,
      repo,
      keywords,
      true,
      threshold
    );
    return { results: treeResults, fallback: true };
  }

  const entries = parseReadme(readmeContent, registry.repo);

  // If README parsed but yielded no entries, fallback to Tree API
  if (entries.length === 0) {
    const treeResults = await searchRepoViaTree(
      owner,
      repo,
      keywords,
      true,
      threshold
    );
    return { results: treeResults, fallback: true };
  }

  // Score and filter
  const results: SkillResult[] = [];
  for (const entry of entries) {
    const combinedDesc = [entry.description, entry.category]
      .filter(Boolean)
      .join(" ");
    const score = fuzzyScore(keywords, entry.name, combinedDesc);
    if (score < threshold) continue;

    results.push({
      name: entry.name,
      source: registry.repo,
      score,
      url: entry.url,
      raw_url: entry.url,
      branch: usedBranch,
      path: "",
      description: entry.description || undefined,
      category: entry.category || undefined,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return { results: results.slice(0, MAX_RESULTS), fallback: false };
}

// --- CLI ---

function parseArgs(argv: string[]): CLIArgs {
  const keywords: string[] = [];
  let descriptions = false;
  let threshold = 0.4;
  let listRegistries = false;
  let showPreferences = false;
  let addRegistry: string | null = null;
  let removeRegistry: string | null = null;
  let enableRegistry: string | null = null;
  let disableRegistry: string | null = null;
  let registryName: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list-registries") {
      listRegistries = true;
    } else if (arg === "--show-preferences") {
      showPreferences = true;
    } else if (arg === "--add-registry" && i + 1 < argv.length) {
      addRegistry = argv[++i];
    } else if (arg === "--remove-registry" && i + 1 < argv.length) {
      removeRegistry = argv[++i];
    } else if (arg === "--enable-registry" && i + 1 < argv.length) {
      enableRegistry = argv[++i];
    } else if (arg === "--disable-registry" && i + 1 < argv.length) {
      disableRegistry = argv[++i];
    } else if (arg === "--name" && i + 1 < argv.length) {
      registryName = argv[++i];
    } else if (arg === "--descriptions") {
      descriptions = true;
    } else if (arg === "--threshold" && i + 1 < argv.length) {
      threshold = parseFloat(argv[++i]);
    } else if (!arg.startsWith("--")) {
      keywords.push(arg);
    }
  }

  return {
    keywords,
    descriptions,
    threshold,
    listRegistries,
    showPreferences,
    addRegistry,
    removeRegistry,
    enableRegistry,
    disableRegistry,
    registryName,
  };
}

// --- Subcommands ---

function cmdListRegistries(): void {
  const registries = loadRegistries();
  const output = registries.map((r) => ({
    id: r.id,
    repo: r.repo,
    name: r.name,
    description: r.description,
    enabled: r.enabled,
  }));
  console.log(JSON.stringify({ registries: output }, null, 2));
}

function cmdAddRegistry(repo: string, name: string | null): void {
  if (!repo.includes("/")) {
    console.log(
      JSON.stringify({ error: "Registry repo must be in 'owner/repo' format" })
    );
    process.exit(1);
  }

  const localRegs = loadLocalRegistries();
  const id = repo.replace(/\//g, "-").toLowerCase();

  // Check if already exists
  const existing = localRegs.find((r) => r.repo === repo);
  if (existing) {
    console.log(
      JSON.stringify({ warning: `Registry '${repo}' already exists in local config`, registry: existing })
    );
    return;
  }

  const newReg: Registry = {
    id,
    repo,
    name: name || repo,
    description: "",
    enabled: true,
  };

  localRegs.push(newReg);
  saveLocalRegistries(localRegs);
  console.log(
    JSON.stringify({ success: `Added registry '${repo}'`, registry: newReg })
  );
}

function cmdRemoveRegistry(repo: string): void {
  const localRegs = loadLocalRegistries();
  const filtered = localRegs.filter((r) => r.repo !== repo && r.id !== repo);

  if (filtered.length === localRegs.length) {
    console.log(
      JSON.stringify({ error: `Registry '${repo}' not found in local config` })
    );
    process.exit(1);
  }

  saveLocalRegistries(filtered);
  console.log(JSON.stringify({ success: `Removed registry '${repo}'` }));
}

function cmdToggleRegistry(idOrRepo: string, enabled: boolean): void {
  // First check local registries
  const localRegs = loadLocalRegistries();
  const localIdx = localRegs.findIndex(
    (r) => r.id === idOrRepo || r.repo === idOrRepo
  );

  if (localIdx >= 0) {
    localRegs[localIdx].enabled = enabled;
    saveLocalRegistries(localRegs);
    console.log(
      JSON.stringify({
        success: `${enabled ? "Enabled" : "Disabled"} registry '${idOrRepo}'`,
      })
    );
    return;
  }

  // Check default registries — create a local override
  const allRegs = loadRegistries();
  const defaultReg = allRegs.find(
    (r) => r.id === idOrRepo || r.repo === idOrRepo
  );

  if (!defaultReg) {
    console.log(
      JSON.stringify({ error: `Registry '${idOrRepo}' not found` })
    );
    process.exit(1);
  }

  // Add override to local config
  localRegs.push({ ...defaultReg, enabled });
  saveLocalRegistries(localRegs);
  console.log(
    JSON.stringify({
      success: `${enabled ? "Enabled" : "Disabled"} registry '${idOrRepo}'`,
    })
  );
}

// --- Main search ---

async function cmdSearch(args: CLIArgs): Promise<void> {
  if (!args.keywords.length) {
    console.log(
      JSON.stringify({
        error:
          "Usage: npx -y bun run search_github.ts <keyword1> [keyword2] ... [--descriptions] [--threshold N]",
      })
    );
    process.exit(1);
  }

  const registries = loadRegistries().filter((r) => r.enabled);

  if (registries.length === 0) {
    console.log(JSON.stringify({ error: "No enabled registries found" }));
    process.exit(1);
  }

  // Search all enabled registries in parallel
  const searchResults = await Promise.all(
    registries.map((reg) =>
      searchRegistryViaReadme(reg, args.keywords, args.threshold)
    )
  );

  const seenKeys = new Set<string>();
  const allResults: SkillResult[] = [];

  for (const { results } of searchResults) {
    for (const r of results) {
      const key = `${r.source}/${r.name}`.toLowerCase();
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allResults.push(r);
      }
    }
  }

  allResults.sort((a, b) => b.score - a.score);

  // Strip description from output unless --descriptions is set
  const outputResults = allResults.slice(0, MAX_RESULTS).map((r) => {
    const out: Record<string, unknown> = {
      name: r.name,
      source: r.source,
      score: r.score,
      url: r.url,
      raw_url: r.raw_url,
      branch: r.branch,
      path: r.path,
    };
    if (args.descriptions) {
      if (r.description) out.description = r.description;
      if (r.category) out.category = r.category;
    }
    return out;
  });

  const output: SearchOutput = {
    keywords: args.keywords,
    total: allResults.length,
    results: outputResults as unknown as SkillResult[],
  };

  console.log(JSON.stringify(output, null, 2));
}

function cmdShowPreferences(): void {
  const prefs = loadPreferences();
  if (!prefs) {
    console.log(JSON.stringify({ 
      preferences: {
        install_method: 'ask',
        install_location: 'ask'
      },
      source: 'defaults'
    }));
  } else {
    console.log(JSON.stringify({ preferences: prefs, source: 'config.yaml' }));
  }
}

// --- Entry point ---

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.listRegistries) {
    cmdListRegistries();
    return;
  }

  if (args.showPreferences) {
    cmdShowPreferences();
    return;
  }

  if (args.addRegistry) {
    cmdAddRegistry(args.addRegistry, args.registryName);
    return;
  }

  if (args.removeRegistry) {
    cmdRemoveRegistry(args.removeRegistry);
    return;
  }

  if (args.enableRegistry) {
    cmdToggleRegistry(args.enableRegistry, true);
    return;
  }

  if (args.disableRegistry) {
    cmdToggleRegistry(args.disableRegistry, false);
    return;
  }

  await cmdSearch(args);
}

main().catch((err) => {
  console.error(JSON.stringify({ error: (err as Error).message }));
  process.exit(1);
});
