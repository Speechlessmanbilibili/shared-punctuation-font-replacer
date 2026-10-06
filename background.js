"use strict";
const requests = new Map();
const fontCache = new Map();
function cssDecoder(label) {
  if (typeof label !== "string" || label.length > 64) return null;
  try { return new TextDecoder(label); } catch { return null; }
}
function stylesheetCharset(contentType) {
  let i = contentType.indexOf(";");
  if (i < 0) return null;
  while (i < contentType.length) {
    const start = ++i;
    while (i < contentType.length && contentType[i] !== "=" && contentType[i] !== ";") i++;
    const name = contentType.slice(start, i).trim().toLowerCase();
    if (contentType[i] !== "=") continue;
    i++;
    while (/[\t ]/.test(contentType[i] || "")) i++;
    let value = "";
    if (contentType[i] === '"') {
      for (i++; i < contentType.length && contentType[i] !== '"'; i++) {
        if (contentType[i] === "\\" && i + 1 < contentType.length) i++;
        value += contentType[i];
      }
      if (contentType[i] === '"') i++;
    } else {
      const valueStart = i;
      while (i < contentType.length && contentType[i] !== ";") i++;
      value = contentType.slice(valueStart, i).trim();
    }
    if (name === "charset") return value;
    while (i < contentType.length && contentType[i] !== ";") i++;
  }
  return null;
}
function decodeStylesheet(bytes, contentType, environmentEncoding) {
  // 按 BOM、HTTP、精确的 @charset 声明和引用环境选择 CSS 编码。
  let decoder;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) decoder = new TextDecoder();
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) decoder = new TextDecoder("utf-16le");
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) decoder = new TextDecoder("utf-16be");
  else {
    decoder = cssDecoder(stylesheetCharset(contentType));
    if (!decoder) {
      const prefix = String.fromCharCode(...bytes.subarray(0, 1024));
      decoder = cssDecoder(/^@charset "([\x00-\x21\x23-\x7f]*)";/.exec(prefix)?.[1]);
      if (decoder?.encoding === "utf-16le" || decoder?.encoding === "utf-16be") decoder = new TextDecoder();
    }
    decoder ||= cssDecoder(environmentEncoding) || new TextDecoder();
  }
  return { css: decoder.decode(bytes), encoding: decoder.encoding };
}
chrome.fontSettings.onFontChanged.addListener(() => fontCache.clear());
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!sender.tab) return;
  if (message?.kind === "root-style") {
    const target = sender.documentId ? { tabId: sender.tab.id, documentIds: [sender.documentId] } : { tabId: sender.tab.id, frameIds: [sender.frameId] };
    (async () => {
      if (message.previous && message.previous !== message.css) await chrome.scripting.removeCSS({ target, css: message.previous, origin: "USER" });
      if (message.css && message.previous !== message.css) await chrome.scripting.insertCSS({ target, css: message.css, origin: "USER" });
      return { ok: true };
    })().then(respond, error => respond({ error: error.message }));
    return true;
  }
  if (message?.kind === "default-font") {
    const scripts = { zh: "Hans", "zh-hant": "Hant", ja: "Jpan", ko: "Kore", ar: "Arab", ru: "Cyrl" };
    const lang = String(message.lang || "").toLowerCase();
    const script = /zh-(?:tw|hk|hant)/.test(lang) ? "Hant" : scripts[lang.split("-")[0]] || "Zyyy";
    if (!fontCache.has(script)) fontCache.set(script, new Promise(resolve => {
      chrome.fontSettings.getFont({ genericFamily: "standard", script }, first => {
        if (first?.fontId) resolve(first.fontId);
        else chrome.fontSettings.getFont({ genericFamily: "standard" }, second => resolve(second?.fontId || "Times New Roman"));
      });
    }));
    fontCache.get(script).then(font => respond({ font }));
    return true;
  }
  if (message?.kind !== "read-css") return;
  let url;
  try { url = new URL(message.url); } catch { respond({ error: "样式表地址无效。" }); return; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) { respond({ error: "样式表地址无效。" }); return; }
  const encoding = (cssDecoder(message.encoding) || new TextDecoder()).encoding;
  const key = url.href + "\n" + encoding;
  if (!requests.has(key)) {
    if (requests.size >= 64) { respond({ error: "样式表请求过多。" }); return; }
    const work = (async () => {
      const response = await fetch(url.href, { credentials: "omit", signal: AbortSignal.timeout(8000) });
      if (!response.ok || !/^text\/css[\t ]*(?:;|$)/i.test(response.headers.get("content-type") || "")) throw new Error("样式表响应无效。");
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error("样式表过大。"); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return { ...decodeStylesheet(bytes, response.headers.get("content-type") || "", encoding), url: response.url };
    })();
    requests.set(key, work);
    work.finally(() => { setTimeout(() => requests.delete(key), 10000); }).catch(() => {});
  }
  requests.get(key).then(respond, error => respond({ error: error.message }));
  return true;
});
