#!/usr/bin/env node
#!/usr/bin/env node

// cli/watch.ts
import { createHash as createHash2 } from "node:crypto";
import { readFileSync as readFileSync2, statSync, readdirSync, existsSync } from "node:fs";
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
   * Ищет закрывающую скобку, пропуская строки, шаблонные литералы и комментарии.
   * Критично для корректного определения endLine классов/интерфейсов.
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
  buildRange(startLine, endLine) {
    return {
      start: { line: startLine, column: 0 },
      end: { line: endLine, column: 0 }
    };
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

// src/ast-compressor/ast-compressor.ts
var AstCompressor = class {
  parserRegistry;
  strategies;
  logger;
  constructor(logger) {
    this.logger = logger;
    this.parserRegistry = new ParserRegistry();
    this.parserRegistry.register(new TypeScriptParser(logger));
    this.strategies = /* @__PURE__ */ new Map([
      ["L1", new SignatureFormatter()],
      ["L2", new SkeletonFormatter()],
      ["L3", new MapFormatter()]
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
  compressFile(filePath, level = "L1") {
    const code = readFileSync(filePath, "utf-8");
    return this.compressCode(code, filePath, level = void 0);
  }
  /**
   * Сжимает код (строку) до указанного уровня
   */
  compressCode(code, filePath, level = "L1") {
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
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function printRetry(attempt, maxRetries, error) {
  const msg = `  \u21BB \u043F\u043E\u043F\u044B\u0442\u043A\u0430 ${attempt}/${maxRetries}: ${error}`;
  process.stdout.write(`\x1B[33m${msg}\x1B[0m
`);
}
function parseArgs(argv) {
  const get = (flag) => {
    const idx = argv.indexOf(flag);
    return idx !== -1 ? argv[idx + 1] : void 0;
  };
  const path = get("--path") ?? process.cwd();
  const server = get("--server") ?? "";
  const token = get("--token") ?? "";
  const project = get("--project") ?? path.split(/[/\\]/).pop() ?? "default";
  const watch = argv.includes("--watch");
  const extsArg = get("--exts") ?? ".ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.cs,.go,.rs,.java,.kt,.swift,.rb,.php,.c,.cpp,.h,.hpp,.cc,.vue,.svelte,.html,.htm,.css,.scss,.sass,.less,.json,.yaml,.yml,.xml,.sql,.sh,.md,.graphql,.gql,.dart,.scala,.lua,.r,.ex,.exs,.proto";
  const ignoreArg = get("--ignore") ?? "node_modules,dist,.git,build,out,coverage,__pycache__,.venv,venv,env,.next,.nuxt,vendor,target,.cache,bin,obj,.idea,.vscode,.DS_Store,package-lock.json,yarn.lock,pnpm-lock.yaml";
  const batchSize = parseInt(get("--batch") ?? "10", 10);
  const intervalMin = parseInt(get("--interval") ?? "3", 10);
  return {
    path,
    server: server.replace(/\/$/, ""),
    token,
    project,
    watch,
    exts: extsArg.split(",").map((e) => e.trim()),
    ignore: ignoreArg.split(",").map((e) => e.trim()),
    batchSize,
    intervalMin
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
  printHeader(args.project, args.server, "0.10.0");
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
  const doRescan = async () => {
    if (rescanRunning) return;
    rescanRunning = true;
    const t = Date.now();
    try {
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
      printError(`Rescan \u043E\u0448\u0438\u0431\u043A\u0430: ${String(err)}`);
    } finally {
      rescanRunning = false;
    }
  };
  const rescanTimer = setInterval(() => void doRescan(), intervalMs);
  printOk(`Periodic rescan \u043A\u0430\u0436\u0434\u044B\u0435 ${args.intervalMin} \u043C\u0438\u043D (${hashMap.size} \u0444\u0430\u0439\u043B\u043E\u0432 \u043E\u0442\u0441\u043B\u0435\u0436\u0438\u0432\u0430\u044E\u0442\u0441\u044F)`);
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
      process.exit(0);
    });
  }
}
main().catch((err) => {
  printError(`\u041A\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430: ${String(err)}`);
  process.exit(1);
});
