(() => {
  "use strict";
  const { CHANNEL, effective } = SPF;
  let alive = true;
  let rootCSS = "";
  let work = Promise.resolve();
  let controlFamilies = null;
  const send = value => window.postMessage({ channel: CHANNEL, direction: "to-engine", ...value }, "*");
  async function loadConfig() {
    try {
      const stored = await chrome.storage.local.get("settings");
      const font = await chrome.runtime.sendMessage({ kind: "default-font", lang: document.documentElement?.lang || navigator.language });
      let url = location.href;
      if (!/^(?:https?|file):/.test(url)) {
        try { url = document.referrer || window.parent.location.href || url; } catch { url = document.referrer || url; }
      }
      const settings = effective(stored.settings, url);
      const css = settings.enabled && SPF.hasFonts(settings) ? `:root { font-family: ${SPF.prepend(SPF.cssString(font?.font || "Times New Roman"), settings)}; }` + Object.entries(controlFamilies || {}).map(([tag, family]) => `${tag} { font-family: ${SPF.prepend(family, settings)}; }`).join("\n") : "";
      const result = await chrome.runtime.sendMessage({ kind: "root-style", css, previous: rootCSS });
      if (result?.error) throw new Error(result.error);
      rootCSS = css;
      if (alive) send({ kind: "config", settings, defaultFont: font?.font });
    } catch { alive = false; }
  }
  function publish() { work = work.then(loadConfig, loadConfig); return work; }
  window.addEventListener("message", async event => {
    const message = event.data;
    if (event.source !== window || message?.channel !== CHANNEL || message.direction !== "to-bridge" || !alive) return;
    if (message.kind === "ready") { await publish(); return; }
    if (message.kind === "control-fonts") {
      const families = message.families;
      if (families && ["input", "textarea", "button", "select"].every(tag => typeof families[tag] === "string" && !/[;{}]/.test(families[tag]))) {
        controlFamilies = families; await publish();
      }
      return;
    }
    if (message.kind === "read-css" && typeof message.url === "string" && typeof message.id === "string") {
      try { send({ kind: "css", id: message.id, result: await chrome.runtime.sendMessage({ kind: "read-css", url: message.url }) }); }
      catch { send({ kind: "css", id: message.id, result: { error: "样式表读取失败。" } }); }
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) publish();
  });
  publish();
})();
