(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  let saved = "";
  let loaded = false;
  let saving = false;
  const form = $("settings");
  const saveButton = form.querySelector('button[type="submit"]');
  form.inert = true; saveButton.disabled = true; form.setAttribute("aria-busy", "true");
  let comparing = false;
  const previewFonts = [];
  let previewSerial = 0;
  let installedFonts = null;
  function fontCatalog() {
    if (!installedFonts) installedFonts = new Promise(resolve => {
      if (!chrome.fontSettings?.getFontList) { resolve([]); return; }
      try {
        chrome.fontSettings.getFontList(fonts => {
          if (chrome.runtime?.lastError) { resolve([]); return; }
          resolve((fonts || []).flatMap(font => [font.fontId, font.displayName]).filter(name => typeof name === "string" && name));
        });
      } catch { resolve([]); }
    });
    return installedFonts;
  }
  const previewStyles = [...$("preview").children].map(x => ({ node: x, family: getComputedStyle(x).fontFamily }));
  for (const group of SPF.GROUPS) {
    const label = document.createElement("label");
    label.className = "group";
    const input = document.createElement("input");
    input.type = "checkbox"; input.value = group.id; input.dataset.group = group.id;
    const title = document.createElement("span"); title.textContent = group.label;
    const glyphs = document.createElement("span"); glyphs.className = "glyphs"; glyphs.textContent = group.chars;
    label.append(input, title, glyphs); $("groups").append(label);
  }
  function read() {
    return SPF.normalize({
      enabled: $("enabled").checked, font: $("font").value,
      groups: [...document.querySelectorAll("[data-group]:checked")].map(x => x.value), extra: $("extra").value,
      cjkMode: document.querySelector('input[name="cjk-mode"]:checked').value, cjkFont: $("cjk-font").value, cjkTargets: $("cjk-targets").value.split(/\r?\n/),
      replaceSong: $("replace-song").checked, songFont: $("song-font").value,
      replaceKai: $("replace-kai").checked, kaiFont: $("kai-font").value,
      replaceSerif: $("replace-serif").checked, serifChinese: $("serif-chinese").value, serifWestern: $("serif-western").value,
      serifShared: document.querySelector('input[name="serif-shared"]:checked').value,
      siteRules: [...$("rules").children].map(x => ({ domain: x.querySelector(".domain").value, action: x.querySelector("[data-action]:checked").value, font: x.querySelector(".site-font").value, cjkMode: x.querySelector("[data-cjk]:checked").value }))
    });
  }
  function status(text, error = false) { $("status").textContent = text; $("status").classList.toggle("error", error); }
  async function preview() {
    const serial = ++previewSerial;
    const settings = read();
    $("selected-characters").textContent = SPF.characters(settings).join("") || "未选择字符";
    $("range").textContent = SPF.unicodeRange(settings) || "空范围";
    for (const font of previewFonts) document.fonts.delete(font);
    previewFonts.length = 0;
    const range = SPF.unicodeRange(settings);
    $("cjk-font").disabled = settings.cjkMode === "off";
    $("song-font").disabled = !settings.replaceSong;
    $("kai-font").disabled = !settings.replaceKai;
    for (const input of [$("serif-chinese"), $("serif-western"), ...document.querySelectorAll('input[name="serif-shared"]')]) input.disabled = !settings.replaceSerif;
    $("font-status").textContent = range ? "" : "未选择标点字符。";
    $("font-status").classList.remove("error");
    for (const id of ["cjk-font-status", "song-font-status", "kai-font-status", "serif-chinese-status", "serif-western-status"]) { $(id).textContent = ""; $(id).classList.remove("error"); }
    for (const item of previewStyles) item.node.style.fontFamily = comparing ? item.family : SPF.prepend(item.family, settings);
    const loads = [];
    const serifLoads = { chinese: [], western: [] };
    for (const { family, source, side, range: faceRange, weight } of SPF.fontFaces(settings)) {
      const font = new FontFace(family, SPF.localFontSources(source), { unicodeRange: faceRange, weight });
      previewFonts.push(font); document.fonts.add(font);
      (side ? serifLoads[side] : loads).push(font.load());
    }
    async function check(statusId, load, list, body = false, glyphs = "标点") {
      try {
        await load();
        if (serial === previewSerial) { $(statusId).textContent = "已找到本机字体。"; $(statusId).classList.remove("error"); }
      } catch {
        const catalog = await fontCatalog();
        if (serial !== previewSerial) return;
        const names = SPF.fontNames(list).map(name => name.toLowerCase());
        const exact = catalog.some(name => names.includes(name.toLowerCase()));
        if (body && exact) { $(statusId).textContent = "已找到本机字体。"; $(statusId).classList.remove("error"); return; }
        const suggestions = [...new Set(catalog.filter(name => names.some(wanted => name.toLowerCase().startsWith(wanted))))].slice(0, 4);
        $(statusId).textContent = exact ? "已找到本机字体，但" + glyphs + "字形加载失败。" : suggestions.length
          ? "未找到填写的字体名称。本机已安装的相近字体：" + suggestions.join("、") + "。"
          : "未找到列表中的本机字体，请检查名称或先安装字体。";
        $(statusId).classList.add("error");
      }
    }
    const checks = range ? [check("font-status", () => Promise.any(loads), settings.font)] : [];
    if (settings.replaceSerif) for (const [side, list, glyphs] of [["chinese", settings.serifChinese, "中文"], ["western", settings.serifWestern, "西文"]]) {
      checks.push(check("serif-" + side + "-status", () => Promise.any(serifLoads[side]), list, false, glyphs));
    }
    for (const [enabled, list, id] of [[settings.cjkMode !== "off", settings.cjkFont, "cjk-font-status"], [settings.replaceSong, settings.songFont, "song-font-status"], [settings.replaceKai, settings.kaiFont, "kai-font-status"]]) {
      if (enabled) checks.push(check(id, () => {
        const sources = SPF.chineseFontFamilies(list).map(SPF.localFontSources).join(", ");
        return new FontFace("Shared Font Availability Check", sources).load();
      }, list, true));
    }
    await Promise.all(checks);
  }
  let ruleSerial = 0;
  function addRule(rule = {}) {
    const card = document.createElement("div"); card.className = "rule";
    const top = document.createElement("div"); top.className = "rule-top";
    const domain = document.createElement("input"); domain.className = "domain"; domain.placeholder = "example.com"; domain.value = rule.domain || ""; domain.setAttribute("aria-label", "站点域名");
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove quiet"; remove.textContent = "删除"; remove.setAttribute("aria-label", "删除此站点规则");
    remove.addEventListener("click", () => { card.remove(); changed(); $("add-rule").focus(); });
    top.append(domain, remove);
    const actions = document.createElement("div"); actions.className = "rule-actions";
    const name = "rule-" + ++ruleSerial;
    for (const [value, text] of [["inherit", "跟随全局"], ["on", "开启"], ["off", "关闭"]]) {
      const label = document.createElement("label");
      const radio = document.createElement("input"); radio.type = "radio"; radio.name = name; radio.value = value; radio.dataset.action = value; radio.checked = (rule.action || "inherit") === value;
      label.append(radio, document.createTextNode(text)); actions.append(label);
    }
    const font = document.createElement("input"); font.className = "site-font"; font.placeholder = "本站标点字体列表，逗号分隔；留空沿用全局"; font.value = rule.font || ""; font.maxLength = 4000; font.setAttribute("aria-label", "本站标点字体列表");
    const cjkActions = document.createElement("div"); cjkActions.className = "rule-actions"; cjkActions.setAttribute("aria-label", "本站中文字体模式");
    for (const [value, text] of [["inherit", "中文跟随全局"], ["off", "网站中文字体"], ["replace", "替换/补充正文"]]) {
      const label = document.createElement("label"); const radio = document.createElement("input");
      radio.type = "radio"; radio.name = name + "-cjk"; radio.value = value; radio.dataset.cjk = value; radio.checked = (rule.cjkMode || "inherit") === value;
      label.append(radio, document.createTextNode(text)); cjkActions.append(label);
    }
    card.append(top, actions, font, cjkActions); $("rules").append(card);
    $("empty-rules").hidden = true;
    return domain;
  }
  function changed() {
    if (!loaded) return;
    $("empty-rules").hidden = Boolean($("rules").children.length);
    status(saving ? "正在保存……" : JSON.stringify(read()) === saved ? "已保存" : "有未保存的更改");
  }
  $("settings").addEventListener("input", event => {
    if (event.target.checked && event.target.id === "replace-serif") $("replace-song").checked = false;
    if (event.target.checked && event.target.id === "replace-song") $("replace-serif").checked = false;
    changed(); if (!event.target.closest("#rules")) preview();
  });
  $("add-rule").addEventListener("click", () => { addRule().focus(); changed(); });
  $("compare").addEventListener("click", () => {
    comparing = !comparing;
    $("compare").textContent = comparing ? "查看替换字形" : "查看原字形";
    $("compare").setAttribute("aria-pressed", String(comparing)); preview();
  });
  $("settings").addEventListener("submit", async event => {
    event.preventDefault();
    if (!loaded || saving) return;
    const rules = [...$("rules").children];
    for (const row of rules) {
      const input = row.querySelector(".domain");
      input.setCustomValidity(SPF.parseDomain(input.value) ? "" : "请填写有效的域名或域名与端口。");
      if (!input.reportValidity()) { input.focus(); status("请修正站点域名。", true); return; }
    }
    for (const input of [...["font", "cjk-font", "song-font", "kai-font", "serif-chinese", "serif-western"].map($), ...document.querySelectorAll(".site-font")]) {
      if (input.disabled || (input.classList.contains("site-font") && !input.value.trim())) continue;
      input.setCustomValidity(SPF.fontNames(input.value).length ? "" : "请至少填写一个本机字体名称。");
      if (!input.reportValidity()) { input.focus(); status("请填写有效的字体列表。", true); return; }
    }
    const settings = read();
    saving = true; saveButton.disabled = true; form.setAttribute("aria-busy", "true"); status("正在保存……");
    try { await chrome.storage.local.set({ settings }); saved = JSON.stringify(settings); saving = false; changed(); }
    catch (error) { saving = false; status("保存失败：" + error.message, true); }
    finally { saveButton.disabled = false; form.setAttribute("aria-busy", "false"); }
  });
  $("rules").addEventListener("input", event => { if (event.target.classList.contains("domain")) event.target.setCustomValidity(""); });
  form.addEventListener("input", event => { if (event.target.matches("#font, #cjk-font, #song-font, #kai-font, #serif-chinese, #serif-western, .site-font")) event.target.setCustomValidity(""); });
  chrome.storage.local.get("settings").then(({ settings }) => {
    const value = SPF.normalize(settings);
    $("enabled").checked = value.enabled; $("font").value = value.font; $("extra").value = value.extra;
    document.querySelector(`input[name="cjk-mode"][value="${value.cjkMode}"]`).checked = true; $("cjk-font").value = value.cjkFont; $("cjk-targets").value = value.cjkTargets.join("\n");
    $("replace-song").checked = value.replaceSong; $("song-font").value = value.songFont;
    $("replace-kai").checked = value.replaceKai; $("kai-font").value = value.kaiFont;
    $("replace-serif").checked = value.replaceSerif; $("serif-chinese").value = value.serifChinese; $("serif-western").value = value.serifWestern;
    document.querySelector(`input[name="serif-shared"][value="${value.serifShared}"]`).checked = true;
    for (const input of document.querySelectorAll("[data-group]")) input.checked = value.groups.includes(input.value);
    for (const rule of value.siteRules) addRule(rule);
    saved = JSON.stringify(read()); loaded = true; form.inert = false; saveButton.disabled = false; form.setAttribute("aria-busy", "false"); changed(); preview();
  }).catch(error => { form.inert = false; form.setAttribute("aria-busy", "false"); status("读取设置失败：" + error.message, true); });
  // 原生 details 使用实际高度过渡，关闭时保留内容直至动画结束。
  for (const details of document.querySelectorAll("details")) {
    let animation = null;
    let detailTarget = false;
    details.querySelector("summary").addEventListener("click", event => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    event.preventDefault();
    const from = details.getBoundingClientRect().height;
    detailTarget = animation ? !detailTarget : !details.open;
    const closing = !detailTarget;
    animation?.cancel();
    details.style.height = "";
    details.open = true;
    const to = closing ? details.querySelector("summary").getBoundingClientRect().height : details.getBoundingClientRect().height;
    details.style.overflow = "hidden";
    animation = details.animate([{ height: from + "px" }, { height: to + "px" }], { duration: 180, easing: "ease-out" });
    animation.onfinish = () => { details.open = !closing; details.style.height = ""; details.style.overflow = ""; animation = null; };
    });
  }
})();
