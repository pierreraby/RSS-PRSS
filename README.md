# RSS-PRSS: Prompt-based Recursive Repo Summarizer (PRRS)

RSS-PRSS (PRRS) is an advanced CLI tool for analyzing and summarizing code repositories using large language models (LLMs) like Grok via OpenRouter. It recursively scans your codebase, extracts key code chunks, ranks them by importance through customizable "lenses" (e.g., architecture, security, data flow), and generates high-level summaries with insights on structure, dependencies, and potential issues. Perfect for quick code reviews, security audits, or onboarding to unfamiliar repos – all powered by AI without manual effort.

Built in TypeScript with ESM modules, it's lightweight, extensible, and production-ready. Analyze a full repo in ~1-3 minutes for ~$0.05-0.50 (depending on depth and lenses), outputting clean console trees, JSON for scripting, or simple summaries.

## Features
- **Recursive Analysis**: Scans folders/files up to a configurable depth (default 3), skipping non-code (e.g., .env, node_modules).
- **Multi-Lens Perspectives**: Built-in lenses like `architecture` (MVC patterns, deps), `security` (vulns, auth risks), `data_flow` (interactions, scalability). Custom lenses via prompts.
- **LLM Integration**: Uses Grok models (e.g., `g4f-no-reasoning` for speed, `g4f-reasoning` for deeper insights) via OpenRouter API. Fallbacks handle parsing errors.
- **Flexible Outputs**:
  - `console`: Full readable summaries.
  - `tree`: ASCII tree view with truncated summaries (great for quick viz).
  - `json`: Structured data for tools/scripts (e.g., jq, pipelines).
- **CLI-First**: Intuitive options for paths, models, depth, verbose logging.
- **Robust & Safe**: Filters noise (skips, empty files), async processing, no system mods. Handles large repos with token limits in mind.
- **Meta-Capable**: Self-analyze your own code (e.g., review PRRS itself!).

## Prerequisites
- Node.js ≥18.0.0
- pnpm (or npm/yarn) for package management.
- OpenRouter API key (free tier available; sign up at [openrouter.ai](https://openrouter.ai)).

## Installation
1. **Clone or Create Project**:
   ```
   git clone <your-repo>  # Or create from src/
   cd rss-prss
   ```

2. **Install Dependencies**:
   ```
   pnpm install
   ```

3. **Set API Key** (securely):
   - Create `.env` or use shell script:
     ```
     echo 'OPENROUTER_API_KEY=sk-or-v1-...' > .env  # Or export directly
     ```
   - For one-off runs: `export OPENROUTER_API_KEY=sk-or-v1-...` (or `source secrets.sh`).
   - **Security Note**: Never commit API keys. Use `.gitignore` for `.env`.

4. **Build**:
   ```
   pnpm run build  # Compiles TypeScript to dist/
   ```

5. **Global Install (Optional, for CLI Anywhere)**:
   ```
   pnpm install -g
   ```
   - Now run `prrs --help` from any directory!

### Single-File Build (Recommended for Deployment)
  ```
  pnpm run build:ncc  # Bundles to dist/index.js (standalone CLI)
  pnpm install -g     # Installs bundled version
  ```

- Or share `dist/index.js` directly (no deps needed).

## Usage
PRRS is a CLI tool invoked via `prrs` (or `node dist/index.js prrs`). Basic syntax:
```
prrs --path <folder> --lenses <comma-separated> --model <key> --output <format> [--depth <num>] [--verbose]
```

### Key Options
- `--path, -p <dir>`: Target folder (default: `.`). E.g., `/home/user/my-repo`.
- `--lenses, -l <list>`: Comma-separated analysis perspectives (default: `architecture`). Examples:
  - `architecture`: Structure, patterns, deps.
  - `security`: Vulns, auth risks, best practices.
  - `data_flow`: Interactions, scalability, flows.
  - Custom: Any string (e.g., `performance,best_practices` – LLM adapts).
- `--model, -m <key>`: LLM model (default: `g4f-reasoning`). Options (via OpenRouter/Grok):
  - `g4f-no-reasoning`: Faster, concise (~$0.05/run).
  - `g4f-reasoning`: Deeper insights, longer outputs.
  - Fallback: Defaults to `g4f-reasoning` if invalid.
- `--output, -o <format>`: Output style (default: `console`).
  - `console`: Readable summaries + insights.
  - `tree`: ASCII tree with node summaries (indented, connectors like `├──`).
  - `json`: Raw structured data (for jq/ scripting).
- `--depth, -d <num>`: Max recursion (default: 3; 1=shallow, faster).
- `--verbose, -v`: Enable processing logs (skips, files scanned).

### Quick Start Examples
1. **Basic Architecture Summary (Console)**:
   ```
   export OPENROUTER_API_KEY=sk-or-v1-...  # Or source .env
   prrs --path . --lenses architecture --output console --verbose
   ```
   - Output: `=== ARCHITECTURE Summary ===` + full text (structure, deps, insights).

2. **Tree View for Quick Viz**:
   ```
   prrs --path /path/to/repo --lenses architecture,security --output tree
   ```
   - Output: 
     ```
     ARCHITECTURE Analysis:
     └── repo (folder)
         Summary: Modular Express.js app... (150 chars)
         ├── src (folder)
         │   Summary: MVC patterns...
         │   └── app.ts (file)
         │       Summary: Server setup...

     SECURITY Analysis:
     └── repo (folder)
         Summary: JWT risks + CORS vulns...
         ...
     ```
   - Great for spotting high-level issues (e.g., auth flows, security gaps).

3. **JSON for Scripting/Pipelines**:
   ```
   prrs --path my-repo --lenses security --output json > security-audit.json
   jq '.security.children[] | select(.summary | contains("vulnerability"))' security-audit.json
   ```
   - Pipe to tools like `jq` or integrate in CI (e.g., GitHub Actions for auto-audits).

4. **Shallow Self-Analysis (Fast, ~30s)**:
   ```
   prrs --path . --lenses architecture --depth 2 --model g4f-no-reasoning --output tree
   ```
   - Meta: Reviews your own code (e.g., "Modular CLI with Commander.js...").

5. **Multi-Lens Deep Dive**:
   ```
   prrs --path big-repo --lenses architecture,data_flow,security --depth 3 --output console
   ```
   - ~3x time/cost, but comprehensive (e.g., trace data flows + security impacts).

### Error Handling
- **No API Key**: "Error: Set OPENROUTER_API_KEY".
- **Invalid Path**: "Error: Path not found" (exit 1).
- **LLM Fails**: Fallback summaries (e.g., "Default ranking"); retries via robust parsing.
- **Large Repos**: High depth/tokens? Use `--depth 2` + `g4f-no-reasoning` for ~$0.10.

## How It Works (Under the Hood)
PRRS uses LLMs for intelligent analysis:
1. **Scan & Chunk**: Recursively reads files (TS/JS/JSON focus), splits into ~10 semantic chunks (e.g., functions, imports).
2. **Rank Chunks**: LLM ranks chunks by lens importance (e.g., score 1-10 + reason: "Core auth logic impacts security").
3. **Summarize**: Aggregates top chunks into lens-specific insights (patterns, deps, issues).
4. **Aggregate Folders**: Builds tree summaries from children (e.g., "src: MVC layer with Express deps").
5. **Output**: Formats as tree/JSON/console, filtering noise (skips like .env).

**LLM Integration Details**:
- **Provider**: OpenRouter (supports Grok, GPT, etc. – easy swap via `modelMap` in `src/models.ts`).
- **Prompting**: Lens-specific (e.g., "From security perspective, rank chunks on vulns"). Robust JSON parsing (regex fallback for non-strict responses).
- **Customization**: Edit `src/models.ts` for new providers (e.g., Anthropic Claude: add `{ claude: new Claude(...) }`). Or tweak prompts in `src/prrs.ts` for domain-specific lenses (e.g., "ml_model" for AI code).
- **Costs/Tokens**: ~1k-5k tokens per lens (check OpenRouter dashboard). No-reasoning = cheaper/faster.
- **Extending with LLMs**: 
  - **Chain Outputs**: Pipe JSON to another LLM (e.g., `jq ... | curl -d @- https://api.openai.com/v1/chat/completions` for refinement: "Deepen this security summary").
  - **Custom Lenses**: `--lenses custom_ml` → LLM adapts (e.g., summarize ML models in a repo).
  - **Hybrid**: Use PRRS summaries as input to local LLMs (e.g., Ollama: `ollama run llama3 "Analyze this PRRS output: [paste summary]"`).

For advanced LLM chaining, see "Advanced Usage" below.

## Advanced Usage
- **Scripts in package.json**:
  ```
  pnpm start          # Auto-analyze current dir (tree output)
  pnpm self           # Multi-lens console on .
  pnpm test           # Run test-prrs.js (or your tests)
  ```
- **CI/CD Integration**: Add to GitHub Actions:
  ```yaml
  - name: PRRS Audit
    run: |
      pnpm install -g
      prrs --path . --lenses security --output json > audit.json
      if jq '.security | contains("critical")' audit.json; then exit 1; fi  # Fail on vulns
  ```
- **Custom Models/Providers**: In `src/models.ts`, extend `modelMap` (e.g., add Anthropic: `npm i @anthropic-ai/sdk`, then `{ anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) }`).
- **Chaining with Other LLMs**: Use outputs as prompts:
  1. Run PRRS: `prrs --output json > input.json`.
  2. Feed to another LLM: 
     ```
     SUMMARY=$(jq -r '.architecture.summary' input.json)
     curl -X POST https://api.anthropic.com/v1/messages \
       -H "x-api-key: $ANTHROPIC_API_KEY" \
       -d "{\"model\": \"claude-3-opus-20240229\", \"max_tokens\": 500, \"messages\": [{\"role\": \"user\", \"content\": \"Expand this code summary with refactoring suggestions: $SUMMARY\"}]}"
     ```
  - Or local: `echo "$SUMMARY" | ollama run mistral "Suggest improvements:"`.
- **Limits & Tips**: Max 10 chunks/file; depth>3 on huge repos (e.g., monorepos) may hit token limits – subsample with `--depth 2`. Verbose for debugging.

## Project Structure
```
rss-prss/
├── src/
│   ├── index.ts      # CLI entry (Commander setup)
│   ├── models.ts     # LLM config (OpenRouter/Grok)
│   ├── prrs.ts       # Core logic (rrs, chunking, prompts)
│   └── test-*.ts     # Examples/tests
├── package.json      # Deps: commander, ai, fs-extra
├── tsconfig.json     # Strict TS config
└── README.md         # This file
```

## Contributing
- Fork & PR: Add lenses, models, or outputs (e.g., Markdown reports).
- Issues: Report parse fails or LLM quirks (e.g., via GitHub).
- Tests: Run `pnpm test` (expanding test-prrs.ts).

## License
MIT – Free to use/modify. See [LICENSE](LICENSE) (or add one).

## Acknowledgments
- Powered by [OpenRouter](https://openrouter.ai) & Grok (xAI).
- Inspired by tree-based code viz tools + LLM code analysis (e.g., GitHub Copilot).

For questions: Ping the maintainer or open an issue. Happy analyzing! 🚀
