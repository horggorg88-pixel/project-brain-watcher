Project Brain Watcher
=====================

Headless watcher:

```powershell
npx --yes github:horggorg88-pixel/project-brain-watcher start --path "C:\path\to\project" --server "https://brain.example" --token-env MCP_BEARER_TOKEN --project my-project --watch
```

Windows service:

```powershell
npx --yes github:horggorg88-pixel/project-brain-watcher service install --path "C:\path\to\project" --server "https://brain.example" --token-env MCP_BEARER_TOKEN --project my-project
```

Desktop control panel:

```powershell
npx --yes github:horggorg88-pixel/project-brain-watcher desktop install
npx --yes github:horggorg88-pixel/project-brain-watcher desktop open
npx --yes github:horggorg88-pixel/project-brain-watcher desktop update
npx --yes github:horggorg88-pixel/project-brain-watcher desktop status
```

The npm/npx package stays small. `desktop install` downloads the portable Windows executable from GitHub Releases in this repository and stores it under `%LOCALAPPDATA%\ProjectBrainWatcher\desktop`.
