# project-brain-watcher

Smart Local Watcher for [Project Brain MCP Server](https://github.com/lukanpm/project-brain-mcp).

Scans your local project, compresses code via AST analysis, and pushes compact summaries to a remote MCP server. Reduces traffic by ~100x compared to sending raw files.

## Quick Start

```bash
npx project-brain-watcher \
  --path /path/to/project \
  --server https://your-mcp-server.com \
  --token YOUR_AUTH_TOKEN \
  --project my-project
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--path` | `.` (cwd) | Path to your project root |
| `--server` | *required* | MCP server URL |
| `--token` | *required* | Auth token for the server |
| `--project` | folder name | Project identifier |
| `--watch` | off | Enable real-time file watching |
| `--exts` | `.ts,.tsx,.js,.jsx,.py,.cs,.go,.rs` | File extensions to index |
| `--ignore` | `node_modules,dist,.git,build,out,coverage` | Directories to ignore |
| `--batch` | `10` | Batch size for uploads |

## How It Works

1. **Scan** — Recursively finds source files in your project
2. **Compress** — Parses each file's AST, extracts symbols, generates L1/L3 summaries
3. **Upload** — Sends compressed summaries to MCP server in batches
4. **Watch** (optional) — Monitors file changes and re-indexes on the fly

## Requirements

- Node.js >= 20
- A running Project Brain MCP server

## License

MIT

