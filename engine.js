(() => {
  "use strict";
  const { CHANNEL, FAMILY, prepend, hasFonts, cssString, unicodeRange, normalize } = SPF;
  const setProperty = CSSStyleDeclaration.prototype.setProperty;
  const removeProperty = CSSStyleDeclaration.prototype.removeProperty;
  const insertRule = CSSStyleSheet.prototype.insertRule;
  const disabledDescriptor = Object.getOwnPropertyDescriptor(StyleSheet.prototype, "disabled");
  const mediaDescriptor = Object.getOwnPropertyDescriptor(MediaList.prototype, "mediaText");
  const opaqueSheets = new WeakMap();
  const opaqueMedia = new WeakMap();
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
  const detachedRoots = new Set();
  const rootReferences = new WeakMap();
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
      // Chromium 的 font/fontFamily 是对象上的动态属性，在声明对象上安装拦截。
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
    if (owned) saved.priority = style.getPropertyPriority("font-family");
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
    for (const [name, saved] of variableSnapshots.get(style) || []) {
      if (style.getPropertyValue(name) === saved.modified) saved.priority = style.getPropertyPriority(name);
    }
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
  function releaseStyle(style) {
    const saved = snapshots.get(style);
    if (saved && style.getPropertyValue("font-family") === saved.modified) write(style, saved.value, saved.priority);
    snapshots.delete(style);
    for (const [name, entry] of variableSnapshots.get(style) || []) if (style.getPropertyValue(name) === entry.modified) {
      writing = true;
      try { setProperty.call(style, name, entry.value, entry.priority); }
      finally { writing = false; }
    }
    const hadVariables = variableSources.delete(style);
    variableSnapshots.delete(style);
    if (hadVariables && active && !variableTimer) variableTimer = setTimeout(updateVariables, 0);
  }
  function releaseSheet(sheet, seen = new Set()) {
    if (!sheet || seen.has(sheet)) return;
    seen.add(sheet);
    try { for (const rule of sheet.cssRules) if (rule.type === CSSRule.IMPORT_RULE) releaseSheet(rule.styleSheet, seen); }
    catch {}
    for (const style of sheetStyles.get(sheet) || []) releaseStyle(style);
    for (const style of variableSources.keys()) if (style.parentRule?.parentStyleSheet === sheet) releaseStyle(style);
    sheetStyles.delete(sheet);
  }
  function releaseTree(node) {
    const owners = node instanceof Element ? [node] : [];
    owners.push(...node.querySelectorAll('[style],style,link[rel~="stylesheet"]'));
    for (const owner of owners) {
      if (ownNodes.has(owner)) continue;
      if (owner.style) releaseStyle(owner.style);
      const sheet = resourceSheets.get(owner);
      if (sheet) releaseSheet(sheet);
      restoreClone(owner);
    }
  }
  function detachDisconnectedRoots() {
    for (const [shadow, info] of roots) if (shadow instanceof ShadowRoot && !shadow.host.isConnected) {
      info.observer.disconnect(); roots.delete(shadow);
      releaseTree(shadow);
      for (const sheet of shadow.adoptedStyleSheets) {
        const shared = document.adoptedStyleSheets.includes(sheet) || [...roots.keys()].some(other => other instanceof ShadowRoot && other.host.isConnected && other.adoptedStyleSheets.includes(sheet));
        if (!shared) releaseSheet(sheet);
      }
      // 脱离文档的影子根只保留弱引用，挂回时恢复闭合和开放影子根的观察。
      if (!rootReferences.has(shadow)) rootReferences.set(shadow, new WeakRef(shadow));
      detachedRoots.add(rootReferences.get(shadow));
    }
  }
  function resumeConnectedRoots() {
    for (const reference of detachedRoots) {
      const shadow = reference.deref();
      if (!shadow || shadow.ownerDocument !== document) { detachedRoots.delete(reference); continue; }
      if (shadow.host.isConnected) { detachedRoots.delete(reference); observeRoot(shadow); }
    }
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
      // @font-face 的 family 定义字体名称，保留原声明；只改写元素使用的字体列表。
      if (rule.type !== CSSRule.FONT_FACE_RULE && rule.style) patchStyle(rule.style, rule);
      if (rule.type === CSSRule.IMPORT_RULE) {
        if (!rule.styleSheet) continue;
        try { patchRules(rule.styleSheet.cssRules); }
        catch { return false; }
      } else if (rule.cssRules && patchRules(rule.cssRules) === false) return false;
    }
    return true;
  }
  function requestCSS(url, encoding = document.characterSet) {
    const id = String(++sequence);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error("样式表读取超时。")); }, 10000);
      pending.set(id, { resolve, reject, timeout });
      window.postMessage({ channel: CHANNEL, direction: "to-bridge", kind: "read-css", id, url, encoding }, "*");
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
  function identifierAt(text, start) {
    let end = start;
    while (end < text.length) {
      if (text[end] === "\\") {
        const escape = text.slice(end).match(/^\\(?:[\da-f]{1,6}(?:\r\n|[\t\n\f\r ])?|[^\r\n\f])/i);
        if (!escape) break;
        end += escape[0].length;
      } else if (/[\w-]/.test(text[end]) || text.charCodeAt(end) >= 128) end++;
      else break;
    }
    return { name: unescapeCSS(text.slice(start, end)).toLowerCase(), end };
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
      const identifier = identifierAt(text, i);
      if (identifier.name === "url" && text[identifier.end] === "(") {
        const part = urlAt(text, identifier.end + 1);
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
      i = identifier.end > i ? identifier.end : i + 1;
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
      if (text.startsWith("/*", i)) { i = skipSpace(text, i) - 1; continue; }
      if (text[i] === "\\") { i++; continue; }
      if (text[i] === '"' || text[i] === "'") { i = stringEnd(text, i) - 1; continue; }
      if (text[i] === "(") depth++;
      if (text[i] === ")" && --depth === 0) return i;
    }
    throw new Error("导入条件无效。");
  }
  async function expandCSS(text, base, seen = new Set(), encoding = document.characterSet) {
    if (seen.size >= 12 || seen.has(base)) throw new Error("样式表导入层级过多。");
    const chain = new Set([...seen, base]);
    const output = [];
    for (const raw of topRules(text)) {
      const start = skipSpace(raw, 0);
      const atRule = raw[start] === "@" ? identifierAt(raw, start + 1) : null;
      if (atRule?.name === "namespace") throw new Error("保留带命名空间的原样式表。");
      if (atRule?.name !== "import") { output.push(absoluteURLs(raw, base)); continue; }
      let pos = skipSpace(raw, atRule.end);
      let part;
      const urlFunction = identifierAt(raw, pos);
      if (urlFunction.name === "url" && raw[urlFunction.end] === "(") {
        part = urlAt(raw, urlFunction.end + 1); pos = skipSpace(raw, part.end) + 1;
      } else { part = urlAt(raw, pos); pos = part.end; }
      const url = new URL(part.value, base).href;
      const remote = await requestCSS(url, encoding);
      if (remote.error) throw new Error(remote.error);
      let css = await expandCSS(remote.css, remote.url, chain, remote.encoding || encoding);
      let tail = raw.slice(pos).trim().replace(/;$/, "").trim();
      tail = tail.slice(skipSpace(tail, 0));
      let layer = null;
      let supports = null;
      const layerToken = identifierAt(tail, 0);
      if (layerToken.name === "layer") {
        if (tail[layerToken.end] === "(") { const end = functionEnd(tail, layerToken.end + 1); layer = tail.slice(layerToken.end + 1, end); tail = tail.slice(end + 1).trim(); }
        else { layer = ""; tail = tail.slice(layerToken.end).trim(); }
        tail = tail.slice(skipSpace(tail, 0));
      }
      const supportsToken = identifierAt(tail, 0);
      if (supportsToken.name === "supports" && tail[supportsToken.end] === "(") { const end = functionEnd(tail, supportsToken.end + 1); supports = tail.slice(supportsToken.end + 1, end); tail = tail.slice(end + 1).trim(); }
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
      const css = await expandCSS(input.css, input.url, new Set(), input.encoding || document.characterSet);
      if (!active || token !== generation || !node.isConnected || clones.get(node) !== record || (node.href || "") !== record.href) return;
      const style = document.createElement("style");
      ownNodes.add(style);
      style.dataset.spf = "stylesheet";
      record.disabled = disabledDescriptor.get.call(record.original);
      style.media = record.original.media.mediaText;
      node.after(style);
      record.font = style;
      fillSheet(style, css);
      patchRules(style.sheet.cssRules);
      style.sheet.disabled = record.disabled;
      disabledDescriptor.set.call(node.sheet, true);
      opaqueSheets.set(record.original, record);
      opaqueMedia.set(record.original.media, record);
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
      opaqueSheets.delete(record.original);
      opaqueMedia.delete(record.original.media);
      disabledDescriptor.set.call(record.original, record.disabled);
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
    resumeConnectedRoots();
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
    if (!timer) {
      const current = generation;
      const flush = () => {
        if (current !== generation || !active) return;
        timer = 0;
        const batch = [...jobs]; jobs.clear();
        for (const item of batch) if (item === document || item.isConnected) inspect(item);
        if (!controlFamilies) readControlFamilies();
      };
      // 首屏解析期间在绘制前合并处理；已加载页面继续使用普通任务批处理。
      if (document.readyState === "loading") { timer = -1; queueMicrotask(flush); }
      else timer = setTimeout(flush, 0);
    }
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
            releaseTree(node);
            detachDisconnectedRoots();
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
  function configure(settings) {
    const next = normalize(settings);
    const signature = JSON.stringify([next.enabled, next.font, next.groups, next.extra, next.cjkMode, next.cjkFont, next.cjkTargets]);
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
        face.load().catch(() => {});
      }
      observeRoot(document);
      detachDisconnectedRoots();
      resumeConnectedRoots();
      for (const [root, state] of roots) if (!state.started) startRoot(root, state);
      readControlFamilies();
    }
  }

  // CSSOM 的写入只在相关声明或样式表变化时处理；浏览器状态选择器继续原生生效。
  CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
    const result = setProperty.apply(this, arguments);
    if (!writing && (typeof name !== "string" || /^(?:font|font-family)$/i.test(name) || (active && config.cjkMode !== "off" && name.startsWith("--")))) patchStyle(this);
    return result;
  };
  CSSStyleDeclaration.prototype.removeProperty = function (name) {
    const result = removeProperty.apply(this, arguments);
    if (!writing && (typeof name === "string" ? /^(?:font|font-family)$/i.test(name) : snapshots.get(this)?.modified !== this.getPropertyValue("font-family"))) snapshots.delete(this);
    if (!writing && active && config.cjkMode !== "off" && (typeof name !== "string" || /^(?:font|font-family)$/i.test(name) || name.startsWith("--"))) trackVariables(this, null);
    return result;
  };
  for (const name of ["font", "fontFamily", "cssText"]) {
    const descriptor = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, name);
    if (!descriptor?.set || !descriptor.configurable) continue;
    Object.defineProperty(CSSStyleDeclaration.prototype, name, { ...descriptor, set(value) {
      descriptor.set.call(this, value); if (!writing) patchStyle(this);
    } });
  }
  // 原表实际停用后，将网站的 CSSOM 开关和媒体条件同步到同位置副本。
  Object.defineProperty(StyleSheet.prototype, "disabled", { ...disabledDescriptor,
    get() { return opaqueSheets.get(this)?.disabled ?? disabledDescriptor.get.call(this); },
    set(value) {
      const record = opaqueSheets.get(this);
      if (!record?.font?.sheet) { disabledDescriptor.set.call(this, value); return; }
      record.disabled = Boolean(value);
      disabledDescriptor.set.call(record.font.sheet, value);
    }
  });
  function syncOpaqueMedia(list) {
    const record = opaqueMedia.get(list);
    if (record?.font) record.font.media = mediaDescriptor.get.call(list);
  }
  Object.defineProperty(MediaList.prototype, "mediaText", { ...mediaDescriptor, set(value) {
    mediaDescriptor.set.call(this, value); syncOpaqueMedia(this);
  } });
  for (const name of ["appendMedium", "deleteMedium"]) {
    const native = MediaList.prototype[name];
    MediaList.prototype[name] = function (...args) { const result = native.apply(this, args); syncOpaqueMedia(this); return result; };
  }
  for (const [prototype, names] of [[CSSStyleSheet.prototype, ["insertRule", "deleteRule", "replaceSync", "replace"]], [CSSGroupingRule.prototype, ["insertRule", "deleteRule"]], [CSSKeyframesRule.prototype, ["appendRule", "deleteRule"]]]) for (const name of names) {
    const native = prototype[name];
    if (!native) continue;
    prototype[name] = function (...args) {
      if (!(this instanceof CSSStyleSheet || this instanceof CSSGroupingRule || this instanceof CSSKeyframesRule)) return native.apply(this, args);
      const sheet = this instanceof CSSStyleSheet ? this : this.parentStyleSheet;
      let previous = null;
      if (name === "deleteRule") {
        try { previous = [...this.cssRules]; } catch { return native.apply(this, args); }
      }
      const savedStyles = name.startsWith("replace") ? new Set([...(sheetStyles.get(sheet) || []), ...[...variableSources.keys()].filter(style => style.parentRule?.parentStyleSheet === sheet)]) : null;
      const result = native.apply(this, args);
      const changed = () => {
        if (savedStyles) for (const style of savedStyles) {
          releaseStyle(style); sheetStyles.get(sheet)?.delete(style);
        }
        if (previous) {
          const drop = rule => {
            if (rule.style) { releaseStyle(rule.style); sheetStyles.get(sheet)?.delete(rule.style); }
            if (rule.type === CSSRule.IMPORT_RULE) releaseSheet(rule.styleSheet);
            for (const child of rule.cssRules || []) drop(child);
          };
          const remaining = new Set(this.cssRules);
          for (const rule of previous) if (!remaining.has(rule)) drop(rule);
        }
        inspectSheet(sheet);
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
  function stylesheetLoaded(event) { if (["LINK", "STYLE"].includes(event.target?.tagName)) enqueue(event.target); }
  function documentReady() {
    if (active) readControlFamilies();
    enqueue(document);
  }
  function receiveMessage(event) {
    const message = event.data;
    if (event.source !== window || message?.channel !== CHANNEL || message.direction !== "to-engine") return;
    if (message.kind === "config") configure(message.settings);
    else if (message.kind === "css") {
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id); clearTimeout(task.timeout);
      task.resolve(message.result || { error: "样式表读取失败。" });
    }
  }
  function receiveConfig(event) {
    if (typeof event.detail !== "string") return;
    try { configure(JSON.parse(event.detail)); } catch {}
  }
  function installEvents() {
    document.addEventListener("load", stylesheetLoaded, true);
    document.addEventListener("DOMContentLoaded", documentReady, { once: true });
    window.addEventListener("message", receiveMessage);
    window.addEventListener(CHANNEL + "/config", receiveConfig);
  }
  let eventRoot = document.documentElement;
  new MutationObserver(() => {
    installEvents();
    if (eventRoot !== document.documentElement) {
      eventRoot = document.documentElement;
      // document.open 会清除窗口事件与文档字体，重建后重新注册当前配置。
      if (config) { const current = config; stop(); config = null; configure(current); }
    }
  }).observe(document, { childList: true });
  installEvents();
  window.postMessage({ channel: CHANNEL, direction: "to-bridge", kind: "ready" }, "*");
})();
