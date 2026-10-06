"use strict";
const requests = new Map();
const fontCache = new Map();
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
  if (!requests.has(url.href)) {
    if (requests.size >= 64) { respond({ error: "样式表请求过多。" }); return; }
    const work = (async () => {
      const response = await fetch(url.href, { credentials: "omit", signal: AbortSignal.timeout(8000) });
      if (!response.ok || !/^text\/css(?:;|$)/i.test(response.headers.get("content-type") || "")) throw new Error("样式表响应无效。");
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
      return { css: new TextDecoder().decode(bytes), url: response.url };
    })();
    requests.set(url.href, work);
    work.finally(() => { setTimeout(() => requests.delete(url.href), 10000); }).catch(() => {});
  }
  requests.get(url.href).then(respond, error => respond({ error: error.message }));
  return true;
});
