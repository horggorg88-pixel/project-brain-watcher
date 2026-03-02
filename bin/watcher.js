#!/usr/bin/env node

// cli/watch.ts
import { createHash as createHash2 } from "node:crypto";
import { readFileSync as readFileSync2, writeFileSync, mkdirSync, statSync, readdirSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import chokidar from "chokidar";

// src/ast-compressor/ast-compressor.ts
import { readFileSync } from "node:fs";

// src/ast-compressor/parsers/parser-registry.ts
var ParserRegistry = class {
  parsersByExtension = /* @__PURE__ */ new Map();
  parsersByLanguage = /* @__PURE__ */ new Map();
  /**
   * Регистрирует парсер для его расширений
   */
  register(parser) {
    this.parsersByLanguage.set(parser.language, parser);
    for (const ext of parser.extensions) {
      this.parsersByExtension.set(ext.toLowerCase(), parser);
    }
  }
  /**
   * Находит парсер по расширению файла
   */
  getByExtension(extension) {
    return this.parsersByExtension.get(extension.toLowerCase()) ?? null;
  }
  /**
   * Находит парсер по языку
   */
  getByLanguage(language) {
    return this.parsersByLanguage.get(language) ?? null;
  }
  /**
   * Находит парсер по пути к файлу (извлекает расширение)
   */
  getByFilePath(filePath) {
    const dotIndex = filePath.lastIndexOf(".");
    if (dotIndex === -1) {
      return null;
    }
    const extension = filePath.slice(dotIndex).toLowerCase();
    return this.getByExtension(extension);
  }
  /**
   * Возвращает все зарегистрированные расширения
   */
  getSupportedExtensions() {
    return [...this.parsersByExtension.keys()];
  }
  /**
   * Проверяет, поддерживается ли файл
   */
  isSupported(filePath) {
    return this.getByFilePath(filePath) !== null;
  }
};

// src/ast-compressor/parsers/base-parser.ts
import { createHash } from "node:crypto";
var BaseParser = class {
  logger;
  constructor(logger) {
    this.logger = logger;
  }
  /**
   * Основной метод парсинга: код → результат
   */
  parse(code, filePath) {
    const buildMetadata = (code2, symbols) => ({
      path: filePath,
      language: this.language,
      hash: createHash("md5").update(code2).digest("hex"),
      sizeBytes: Buffer.byteLength(code2, "utf-8"),
      lineCount: code2.split("\n").length,
      symbolCount: symbols.length,
      lastModified: Date.now(),
      isIndexed: false
    });
    try {
      const symbols = this.extractSymbols(code, filePath);
      return {
        metadata: buildMetadata(code, symbols),
        symbols,
        imports: this.extractImports(code),
        exports: symbols.filter((s) => s.isExported).map((s) => s.name),
        errors: []
      };
    } catch (err) {
      this.logger.warn(`Parse error in ${filePath}: ${err}`);
      return {
        metadata: buildMetadata(code, []),
        symbols: [],
        imports: [],
        exports: [],
        errors: [{ message: String(err) }]
      };
    }
  }
  /**
   * Извлекает импорты (может быть переопределён)
   */
  extractImports(code) {
    const imports = [];
    const importRegex = /^[ \t]*import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"]([^'"]+)['"]/gm;
    let match;
    while ((match = importRegex.exec(code)) !== null) {
      imports.push(match[1]);
    }
    return imports;
  }
  /**
   * Извлекает JSDoc-комментарии с их позициями
   */
  extractDocComments(code) {
    const comments = /* @__PURE__ */ new Map();
    const regex = /\/\*\*\s*([\s\S]*?)\s*\*\//g;
    let match;
    while ((match = regex.exec(code)) !== null) {
      const line = code.substring(0, match.index).split("\n").length;
      comments.set(line, match[1].replace(/^\s*\*\s?/gm, "").trim());
    }
    return comments;
  }
  /**
   * Вычисляет номер строки (0-based) по смещению символа в коде
   */
  getLineNumber(code, index) {
    let line = 0;
    for (let i = 0; i < index && i < code.length; i++) {
      if (code[i] === "\n") {
        line++;
      }
    }
    return line;
  }
  /**
   * Конструирует Range из номеров строк
   */
  buildRange(startLine, endLine) {
    return {
      start: { line: startLine, column: 0 },
      end: { line: endLine, column: 0 }
    };
  }
  /**
   * Ищет закрывающую скобку `}`, корректно пропуская строки, шаблонные литералы и комментарии.
   * Используется всеми brace-based парсерами (TS, C#, Go, Java, Rust).
   */
  findClosingBrace(lines, startLine) {
    let depth = 0;
    let foundOpening = false;
    let inMultiLineComment = false;
    let inString = null;
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i] ?? "";
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        const next = line[j + 1] ?? "";
        if (inMultiLineComment) {
          if (ch === "*" && next === "/") {
            inMultiLineComment = false;
            j++;
          }
          continue;
        }
        if (inString !== null) {
          if (ch === "\\") {
            j++;
            continue;
          }
          if (ch === inString) {
            inString = null;
          }
          continue;
        }
        if (ch === "/" && next === "/") {
          break;
        }
        if (ch === "/" && next === "*") {
          inMultiLineComment = true;
          j++;
          continue;
        }
        if (ch === "'" || ch === '"' || ch === "`") {
          inString = ch;
          continue;
        }
        if (ch === "{") {
          depth++;
          foundOpening = true;
        } else if (ch === "}") {
          depth--;
        }
        if (foundOpening && depth === 0) {
          return i;
        }
      }
    }
    return Math.min(startLine + 50, lines.length - 1);
  }
};

// src/ast-compressor/parsers/typescript-parser.ts
var PATTERNS = {
  // Функции: export async function name(params): ReturnType { 
  FUNCTION: /^[ \t]*(export\s+)?(default\s+)?(async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+(?:\s*\|\s*[^\s{]+)*))?\s*\{/gm,
  // Стрелочные функции: export const name = (async) (params): ReturnType =>
  // Также ловит: export const name = async (params) => и export const name = param =>
  ARROW_FUNCTION: /^[ \t]*(export\s+)?(const|let)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?(?:\(([^)]*)\)|(\w+))(?:\s*:\s*([^\s=]+(?:\s*\|\s*[^\s=]+)*))?\s*=>/gm,
  // Классы: export class Name extends Base implements I1, I2 {
  CLASS: /^[ \t]*(export\s+)?(default\s+)?(abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w\s,]+))?\s*\{/gm,
  // Интерфейсы: export interface Name extends Base {
  INTERFACE: /^[ \t]*(export\s+)?interface\s+(\w+)(?:\s+extends\s+([\w\s,]+))?\s*\{/gm,
  // Типы: export type Name = ...
  TYPE_ALIAS: /^[ \t]*(export\s+)?type\s+(\w+)(?:<[^>]*>)?\s*=\s*(.+)/gm,
  // Переменные/константы: export const/let NAME = value
  VARIABLE: /^[ \t]*(export\s+)?(const|let|var)\s+(\w+)(?:\s*:\s*([^=]+))?\s*=/gm,
  // Методы класса: async methodName(params): ReturnType {
  METHOD: /^[ \t]*(public|private|protected|static|abstract|async|readonly|\s)*(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+(?:\s*\|\s*[^\s{]+)*))?\s*\{/gm,
  // Импорты
  IMPORT: /^[ \t]*import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"]([^'"]+)['"]/gm,
  // JSDoc комментарий перед символом
  JSDOC: /\/\*\*\s*([\s\S]*?)\s*\*\//g
};
var TypeScriptParser = class extends BaseParser {
  language = "typescript";
  extensions = [".ts", ".tsx", ".js", ".jsx"];
  constructor(logger) {
    super(logger);
  }
  extractSymbols(code, filePath) {
    const symbols = [];
    const lines = code.split("\n");
    const docComments = this.extractDocComments(code);
    symbols.push(...this.extractFunctions(code, filePath, lines, docComments));
    symbols.push(...this.extractArrowFunctions(code, filePath, lines, docComments));
    symbols.push(...this.extractClasses(code, filePath, lines));
    symbols.push(...this.extractInterfaces(code, filePath, lines));
    symbols.push(...this.extractTypeAliases(code, filePath, lines));
    symbols.push(...this.extractVariables(code, filePath, lines));
    return symbols;
  }
  extractImports(code) {
    const imports = [];
    const regex = new RegExp(PATTERNS.IMPORT.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      if (match[1]) {
        imports.push(match[1]);
      }
    }
    return imports;
  }
  extractExports(_code, symbols) {
    return symbols.filter((s) => s.isExported).map((s) => s.name);
  }
  // === ПРИВАТНЫЕ МЕТОДЫ ИЗВЛЕЧЕНИЯ ===
  extractFunctions(code, filePath, lines, docComments) {
    const results = [];
    const regex = new RegExp(PATTERNS.FUNCTION.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const name = match[4] ?? "anonymous";
      const isExported = Boolean(match[1]);
      const isAsync = Boolean(match[3]);
      const paramsStr = match[5] ?? "";
      const returnType = match[6] ?? null;
      const parameters = this.parseParameters(paramsStr);
      const docComment = this.findDocComment(docComments, lineNum);
      const endLine = this.findClosingBrace(lines, lineNum);
      const signature = this.buildFunctionSignature(isExported, isAsync, name, parameters, returnType);
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "function",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature,
        isExported,
        parameters,
        returnType,
        isAsync,
        isStatic: false,
        docComment
      });
    }
    return results;
  }
  extractArrowFunctions(code, filePath, _lines, docComments) {
    const results = [];
    const regex = new RegExp(PATTERNS.ARROW_FUNCTION.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const name = match[3] ?? "anonymous";
      const isExported = Boolean(match[1]);
      const isAsync = Boolean(match[4]);
      const paramsStr = match[5] ?? match[6] ?? "";
      const returnType = match[7] ?? null;
      const parameters = this.parseParameters(paramsStr);
      const docComment = this.findDocComment(docComments, lineNum);
      const signature = this.buildFunctionSignature(isExported, isAsync, name, parameters, returnType);
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "function",
        filePath,
        range: this.buildRange(lineNum, lineNum),
        signature,
        isExported,
        parameters,
        returnType,
        isAsync,
        isStatic: false,
        docComment
      });
    }
    return results;
  }
  extractClasses(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS.CLASS.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const name = match[4] ?? "AnonymousClass";
      const isExported = Boolean(match[1]);
      const isAbstract = Boolean(match[3]);
      const extendsClass = match[5] ?? null;
      const implementsList = match[6] ? match[6].split(",").map((s) => s.trim()).filter(Boolean) : [];
      const endLine = this.findClosingBrace(lines, lineNum);
      const classBody = lines.slice(lineNum, endLine + 1).join("\n");
      const members = this.extractClassMethods(classBody, filePath, lineNum);
      const signature = this.buildClassSignature(isExported, isAbstract, name, extendsClass, implementsList);
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "class",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature,
        isExported,
        extends: extendsClass,
        implements: implementsList,
        members,
        isAbstract
      });
    }
    return results;
  }
  extractInterfaces(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS.INTERFACE.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const name = match[2] ?? "AnonymousInterface";
      const isExported = Boolean(match[1]);
      const extendsStr = match[3] ?? "";
      const endLine = this.findClosingBrace(lines, lineNum);
      const signature = isExported ? `export interface ${name}${extendsStr ? ` extends ${extendsStr.trim()}` : ""}` : `interface ${name}${extendsStr ? ` extends ${extendsStr.trim()}` : ""}`;
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "interface",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature,
        isExported
      });
    }
    return results;
  }
  extractTypeAliases(code, filePath, _lines) {
    const results = [];
    const regex = new RegExp(PATTERNS.TYPE_ALIAS.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const name = match[2] ?? "AnonymousType";
      const isExported = Boolean(match[1]);
      const value = (match[3] ?? "").trim().slice(0, 100);
      const signature = isExported ? `export type ${name} = ${value}` : `type ${name} = ${value}`;
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "type",
        filePath,
        range: this.buildRange(lineNum, lineNum),
        signature,
        isExported
      });
    }
    return results;
  }
  extractVariables(code, filePath, _lines) {
    const results = [];
    const regex = new RegExp(PATTERNS.VARIABLE.source, "gm");
    let match;
    const arrowFnNames = /* @__PURE__ */ new Set();
    const arrowRegex = new RegExp(PATTERNS.ARROW_FUNCTION.source, "gm");
    let arrowMatch;
    while ((arrowMatch = arrowRegex.exec(code)) !== null) {
      if (arrowMatch[3]) {
        arrowFnNames.add(arrowMatch[3]);
      }
    }
    while ((match = regex.exec(code)) !== null) {
      const name = match[3] ?? "anonymous";
      if (arrowFnNames.has(name)) {
        continue;
      }
      const lineNum = this.getLineNumber(code, match.index);
      const isExported = Boolean(match[1]);
      const kind = match[2] ?? "const";
      const dataType = match[4]?.trim() ?? null;
      const isConst = kind === "const";
      const signature = `${isExported ? "export " : ""}${kind} ${name}${dataType ? `: ${dataType}` : ""}`;
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: isConst ? "constant" : "variable",
        filePath,
        range: this.buildRange(lineNum, lineNum),
        signature,
        isExported,
        dataType,
        isConst
      });
    }
    return results;
  }
  // === УТИЛИТАРНЫЕ МЕТОДЫ ===
  extractClassMethods(classBody, filePath, classStartLine) {
    const methods = [];
    const regex = new RegExp(PATTERNS.METHOD.source, "gm");
    let match;
    while ((match = regex.exec(classBody)) !== null) {
      const modifiers = (match[1] ?? "").trim();
      const name = match[2];
      if (!name || name === "constructor" || name === "class" || name === "if" || name === "for" || name === "while") {
        continue;
      }
      const lineNum = classStartLine + this.getLineNumber(classBody, match.index);
      const paramsStr = match[3] ?? "";
      const returnType = match[4] ?? null;
      const signature = `${modifiers ? modifiers + " " : ""}${name}(${paramsStr})${returnType ? `: ${returnType}` : ""}`;
      methods.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "method",
        filePath,
        range: this.buildRange(lineNum, lineNum),
        signature,
        isExported: false
      });
    }
    return methods;
  }
  parseParameters(paramsStr) {
    if (!paramsStr.trim()) {
      return [];
    }
    return paramsStr.split(",").map((param) => {
      const trimmed = param.trim();
      const isOptional = trimmed.includes("?");
      const hasDefault = trimmed.includes("=");
      const parts = trimmed.split(/[?:=]/).map((p) => p.trim()).filter(Boolean);
      const name = parts[0] ?? "param";
      const type = parts[1] ?? null;
      const defaultValue = hasDefault ? parts[2] ?? null : null;
      return { name, type, isOptional: isOptional || hasDefault, defaultValue };
    });
  }
  extractDocComments(code) {
    const comments = /* @__PURE__ */ new Map();
    const regex = new RegExp(PATTERNS.JSDOC.source, "g");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const endLine = this.getLineNumber(code, match.index + match[0].length);
      const content = (match[1] ?? "").split("\n").map((line) => line.replace(/^\s*\*\s?/, "").trim()).filter(Boolean).join(" ");
      comments.set(endLine + 1, content);
    }
    return comments;
  }
  findDocComment(docComments, symbolLine) {
    return docComments.get(symbolLine) ?? docComments.get(symbolLine - 1) ?? null;
  }
  buildFunctionSignature(isExported, isAsync, name, parameters, returnType) {
    const parts = [];
    if (isExported)
      parts.push("export");
    if (isAsync)
      parts.push("async");
    parts.push("function");
    parts.push(name);
    const paramsStr = parameters.map((p) => `${p.name}${p.isOptional ? "?" : ""}${p.type ? `: ${p.type}` : ""}`).join(", ");
    return `${parts.join(" ")}(${paramsStr})${returnType ? `: ${returnType}` : ""}`;
  }
  buildClassSignature(isExported, isAbstract, name, extendsClass, implementsList) {
    const parts = [];
    if (isExported)
      parts.push("export");
    if (isAbstract)
      parts.push("abstract");
    parts.push("class");
    parts.push(name);
    if (extendsClass)
      parts.push(`extends ${extendsClass}`);
    if (implementsList.length > 0)
      parts.push(`implements ${implementsList.join(", ")}`);
    return parts.join(" ");
  }
};

// src/ast-compressor/parsers/markdown-parser.ts
var MarkdownParser = class extends BaseParser {
  language = "markdown";
  extensions = [".md", ".mdx"];
  constructor(logger) {
    super(logger);
  }
  extractSymbols(code, filePath) {
    const lines = code.split("\n");
    const headings = this.extractHeadings(lines);
    const symbols = [];
    for (const heading of headings) {
      symbols.push(this.headingToSymbol(heading, filePath));
    }
    const codeBlocks = this.extractCodeBlocks(lines, filePath);
    symbols.push(...codeBlocks);
    const topLevelLists = this.extractTopLevelLists(lines, headings, filePath);
    symbols.push(...topLevelLists);
    return symbols;
  }
  extractImports(_code) {
    return [];
  }
  extractHeadings(lines) {
    const headings = [];
    const headingRegex = /^(#{1,6})\s+(.+)$/;
    for (let i = 0; i < lines.length; i++) {
      const match = headingRegex.exec(lines[i]);
      if (!match) continue;
      const level = match[1].length;
      const text = match[2].trim();
      if (headings.length > 0) {
        const prev = headings[headings.length - 1];
        this.fillHeadingContent(lines, prev, i);
      }
      headings.push({
        level,
        text,
        line: i,
        endLine: i,
        children: [],
        codeBlocks: [],
        listItems: [],
        contentPreview: ""
      });
    }
    if (headings.length > 0) {
      const last = headings[headings.length - 1];
      this.fillHeadingContent(lines, last, lines.length);
    }
    return headings;
  }
  fillHeadingContent(lines, heading, nextHeadingLine) {
    const contentLines = [];
    let inCodeBlock = false;
    for (let i = heading.line + 1; i < nextHeadingLine; i++) {
      const line = lines[i];
      if (line.startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        if (!inCodeBlock && heading.codeBlocks.length < 3) {
          heading.codeBlocks.push(line);
        }
        continue;
      }
      if (inCodeBlock) continue;
      if (/^[-*+]\s/.test(line.trim())) {
        const item = line.trim().replace(/^[-*+]\s+/, "");
        if (heading.listItems.length < 10) {
          heading.listItems.push(item);
        }
      }
      if (line.trim().length > 0 && !line.startsWith("#")) {
        contentLines.push(line.trim());
      }
    }
    heading.endLine = nextHeadingLine - 1;
    heading.contentPreview = contentLines.slice(0, 3).join(" ").slice(0, 200);
  }
  headingToSymbol(heading, filePath) {
    const symbolType = this.headingLevelToType(heading.level);
    const signature = this.buildHeadingSignature(heading);
    const base = {
      id: `${filePath}:${heading.text}:${heading.line}`,
      name: heading.text,
      type: symbolType,
      filePath,
      range: {
        start: { line: heading.line, column: 0 },
        end: { line: heading.endLine, column: 0 }
      },
      signature,
      isExported: heading.level <= 2
    };
    if (symbolType === "class" || symbolType === "interface") {
      return { ...base, members: [], extends: null, implements: [] };
    }
    return base;
  }
  headingLevelToType(level) {
    switch (level) {
      case 1:
        return "class";
      case 2:
        return "interface";
      case 3:
        return "function";
      default:
        return "method";
    }
  }
  buildHeadingSignature(heading) {
    const prefix = "#".repeat(heading.level);
    const parts = [`${prefix} ${heading.text}`];
    if (heading.contentPreview) {
      parts.push(`// ${heading.contentPreview}`);
    }
    if (heading.listItems.length > 0) {
      const shown = heading.listItems.slice(0, 5);
      for (const item of shown) {
        parts.push(`  - ${item}`);
      }
      if (heading.listItems.length > 5) {
        parts.push(`  ... +${heading.listItems.length - 5} items`);
      }
    }
    return parts.join("\n");
  }
  extractCodeBlocks(lines, filePath) {
    const blocks = [];
    let inBlock = false;
    let blockStart = 0;
    let blockLang = "";
    let blockContent = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("```") && !inBlock) {
        inBlock = true;
        blockStart = i;
        blockLang = line.slice(3).trim();
        blockContent = [];
        continue;
      }
      if (line.startsWith("```") && inBlock) {
        inBlock = false;
        if (blockContent.length > 0 && blockContent.length <= 50) {
          const name = blockLang ? `code:${blockLang}:L${blockStart + 1}` : `code:L${blockStart + 1}`;
          const preview = blockContent.slice(0, 5).join("\n");
          blocks.push({
            id: `${filePath}:${name}:${blockStart}`,
            name,
            type: "constant",
            filePath,
            range: {
              start: { line: blockStart, column: 0 },
              end: { line: i, column: 0 }
            },
            signature: `\`\`\`${blockLang}
${preview}${blockContent.length > 5 ? "\n..." : ""}
\`\`\``,
            isExported: false
          });
        }
        continue;
      }
      if (inBlock) {
        blockContent.push(line);
      }
    }
    return blocks;
  }
  extractTopLevelLists(lines, headings, filePath) {
    if (headings.length === 0) return [];
    const symbols = [];
    const firstHeadingLine = headings[0].line;
    const preambleItems = [];
    for (let i = 0; i < firstHeadingLine; i++) {
      const trimmed = lines[i].trim();
      if (/^[-*+]\s/.test(trimmed)) {
        preambleItems.push(trimmed.replace(/^[-*+]\s+/, ""));
      }
    }
    if (preambleItems.length > 0) {
      symbols.push({
        id: `${filePath}:preamble-list:0`,
        name: "preamble",
        type: "property",
        filePath,
        range: {
          start: { line: 0, column: 0 },
          end: { line: firstHeadingLine - 1, column: 0 }
        },
        signature: preambleItems.map((item) => `- ${item}`).join("\n"),
        isExported: false
      });
    }
    return symbols;
  }
};

// src/ast-compressor/parsers/python-parser.ts
var PATTERNS2 = {
  FUNCTION: /^([ \t]*)(async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^\s:]+(?:\[[^\]]*\])?))?:\s*$/gm,
  CLASS: /^([ \t]*)class\s+(\w+)(?:\(([^)]*)\))?:\s*$/gm,
  IMPORT_FROM: /^[ \t]*from\s+([\w.]+)\s+import\s+(.+)$/gm,
  IMPORT: /^[ \t]*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)$/gm,
  VARIABLE: /^([ \t]*)(\w+)\s*(?::\s*([^=\n]+))?\s*=\s*(.+)$/gm,
  DECORATOR: /^[ \t]*@(\w+(?:\.\w+)*(?:\([^)]*\))?)\s*$/gm,
  DOCSTRING: /^[ \t]*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/
};
var PythonParser = class extends BaseParser {
  language = "python";
  extensions = [".py"];
  constructor(logger) {
    super(logger);
  }
  extractSymbols(code, filePath) {
    const lines = code.split("\n");
    const symbols = [];
    symbols.push(...this.extractClasses(code, filePath, lines));
    symbols.push(...this.extractFunctions(code, filePath, lines));
    symbols.push(...this.extractModuleVariables(code, filePath, lines));
    return symbols;
  }
  extractImports(code) {
    const imports = [];
    const fromRegex = new RegExp(PATTERNS2.IMPORT_FROM.source, "gm");
    let match;
    while ((match = fromRegex.exec(code)) !== null) {
      imports.push(match[1]);
    }
    const importRegex = new RegExp(PATTERNS2.IMPORT.source, "gm");
    while ((match = importRegex.exec(code)) !== null) {
      const modules = match[1].split(",").map((m) => m.trim()).filter(Boolean);
      imports.push(...modules);
    }
    return imports;
  }
  extractFunctions(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS2.FUNCTION.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const indent = match[1];
      if (indent.length > 0) continue;
      const lineNum = this.getLineNumber(code, match.index);
      const isAsync = Boolean(match[2]);
      const name = match[3] ?? "anonymous";
      const paramsStr = match[4] ?? "";
      const returnType = match[5] ?? null;
      const endLine = this.findBlockEndByIndent(lines, lineNum);
      const isExported = !name.startsWith("_");
      const parameters = this.parseParameters(paramsStr);
      const docComment = this.extractDocstring(lines, lineNum + 1);
      const signature = this.buildPythonFunctionSignature(isAsync, name, parameters, returnType);
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "function",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature,
        isExported,
        parameters,
        returnType,
        isAsync,
        isStatic: false,
        docComment
      });
    }
    return results;
  }
  extractClasses(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS2.CLASS.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const indent = match[1];
      if (indent.length > 0) continue;
      const lineNum = this.getLineNumber(code, match.index);
      const name = match[2] ?? "AnonymousClass";
      const basesStr = match[3] ?? "";
      const endLine = this.findBlockEndByIndent(lines, lineNum);
      const isExported = !name.startsWith("_");
      const bases = basesStr ? basesStr.split(",").map((b) => b.trim()).filter(Boolean) : [];
      const extendsClass = bases[0] ?? null;
      const classBody = lines.slice(lineNum + 1, endLine + 1).join("\n");
      const members = this.extractClassMethods(classBody, filePath, lineNum + 1);
      const signature = `class ${name}${bases.length > 0 ? `(${bases.join(", ")})` : ""}`;
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "class",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature,
        isExported,
        extends: extendsClass,
        implements: [],
        members
      });
    }
    return results;
  }
  extractClassMethods(classBody, filePath, classStartLine) {
    const methods = [];
    const regex = new RegExp(PATTERNS2.FUNCTION.source, "gm");
    let match;
    while ((match = regex.exec(classBody)) !== null) {
      const name = match[3];
      if (!name) continue;
      const isAsync = Boolean(match[2]);
      const paramsStr = match[4] ?? "";
      const returnType = match[5] ?? null;
      const lineNum = classStartLine + this.getLineNumber(classBody, match.index);
      const parameters = this.parseParameters(paramsStr).filter((p) => p.name !== "self" && p.name !== "cls");
      const isStatic = name === "__init__" ? false : paramsStr.trim().startsWith("cls");
      const signature = `${isAsync ? "async " : ""}def ${name}(${parameters.map((p) => p.name + (p.type ? `: ${p.type}` : "")).join(", ")})${returnType ? ` -> ${returnType}` : ""}`;
      methods.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "method",
        filePath,
        range: this.buildRange(lineNum, lineNum),
        signature,
        isExported: !name.startsWith("_") || name.startsWith("__") && name.endsWith("__"),
        isAsync,
        isStatic
      });
    }
    return methods;
  }
  extractModuleVariables(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS2.VARIABLE.source, "gm");
    let match;
    const functionAndClassLines = /* @__PURE__ */ new Set();
    const fnRegex = new RegExp(PATTERNS2.FUNCTION.source, "gm");
    while ((match = fnRegex.exec(code)) !== null) {
      functionAndClassLines.add(this.getLineNumber(code, match.index));
    }
    const clsRegex = new RegExp(PATTERNS2.CLASS.source, "gm");
    while ((match = clsRegex.exec(code)) !== null) {
      functionAndClassLines.add(this.getLineNumber(code, match.index));
    }
    const varRegex = new RegExp(PATTERNS2.VARIABLE.source, "gm");
    while ((match = varRegex.exec(varRegex.source === code ? code : code)) !== null) {
      break;
    }
    const varRegex2 = new RegExp(PATTERNS2.VARIABLE.source, "gm");
    while ((match = varRegex2.exec(code)) !== null) {
      const indent = match[1];
      if (indent.length > 0) continue;
      const lineNum = this.getLineNumber(code, match.index);
      if (functionAndClassLines.has(lineNum)) continue;
      const name = match[2];
      if (!name || name === "self" || name === "cls") continue;
      if (/^(import|from|def|class|return|if|else|elif|for|while|try|except|finally|with|raise|assert|yield|pass|break|continue)$/.test(name)) continue;
      const dataType = match[3]?.trim() ?? null;
      const isConst = name === name.toUpperCase() && name.length > 1;
      const isExported = !name.startsWith("_");
      const signature = `${name}${dataType ? `: ${dataType}` : ""}`;
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: isConst ? "constant" : "variable",
        filePath,
        range: this.buildRange(lineNum, lineNum),
        signature,
        isExported,
        dataType,
        isConst
      });
    }
    return results;
  }
  /**
   * Определяет конец блока по отступам (Python-specific).
   * Блок заканчивается когда встречается непустая строка с indent <= indent стартовой строки.
   */
  findBlockEndByIndent(lines, startLine) {
    const startIndent = this.getIndentLevel(lines[startLine] ?? "");
    let lastContentLine = startLine;
    for (let i = startLine + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.trim().length === 0) continue;
      const currentIndent = this.getIndentLevel(line);
      if (currentIndent <= startIndent) {
        return lastContentLine;
      }
      lastContentLine = i;
    }
    return lastContentLine;
  }
  getIndentLevel(line) {
    let indent = 0;
    for (const ch of line) {
      if (ch === " ") indent++;
      else if (ch === "	") indent += 4;
      else break;
    }
    return indent;
  }
  parseParameters(paramsStr) {
    if (!paramsStr.trim()) return [];
    return paramsStr.split(",").map((param) => {
      const trimmed = param.trim();
      if (!trimmed || trimmed === "self" || trimmed === "cls" || trimmed.startsWith("*") || trimmed.startsWith("/")) {
        return { name: trimmed || "param", type: null, isOptional: false, defaultValue: null };
      }
      const hasDefault = trimmed.includes("=");
      const parts = trimmed.split("=");
      const nameType = (parts[0] ?? "").trim();
      const defaultValue = hasDefault ? (parts[1] ?? "").trim() : null;
      const colonIdx = nameType.indexOf(":");
      const name = colonIdx >= 0 ? nameType.slice(0, colonIdx).trim() : nameType;
      const type = colonIdx >= 0 ? nameType.slice(colonIdx + 1).trim() : null;
      return { name, type, isOptional: hasDefault, defaultValue };
    }).filter((p) => p.name !== "self" && p.name !== "cls" && !p.name.startsWith("*") && p.name !== "/");
  }
  extractDocstring(lines, startLine) {
    if (startLine >= lines.length) return null;
    const line = (lines[startLine] ?? "").trim();
    const tripleQuote = line.startsWith('"""') ? '"""' : line.startsWith("'''") ? "'''" : null;
    if (!tripleQuote) return null;
    if (line.endsWith(tripleQuote) && line.length > 6) {
      return line.slice(3, -3).trim();
    }
    const docLines = [line.slice(3)];
    for (let i = startLine + 1; i < lines.length && i < startLine + 20; i++) {
      const l = (lines[i] ?? "").trim();
      if (l.includes(tripleQuote)) {
        docLines.push(l.replace(tripleQuote, ""));
        break;
      }
      docLines.push(l);
    }
    return docLines.join(" ").trim() || null;
  }
  buildPythonFunctionSignature(isAsync, name, parameters, returnType) {
    const paramsStr = parameters.map((p) => `${p.name}${p.type ? `: ${p.type}` : ""}`).join(", ");
    return `${isAsync ? "async " : ""}def ${name}(${paramsStr})${returnType ? ` -> ${returnType}` : ""}`;
  }
};

// src/ast-compressor/parsers/csharp-parser.ts
var ACCESS = "(?:public|private|protected|internal|static|abstract|sealed|partial|virtual|override|readonly|async|new|extern|volatile|unsafe)";
var ACCESS_GROUP = `((?:${ACCESS}\\s+)*)`;
var PATTERNS3 = {
  CLASS: new RegExp(`^[ \\t]*${ACCESS_GROUP}(?:class|struct|record)\\s+(\\w+)(?:<[^>]*>)?(?:\\s*:\\s*([^{]+))?\\s*\\{`, "gm"),
  INTERFACE: new RegExp(`^[ \\t]*${ACCESS_GROUP}interface\\s+(\\w+)(?:<[^>]*>)?(?:\\s*:\\s*([^{]+))?\\s*\\{`, "gm"),
  ENUM: new RegExp(`^[ \\t]*${ACCESS_GROUP}enum\\s+(\\w+)(?:\\s*:\\s*(\\w+))?\\s*\\{`, "gm"),
  METHOD: new RegExp(`^[ \\t]*${ACCESS_GROUP}([\\w<>\\[\\],\\s?]+?)\\s+(\\w+)\\s*(?:<[^>]*>)?\\s*\\(([^)]*)\\)\\s*(?:where[^{]*)?\\{`, "gm"),
  PROPERTY: new RegExp(`^[ \\t]*${ACCESS_GROUP}([\\w<>\\[\\],\\s?]+?)\\s+(\\w+)\\s*\\{\\s*(?:get|set|init)`, "gm"),
  NAMESPACE: /^[ \t]*namespace\s+([\w.]+)\s*[{;]/gm,
  USING: /^[ \t]*using\s+(?:static\s+)?(?:[\w.]+=\s*)?([\w.]+)\s*;/gm,
  DOC_COMMENT: /\/\/\/\s*(?:<summary>)?\s*(.*?)(?:<\/summary>)?$/
};
var CSharpParser = class extends BaseParser {
  language = "csharp";
  extensions = [".cs"];
  constructor(logger) {
    super(logger);
  }
  extractSymbols(code, filePath) {
    const lines = code.split("\n");
    const symbols = [];
    symbols.push(...this.extractClasses(code, filePath, lines));
    symbols.push(...this.extractInterfaces(code, filePath, lines));
    symbols.push(...this.extractEnums(code, filePath, lines));
    symbols.push(...this.extractTopLevelMethods(code, filePath, lines));
    return symbols;
  }
  extractImports(code) {
    const imports = [];
    const regex = new RegExp(PATTERNS3.USING.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      imports.push(match[1]);
    }
    return imports;
  }
  extractClasses(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS3.CLASS.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const modifiers = (match[1] ?? "").trim();
      const name = match[2] ?? "AnonymousClass";
      const basesStr = match[3] ?? "";
      const endLine = this.findClosingBrace(lines, lineNum);
      const isExported = this.isPublic(modifiers);
      const isAbstract = modifiers.includes("abstract");
      const bases = basesStr ? basesStr.split(",").map((b) => b.trim()).filter(Boolean) : [];
      const extendsClass = bases.find((b) => !b.startsWith("I") || b.length <= 1) ?? null;
      const implementsList = bases.filter((b) => b.startsWith("I") && b.length > 1);
      const classBody = lines.slice(lineNum + 1, endLine).join("\n");
      const members = this.extractMembers(classBody, filePath, lineNum + 1);
      const keyword = modifiers.includes("struct") ? "struct" : modifiers.includes("record") ? "record" : "class";
      const signature = `${modifiers ? modifiers + " " : ""}${keyword} ${name}${bases.length > 0 ? ` : ${bases.join(", ")}` : ""}`;
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "class",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature,
        isExported,
        extends: extendsClass,
        implements: implementsList,
        members,
        isAbstract
      });
    }
    return results;
  }
  extractInterfaces(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS3.INTERFACE.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const modifiers = (match[1] ?? "").trim();
      const name = match[2] ?? "IAnonymous";
      const basesStr = match[3] ?? "";
      const endLine = this.findClosingBrace(lines, lineNum);
      const isExported = this.isPublic(modifiers);
      const bases = basesStr ? basesStr.split(",").map((b) => b.trim()).filter(Boolean) : [];
      const signature = `${modifiers ? modifiers + " " : ""}interface ${name}${bases.length > 0 ? ` : ${bases.join(", ")}` : ""}`;
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "interface",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature,
        isExported,
        extends: bases[0] ?? null,
        implements: [],
        members: []
      });
    }
    return results;
  }
  extractEnums(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS3.ENUM.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const modifiers = (match[1] ?? "").trim();
      const name = match[2] ?? "AnonymousEnum";
      const endLine = this.findClosingBrace(lines, lineNum);
      const isExported = this.isPublic(modifiers);
      const signature = `${modifiers ? modifiers + " " : ""}enum ${name}`;
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "type",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature,
        isExported
      });
    }
    return results;
  }
  extractTopLevelMethods(code, filePath, lines) {
    return [];
  }
  extractMembers(classBody, filePath, classStartLine) {
    const members = [];
    const methodRegex = new RegExp(PATTERNS3.METHOD.source, "gm");
    let match;
    while ((match = methodRegex.exec(classBody)) !== null) {
      const modifiers = (match[1] ?? "").trim();
      const returnType = (match[2] ?? "").trim();
      const name = match[3];
      if (!name || /^(if|for|while|switch|using|lock|catch|foreach)$/.test(name)) continue;
      const paramsStr = match[4] ?? "";
      const lineNum = classStartLine + this.getLineNumber(classBody, match.index);
      const isStatic = modifiers.includes("static");
      const isAsync = modifiers.includes("async");
      const signature = `${modifiers ? modifiers + " " : ""}${returnType} ${name}(${paramsStr})`;
      members.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "method",
        filePath,
        range: this.buildRange(lineNum, lineNum),
        signature,
        isExported: this.isPublic(modifiers),
        isStatic,
        isAsync
      });
    }
    const propRegex = new RegExp(PATTERNS3.PROPERTY.source, "gm");
    while ((match = propRegex.exec(classBody)) !== null) {
      const modifiers = (match[1] ?? "").trim();
      const dataType = (match[2] ?? "").trim();
      const name = match[3];
      if (!name) continue;
      const lineNum = classStartLine + this.getLineNumber(classBody, match.index);
      const signature = `${modifiers ? modifiers + " " : ""}${dataType} ${name} { get; set; }`;
      members.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "property",
        filePath,
        range: this.buildRange(lineNum, lineNum),
        signature,
        isExported: this.isPublic(modifiers)
      });
    }
    return members;
  }
  extractTripleSlashDoc(lines, symbolLine) {
    const docLines = [];
    for (let i = symbolLine - 1; i >= 0 && i >= symbolLine - 10; i--) {
      const line = (lines[i] ?? "").trim();
      const docMatch = PATTERNS3.DOC_COMMENT.exec(line);
      if (docMatch) {
        docLines.unshift(docMatch[1].trim());
      } else {
        break;
      }
    }
    return docLines.length > 0 ? docLines.join(" ") : null;
  }
  isPublic(modifiers) {
    if (modifiers.includes("public") || modifiers.includes("internal")) return true;
    if (modifiers.includes("private") || modifiers.includes("protected")) return false;
    return false;
  }
};

// src/ast-compressor/parsers/go-parser.ts
var PATTERNS4 = {
  FUNCTION: /^func\s+(\w+)\s*(?:\[[^\]]*\])?\s*\(([^)]*)\)\s*(?:\(([^)]+)\)|(\S+))?\s*\{/gm,
  METHOD: /^func\s+\((\w+)\s+([*]?\w+(?:\[[^\]]*\])?)\)\s+(\w+)\s*\(([^)]*)\)\s*(?:\(([^)]+)\)|(\S+))?\s*\{/gm,
  STRUCT: /^type\s+(\w+)\s+struct\s*\{/gm,
  INTERFACE: /^type\s+(\w+)\s+interface\s*\{/gm,
  TYPE_ALIAS: /^type\s+(\w+)\s+(?!struct|interface)(\S+.*)/gm,
  CONST_BLOCK: /^const\s*\(/gm,
  CONST_SINGLE: /^const\s+(\w+)\s*(?:(\S+)\s*)?=\s*(.+)/gm,
  VAR_SINGLE: /^var\s+(\w+)\s+(\S+)/gm,
  IMPORT_SINGLE: /^import\s+"([^"]+)"/gm,
  IMPORT_BLOCK: /^import\s*\(([\s\S]*?)\)/gm
};
var GoParser = class extends BaseParser {
  language = "go";
  extensions = [".go"];
  constructor(logger) {
    super(logger);
  }
  extractSymbols(code, filePath) {
    const lines = code.split("\n");
    const symbols = [];
    symbols.push(...this.extractFunctions(code, filePath, lines));
    symbols.push(...this.extractMethods(code, filePath, lines));
    symbols.push(...this.extractStructs(code, filePath, lines));
    symbols.push(...this.extractInterfaces(code, filePath, lines));
    symbols.push(...this.extractTypeAliases(code, filePath));
    symbols.push(...this.extractConstants(code, filePath));
    symbols.push(...this.extractVariables(code, filePath));
    return symbols;
  }
  extractImports(code) {
    const imports = [];
    const singleRegex = new RegExp(PATTERNS4.IMPORT_SINGLE.source, "gm");
    let match;
    while ((match = singleRegex.exec(code)) !== null) {
      imports.push(match[1]);
    }
    const blockRegex = new RegExp(PATTERNS4.IMPORT_BLOCK.source, "gm");
    while ((match = blockRegex.exec(code)) !== null) {
      const block = match[1];
      const lineRegex = /["']([^"']+)["']/g;
      let lineMatch;
      while ((lineMatch = lineRegex.exec(block)) !== null) {
        imports.push(lineMatch[1]);
      }
    }
    return imports;
  }
  extractFunctions(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS4.FUNCTION.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const name = match[1] ?? "anonymous";
      const paramsStr = match[2] ?? "";
      const returnType = match[3] ?? match[4] ?? null;
      const endLine = this.findClosingBrace(lines, lineNum);
      const isExported = this.isGoExported(name);
      const parameters = this.parseGoParams(paramsStr);
      const docComment = this.extractGoDoc(lines, lineNum);
      const signature = `func ${name}(${paramsStr.trim()})${returnType ? ` ${returnType}` : ""}`;
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "function",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature,
        isExported,
        parameters,
        returnType,
        isAsync: false,
        isStatic: false,
        docComment
      });
    }
    return results;
  }
  extractMethods(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS4.METHOD.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const receiverName = match[1] ?? "r";
      const receiverType = match[2] ?? "";
      const name = match[3] ?? "anonymous";
      const paramsStr = match[4] ?? "";
      const returnType = match[5] ?? match[6] ?? null;
      const endLine = this.findClosingBrace(lines, lineNum);
      const isExported = this.isGoExported(name);
      const parameters = this.parseGoParams(paramsStr);
      const signature = `func (${receiverName} ${receiverType}) ${name}(${paramsStr.trim()})${returnType ? ` ${returnType}` : ""}`;
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "method",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature,
        isExported,
        parameters,
        returnType,
        isAsync: false,
        isStatic: false
      });
    }
    return results;
  }
  extractStructs(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS4.STRUCT.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const name = match[1] ?? "AnonymousStruct";
      const endLine = this.findClosingBrace(lines, lineNum);
      const isExported = this.isGoExported(name);
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "class",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature: `type ${name} struct`,
        isExported,
        extends: null,
        implements: [],
        members: []
      });
    }
    return results;
  }
  extractInterfaces(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS4.INTERFACE.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const name = match[1] ?? "AnonymousInterface";
      const endLine = this.findClosingBrace(lines, lineNum);
      const isExported = this.isGoExported(name);
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "interface",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature: `type ${name} interface`,
        isExported,
        extends: null,
        implements: [],
        members: []
      });
    }
    return results;
  }
  extractTypeAliases(code, filePath) {
    const results = [];
    const regex = new RegExp(PATTERNS4.TYPE_ALIAS.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const name = match[1] ?? "AnonymousType";
      const value = (match[2] ?? "").trim().slice(0, 100);
      const isExported = this.isGoExported(name);
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "type",
        filePath,
        range: this.buildRange(lineNum, lineNum),
        signature: `type ${name} ${value}`,
        isExported
      });
    }
    return results;
  }
  extractConstants(code, filePath) {
    const results = [];
    const regex = new RegExp(PATTERNS4.CONST_SINGLE.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const name = match[1] ?? "anonymous";
      const dataType = match[2]?.trim() ?? null;
      const isExported = this.isGoExported(name);
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "constant",
        filePath,
        range: this.buildRange(lineNum, lineNum),
        signature: `const ${name}${dataType ? ` ${dataType}` : ""}`,
        isExported,
        dataType,
        isConst: true
      });
    }
    return results;
  }
  extractVariables(code, filePath) {
    const results = [];
    const regex = new RegExp(PATTERNS4.VAR_SINGLE.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const name = match[1] ?? "anonymous";
      const dataType = match[2]?.trim() ?? null;
      const isExported = this.isGoExported(name);
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "variable",
        filePath,
        range: this.buildRange(lineNum, lineNum),
        signature: `var ${name} ${dataType ?? ""}`.trim(),
        isExported,
        dataType,
        isConst: false
      });
    }
    return results;
  }
  isGoExported(name) {
    return name.length > 0 && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase();
  }
  parseGoParams(paramsStr) {
    if (!paramsStr.trim()) return [];
    return paramsStr.split(",").map((param) => {
      const trimmed = param.trim();
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        return { name: parts[0], type: parts.slice(1).join(" "), isOptional: false, defaultValue: null };
      }
      return { name: trimmed, type: null, isOptional: false, defaultValue: null };
    }).filter((p) => p.name.length > 0);
  }
  extractGoDoc(lines, symbolLine) {
    const docLines = [];
    for (let i = symbolLine - 1; i >= 0 && i >= symbolLine - 15; i--) {
      const line = (lines[i] ?? "").trim();
      if (line.startsWith("//")) {
        docLines.unshift(line.slice(2).trim());
      } else {
        break;
      }
    }
    return docLines.length > 0 ? docLines.join(" ") : null;
  }
};

// src/ast-compressor/parsers/java-parser.ts
var ACCESS2 = "(?:public|private|protected|static|abstract|final|synchronized|native|strictfp|default|transient|volatile)";
var ACCESS_GROUP2 = `((?:${ACCESS2}\\s+)*)`;
var PATTERNS5 = {
  CLASS: new RegExp(`^[ \\t]*${ACCESS_GROUP2}class\\s+(\\w+)(?:<[^>]*>)?(?:\\s+extends\\s+(\\w+(?:<[^>]*>)?))?(?:\\s+implements\\s+([^{]+))?\\s*\\{`, "gm"),
  INTERFACE: new RegExp(`^[ \\t]*${ACCESS_GROUP2}interface\\s+(\\w+)(?:<[^>]*>)?(?:\\s+extends\\s+([^{]+))?\\s*\\{`, "gm"),
  ENUM: new RegExp(`^[ \\t]*${ACCESS_GROUP2}enum\\s+(\\w+)(?:\\s+implements\\s+([^{]+))?\\s*\\{`, "gm"),
  METHOD: new RegExp(`^[ \\t]*${ACCESS_GROUP2}(?:<[^>]*>\\s+)?([\\w<>\\[\\],\\s?]+?)\\s+(\\w+)\\s*\\(([^)]*)\\)(?:\\s+throws\\s+[\\w\\s,]+)?\\s*\\{`, "gm"),
  FIELD: new RegExp(`^[ \\t]*${ACCESS_GROUP2}(final\\s+)?(static\\s+)?([\\w<>\\[\\],?]+)\\s+(\\w+)\\s*[=;]`, "gm"),
  IMPORT: /^[ \t]*import\s+(?:static\s+)?([\w.*]+)\s*;/gm,
  ANNOTATION: /^[ \t]*@(\w+)(?:\([^)]*\))?/gm
};
var JavaParser = class extends BaseParser {
  language = "java";
  extensions = [".java"];
  constructor(logger) {
    super(logger);
  }
  extractSymbols(code, filePath) {
    const lines = code.split("\n");
    const docComments = this.extractDocComments(code);
    const symbols = [];
    symbols.push(...this.extractClasses(code, filePath, lines, docComments));
    symbols.push(...this.extractInterfaces(code, filePath, lines, docComments));
    symbols.push(...this.extractEnums(code, filePath, lines));
    return symbols;
  }
  extractImports(code) {
    const imports = [];
    const regex = new RegExp(PATTERNS5.IMPORT.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      imports.push(match[1]);
    }
    return imports;
  }
  extractClasses(code, filePath, lines, docComments) {
    const results = [];
    const regex = new RegExp(PATTERNS5.CLASS.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const modifiers = (match[1] ?? "").trim();
      const name = match[2] ?? "AnonymousClass";
      const extendsClass = match[3] ?? null;
      const implementsStr = match[4] ?? "";
      const endLine = this.findClosingBrace(lines, lineNum);
      const isExported = this.isPublic(modifiers);
      const isAbstract = modifiers.includes("abstract");
      const implementsList = implementsStr ? implementsStr.split(",").map((i) => i.trim()).filter(Boolean) : [];
      const classBody = lines.slice(lineNum + 1, endLine).join("\n");
      const members = this.extractClassMembers(classBody, filePath, lineNum + 1);
      const signature = `${modifiers ? modifiers + " " : ""}class ${name}${extendsClass ? ` extends ${extendsClass}` : ""}${implementsList.length > 0 ? ` implements ${implementsList.join(", ")}` : ""}`;
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "class",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature,
        isExported,
        extends: extendsClass,
        implements: implementsList,
        members,
        isAbstract,
        docComment: this.findNearestDocComment(docComments, lineNum)
      });
    }
    return results;
  }
  extractInterfaces(code, filePath, lines, docComments) {
    const results = [];
    const regex = new RegExp(PATTERNS5.INTERFACE.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const modifiers = (match[1] ?? "").trim();
      const name = match[2] ?? "AnonymousInterface";
      const extendsStr = match[3] ?? "";
      const endLine = this.findClosingBrace(lines, lineNum);
      const isExported = this.isPublic(modifiers);
      const extendsList = extendsStr ? extendsStr.split(",").map((e) => e.trim()).filter(Boolean) : [];
      const signature = `${modifiers ? modifiers + " " : ""}interface ${name}${extendsList.length > 0 ? ` extends ${extendsList.join(", ")}` : ""}`;
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "interface",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature,
        isExported,
        extends: extendsList[0] ?? null,
        implements: [],
        members: [],
        docComment: this.findNearestDocComment(docComments, lineNum)
      });
    }
    return results;
  }
  extractEnums(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS5.ENUM.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const modifiers = (match[1] ?? "").trim();
      const name = match[2] ?? "AnonymousEnum";
      const endLine = this.findClosingBrace(lines, lineNum);
      const isExported = this.isPublic(modifiers);
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "type",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature: `${modifiers ? modifiers + " " : ""}enum ${name}`,
        isExported
      });
    }
    return results;
  }
  extractClassMembers(classBody, filePath, classStartLine) {
    const members = [];
    const methodRegex = new RegExp(PATTERNS5.METHOD.source, "gm");
    let match;
    while ((match = methodRegex.exec(classBody)) !== null) {
      const modifiers = (match[1] ?? "").trim();
      const returnType = (match[2] ?? "").trim();
      const name = match[3];
      if (!name || /^(if|for|while|switch|try|catch|synchronized)$/.test(name)) continue;
      const paramsStr = match[4] ?? "";
      const lineNum = classStartLine + this.getLineNumber(classBody, match.index);
      const isStatic = modifiers.includes("static");
      const signature = `${modifiers ? modifiers + " " : ""}${returnType} ${name}(${paramsStr})`;
      members.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "method",
        filePath,
        range: this.buildRange(lineNum, lineNum),
        signature,
        isExported: this.isPublic(modifiers),
        isStatic
      });
    }
    const fieldRegex = new RegExp(PATTERNS5.FIELD.source, "gm");
    while ((match = fieldRegex.exec(classBody)) !== null) {
      const modifiers = (match[1] ?? "").trim();
      const isFinal = Boolean(match[2]);
      const isStatic = Boolean(match[3]);
      const dataType = (match[4] ?? "").trim();
      const name = match[5];
      if (!name || /^(return|throw|new|this|super|if|for|while)$/.test(name)) continue;
      const lineNum = classStartLine + this.getLineNumber(classBody, match.index);
      const isConst = isFinal && isStatic;
      const signature = `${modifiers ? modifiers + " " : ""}${dataType} ${name}`;
      members.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: isConst ? "constant" : "property",
        filePath,
        range: this.buildRange(lineNum, lineNum),
        signature,
        isExported: this.isPublic(modifiers),
        isStatic
      });
    }
    return members;
  }
  findNearestDocComment(docComments, symbolLine) {
    return docComments.get(symbolLine + 1) ?? docComments.get(symbolLine) ?? docComments.get(symbolLine - 1) ?? null;
  }
  isPublic(modifiers) {
    if (modifiers.includes("public")) return true;
    if (modifiers.includes("private") || modifiers.includes("protected")) return false;
    return false;
  }
};

// src/ast-compressor/parsers/rust-parser.ts
var PUB = "(?:(pub(?:\\s*\\([^)]*\\))?)\\s+)?";
var PATTERNS6 = {
  FUNCTION: new RegExp(`^[ \\t]*${PUB}(async\\s+)?(?:unsafe\\s+)?(?:const\\s+)?fn\\s+(\\w+)(?:<[^>]*>)?\\s*\\(([^)]*)\\)(?:\\s*->\\s*([^{]+?))?\\s*(?:where[^{]*)?\\{`, "gm"),
  STRUCT: new RegExp(`^[ \\t]*${PUB}struct\\s+(\\w+)(?:<[^>]*>)?(?:\\s*\\([^)]*\\)\\s*;|\\s*(?:where[^{]*)?\\{)`, "gm"),
  ENUM: new RegExp(`^[ \\t]*${PUB}enum\\s+(\\w+)(?:<[^>]*>)?\\s*(?:where[^{]*)?\\{`, "gm"),
  TRAIT: new RegExp(`^[ \\t]*${PUB}(?:unsafe\\s+)?trait\\s+(\\w+)(?:<[^>]*>)?(?:\\s*:\\s*([^{]+?))?\\s*(?:where[^{]*)?\\{`, "gm"),
  IMPL: /^[ \t]*impl(?:<[^>]*>)?\s+(?:(\w+(?:<[^>]*>)?)\s+for\s+)?(\w+)(?:<[^>]*>)?\s*(?:where[^{]*)?\{/gm,
  TYPE_ALIAS: new RegExp(`^[ \\t]*${PUB}type\\s+(\\w+)(?:<[^>]*>)?\\s*=\\s*(.+);`, "gm"),
  CONST: new RegExp(`^[ \\t]*${PUB}(?:const|static)\\s+(\\w+)\\s*:\\s*([^=]+)\\s*=`, "gm"),
  USE: /^[ \t]*(?:pub\s+)?use\s+([\w:]+(?:::\{[^}]+\}|::\*)?)\s*;/gm,
  MOD: new RegExp(`^[ \\t]*${PUB}mod\\s+(\\w+)\\s*[;{]`, "gm")
};
var RustParser = class extends BaseParser {
  language = "rust";
  extensions = [".rs"];
  constructor(logger) {
    super(logger);
  }
  extractSymbols(code, filePath) {
    const lines = code.split("\n");
    const symbols = [];
    symbols.push(...this.extractFunctions(code, filePath, lines));
    symbols.push(...this.extractStructs(code, filePath, lines));
    symbols.push(...this.extractEnums(code, filePath, lines));
    symbols.push(...this.extractTraits(code, filePath, lines));
    symbols.push(...this.extractImpls(code, filePath, lines));
    symbols.push(...this.extractTypeAliases(code, filePath));
    symbols.push(...this.extractConstants(code, filePath));
    return symbols;
  }
  extractImports(code) {
    const imports = [];
    const regex = new RegExp(PATTERNS6.USE.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      imports.push(match[1]);
    }
    return imports;
  }
  extractFunctions(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS6.FUNCTION.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const pubMod = match[1] ?? "";
      const isAsync = Boolean(match[2]);
      const name = match[3] ?? "anonymous";
      const paramsStr = match[4] ?? "";
      const returnType = match[5]?.trim() ?? null;
      const endLine = this.findClosingBrace(lines, lineNum);
      const isExported = pubMod.startsWith("pub");
      const parameters = this.parseRustParams(paramsStr);
      const docComment = this.extractRustDoc(lines, lineNum);
      const isSelfMethod = paramsStr.trim().startsWith("&self") || paramsStr.trim().startsWith("self") || paramsStr.trim().startsWith("&mut self");
      const type = isSelfMethod ? "method" : "function";
      const signature = `${isExported ? "pub " : ""}${isAsync ? "async " : ""}fn ${name}(${this.summarizeParams(parameters)})${returnType ? ` -> ${returnType}` : ""}`;
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type,
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature,
        isExported,
        parameters,
        returnType,
        isAsync,
        isStatic: !isSelfMethod,
        docComment
      });
    }
    return results;
  }
  extractStructs(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS6.STRUCT.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const pubMod = match[1] ?? "";
      const name = match[2] ?? "AnonymousStruct";
      const isExported = pubMod.startsWith("pub");
      const lineText = lines[lineNum] ?? "";
      const isTupleStruct = lineText.includes("(");
      const endLine = isTupleStruct ? lineNum : this.findClosingBrace(lines, lineNum);
      const signature = `${isExported ? "pub " : ""}struct ${name}`;
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "class",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature,
        isExported,
        extends: null,
        implements: [],
        members: []
      });
    }
    return results;
  }
  extractEnums(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS6.ENUM.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const pubMod = match[1] ?? "";
      const name = match[2] ?? "AnonymousEnum";
      const endLine = this.findClosingBrace(lines, lineNum);
      const isExported = pubMod.startsWith("pub");
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "type",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature: `${isExported ? "pub " : ""}enum ${name}`,
        isExported
      });
    }
    return results;
  }
  extractTraits(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS6.TRAIT.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const pubMod = match[1] ?? "";
      const name = match[2] ?? "AnonymousTrait";
      const superTraits = match[3]?.trim() ?? "";
      const endLine = this.findClosingBrace(lines, lineNum);
      const isExported = pubMod.startsWith("pub");
      const signature = `${isExported ? "pub " : ""}trait ${name}${superTraits ? `: ${superTraits}` : ""}`;
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "interface",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature,
        isExported,
        extends: superTraits || null,
        implements: [],
        members: []
      });
    }
    return results;
  }
  extractImpls(code, filePath, lines) {
    const results = [];
    const regex = new RegExp(PATTERNS6.IMPL.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const traitName = match[1] ?? null;
      const typeName = match[2] ?? "Unknown";
      const endLine = this.findClosingBrace(lines, lineNum);
      const implBody = lines.slice(lineNum + 1, endLine).join("\n");
      const methods = this.extractImplMethods(implBody, filePath, lineNum + 1);
      const name = traitName ? `impl ${traitName} for ${typeName}` : `impl ${typeName}`;
      const signature = name;
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "class",
        filePath,
        range: this.buildRange(lineNum, endLine),
        signature,
        isExported: true,
        extends: traitName,
        implements: traitName ? [traitName] : [],
        members: methods
      });
    }
    return results;
  }
  extractImplMethods(implBody, filePath, implStartLine) {
    const methods = [];
    const regex = new RegExp(PATTERNS6.FUNCTION.source, "gm");
    let match;
    while ((match = regex.exec(implBody)) !== null) {
      const pubMod = match[1] ?? "";
      const isAsync = Boolean(match[2]);
      const name = match[3];
      if (!name) continue;
      const paramsStr = match[4] ?? "";
      const returnType = match[5]?.trim() ?? null;
      const lineNum = implStartLine + this.getLineNumber(implBody, match.index);
      const isExported = pubMod.startsWith("pub");
      const signature = `${isExported ? "pub " : ""}${isAsync ? "async " : ""}fn ${name}(${paramsStr.trim().slice(0, 60)})${returnType ? ` -> ${returnType}` : ""}`;
      methods.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "method",
        filePath,
        range: this.buildRange(lineNum, lineNum),
        signature,
        isExported,
        isAsync
      });
    }
    return methods;
  }
  extractTypeAliases(code, filePath) {
    const results = [];
    const regex = new RegExp(PATTERNS6.TYPE_ALIAS.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const pubMod = match[1] ?? "";
      const name = match[2] ?? "AnonymousType";
      const value = (match[3] ?? "").trim().slice(0, 100);
      const isExported = pubMod.startsWith("pub");
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "type",
        filePath,
        range: this.buildRange(lineNum, lineNum),
        signature: `${isExported ? "pub " : ""}type ${name} = ${value}`,
        isExported
      });
    }
    return results;
  }
  extractConstants(code, filePath) {
    const results = [];
    const regex = new RegExp(PATTERNS6.CONST.source, "gm");
    let match;
    while ((match = regex.exec(code)) !== null) {
      const lineNum = this.getLineNumber(code, match.index);
      const pubMod = match[1] ?? "";
      const name = match[2] ?? "ANONYMOUS";
      const dataType = (match[3] ?? "").trim();
      const isExported = pubMod.startsWith("pub");
      results.push({
        id: `${filePath}:${name}:${lineNum}`,
        name,
        type: "constant",
        filePath,
        range: this.buildRange(lineNum, lineNum),
        signature: `${isExported ? "pub " : ""}const ${name}: ${dataType}`,
        isExported,
        dataType,
        isConst: true
      });
    }
    return results;
  }
  parseRustParams(paramsStr) {
    if (!paramsStr.trim()) return [];
    return paramsStr.split(",").map((param) => {
      const trimmed = param.trim();
      if (!trimmed || trimmed === "&self" || trimmed === "self" || trimmed === "&mut self") {
        return null;
      }
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx >= 0) {
        const name = trimmed.slice(0, colonIdx).trim().replace(/^mut\s+/, "");
        const type = trimmed.slice(colonIdx + 1).trim();
        return { name, type, isOptional: false, defaultValue: null };
      }
      return { name: trimmed, type: null, isOptional: false, defaultValue: null };
    }).filter((p) => p !== null);
  }
  summarizeParams(params) {
    return params.map((p) => `${p.name}${p.type ? `: ${p.type}` : ""}`).join(", ");
  }
  extractRustDoc(lines, symbolLine) {
    const docLines = [];
    for (let i = symbolLine - 1; i >= 0 && i >= symbolLine - 15; i--) {
      const line = (lines[i] ?? "").trim();
      if (line.startsWith("///")) {
        docLines.unshift(line.slice(3).trim());
      } else if (line.startsWith("#[") || line.startsWith("//!")) {
        continue;
      } else {
        break;
      }
    }
    return docLines.length > 0 ? docLines.join(" ") : null;
  }
};

// src/ast-compressor/formatters/signature-formatter.ts
var SignatureFormatter = class {
  level = "L1";
  /** Compact-режим: сокращает JSDoc до первой строки */
  compactMode = false;
  /**
   * Активирует compact-режим (сокращённый JSDoc)
   */
  setCompactMode(enabled) {
    this.compactMode = enabled;
  }
  compress(symbols, originalCode) {
    const lines = [];
    for (const symbol of symbols) {
      const formatted = this.formatSymbol(symbol);
      if (formatted) {
        lines.push(formatted);
      }
    }
    const content = lines.join("\n\n");
    const originalTokens = this.estimateTokens(originalCode);
    const compressedTokens = this.estimateTokens(content);
    return {
      level: "L1",
      content,
      originalTokens,
      compressedTokens,
      compressionRatio: originalTokens > 0 ? 1 - compressedTokens / originalTokens : 0,
      symbols
    };
  }
  formatSymbol(symbol) {
    switch (symbol.type) {
      case "function":
      case "method":
        return this.formatFunction(symbol);
      case "class":
        return this.formatClass(symbol);
      case "interface":
      case "type":
      case "variable":
      case "constant":
      case "property":
        return symbol.signature;
      default:
        return symbol.signature;
    }
  }
  formatFunction(fn) {
    const parts = [];
    if (fn.docComment) {
      const jsdoc = this.compactMode ? this.compactJSDoc(fn.docComment) : fn.docComment;
      if (jsdoc) {
        parts.push(`/** ${jsdoc} */`);
      }
    }
    parts.push(`${fn.signature};`);
    return parts.join("\n");
  }
  formatClass(cls) {
    const parts = [];
    parts.push(`${cls.signature} {`);
    for (const member of cls.members) {
      parts.push(`  ${member.signature};`);
    }
    parts.push("}");
    return parts.join("\n");
  }
  /**
   * Сокращает JSDoc до первой строки описания.
   * Удаляет @param, @returns, @throws, @example, @see и другие теги.
   *
   * Пример:
   *   Вход: "Вычисляет centroid-вектор.\n@param vectors — массив\n@returns number[]"
   *   Выход: "Вычисляет centroid-вектор."
   */
  compactJSDoc(docComment) {
    const lines = docComment.split("\n");
    const descriptionLines = [];
    for (const line of lines) {
      const trimmed = line.trim().replace(/^\*\s?/, "");
      if (trimmed.startsWith("@"))
        break;
      if (trimmed.length > 0) {
        descriptionLines.push(trimmed);
      }
    }
    const firstLine = descriptionLines[0] ?? "";
    return firstLine.slice(0, 120);
  }
  /**
   * Оценка токенов для кода (~3.3 символа = 1 токен для cl100k_base)
   */
  estimateTokens(text) {
    return Math.ceil(text.length / 3.3);
  }
};

// src/ast-compressor/formatters/skeleton-formatter.ts
var SkeletonFormatter = class {
  level = "L2";
  compress(symbols, originalCode) {
    const lines = [];
    for (const symbol of symbols) {
      const formatted = this.formatSymbol(symbol);
      if (formatted) {
        lines.push(formatted);
      }
    }
    const content = lines.join("\n");
    const originalTokens = this.estimateTokens(originalCode);
    const compressedTokens = this.estimateTokens(content);
    return {
      level: "L2",
      content,
      originalTokens,
      compressedTokens,
      compressionRatio: originalTokens > 0 ? 1 - compressedTokens / originalTokens : 0,
      symbols
    };
  }
  formatSymbol(symbol) {
    switch (symbol.type) {
      case "function":
      case "method":
        return this.formatFunction(symbol);
      case "class":
        return this.formatClass(symbol);
      case "interface":
        return `interface ${symbol.name}`;
      case "type":
        return `type ${symbol.name}`;
      case "variable":
      case "constant":
        return `${symbol.type} ${symbol.name}`;
      case "property":
        return `  ${symbol.name}`;
      default:
        return null;
    }
  }
  formatFunction(fn) {
    const params = fn.parameters.map((p) => `${p.name}${p.type ? `: ${p.type}` : ""}`).join(", ");
    const ret = fn.returnType ? ` \u2192 ${fn.returnType}` : "";
    return `${fn.name}(${params})${ret}`;
  }
  formatClass(cls) {
    const parts = [];
    let header = `class ${cls.name}`;
    if (cls.extends)
      header += ` extends ${cls.extends}`;
    parts.push(header);
    for (const member of cls.members) {
      parts.push(`  ${member.name}`);
    }
    return parts.join("\n");
  }
  /**
   * Оценка токенов для кода (~3.3 символа = 1 токен для cl100k_base)
   */
  estimateTokens(text) {
    return Math.ceil(text.length / 3.3);
  }
};

// src/ast-compressor/formatters/map-formatter.ts
var MapFormatter = class {
  level = "L3";
  compress(symbols, originalCode) {
    const groups = this.groupByType(symbols);
    const lines = [];
    for (const [type, names] of groups) {
      lines.push(`${type}: ${names.join(", ")}`);
    }
    const content = lines.join("\n");
    const originalTokens = this.estimateTokens(originalCode);
    const compressedTokens = this.estimateTokens(content);
    return {
      level: "L3",
      content,
      originalTokens,
      compressedTokens,
      compressionRatio: originalTokens > 0 ? 1 - compressedTokens / originalTokens : 0,
      symbols
    };
  }
  /**
   * Группирует символы по типу для компактного представления
   */
  groupByType(symbols) {
    const groups = /* @__PURE__ */ new Map();
    for (const symbol of symbols) {
      if (symbol.type === "class") {
        const cls = symbol;
        const memberNames = cls.members.map((m) => m.name);
        const value = memberNames.length > 0 ? `${cls.name} { ${memberNames.join(", ")} }` : cls.name;
        const list2 = groups.get("class") ?? [];
        list2.push(value);
        groups.set("class", list2);
        continue;
      }
      const key = this.getGroupKey(symbol.type);
      const list = groups.get(key) ?? [];
      list.push(symbol.name);
      groups.set(key, list);
    }
    return groups;
  }
  getGroupKey(type) {
    switch (type) {
      case "function":
      case "method":
        return "fn";
      case "class":
        return "class";
      case "interface":
        return "iface";
      case "type":
        return "type";
      case "variable":
      case "constant":
        return "const";
      case "property":
        return "prop";
      default:
        return "other";
    }
  }
  /**
   * Оценка токенов для кода (~3.3 символа = 1 токен для cl100k_base)
   */
  estimateTokens(text) {
    return Math.ceil(text.length / 3.3);
  }
};

// src/ast-compressor/formatters/module-map-formatter.ts
var ModuleMapFormatter = class {
  level = "L4";
  compress(symbols, originalCode) {
    const fnCount = symbols.filter((s) => s.type === "function" || s.type === "method").length;
    const classCount = symbols.filter((s) => s.type === "class").length;
    const ifaceCount = symbols.filter((s) => s.type === "interface").length;
    const typeCount = symbols.filter((s) => s.type === "type").length;
    const exportedNames = symbols.filter((s) => s.isExported).slice(0, 6).map((s) => {
      if (s.type === "class") {
        const cls = s;
        const methodNames = cls.members.filter((m) => m.type === "method").slice(0, 3).map((m) => m.name);
        return methodNames.length > 0 ? `${s.name} { ${methodNames.join(", ")} }` : s.name;
      }
      return s.name;
    });
    const stats = [];
    if (fnCount > 0) stats.push(`${fnCount} fn`);
    if (classCount > 0) stats.push(`${classCount} class`);
    if (ifaceCount > 0) stats.push(`${ifaceCount} iface`);
    if (typeCount > 0) stats.push(`${typeCount} type`);
    const content = exportedNames.length > 0 ? `${exportedNames.join(", ")} (${stats.join(", ")})` : `(${stats.join(", ")})`;
    const originalTokens = this.estimateTokens(originalCode);
    const compressedTokens = this.estimateTokens(content);
    return {
      level: "L4",
      content,
      originalTokens,
      compressedTokens,
      compressionRatio: originalTokens > 0 ? 1 - compressedTokens / originalTokens : 0,
      symbols
    };
  }
  estimateTokens(text) {
    return Math.ceil(text.length / 3.3);
  }
};

// src/ast-compressor/formatters/cluster-formatter.ts
var ClusterFormatter = class {
  level = "L5";
  compress(symbols, originalCode) {
    const byDir = /* @__PURE__ */ new Map();
    for (const s of symbols) {
      const dir = this.extractDir(s.filePath);
      const list = byDir.get(dir) ?? [];
      list.push(s.name);
      byDir.set(dir, list);
    }
    const lines = [];
    for (const [dir, names] of byDir) {
      const uniqueNames = [...new Set(names)].slice(0, 8);
      lines.push(`[${dir}] (${names.length}): ${uniqueNames.join(", ")}`);
    }
    const content = lines.length > 0 ? lines.join("\n") : "(empty)";
    const originalTokens = this.estimateTokens(originalCode);
    const compressedTokens = this.estimateTokens(content);
    return {
      level: "L5",
      content,
      originalTokens,
      compressedTokens,
      compressionRatio: originalTokens > 0 ? 1 - compressedTokens / originalTokens : 0,
      symbols
    };
  }
  extractDir(filePath) {
    const parts = filePath.replace(/\\/g, "/").split("/");
    if (parts.length <= 1) return ".";
    return parts.slice(0, -1).join("/");
  }
  estimateTokens(text) {
    return Math.ceil(text.length / 3.3);
  }
};

// src/ast-compressor/formatters/abstractive-formatter.ts
var AbstractiveFormatter = class {
  level = "L6";
  compress(symbols, originalCode) {
    const exported = symbols.filter((s) => s.isExported);
    const classes = exported.filter((s) => s.type === "class");
    const functions = exported.filter((s) => s.type === "function");
    const interfaces = exported.filter((s) => s.type === "interface");
    const types = exported.filter((s) => s.type === "type");
    const parts = [];
    if (classes.length > 0) {
      for (const cls of classes.slice(0, 2)) {
        const c2 = cls;
        const methods = c2.members.filter((m) => m.type === "method").map((m) => m.name);
        parts.push(
          `Class ${c2.name}` + (methods.length > 0 ? ` with ${methods.slice(0, 4).join(", ")}` : "")
        );
      }
    }
    if (functions.length > 0) {
      const fNames = functions.slice(0, 4).map((f) => f.name);
      parts.push(`Functions: ${fNames.join(", ")}`);
    }
    if (interfaces.length > 0) {
      parts.push(`Interfaces: ${interfaces.slice(0, 3).map((i) => i.name).join(", ")}`);
    }
    if (types.length > 0) {
      parts.push(`Types: ${types.slice(0, 3).map((t) => t.name).join(", ")}`);
    }
    const summary = parts.length > 0 ? `Module exports ${exported.length} symbols. ${parts.join(". ")}.` : `Module with ${symbols.length} internal symbols.`;
    const originalTokens = this.estimateTokens(originalCode);
    const compressedTokens = this.estimateTokens(summary);
    return {
      level: "L6",
      content: summary,
      originalTokens,
      compressedTokens,
      compressionRatio: originalTokens > 0 ? 1 - compressedTokens / originalTokens : 0,
      symbols
    };
  }
  estimateTokens(text) {
    return Math.ceil(text.length / 3.3);
  }
};

// src/ast-compressor/ast-compressor.ts
var AstCompressor = class {
  parserRegistry;
  strategies;
  logger;
  constructor(logger) {
    this.logger = logger;
    this.parserRegistry = new ParserRegistry();
    this.parserRegistry.register(new TypeScriptParser(logger));
    this.parserRegistry.register(new MarkdownParser(logger));
    this.parserRegistry.register(new PythonParser(logger));
    this.parserRegistry.register(new CSharpParser(logger));
    this.parserRegistry.register(new GoParser(logger));
    this.parserRegistry.register(new JavaParser(logger));
    this.parserRegistry.register(new RustParser(logger));
    this.strategies = /* @__PURE__ */ new Map([
      ["L1", new SignatureFormatter()],
      ["L2", new SkeletonFormatter()],
      ["L3", new MapFormatter()],
      ["L4", new ModuleMapFormatter()],
      ["L5", new ClusterFormatter()],
      ["L6", new AbstractiveFormatter()]
    ]);
  }
  /**
   * Сжимает файл до указанного уровня
   *
   * L0 — полный код (без сжатия)
   * L1 — сигнатуры + JSDoc
   * L2 — скелет (имена + типы)
   * L3 — карта (список символов)
   */
  compressFile(filePath, level = "L1", _projectId) {
    const code = readFileSync(filePath, "utf-8");
    return this.compressCode(code, filePath, level);
  }
  /**
   * Сжимает код (строку) до указанного уровня
   */
  compressCode(code, filePath, level = "L1", _projectId) {
    if (level === "L0") {
      return this.buildL0Result(code);
    }
    const parser = this.parserRegistry.getByFilePath(filePath);
    if (!parser) {
      this.logger.warn(`\u041F\u0430\u0440\u0441\u0435\u0440 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0434\u043B\u044F \u0444\u0430\u0439\u043B\u0430: ${filePath}. \u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u043C L0.`);
      return this.buildL0Result(code);
    }
    const parseResult = parser.parse(code, filePath);
    if (parseResult.errors.length > 0) {
      this.logger.warn(`\u041E\u0448\u0438\u0431\u043A\u0438 \u043F\u0430\u0440\u0441\u0438\u043D\u0433\u0430 ${filePath}: ${parseResult.errors.length}. \u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u043C L0.`);
      return this.buildL0Result(code);
    }
    const strategy = this.strategies.get(level);
    if (!strategy) {
      this.logger.warn(`\u0421\u0442\u0440\u0430\u0442\u0435\u0433\u0438\u044F \u0441\u0436\u0430\u0442\u0438\u044F ${level} \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430. \u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u043C L1.`);
      const fallbackStrategy = this.strategies.get("L1");
      if (!fallbackStrategy) {
        return this.buildL0Result(code);
      }
      return fallbackStrategy.compress(parseResult.symbols, code);
    }
    const result = strategy.compress(parseResult.symbols, code);
    this.logger.debug(`\u0421\u0436\u0430\u0442\u0438\u0435 ${filePath} [${level}]: ${result.originalTokens} \u2192 ${result.compressedTokens} (${(result.compressionRatio * 100).toFixed(1)}% \u044D\u043A\u043E\u043D\u043E\u043C\u0438\u044F)`);
    return result;
  }
  /**
   * Извлекает символы из файла (без сжатия)
   */
  extractSymbols(filePath) {
    const code = readFileSync(filePath, "utf-8");
    return this.extractSymbolsFromCode(code, filePath);
  }
  /**
   * Извлекает символы из кода
   */
  extractSymbolsFromCode(code, filePath) {
    const parser = this.parserRegistry.getByFilePath(filePath);
    if (!parser) {
      return [];
    }
    const result = parser.parse(code, filePath);
    return result.symbols;
  }
  /**
   * Ищет конкретный символ по имени в файле
   */
  findSymbolInFile(filePath, symbolName) {
    const symbols = this.extractSymbols(filePath);
    return symbols.find((s) => s.name === symbolName) ?? null;
  }
  /**
   * Проверяет, поддерживается ли файл
   */
  isFileSupported(filePath) {
    return this.parserRegistry.isSupported(filePath);
  }
  /**
   * Возвращает список поддерживаемых расширений
   */
  getSupportedExtensions() {
    return this.parserRegistry.getSupportedExtensions();
  }
  /**
   * Получает парсер по пути к файлу
   */
  getParser(filePath) {
    return this.parserRegistry.getByFilePath(filePath);
  }
  /**
   * HVC v2: включает/выключает compact JSDoc в L1 (сокращение до первой строки).
   * Делегирует в SignatureFormatter.setCompactMode()
   */
  setCompactJSDoc(enabled) {
    const l1Strategy = this.strategies.get("L1");
    if (l1Strategy && "setCompactMode" in l1Strategy) {
      l1Strategy.setCompactMode(enabled);
    }
  }
  /**
   * HVC v2: no-op для AstCompressor (import stripping реализован в CachedCompressor).
   * Метод необходим для соответствия ICodeCompressor интерфейсу.
   */
  setStripImports(_enabled) {
  }
  /**
   * L0 — полный код без сжатия
   */
  buildL0Result(code) {
    const tokens = Math.ceil(code.length / 3.3);
    return {
      level: "L0",
      content: code,
      originalTokens: tokens,
      compressedTokens: tokens,
      compressionRatio: 0,
      symbols: []
    };
  }
};

// cli/watcher-client.ts
import { gzipSync } from "node:zlib";
var DEFAULT_RETRY = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 5e3,
  timeoutMs: 3e4
};
var WatcherClient = class {
  serverUrl;
  authToken;
  projectId;
  onRetry;
  onSplit;
  constructor(options) {
    this.serverUrl = options.serverUrl.replace(/\/$/, "");
    this.authToken = options.authToken;
    this.projectId = options.projectId;
    this.onRetry = options.onRetry;
    this.onSplit = options.onSplit;
  }
  /**
   * Проверяет доступность сервера
   */
  async healthCheck() {
    try {
      const res = await fetch(`${this.serverUrl}/health`, {
        signal: AbortSignal.timeout(5e3)
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  /**
   * Отправляет heartbeat на сервер для отслеживания активности вотчера.
   * Сервер обновляет lastPushAt — MCP tools видят "watcher active".
   */
  async sendHeartbeat(filesCount) {
    try {
      const res = await fetch(`${this.serverUrl}/api/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.authToken}`,
          "Connection": "close"
        },
        body: JSON.stringify({
          project_id: this.projectId,
          files_count: filesCount,
          timestamp: Date.now()
        }),
        signal: AbortSignal.timeout(5e3)
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  /**
   * Отправляет батч сжатых файлов на сервер с retry-логикой.
   *
   * Оптимизации:
   *   - gzip-сжатие тела (экономия ~70-80% трафика)
   *   - Connection: close (избегаем ECONNRESET на VPS)
   */
  async pushBatch(files) {
    const jsonBody = JSON.stringify({
      project_id: this.projectId,
      files: files.map((f) => ({
        path: f.path,
        hash: f.hash,
        sizeBytes: f.sizeBytes,
        language: f.language,
        lineCount: f.lineCount,
        l1Summary: f.l1Summary,
        l3Summary: f.l3Summary,
        imports: f.imports,
        symbols: f.symbols,
        rawSnippet: f.rawSnippet
      }))
    });
    const gzipped = gzipSync(Buffer.from(jsonBody, "utf-8"));
    await this.fetchWithRetry(
      `${this.serverUrl}/api/push_indexed`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
          "Authorization": `Bearer ${this.authToken}`,
          // Новое TCP-соединение на каждый запрос —
          // исключает ECONNRESET от stale keep-alive
          "Connection": "close"
        },
        body: gzipped
      },
      DEFAULT_RETRY
    );
  }
  /**
   * Адаптивная отправка батча с рекурсивным дроблением.
   *
   * Стратегия:
   *   1. Попытка отправить весь батч целиком (pushBatch + retry)
   *   2. При неудаче — делим пополам, последовательно отправляем каждую половину
   *   3. Рекурсия до одного файла; если единичный файл не проходит — failed
   *
   * Решает проблему "толстого батча": payload > 40KB может не пройти
   * через нестабильный VPS-канал. Дробление гарантирует, что мелкие файлы
   * всегда доставляются, а гиганты изолируются.
   *
   * @param files — массив файлов для отправки
   * @param depth — текущая глубина рекурсии (для логирования)
   * @returns Результат: какие файлы загружены, какие нет
   */
  async pushBatchAdaptive(files, depth = 0) {
    if (files.length === 0) {
      return { uploaded: [], failed: [] };
    }
    try {
      await this.pushBatch(files);
      return { uploaded: files, failed: [] };
    } catch {
      if (files.length === 1) {
        return { uploaded: [], failed: files };
      }
      const mid = Math.ceil(files.length / 2);
      const leftHalf = files.slice(0, mid);
      const rightHalf = files.slice(mid);
      this.onSplit?.(files.length, mid, depth + 1);
      const leftResult = await this.pushBatchAdaptive(leftHalf, depth + 1);
      await new Promise((r) => setTimeout(r, 200));
      const rightResult = await this.pushBatchAdaptive(rightHalf, depth + 1);
      return {
        uploaded: [...leftResult.uploaded, ...rightResult.uploaded],
        failed: [...leftResult.failed, ...rightResult.failed]
      };
    }
  }
  /**
   * fetch с экспоненциальным backoff + jitter
   *
   * Обрабатывает:
   * - TypeError: fetch failed (сетевой сброс, DNS)
   * - TimeoutError (AbortSignal.timeout)
   * - HTTP 5xx (серверные ошибки)
   *
   * Не ретраит:
   * - HTTP 4xx (клиентские ошибки — проблема в данных)
   */
  async fetchWithRetry(url, init, config) {
    let lastError = null;
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(config.timeoutMs)
        });
        if (res.status >= 400 && res.status < 500) {
          const text = await res.text().catch(() => "Unknown error");
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        if (res.status >= 500) {
          const text = await res.text().catch(() => "Server error");
          lastError = new Error(`HTTP ${res.status}: ${text}`);
          if (attempt < config.maxRetries) {
            await this.backoff(attempt, config);
            continue;
          }
          throw lastError;
        }
        return res;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (error.message.startsWith("HTTP 4")) {
          throw error;
        }
        lastError = error;
        if (attempt >= config.maxRetries) {
          throw error;
        }
        this.onRetry?.(attempt + 1, config.maxRetries, error.message);
        await this.backoff(attempt, config);
      }
    }
    throw lastError ?? new Error("fetchWithRetry: unexpected end");
  }
  /**
   * Экспоненциальная задержка с jitter
   * delay = min(baseDelay × 2^attempt + jitter, maxDelay)
   */
  backoff(attempt, config) {
    const exponential = config.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * 500;
    const delay = Math.min(exponential + jitter, config.maxDelayMs);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
};

// cli/pretty-logger.ts
var R = "\x1B[0m";
var B = "\x1B[1m";
var D = "\x1B[2m";
var cYellow = "\x1B[33m";
var cBlue = "\x1B[34m";
var cCyan = "\x1B[36m";
var cWhite = "\x1B[37m";
var cRed = "\x1B[31m";
var cGray = "\x1B[90m";
var cBGreen = "\x1B[92m";
var cBYellow = "\x1B[93m";
var cBBlue = "\x1B[94m";
var cBCyan = "\x1B[96m";
var cBWhite = "\x1B[97m";
var supportsColor = process.stdout.isTTY !== false;
function c(code, text) {
  return supportsColor ? `${code}${text}${R}` : text;
}
function formatBytes(bytes) {
  if (bytes < 1024)
    return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
function formatMs(ms) {
  if (ms < 1e3)
    return `${ms}ms`;
  return `${(ms / 1e3).toFixed(1)}s`;
}
function ts() {
  return c(cGray, (/* @__PURE__ */ new Date()).toLocaleTimeString("ru-RU", { hour12: false }));
}
function progressBar(current, total, width = 28) {
  if (total === 0)
    return c(cGray, "\u2591".repeat(width));
  const pct = Math.min(current / total, 1);
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const bar = c(cBGreen, "\u2588".repeat(filled)) + c(cGray, "\u2591".repeat(empty));
  const pctStr = c(cBWhite, `${Math.round(pct * 100)}%`).padStart(4);
  return `${bar} ${pctStr}`;
}
function printHeader(project, server, version = "0.7.0") {
  const w = 62;
  const line = "\u2500".repeat(w);
  console.log("");
  console.log(c(cBCyan, `  \u250C${line}\u2510`));
  console.log(c(cBCyan, "  \u2502") + c(B + cBWhite, `  \u{1F9E0} Project Brain Smart Watcher`) + c(cGray, `  v${version}`) + " ".repeat(w - 36 - version.length) + c(cBCyan, "\u2502"));
  console.log(c(cBCyan, "  \u2502") + c(cCyan, `  \u25CF `) + c(cBWhite, project.padEnd(24)) + c(cGray, `\u2192  `) + c(cBlue, server.slice(0, 30).padEnd(30)) + c(cBCyan, "\u2502"));
  console.log(c(cBCyan, `  \u2514${line}\u2518`));
  console.log("");
}
function printPhase(n, total, label) {
  const badge = c(cBBlue + B, ` ${n}/${total} `);
  const name = c(B + cBWhite, ` ${label} `);
  const line = c(cGray, "\u2500".repeat(46));
  console.log(`
  ${badge}${name}${line}`);
}
function printInfo(msg) {
  console.log(`  ${ts()}  ${c(cCyan, "\xB7")}  ${msg}`);
}
function printOk(msg) {
  console.log(`  ${ts()}  ${c(cBGreen, "\u2713")}  ${msg}`);
}
function printWarn(msg) {
  console.log(`  ${ts()}  ${c(cBYellow, "\u26A0")}  ${c(cYellow, msg)}`);
}
function printError(msg) {
  console.log(`  ${ts()}  ${c(cRed, "\u2717")}  ${c(cRed, msg)}`);
}
function printSkip(msg) {
  console.log(`  ${ts()}  ${c(cGray, "\u25CB")}  ${c(D + cGray, msg)}`);
}
var _progressStart = 0;
function printProgress(current, total, label) {
  if (current === 1) _progressStart = Date.now();
  if (!supportsColor) {
    if (current % 10 === 0 || current === total) {
      console.log(`  [${current}/${total}] ${label}`);
    }
    return;
  }
  const bar = progressBar(current, total);
  const count = c(cGray, `${current}/${total}`);
  const elapsed = Date.now() - _progressStart;
  const perFile = current > 0 ? elapsed / current : 0;
  const eta = Math.round(perFile * (total - current) / 1e3);
  const etaStr = eta > 0 ? c(cGray, `~${eta}\u0441 \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C`) : c(cBGreen, "\u0433\u043E\u0442\u043E\u0432\u043E");
  process.stdout.write(`\r\x1B[2K  ${bar}  ${count}  ${etaStr}  ${c(cGray, label.slice(0, 28))}  `);
  if (current === total)
    process.stdout.write("\n");
}
var _uploadStart = 0;
function printBatch(batchN, totalBatches, fileCount, sizeStr, ok) {
  if (batchN === 1 && _uploadStart === 0) _uploadStart = Date.now();
  const status = ok ? c(cBGreen, "\u2713") : c(cRed, "\u2717");
  const bar = progressBar(batchN, totalBatches, 20);
  const files = c(cBWhite, `${fileCount} files`);
  const size = c(cGray, `~${sizeStr}`);
  const elapsed = Date.now() - _uploadStart;
  const perBatch = batchN > 0 ? elapsed / batchN : 0;
  const eta = Math.round(perBatch * (totalBatches - batchN) / 1e3);
  const etaStr = batchN < totalBatches ? c(cGray, `~${eta}\u0441`) : c(cBGreen, "\u0433\u043E\u0442\u043E\u0432\u043E");
  if (supportsColor) {
    process.stdout.write(`\r\x1B[2K  ${bar}  ${status} ${files} ${size}  ${etaStr}`);
    if (batchN === totalBatches) process.stdout.write("\n");
  } else {
    console.log(`  Batch ${batchN}/${totalBatches}  ${ok ? "OK" : "FAIL"}  ${fileCount} files  ~${sizeStr}`);
  }
}
function resetUploadTimer() {
  _uploadStart = 0;
}
var SPINNER = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
var _spinnerInterval = null;
var _spinnerIdx = 0;
function startSpinner(label) {
  if (!supportsColor) return;
  _spinnerIdx = 0;
  _spinnerInterval = setInterval(() => {
    const frame = c(cBCyan, SPINNER[_spinnerIdx % SPINNER.length]);
    process.stdout.write(`\r\x1B[2K  ${frame}  ${c(cGray, label)}`);
    _spinnerIdx++;
  }, 80);
}
function stopSpinner() {
  if (_spinnerInterval) {
    clearInterval(_spinnerInterval);
    _spinnerInterval = null;
    process.stdout.write("\r\x1B[2K");
  }
}
function printSummary(opts) {
  const ratio = opts.originalKb > 0 ? (opts.originalKb / Math.max(opts.summaryKb, 1)).toFixed(1) : "\u2014";
  const savedPct = opts.originalKb > 0 ? Math.round((1 - opts.summaryKb / opts.originalKb) * 100) : 0;
  const w = 62;
  const line = "\u2500".repeat(w);
  console.log("");
  console.log(c(cBGreen, `  \u250C${line}\u2510`));
  const title = opts.errors === 0 ? `  \u2705  \u041F\u0440\u043E\u0438\u043D\u0434\u0435\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u043E ${opts.files} \u0444\u0430\u0439\u043B\u043E\u0432 \u0437\u0430 ${formatMs(opts.elapsedMs)}` : `  \u26A0\uFE0F   \u041F\u0440\u043E\u0438\u043D\u0434\u0435\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u043E ${opts.files} \u0444\u0430\u0439\u043B\u043E\u0432 (${opts.errors} \u043E\u0448\u0438\u0431\u043E\u043A) \u0437\u0430 ${formatMs(opts.elapsedMs)}`;
  console.log(c(cBGreen, "  \u2502") + c(B + cBWhite, title).padEnd(w + 8) + c(cBGreen, "\u2502"));
  const stat = `  \u{1F4BE}  \u041E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E ${formatBytes(opts.summaryKb * 1024)}  (\u0438\u0437 ~${formatBytes(opts.originalKb * 1024)} \u0438\u0441\u0445\u043E\u0434\u043D\u044B\u0445)  \xD7${ratio} \u0441\u0436\u0430\u0442\u0438\u0435  (${savedPct}%)`;
  console.log(c(cBGreen, "  \u2502") + c(cCyan, stat).padEnd(w + 9) + c(cBGreen, "\u2502"));
  console.log(c(cBGreen, `  \u2514${line}\u2518`));
  console.log("");
}
function printTokenSavings(rawBytes, summaryBytes, fileCount) {
  if (fileCount === 0) return;
  const CpT = 4;
  const rawTok = Math.round(rawBytes / CpT);
  const sumTok = Math.round(summaryBytes / CpT);
  const savedTok = rawTok - sumTok;
  const savedPct = rawTok > 0 ? Math.round(savedTok / rawTok * 100) : 0;
  const ratio = rawTok > 0 ? (rawTok / Math.max(sumTok, 1)).toFixed(0) : "\u2014";
  const avgRaw = Math.round(rawBytes / fileCount);
  const avgSum = Math.round(summaryBytes / fileCount);
  const fmt = (n) => {
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(n);
  };
  const w = 62;
  const ln = "\u2500".repeat(w);
  const sep = "\u2500".repeat(w - 2);
  const bL = cBBlue;
  const pad = (s, color) => c(bL, "  \u2502") + c(color, s).padEnd(w + 9) + c(bL, "\u2502");
  console.log(c(bL, `  \u250C${ln}\u2510`));
  console.log(c(bL, "  \u2502") + c(B + cBWhite, `  \u{1F9EE}  \u042D\u041A\u041E\u041D\u041E\u041C\u0418\u042F \u0422\u041E\u041A\u0415\u041D\u041E\u0412`).padEnd(w + 8) + c(bL, "\u2502"));
  console.log(c(bL, "  \u2502") + c(cGray, `  ${sep}`).padEnd(w + 8) + c(bL, "\u2502"));
  console.log(pad(`  \u{1F4C4}  \u0418\u0441\u0445\u043E\u0434\u043D\u044B\u0439 \u043A\u043E\u0434:   ~${fmt(rawTok)} \u0442\u043E\u043A\u0435\u043D\u043E\u0432  (${formatBytes(rawBytes)})`, cRed));
  console.log(pad(`  \u{1F9E0}  L1+L3 \u0441\u0443\u043C\u043C\u0430\u0440\u0438:  ~${fmt(sumTok)} \u0442\u043E\u043A\u0435\u043D\u043E\u0432  (${formatBytes(summaryBytes)})`, cBGreen));
  console.log(c(bL, "  \u2502") + c(cGray, `  ${sep}`).padEnd(w + 8) + c(bL, "\u2502"));
  console.log(pad(`  \u{1F4B0}  \u042D\u043A\u043E\u043D\u043E\u043C\u0438\u044F:       ~${fmt(savedTok)} \u0442\u043E\u043A\u0435\u043D\u043E\u0432  (${savedPct}%)`, B + cBYellow));
  console.log(pad(`  \u{1F4CA}  \u0421\u0442\u0435\u043F\u0435\u043D\u044C \u0441\u0436\u0430\u0442\u0438\u044F: \xD7${ratio}  (${fileCount} \u0444\u0430\u0439\u043B\u043E\u0432)`, cBCyan));
  console.log(c(bL, "  \u2502") + c(cGray, `  ${sep}`).padEnd(w + 8) + c(bL, "\u2502"));
  console.log(pad(`  \u{1F4D0}  \u0421\u0440\u0435\u0434\u043D\u0438\u0439 \u0444\u0430\u0439\u043B:   ${formatBytes(avgRaw)} \u2192 ${formatBytes(avgSum)}`, cGray));
  console.log(pad(`  \u26A1  \u041D\u0430 \u043F\u0440\u043E\u0432\u043E\u0434\u0435:     gzip \u0435\u0449\u0451 ~70% \u043C\u0435\u043D\u044C\u0448\u0435`, cGray));
  console.log(c(bL, `  \u2514${ln}\u2518`));
  console.log("");
}
function printRescanResult(opts) {
  const parts = [];
  if (opts.added > 0) parts.push(c(cBGreen, `+${opts.added} \u043D\u043E\u0432\u044B\u0445`));
  if (opts.changed > 0) parts.push(c(cBYellow, `~${opts.changed} \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u043E`));
  if (opts.removed > 0) parts.push(c(cRed, `-${opts.removed} \u0443\u0434\u0430\u043B\u0435\u043D\u043E`));
  if (parts.length === 0) {
    console.log(`  ${ts()}  ${c(cGray, "\u25CB")}  ${c(cGray, `Rescan: \u0431\u0435\u0437 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439 (${opts.unchanged} \u0444\u0430\u0439\u043B\u043E\u0432)  \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u0447\u0435\u0440\u0435\u0437 ${opts.nextInMin} \u043C\u0438\u043D`)}`);
    return;
  }
  const diff = parts.join(c(cGray, ", "));
  const time = c(cGray, formatMs(opts.elapsedMs));
  const next = c(cGray, `\u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u0447\u0435\u0440\u0435\u0437 ${opts.nextInMin} \u043C\u0438\u043D`);
  console.log(`  ${ts()}  ${c(cBCyan, "\u21BB")}  Rescan: ${diff}  ${c(cGray, "|")}  \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043E ${opts.uploaded}  ${time}  ${next}`);
}
function printVerification(opts) {
  const w = 62;
  const ln = "\u2500".repeat(w);
  const sep = "\u2500".repeat(w - 2);
  const bL = cBCyan;
  const pad = (s, color) => c(bL, "  \u2502") + c(color, s).padEnd(w + 9) + c(bL, "\u2502");
  console.log(c(bL, `  \u250C${ln}\u2510`));
  console.log(c(bL, "  \u2502") + c(B + cBWhite, `  \u{1F4CB}  \u0412\u0415\u0420\u0418\u0424\u0418\u041A\u0410\u0426\u0418\u042F \u0421\u041A\u0410\u041D\u0418\u0420\u041E\u0412\u0410\u041D\u0418\u042F`).padEnd(w + 8) + c(bL, "\u2502"));
  console.log(c(bL, "  \u2502") + c(cGray, `  ${sep}`).padEnd(w + 8) + c(bL, "\u2502"));
  const extEntries = Object.entries(opts.byExt).sort((a, b) => b[1] - a[1]);
  console.log(pad(`  \u{1F4C2}  \u041E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043E \u043F\u043E \u0442\u0438\u043F\u0430\u043C \u0444\u0430\u0439\u043B\u043E\u0432:`, B + cBWhite));
  for (const [ext, count] of extEntries) {
    const pct = opts.compressed > 0 ? Math.round(count / opts.compressed * 100) : 0;
    const bar = "\u2588".repeat(Math.max(1, Math.round(pct / 5)));
    console.log(pad(`       ${ext.padEnd(8)} ${String(count).padStart(4)} \u0444\u0430\u0439\u043B(\u043E\u0432)  ${pct}%  ${bar}`, cCyan));
  }
  console.log(c(bL, "  \u2502") + c(cGray, `  ${sep}`).padEnd(w + 8) + c(bL, "\u2502"));
  const skippedExtEntries = Object.entries(opts.skippedByExt).sort((a, b) => b[1] - a[1]);
  if (skippedExtEntries.length > 0) {
    console.log(pad(`  \u{1F6AB}  \u041F\u0440\u043E\u043F\u0443\u0449\u0435\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F (\u043D\u0435 \u0432 \u0441\u043F\u0438\u0441\u043A\u0435 --exts):`, B + cBYellow));
    const top = skippedExtEntries.slice(0, 10);
    for (const [ext, count] of top) {
      console.log(pad(`       ${ext.padEnd(8)} ${String(count).padStart(4)} \u0444\u0430\u0439\u043B(\u043E\u0432)`, cYellow));
    }
    if (skippedExtEntries.length > 10) {
      const rest = skippedExtEntries.slice(10).reduce((s, [, c2]) => s + c2, 0);
      console.log(pad(`       ...\u0438 \u0435\u0449\u0451 ${skippedExtEntries.length - 10} \u0442\u0438\u043F\u043E\u0432 (${rest} \u0444\u0430\u0439\u043B\u043E\u0432)`, cGray));
    }
    console.log(c(bL, "  \u2502") + c(cGray, `  ${sep}`).padEnd(w + 8) + c(bL, "\u2502"));
  }
  const { tooLarge, readError, compressError } = opts.skipInfo;
  const totalSkips = tooLarge.length + readError.length + compressError.length;
  if (totalSkips > 0) {
    console.log(pad(`  \u26A0\uFE0F   \u041F\u0440\u043E\u043F\u0443\u0449\u0435\u043D\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B: ${totalSkips}`, B + cBYellow));
    if (tooLarge.length > 0) {
      console.log(pad(`       \u{1F5C4}\uFE0F  \u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u0438\u0435 (>500KB): ${tooLarge.length}`, cYellow));
      for (const f of tooLarge.slice(0, 5)) {
        console.log(pad(`          ${f}`, cGray));
      }
      if (tooLarge.length > 5) console.log(pad(`          ...\u0438 \u0435\u0449\u0451 ${tooLarge.length - 5}`, cGray));
    }
    if (readError.length > 0) {
      console.log(pad(`       \u{1F4DB}  \u041E\u0448\u0438\u0431\u043A\u0438 \u0447\u0442\u0435\u043D\u0438\u044F: ${readError.length}`, cRed));
      for (const f of readError.slice(0, 5)) {
        console.log(pad(`          ${f}`, cGray));
      }
      if (readError.length > 5) console.log(pad(`          ...\u0438 \u0435\u0449\u0451 ${readError.length - 5}`, cGray));
    }
    if (compressError.length > 0) {
      console.log(pad(`       \u{1F527}  AST \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D (raw fallback): ${compressError.length}`, cYellow));
      for (const f of compressError.slice(0, 5)) {
        console.log(pad(`          ${f}`, cGray));
      }
      if (compressError.length > 5) console.log(pad(`          ...\u0438 \u0435\u0449\u0451 ${compressError.length - 5}`, cGray));
    }
    console.log(c(bL, "  \u2502") + c(cGray, `  ${sep}`).padEnd(w + 8) + c(bL, "\u2502"));
  }
  const coveragePct = opts.total > 0 ? Math.round(opts.compressed / opts.total * 100) : 0;
  console.log(pad(`  \u2705  \u041F\u043E\u043A\u0440\u044B\u0442\u0438\u0435: ${opts.compressed}/${opts.total} \u0444\u0430\u0439\u043B\u043E\u0432 (${coveragePct}%)`, B + cBGreen));
  if (skippedExtEntries.length > 0) {
    const missedTotal = skippedExtEntries.reduce((s, [, c2]) => s + c2, 0);
    console.log(pad(`  \u{1F4A1}  +${missedTotal} \u0444\u0430\u0439\u043B\u043E\u0432 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u0441 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u043D\u044B\u043C --exts`, cGray));
  }
  console.log(c(bL, `  \u2514${ln}\u2518`));
  console.log("");
}
function printWatchReady(path) {
  console.log("");
  console.log(`  ${c(cBCyan + B, "  \u{1F441}  WATCH MODE  ")}  ${c(cGray, path)}`);
  console.log(c(cGray, `  ${"\u2500".repeat(60)}`));
  console.log(c(cGray, "  Ctrl+C \u0434\u043B\u044F \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0438\n"));
}
function printFileChange(event, relPath, detail = void 0) {
  const icons = {
    modified: c(cBYellow, "\u270E"),
    added: c(cBGreen, "+"),
    deleted: c(cRed, "\u2212"),
    error: c(cRed, "\u2717")
  };
  const colors = {
    modified: cBWhite,
    added: cBGreen,
    deleted: cGray,
    error: cRed
  };
  const icon = icons[event] ?? "\xB7";
  const path = c(colors[event] ?? cWhite, relPath.padEnd(40));
  const det = detail ? c(cGray, detail) : "";
  console.log(`  ${ts()}  ${icon}  ${path}  ${det}`);
}
function printServerCheck(url, ok, ms) {
  const status = ok ? c(cBGreen, "\u2713 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D") : c(cRed, "\u2717 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D");
  console.log(`  ${ts()}  ${c(cCyan, "\u21D7")}  ${c(cGray, url)}  ${status}  ${c(cGray, formatMs(ms))}`);
}

// cli/watch.ts
var BRAIN_CONFIG_DIR = ".brain";
var BRAIN_CONFIG_FILE = "config.json";
function loadBrainConfig(projectPath) {
  const configPath = join(projectPath, BRAIN_CONFIG_DIR, BRAIN_CONFIG_FILE);
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync2(configPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function saveBrainConfig(projectPath, config) {
  const dirPath = join(projectPath, BRAIN_CONFIG_DIR);
  try {
    if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
    const configPath = join(dirPath, BRAIN_CONFIG_FILE);
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    const gitignorePath = join(dirPath, ".gitignore");
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, "*\n", "utf-8");
    }
  } catch {
  }
}
function generateCursorMcpConfig(projectPath, server, token, projectId) {
  const cursorDir = join(projectPath, ".cursor");
  const mcpPath = join(cursorDir, "mcp.json");
  try {
    if (!existsSync(cursorDir)) mkdirSync(cursorDir, { recursive: true });
    let existing = { mcpServers: {} };
    if (existsSync(mcpPath)) {
      try {
        existing = JSON.parse(readFileSync2(mcpPath, "utf-8"));
        if (!existing.mcpServers) existing.mcpServers = {};
      } catch {
        existing = { mcpServers: {} };
      }
    }
    existing.mcpServers["project-brain"] = {
      url: `${server.replace(/\/$/, "")}/mcp`,
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-Default-Project": projectId
      }
    };
    writeFileSync(mcpPath, JSON.stringify(existing, null, 2), "utf-8");
    printOk(`.cursor/mcp.json \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D (project: ${projectId})`);
  } catch {
    printWarn(".cursor/mcp.json \u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C (\u043D\u0435 \u043A\u0440\u0438\u0442\u0438\u0447\u043D\u043E)");
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function printRetry(attempt, maxRetries, error) {
  const msg = `  \u21BB \u043F\u043E\u043F\u044B\u0442\u043A\u0430 ${attempt}/${maxRetries}: ${error}`;
  process.stdout.write(`\x1B[33m${msg}\x1B[0m
`);
}
var DEFAULT_EXTS = ".ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.cs,.go,.rs,.java,.kt,.swift,.rb,.php,.c,.cpp,.h,.hpp,.cc,.vue,.svelte,.html,.htm,.css,.scss,.sass,.less,.json,.yaml,.yml,.xml,.sql,.sh,.md,.graphql,.gql,.dart,.scala,.lua,.r,.ex,.exs,.proto";
var DEFAULT_IGNORE = "node_modules,dist,.git,build,out,coverage,__pycache__,.venv,venv,env,.next,.nuxt,vendor,target,.cache,bin,obj,.idea,.vscode,.DS_Store,package-lock.json,yarn.lock,pnpm-lock.yaml";
function parseArgs(argv) {
  const get = (flag) => {
    const idx = argv.indexOf(flag);
    return idx !== -1 ? argv[idx + 1] : void 0;
  };
  const path = get("--path") ?? process.cwd();
  const brainConfig = loadBrainConfig(path);
  const server = get("--server") ?? brainConfig?.server ?? "";
  const token = get("--token") ?? brainConfig?.token ?? "";
  const project = get("--project") ?? brainConfig?.project_id ?? path.split(/[/\\]/).pop() ?? "default";
  const watch = argv.includes("--watch");
  const extsArg = get("--exts") ?? brainConfig?.extensions ?? DEFAULT_EXTS;
  const ignoreArg = get("--ignore") ?? brainConfig?.ignore ?? DEFAULT_IGNORE;
  const batchSize = parseInt(get("--batch") ?? String(brainConfig?.batch_size ?? 10), 10);
  const intervalMin = parseInt(get("--interval") ?? String(brainConfig?.interval_min ?? 3), 10);
  return {
    path,
    server: server.replace(/\/$/, ""),
    token,
    project,
    watch,
    exts: extsArg.split(",").map((e) => e.trim()),
    ignore: ignoreArg.split(",").map((e) => e.trim()),
    batchSize,
    intervalMin,
    brainConfigLoaded: brainConfig !== null
  };
}
function collectFiles(dir, ignore, exts) {
  const files = [];
  const skippedByExt = {};
  const extsLower = exts.map((e) => e.toLowerCase());
  const ignoreFiles = new Set(ignore.filter((i) => i.includes(".")));
  const ignoreDirs = new Set(ignore.filter((i) => !i.includes(".")));
  function walk(current) {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = String(entry.name);
      if (name.startsWith(".")) continue;
      const fullPath = join(current, name);
      if (entry.isDirectory()) {
        if (ignoreDirs.has(name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        if (ignoreFiles.has(name)) continue;
        const ext = extname(name).toLowerCase();
        if (extsLower.includes(ext)) {
          files.push(fullPath);
        } else if (ext) {
          skippedByExt[ext] = (skippedByExt[ext] || 0) + 1;
        }
      }
    }
  }
  walk(dir);
  return { files, skippedByExt };
}
var IMPORT_REGEX = /import\s+(?:type\s+)?(?:\{[^}]*\}|[^;{]*)\s+from\s+['"]([^'"]+)['"]/g;
var REQUIRE_REGEX = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
var DYNAMIC_IMPORT_REGEX = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
function extractImports(code) {
  const paths = /* @__PURE__ */ new Set();
  for (const regex of [IMPORT_REGEX, REQUIRE_REGEX, DYNAMIC_IMPORT_REGEX]) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(code)) !== null) {
      paths.add(m[1]);
    }
  }
  return [...paths];
}
var SYMBOL_PATTERNS = [
  { regex: /export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/g, type: "function", exported: true },
  { regex: /export\s+(?:default\s+)?class\s+(\w+)/g, type: "class", exported: true },
  { regex: /export\s+(?:default\s+)?(?:const|let|var)\s+(\w+)/g, type: "variable", exported: true },
  { regex: /export\s+(?:default\s+)?(?:type|interface)\s+(\w+)/g, type: "type", exported: true },
  { regex: /(?:^|\n)\s*(?:async\s+)?function\s+(\w+)/g, type: "function", exported: false },
  { regex: /(?:^|\n)\s*class\s+(\w+)/g, type: "class", exported: false }
];
function extractSymbols(code) {
  const seen = /* @__PURE__ */ new Set();
  const symbols = [];
  for (const { regex, type, exported } of SYMBOL_PATTERNS) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(code)) !== null) {
      const name = m[1];
      if (!seen.has(name)) {
        seen.add(name);
        symbols.push({ name, type, isExported: exported });
      }
    }
  }
  return symbols;
}
var RAW_SNIPPET_LIMIT = 3e3;
var MAX_L1_SUMMARY_SIZE = 15e3;
var MAX_L3_SUMMARY_SIZE = 2e3;
function extractRawSnippet(code) {
  if (code.length <= RAW_SNIPPET_LIMIT) return code;
  const cut = code.lastIndexOf("\n", RAW_SNIPPET_LIMIT);
  return code.slice(0, cut > 0 ? cut : RAW_SNIPPET_LIMIT);
}
function truncateSummary(text, maxSize, label) {
  if (text.length <= maxSize) return text;
  const cut = text.lastIndexOf("\n", maxSize);
  const truncated = text.slice(0, cut > 0 ? cut : maxSize);
  return `${truncated}
// ... ${label}: \u043E\u0431\u0440\u0435\u0437\u0430\u043D\u043E (${text.length} \u2192 ${truncated.length} \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432)`;
}
var LANG_MAP = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".cs": "csharp",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".rb": "ruby",
  ".php": "php",
  ".c": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".h": "c-header",
  ".hpp": "cpp-header",
  ".vue": "vue",
  ".svelte": "svelte",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".xml": "xml",
  ".svg": "xml",
  ".sql": "sql",
  ".sh": "shell",
  ".bash": "shell",
  ".md": "markdown",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".proto": "protobuf",
  ".dart": "dart",
  ".scala": "scala",
  ".lua": "lua",
  ".r": "r",
  ".ex": "elixir",
  ".exs": "elixir"
};
function compressFile(absPath, projectRoot, compressor, skipInfo) {
  const relPath = relative(projectRoot, absPath).replace(/\\/g, "/");
  let stat;
  try {
    stat = statSync(absPath);
  } catch {
    skipInfo?.readError.push(relPath);
    return null;
  }
  if (stat.size > 500 * 1024) {
    skipInfo?.tooLarge.push(`${relPath} (${formatBytes(stat.size)})`);
    return null;
  }
  let content;
  try {
    content = readFileSync2(absPath, "utf-8");
  } catch {
    skipInfo?.readError.push(relPath);
    return null;
  }
  const hash = createHash2("md5").update(content).digest("hex");
  const lineCount = content.split("\n").length;
  const ext = extname(absPath).toLowerCase();
  let l1Summary;
  let l3Summary;
  try {
    const l1Result = compressor.compressCode(content, relPath, "L1");
    const l3Result = compressor.compressCode(content, relPath, "L3");
    l1Summary = l1Result.content;
    l3Summary = l3Result.content;
  } catch {
    l1Summary = extractRawSnippet(content);
    l3Summary = `// ${relPath} (${lineCount} lines, ${LANG_MAP[ext] ?? ext})`;
    skipInfo?.compressError.push(relPath);
  }
  l1Summary = truncateSummary(l1Summary, MAX_L1_SUMMARY_SIZE, "L1");
  l3Summary = truncateSummary(l3Summary, MAX_L3_SUMMARY_SIZE, "L3");
  const imports = extractImports(content);
  const symbols = extractSymbols(content);
  const rawSnippet = extractRawSnippet(content);
  return {
    path: relPath,
    hash,
    sizeBytes: stat.size,
    language: LANG_MAP[ext] ?? null,
    lineCount,
    l1Summary,
    l3Summary,
    imports,
    symbols,
    rawSnippet
  };
}
var MAX_BATCH_BYTES = 30 * 1024;
function estimatePayloadSize(file) {
  const l1 = file.l1Summary?.length ?? 0;
  const l3 = file.l3Summary?.length ?? 0;
  const snippet = file.rawSnippet?.length ?? 0;
  const path = file.path?.length ?? 0;
  const importsSize = file.imports ? file.imports.reduce((s, i) => s + i.length + 4, 20) : 0;
  const symbolsSize = file.symbols ? file.symbols.reduce((s, sym) => s + sym.name.length + sym.type.length + 30, 20) : 0;
  return l1 + l3 + snippet + path + importsSize + symbolsSize + 200;
}
function createSmartBatches(files, maxBytes = MAX_BATCH_BYTES) {
  if (files.length === 0) return [];
  const sorted = [...files].sort(
    (a, b) => estimatePayloadSize(a) - estimatePayloadSize(b)
  );
  const batches = [];
  let currentFiles = [];
  let currentSize = 0;
  for (const file of sorted) {
    const fileSize = estimatePayloadSize(file);
    if (fileSize > maxBytes) {
      if (currentFiles.length > 0) {
        batches.push({ batchIndex: batches.length + 1, files: currentFiles });
        currentFiles = [];
        currentSize = 0;
      }
      batches.push({ batchIndex: batches.length + 1, files: [file] });
      continue;
    }
    if (currentSize + fileSize > maxBytes && currentFiles.length > 0) {
      batches.push({ batchIndex: batches.length + 1, files: currentFiles });
      currentFiles = [];
      currentSize = 0;
    }
    currentFiles.push(file);
    currentSize += fileSize;
  }
  if (currentFiles.length > 0) {
    batches.push({ batchIndex: batches.length + 1, files: currentFiles });
  }
  return batches;
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.server) {
    printError("--server \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u0435\u043D  (\u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: https://your-mcp.com)");
    process.exit(1);
  }
  if (!args.token) {
    printError("--token \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u0435\u043D");
    process.exit(1);
  }
  if (!existsSync(args.path)) {
    printError(`\u041F\u0443\u0442\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D: ${args.path}`);
    process.exit(1);
  }
  printHeader(args.project, args.server, "0.11.0");
  if (args.brainConfigLoaded) {
    printInfo("\u{1F4C2} .brain/config.json \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D (CLI-\u0444\u043B\u0430\u0433\u0438 \u0438\u043C\u0435\u044E\u0442 \u043F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442)");
  }
  printPhase(1, 3, "\u041F\u041E\u0414\u041A\u041B\u042E\u0427\u0415\u041D\u0418\u0415");
  const t0 = Date.now();
  const client = new WatcherClient({
    serverUrl: args.server,
    authToken: args.token,
    projectId: args.project,
    batchSize: args.batchSize,
    onRetry: printRetry,
    onSplit: (original, half, depth) => {
      const indent = "  ".repeat(depth);
      printWarn(`${indent}\u26A1 \u0414\u0440\u043E\u0431\u043B\u0435\u043D\u0438\u0435 \u0431\u0430\u0442\u0447\u0430: ${original} \u2192 ${half} + ${original - half} \u0444\u0430\u0439\u043B\u043E\u0432 (\u0433\u043B\u0443\u0431\u0438\u043D\u0430 ${depth})`);
    }
  });
  startSpinner(`\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u043A ${args.server}...`);
  const healthy = await client.healthCheck();
  stopSpinner();
  printServerCheck(args.server, healthy, Date.now() - t0);
  if (!healthy) {
    printError(`\u0421\u0435\u0440\u0432\u0435\u0440 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D: ${args.server}`);
    process.exit(1);
  }
  printPhase(2, 3, "\u0421\u041A\u0410\u041D\u0418\u0420\u041E\u0412\u0410\u041D\u0418\u0415 \u0418 \u0421\u0416\u0410\u0422\u0418\u0415");
  printInfo(`\u041F\u0443\u0442\u044C:  ${args.path}`);
  printInfo(`\u0420\u0430\u0441\u0448:  ${args.exts.join(", ")}   Smart Batch: \u2264${Math.round(MAX_BATCH_BYTES / 1024)} \u041A\u0411`);
  const ignoreShort = args.ignore.length > 6 ? args.ignore.slice(0, 6).join(", ") + `, +${args.ignore.length - 6} \u0435\u0449\u0451` : args.ignore.join(", ");
  printInfo(`\u0418\u0433\u043D\u043E\u0440: ${ignoreShort}  (--ignore \u0434\u043B\u044F \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438)`);
  const tScan = Date.now();
  const collectResult = collectFiles(args.path, args.ignore, args.exts);
  const allFiles = collectResult.files;
  printOk(`\u041D\u0430\u0439\u0434\u0435\u043D\u043E ${allFiles.length} \u0444\u0430\u0439\u043B\u043E\u0432  (${formatBytes(allFiles.reduce((s, f) => {
    try {
      return s + statSync(f).size;
    } catch {
      return s;
    }
  }, 0))} \u0438\u0441\u0445\u043E\u0434\u043D\u044B\u0445)`);
  const skippedExtTotal = Object.values(collectResult.skippedByExt).reduce((s, c2) => s + c2, 0);
  if (skippedExtTotal > 0) {
    const topSkipped = Object.entries(collectResult.skippedByExt).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([ext, cnt]) => `${ext}(${cnt})`).join(", ");
    printWarn(`${skippedExtTotal} \u0444\u0430\u0439\u043B\u043E\u0432 \u043F\u0440\u043E\u043F\u0443\u0449\u0435\u043D\u043E (\u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435 \u043D\u0435 \u0432 --exts): ${topSkipped}`);
  }
  const silentLogger = {
    info: () => {
    },
    warn: () => {
    },
    error: () => {
    },
    debug: () => {
    },
    trace: () => {
    },
    fatal: () => {
    }
  };
  const compressor = new AstCompressor(silentLogger);
  const compressed = [];
  const skipInfo = { tooLarge: [], readError: [], compressError: [] };
  for (let i = 0; i < allFiles.length; i++) {
    const absPath = allFiles[i];
    printProgress(i + 1, allFiles.length, relative(args.path, absPath).replace(/\\/g, "/"));
    const file = compressFile(absPath, args.path, compressor, skipInfo);
    if (file) {
      compressed.push(file);
    }
  }
  const compressErrors = skipInfo.tooLarge.length + skipInfo.readError.length;
  const compressElapsed = Date.now() - tScan;
  const rawKb = Math.round(allFiles.reduce((s, f) => {
    try {
      return s + statSync(f).size;
    } catch {
      return s;
    }
  }, 0) / 1024);
  const sumKb = Math.round(compressed.reduce((s, f) => s + f.l1Summary.length, 0) / 1024);
  const ratio = rawKb > 0 ? (rawKb / Math.max(sumKb, 1)).toFixed(1) : "\u2014";
  printOk(`\u0421\u0436\u0430\u0442\u043E ${compressed.length} \u0444\u0430\u0439\u043B\u043E\u0432 \u0437\u0430 ${(compressElapsed / 1e3).toFixed(1)}\u0441  \u2192  ${formatBytes(sumKb * 1024)}  (\xD7${ratio})`);
  if (compressErrors > 0) printWarn(`${compressErrors} \u0444\u0430\u0439\u043B\u043E\u0432 \u043F\u0440\u043E\u043F\u0443\u0449\u0435\u043D\u043E (\u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u0438\u0435 \u0438\u043B\u0438 \u043D\u0435\u0447\u0438\u0442\u0430\u0435\u043C\u044B\u0435)`);
  if (skipInfo.compressError.length > 0) printInfo(`${skipInfo.compressError.length} \u0444\u0430\u0439\u043B\u043E\u0432 \u0431\u0435\u0437 AST (raw fallback)`);
  printPhase(3, 3, "\u0417\u0410\u0413\u0420\u0423\u0417\u041A\u0410");
  const allBatches = createSmartBatches(compressed);
  const totalBatches = allBatches.length;
  printInfo(`${totalBatches} \u0431\u0430\u0442\u0447\u0435\u0439 (smart: \u2264${Math.round(MAX_BATCH_BYTES / 1024)} \u041A\u0411/\u0431\u0430\u0442\u0447)`);
  resetUploadTimer();
  const uploadStart = Date.now();
  let uploaded = 0;
  const allFailed = [];
  const uploadedPaths = /* @__PURE__ */ new Set();
  for (let bIdx = 0; bIdx < allBatches.length; bIdx++) {
    const entry = allBatches[bIdx];
    const batchBytes = entry.files.reduce((s, f) => s + estimatePayloadSize(f), 0);
    const batchKb = (batchBytes / 1024).toFixed(1);
    startSpinner(`\u0411\u0430\u0442\u0447 ${entry.batchIndex}/${totalBatches} (${entry.files.length} \u0444\u0430\u0439\u043B\u043E\u0432, ~${batchKb} \u041A\u0411)...`);
    const result = await client.pushBatchAdaptive(entry.files);
    stopSpinner();
    uploaded += result.uploaded.length;
    for (const f of result.uploaded) uploadedPaths.add(f.path);
    allFailed.push(...result.failed);
    const elapsed = Date.now() - uploadStart;
    const eta = totalBatches > 1 ? ` ~${((totalBatches - bIdx - 1) * (elapsed / (bIdx + 1)) / 1e3).toFixed(0)}\u0441` : "";
    if (result.failed.length === 0) {
      printOk(`  \u0411\u0430\u0442\u0447 ${entry.batchIndex}/${totalBatches}: ${entry.files.length} \u0444\u0430\u0439\u043B\u043E\u0432 \u2713${eta}`);
    } else if (result.uploaded.length > 0) {
      printWarn(
        `  \u0411\u0430\u0442\u0447 ${entry.batchIndex}/${totalBatches}: ${result.uploaded.length} \u2713 / ${result.failed.length} \u2717${eta}`
      );
    } else {
      printError(`  \u0411\u0430\u0442\u0447 ${entry.batchIndex}/${totalBatches}: \u0432\u0441\u0435 ${entry.files.length} \u0444\u0430\u0439\u043B\u043E\u0432 \u2717${eta}`);
    }
    if (bIdx < allBatches.length - 1) {
      await sleep(150);
    }
  }
  const uploadElapsed = Date.now() - uploadStart;
  printBatch(totalBatches, totalBatches, uploaded, formatBytes(sumKb * 1024), allFailed.length === 0);
  printOk(`\u0417\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043E: ${uploaded} \u0444\u0430\u0439\u043B\u043E\u0432 \u0437\u0430 ${(uploadElapsed / 1e3).toFixed(1)}\u0441 (${totalBatches} \u0431\u0430\u0442\u0447\u0435\u0439)`);
  if (allFailed.length > 0) {
    printWarn(`  ${allFailed.length} \u0444\u0430\u0439\u043B\u043E\u0432 \u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C:`);
    for (const f of allFailed.slice(0, 10)) {
      printError(`    \u2717 ${f.path} (~${(estimatePayloadSize(f) / 1024).toFixed(1)} \u041A\u0411)`);
    }
    if (allFailed.length > 10) {
      printError(`    ... \u0438 \u0435\u0449\u0451 ${allFailed.length - 10}`);
    }
  }
  if (uploaded > 0) {
    const freshConfig = {
      project_id: args.project,
      server: args.server,
      token: args.token,
      extensions: args.exts.join(","),
      ignore: args.ignore.join(","),
      batch_size: args.batchSize,
      interval_min: args.intervalMin
    };
    saveBrainConfig(args.path, freshConfig);
    printOk(args.brainConfigLoaded ? ".brain/config.json \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D (\u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u044B \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D\u044B)" : ".brain/config.json \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D (\u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u0437\u0430\u043F\u0443\u0441\u043A \u0431\u0435\u0437 --server --token --project)");
    generateCursorMcpConfig(args.path, args.server, args.token, args.project);
  } else {
    printWarn("\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043D\u0435 \u0441\u043E\u0441\u0442\u043E\u044F\u043B\u0430\u0441\u044C \u2014 .cursor/mcp.json \u043D\u0435 \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D");
  }
  printSummary({
    files: uploaded,
    batches: totalBatches,
    originalKb: rawKb,
    summaryKb: sumKb,
    elapsedMs: Date.now() - tScan,
    errors: allFailed.length + compressErrors
  });
  const rawBytesTotal = allFiles.reduce((s, f) => {
    try {
      return s + statSync(f).size;
    } catch {
      return s;
    }
  }, 0);
  const summaryBytesTotal = compressed.reduce((s, f) => s + f.l1Summary.length + f.l3Summary.length, 0);
  printTokenSavings(rawBytesTotal, summaryBytesTotal, uploaded);
  const byExt = {};
  for (const f of compressed) {
    const ext = extname(f.path).toLowerCase() || "(\u0431\u0435\u0437 \u0440\u0430\u0441\u0448.)";
    byExt[ext] = (byExt[ext] || 0) + 1;
  }
  printVerification({
    byExt,
    skipInfo,
    total: allFiles.length + skippedExtTotal,
    compressed: compressed.length,
    skippedByExt: collectResult.skippedByExt
  });
  const hashMap = /* @__PURE__ */ new Map();
  for (const file of compressed) {
    if (uploadedPaths.has(file.path)) {
      hashMap.set(file.path, file.hash);
    }
  }
  const intervalMs = args.intervalMin * 60 * 1e3;
  let rescanRunning = false;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;
  const doRescan = async () => {
    if (rescanRunning) return;
    rescanRunning = true;
    const t = Date.now();
    try {
      const serverAlive = await client.healthCheck();
      if (!serverAlive) {
        consecutiveFailures++;
        const backoffSec = Math.min(30, Math.pow(2, consecutiveFailures));
        printWarn(`\u0421\u0435\u0440\u0432\u0435\u0440 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D (\u043F\u043E\u043F\u044B\u0442\u043A\u0430 ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}), \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0430\u044F \u0447\u0435\u0440\u0435\u0437 ${backoffSec}\u0441`);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          printError("\u0421\u0435\u0440\u0432\u0435\u0440 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0434\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0435 \u0432\u0440\u0435\u043C\u044F. \u0412\u043E\u0442\u0447\u0435\u0440 \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0430\u0435\u0442 \u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u0432 offline-\u0440\u0435\u0436\u0438\u043C\u0435.");
        }
        rescanRunning = false;
        return;
      }
      if (consecutiveFailures > 0) {
        printOk(`\u0421\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u0435 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E \u043F\u043E\u0441\u043B\u0435 ${consecutiveFailures} \u043D\u0435\u0443\u0434\u0430\u0447\u043D\u044B\u0445 \u043F\u043E\u043F\u044B\u0442\u043E\u043A`);
        consecutiveFailures = 0;
      }
      const { files } = collectFiles(args.path, args.ignore, args.exts);
      const currentPaths = /* @__PURE__ */ new Set();
      const changedFiles = [];
      let addedCount = 0;
      let changedCount = 0;
      for (const absPath of files) {
        const content = (() => {
          try {
            return readFileSync2(absPath, "utf-8");
          } catch {
            return null;
          }
        })();
        if (!content) continue;
        const relPath = relative(args.path, absPath).replace(/\\/g, "/");
        currentPaths.add(relPath);
        const hash = createHash2("md5").update(content).digest("hex");
        const prevHash = hashMap.get(relPath);
        if (prevHash === hash) continue;
        const file = compressFile(absPath, args.path, compressor);
        if (!file) continue;
        changedFiles.push(file);
        if (prevHash === void 0) {
          addedCount++;
        } else {
          changedCount++;
        }
      }
      const removedPaths = [];
      for (const [path] of hashMap) {
        if (!currentPaths.has(path)) {
          removedPaths.push(path);
        }
      }
      for (const p of removedPaths) {
        hashMap.delete(p);
      }
      let uploadedCount = 0;
      if (changedFiles.length > 0) {
        const rescanBatches = createSmartBatches(changedFiles);
        for (const batch of rescanBatches) {
          const result = await client.pushBatchAdaptive(batch.files);
          uploadedCount += result.uploaded.length;
          for (const f of result.uploaded) {
            hashMap.set(f.path, f.hash);
          }
          for (const f of result.failed) {
            hashMap.delete(f.path);
          }
          if (result.failed.length > 0) {
            printError(`  Rescan: ${result.failed.length} \u0444\u0430\u0439\u043B\u043E\u0432 \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043E`);
          }
          await sleep(150);
        }
      }
      printRescanResult({
        changed: changedCount,
        added: addedCount,
        removed: removedPaths.length,
        unchanged: currentPaths.size - changedFiles.length,
        uploaded: uploadedCount,
        elapsedMs: Date.now() - t,
        nextInMin: args.intervalMin
      });
    } catch (err) {
      consecutiveFailures++;
      printError(`Rescan \u043E\u0448\u0438\u0431\u043A\u0430 (${consecutiveFailures}): ${String(err)}`);
    } finally {
      rescanRunning = false;
    }
  };
  const rescanTimer = setInterval(() => void doRescan(), intervalMs);
  printOk(`Periodic rescan \u043A\u0430\u0436\u0434\u044B\u0435 ${args.intervalMin} \u043C\u0438\u043D (${hashMap.size} \u0444\u0430\u0439\u043B\u043E\u0432 \u043E\u0442\u0441\u043B\u0435\u0436\u0438\u0432\u0430\u044E\u0442\u0441\u044F)`);
  const HEARTBEAT_INTERVAL_MS = 6e4;
  const heartbeatTimer = setInterval(() => {
    void client.sendHeartbeat(hashMap.size);
  }, HEARTBEAT_INTERVAL_MS);
  if (args.watch) {
    printWatchReady(args.path);
    const watcher = chokidar.watch(args.path, {
      ignored: (p) => {
        const parts = p.split(/[/\\]/);
        return parts.some((part) => args.ignore.includes(part) || part.startsWith("."));
      },
      ignoreInitial: true,
      persistent: true
    });
    const handleChange = async (absPath, event) => {
      if (!args.exts.includes(extname(absPath))) return;
      const file = compressFile(absPath, args.path, compressor);
      if (!file) return;
      hashMap.set(file.path, file.hash);
      const detail = `${formatBytes(file.sizeBytes)} \u2192 ${formatBytes(file.l1Summary.length)} \u0441\u0443\u043C\u043C\u0430\u0440\u0438`;
      try {
        await client.pushBatch([file]);
        printFileChange(event, file.path, detail);
      } catch (err) {
        printFileChange("error", file.path, String(err));
      }
    };
    watcher.on("change", (p) => void handleChange(p, "modified"));
    watcher.on("add", (p) => void handleChange(p, "added"));
    watcher.on("unlink", (absPath) => {
      const relPath = relative(args.path, absPath).replace(/\\/g, "/");
      hashMap.delete(relPath);
      printFileChange("deleted", relPath, "\u0443\u0434\u0430\u043B\u0451\u043D \u0438\u0437 \u0438\u043D\u0434\u0435\u043A\u0441\u0430");
    });
    process.on("SIGINT", async () => {
      console.log("");
      printWarn("\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430 \u0432\u043E\u0442\u0447\u0435\u0440\u0430...");
      clearInterval(rescanTimer);
      clearInterval(heartbeatTimer);
      await watcher.close();
      process.exit(0);
    });
  } else {
    printSkip("\u0421\u043E\u0432\u0435\u0442: \u0434\u043E\u0431\u0430\u0432\u044C --watch \u0434\u043B\u044F \u043C\u0433\u043D\u043E\u0432\u0435\u043D\u043D\u043E\u0439 \u0440\u0435\u0430\u043A\u0446\u0438\u0438 \u043D\u0430 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0444\u0430\u0439\u043B\u043E\u0432");
    printInfo("\u041F\u0440\u043E\u0446\u0435\u0441\u0441 \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F \u0437\u0430\u043F\u0443\u0449\u0435\u043D\u043D\u044B\u043C \u0434\u043B\u044F periodic rescan. Ctrl+C \u0434\u043B\u044F \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0438.");
    process.on("SIGINT", () => {
      console.log("");
      printWarn("\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430...");
      clearInterval(rescanTimer);
      clearInterval(heartbeatTimer);
      process.exit(0);
    });
  }
}
main().catch((err) => {
  printError(`\u041A\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430: ${String(err)}`);
  process.exit(1);
});
