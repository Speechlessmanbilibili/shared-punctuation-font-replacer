(() => {
  "use strict";
  const { CHANNEL, FAMILY, prepend, hasFonts, cssString, unicodeRange, normalize } = SPF;
  const setProperty = CSSStyleDeclaration.prototype.setProperty;
  const removeProperty = CSSStyleDeclaration.prototype.removeProperty;
  const insertRule = CSSStyleSheet.prototype.insertRule;
  const snapshots = new Map();
  const watchedStyles = new WeakSet();
  const sheetStyles = new WeakMap();
  const resourceSheets = new WeakMap();
  const inlineStyles = new WeakMap();
  const variableSources = new Map();
  const variableSnapshots = new Map();
  let variableTimer = 0;
  let trackedVariables = new Set();
  let nonSansVariables = new Set();
  const roots = new Map();
  const ownNodes = new WeakSet();
  const clones = new Map();
  const pending = new Map();
  const jobs = new Set();
  let config = null;
  let active = false;
  let writing = false;
  let timer = 0;
  let generation = 0;
  let sequence = 0;
  const registeredFonts = [];
  let controlFamilies = null;
  const computedStyle = window.getComputedStyle;
  const nativeShadow = Element.prototype.attachShadow;

  function write(style, value, priority) {
    writing = true;
    try { setProperty.call(style, "font-family", value, priority); }
    finally { writing = false; }
  }
  function appendAllowed(value) {
    return !nonSansVariables.size || !value.includes("--") || ![...SPF.variableReferences(value)].some(name => nonSansVariables.has(name));
  }
  function patchStyle(style, owner = null, refreshVariables = false) {
    if (!active || writing || !style || style.parentRule?.type === CSSRule.FONT_FACE_RULE) return;
    trackVariables(style, owner);
    if (!watchedStyles.has(style)) {
      watchedStyles.add(style);
      // Chromium 的 font/fontFamily 是对象上的动态属性，不能只拦截原型。
      for (const [name, property] of [["fontFamily", "font-family"], ["font", "font"]]) {
        Object.defineProperty(style, name, { configurable: true, enumerable: true,
          get() { return this.getPropertyValue(property); },
          set(value) { setProperty.call(this, property, value); if (!writing) patchStyle(this); }
        });
      }
    }
    const current = style.getPropertyValue("font-family");
    const saved = snapshots.get(style);
    const owned = saved?.modified === current;
    if (owned && !refreshVariables) {
      if (owner && snapshots.has(style)) {
        snapshots.get(style).owner = owner;
        if (owner instanceof Element) inlineStyles.set(owner, style);
      }
      return;
    }
    const value = owned ? saved.value : current;
    const modified = prepend(value, config, appendAllowed(value));
    if (modified === current) { if (modified === value) snapshots.delete(style); return; }
    const priority = owned ? saved.priority : style.getPropertyPriority("font-family");
    if (modified === value) snapshots.delete(style);
    else snapshots.set(style, { value, priority, modified, owner: owner || saved?.owner });
    if (owner instanceof Element) inlineStyles.set(owner, style);
    const sheet = style.parentRule?.parentStyleSheet;
    if (sheet) {
      if (!sheetStyles.has(sheet)) sheetStyles.set(sheet, new Set());
      sheetStyles.get(sheet).add(style);
    }
    write(style, modified, priority);
    if (variableSources.has(style)) variableSources.get(style).signature = style.cssText;
  }
  function trackVariables(style, owner) {
    if (config.cjkMode === "off") return;
    const text = style.cssText;
    if (!text.includes("--")) {
      const previous = variableSources.get(style);
      variableSources.delete(style);
      if (previous && !variableTimer) variableTimer = setTimeout(updateVariables, 0);
      return;
    }
    const previous = variableSources.get(style);
    if (previous?.signature === text) { if (owner) previous.owner = owner; return; }
    const variables = Array.from({ length: style.length }, (_, i) => style.item(i)).filter(name => name.startsWith("--"));
    const values = new Map(variables.map(name => [name, style.getPropertyValue(name)]));
    const fontKey = [...SPF.variableReferences(style.getPropertyValue("font-family"))].sort().join("\0");
    const changed = previous ? previous.fontKey !== fontKey || [...new Set([...previous.variables, ...variables])].some(name => trackedVariables.has(name) && previous.values.get(name) !== values.get(name)) : Boolean(fontKey) || variables.some(name => trackedVariables.has(name));
    variableSources.set(style, { signature: text, variables, values, fontKey, owner: owner || previous?.owner });
    if (changed && !variableTimer) variableTimer = setTimeout(updateVariables, 0);
  }
  function updateVariables() {
    variableTimer = 0;
    if (!active || config.cjkMode === "off") return;
    const references = new Set();
    const graph = new Map();
    const rootInline = document.documentElement?.style;
    function overriddenAtRoot(style, name) {
      if (!rootInline?.getPropertyValue(name)) return false;
      const rule = style.parentRule;
      if (!rule?.selectorText || !SPF.familyList(rule.selectorText).every(x => [":root", "html", "html:root"].includes(x.trim()))) return false;
      let sheet = rule.parentStyleSheet;
      while (sheet?.ownerRule) sheet = sheet.ownerRule.parentStyleSheet;
      if (sheet?.ownerNode?.getRootNode() !== document && !document.adoptedStyleSheets.includes(sheet)) return false;
      return style.getPropertyPriority(name) !== "important" || rootInline.getPropertyPriority(name) === "important";
    }
    for (const [style, source] of variableSources) {
      for (const name of SPF.variableReferences(style.getPropertyValue("font-family"))) references.add(name);
      for (const name of source.variables) {
        if (overriddenAtRoot(style, name)) continue;
        if (!graph.has(name)) graph.set(name, new Set());
        for (const next of SPF.variableReferences(style.getPropertyValue(name))) graph.get(name).add(next);
      }
    }
    const queue = [...references];
    for (let i = 0; i < queue.length; i++) for (const next of graph.get(queue[i]) || []) {
      if (!references.has(next)) { references.add(next); queue.push(next); }
    }
    trackedVariables = references;
    // 字体变量有宋体、楷体等取值时，沿依赖图传播“跳过追加”。
    const dependents = new Map();
    const nonSans = new Set();
    for (const name of references) for (const next of graph.get(name) || []) {
      if (!dependents.has(next)) dependents.set(next, new Set());
      dependents.get(next).add(name);
    }
    for (const [style, source] of variableSources) for (const name of source.variables) {
      if (references.has(name) && !overriddenAtRoot(style, name) && SPF.hasChineseNonSans(style.getPropertyValue(name))) nonSans.add(name);
    }
    const nonSansQueue = [...nonSans];
    for (let i = 0; i < nonSansQueue.length; i++) for (const name of dependents.get(nonSansQueue[i]) || []) {
      if (!nonSans.has(name)) { nonSans.add(name); nonSansQueue.push(name); }
    }
    nonSansVariables = nonSans;
    for (const [style, source] of variableSources) {
      for (const [name, saved] of variableSnapshots.get(style) || []) if (!references.has(name)) {
        if (style.getPropertyValue(name) === saved.modified) {
          writing = true;
          try { setProperty.call(style, name, saved.value, saved.priority); }
          finally { writing = false; }
        }
        variableSnapshots.get(style).delete(name);
      }
      for (const name of source.variables) {
        if (!references.has(name)) continue;
        const value = style.getPropertyValue(name);
        const saved = variableSnapshots.get(style)?.get(name);
        if (saved?.modified === value) continue;
        const modified = SPF.chineseFamilies(value, config, false);
        if (modified === value) { variableSnapshots.get(style)?.delete(name); continue; }
        const priority = style.getPropertyPriority(name);
        if (!variableSnapshots.has(style)) variableSnapshots.set(style, new Map());
        variableSnapshots.get(style).set(name, { value, priority, modified });
        writing = true;
        try { setProperty.call(style, name, modified, priority); }
        finally { writing = false; }
      }
      source.signature = style.cssText;
      source.values = new Map(source.variables.map(name => [name, style.getPropertyValue(name)]));
    }
    for (const [style, source] of variableSources) if (source.fontKey) patchStyle(style, source.owner, true);
  }
  function releaseSheet(sheet) {
    for (const style of sheetStyles.get(sheet) || []) { snapshots.delete(style); variableSources.delete(style); variableSnapshots.delete(style); }
    for (const style of variableSources.keys()) if (style.parentRule?.parentStyleSheet === sheet) { variableSources.delete(style); variableSnapshots.delete(style); }
    sheetStyles.delete(sheet);
  }
  function readControlFamilies() {
    if (controlFamilies || !document.documentElement) return;
    const host = document.createElement("div");
    ownNodes.add(host);
    host.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;contain:strict;width:0;height:0;overflow:hidden";
    const shadow = nativeShadow.call(host, { mode: "closed" });
    const defaults = new CSSStyleSheet();
    defaults.replaceSync(":host { all: initial; }");
    shadow.adoptedStyleSheets = [defaults];
    const controls = ["input", "textarea", "button", "select"].map(tag => document.createElement(tag));
    shadow.append(...controls);
    document.documentElement.append(host);
    // 只读取四个空控件的浏览器默认字体一次，补充 USER 普通声明。
    controlFamilies = Object.fromEntries(controls.map(node => [node.localName, computedStyle.call(window, node).fontFamily]));
    host.remove();
    window.postMessage({ channel: CHANNEL, direction: "to-bridge", kind: "control-fonts", families: controlFamilies }, "*");
  }
  function patchRules(rules) {
    for (const rule of [...rules]) {
      // @font-face 的 family 是字体名称，不能按元素字体列表改写。
      if (rule.type !== CSSRule.FONT_FACE_RULE && rule.style) patchStyle(rule.style, rule);
      if (rule.type === CSSRule.IMPORT_RULE) {
        try { patchRules(rule.styleSheet.cssRules); }
        catch { return false; }
      } else if (rule.cssRules && patchRules(rule.cssRules) === false) return false;
    }
    return true;
  }
  function requestCSS(url) {
    const id = String(++sequence);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error("样式表读取超时。")); }, 10000);
      pending.set(id, { resolve, reject, timeout });
      window.postMessage({ channel: CHANNEL, direction: "to-bridge", kind: "read-css", id, url }, "*");
    });
  }

  // 读取 CSS 字符串与 URL 时保留转义边界，避免误处理注释或普通字符串。
  function unescapeCSS(value) {
    return value.replace(/\\(?:([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|([^\r\n\f]))/gi, (_, hex, char) => {
      if (!hex) return char;
      const n = parseInt(hex, 16);
      return n === 0 || n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF) ? "\uFFFD" : String.fromCodePoint(n);
    }).replace(/\\(?:\r\n|[\r\n\f])/g, "");
  }
  function stringEnd(text, start) {
    const quote = text[start];
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === "\\") { i++; continue; }
      if (text[i] === quote) return i + 1;
    }
    return text.length;
  }
  function skipSpace(text, start) {
    let i = start;
    while (i < text.length) {
      if (/\s/.test(text[i])) { i++; continue; }
      if (text.startsWith("/*", i)) { const end = text.indexOf("*/", i + 2); i = end < 0 ? text.length : end + 2; continue; }
      break;
    }
    return i;
  }
  function urlAt(text, start) {
    let i = skipSpace(text, start);
    if (text[i] === '"' || text[i] === "'") {
      const end = stringEnd(text, i);
      return { value: unescapeCSS(text.slice(i + 1, end - 1)), end };
    }
    const begin = i;
    while (i < text.length && text[i] !== ")") { if (text[i] === "\\") i++; i++; }
    return { value: unescapeCSS(text.slice(begin, i).trim()), end: i };
  }
  function absoluteURLs(text, base) {
    let result = "";
    let cursor = 0;
    for (let i = 0; i < text.length;) {
      if (text.startsWith("/*", i)) { i = skipSpace(text, i); continue; }
      if (text[i] === '"' || text[i] === "'") { i = stringEnd(text, i); continue; }
      if ((i === 0 || !/[\w-]/.test(text[i - 1])) && /^url\(/i.test(text.slice(i, i + 4))) {
        const part = urlAt(text, i + 4);
        const end = skipSpace(text, part.end);
        if (text[end] === ")") {
          let value = part.value;
          if (value && !value.startsWith("#")) { try { value = new URL(value, base).href; } catch {} }
          result += text.slice(cursor, i) + "url(" + cssString(value) + ")";
          cursor = end + 1;
          i = cursor;
          continue;
        }
      }
      i++;
    }
    return result + text.slice(cursor);
  }
  function topRules(text) {
    const result = [];
    let start = 0;
    let braces = 0;
    let parens = 0;
    for (let i = 0; i < text.length; i++) {
      if (text.startsWith("/*", i)) { const end = text.indexOf("*/", i + 2); i = end < 0 ? text.length : end + 1; continue; }
      if (text[i] === '"' || text[i] === "'") { i = stringEnd(text, i) - 1; continue; }
      if (text[i] === "\\") { i++; continue; }
      if (text[i] === "(") parens++;
      if (text[i] === ")") parens--;
      if (!parens) {
        if (text[i] === "{") braces++;
        if (text[i] === "}") braces--;
        if ((text[i] === ";" && braces === 0) || (text[i] === "}" && braces === 0)) {
          result.push(text.slice(start, i + 1)); start = i + 1;
        }
      }
    }
    if (text.slice(start).trim()) result.push(text.slice(start));
    return result;
  }
  function functionEnd(text, start) {
    let depth = 1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '"' || text[i] === "'") { i = stringEnd(text, i) - 1; continue; }
      if (text[i] === "(") depth++;
      if (text[i] === ")" && --depth === 0) return i;
    }
    throw new Error("导入条件无效。");
  }
  async function expandCSS(text, base, seen = new Set()) {
    if (seen.size >= 12 || seen.has(base)) throw new Error("样式表导入层级过多。");
    const chain = new Set([...seen, base]);
    const output = [];
    for (const raw of topRules(text)) {
      const start = skipSpace(raw, 0);
      if (/^@namespace\b/i.test(raw.slice(start))) throw new Error("保留带命名空间的原样式表。");
      if (!/^@import\b/i.test(raw.slice(start))) { output.push(absoluteURLs(raw, base)); continue; }
      let pos = skipSpace(raw, start + 7);
      let part;
      if (/^url\(/i.test(raw.slice(pos, pos + 4))) {
        part = urlAt(raw, pos + 4); pos = skipSpace(raw, part.end) + 1;
      } else { part = urlAt(raw, pos); pos = part.end; }
      const url = new URL(part.value, base).href;
      const remote = await requestCSS(url);
      if (remote.error) throw new Error(remote.error);
      let css = await expandCSS(remote.css, remote.url, chain);
      let tail = raw.slice(pos).trim().replace(/;$/, "").trim();
      let layer = null;
      let supports = null;
      if (/^layer\b/i.test(tail)) {
        if (/^layer\(/i.test(tail)) { const end = functionEnd(tail, 6); layer = tail.slice(6, end); tail = tail.slice(end + 1).trim(); }
        else { layer = ""; tail = tail.slice(5).trim(); }
      }
      if (/^supports\(/i.test(tail)) { const end = functionEnd(tail, 9); supports = tail.slice(9, end); tail = tail.slice(end + 1).trim(); }
      if (tail) css = `@media ${tail} { ${css} }`;
      if (supports) css = `@supports (${supports}) { ${css} }`;
      if (layer !== null) css = `@layer ${layer} { ${css} }`;
      output.push(css);
    }
    return output.join("\n");
  }
  function fillSheet(style, css) {
    const parser = new CSSStyleSheet();
    parser.replaceSync(css);
    for (const rule of parser.cssRules) insertRule.call(style.sheet, rule.cssText, style.sheet.cssRules.length);
  }
  async function replaceOpaque(node) {
    if (!node?.isConnected || ownNodes.has(node) || clones.has(node)) return;
    const token = generation;
    const record = { original: node.sheet, font: null, disabled: node.sheet?.disabled || false, href: node.href || "", loading: true };
    clones.set(node, record);
    try {
      const input = node.tagName === "LINK" ? await requestCSS(node.href) : { css: node.textContent, url: document.baseURI };
      if (input.error) throw new Error(input.error);
      const css = await expandCSS(input.css, input.url);
      if (!active || token !== generation || !node.isConnected || clones.get(node) !== record || (node.href || "") !== record.href) return;
      const style = document.createElement("style");
      ownNodes.add(style);
      style.dataset.spf = "stylesheet";
      style.media = node.media || "";
      node.after(style);
      record.font = style;
      fillSheet(style, css);
      patchRules(style.sheet.cssRules);
      style.sheet.disabled = record.disabled;
      node.sheet.disabled = true;
      record.loading = false;
    } catch {
      record.font?.remove();
      if (clones.get(node) === record) clones.delete(node);
    }
  }
  function restoreClone(node) {
    const record = clones.get(node);
    if (!record) return;
    if (record.font) {
      releaseSheet(record.font.sheet);
      if (node.sheet === record.original) node.sheet.disabled = record.disabled;
      record.font.remove();
    }
    clones.delete(node);
  }
  function inspectSheet(sheet) {
    if (!active || !sheet || ownNodes.has(sheet.ownerNode)) return;
    if (sheet.ownerNode) {
      const previous = resourceSheets.get(sheet.ownerNode);
      if (previous && previous !== sheet) releaseSheet(previous);
      resourceSheets.set(sheet.ownerNode, sheet);
    }
    try {
      if (patchRules(sheet.cssRules) === false) replaceOpaque(sheet.ownerNode);
    } catch { replaceOpaque(sheet.ownerNode); }
  }
  function inspect(node) {
    if (!active || !node || ownNodes.has(node)) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.hasAttribute("style")) patchStyle(node.style, node);
      if (node.tagName === "STYLE" || (node.tagName === "LINK" && node.relList.contains("stylesheet"))) inspectSheet(node.sheet);
    }
    // 查询只选取样式资源和内联声明，不读取页面文字或计算字体。
    if (node.querySelectorAll) {
      for (const item of node.querySelectorAll('[style],style,link[rel~="stylesheet"]')) {
        if (ownNodes.has(item)) continue;
        if (item.hasAttribute("style")) patchStyle(item.style, item);
        if (item.sheet) inspectSheet(item.sheet);
      }
    }
    if (node === document || node instanceof ShadowRoot) {
      for (const sheet of node.adoptedStyleSheets || []) inspectSheet(sheet);
    }
  }
  function enqueue(node) {
    if (!active) return;
    jobs.add(node);
    if (!timer) timer = setTimeout(() => {
      timer = 0;
      const batch = [...jobs]; jobs.clear();
      for (const item of batch) if (item === document || item.isConnected) inspect(item);
    }, 0);
  }
  function observeRoot(root) {
    if (roots.has(root)) return;
    const state = { observer: null, started: false };
    roots.set(root, state);
    state.observer = new MutationObserver(records => {
      for (const record of records) {
        if (ownNodes.has(record.target)) continue;
        if (record.type === "attributes") {
          if (record.attributeName === "style") patchStyle(record.target.style, record.target);
          else if (record.target.tagName === "LINK" || record.target.tagName === "STYLE") {
            restoreClone(record.target); enqueue(record.target);
          }
        } else {
          for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) enqueue(node);
          if (record.target.tagName === "STYLE") { restoreClone(record.target); enqueue(record.target); }
          for (const node of record.removedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE || node.isConnected) continue;
            for (const owner of [node, ...node.querySelectorAll('[style],style,link[rel~="stylesheet"]')]) {
              const style = inlineStyles.get(owner);
              const saved = style && snapshots.get(style);
              if (saved) {
                if (style.getPropertyValue("font-family") === saved.modified) write(style, saved.value, saved.priority);
                snapshots.delete(style);
              }
              const variables = variableSnapshots.get(owner.style);
              if (variables) for (const [name, saved] of variables) if (owner.style.getPropertyValue(name) === saved.modified) {
                writing = true;
                try { setProperty.call(owner.style, name, saved.value, saved.priority); }
                finally { writing = false; }
              }
              variableSources.delete(owner.style); variableSnapshots.delete(owner.style);
              const sheet = resourceSheets.get(owner);
              if (sheet) releaseSheet(sheet);
              restoreClone(owner);
            }
            for (const [shadow, info] of roots) if (shadow instanceof ShadowRoot && !shadow.host.isConnected) {
              info.observer.disconnect(); roots.delete(shadow);
            }
          }
        }
      }
    });
    if (active) startRoot(root, state);
  }
  function startRoot(root, state) {
    state.started = true;
    state.observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "href", "rel", "media", "disabled"] });
    inspect(root);
  }
  function stop() {
    active = false;
    generation++;
    clearTimeout(timer); timer = 0; jobs.clear();
    clearTimeout(variableTimer); variableTimer = 0;
    for (const state of roots.values()) { state.observer.disconnect(); state.started = false; }
    for (const [style, saved] of snapshots) {
      if (style.getPropertyValue("font-family") === saved.modified) write(style, saved.value, saved.priority);
    }
    snapshots.clear();
    for (const [style, variables] of variableSnapshots) for (const [name, saved] of variables) if (style.getPropertyValue(name) === saved.modified) {
      writing = true;
      try { setProperty.call(style, name, saved.value, saved.priority); }
      finally { writing = false; }
    }
    variableSources.clear(); variableSnapshots.clear();
    trackedVariables = new Set();
    nonSansVariables = new Set();
    for (const node of [...clones.keys()]) restoreClone(node);
    for (const font of registeredFonts) document.fonts.delete(font);
    registeredFonts.length = 0;
  }
  function configure(settings, font) {
    const next = normalize(settings);
    const signature = JSON.stringify([next.enabled, next.font, next.groups, next.extra, next.cjkMode, next.cjkFont, next.cjkTargets, font]);
    if (config?.signature === signature) return;
    stop();
    config = { ...next, signature };
    active = next.enabled && hasFonts(next);
    if (active) {
      // FontFace 与 @font-face 使用相同的字符范围机制，注册后也覆盖 Shadow DOM。
      for (const [family, source, range] of [[FAMILY, next.font, unicodeRange(next)]]) {
        if (!range) continue;
        const face = new FontFace(family, `local(${cssString(source)})`, { unicodeRange: range, display: "swap", weight: /^PingFang UI (?:SC|TC|HK|MO)$/i.test(source) ? "100 900" : "normal" });
        registeredFonts.push(face); document.fonts.add(face);
      }
      readControlFamilies();
      observeRoot(document);
      for (const [root, state] of roots) if (!state.started) startRoot(root, state);
    }
  }

  // CSSOM 的写入只在相关声明或样式表变化时处理；浏览器状态选择器继续原生生效。
  CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
    const result = setProperty.call(this, name, value, priority);
    if (!writing && (/^(?:font|font-family)$/i.test(name) || (active && config.cjkMode !== "off" && name.startsWith("--")))) patchStyle(this);
    return result;
  };
  CSSStyleDeclaration.prototype.removeProperty = function (name) {
    const result = removeProperty.call(this, name);
    if (!writing && /^(?:font|font-family)$/i.test(name)) snapshots.delete(this);
    if (!writing && active && config.cjkMode !== "off" && (/^(?:font|font-family)$/i.test(name) || name.startsWith("--"))) trackVariables(this, null);
    return result;
  };
  for (const name of ["font", "fontFamily", "cssText"]) {
    const descriptor = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, name);
    if (!descriptor?.set || !descriptor.configurable) continue;
    Object.defineProperty(CSSStyleDeclaration.prototype, name, { ...descriptor, set(value) {
      descriptor.set.call(this, value); if (!writing) patchStyle(this);
    } });
  }
  for (const name of ["insertRule", "deleteRule", "replaceSync", "replace"]) {
    const native = CSSStyleSheet.prototype[name];
    if (!native) continue;
    CSSStyleSheet.prototype[name] = function (...args) {
      const previous = name === "deleteRule" ? this.cssRules[args[0]] : null;
      const savedStyles = name.startsWith("replace") ? new Set(sheetStyles.get(this) || []) : null;
      const result = native.apply(this, args);
      const changed = () => {
        if (savedStyles) for (const style of savedStyles) {
          snapshots.delete(style); variableSources.delete(style); variableSnapshots.delete(style); sheetStyles.get(this)?.delete(style);
        }
        if (previous) {
          const drop = rule => {
            if (rule.style) { snapshots.delete(rule.style); variableSources.delete(rule.style); variableSnapshots.delete(rule.style); sheetStyles.get(this)?.delete(rule.style); }
            for (const child of rule.cssRules || []) drop(child);
          };
          drop(previous);
        }
        inspectSheet(this);
      };
      if (name === "replace") result.then(changed, () => {});
      else changed();
      return result;
    };
  }
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (...args) {
    const shadow = attachShadow.apply(this, args);
    observeRoot(shadow);
    return shadow;
  };
  for (const prototype of [Document.prototype, ShadowRoot.prototype]) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "adoptedStyleSheets");
    if (descriptor?.set && descriptor.configurable) Object.defineProperty(prototype, "adoptedStyleSheets", { ...descriptor, set(value) {
      descriptor.set.call(this, value); if (active) { observeRoot(this); enqueue(this); }
    } });
  }
  document.addEventListener("load", event => { if (event.target?.tagName === "LINK") enqueue(event.target); }, true);
  document.addEventListener("DOMContentLoaded", () => {
    if (active) readControlFamilies();
    enqueue(document);
  }, { once: true });
  window.addEventListener("message", event => {
    const message = event.data;
    if (event.source !== window || message?.channel !== CHANNEL || message.direction !== "to-engine") return;
    if (message.kind === "config") configure(message.settings, message.defaultFont);
    else if (message.kind === "css") {
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id); clearTimeout(task.timeout);
      task.resolve(message.result || { error: "样式表读取失败。" });
    }
  });
  window.postMessage({ channel: CHANNEL, direction: "to-bridge", kind: "ready" }, "*");
})();
