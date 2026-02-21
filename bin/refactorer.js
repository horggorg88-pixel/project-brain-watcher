#!/usr/bin/env node

// solid-refactor/cli.ts
import { relative as relative5, basename as basename6 } from "node:path";

// solid-refactor/infra/config.ts
import { resolve } from "node:path";
import { existsSync } from "node:fs";
var DEFAULT_EXTENSIONS = [".ts", ".tsx"];
var DEFAULT_THRESHOLDS = {
  maxLines: 200,
  maxSymbols: 15,
  maxResponsibilities: 3,
  minGodScore: 0.35
};
function parseCliArgs(argv) {
  const args = argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("--")) {
        flags[key] = nextArg;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return {
    path: flags["path"] ?? process.cwd(),
    dryRun: flags["dry-run"] === "true" || flags["dryRun"] === "true",
    verbose: flags["verbose"] === "true" || flags["v"] === "true",
    autoApprove: flags["auto-approve"] === "true" || flags["yes"] === "true",
    maxLines: parseInt(flags["max-lines"] ?? String(DEFAULT_THRESHOLDS.maxLines), 10),
    maxSymbols: parseInt(flags["max-symbols"] ?? String(DEFAULT_THRESHOLDS.maxSymbols), 10),
    minScore: parseFloat(flags["min-score"] ?? String(DEFAULT_THRESHOLDS.minGodScore)),
    extensions: flags["exts"] ? flags["exts"].split(",") : [...DEFAULT_EXTENSIONS],
    analyzeOnly: flags["analyze-only"] === "true" || flags["analyze"] === "true",
    target: flags["target"] ?? null
  };
}
function buildConfig(cliArgs) {
  const projectRoot = resolve(cliArgs.path);
  if (!existsSync(projectRoot)) {
    throw new Error(`\u041F\u0443\u0442\u044C \u043D\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442: ${projectRoot}`);
  }
  return {
    projectRoot,
    extensions: cliArgs.extensions,
    thresholds: {
      maxLines: cliArgs.maxLines,
      maxSymbols: cliArgs.maxSymbols,
      maxResponsibilities: DEFAULT_THRESHOLDS.maxResponsibilities,
      minGodScore: cliArgs.minScore
    },
    dryRun: cliArgs.dryRun,
    autoApprove: cliArgs.autoApprove,
    verbose: cliArgs.verbose
  };
}
function printUsage() {
  const P2 = "  ";
  const W = 62;
  const line = "\u2500".repeat(W);
  const top = `${P2}\u250C${line}\u2510`;
  const bot = `${P2}\u2514${line}\u2518`;
  const bx = (t) => {
    const pad = Math.max(W - 2 - t.length, 0);
    return `${P2}\u2502  ${t}${" ".repeat(pad)}\u2502`;
  };
  const div = `${P2}\u2502  ${"\u2500".repeat(W - 2)}\u2502`;
  console.log("");
  console.log(top);
  console.log(bx("\u{1F527} SOLID Refactorer  v1.0.0"));
  console.log(bx("\u042D\u0442\u0430\u043B\u043E\u043D\u043D\u044B\u0439 \u0440\u0435\u0444\u0430\u043A\u0442\u043E\u0440\u0438\u043D\u0433 \u043F\u043E SOLID"));
  console.log(bot);
  console.log("");
  console.log(top);
  console.log(bx("\u{1F4D6}  \u0418\u0421\u041F\u041E\u041B\u042C\u0417\u041E\u0412\u0410\u041D\u0418\u0415"));
  console.log(div);
  console.log(bx("npx tsx solid-refactor/cli.ts [\u043E\u043F\u0446\u0438\u0438]"));
  console.log(bx(""));
  console.log(bx("\u041E\u041F\u0426\u0418\u0418:"));
  console.log(bx("  --path <\u043F\u0443\u0442\u044C>        \u041F\u0443\u0442\u044C \u043A \u043F\u0440\u043E\u0435\u043A\u0442\u0443 (\u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E: cwd)"));
  console.log(bx("  --analyze-only       \u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C god-\u0444\u0430\u0439\u043B\u044B"));
  console.log(bx("  --dry-run            \u0410\u043D\u0430\u043B\u0438\u0437 + \u043F\u043B\u0430\u043D, \u0431\u0435\u0437 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439"));
  console.log(bx("  --target <\u0444\u0430\u0439\u043B>      \u0420\u0435\u0444\u0430\u043A\u0442\u043E\u0440\u0438\u0442\u044C \u043A\u043E\u043D\u043A\u0440\u0435\u0442\u043D\u044B\u0439 \u0444\u0430\u0439\u043B"));
  console.log(bx("  --verbose            \u041F\u043E\u0434\u0440\u043E\u0431\u043D\u044B\u0439 \u0432\u044B\u0432\u043E\u0434"));
  console.log(bx("  --auto-approve       \u0411\u0435\u0437 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0439"));
  console.log(bx("  --max-lines <N>      \u041F\u043E\u0440\u043E\u0433 \u0441\u0442\u0440\u043E\u043A (\u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E: 200)"));
  console.log(bx("  --max-symbols <N>    \u041F\u043E\u0440\u043E\u0433 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432 (\u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E: 15)"));
  console.log(bx("  --min-score <N>      \u041C\u0438\u043D. score (\u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E: 0.35)"));
  console.log(bx("  --exts <ext1,ext2>   \u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F (\u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E: .ts,.tsx)"));
  console.log(div);
  console.log(bx("\u041F\u0420\u0418\u041C\u0415\u0420\u042B:"));
  console.log(bx("  --path ./src --analyze-only"));
  console.log(bx("  --path ./src --dry-run --verbose"));
  console.log(bx("  --path ./src --target index.ts --auto-approve"));
  console.log(bot);
  console.log("");
}

// solid-refactor/infra/logger.ts
var C = {
  r: "\x1B[0m",
  b: "\x1B[1m",
  d: "\x1B[2m",
  red: "\x1B[31m",
  grn: "\x1B[32m",
  ylw: "\x1B[33m",
  blu: "\x1B[34m",
  mag: "\x1B[35m",
  cyn: "\x1B[36m",
  gry: "\x1B[90m"
};
var BOX = 62;
var P = "  ";
var ConsoleRefactorLogger = class {
  verbose;
  t0 = Date.now();
  constructor(verbose = false) {
    this.verbose = verbose;
  }
  // ═══════ IRefactorLogger ═══════
  info(msg) {
    this.tsLine("\xB7", msg);
  }
  warn(msg) {
    this.tsLine(`${C.ylw}\u26A0${C.r}`, msg);
  }
  error(msg) {
    this.tsLine(`${C.red}\u2716${C.r}`, `${C.red}${msg}${C.r}`);
  }
  debug(msg) {
    if (!this.verbose) return;
    this.tsLine(`${C.gry}\xB7${C.r}`, `${C.gry}${msg}${C.r}`);
  }
  success(msg) {
    this.tsLine(`${C.grn}\u2713${C.r}`, `${C.grn}${msg}${C.r}`);
  }
  phase(n, total, label) {
    const tag = `${n}/${total}  ${label} `;
    const dashLen = Math.max(BOX - tag.length - 2, 4);
    console.log("");
    console.log(`${P} ${C.b}${tag}${"\u2500".repeat(dashLen)}${C.r}`);
  }
  progress(cur, total, label) {
    const pct = Math.round(cur / Math.max(total, 1) * 100);
    const w = 28;
    const filled = Math.round(w * pct / 100);
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(w - filled);
    process.stdout.write(
      `\r${P}${bar} ${pct}%  ${cur}/${total}  ${label}  `
    );
    if (cur >= total) process.stdout.write("\n");
  }
  // ═══════ Box-drawing (расширение для CLI) ═══════
  /** Верхняя граница рамки: ┌────────┐ */
  boxTop() {
    console.log(`${P}\u250C${"\u2500".repeat(BOX)}\u2510`);
  }
  /** Нижняя граница рамки: └────────┘ */
  boxBot() {
    console.log(`${P}\u2514${"\u2500".repeat(BOX)}\u2518`);
  }
  /** Строка внутри рамки с авто-заполнением пробелами до │ */
  boxLine(text) {
    const clean = this.strip(text);
    const pad = Math.max(BOX - 2 - clean.length, 0);
    console.log(`${P}\u2502  ${text}${" ".repeat(pad)}\u2502`);
  }
  /** Разделитель внутри рамки: │  ──────────│ */
  boxDiv() {
    console.log(`${P}\u2502  ${"\u2500".repeat(BOX - 2)}\u2502`);
  }
  /** Пустая строка внутри рамки */
  boxEmpty() {
    console.log(`${P}\u2502${" ".repeat(BOX)}\u2502`);
  }
  /** Время с начала работы (для финальной строки) */
  elapsed() {
    const ms = Date.now() - this.t0;
    return ms < 1e3 ? `${ms}ms` : `${(ms / 1e3).toFixed(1)}s`;
  }
  /** Сброс таймера */
  resetTimer() {
    this.t0 = Date.now();
  }
  // ═══════ Хелперы ═══════
  /** Строка с таймстампом: HH:MM:SS  ·  сообщение */
  tsLine(icon, msg) {
    const ts = this.timestamp();
    console.log(`${P}${C.gry}${ts}${C.r}  ${icon}  ${msg}`);
  }
  /** Текущее время HH:MM:SS */
  timestamp() {
    const d = /* @__PURE__ */ new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  /** Убирает ANSI-коды из строки для подсчёта видимой длины */
  strip(s) {
    return s.replace(/\x1b\[[0-9;]*m/g, "");
  }
};

// solid-refactor/analyzers/file-analyzer.ts
import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";
var IMPORT_RE = /^[ \t]*import\s+(type\s+)?(?:\{([^}]*)\}|(\w+)(?:\s*,\s*\{([^}]*)\})?)\s+from\s+['"]([^'"]+)['"]/gm;
var FUNC_RE = /^[ \t]*(export\s+)?(async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+(?:\s*\|\s*[^\s{]+)*))?\s*\{/gm;
var ARROW_RE = /^[ \t]*(export\s+)?(const|let)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/gm;
var CLASS_RE = /^[ \t]*(export\s+)?(abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/gm;
var IFACE_RE = /^[ \t]*(export\s+)?interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?\s*\{/gm;
var TYPE_RE = /^[ \t]*(export\s+)?type\s+(\w+)(?:<[^>]*>)?\s*=/gm;
var CONST_RE = /^[ \t]*(export\s+)?(const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=/gm;
var FileAnalyzer = class {
  logger;
  constructor(logger) {
    this.logger = logger;
  }
  analyzeFile(filePath) {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const hash = createHash("md5").update(content).digest("hex");
    const symbols = this.extractSymbolsWithBodies(content, lines);
    const imports = this.extractImports(content);
    const exports = this.extractExports(content, symbols);
    return {
      filePath,
      lineCount: lines.length,
      symbolCount: symbols.length,
      symbols,
      imports,
      exports,
      fileHash: hash
    };
  }
  analyzeProject(rootPath, extensions) {
    const files = this.collectFiles(rootPath, extensions);
    const analyses = [];
    for (const file of files) {
      try {
        analyses.push(this.analyzeFile(file));
      } catch (err) {
        this.logger.warn(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0430\u043D\u0430\u043B\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u0442\u044C: ${file} \u2014 ${String(err)}`);
      }
    }
    return analyses;
  }
  getSymbolsWithBodies(filePath) {
    const content = readFileSync(filePath, "utf-8");
    return this.extractSymbolsWithBodies(content, content.split("\n"));
  }
  extractSymbolsWithBodies(content, lines) {
    const symbols = [];
    const arrowNames = /* @__PURE__ */ new Set();
    const addedNames = /* @__PURE__ */ new Set();
    for (const m of content.matchAll(new RegExp(ARROW_RE.source, "gm"))) {
      const line = this.getLineAt(content, m.index ?? 0);
      if (!this.isTopLevel(lines, line)) continue;
      const name = m[3] ?? "anonymous";
      if (addedNames.has(name)) continue;
      arrowNames.add(name);
      addedNames.add(name);
      symbols.push(this.buildSymbol(name, "function", !!m[1], line, line, content, lines));
    }
    for (const m of content.matchAll(new RegExp(FUNC_RE.source, "gm"))) {
      const line = this.getLineAt(content, m.index ?? 0);
      if (!this.isTopLevel(lines, line)) continue;
      const name = m[3] ?? "anonymous";
      if (addedNames.has(name)) continue;
      addedNames.add(name);
      const endLine = this.findClosingBrace(lines, line);
      symbols.push(this.buildSymbol(name, "function", !!m[1], line, endLine, content, lines));
    }
    for (const m of content.matchAll(new RegExp(CLASS_RE.source, "gm"))) {
      const line = this.getLineAt(content, m.index ?? 0);
      if (!this.isTopLevel(lines, line)) continue;
      const name = m[3] ?? "AnonymousClass";
      if (addedNames.has(name)) continue;
      addedNames.add(name);
      const endLine = this.findClosingBrace(lines, line);
      symbols.push(this.buildSymbol(name, "class", !!m[1], line, endLine, content, lines));
    }
    for (const m of content.matchAll(new RegExp(IFACE_RE.source, "gm"))) {
      const line = this.getLineAt(content, m.index ?? 0);
      if (!this.isTopLevel(lines, line)) continue;
      const name = m[2] ?? "IUnknown";
      if (addedNames.has(name)) continue;
      addedNames.add(name);
      const endLine = this.findClosingBrace(lines, line);
      symbols.push(this.buildSymbol(name, "interface", !!m[1], line, endLine, content, lines));
    }
    for (const m of content.matchAll(new RegExp(TYPE_RE.source, "gm"))) {
      const line = this.getLineAt(content, m.index ?? 0);
      if (!this.isTopLevel(lines, line)) continue;
      const name = m[2] ?? "UnknownType";
      if (addedNames.has(name)) continue;
      addedNames.add(name);
      symbols.push(this.buildSymbol(name, "type", !!m[1], line, line, content, lines));
    }
    for (const m of content.matchAll(new RegExp(CONST_RE.source, "gm"))) {
      const name = m[3] ?? "unknown";
      if (arrowNames.has(name)) continue;
      const line = this.getLineAt(content, m.index ?? 0);
      if (!this.isTopLevel(lines, line)) continue;
      if (addedNames.has(name)) continue;
      addedNames.add(name);
      const isConst = m[2] === "const";
      symbols.push(this.buildSymbol(name, isConst ? "constant" : "variable", !!m[1], line, line, content, lines));
    }
    return symbols;
  }
  /** Проверяет, является ли строка top-level (отступ 0 или export) */
  isTopLevel(lines, lineIdx) {
    const line = lines[lineIdx] ?? "";
    const indent = line.length - line.trimStart().length;
    return indent === 0;
  }
  buildSymbol(name, type, isExported, startLine, endLine, content, lines) {
    const body = lines.slice(startLine, endLine + 1).join("\n");
    const signatureLine = lines[startLine] ?? "";
    const docComment = this.findDocComment(lines, startLine);
    const calledSymbols = this.findCalledSymbols(body);
    const usedThisProps = this.findThisProperties(body);
    return {
      name,
      type,
      isExported,
      body,
      docComment,
      signature: signatureLine.trim(),
      range: this.buildRange(startLine, endLine),
      calledSymbols,
      usedThisProps
    };
  }
  extractImports(content) {
    const imports = [];
    for (const m of content.matchAll(new RegExp(IMPORT_RE.source, "gm"))) {
      const isTypeOnly = !!m[1];
      const namedSymbols = (m[2] ?? m[4] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const defaultSymbol = m[3] ? [m[3]] : [];
      const source = m[5] ?? "";
      const line = this.getLineAt(content, m.index ?? 0);
      imports.push({
        source,
        symbols: [...defaultSymbol, ...namedSymbols],
        isTypeOnly,
        raw: m[0],
        line
      });
    }
    return imports;
  }
  extractExports(content, symbols) {
    return symbols.filter((s) => s.isExported).map((s) => ({ name: s.name, isDefault: false, isTypeOnly: s.type === "type" || s.type === "interface" }));
  }
  findCalledSymbols(body) {
    const calls = /* @__PURE__ */ new Set();
    const callRe = /(?:this\.)?(\w+)\s*\(/g;
    for (const m of body.matchAll(callRe)) {
      const name = m[1];
      if (name && !["if", "for", "while", "switch", "catch", "return", "new", "typeof", "await"].includes(name)) {
        calls.add(name);
      }
    }
    return [...calls];
  }
  findThisProperties(body) {
    const props = /* @__PURE__ */ new Set();
    const thisRe = /this\.(\w+)/g;
    for (const m of body.matchAll(thisRe)) {
      if (m[1]) props.add(m[1]);
    }
    return [...props];
  }
  findDocComment(lines, symbolLine) {
    let idx = symbolLine - 1;
    while (idx >= 0 && lines[idx]?.trim() === "") idx--;
    if (idx < 0) return null;
    if (lines[idx]?.trim().endsWith("*/")) {
      let start = idx;
      while (start >= 0 && !lines[start]?.trim().startsWith("/**")) start--;
      if (start >= 0) {
        return lines.slice(start, idx + 1).map((l) => l.replace(/^\s*\*?\s?/, "").trim()).filter(Boolean).join(" ");
      }
    }
    return null;
  }
  getLineAt(content, offset) {
    let line = 0;
    for (let i = 0; i < offset && i < content.length; i++) {
      if (content[i] === "\n") line++;
    }
    return line;
  }
  findClosingBrace(lines, startLine) {
    let depth = 0;
    let found = false;
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i] ?? "";
      for (const ch of line) {
        if (ch === "{") {
          depth++;
          found = true;
        }
        if (ch === "}") depth--;
        if (found && depth === 0) return i;
      }
    }
    return Math.min(startLine + 50, lines.length - 1);
  }
  buildRange(start, end) {
    return { start: { line: start, column: 0 }, end: { line: end, column: 0 } };
  }
  collectFiles(rootPath, extensions) {
    const result = [];
    const ignored = /* @__PURE__ */ new Set(["node_modules", "dist", ".git", "build", "coverage", "out"]);
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory() && !ignored.has(entry.name) && !entry.name.startsWith(".")) {
          walk(full);
        } else if (entry.isFile() && extensions.includes(extname(entry.name).toLowerCase())) {
          result.push(full);
        }
      }
    };
    walk(rootPath);
    return result;
  }
};

// solid-refactor/analyzers/god-file-detector.ts
var DEFAULT_THRESHOLDS2 = {
  maxLines: 200,
  maxSymbols: 15,
  maxResponsibilities: 3,
  minGodScore: 0.4
};
var GodFileDetector = class {
  logger;
  thresholds;
  constructor(logger) {
    this.logger = logger;
    this.thresholds = DEFAULT_THRESHOLDS2;
  }
  setThresholds(thresholds) {
    this.thresholds = thresholds;
  }
  detect(analyses) {
    const godFiles = [];
    for (const analysis of analyses) {
      const godScore = this.score(analysis);
      if (godScore.total >= this.thresholds.minGodScore) {
        const severity = this.classifySeverity(godScore.total);
        godFiles.push({ filePath: analysis.filePath, analysis, godScore, severity });
        this.logger.debug(
          `God-\u0444\u0430\u0439\u043B: ${analysis.filePath} (score=${godScore.total.toFixed(2)}, severity=${severity})`
        );
      }
    }
    return godFiles.sort((a, b) => b.godScore.total - a.godScore.total);
  }
  score(file) {
    const lineScore = this.scoreLines(file.lineCount);
    const symbolScore = this.scoreSymbols(file.symbolCount);
    const responsibilityScore = this.scoreResponsibilities(file);
    const couplingScore = this.scoreCoupling(file);
    const total = lineScore * 0.25 + symbolScore * 0.25 + responsibilityScore * 0.35 + couplingScore * 0.15;
    return { lineScore, symbolScore, responsibilityScore, couplingScore, total };
  }
  /** Скоринг по количеству строк (0..1) */
  scoreLines(lineCount) {
    const threshold = this.thresholds.maxLines;
    if (lineCount <= threshold) return 0;
    return this.sigmoid(lineCount, threshold, threshold * 3);
  }
  /** Скоринг по количеству символов (0..1) */
  scoreSymbols(symbolCount) {
    const threshold = this.thresholds.maxSymbols;
    if (symbolCount <= threshold) return 0;
    return this.sigmoid(symbolCount, threshold, threshold * 3);
  }
  /** Скоринг по разнообразию ответственностей (0..1) */
  scoreResponsibilities(file) {
    const importSources = new Set(file.imports.map((i) => i.source));
    const thisProps = new Set(file.symbols.flatMap((s) => s.usedThisProps));
    const responsibilityCount = Math.max(importSources.size, Math.ceil(thisProps.size / 3), 1);
    const threshold = this.thresholds.maxResponsibilities;
    if (responsibilityCount <= threshold) return 0;
    return this.sigmoid(responsibilityCount, threshold, threshold * 4);
  }
  /** Скоринг по связности (0..1): сколько символов не связаны друг с другом */
  scoreCoupling(file) {
    if (file.symbols.length < 3) return 0;
    const allCalled = new Set(file.symbols.flatMap((s) => s.calledSymbols));
    const allNames = new Set(file.symbols.map((s) => s.name));
    const internalCalls = [...allCalled].filter((c) => allNames.has(c));
    const maxPossibleEdges = file.symbols.length * (file.symbols.length - 1) / 2;
    if (maxPossibleEdges === 0) return 0;
    const cohesion = internalCalls.length / maxPossibleEdges;
    return Math.max(0, 1 - cohesion * 2);
  }
  /** Сигмоида для плавного скоринга в диапазоне [min, max] → [0, 1] */
  sigmoid(value, min, max) {
    const normalized = (value - min) / (max - min);
    return Math.min(1, Math.max(0, normalized));
  }
  classifySeverity(total) {
    if (total >= 0.7) return "critical";
    if (total >= 0.5) return "warning";
    return "info";
  }
};

// solid-refactor/analyzers/symbol-dependency-analyzer.ts
var SymbolDependencyAnalyzer = class {
  logger;
  constructor(logger) {
    this.logger = logger;
  }
  buildSymbolGraph(filePath, symbols) {
    const nameSet = new Set(symbols.map((s) => s.name));
    const nodes = /* @__PURE__ */ new Map();
    const edges = [];
    for (const symbol of symbols) {
      const calls = symbol.calledSymbols.filter((c) => nameSet.has(c) && c !== symbol.name);
      nodes.set(symbol.name, {
        name: symbol.name,
        type: symbol.type,
        calls,
        calledBy: [],
        thisProperties: [...symbol.usedThisProps],
        importedFrom: []
      });
    }
    for (const symbol of symbols) {
      for (const called of symbol.calledSymbols) {
        const calledNode = nodes.get(called);
        if (calledNode && called !== symbol.name) {
          nodes.set(called, {
            ...calledNode,
            calledBy: [...calledNode.calledBy, symbol.name]
          });
        }
      }
    }
    for (const symbol of symbols) {
      for (const called of symbol.calledSymbols) {
        if (nameSet.has(called) && called !== symbol.name) {
          edges.push({
            from: symbol.name,
            to: called,
            edgeType: "call",
            weight: 1
          });
        }
      }
    }
    const thisEdges = this.buildThisEdges(symbols, nameSet);
    edges.push(...thisEdges);
    const sharedState = this.findSharedState(symbols);
    this.logger.debug(
      `\u0413\u0440\u0430\u0444 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432 ${filePath}: ${nodes.size} \u043D\u043E\u0434, ${edges.length} \u0440\u0451\u0431\u0435\u0440`
    );
    return {
      nodes,
      edges,
      sharedState,
      externalImports: /* @__PURE__ */ new Map()
    };
  }
  findCallsites(symbolName, allSymbols) {
    return allSymbols.filter((s) => s.calledSymbols.includes(symbolName) && s.name !== symbolName).map((s) => s.name);
  }
  findSharedState(symbols) {
    const propToSymbols = /* @__PURE__ */ new Map();
    for (const symbol of symbols) {
      for (const prop of symbol.usedThisProps) {
        const existing = propToSymbols.get(prop) ?? [];
        existing.push(symbol.name);
        propToSymbols.set(prop, existing);
      }
    }
    const shared = /* @__PURE__ */ new Map();
    for (const [prop, users] of propToSymbols) {
      if (users.length > 1) {
        shared.set(prop, users);
      }
    }
    return shared;
  }
  /** Строит рёбра между символами, разделяющими общие this-свойства */
  buildThisEdges(symbols, nameSet) {
    const edges = [];
    const added = /* @__PURE__ */ new Set();
    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const a = symbols[i];
        const b = symbols[j];
        const commonProps = a.usedThisProps.filter((p) => b.usedThisProps.includes(p));
        if (commonProps.length === 0) continue;
        const edgeKey = `${a.name}\u2192${b.name}:this-access`;
        if (added.has(edgeKey)) continue;
        added.add(edgeKey);
        const weight = commonProps.length / Math.max(a.usedThisProps.length, b.usedThisProps.length, 1);
        edges.push({ from: a.name, to: b.name, edgeType: "this-access", weight });
      }
    }
    return edges;
  }
};

// solid-refactor/analyzers/responsibility-clusterer.ts
var EDGE_THRESHOLD = 0.1;
var MIN_CLUSTER_SIZE = 1;
var ResponsibilityClusterer = class {
  logger;
  constructor(logger) {
    this.logger = logger;
  }
  clusterize(godFile, graph) {
    const symbols = godFile.analysis.symbols;
    const nameToSymbol = new Map(symbols.map((s) => [s.name, s]));
    const parent = /* @__PURE__ */ new Map();
    for (const s of symbols) parent.set(s.name, s.name);
    for (const edge of graph.edges) {
      if (edge.weight >= EDGE_THRESHOLD) {
        this.union(parent, edge.from, edge.to);
      }
    }
    for (const [prop, users] of graph.sharedState) {
      if (users.length > 1) {
        const first = users[0];
        for (let i = 1; i < users.length; i++) {
          this.union(parent, first, users[i]);
        }
      }
    }
    const groups = /* @__PURE__ */ new Map();
    for (const symbol of symbols) {
      const root = this.find(parent, symbol.name);
      const group = groups.get(root) ?? [];
      group.push(symbol);
      groups.set(root, group);
    }
    const clusters = [];
    for (const [root, groupSymbols] of groups) {
      if (groupSymbols.length < MIN_CLUSTER_SIZE) continue;
      const cluster = this.buildCluster(groupSymbols, graph, godFile.analysis.imports);
      clusters.push(cluster);
    }
    this.logger.debug(`\u041A\u043B\u0430\u0441\u0442\u0435\u0440\u0438\u0437\u0430\u0446\u0438\u044F ${godFile.filePath}: ${clusters.length} \u043A\u043B\u0430\u0441\u0442\u0435\u0440\u043E\u0432`);
    return clusters.sort((a, b) => b.linesCount - a.linesCount);
  }
  suggestName(symbols) {
    const classes = symbols.filter((s) => s.type === "class");
    if (classes.length === 1) return this.toKebab(classes[0].name);
    const interfaces = symbols.filter((s) => s.type === "interface");
    if (interfaces.length === 1) return this.toKebab(interfaces[0].name.replace(/^I/, ""));
    const names = symbols.map((s) => s.name);
    const prefix = this.longestCommonPrefix(names);
    if (prefix.length >= 3) return this.toKebab(prefix);
    const longest = symbols.reduce((a, b) => a.body.length > b.body.length ? a : b, symbols[0]);
    return this.toKebab(longest.name);
  }
  measureCohesion(symbols, graph) {
    if (symbols.length <= 1) return 1;
    const nameSet = new Set(symbols.map((s) => s.name));
    let internalEdges = 0;
    for (const edge of graph.edges) {
      if (nameSet.has(edge.from) && nameSet.has(edge.to)) {
        internalEdges++;
      }
    }
    const maxPossibleEdges = symbols.length * (symbols.length - 1) / 2;
    return maxPossibleEdges > 0 ? internalEdges / maxPossibleEdges : 0;
  }
  /** Строит описание кластера из набора символов */
  buildCluster(symbols, graph, allImports) {
    const nameSet = new Set(symbols.map((s) => s.name));
    const sharedProps = /* @__PURE__ */ new Set();
    for (const s of symbols) {
      for (const p of s.usedThisProps) sharedProps.add(p);
    }
    const internalDeps = /* @__PURE__ */ new Set();
    for (const s of symbols) {
      for (const called of s.calledSymbols) {
        if (nameSet.has(called) && called !== s.name) {
          internalDeps.add(called);
        }
      }
    }
    const externalImports = this.collectExternalImports(symbols, allImports);
    const linesCount = symbols.reduce((sum, s) => sum + s.body.split("\n").length, 0);
    const cohesionScore = this.measureCohesion(symbols, graph);
    return {
      suggestedName: this.suggestName(symbols),
      symbols,
      sharedState: [...sharedProps],
      internalDeps: [...internalDeps],
      externalImports,
      cohesionScore,
      linesCount
    };
  }
  /** Собирает внешние импорты, которые нужны символам кластера */
  collectExternalImports(symbols, allImports) {
    const usedNames = new Set(symbols.flatMap((s) => [...s.calledSymbols, ...s.usedThisProps]));
    const sources = /* @__PURE__ */ new Set();
    for (const imp of allImports) {
      if (imp.symbols.some((s) => usedNames.has(s))) {
        sources.add(imp.source);
      }
    }
    return [...sources];
  }
  // ═══ Union-Find ═══
  find(parent, x) {
    let root = parent.get(x) ?? x;
    while (root !== (parent.get(root) ?? root)) {
      root = parent.get(root) ?? root;
    }
    let current = x;
    while (current !== root) {
      const next = parent.get(current) ?? current;
      parent.set(current, root);
      current = next;
    }
    return root;
  }
  union(parent, a, b) {
    const rootA = this.find(parent, a);
    const rootB = this.find(parent, b);
    if (rootA !== rootB) {
      parent.set(rootB, rootA);
    }
  }
  toKebab(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  }
  longestCommonPrefix(strings) {
    if (strings.length === 0) return "";
    let prefix = strings[0] ?? "";
    for (let i = 1; i < strings.length; i++) {
      const s = strings[i] ?? "";
      while (!s.startsWith(prefix) && prefix.length > 0) {
        prefix = prefix.slice(0, -1);
      }
    }
    return prefix;
  }
};

// solid-refactor/planners/import-resolver.ts
import { readFileSync as readFileSync2, readdirSync as readdirSync2 } from "node:fs";
import { join as join2, dirname, relative as relative2, extname as extname2, resolve as resolve2, sep, posix } from "node:path";
var SCAN_EXTENSIONS = /* @__PURE__ */ new Set([".ts", ".tsx", ".js", ".jsx"]);
var IGNORED_DIRS = /* @__PURE__ */ new Set(["node_modules", "dist", ".git", "build", "coverage", "out"]);
var ImportResolver = class {
  logger;
  constructor(logger) {
    this.logger = logger;
  }
  resolve(importPath, fromFile) {
    const dir = dirname(fromFile);
    if (importPath.startsWith(".")) {
      return resolve2(dir, importPath);
    }
    return importPath;
  }
  findAllConsumers(filePath, projectRoot) {
    const allFiles = this.collectAllFiles(projectRoot);
    const consumers = [];
    const targetVariants = this.buildImportVariants(filePath);
    for (const file of allFiles) {
      if (file === filePath) continue;
      try {
        const content = readFileSync2(file, "utf-8");
        if (this.fileImports(content, file, filePath, targetVariants)) {
          consumers.push(file);
        }
      } catch {
      }
    }
    this.logger.debug(`\u041F\u043E\u0442\u0440\u0435\u0431\u0438\u0442\u0435\u043B\u0438 ${filePath}: \u043D\u0430\u0439\u0434\u0435\u043D\u043E ${consumers.length}`);
    return consumers;
  }
  computeNewPath(consumerFile, newModuleFile) {
    const from = dirname(consumerFile);
    let rel = relative2(from, newModuleFile);
    rel = rel.split(sep).join(posix.sep);
    rel = rel.replace(/\.(ts|tsx|js|jsx)$/, "");
    if (!rel.startsWith(".")) {
      rel = "./" + rel;
    }
    rel += ".js";
    return rel;
  }
  /** Строит все возможные варианты import-пути для файла */
  buildImportVariants(filePath) {
    const variants = [];
    const withoutExt = filePath.replace(/\.(ts|tsx|js|jsx)$/, "");
    variants.push(filePath);
    variants.push(withoutExt);
    variants.push(withoutExt + ".js");
    variants.push(withoutExt + ".ts");
    return variants;
  }
  /** Проверяет, импортирует ли файл целевой путь */
  fileImports(content, consumerFile, targetFile, targetVariants) {
    if (!content.includes("from ") && !content.includes("require(")) return false;
    const importRe = /(?:from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g;
    const consumerDir = dirname(consumerFile);
    for (const m of content.matchAll(importRe)) {
      const importSource = m[1] ?? m[2];
      if (!importSource || !importSource.startsWith(".")) continue;
      const resolved = resolve2(consumerDir, importSource);
      const resolvedNoExt = resolved.replace(/\.(ts|tsx|js|jsx)$/, "");
      const targetNoExt = targetFile.replace(/\.(ts|tsx|js|jsx)$/, "");
      if (resolvedNoExt === targetNoExt || resolved === targetFile) {
        return true;
      }
    }
    return false;
  }
  /** Рекурсивно собирает все файлы проекта */
  collectAllFiles(rootPath) {
    const result = [];
    const walk = (dir) => {
      try {
        for (const entry of readdirSync2(dir, { withFileTypes: true })) {
          const full = join2(dir, entry.name);
          if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
            walk(full);
          } else if (entry.isFile() && SCAN_EXTENSIONS.has(extname2(entry.name).toLowerCase())) {
            result.push(full);
          }
        }
      } catch {
      }
    };
    walk(rootPath);
    return result;
  }
};

// solid-refactor/planners/split-planner.ts
import { dirname as dirname2, join as join3, basename, posix as posix2, sep as sep2 } from "node:path";
var SplitPlanner = class {
  importResolver;
  logger;
  constructor(importResolver, logger) {
    this.importResolver = importResolver;
    this.logger = logger;
  }
  createPlan(godFile, clusters, graph, projectRoot) {
    const sourceDir = dirname2(godFile.filePath);
    const sourceName = basename(godFile.filePath, ".ts");
    const targetDir = join3(sourceDir, sourceName);
    const targets = clusters.map(
      (cluster, idx) => this.buildTarget(cluster, targetDir, godFile, idx)
    );
    const consumers = this.importResolver.findAllConsumers(godFile.filePath, projectRoot);
    const consumerUpdates = this.buildConsumerUpdates(
      consumers,
      godFile,
      targets
    );
    const barrelExports = targets.map((t) => {
      const relPath = t.targetPath.split(sep2).join(posix2.sep);
      const name = basename(relPath, ".ts");
      return `./${name}.js`;
    });
    const impact = this.computeImpact(targets, consumerUpdates);
    this.logger.info(
      `\u041F\u043B\u0430\u043D: ${targets.length} \u043C\u043E\u0434\u0443\u043B\u0435\u0439, ${impact.consumersAffected} \u043F\u043E\u0442\u0440\u0435\u0431\u0438\u0442\u0435\u043B\u0435\u0439, ${impact.totalSymbolsMoved} \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432`
    );
    return {
      sourceFile: godFile.filePath,
      targets,
      barrelExports,
      consumerUpdates,
      impact,
      createdAt: Date.now()
    };
  }
  estimateImpact(plan) {
    return plan.impact.consumersAffected * 2 + plan.impact.filesCreated;
  }
  /** Формирует целевой модуль из кластера */
  buildTarget(cluster, targetDir, godFile, index) {
    const fileName = `${cluster.suggestedName}.ts`;
    const targetPath = join3(targetDir, fileName);
    const imports = this.resolveClusterImports(cluster, godFile);
    const exports = cluster.symbols.filter((s) => s.isExported).map((s) => s.name);
    const estimatedLines = cluster.linesCount + imports.length * 2 + 5;
    return { targetPath, symbols: cluster.symbols, imports, exports, estimatedLines };
  }
  /** Собирает зависимости (imports) для символов кластера */
  resolveClusterImports(cluster, godFile) {
    const allImports = godFile.analysis.imports;
    const symbolNames = new Set(cluster.symbols.flatMap((s) => [...s.calledSymbols, ...s.usedThisProps]));
    const deps = [];
    const addedSources = /* @__PURE__ */ new Set();
    for (const imp of allImports) {
      const usedSymbols = imp.symbols.filter((s) => symbolNames.has(s));
      if (usedSymbols.length === 0) continue;
      if (addedSources.has(imp.source)) continue;
      addedSources.add(imp.source);
      deps.push({
        source: imp.source,
        symbols: usedSymbols,
        isTypeOnly: imp.isTypeOnly
      });
    }
    return deps;
  }
  /** Формирует обновления import'ов для потребителей */
  buildConsumerUpdates(consumers, godFile, targets) {
    const updates = [];
    const symbolToTarget = /* @__PURE__ */ new Map();
    for (const target of targets) {
      for (const exp of target.exports) {
        symbolToTarget.set(exp, target);
      }
    }
    for (const consumer of consumers) {
      const targetGroups = /* @__PURE__ */ new Map();
      for (const [symbolName, target] of symbolToTarget) {
        const key = target.targetPath;
        const group = targetGroups.get(key) ?? [];
        group.push(symbolName);
        targetGroups.set(key, group);
      }
      for (const [targetPath, symbols] of targetGroups) {
        const newPath = this.importResolver.computeNewPath(consumer, targetPath);
        updates.push({
          consumerFile: consumer,
          oldImportPath: this.computeRelPath(consumer, godFile.filePath),
          newImportPath: newPath,
          importedSymbols: symbols,
          isTypeOnly: false
        });
      }
    }
    return updates;
  }
  computeRelPath(from, to) {
    return this.importResolver.computeNewPath(from, to);
  }
  computeImpact(targets, consumerUpdates) {
    const consumerFiles = new Set(consumerUpdates.map((u) => u.consumerFile));
    const totalSymbolsMoved = targets.reduce((sum, t) => sum + t.symbols.length, 0);
    return {
      filesCreated: targets.length + 1,
      // +1 для barrel
      filesModified: consumerFiles.size,
      filesDeleted: 1,
      // Исходный god-файл
      totalSymbolsMoved,
      consumersAffected: consumerFiles.size
    };
  }
};

// solid-refactor/planners/split-validator.ts
import { existsSync as existsSync2 } from "node:fs";
import { basename as basename2 } from "node:path";
var SplitValidator = class {
  logger;
  constructor(logger) {
    this.logger = logger;
  }
  validate(plan, projectRoot) {
    const errors = [];
    const warnings = [];
    this.checkEmptyTargets(plan.targets, errors);
    this.checkFileNameConflicts(plan.targets, errors);
    this.checkDuplicateSymbols(plan.targets, errors);
    const cycles = this.checkCircularDeps(plan.targets);
    for (const cycle of cycles) {
      warnings.push({
        code: "CIRCULAR_DEP",
        message: `\u0426\u0438\u043A\u043B\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0437\u0430\u0432\u0438\u0441\u0438\u043C\u043E\u0441\u0442\u044C: ${cycle}`,
        file: plan.sourceFile,
        severity: "warning"
      });
    }
    const originalExports = plan.targets.flatMap((t) => t.exports);
    const missingExports = this.checkExportIntegrity(plan, originalExports);
    for (const missing of missingExports) {
      errors.push({
        code: "MISSING_EXPORT",
        message: `\u041F\u043E\u0442\u0435\u0440\u044F\u043D \u044D\u043A\u0441\u043F\u043E\u0440\u0442: ${missing}`,
        file: plan.sourceFile,
        severity: "critical"
      });
    }
    this.checkExistingFiles(plan.targets, warnings);
    this.checkTargetSizes(plan.targets, warnings);
    const isValid = errors.length === 0;
    this.logger.debug(
      `\u0412\u0430\u043B\u0438\u0434\u0430\u0446\u0438\u044F \u043F\u043B\u0430\u043D\u0430: ${isValid ? "OK" : "FAIL"} (${errors.length} \u043E\u0448\u0438\u0431\u043E\u043A, ${warnings.length} \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0439)`
    );
    return { isValid, errors, warnings };
  }
  checkCircularDeps(targets) {
    const cycles = [];
    const graph = /* @__PURE__ */ new Map();
    for (const target of targets) {
      const deps = /* @__PURE__ */ new Set();
      const targetSymbolNames = new Set(target.symbols.map((s) => s.name));
      for (const symbol of target.symbols) {
        for (const called of symbol.calledSymbols) {
          if (targetSymbolNames.has(called)) continue;
          for (const other of targets) {
            if (other === target) continue;
            if (other.symbols.some((s) => s.name === called)) {
              deps.add(other.targetPath);
              break;
            }
          }
        }
      }
      graph.set(target.targetPath, deps);
    }
    const visited = /* @__PURE__ */ new Set();
    const inStack = /* @__PURE__ */ new Set();
    const dfs = (node, path) => {
      if (inStack.has(node)) {
        const cycleStart = path.indexOf(node);
        const cycle = path.slice(cycleStart).map((p) => basename2(p, ".ts")).join(" \u2192 ");
        cycles.push(`${cycle} \u2192 ${basename2(node, ".ts")}`);
        return;
      }
      if (visited.has(node)) return;
      visited.add(node);
      inStack.add(node);
      path.push(node);
      for (const dep of graph.get(node) ?? []) {
        dfs(dep, [...path]);
      }
      inStack.delete(node);
    };
    for (const target of targets) {
      dfs(target.targetPath, []);
    }
    return cycles;
  }
  checkExportIntegrity(plan, originalExports) {
    const allPlannedExports = new Set(plan.targets.flatMap((t) => t.exports));
    return originalExports.filter((e) => !allPlannedExports.has(e));
  }
  checkEmptyTargets(targets, errors) {
    for (const target of targets) {
      if (target.symbols.length === 0) {
        errors.push({
          code: "EMPTY_TARGET",
          message: `\u041F\u0443\u0441\u0442\u043E\u0439 \u043C\u043E\u0434\u0443\u043B\u044C: ${basename2(target.targetPath)}`,
          file: target.targetPath,
          severity: "critical"
        });
      }
    }
  }
  checkFileNameConflicts(targets, errors) {
    const paths = /* @__PURE__ */ new Set();
    for (const target of targets) {
      if (paths.has(target.targetPath)) {
        errors.push({
          code: "DUPLICATE_PATH",
          message: `\u0414\u0443\u0431\u043B\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u043F\u0443\u0442\u0438: ${target.targetPath}`,
          file: target.targetPath,
          severity: "critical"
        });
      }
      paths.add(target.targetPath);
    }
  }
  checkDuplicateSymbols(targets, errors) {
    const symbolOwner = /* @__PURE__ */ new Map();
    for (const target of targets) {
      for (const symbol of target.symbols) {
        const existing = symbolOwner.get(symbol.name);
        if (existing) {
          errors.push({
            code: "DUPLICATE_SYMBOL",
            message: `\u0421\u0438\u043C\u0432\u043E\u043B "${symbol.name}" \u043F\u0440\u0438\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u0432 "${basename2(existing)}" \u0438 "${basename2(target.targetPath)}"`,
            file: target.targetPath,
            severity: "critical"
          });
        }
        symbolOwner.set(symbol.name, target.targetPath);
      }
    }
  }
  checkExistingFiles(targets, warnings) {
    for (const target of targets) {
      if (existsSync2(target.targetPath)) {
        warnings.push({
          code: "FILE_EXISTS",
          message: `\u0424\u0430\u0439\u043B \u0443\u0436\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442: ${target.targetPath}`,
          file: target.targetPath,
          severity: "warning"
        });
      }
    }
  }
  checkTargetSizes(targets, warnings) {
    for (const target of targets) {
      if (target.estimatedLines > 200) {
        warnings.push({
          code: "TARGET_TOO_LARGE",
          message: `\u041C\u043E\u0434\u0443\u043B\u044C ${basename2(target.targetPath)} \u2248${target.estimatedLines} \u0441\u0442\u0440\u043E\u043A (\u043F\u043E\u0440\u043E\u0433: 200)`,
          file: target.targetPath,
          severity: "warning"
        });
      }
    }
  }
};

// solid-refactor/generators/code-extractor.ts
var CodeExtractor = class {
  logger;
  constructor(logger) {
    this.logger = logger;
  }
  extractSymbolCode(fileContent, symbol) {
    const lines = fileContent.split("\n");
    const startLine = symbol.range.start.line;
    const endLine = symbol.range.end.line;
    const docLines = this.extractDocComment(lines, startLine);
    const bodyLines = lines.slice(startLine, endLine + 1);
    const result = [...docLines, ...bodyLines].join("\n");
    return result;
  }
  extractImportsForSymbols(allImports, symbols) {
    const usedIdentifiers = this.collectUsedIdentifiers(symbols);
    const neededImports = [];
    for (const imp of allImports) {
      const usedFromImport = imp.symbols.filter((s) => usedIdentifiers.has(s));
      if (usedFromImport.length === 0) continue;
      neededImports.push({
        source: imp.source,
        symbols: usedFromImport,
        isTypeOnly: imp.isTypeOnly,
        raw: this.rebuildImportLine(usedFromImport, imp.source, imp.isTypeOnly),
        line: imp.line
      });
    }
    this.logger.debug(
      `\u0418\u0437\u0432\u043B\u0435\u0447\u0435\u043D\u043E ${neededImports.length} \u0438\u043C\u043F\u043E\u0440\u0442\u043E\u0432 \u0434\u043B\u044F ${symbols.length} \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432`
    );
    return neededImports;
  }
  /** Извлекает JSDoc-комментарий перед символом */
  extractDocComment(lines, symbolLine) {
    let idx = symbolLine - 1;
    while (idx >= 0 && (lines[idx] ?? "").trim() === "") idx--;
    if (idx < 0) return [];
    const line = (lines[idx] ?? "").trim();
    if (!line.endsWith("*/")) return [];
    let start = idx;
    while (start >= 0 && !(lines[start] ?? "").trim().startsWith("/**")) start--;
    if (start < 0) return [];
    return lines.slice(start, idx + 1).map((l) => l);
  }
  /** Собирает все идентификаторы, используемые в телах символов */
  collectUsedIdentifiers(symbols) {
    const identifiers = /* @__PURE__ */ new Set();
    for (const symbol of symbols) {
      for (const call of symbol.calledSymbols) {
        identifiers.add(call);
      }
      const bodyIdentifiers = this.scanBodyIdentifiers(symbol.body);
      for (const id of bodyIdentifiers) {
        identifiers.add(id);
      }
    }
    return identifiers;
  }
  /** Сканирует тело символа на использование идентификаторов */
  scanBodyIdentifiers(body) {
    const ids = /* @__PURE__ */ new Set();
    const idRe = /\b([A-Z][a-zA-Z0-9]+|[a-z][a-zA-Z0-9]+)\b/g;
    const reserved = /* @__PURE__ */ new Set([
      "if",
      "else",
      "for",
      "while",
      "do",
      "switch",
      "case",
      "break",
      "continue",
      "return",
      "throw",
      "try",
      "catch",
      "finally",
      "new",
      "delete",
      "typeof",
      "instanceof",
      "void",
      "this",
      "class",
      "interface",
      "type",
      "enum",
      "extends",
      "implements",
      "import",
      "export",
      "default",
      "from",
      "as",
      "async",
      "await",
      "const",
      "let",
      "var",
      "function",
      "true",
      "false",
      "null",
      "undefined",
      "string",
      "number",
      "boolean",
      "object",
      "any",
      "unknown",
      "never",
      "void",
      "readonly",
      "private",
      "public",
      "protected",
      "static",
      "abstract",
      "override"
    ]);
    for (const m of body.matchAll(idRe)) {
      const name = m[1] ?? "";
      if (name.length >= 2 && !reserved.has(name)) {
        ids.add(name);
      }
    }
    return ids;
  }
  /** Восстанавливает строку import из списка символов */
  rebuildImportLine(symbols, source, isTypeOnly) {
    const typePrefix = isTypeOnly ? "type " : "";
    const symbolsList = symbols.join(", ");
    return `import ${typePrefix}{ ${symbolsList} } from '${source}';`;
  }
};

// solid-refactor/generators/module-generator.ts
import { basename as basename3 } from "node:path";
var FILE_HEADER = (moduleName, symbolCount) => `/**
 * ${moduleName} \u2014 \u043C\u043E\u0434\u0443\u043B\u044C, \u0441\u043E\u0434\u0435\u0440\u0436\u0430\u0449\u0438\u0439 ${symbolCount} \u0441\u0438\u043C\u0432\u043E\u043B(\u043E\u0432).
 * \u0421\u043E\u0437\u0434\u0430\u043D \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 SOLID Refactorer.
 */
`;
var ModuleGenerator = class {
  codeExtractor;
  logger;
  constructor(codeExtractor, logger) {
    this.codeExtractor = codeExtractor;
    this.logger = logger;
  }
  generate(target, sourceContent, allImports) {
    const moduleName = basename3(target.targetPath, ".ts");
    const sections = [];
    sections.push(FILE_HEADER(moduleName, target.symbols.length));
    const importLines = this.buildImportLines(target.imports, allImports, target.symbols);
    if (importLines.length > 0) {
      sections.push(importLines.join("\n"));
      sections.push("");
    }
    for (const symbol of target.symbols) {
      const code = this.codeExtractor.extractSymbolCode(sourceContent, symbol);
      const exportedCode = this.ensureExport(code, symbol);
      sections.push(exportedCode);
      sections.push("");
    }
    const content = sections.join("\n").trimEnd() + "\n";
    this.logger.debug(`\u0421\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u043D \u043C\u043E\u0434\u0443\u043B\u044C: ${moduleName} (${content.split("\n").length} \u0441\u0442\u0440\u043E\u043A)`);
    return {
      path: target.targetPath,
      content,
      isNew: true
    };
  }
  /** Строит строки импортов для модуля */
  buildImportLines(targetImports, allImports, symbols) {
    const lines = [];
    const usedIdentifiers = this.collectAllUsedIdentifiers(symbols);
    for (const dep of targetImports) {
      const needed = dep.symbols.filter((s) => usedIdentifiers.has(s));
      if (needed.length === 0) continue;
      const typePrefix = dep.isTypeOnly ? "type " : "";
      lines.push(`import ${typePrefix}{ ${needed.join(", ")} } from '${dep.source}';`);
    }
    const crossImports = this.findCrossDependencyImports(symbols, allImports, usedIdentifiers);
    lines.push(...crossImports);
    return lines;
  }
  /** Находит импорты для зависимостей на символы из других кластеров */
  findCrossDependencyImports(symbols, allImports, usedIdentifiers) {
    const lines = [];
    const alreadyImported = /* @__PURE__ */ new Set();
    for (const imp of allImports) {
      const needed = imp.symbols.filter((s) => usedIdentifiers.has(s));
      if (needed.length === 0) continue;
      const key = `${imp.source}:${needed.join(",")}`;
      if (alreadyImported.has(key)) continue;
      alreadyImported.add(key);
      const typePrefix = imp.isTypeOnly ? "type " : "";
      lines.push(`import ${typePrefix}{ ${needed.join(", ")} } from '${imp.source}';`);
    }
    return lines;
  }
  /** Собирает все идентификаторы, используемые символами */
  collectAllUsedIdentifiers(symbols) {
    const ids = /* @__PURE__ */ new Set();
    for (const s of symbols) {
      for (const call of s.calledSymbols) ids.add(call);
      for (const prop of s.usedThisProps) ids.add(prop);
      const typeRe = /\b([A-Z][a-zA-Z0-9]+)\b/g;
      for (const m of s.body.matchAll(typeRe)) {
        if (m[1]) ids.add(m[1]);
      }
    }
    return ids;
  }
  /** Гарантирует наличие export перед символом */
  ensureExport(code, symbol) {
    if (!symbol.isExported) return code;
    if (code.trimStart().startsWith("export ")) return code;
    return code.replace(
      /^(\s*)(async\s+)?(function|class|interface|type|const|let|var|abstract)/m,
      "$1export $2$3"
    );
  }
};

// solid-refactor/generators/import-rewriter.ts
var ImportRewriter = class {
  logger;
  constructor(logger) {
    this.logger = logger;
  }
  rewriteFile(consumerPath, consumerContent, updates) {
    let content = consumerContent;
    const grouped = this.groupByOldPath(updates);
    for (const [oldPath, groupUpdates] of grouped) {
      content = this.rewriteImportGroup(content, oldPath, groupUpdates);
    }
    return {
      path: consumerPath,
      content,
      isNew: false
    };
  }
  findImportsFrom(content, importSource) {
    const results = [];
    const lines = content.split("\n");
    const sourceNoExt = importSource.replace(/\.(ts|tsx|js|jsx)$/, "");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const importMatch = line.match(
        /^[ \t]*import\s+(type\s+)?(?:\{([^}]*)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/
      );
      if (!importMatch) continue;
      const source = importMatch[4] ?? "";
      const sourceClean = source.replace(/\.(ts|tsx|js|jsx)$/, "");
      if (sourceClean === sourceNoExt || source === importSource) {
        const isTypeOnly = !!importMatch[1];
        const namedSymbols = (importMatch[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const defaultSymbol = importMatch[3] ? [importMatch[3]] : [];
        results.push({
          source,
          symbols: [...defaultSymbol, ...namedSymbols],
          isTypeOnly,
          raw: line.trim(),
          line: i
        });
      }
    }
    return results;
  }
  /** Группирует обновления по старому пути импорта */
  groupByOldPath(updates) {
    const grouped = /* @__PURE__ */ new Map();
    for (const update of updates) {
      const existing = grouped.get(update.oldImportPath) ?? [];
      existing.push(update);
      grouped.set(update.oldImportPath, existing);
    }
    return grouped;
  }
  /** Перезаписывает группу импортов с одного старого пути */
  rewriteImportGroup(content, oldPath, updates) {
    const lines = content.split("\n");
    const oldPathNoExt = oldPath.replace(/\.(ts|tsx|js|jsx)$/, "");
    let importLineIdx = -1;
    let importLine = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const match = line.match(/from\s+['"]([^'"]+)['"]/);
      if (!match) continue;
      const source = (match[1] ?? "").replace(/\.(ts|tsx|js|jsx)$/, "");
      if (source === oldPathNoExt) {
        importLineIdx = i;
        importLine = line;
        break;
      }
    }
    if (importLineIdx === -1) return content;
    const newImportLines = this.buildNewImportLines(updates, importLine);
    const result = [...lines];
    result.splice(importLineIdx, 1, ...newImportLines);
    return result.join("\n");
  }
  /** Строит новые строки импортов на основе обновлений */
  buildNewImportLines(updates, originalLine) {
    const lines = [];
    const indent = originalLine.match(/^(\s*)/)?.[1] ?? "";
    const isOriginalTypeOnly = originalLine.includes("import type");
    for (const update of updates) {
      const typePrefix = update.isTypeOnly ? "type " : "";
      const symbols = update.importedSymbols.join(", ");
      lines.push(`${indent}import ${typePrefix}{ ${symbols} } from '${update.newImportPath}';`);
    }
    return lines;
  }
};

// solid-refactor/generators/barrel-generator.ts
import { basename as basename4, dirname as dirname4, relative as relative3, posix as posix3, sep as sep3 } from "node:path";
var BarrelGenerator = class {
  logger;
  constructor(logger) {
    this.logger = logger;
  }
  generate(originalPath, targets) {
    const originalName = basename4(originalPath, ".ts");
    const targetDir = dirname4(targets[0]?.targetPath ?? originalPath);
    const barrelPath = originalPath;
    const lines = [];
    lines.push(`/**`);
    lines.push(` * Barrel-\u0444\u0430\u0439\u043B: re-export \u0438\u0437 \u0440\u0430\u0437\u0431\u0438\u0442\u044B\u0445 \u043C\u043E\u0434\u0443\u043B\u0435\u0439.`);
    lines.push(` * \u041E\u0440\u0438\u0433\u0438\u043D\u0430\u043B\u044C\u043D\u044B\u0439 \u0444\u0430\u0439\u043B: ${originalName}.ts`);
    lines.push(` * \u0421\u043E\u0437\u0434\u0430\u043D \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 SOLID Refactorer.`);
    lines.push(` */`);
    lines.push("");
    for (const target of targets) {
      const moduleName = basename4(target.targetPath, ".ts");
      const relPath = this.computeRelativePath(originalPath, target.targetPath);
      if (target.exports.length === 0) {
        lines.push(`export * from '${relPath}';`);
      } else {
        const exports = target.exports.join(", ");
        lines.push(`export { ${exports} } from '${relPath}';`);
      }
    }
    lines.push("");
    const content = lines.join("\n");
    this.logger.debug(
      `Barrel: ${barrelPath} \u2014 ${targets.length} re-export'\u043E\u0432`
    );
    return {
      path: barrelPath,
      content,
      isNew: false
      // Заменяем оригинальный файл
    };
  }
  /** Вычисляет относительный путь от barrel к модулю */
  computeRelativePath(from, to) {
    const fromDir = dirname4(from);
    let rel = relative3(fromDir, to);
    rel = rel.split(sep3).join(posix3.sep);
    rel = rel.replace(/\.(ts|tsx)$/, "");
    if (!rel.startsWith(".")) {
      rel = "./" + rel;
    }
    rel += ".js";
    return rel;
  }
};

// solid-refactor/verifiers/compilation-checker.ts
import { execSync } from "node:child_process";
import { join as join4 } from "node:path";
import { existsSync as existsSync3 } from "node:fs";
var CompilationChecker = class {
  logger;
  constructor(logger) {
    this.logger = logger;
  }
  check(projectRoot) {
    const tsConfigPath = this.findTsConfig(projectRoot);
    if (!tsConfigPath) {
      this.logger.warn("tsconfig.json \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u2014 \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u0435\u043C \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443 \u043A\u043E\u043C\u043F\u0438\u043B\u044F\u0446\u0438\u0438");
      return { success: true, errors: [], duration: 0 };
    }
    const startTime = Date.now();
    this.logger.info("\u0417\u0430\u043F\u0443\u0441\u043A tsc --noEmit...");
    try {
      const cmd = `npx tsc --noEmit --project "${tsConfigPath}"`;
      execSync(cmd, {
        cwd: projectRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 6e4
      });
      const duration = Date.now() - startTime;
      this.logger.success(`\u041A\u043E\u043C\u043F\u0438\u043B\u044F\u0446\u0438\u044F OK (${duration}ms)`);
      return { success: true, errors: [], duration };
    } catch (err) {
      const duration = Date.now() - startTime;
      const output = this.extractErrorOutput(err);
      const errors = this.parseTscErrors(output);
      this.logger.error(`\u041A\u043E\u043C\u043F\u0438\u043B\u044F\u0446\u0438\u044F FAIL: ${errors.length} \u043E\u0448\u0438\u0431\u043E\u043A (${duration}ms)`);
      return { success: false, errors, duration };
    }
  }
  parseTscErrors(output) {
    const errors = [];
    const errorRe = /^(.+)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/gm;
    for (const m of output.matchAll(errorRe)) {
      errors.push({
        file: m[1] ?? "",
        line: parseInt(m[2] ?? "0", 10),
        column: parseInt(m[3] ?? "0", 10),
        code: m[5] ?? "",
        message: m[6] ?? ""
      });
    }
    const altRe = /^(.+):(\d+):(\d+)\s*-\s*(error|warning)\s+(TS\d+):\s*(.+)$/gm;
    for (const m of output.matchAll(altRe)) {
      const existing = errors.find(
        (e) => e.file === m[1] && e.line === parseInt(m[2] ?? "0", 10)
      );
      if (!existing) {
        errors.push({
          file: m[1] ?? "",
          line: parseInt(m[2] ?? "0", 10),
          column: parseInt(m[3] ?? "0", 10),
          code: m[5] ?? "",
          message: m[6] ?? ""
        });
      }
    }
    return errors;
  }
  /** Находит tsconfig.json в проекте */
  findTsConfig(projectRoot) {
    const candidates = ["tsconfig.json", "tsconfig.build.json"];
    for (const name of candidates) {
      const full = join4(projectRoot, name);
      if (existsSync3(full)) return full;
    }
    return null;
  }
  /** Извлекает текст ошибки из Exception */
  extractErrorOutput(err) {
    if (err && typeof err === "object") {
      const errObj = err;
      const stderr = errObj["stderr"];
      const stdout = errObj["stdout"];
      if (typeof stderr === "string" && stderr.length > 0) return stderr;
      if (typeof stdout === "string" && stdout.length > 0) return stdout;
      if (typeof errObj["message"] === "string") return errObj["message"];
    }
    return String(err);
  }
};

// solid-refactor/verifiers/rollback-manager.ts
import { readFileSync as readFileSync3, writeFileSync, existsSync as existsSync4, mkdirSync, unlinkSync, rmdirSync } from "node:fs";
import { dirname as dirname5 } from "node:path";
import { randomUUID } from "node:crypto";
var RollbackManager = class {
  logger;
  snapshots = /* @__PURE__ */ new Map();
  constructor(logger) {
    this.logger = logger;
  }
  createSnapshot(filePaths) {
    const files = /* @__PURE__ */ new Map();
    let savedCount = 0;
    for (const filePath of filePaths) {
      if (existsSync4(filePath)) {
        const content = readFileSync3(filePath, "utf-8");
        files.set(filePath, content);
        savedCount++;
      } else {
        files.set(filePath, "___FILE_NOT_EXISTS___");
      }
    }
    const id = randomUUID().slice(0, 8);
    const snapshot = {
      id,
      files,
      createdAt: Date.now()
    };
    this.snapshots.set(id, snapshot);
    this.logger.info(`\u0421\u043D\u0438\u043C\u043E\u043A \u0441\u043E\u0437\u0434\u0430\u043D: ${id} (${savedCount} \u0444\u0430\u0439\u043B\u043E\u0432)`);
    return snapshot;
  }
  rollback(snapshot) {
    this.logger.warn(`\u041E\u0442\u043A\u0430\u0442 \u043A \u0441\u043D\u0438\u043C\u043A\u0443 ${snapshot.id}...`);
    let restored = 0;
    let deleted = 0;
    for (const [filePath, content] of snapshot.files) {
      try {
        if (content === "___FILE_NOT_EXISTS___") {
          if (existsSync4(filePath)) {
            unlinkSync(filePath);
            deleted++;
          }
        } else {
          this.ensureDir(filePath);
          writeFileSync(filePath, content, "utf-8");
          restored++;
        }
      } catch (err) {
        this.logger.error(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C: ${filePath} \u2014 ${String(err)}`);
      }
    }
    this.cleanupEmptyDirs(snapshot);
    this.logger.info(`\u041E\u0442\u043A\u0430\u0442 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D: ${restored} \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E, ${deleted} \u0443\u0434\u0430\u043B\u0435\u043D\u043E`);
  }
  commit(snapshot) {
    this.snapshots.delete(snapshot.id);
    this.logger.debug(`\u0421\u043D\u0438\u043C\u043E\u043A ${snapshot.id} \u0437\u0430\u0444\u0438\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u043D (\u0443\u0434\u0430\u043B\u0451\u043D \u0438\u0437 \u043F\u0430\u043C\u044F\u0442\u0438)`);
  }
  /** Создаёт директорию если не существует */
  ensureDir(filePath) {
    const dir = dirname5(filePath);
    if (!existsSync4(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  /** Удаляет пустые директории, созданные рефакторингом */
  cleanupEmptyDirs(snapshot) {
    const dirsToCheck = /* @__PURE__ */ new Set();
    for (const [filePath, content] of snapshot.files) {
      if (content === "___FILE_NOT_EXISTS___") {
        dirsToCheck.add(dirname5(filePath));
      }
    }
    for (const dir of dirsToCheck) {
      try {
        if (existsSync4(dir)) {
          rmdirSync(dir);
          this.logger.debug(`\u0423\u0434\u0430\u043B\u0435\u043D\u0430 \u043F\u0443\u0441\u0442\u0430\u044F \u0434\u0438\u0440\u0435\u043A\u0442\u043E\u0440\u0438\u044F: ${dir}`);
        }
      } catch {
      }
    }
  }
};

// solid-refactor/orchestrator.ts
import { readFileSync as readFileSync4, writeFileSync as writeFileSync2, mkdirSync as mkdirSync2, existsSync as existsSync5 } from "node:fs";
import { dirname as dirname6, relative as relative4, basename as basename5 } from "node:path";
var RefactorOrchestrator = class {
  deps;
  constructor(deps) {
    this.deps = deps;
  }
  runFullRefactor(config) {
    const startTime = Date.now();
    const { logger } = this.deps;
    logger.phase(1, 5, "\u0410\u041D\u0410\u041B\u0418\u0417");
    const analysis = this.analyzeOnly(config);
    const reports = analysis.reports;
    if (reports.length === 0) {
      logger.success("God-\u0444\u0430\u0439\u043B\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B. \u041F\u0440\u043E\u0435\u043A\u0442 \u0447\u0438\u0441\u0442!");
      return this.buildResult("analyze", 0, 0, [], [], [], startTime);
    }
    logger.info(`\u041D\u0430\u0439\u0434\u0435\u043D\u043E ${reports.length} god-\u0444\u0430\u0439\u043B(\u043E\u0432)`);
    logger.phase(2, 5, "\u041F\u041B\u0410\u041D\u0418\u0420\u041E\u0412\u0410\u041D\u0418\u0415");
    const plans = [];
    for (const report of reports) {
      const plan = this.planSingleFile(report, config);
      if (plan) plans.push(plan);
    }
    if (plans.length === 0) {
      logger.warn("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u0444\u043E\u0440\u043C\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043D\u0438 \u043E\u0434\u043D\u043E\u0433\u043E \u043F\u043B\u0430\u043D\u0430");
      return this.buildResult("plan", reports.length, 0, [], [], [], startTime);
    }
    if (config.dryRun) {
      this.printPlans(plans);
      return this.buildResult("plan", reports.length, 0, [], [], [], startTime);
    }
    logger.phase(3, 5, "\u0413\u0415\u041D\u0415\u0420\u0410\u0426\u0418\u042F \u041A\u041E\u0414\u0410");
    const allFilesToWrite = [];
    const allAffectedPaths = [];
    for (const plan of plans) {
      const { files, affectedPaths } = this.generateForPlan(plan, config);
      allFilesToWrite.push(...files);
      allAffectedPaths.push(...affectedPaths);
    }
    logger.phase(4, 5, "\u0417\u0410\u041F\u0418\u0421\u042C \u0424\u0410\u0419\u041B\u041E\u0412");
    const snapshot = this.deps.rollbackManager.createSnapshot(allAffectedPaths);
    this.writeFiles(allFilesToWrite);
    logger.phase(5, 5, "\u0412\u0415\u0420\u0418\u0424\u0418\u041A\u0410\u0426\u0418\u042F");
    const compileResult = this.deps.compilationChecker.check(config.projectRoot);
    if (!compileResult.success) {
      logger.error("\u041A\u043E\u043C\u043F\u0438\u043B\u044F\u0446\u0438\u044F \u043F\u0440\u043E\u0432\u0430\u043B\u0435\u043D\u0430 \u2014 \u043E\u0442\u043A\u0430\u0442!");
      this.deps.rollbackManager.rollback(snapshot);
      const errors = compileResult.errors.map(
        (e) => `${e.file}:${e.line} \u2014 ${e.code}: ${e.message}`
      );
      return this.buildResult("verify", reports.length, 0, [], [], errors, startTime);
    }
    this.deps.rollbackManager.commit(snapshot);
    const created = allFilesToWrite.filter((f) => f.isNew).map((f) => f.path);
    const modified = allFilesToWrite.filter((f) => !f.isNew).map((f) => f.path);
    logger.success(
      `\u0420\u0435\u0444\u0430\u043A\u0442\u043E\u0440\u0438\u043D\u0433 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D: ${created.length} \u0441\u043E\u0437\u0434\u0430\u043D\u043E, ${modified.length} \u043C\u043E\u0434\u0438\u0444\u0438\u0446\u0438\u0440\u043E\u0432\u0430\u043D\u043E`
    );
    return this.buildResult("verify", reports.length, plans.length, created, modified, [], startTime);
  }
  analyzeOnly(config) {
    const { fileAnalyzer, godDetector, depAnalyzer, clusterer, logger } = this.deps;
    godDetector.setThresholds(config.thresholds);
    const analyses = fileAnalyzer.analyzeProject(config.projectRoot, config.extensions);
    const totalFiles = analyses.length;
    const totalLines = analyses.reduce((sum, a) => sum + a.lineCount, 0);
    logger.success(`\u041D\u0430\u0439\u0434\u0435\u043D\u043E ${totalFiles} \u0444\u0430\u0439\u043B\u043E\u0432  (${totalLines.toLocaleString("ru-RU")} \u0441\u0442\u0440\u043E\u043A)`);
    const godFiles = godDetector.detect(analyses);
    const reports = [];
    for (const godFile of godFiles) {
      const graph = depAnalyzer.buildSymbolGraph(godFile.filePath, godFile.analysis.symbols);
      const clusters = clusterer.clusterize(godFile, graph);
      reports.push({ godFile, clusters, symbolGraph: graph });
    }
    return { reports, totalFiles, totalLines };
  }
  planOnly(godFilePath, config) {
    const { reports } = this.analyzeOnly(config);
    const report = reports.find((r) => r.godFile.filePath.includes(godFilePath));
    if (!report) return null;
    return this.planSingleFile(report, config);
  }
  /** Планирует разбиение одного god-файла */
  planSingleFile(report, config) {
    const { splitPlanner, splitValidator, logger } = this.deps;
    const plan = splitPlanner.createPlan(
      report.godFile,
      report.clusters,
      report.symbolGraph,
      config.projectRoot
    );
    const validation = splitValidator.validate(plan, config.projectRoot);
    if (!validation.isValid) {
      for (const err of validation.errors) {
        logger.error(`\u0412\u0430\u043B\u0438\u0434\u0430\u0446\u0438\u044F: [${err.code}] ${err.message}`);
      }
      return null;
    }
    for (const warn of validation.warnings) {
      logger.warn(`\u0412\u0430\u043B\u0438\u0434\u0430\u0446\u0438\u044F: [${warn.code}] ${warn.message}`);
    }
    return plan;
  }
  /** Генерирует файлы для одного плана */
  generateForPlan(plan, config) {
    const { moduleGenerator, importRewriter, barrelGenerator, logger } = this.deps;
    const files = [];
    const affectedPaths = [plan.sourceFile];
    const sourceContent = readFileSync4(plan.sourceFile, "utf-8");
    for (const target of plan.targets) {
      const generated = moduleGenerator.generate(
        target,
        sourceContent,
        this.deps.fileAnalyzer.analyzeFile(plan.sourceFile).imports
      );
      files.push(generated);
      affectedPaths.push(target.targetPath);
      logger.progress(files.length, plan.targets.length, basename5(target.targetPath));
    }
    const barrel = barrelGenerator.generate(plan.sourceFile, plan.targets);
    files.push(barrel);
    const consumerGroups = this.groupUpdatesByConsumer(plan);
    for (const [consumerPath, updates] of consumerGroups) {
      try {
        const consumerContent = readFileSync4(consumerPath, "utf-8");
        const rewritten = importRewriter.rewriteFile(consumerPath, consumerContent, updates);
        files.push(rewritten);
        affectedPaths.push(consumerPath);
      } catch (err) {
        logger.warn(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u043F\u043E\u0442\u0440\u0435\u0431\u0438\u0442\u0435\u043B\u044C: ${consumerPath}`);
      }
    }
    return { files, affectedPaths };
  }
  /** Группирует обновления по consumer'у */
  groupUpdatesByConsumer(plan) {
    const grouped = /* @__PURE__ */ new Map();
    for (const update of plan.consumerUpdates) {
      const existing = grouped.get(update.consumerFile) ?? [];
      existing.push(update);
      grouped.set(update.consumerFile, existing);
    }
    return grouped;
  }
  /** Записывает сгенерированные файлы на диск */
  writeFiles(files) {
    for (const file of files) {
      const dir = dirname6(file.path);
      if (!existsSync5(dir)) {
        mkdirSync2(dir, { recursive: true });
      }
      writeFileSync2(file.path, file.content, "utf-8");
      this.deps.logger.debug(`\u0417\u0430\u043F\u0438\u0441\u0430\u043D: ${relative4(process.cwd(), file.path)}`);
    }
  }
  /** Выводит планы в dry-run режиме */
  printPlans(plans) {
    const { logger } = this.deps;
    for (const plan of plans) {
      logger.info(`
\u{1F4C4} ${relative4(process.cwd(), plan.sourceFile)}`);
      for (const target of plan.targets) {
        const symbolNames = target.symbols.map((s) => s.name).join(", ");
        logger.info(`  \u2192 ${basename5(target.targetPath)} (${symbolNames})`);
      }
      logger.info(`  \u{1F4CA} \u0412\u043B\u0438\u044F\u043D\u0438\u0435: ${plan.impact.filesCreated} \u0441\u043E\u0437\u0434\u0430\u043D\u043E, ${plan.impact.consumersAffected} \u043F\u043E\u0442\u0440\u0435\u0431\u0438\u0442\u0435\u043B\u0435\u0439`);
    }
  }
  buildResult(phase, godFilesFound, godFilesRefactored, filesCreated, filesModified, errors, startTime) {
    return {
      success: errors.length === 0,
      phase,
      godFilesFound,
      godFilesRefactored,
      filesCreated,
      filesModified,
      errors,
      duration: Date.now() - startTime
    };
  }
};

// solid-refactor/cli.ts
var VERSION = "1.0.0";
function printBanner(log, config) {
  const mode = config.dryRun ? "dry-run" : "analyze";
  const exts = config.extensions.join(", ");
  const shortPath = config.projectRoot.length > 36 ? "..." + config.projectRoot.slice(-33) : config.projectRoot;
  console.log("");
  log.boxTop();
  log.boxLine(`\u{1F527} SOLID Refactorer  v${VERSION}`);
  log.boxLine(`\u25CF ${shortPath}    ${exts}`);
  log.boxBot();
  console.log("");
}
function printGodReport(log, reports) {
  console.log("");
  log.boxTop();
  log.boxLine(`\u{1F4CA}  GOD-\u0424\u0410\u0419\u041B\u042B  (${reports.length} \u043D\u0430\u0439\u0434\u0435\u043D\u043E)`);
  log.boxDiv();
  for (const report of reports) {
    const { godFile, clusters } = report;
    const rel = relative5(process.cwd(), godFile.filePath);
    const score = godFile.godScore;
    const icon = severityIcon(godFile.severity);
    log.boxEmpty();
    log.boxLine(`${icon} ${rel}`);
    log.boxLine(`   \u0421\u0442\u0440\u043E\u043A: ${godFile.analysis.lineCount}  \xB7  \u0421\u0438\u043C\u0432\u043E\u043B\u043E\u0432: ${godFile.analysis.symbolCount}  \xB7  Score: ${score.total.toFixed(2)}`);
    log.boxLine(`   ${scoreBar(score.total)}  ${(score.total * 100).toFixed(0)}%`);
    if (clusters.length > 0) {
      const maxShow = 3;
      const shown = clusters.slice(0, maxShow);
      const rest = clusters.length - maxShow;
      for (let i = 0; i < shown.length; i++) {
        const c = shown[i];
        const prefix = i < shown.length - 1 && rest <= 0 ? "\u251C\u2500\u2500" : i === shown.length - 1 && rest <= 0 ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500";
        log.boxLine(`   ${prefix} ${c.suggestedName} [${c.linesCount} \u0441\u0442\u0440\u043E\u043A]`);
      }
      if (rest > 0) {
        log.boxLine(`   \u2514\u2500\u2500 +${rest} \u0435\u0449\u0451`);
      }
    }
  }
  log.boxEmpty();
  log.boxBot();
}
function printSummary(log, result, reports) {
  const { totalFiles, totalLines } = result;
  const critical = reports.filter((r) => r.godFile.severity === "critical").length;
  const warning = reports.filter((r) => r.godFile.severity === "warning").length;
  const info = reports.filter((r) => r.godFile.severity === "info").length;
  const totalClusters = reports.reduce((s, r) => s + r.clusters.length, 0);
  const pct = totalFiles > 0 ? Math.round(reports.length / totalFiles * 100) : 0;
  console.log("");
  log.boxTop();
  log.boxLine("\u{1F4C8}  \u0421\u0412\u041E\u0414\u041A\u0410 \u0410\u041D\u0410\u041B\u0418\u0417\u0410");
  log.boxDiv();
  log.boxLine(`\u{1F4C1}  \u0424\u0430\u0439\u043B\u043E\u0432 \u043F\u0440\u043E\u0430\u043D\u0430\u043B\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D\u043E:   ${totalFiles}  (${fmtNum(totalLines)} \u0441\u0442\u0440\u043E\u043A)`);
  log.boxLine(`\u{1F50D}  God-\u0444\u0430\u0439\u043B\u043E\u0432:                ${reports.length}  (${pct}%)`);
  log.boxDiv();
  log.boxLine(`\u{1F534}  \u041A\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0445 (score \u2265 0.6): ${critical}`);
  log.boxLine(`\u{1F7E1}  \u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0439:            ${warning}`);
  log.boxLine(`\u{1F535}  \u0418\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u043E\u043D\u043D\u044B\u0445:            ${info}`);
  log.boxDiv();
  log.boxLine(`\u{1F4E6}  \u041A\u043B\u0430\u0441\u0442\u0435\u0440\u043E\u0432:                 ${totalClusters} \u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043D\u043D\u043E\u0441\u0442\u0435\u0439`);
  log.boxLine(`\u23F1   \u0412\u0440\u0435\u043C\u044F:                     ${log.elapsed()}`);
  log.boxBot();
}
function printRefactorResult(log, result) {
  const icon = result.success ? "\u2705" : "\u274C";
  console.log("");
  log.boxTop();
  log.boxLine(`${icon}  \u0420\u0415\u0417\u0423\u041B\u042C\u0422\u0410\u0422 \u0420\u0415\u0424\u0410\u041A\u0422\u041E\u0420\u0418\u041D\u0413\u0410`);
  log.boxDiv();
  log.boxLine(`God-\u0444\u0430\u0439\u043B\u043E\u0432 \u043D\u0430\u0439\u0434\u0435\u043D\u043E:      ${result.godFilesFound}`);
  log.boxLine(`God-\u0444\u0430\u0439\u043B\u043E\u0432 \u0440\u0435\u0444\u0430\u043A\u0442\u043E\u0440\u0435\u043D\u043E:  ${result.godFilesRefactored}`);
  log.boxLine(`\u0424\u0430\u0439\u043B\u043E\u0432 \u0441\u043E\u0437\u0434\u0430\u043D\u043E:          ${result.filesCreated.length}`);
  log.boxLine(`\u0424\u0430\u0439\u043B\u043E\u0432 \u043C\u043E\u0434\u0438\u0444\u0438\u0446\u0438\u0440\u043E\u0432\u0430\u043D\u043E:   ${result.filesModified.length}`);
  log.boxLine(`\u041E\u0448\u0438\u0431\u043E\u043A:                  ${result.errors.length}`);
  log.boxDiv();
  log.boxLine(`\u23F1   \u0412\u0440\u0435\u043C\u044F:  ${result.duration}ms`);
  log.boxBot();
  if (result.errors.length > 0) {
    console.log("");
    log.error("\u041E\u0448\u0438\u0431\u043A\u0438:");
    for (const err of result.errors) {
      log.error(`  ${err}`);
    }
  }
}
function severityIcon(severity) {
  switch (severity) {
    case "critical":
      return "\u{1F534}";
    case "warning":
      return "\u{1F7E1}";
    case "info":
      return "\u{1F535}";
  }
}
function scoreBar(value) {
  const w = 20;
  const filled = Math.round(w * value);
  return "\u2588".repeat(filled) + "\u2591".repeat(w - filled);
}
function fmtNum(n) {
  return n.toLocaleString("ru-RU");
}
function createOrchestrator(log) {
  const fileAnalyzer = new FileAnalyzer(log);
  const godDetector = new GodFileDetector(log);
  const depAnalyzer = new SymbolDependencyAnalyzer(log);
  const clusterer = new ResponsibilityClusterer(log);
  const importResolver = new ImportResolver(log);
  const splitPlanner = new SplitPlanner(importResolver, log);
  const splitValidator = new SplitValidator(log);
  const codeExtractor = new CodeExtractor(log);
  const moduleGenerator = new ModuleGenerator(codeExtractor, log);
  const importRewriter = new ImportRewriter(log);
  const barrelGenerator = new BarrelGenerator(log);
  const compilationChecker = new CompilationChecker(log);
  const rollbackManager = new RollbackManager(log);
  return new RefactorOrchestrator({
    fileAnalyzer,
    godDetector,
    depAnalyzer,
    clusterer,
    importResolver,
    splitPlanner,
    splitValidator,
    codeExtractor,
    moduleGenerator,
    importRewriter,
    barrelGenerator,
    compilationChecker,
    rollbackManager,
    logger: log
  });
}
function main() {
  const cliArgs = parseCliArgs(process.argv);
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }
  const config = buildConfig(cliArgs);
  const log = new ConsoleRefactorLogger(config.verbose);
  printBanner(log, config);
  const orchestrator = createOrchestrator(log);
  if (cliArgs.analyzeOnly) {
    runAnalyzeOnly(log, orchestrator, config);
    process.exit(0);
  }
  runFullOrDryRun(log, orchestrator, config);
}
function runAnalyzeOnly(log, orchestrator, config) {
  log.phase(1, 3, "\u0421\u041A\u0410\u041D\u0418\u0420\u041E\u0412\u0410\u041D\u0418\u0415");
  log.info(`\u041F\u0443\u0442\u044C:    ${config.projectRoot}`);
  log.info(`\u0420\u0430\u0441\u0448:    ${config.extensions.join(", ")}`);
  log.info(`\u0420\u0435\u0436\u0438\u043C:   \u0422\u043E\u043B\u044C\u043A\u043E \u0430\u043D\u0430\u043B\u0438\u0437`);
  log.info(`\u041F\u043E\u0440\u043E\u0433\u0438:  \u0441\u0442\u0440\u043E\u043A \u2265${config.thresholds.maxLines}  \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432 \u2265${config.thresholds.maxSymbols}  score \u2265${config.thresholds.minGodScore}`);
  const result = orchestrator.analyzeOnly(config);
  log.phase(2, 3, "\u0414\u0415\u0422\u0415\u041A\u0426\u0418\u042F GOD-\u0424\u0410\u0419\u041B\u041E\u0412");
  const { reports, totalFiles } = result;
  const pct = totalFiles > 0 ? Math.round(reports.length / totalFiles * 100) : 0;
  log.success(`${reports.length} god-\u0444\u0430\u0439\u043B\u043E\u0432 \u0438\u0437 ${totalFiles}  (${pct}%)`);
  if (reports.length > 0) {
    const crit = reports.filter((r) => r.godFile.severity === "critical").length;
    const warn = reports.filter((r) => r.godFile.severity === "warning").length;
    const inf = reports.filter((r) => r.godFile.severity === "info").length;
    log.info(`\u{1F534} ${crit} \u043A\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0445  \u{1F7E1} ${warn} \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0439  \u{1F535} ${inf} \u0438\u043D\u0444\u043E`);
  }
  log.phase(3, 3, "\u041A\u041B\u0410\u0421\u0422\u0415\u0420\u041D\u042B\u0419 \u0410\u041D\u0410\u041B\u0418\u0417");
  const totalClusters = reports.reduce((s, r) => s + r.clusters.length, 0);
  log.success(`${totalClusters} \u043A\u043B\u0430\u0441\u0442\u0435\u0440\u043E\u0432 \u0432 ${reports.length} \u0444\u0430\u0439\u043B\u0430\u0445`);
  if (reports.length > 0) {
    printGodReport(log, reports);
  }
  printSummary(log, result, reports);
  console.log("");
  log.success(`\u0410\u043D\u0430\u043B\u0438\u0437 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D \u0437\u0430 ${log.elapsed()}.  --dry-run \u0434\u043B\u044F \u043F\u043B\u0430\u043D\u043E\u0432 \u0440\u0435\u0444\u0430\u043A\u0442\u043E\u0440\u0438\u043D\u0433\u0430.`);
}
function runFullOrDryRun(log, orchestrator, config) {
  const result = orchestrator.runFullRefactor(config);
  printRefactorResult(log, result);
  process.exit(result.success ? 0 : 1);
}
main();
