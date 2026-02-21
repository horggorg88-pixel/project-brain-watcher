#!/usr/bin/env node
#!/usr/bin/env node

// cli/watch.ts
import { createHash as createHash2 } from "node:crypto";
import { readFileSync as readFileSync2, statSync, readdirSync, existsSync } from "node:fs";
import { join as join3, relative as relative3, extname as extname2 } from "node:path";

// node_modules/chokidar/esm/index.js
import { stat as statcb } from "fs";
import { stat as stat3, readdir as readdir2 } from "fs/promises";
import { EventEmitter } from "events";
import * as sysPath2 from "path";

// node_modules/readdirp/esm/index.js
import { stat, lstat, readdir, realpath } from "node:fs/promises";
import { Readable } from "node:stream";
import { resolve as presolve, relative as prelative, join as pjoin, sep as psep } from "node:path";
var EntryTypes = {
  FILE_TYPE: "files",
  DIR_TYPE: "directories",
  FILE_DIR_TYPE: "files_directories",
  EVERYTHING_TYPE: "all"
};
var defaultOptions = {
  root: ".",
  fileFilter: (_entryInfo) => true,
  directoryFilter: (_entryInfo) => true,
  type: EntryTypes.FILE_TYPE,
  lstat: false,
  depth: 2147483648,
  alwaysStat: false,
  highWaterMark: 4096
};
Object.freeze(defaultOptions);
var RECURSIVE_ERROR_CODE = "READDIRP_RECURSIVE_ERROR";
var NORMAL_FLOW_ERRORS = /* @__PURE__ */ new Set(["ENOENT", "EPERM", "EACCES", "ELOOP", RECURSIVE_ERROR_CODE]);
var ALL_TYPES = [
  EntryTypes.DIR_TYPE,
  EntryTypes.EVERYTHING_TYPE,
  EntryTypes.FILE_DIR_TYPE,
  EntryTypes.FILE_TYPE
];
var DIR_TYPES = /* @__PURE__ */ new Set([
  EntryTypes.DIR_TYPE,
  EntryTypes.EVERYTHING_TYPE,
  EntryTypes.FILE_DIR_TYPE
]);
var FILE_TYPES = /* @__PURE__ */ new Set([
  EntryTypes.EVERYTHING_TYPE,
  EntryTypes.FILE_DIR_TYPE,
  EntryTypes.FILE_TYPE
]);
var isNormalFlowError = (error) => NORMAL_FLOW_ERRORS.has(error.code);
var wantBigintFsStats = process.platform === "win32";
var emptyFn = (_entryInfo) => true;
var normalizeFilter = (filter) => {
  if (filter === void 0)
    return emptyFn;
  if (typeof filter === "function")
    return filter;
  if (typeof filter === "string") {
    const fl = filter.trim();
    return (entry) => entry.basename === fl;
  }
  if (Array.isArray(filter)) {
    const trItems = filter.map((item) => item.trim());
    return (entry) => trItems.some((f) => entry.basename === f);
  }
  return emptyFn;
};
var ReaddirpStream = class extends Readable {
  constructor(options = {}) {
    super({
      objectMode: true,
      autoDestroy: true,
      highWaterMark: options.highWaterMark
    });
    const opts = { ...defaultOptions, ...options };
    const { root, type } = opts;
    this._fileFilter = normalizeFilter(opts.fileFilter);
    this._directoryFilter = normalizeFilter(opts.directoryFilter);
    const statMethod = opts.lstat ? lstat : stat;
    if (wantBigintFsStats) {
      this._stat = (path) => statMethod(path, { bigint: true });
    } else {
      this._stat = statMethod;
    }
    this._maxDepth = opts.depth ?? defaultOptions.depth;
    this._wantsDir = type ? DIR_TYPES.has(type) : false;
    this._wantsFile = type ? FILE_TYPES.has(type) : false;
    this._wantsEverything = type === EntryTypes.EVERYTHING_TYPE;
    this._root = presolve(root);
    this._isDirent = !opts.alwaysStat;
    this._statsProp = this._isDirent ? "dirent" : "stats";
    this._rdOptions = { encoding: "utf8", withFileTypes: this._isDirent };
    this.parents = [this._exploreDir(root, 1)];
    this.reading = false;
    this.parent = void 0;
  }
  async _read(batch) {
    if (this.reading)
      return;
    this.reading = true;
    try {
      while (!this.destroyed && batch > 0) {
        const par = this.parent;
        const fil = par && par.files;
        if (fil && fil.length > 0) {
          const { path, depth } = par;
          const slice = fil.splice(0, batch).map((dirent) => this._formatEntry(dirent, path));
          const awaited = await Promise.all(slice);
          for (const entry of awaited) {
            if (!entry)
              continue;
            if (this.destroyed)
              return;
            const entryType = await this._getEntryType(entry);
            if (entryType === "directory" && this._directoryFilter(entry)) {
              if (depth <= this._maxDepth) {
                this.parents.push(this._exploreDir(entry.fullPath, depth + 1));
              }
              if (this._wantsDir) {
                this.push(entry);
                batch--;
              }
            } else if ((entryType === "file" || this._includeAsFile(entry)) && this._fileFilter(entry)) {
              if (this._wantsFile) {
                this.push(entry);
                batch--;
              }
            }
          }
        } else {
          const parent = this.parents.pop();
          if (!parent) {
            this.push(null);
            break;
          }
          this.parent = await parent;
          if (this.destroyed)
            return;
        }
      }
    } catch (error) {
      this.destroy(error);
    } finally {
      this.reading = false;
    }
  }
  async _exploreDir(path, depth) {
    let files;
    try {
      files = await readdir(path, this._rdOptions);
    } catch (error) {
      this._onError(error);
    }
    return { files, depth, path };
  }
  async _formatEntry(dirent, path) {
    let entry;
    const basename3 = this._isDirent ? dirent.name : dirent;
    try {
      const fullPath = presolve(pjoin(path, basename3));
      entry = { path: prelative(this._root, fullPath), fullPath, basename: basename3 };
      entry[this._statsProp] = this._isDirent ? dirent : await this._stat(fullPath);
    } catch (err) {
      this._onError(err);
      return;
    }
    return entry;
  }
  _onError(err) {
    if (isNormalFlowError(err) && !this.destroyed) {
      this.emit("warn", err);
    } else {
      this.destroy(err);
    }
  }
  async _getEntryType(entry) {
    if (!entry && this._statsProp in entry) {
      return "";
    }
    const stats = entry[this._statsProp];
    if (stats.isFile())
      return "file";
    if (stats.isDirectory())
      return "directory";
    if (stats && stats.isSymbolicLink()) {
      const full = entry.fullPath;
      try {
        const entryRealPath = await realpath(full);
        const entryRealPathStats = await lstat(entryRealPath);
        if (entryRealPathStats.isFile()) {
          return "file";
        }
        if (entryRealPathStats.isDirectory()) {
          const len = entryRealPath.length;
          if (full.startsWith(entryRealPath) && full.substr(len, 1) === psep) {
            const recursiveError = new Error(`Circular symlink detected: "${full}" points to "${entryRealPath}"`);
            recursiveError.code = RECURSIVE_ERROR_CODE;
            return this._onError(recursiveError);
          }
          return "directory";
        }
      } catch (error) {
        this._onError(error);
        return "";
      }
    }
  }
  _includeAsFile(entry) {
    const stats = entry && entry[this._statsProp];
    return stats && this._wantsEverything && !stats.isDirectory();
  }
};
function readdirp(root, options = {}) {
  let type = options.entryType || options.type;
  if (type === "both")
    type = EntryTypes.FILE_DIR_TYPE;
  if (type)
    options.type = type;
  if (!root) {
    throw new Error("readdirp: root argument is required. Usage: readdirp(root, options)");
  } else if (typeof root !== "string") {
    throw new TypeError("readdirp: root argument must be a string. Usage: readdirp(root, options)");
  } else if (type && !ALL_TYPES.includes(type)) {
    throw new Error(`readdirp: Invalid type passed. Use one of ${ALL_TYPES.join(", ")}`);
  }
  options.root = root;
  return new ReaddirpStream(options);
}

// node_modules/chokidar/esm/handler.js
import { watchFile, unwatchFile, watch as fs_watch } from "fs";
import { open, stat as stat2, lstat as lstat2, realpath as fsrealpath } from "fs/promises";
import * as sysPath from "path";
import { type as osType } from "os";
var STR_DATA = "data";
var STR_END = "end";
var STR_CLOSE = "close";
var EMPTY_FN = () => {
};
var pl = process.platform;
var isWindows = pl === "win32";
var isMacos = pl === "darwin";
var isLinux = pl === "linux";
var isFreeBSD = pl === "freebsd";
var isIBMi = osType() === "OS400";
var EVENTS = {
  ALL: "all",
  READY: "ready",
  ADD: "add",
  CHANGE: "change",
  ADD_DIR: "addDir",
  UNLINK: "unlink",
  UNLINK_DIR: "unlinkDir",
  RAW: "raw",
  ERROR: "error"
};
var EV = EVENTS;
var THROTTLE_MODE_WATCH = "watch";
var statMethods = { lstat: lstat2, stat: stat2 };
var KEY_LISTENERS = "listeners";
var KEY_ERR = "errHandlers";
var KEY_RAW = "rawEmitters";
var HANDLER_KEYS = [KEY_LISTENERS, KEY_ERR, KEY_RAW];
var binaryExtensions = /* @__PURE__ */ new Set([
  "3dm",
  "3ds",
  "3g2",
  "3gp",
  "7z",
  "a",
  "aac",
  "adp",
  "afdesign",
  "afphoto",
  "afpub",
  "ai",
  "aif",
  "aiff",
  "alz",
  "ape",
  "apk",
  "appimage",
  "ar",
  "arj",
  "asf",
  "au",
  "avi",
  "bak",
  "baml",
  "bh",
  "bin",
  "bk",
  "bmp",
  "btif",
  "bz2",
  "bzip2",
  "cab",
  "caf",
  "cgm",
  "class",
  "cmx",
  "cpio",
  "cr2",
  "cur",
  "dat",
  "dcm",
  "deb",
  "dex",
  "djvu",
  "dll",
  "dmg",
  "dng",
  "doc",
  "docm",
  "docx",
  "dot",
  "dotm",
  "dra",
  "DS_Store",
  "dsk",
  "dts",
  "dtshd",
  "dvb",
  "dwg",
  "dxf",
  "ecelp4800",
  "ecelp7470",
  "ecelp9600",
  "egg",
  "eol",
  "eot",
  "epub",
  "exe",
  "f4v",
  "fbs",
  "fh",
  "fla",
  "flac",
  "flatpak",
  "fli",
  "flv",
  "fpx",
  "fst",
  "fvt",
  "g3",
  "gh",
  "gif",
  "graffle",
  "gz",
  "gzip",
  "h261",
  "h263",
  "h264",
  "icns",
  "ico",
  "ief",
  "img",
  "ipa",
  "iso",
  "jar",
  "jpeg",
  "jpg",
  "jpgv",
  "jpm",
  "jxr",
  "key",
  "ktx",
  "lha",
  "lib",
  "lvp",
  "lz",
  "lzh",
  "lzma",
  "lzo",
  "m3u",
  "m4a",
  "m4v",
  "mar",
  "mdi",
  "mht",
  "mid",
  "midi",
  "mj2",
  "mka",
  "mkv",
  "mmr",
  "mng",
  "mobi",
  "mov",
  "movie",
  "mp3",
  "mp4",
  "mp4a",
  "mpeg",
  "mpg",
  "mpga",
  "mxu",
  "nef",
  "npx",
  "numbers",
  "nupkg",
  "o",
  "odp",
  "ods",
  "odt",
  "oga",
  "ogg",
  "ogv",
  "otf",
  "ott",
  "pages",
  "pbm",
  "pcx",
  "pdb",
  "pdf",
  "pea",
  "pgm",
  "pic",
  "png",
  "pnm",
  "pot",
  "potm",
  "potx",
  "ppa",
  "ppam",
  "ppm",
  "pps",
  "ppsm",
  "ppsx",
  "ppt",
  "pptm",
  "pptx",
  "psd",
  "pya",
  "pyc",
  "pyo",
  "pyv",
  "qt",
  "rar",
  "ras",
  "raw",
  "resources",
  "rgb",
  "rip",
  "rlc",
  "rmf",
  "rmvb",
  "rpm",
  "rtf",
  "rz",
  "s3m",
  "s7z",
  "scpt",
  "sgi",
  "shar",
  "snap",
  "sil",
  "sketch",
  "slk",
  "smv",
  "snk",
  "so",
  "stl",
  "suo",
  "sub",
  "swf",
  "tar",
  "tbz",
  "tbz2",
  "tga",
  "tgz",
  "thmx",
  "tif",
  "tiff",
  "tlz",
  "ttc",
  "ttf",
  "txz",
  "udf",
  "uvh",
  "uvi",
  "uvm",
  "uvp",
  "uvs",
  "uvu",
  "viv",
  "vob",
  "war",
  "wav",
  "wax",
  "wbmp",
  "wdp",
  "weba",
  "webm",
  "webp",
  "whl",
  "wim",
  "wm",
  "wma",
  "wmv",
  "wmx",
  "woff",
  "woff2",
  "wrm",
  "wvx",
  "xbm",
  "xif",
  "xla",
  "xlam",
  "xls",
  "xlsb",
  "xlsm",
  "xlsx",
  "xlt",
  "xltm",
  "xltx",
  "xm",
  "xmind",
  "xpi",
  "xpm",
  "xwd",
  "xz",
  "z",
  "zip",
  "zipx"
]);
var isBinaryPath = (filePath) => binaryExtensions.has(sysPath.extname(filePath).slice(1).toLowerCase());
var foreach = (val, fn) => {
  if (val instanceof Set) {
    val.forEach(fn);
  } else {
    fn(val);
  }
};
var addAndConvert = (main2, prop, item) => {
  let container = main2[prop];
  if (!(container instanceof Set)) {
    main2[prop] = container = /* @__PURE__ */ new Set([container]);
  }
  container.add(item);
};
var clearItem = (cont) => (key) => {
  const set = cont[key];
  if (set instanceof Set) {
    set.clear();
  } else {
    delete cont[key];
  }
};
var delFromSet = (main2, prop, item) => {
  const container = main2[prop];
  if (container instanceof Set) {
    container.delete(item);
  } else if (container === item) {
    delete main2[prop];
  }
};
var isEmptySet = (val) => val instanceof Set ? val.size === 0 : !val;
var FsWatchInstances = /* @__PURE__ */ new Map();
function createFsWatchInstance(path, options, listener, errHandler, emitRaw) {
  const handleEvent = (rawEvent, evPath) => {
    listener(path);
    emitRaw(rawEvent, evPath, { watchedPath: path });
    if (evPath && path !== evPath) {
      fsWatchBroadcast(sysPath.resolve(path, evPath), KEY_LISTENERS, sysPath.join(path, evPath));
    }
  };
  try {
    return fs_watch(path, {
      persistent: options.persistent
    }, handleEvent);
  } catch (error) {
    errHandler(error);
    return void 0;
  }
}
var fsWatchBroadcast = (fullPath, listenerType, val1, val2, val3) => {
  const cont = FsWatchInstances.get(fullPath);
  if (!cont)
    return;
  foreach(cont[listenerType], (listener) => {
    listener(val1, val2, val3);
  });
};
var setFsWatchListener = (path, fullPath, options, handlers) => {
  const { listener, errHandler, rawEmitter } = handlers;
  let cont = FsWatchInstances.get(fullPath);
  let watcher;
  if (!options.persistent) {
    watcher = createFsWatchInstance(path, options, listener, errHandler, rawEmitter);
    if (!watcher)
      return;
    return watcher.close.bind(watcher);
  }
  if (cont) {
    addAndConvert(cont, KEY_LISTENERS, listener);
    addAndConvert(cont, KEY_ERR, errHandler);
    addAndConvert(cont, KEY_RAW, rawEmitter);
  } else {
    watcher = createFsWatchInstance(
      path,
      options,
      fsWatchBroadcast.bind(null, fullPath, KEY_LISTENERS),
      errHandler,
      // no need to use broadcast here
      fsWatchBroadcast.bind(null, fullPath, KEY_RAW)
    );
    if (!watcher)
      return;
    watcher.on(EV.ERROR, async (error) => {
      const broadcastErr = fsWatchBroadcast.bind(null, fullPath, KEY_ERR);
      if (cont)
        cont.watcherUnusable = true;
      if (isWindows && error.code === "EPERM") {
        try {
          const fd = await open(path, "r");
          await fd.close();
          broadcastErr(error);
        } catch (err) {
        }
      } else {
        broadcastErr(error);
      }
    });
    cont = {
      listeners: listener,
      errHandlers: errHandler,
      rawEmitters: rawEmitter,
      watcher
    };
    FsWatchInstances.set(fullPath, cont);
  }
  return () => {
    delFromSet(cont, KEY_LISTENERS, listener);
    delFromSet(cont, KEY_ERR, errHandler);
    delFromSet(cont, KEY_RAW, rawEmitter);
    if (isEmptySet(cont.listeners)) {
      cont.watcher.close();
      FsWatchInstances.delete(fullPath);
      HANDLER_KEYS.forEach(clearItem(cont));
      cont.watcher = void 0;
      Object.freeze(cont);
    }
  };
};
var FsWatchFileInstances = /* @__PURE__ */ new Map();
var setFsWatchFileListener = (path, fullPath, options, handlers) => {
  const { listener, rawEmitter } = handlers;
  let cont = FsWatchFileInstances.get(fullPath);
  const copts = cont && cont.options;
  if (copts && (copts.persistent < options.persistent || copts.interval > options.interval)) {
    unwatchFile(fullPath);
    cont = void 0;
  }
  if (cont) {
    addAndConvert(cont, KEY_LISTENERS, listener);
    addAndConvert(cont, KEY_RAW, rawEmitter);
  } else {
    cont = {
      listeners: listener,
      rawEmitters: rawEmitter,
      options,
      watcher: watchFile(fullPath, options, (curr, prev) => {
        foreach(cont.rawEmitters, (rawEmitter2) => {
          rawEmitter2(EV.CHANGE, fullPath, { curr, prev });
        });
        const currmtime = curr.mtimeMs;
        if (curr.size !== prev.size || currmtime > prev.mtimeMs || currmtime === 0) {
          foreach(cont.listeners, (listener2) => listener2(path, curr));
        }
      })
    };
    FsWatchFileInstances.set(fullPath, cont);
  }
  return () => {
    delFromSet(cont, KEY_LISTENERS, listener);
    delFromSet(cont, KEY_RAW, rawEmitter);
    if (isEmptySet(cont.listeners)) {
      FsWatchFileInstances.delete(fullPath);
      unwatchFile(fullPath);
      cont.options = cont.watcher = void 0;
      Object.freeze(cont);
    }
  };
};
var NodeFsHandler = class {
  constructor(fsW) {
    this.fsw = fsW;
    this._boundHandleError = (error) => fsW._handleError(error);
  }
  /**
   * Watch file for changes with fs_watchFile or fs_watch.
   * @param path to file or dir
   * @param listener on fs change
   * @returns closer for the watcher instance
   */
  _watchWithNodeFs(path, listener) {
    const opts = this.fsw.options;
    const directory = sysPath.dirname(path);
    const basename3 = sysPath.basename(path);
    const parent = this.fsw._getWatchedDir(directory);
    parent.add(basename3);
    const absolutePath = sysPath.resolve(path);
    const options = {
      persistent: opts.persistent
    };
    if (!listener)
      listener = EMPTY_FN;
    let closer;
    if (opts.usePolling) {
      const enableBin = opts.interval !== opts.binaryInterval;
      options.interval = enableBin && isBinaryPath(basename3) ? opts.binaryInterval : opts.interval;
      closer = setFsWatchFileListener(path, absolutePath, options, {
        listener,
        rawEmitter: this.fsw._emitRaw
      });
    } else {
      closer = setFsWatchListener(path, absolutePath, options, {
        listener,
        errHandler: this._boundHandleError,
        rawEmitter: this.fsw._emitRaw
      });
    }
    return closer;
  }
  /**
   * Watch a file and emit add event if warranted.
   * @returns closer for the watcher instance
   */
  _handleFile(file, stats, initialAdd) {
    if (this.fsw.closed) {
      return;
    }
    const dirname3 = sysPath.dirname(file);
    const basename3 = sysPath.basename(file);
    const parent = this.fsw._getWatchedDir(dirname3);
    let prevStats = stats;
    if (parent.has(basename3))
      return;
    const listener = async (path, newStats) => {
      if (!this.fsw._throttle(THROTTLE_MODE_WATCH, file, 5))
        return;
      if (!newStats || newStats.mtimeMs === 0) {
        try {
          const newStats2 = await stat2(file);
          if (this.fsw.closed)
            return;
          const at = newStats2.atimeMs;
          const mt = newStats2.mtimeMs;
          if (!at || at <= mt || mt !== prevStats.mtimeMs) {
            this.fsw._emit(EV.CHANGE, file, newStats2);
          }
          if ((isMacos || isLinux || isFreeBSD) && prevStats.ino !== newStats2.ino) {
            this.fsw._closeFile(path);
            prevStats = newStats2;
            const closer2 = this._watchWithNodeFs(file, listener);
            if (closer2)
              this.fsw._addPathCloser(path, closer2);
          } else {
            prevStats = newStats2;
          }
        } catch (error) {
          this.fsw._remove(dirname3, basename3);
        }
      } else if (parent.has(basename3)) {
        const at = newStats.atimeMs;
        const mt = newStats.mtimeMs;
        if (!at || at <= mt || mt !== prevStats.mtimeMs) {
          this.fsw._emit(EV.CHANGE, file, newStats);
        }
        prevStats = newStats;
      }
    };
    const closer = this._watchWithNodeFs(file, listener);
    if (!(initialAdd && this.fsw.options.ignoreInitial) && this.fsw._isntIgnored(file)) {
      if (!this.fsw._throttle(EV.ADD, file, 0))
        return;
      this.fsw._emit(EV.ADD, file, stats);
    }
    return closer;
  }
  /**
   * Handle symlinks encountered while reading a dir.
   * @param entry returned by readdirp
   * @param directory path of dir being read
   * @param path of this item
   * @param item basename of this item
   * @returns true if no more processing is needed for this entry.
   */
  async _handleSymlink(entry, directory, path, item) {
    if (this.fsw.closed) {
      return;
    }
    const full = entry.fullPath;
    const dir = this.fsw._getWatchedDir(directory);
    if (!this.fsw.options.followSymlinks) {
      this.fsw._incrReadyCount();
      let linkPath;
      try {
        linkPath = await fsrealpath(path);
      } catch (e) {
        this.fsw._emitReady();
        return true;
      }
      if (this.fsw.closed)
        return;
      if (dir.has(item)) {
        if (this.fsw._symlinkPaths.get(full) !== linkPath) {
          this.fsw._symlinkPaths.set(full, linkPath);
          this.fsw._emit(EV.CHANGE, path, entry.stats);
        }
      } else {
        dir.add(item);
        this.fsw._symlinkPaths.set(full, linkPath);
        this.fsw._emit(EV.ADD, path, entry.stats);
      }
      this.fsw._emitReady();
      return true;
    }
    if (this.fsw._symlinkPaths.has(full)) {
      return true;
    }
    this.fsw._symlinkPaths.set(full, true);
  }
  _handleRead(directory, initialAdd, wh, target, dir, depth, throttler) {
    directory = sysPath.join(directory, "");
    throttler = this.fsw._throttle("readdir", directory, 1e3);
    if (!throttler)
      return;
    const previous = this.fsw._getWatchedDir(wh.path);
    const current = /* @__PURE__ */ new Set();
    let stream = this.fsw._readdirp(directory, {
      fileFilter: (entry) => wh.filterPath(entry),
      directoryFilter: (entry) => wh.filterDir(entry)
    });
    if (!stream)
      return;
    stream.on(STR_DATA, async (entry) => {
      if (this.fsw.closed) {
        stream = void 0;
        return;
      }
      const item = entry.path;
      let path = sysPath.join(directory, item);
      current.add(item);
      if (entry.stats.isSymbolicLink() && await this._handleSymlink(entry, directory, path, item)) {
        return;
      }
      if (this.fsw.closed) {
        stream = void 0;
        return;
      }
      if (item === target || !target && !previous.has(item)) {
        this.fsw._incrReadyCount();
        path = sysPath.join(dir, sysPath.relative(dir, path));
        this._addToNodeFs(path, initialAdd, wh, depth + 1);
      }
    }).on(EV.ERROR, this._boundHandleError);
    return new Promise((resolve3, reject) => {
      if (!stream)
        return reject();
      stream.once(STR_END, () => {
        if (this.fsw.closed) {
          stream = void 0;
          return;
        }
        const wasThrottled = throttler ? throttler.clear() : false;
        resolve3(void 0);
        previous.getChildren().filter((item) => {
          return item !== directory && !current.has(item);
        }).forEach((item) => {
          this.fsw._remove(directory, item);
        });
        stream = void 0;
        if (wasThrottled)
          this._handleRead(directory, false, wh, target, dir, depth, throttler);
      });
    });
  }
  /**
   * Read directory to add / remove files from `@watched` list and re-read it on change.
   * @param dir fs path
   * @param stats
   * @param initialAdd
   * @param depth relative to user-supplied path
   * @param target child path targeted for watch
   * @param wh Common watch helpers for this path
   * @param realpath
   * @returns closer for the watcher instance.
   */
  async _handleDir(dir, stats, initialAdd, depth, target, wh, realpath2) {
    const parentDir = this.fsw._getWatchedDir(sysPath.dirname(dir));
    const tracked = parentDir.has(sysPath.basename(dir));
    if (!(initialAdd && this.fsw.options.ignoreInitial) && !target && !tracked) {
      this.fsw._emit(EV.ADD_DIR, dir, stats);
    }
    parentDir.add(sysPath.basename(dir));
    this.fsw._getWatchedDir(dir);
    let throttler;
    let closer;
    const oDepth = this.fsw.options.depth;
    if ((oDepth == null || depth <= oDepth) && !this.fsw._symlinkPaths.has(realpath2)) {
      if (!target) {
        await this._handleRead(dir, initialAdd, wh, target, dir, depth, throttler);
        if (this.fsw.closed)
          return;
      }
      closer = this._watchWithNodeFs(dir, (dirPath, stats2) => {
        if (stats2 && stats2.mtimeMs === 0)
          return;
        this._handleRead(dirPath, false, wh, target, dir, depth, throttler);
      });
    }
    return closer;
  }
  /**
   * Handle added file, directory, or glob pattern.
   * Delegates call to _handleFile / _handleDir after checks.
   * @param path to file or ir
   * @param initialAdd was the file added at watch instantiation?
   * @param priorWh depth relative to user-supplied path
   * @param depth Child path actually targeted for watch
   * @param target Child path actually targeted for watch
   */
  async _addToNodeFs(path, initialAdd, priorWh, depth, target) {
    const ready = this.fsw._emitReady;
    if (this.fsw._isIgnored(path) || this.fsw.closed) {
      ready();
      return false;
    }
    const wh = this.fsw._getWatchHelpers(path);
    if (priorWh) {
      wh.filterPath = (entry) => priorWh.filterPath(entry);
      wh.filterDir = (entry) => priorWh.filterDir(entry);
    }
    try {
      const stats = await statMethods[wh.statMethod](wh.watchPath);
      if (this.fsw.closed)
        return;
      if (this.fsw._isIgnored(wh.watchPath, stats)) {
        ready();
        return false;
      }
      const follow = this.fsw.options.followSymlinks;
      let closer;
      if (stats.isDirectory()) {
        const absPath = sysPath.resolve(path);
        const targetPath = follow ? await fsrealpath(path) : path;
        if (this.fsw.closed)
          return;
        closer = await this._handleDir(wh.watchPath, stats, initialAdd, depth, target, wh, targetPath);
        if (this.fsw.closed)
          return;
        if (absPath !== targetPath && targetPath !== void 0) {
          this.fsw._symlinkPaths.set(absPath, targetPath);
        }
      } else if (stats.isSymbolicLink()) {
        const targetPath = follow ? await fsrealpath(path) : path;
        if (this.fsw.closed)
          return;
        const parent = sysPath.dirname(wh.watchPath);
        this.fsw._getWatchedDir(parent).add(wh.watchPath);
        this.fsw._emit(EV.ADD, wh.watchPath, stats);
        closer = await this._handleDir(parent, stats, initialAdd, depth, path, wh, targetPath);
        if (this.fsw.closed)
          return;
        if (targetPath !== void 0) {
          this.fsw._symlinkPaths.set(sysPath.resolve(path), targetPath);
        }
      } else {
        closer = this._handleFile(wh.watchPath, stats, initialAdd);
      }
      ready();
      if (closer)
        this.fsw._addPathCloser(path, closer);
      return false;
    } catch (error) {
      if (this.fsw._handleError(error)) {
        ready();
        return path;
      }
    }
  }
};

// node_modules/chokidar/esm/index.js
var SLASH = "/";
var SLASH_SLASH = "//";
var ONE_DOT = ".";
var TWO_DOTS = "..";
var STRING_TYPE = "string";
var BACK_SLASH_RE = /\\/g;
var DOUBLE_SLASH_RE = /\/\//;
var DOT_RE = /\..*\.(sw[px])$|~$|\.subl.*\.tmp/;
var REPLACER_RE = /^\.[/\\]/;
function arrify(item) {
  return Array.isArray(item) ? item : [item];
}
var isMatcherObject = (matcher) => typeof matcher === "object" && matcher !== null && !(matcher instanceof RegExp);
function createPattern(matcher) {
  if (typeof matcher === "function")
    return matcher;
  if (typeof matcher === "string")
    return (string) => matcher === string;
  if (matcher instanceof RegExp)
    return (string) => matcher.test(string);
  if (typeof matcher === "object" && matcher !== null) {
    return (string) => {
      if (matcher.path === string)
        return true;
      if (matcher.recursive) {
        const relative4 = sysPath2.relative(matcher.path, string);
        if (!relative4) {
          return false;
        }
        return !relative4.startsWith("..") && !sysPath2.isAbsolute(relative4);
      }
      return false;
    };
  }
  return () => false;
}
function normalizePath(path) {
  if (typeof path !== "string")
    throw new Error("string expected");
  path = sysPath2.normalize(path);
  path = path.replace(/\\/g, "/");
  let prepend = false;
  if (path.startsWith("//"))
    prepend = true;
  const DOUBLE_SLASH_RE2 = /\/\//;
  while (path.match(DOUBLE_SLASH_RE2))
    path = path.replace(DOUBLE_SLASH_RE2, "/");
  if (prepend)
    path = "/" + path;
  return path;
}
function matchPatterns(patterns, testString, stats) {
  const path = normalizePath(testString);
  for (let index = 0; index < patterns.length; index++) {
    const pattern = patterns[index];
    if (pattern(path, stats)) {
      return true;
    }
  }
  return false;
}
function anymatch(matchers, testString) {
  if (matchers == null) {
    throw new TypeError("anymatch: specify first argument");
  }
  const matchersArray = arrify(matchers);
  const patterns = matchersArray.map((matcher) => createPattern(matcher));
  if (testString == null) {
    return (testString2, stats) => {
      return matchPatterns(patterns, testString2, stats);
    };
  }
  return matchPatterns(patterns, testString);
}
var unifyPaths = (paths_) => {
  const paths = arrify(paths_).flat();
  if (!paths.every((p) => typeof p === STRING_TYPE)) {
    throw new TypeError(`Non-string provided as watch path: ${paths}`);
  }
  return paths.map(normalizePathToUnix);
};
var toUnix = (string) => {
  let str = string.replace(BACK_SLASH_RE, SLASH);
  let prepend = false;
  if (str.startsWith(SLASH_SLASH)) {
    prepend = true;
  }
  while (str.match(DOUBLE_SLASH_RE)) {
    str = str.replace(DOUBLE_SLASH_RE, SLASH);
  }
  if (prepend) {
    str = SLASH + str;
  }
  return str;
};
var normalizePathToUnix = (path) => toUnix(sysPath2.normalize(toUnix(path)));
var normalizeIgnored = (cwd = "") => (path) => {
  if (typeof path === "string") {
    return normalizePathToUnix(sysPath2.isAbsolute(path) ? path : sysPath2.join(cwd, path));
  } else {
    return path;
  }
};
var getAbsolutePath = (path, cwd) => {
  if (sysPath2.isAbsolute(path)) {
    return path;
  }
  return sysPath2.join(cwd, path);
};
var EMPTY_SET = Object.freeze(/* @__PURE__ */ new Set());
var DirEntry = class {
  constructor(dir, removeWatcher) {
    this.path = dir;
    this._removeWatcher = removeWatcher;
    this.items = /* @__PURE__ */ new Set();
  }
  add(item) {
    const { items } = this;
    if (!items)
      return;
    if (item !== ONE_DOT && item !== TWO_DOTS)
      items.add(item);
  }
  async remove(item) {
    const { items } = this;
    if (!items)
      return;
    items.delete(item);
    if (items.size > 0)
      return;
    const dir = this.path;
    try {
      await readdir2(dir);
    } catch (err) {
      if (this._removeWatcher) {
        this._removeWatcher(sysPath2.dirname(dir), sysPath2.basename(dir));
      }
    }
  }
  has(item) {
    const { items } = this;
    if (!items)
      return;
    return items.has(item);
  }
  getChildren() {
    const { items } = this;
    if (!items)
      return [];
    return [...items.values()];
  }
  dispose() {
    this.items.clear();
    this.path = "";
    this._removeWatcher = EMPTY_FN;
    this.items = EMPTY_SET;
    Object.freeze(this);
  }
};
var STAT_METHOD_F = "stat";
var STAT_METHOD_L = "lstat";
var WatchHelper = class {
  constructor(path, follow, fsw) {
    this.fsw = fsw;
    const watchPath = path;
    this.path = path = path.replace(REPLACER_RE, "");
    this.watchPath = watchPath;
    this.fullWatchPath = sysPath2.resolve(watchPath);
    this.dirParts = [];
    this.dirParts.forEach((parts) => {
      if (parts.length > 1)
        parts.pop();
    });
    this.followSymlinks = follow;
    this.statMethod = follow ? STAT_METHOD_F : STAT_METHOD_L;
  }
  entryPath(entry) {
    return sysPath2.join(this.watchPath, sysPath2.relative(this.watchPath, entry.fullPath));
  }
  filterPath(entry) {
    const { stats } = entry;
    if (stats && stats.isSymbolicLink())
      return this.filterDir(entry);
    const resolvedPath = this.entryPath(entry);
    return this.fsw._isntIgnored(resolvedPath, stats) && this.fsw._hasReadPermissions(stats);
  }
  filterDir(entry) {
    return this.fsw._isntIgnored(this.entryPath(entry), entry.stats);
  }
};
var FSWatcher = class extends EventEmitter {
  // Not indenting methods for history sake; for now.
  constructor(_opts = {}) {
    super();
    this.closed = false;
    this._closers = /* @__PURE__ */ new Map();
    this._ignoredPaths = /* @__PURE__ */ new Set();
    this._throttled = /* @__PURE__ */ new Map();
    this._streams = /* @__PURE__ */ new Set();
    this._symlinkPaths = /* @__PURE__ */ new Map();
    this._watched = /* @__PURE__ */ new Map();
    this._pendingWrites = /* @__PURE__ */ new Map();
    this._pendingUnlinks = /* @__PURE__ */ new Map();
    this._readyCount = 0;
    this._readyEmitted = false;
    const awf = _opts.awaitWriteFinish;
    const DEF_AWF = { stabilityThreshold: 2e3, pollInterval: 100 };
    const opts = {
      // Defaults
      persistent: true,
      ignoreInitial: false,
      ignorePermissionErrors: false,
      interval: 100,
      binaryInterval: 300,
      followSymlinks: true,
      usePolling: false,
      // useAsync: false,
      atomic: true,
      // NOTE: overwritten later (depends on usePolling)
      ..._opts,
      // Change format
      ignored: _opts.ignored ? arrify(_opts.ignored) : arrify([]),
      awaitWriteFinish: awf === true ? DEF_AWF : typeof awf === "object" ? { ...DEF_AWF, ...awf } : false
    };
    if (isIBMi)
      opts.usePolling = true;
    if (opts.atomic === void 0)
      opts.atomic = !opts.usePolling;
    const envPoll = process.env.CHOKIDAR_USEPOLLING;
    if (envPoll !== void 0) {
      const envLower = envPoll.toLowerCase();
      if (envLower === "false" || envLower === "0")
        opts.usePolling = false;
      else if (envLower === "true" || envLower === "1")
        opts.usePolling = true;
      else
        opts.usePolling = !!envLower;
    }
    const envInterval = process.env.CHOKIDAR_INTERVAL;
    if (envInterval)
      opts.interval = Number.parseInt(envInterval, 10);
    let readyCalls = 0;
    this._emitReady = () => {
      readyCalls++;
      if (readyCalls >= this._readyCount) {
        this._emitReady = EMPTY_FN;
        this._readyEmitted = true;
        process.nextTick(() => this.emit(EVENTS.READY));
      }
    };
    this._emitRaw = (...args) => this.emit(EVENTS.RAW, ...args);
    this._boundRemove = this._remove.bind(this);
    this.options = opts;
    this._nodeFsHandler = new NodeFsHandler(this);
    Object.freeze(opts);
  }
  _addIgnoredPath(matcher) {
    if (isMatcherObject(matcher)) {
      for (const ignored of this._ignoredPaths) {
        if (isMatcherObject(ignored) && ignored.path === matcher.path && ignored.recursive === matcher.recursive) {
          return;
        }
      }
    }
    this._ignoredPaths.add(matcher);
  }
  _removeIgnoredPath(matcher) {
    this._ignoredPaths.delete(matcher);
    if (typeof matcher === "string") {
      for (const ignored of this._ignoredPaths) {
        if (isMatcherObject(ignored) && ignored.path === matcher) {
          this._ignoredPaths.delete(ignored);
        }
      }
    }
  }
  // Public methods
  /**
   * Adds paths to be watched on an existing FSWatcher instance.
   * @param paths_ file or file list. Other arguments are unused
   */
  add(paths_, _origAdd, _internal) {
    const { cwd } = this.options;
    this.closed = false;
    this._closePromise = void 0;
    let paths = unifyPaths(paths_);
    if (cwd) {
      paths = paths.map((path) => {
        const absPath = getAbsolutePath(path, cwd);
        return absPath;
      });
    }
    paths.forEach((path) => {
      this._removeIgnoredPath(path);
    });
    this._userIgnored = void 0;
    if (!this._readyCount)
      this._readyCount = 0;
    this._readyCount += paths.length;
    Promise.all(paths.map(async (path) => {
      const res = await this._nodeFsHandler._addToNodeFs(path, !_internal, void 0, 0, _origAdd);
      if (res)
        this._emitReady();
      return res;
    })).then((results) => {
      if (this.closed)
        return;
      results.forEach((item) => {
        if (item)
          this.add(sysPath2.dirname(item), sysPath2.basename(_origAdd || item));
      });
    });
    return this;
  }
  /**
   * Close watchers or start ignoring events from specified paths.
   */
  unwatch(paths_) {
    if (this.closed)
      return this;
    const paths = unifyPaths(paths_);
    const { cwd } = this.options;
    paths.forEach((path) => {
      if (!sysPath2.isAbsolute(path) && !this._closers.has(path)) {
        if (cwd)
          path = sysPath2.join(cwd, path);
        path = sysPath2.resolve(path);
      }
      this._closePath(path);
      this._addIgnoredPath(path);
      if (this._watched.has(path)) {
        this._addIgnoredPath({
          path,
          recursive: true
        });
      }
      this._userIgnored = void 0;
    });
    return this;
  }
  /**
   * Close watchers and remove all listeners from watched paths.
   */
  close() {
    if (this._closePromise) {
      return this._closePromise;
    }
    this.closed = true;
    this.removeAllListeners();
    const closers = [];
    this._closers.forEach((closerList) => closerList.forEach((closer) => {
      const promise = closer();
      if (promise instanceof Promise)
        closers.push(promise);
    }));
    this._streams.forEach((stream) => stream.destroy());
    this._userIgnored = void 0;
    this._readyCount = 0;
    this._readyEmitted = false;
    this._watched.forEach((dirent) => dirent.dispose());
    this._closers.clear();
    this._watched.clear();
    this._streams.clear();
    this._symlinkPaths.clear();
    this._throttled.clear();
    this._closePromise = closers.length ? Promise.all(closers).then(() => void 0) : Promise.resolve();
    return this._closePromise;
  }
  /**
   * Expose list of watched paths
   * @returns for chaining
   */
  getWatched() {
    const watchList = {};
    this._watched.forEach((entry, dir) => {
      const key = this.options.cwd ? sysPath2.relative(this.options.cwd, dir) : dir;
      const index = key || ONE_DOT;
      watchList[index] = entry.getChildren().sort();
    });
    return watchList;
  }
  emitWithAll(event, args) {
    this.emit(event, ...args);
    if (event !== EVENTS.ERROR)
      this.emit(EVENTS.ALL, event, ...args);
  }
  // Common helpers
  // --------------
  /**
   * Normalize and emit events.
   * Calling _emit DOES NOT MEAN emit() would be called!
   * @param event Type of event
   * @param path File or directory path
   * @param stats arguments to be passed with event
   * @returns the error if defined, otherwise the value of the FSWatcher instance's `closed` flag
   */
  async _emit(event, path, stats) {
    if (this.closed)
      return;
    const opts = this.options;
    if (isWindows)
      path = sysPath2.normalize(path);
    if (opts.cwd)
      path = sysPath2.relative(opts.cwd, path);
    const args = [path];
    if (stats != null)
      args.push(stats);
    const awf = opts.awaitWriteFinish;
    let pw;
    if (awf && (pw = this._pendingWrites.get(path))) {
      pw.lastChange = /* @__PURE__ */ new Date();
      return this;
    }
    if (opts.atomic) {
      if (event === EVENTS.UNLINK) {
        this._pendingUnlinks.set(path, [event, ...args]);
        setTimeout(() => {
          this._pendingUnlinks.forEach((entry, path2) => {
            this.emit(...entry);
            this.emit(EVENTS.ALL, ...entry);
            this._pendingUnlinks.delete(path2);
          });
        }, typeof opts.atomic === "number" ? opts.atomic : 100);
        return this;
      }
      if (event === EVENTS.ADD && this._pendingUnlinks.has(path)) {
        event = EVENTS.CHANGE;
        this._pendingUnlinks.delete(path);
      }
    }
    if (awf && (event === EVENTS.ADD || event === EVENTS.CHANGE) && this._readyEmitted) {
      const awfEmit = (err, stats2) => {
        if (err) {
          event = EVENTS.ERROR;
          args[0] = err;
          this.emitWithAll(event, args);
        } else if (stats2) {
          if (args.length > 1) {
            args[1] = stats2;
          } else {
            args.push(stats2);
          }
          this.emitWithAll(event, args);
        }
      };
      this._awaitWriteFinish(path, awf.stabilityThreshold, event, awfEmit);
      return this;
    }
    if (event === EVENTS.CHANGE) {
      const isThrottled = !this._throttle(EVENTS.CHANGE, path, 50);
      if (isThrottled)
        return this;
    }
    if (opts.alwaysStat && stats === void 0 && (event === EVENTS.ADD || event === EVENTS.ADD_DIR || event === EVENTS.CHANGE)) {
      const fullPath = opts.cwd ? sysPath2.join(opts.cwd, path) : path;
      let stats2;
      try {
        stats2 = await stat3(fullPath);
      } catch (err) {
      }
      if (!stats2 || this.closed)
        return;
      args.push(stats2);
    }
    this.emitWithAll(event, args);
    return this;
  }
  /**
   * Common handler for errors
   * @returns The error if defined, otherwise the value of the FSWatcher instance's `closed` flag
   */
  _handleError(error) {
    const code = error && error.code;
    if (error && code !== "ENOENT" && code !== "ENOTDIR" && (!this.options.ignorePermissionErrors || code !== "EPERM" && code !== "EACCES")) {
      this.emit(EVENTS.ERROR, error);
    }
    return error || this.closed;
  }
  /**
   * Helper utility for throttling
   * @param actionType type being throttled
   * @param path being acted upon
   * @param timeout duration of time to suppress duplicate actions
   * @returns tracking object or false if action should be suppressed
   */
  _throttle(actionType, path, timeout) {
    if (!this._throttled.has(actionType)) {
      this._throttled.set(actionType, /* @__PURE__ */ new Map());
    }
    const action = this._throttled.get(actionType);
    if (!action)
      throw new Error("invalid throttle");
    const actionPath = action.get(path);
    if (actionPath) {
      actionPath.count++;
      return false;
    }
    let timeoutObject;
    const clear = () => {
      const item = action.get(path);
      const count = item ? item.count : 0;
      action.delete(path);
      clearTimeout(timeoutObject);
      if (item)
        clearTimeout(item.timeoutObject);
      return count;
    };
    timeoutObject = setTimeout(clear, timeout);
    const thr = { timeoutObject, clear, count: 0 };
    action.set(path, thr);
    return thr;
  }
  _incrReadyCount() {
    return this._readyCount++;
  }
  /**
   * Awaits write operation to finish.
   * Polls a newly created file for size variations. When files size does not change for 'threshold' milliseconds calls callback.
   * @param path being acted upon
   * @param threshold Time in milliseconds a file size must be fixed before acknowledging write OP is finished
   * @param event
   * @param awfEmit Callback to be called when ready for event to be emitted.
   */
  _awaitWriteFinish(path, threshold, event, awfEmit) {
    const awf = this.options.awaitWriteFinish;
    if (typeof awf !== "object")
      return;
    const pollInterval = awf.pollInterval;
    let timeoutHandler;
    let fullPath = path;
    if (this.options.cwd && !sysPath2.isAbsolute(path)) {
      fullPath = sysPath2.join(this.options.cwd, path);
    }
    const now = /* @__PURE__ */ new Date();
    const writes = this._pendingWrites;
    function awaitWriteFinishFn(prevStat) {
      statcb(fullPath, (err, curStat) => {
        if (err || !writes.has(path)) {
          if (err && err.code !== "ENOENT")
            awfEmit(err);
          return;
        }
        const now2 = Number(/* @__PURE__ */ new Date());
        if (prevStat && curStat.size !== prevStat.size) {
          writes.get(path).lastChange = now2;
        }
        const pw = writes.get(path);
        const df = now2 - pw.lastChange;
        if (df >= threshold) {
          writes.delete(path);
          awfEmit(void 0, curStat);
        } else {
          timeoutHandler = setTimeout(awaitWriteFinishFn, pollInterval, curStat);
        }
      });
    }
    if (!writes.has(path)) {
      writes.set(path, {
        lastChange: now,
        cancelWait: () => {
          writes.delete(path);
          clearTimeout(timeoutHandler);
          return event;
        }
      });
      timeoutHandler = setTimeout(awaitWriteFinishFn, pollInterval);
    }
  }
  /**
   * Determines whether user has asked to ignore this path.
   */
  _isIgnored(path, stats) {
    if (this.options.atomic && DOT_RE.test(path))
      return true;
    if (!this._userIgnored) {
      const { cwd } = this.options;
      const ign = this.options.ignored;
      const ignored = (ign || []).map(normalizeIgnored(cwd));
      const ignoredPaths = [...this._ignoredPaths];
      const list = [...ignoredPaths.map(normalizeIgnored(cwd)), ...ignored];
      this._userIgnored = anymatch(list, void 0);
    }
    return this._userIgnored(path, stats);
  }
  _isntIgnored(path, stat4) {
    return !this._isIgnored(path, stat4);
  }
  /**
   * Provides a set of common helpers and properties relating to symlink handling.
   * @param path file or directory pattern being watched
   */
  _getWatchHelpers(path) {
    return new WatchHelper(path, this.options.followSymlinks, this);
  }
  // Directory helpers
  // -----------------
  /**
   * Provides directory tracking objects
   * @param directory path of the directory
   */
  _getWatchedDir(directory) {
    const dir = sysPath2.resolve(directory);
    if (!this._watched.has(dir))
      this._watched.set(dir, new DirEntry(dir, this._boundRemove));
    return this._watched.get(dir);
  }
  // File helpers
  // ------------
  /**
   * Check for read permissions: https://stackoverflow.com/a/11781404/1358405
   */
  _hasReadPermissions(stats) {
    if (this.options.ignorePermissionErrors)
      return true;
    return Boolean(Number(stats.mode) & 256);
  }
  /**
   * Handles emitting unlink events for
   * files and directories, and via recursion, for
   * files and directories within directories that are unlinked
   * @param directory within which the following item is located
   * @param item      base path of item/directory
   */
  _remove(directory, item, isDirectory) {
    const path = sysPath2.join(directory, item);
    const fullPath = sysPath2.resolve(path);
    isDirectory = isDirectory != null ? isDirectory : this._watched.has(path) || this._watched.has(fullPath);
    if (!this._throttle("remove", path, 100))
      return;
    if (!isDirectory && this._watched.size === 1) {
      this.add(directory, item, true);
    }
    const wp = this._getWatchedDir(path);
    const nestedDirectoryChildren = wp.getChildren();
    nestedDirectoryChildren.forEach((nested) => this._remove(path, nested));
    const parent = this._getWatchedDir(directory);
    const wasTracked = parent.has(item);
    parent.remove(item);
    if (this._symlinkPaths.has(fullPath)) {
      this._symlinkPaths.delete(fullPath);
    }
    let relPath = path;
    if (this.options.cwd)
      relPath = sysPath2.relative(this.options.cwd, path);
    if (this.options.awaitWriteFinish && this._pendingWrites.has(relPath)) {
      const event = this._pendingWrites.get(relPath).cancelWait();
      if (event === EVENTS.ADD)
        return;
    }
    this._watched.delete(path);
    this._watched.delete(fullPath);
    const eventName = isDirectory ? EVENTS.UNLINK_DIR : EVENTS.UNLINK;
    if (wasTracked && !this._isIgnored(path))
      this._emit(eventName, path);
    this._closePath(path);
  }
  /**
   * Closes all watchers for a path
   */
  _closePath(path) {
    this._closeFile(path);
    const dir = sysPath2.dirname(path);
    this._getWatchedDir(dir).remove(sysPath2.basename(path));
  }
  /**
   * Closes only file-specific watchers
   */
  _closeFile(path) {
    const closers = this._closers.get(path);
    if (!closers)
      return;
    closers.forEach((closer) => closer());
    this._closers.delete(path);
  }
  _addPathCloser(path, closer) {
    if (!closer)
      return;
    let list = this._closers.get(path);
    if (!list) {
      list = [];
      this._closers.set(path, list);
    }
    list.push(closer);
  }
  _readdirp(root, opts) {
    if (this.closed)
      return;
    const options = { type: EVENTS.ALL, alwaysStat: true, lstat: true, ...opts, depth: 0 };
    let stream = readdirp(root, options);
    this._streams.add(stream);
    stream.once(STR_CLOSE, () => {
      stream = void 0;
    });
    stream.once(STR_END, () => {
      if (stream) {
        this._streams.delete(stream);
        stream = void 0;
      }
    });
    return stream;
  }
};
function watch(paths, options = {}) {
  const watcher = new FSWatcher(options);
  watcher.add(paths);
  return watcher;
}
var esm_default = { watch, FSWatcher };

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
    return this.compressCode(code, filePath, level);
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
    return new Promise((resolve3) => setTimeout(resolve3, delay));
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
  const stat4 = `  \u{1F4BE}  \u041E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E ${formatBytes(opts.summaryKb * 1024)}  (\u0438\u0437 ~${formatBytes(opts.originalKb * 1024)} \u0438\u0441\u0445\u043E\u0434\u043D\u044B\u0445)  \xD7${ratio} \u0441\u0436\u0430\u0442\u0438\u0435  (${savedPct}%)`;
  console.log(c(cBGreen, "  \u2502") + c(cCyan, stat4).padEnd(w + 9) + c(cBGreen, "\u2502"));
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
  return new Promise((resolve3) => setTimeout(resolve3, ms));
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
  const watch2 = argv.includes("--watch");
  const extsArg = get("--exts") ?? ".ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.cs,.go,.rs,.java,.kt,.swift,.rb,.php,.c,.cpp,.h,.hpp,.cc,.vue,.svelte,.html,.htm,.css,.scss,.sass,.less,.json,.yaml,.yml,.xml,.sql,.sh,.md,.graphql,.gql,.dart,.scala,.lua,.r,.ex,.exs,.proto";
  const ignoreArg = get("--ignore") ?? "node_modules,dist,.git,build,out,coverage,__pycache__,.venv,venv,env,.next,.nuxt,vendor,target,.cache,bin,obj,.idea,.vscode,.DS_Store,package-lock.json,yarn.lock,pnpm-lock.yaml";
  const batchSize = parseInt(get("--batch") ?? "10", 10);
  const intervalMin = parseInt(get("--interval") ?? "3", 10);
  return {
    path,
    server: server.replace(/\/$/, ""),
    token,
    project,
    watch: watch2,
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
      const fullPath = join3(current, name);
      if (entry.isDirectory()) {
        if (ignoreDirs.has(name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        if (ignoreFiles.has(name)) continue;
        const ext = extname2(name).toLowerCase();
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
  const relPath = relative3(projectRoot, absPath).replace(/\\/g, "/");
  let stat4;
  try {
    stat4 = statSync(absPath);
  } catch {
    skipInfo?.readError.push(relPath);
    return null;
  }
  if (stat4.size > 500 * 1024) {
    skipInfo?.tooLarge.push(`${relPath} (${formatBytes(stat4.size)})`);
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
  const ext = extname2(absPath).toLowerCase();
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
    sizeBytes: stat4.size,
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
    printProgress(i + 1, allFiles.length, relative3(args.path, absPath).replace(/\\/g, "/"));
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
    const ext = extname2(f.path).toLowerCase() || "(\u0431\u0435\u0437 \u0440\u0430\u0441\u0448.)";
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
        const relPath = relative3(args.path, absPath).replace(/\\/g, "/");
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
    const watcher = esm_default.watch(args.path, {
      ignored: (p) => {
        const parts = p.split(/[/\\]/);
        return parts.some((part) => args.ignore.includes(part) || part.startsWith("."));
      },
      ignoreInitial: true,
      persistent: true
    });
    const handleChange = async (absPath, event) => {
      if (!args.exts.includes(extname2(absPath))) return;
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
      const relPath = relative3(args.path, absPath).replace(/\\/g, "/");
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
/*! Bundled license information:

chokidar/esm/index.js:
  (*! chokidar - MIT License (c) 2012 Paul Miller (paulmillr.com) *)
*/
