(() => {
  "use strict";
  const { CHANNEL, effective } = SPF;
  let rootCSS = "";
  let rootWork = Promise.resolve(), loading = null, settings = null, revision = 0, rootRevision = 0;
  let controlFamilies = null;
  let fontWork = null;
  const send = value => window.postMessage({ channel: CHANNEL, direction: "to-engine", ...value }, "*");
  function address() {
    const url = location.href;
    if (/^(?:https?|file):/.test(url)) return url;
    // 特殊来源沿用创建页的来源与端口，不依赖可被页面关闭的 referrer。
    for (const candidate of [location.origin, window.origin, ...Array.from(location.ancestorOrigins || [])]) {
      if (typeof candidate === "string" && /^(?:https?|file):/.test(candidate)) return candidate;
    }
    try { if (/^(?:https?|file):/.test(window.parent.location.href)) return window.parent.location.href; } catch {}
    if (/^(?:https?|file):/.test(document.referrer)) return document.referrer;
    return url;
  }
  // 配置同步送到主世界；浏览器默认字体和 USER 根样式单独补充。
  function publish() {
    if (!settings) return;
    window.dispatchEvent(new CustomEvent(CHANNEL + "/config", { detail: JSON.stringify(settings) }));
  }
  function refreshRoot() {
    const current = ++rootRevision, next = settings;
    if (!next) return;
    const enabled = next.enabled && SPF.hasFonts(next);
    if (enabled && !fontWork) fontWork = chrome.runtime.sendMessage({ kind: "default-font", lang: document.documentElement?.lang || navigator.language })
      .catch(() => { fontWork = null; return null; });
    (enabled ? fontWork : Promise.resolve(null)).then(font => {
      if (current !== rootRevision) return;
      const css = enabled ? `:root { font-family: ${SPF.prepend(SPF.cssString(font?.font || "Times New Roman"), next)}; }` + Object.entries(controlFamilies || {}).map(([tag, family]) => `${tag} { font-family: ${SPF.prepend(family, next)}; }`).join("\n") : "";
      rootWork = rootWork.catch(() => {}).then(async () => {
        if (current !== rootRevision || css === rootCSS) return;
        const result = await chrome.runtime.sendMessage({ kind: "root-style", css, previous: rootCSS });
        if (result?.error) throw new Error(result.error);
        rootCSS = css;
      }).catch(() => {});
    });
  }
  function setConfig(value) {
    settings = effective(value, address()); revision++;
    publish(); refreshRoot();
  }
  function loadConfig() {
    if (loading) return loading;
    const current = revision;
    loading = chrome.storage.local.get("settings").then(stored => {
      if (current === revision) setConfig(stored.settings);
    }).catch(() => {}).finally(() => { loading = null; });
    return loading;
  }
  async function receiveMessage(event) {
    const message = event.data;
    if (event.source !== window || message?.channel !== CHANNEL || message.direction !== "to-bridge") return;
    if (message.kind === "ready") { if (settings) publish(); else await loadConfig(); return; }
    if (message.kind === "control-fonts") {
      const families = message.families;
      if (families && ["input", "textarea", "button", "select"].every(tag => typeof families[tag] === "string" && !/[;{}]/.test(families[tag]))) {
        if (JSON.stringify(families) !== JSON.stringify(controlFamilies)) { controlFamilies = families; refreshRoot(); }
      }
      return;
    }
    if (message.kind === "read-css" && typeof message.url === "string" && typeof message.id === "string") {
      try { send({ kind: "css", id: message.id, result: await chrome.runtime.sendMessage({ kind: "read-css", url: message.url, encoding: message.encoding }) }); }
      catch { send({ kind: "css", id: message.id, result: { error: "样式表读取失败。" } }); }
    }
  }
  window.addEventListener("message", receiveMessage);
  new MutationObserver(() => {
    window.addEventListener("message", receiveMessage);
    publish(); refreshRoot();
  }).observe(document, { childList: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) setConfig(changes.settings.newValue);
  });
  loadConfig();
})();
