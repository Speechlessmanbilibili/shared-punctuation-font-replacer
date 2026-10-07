(() => {
  "use strict";
  const FAMILY = "Shared Punctuation Font";
  const CHINESE_FONTS = Object.freeze([
    "Microsoft YaHei", "Microsoft YaHei UI", "微软雅黑",
    "PingFang SC", "PingFang UI SC", "苹方-简",
    "Hiragino Sans GB",
    "Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "思源黑体",
    "WenQuanYi Micro Hei",
    "HarmonyOS Sans SC", "HarmonyOS_Sans_SC"
  ]);
  const SYSTEM_FONTS = Object.freeze([
    "-apple-system", "-apple-system-font", "-webkit-system-font", "BlinkMacSystemFont",
    "system-ui", "ui-sans-serif", "sans-serif",
    "-apple-system-headline", "-apple-system-body", "-apple-system-subheadline",
    "-apple-system-footnote", "-apple-system-caption1", "-apple-system-caption2",
    "-apple-system-short-headline", "-apple-system-short-body", "-apple-system-short-subheadline",
    "-apple-system-short-footnote", "-apple-system-short-caption1", "-apple-system-tall-body",
    "-apple-system-title0", "-apple-system-title1", "-apple-system-title2",
    "-apple-system-title3", "-apple-system-title4"
  ]);
  const DEFAULT_TARGETS = Object.freeze([...CHINESE_FONTS, ...SYSTEM_FONTS]);
  const systemNames = new Set(SYSTEM_FONTS.map(x => x.toLowerCase()));
  // 已保存的旧默认名单按完整集合识别，保留用户编辑过的名单。
  const LEGACY_CHINESE_FONTS = [
    "Microsoft YaHei", "Microsoft YaHei UI", "微软雅黑", "微软雅黑 UI",
    "Microsoft JhengHei", "Microsoft JhengHei UI", "微軟正黑體", "微軟正黑體 UI",
    "HarmonyOS Sans SC", "HarmonyOS_Sans_SC",
    "MiSans", "MiSans VF", "OPPO Sans", "OPPOSans",
    "PingFang SC", "PingFang TC", "PingFang HK", "PingFang UI SC", "苹方", "苹方-简", "苹方-繁", "苹方-港",
    "Hiragino Sans GB", "冬青黑体简体中文",
    "Noto Sans SC", "Noto Sans TC", "Noto Sans HK", "Noto Sans CJK SC", "Noto Sans CJK TC", "Noto Sans CJK HK",
    "Source Han Sans SC", "Source Han Sans CN", "Source Han Sans TC", "Source Han Sans TW", "Source Han Sans HK", "Source Han Sans HC",
    "SourceHanSansSC", "SourceHanSansCN", "SourceHanSansTC", "SourceHanSansTW", "SourceHanSansHK", "SourceHanSansHC",
    "思源黑体", "思源黑体 CN", "思源黑体 SC", "思源黑體", "思源黑體 TC", "思源黑體 HK"
  ];
  const LEGACY_TARGET_SETS = [
    new Set(CHINESE_FONTS.map(x => x.toLowerCase())),
    new Set(LEGACY_CHINESE_FONTS.map(x => x.toLowerCase())),
    new Set([...LEGACY_CHINESE_FONTS, "HarmonyOS Sans", "HarmonyOS Sans TC", "HarmonyOS Sans HK", "HarmonyOS_Sans", "HarmonyOS_Sans_TC"].map(x => x.toLowerCase()))
  ];
  const CHINESE_NON_SANS = new Set([
    "SimSun", "NSimSun", "STSong", "Songti SC", "Songti TC",
    "KaiTi", "KaiTi_GB2312", "STKaiti", "Kaiti SC", "Kaiti TC", "DFKai-SB", "BiauKai",
    "FangSong", "FangSong_GB2312", "STFangsong"
  ].map(x => x.toLowerCase()));
  const CHANNEL = "shared-punctuation-font/v1";
  const GROUPS = Object.freeze([
    { id: "quotes", label: "弯引号", chars: "‘’‚‛“”„‟", enabled: true },
    { id: "ellipsis", label: "省略号", chars: "…‥", enabled: true },
    { id: "dashes", label: "破折号与连接号", chars: "‐‑‒–—―", enabled: true },
    { id: "dots", label: "间隔号与项目符号", chars: "·•‣⁃", enabled: true },
    { id: "references", label: "参考与章节符号", chars: "※§¶†‡", enabled: true },
    { id: "guillemets", label: "角形引号", chars: "«»‹›", enabled: false },
    { id: "ascii", label: "英文标点", chars: "\"'!#$%&()*+,-./:;<=>?@[\\]^_`{|}~", enabled: false },
    { id: "symbols", label: "常用符号", chars: "©®™°±×÷‰‱", enabled: false }
  ]);
  function normalize(value = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) value = {};
    const selected = Array.isArray(value.groups) ? value.groups : GROUPS.filter(x => x.enabled).map(x => x.id);
    let targets = Array.isArray(value.cjkTargets) ? [...new Set(value.cjkTargets.filter(x => typeof x === "string" && x.trim()).slice(0, 300).map(x => x.trim().slice(0, 300)))] : [...DEFAULT_TARGETS];
    if (LEGACY_TARGET_SETS.some(x => x.size === targets.length)) {
      const names = new Set(targets.map(x => x.toLowerCase()));
      if (LEGACY_TARGET_SETS.some(x => x.size === names.size && [...names].every(name => x.has(name)))) targets = [...DEFAULT_TARGETS];
    }
    return {
      enabled: value.enabled !== false,
      font: typeof value.font === "string" && value.font.trim() ? value.font.trim().slice(0, 300) : "PingFang UI SC",
      groups: GROUPS.filter(x => selected.includes(x.id)).map(x => x.id),
      extra: typeof value.extra === "string" ? value.extra.slice(0, 2000) : "",
      cjkMode: value.cjkMode === "off" ? "off" : "replace",
      cjkFont: typeof value.cjkFont === "string" && value.cjkFont.trim() ? value.cjkFont.trim().slice(0, 300) : "PingFang UI SC",
      cjkTargets: targets,
      siteRules: Array.isArray(value.siteRules) ? value.siteRules.filter(x => x && typeof x === "object").slice(0, 500).map(x => ({
        domain: typeof x.domain === "string" ? x.domain.trim() : "",
        action: ["on", "off"].includes(x.action) ? x.action : "inherit",
        font: typeof x.font === "string" ? x.font.trim().slice(0, 300) : "",
        cjkMode: ["off", "replace"].includes(x.cjkMode) ? x.cjkMode : "inherit"
      })) : []
    };
  }
  function parseDomain(value) {
    try {
      const text = value.trim().replace(/^\*\./, "");
      const authority = text.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
      if (!text || /\s/.test(text) || authority.includes("*") || /:(?:\D|$)/.test(authority.replace(/\[[^\]]+\]/, "ipv6"))) return null;
      const url = new URL(/^[\w-]+:\/\//.test(text) ? text : "https://" + text);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
      const port = authority.match(/:(\d+)$/);
      return { host: url.hostname.replace(/\.$/, ""), port: port ? String(Number(port[1])) : "" };
    } catch { return null; }
  }
  function effective(value, location) {
    const settings = normalize(value);
    let url;
    try { url = new URL(location); } catch { return settings; }
    const host = url.hostname.replace(/\.$/, "");
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    let best = null;
    let score = -1;
    for (const rule of settings.siteRules) {
      const domain = parseDomain(rule.domain);
      if (!domain || !(host === domain.host || host.endsWith("." + domain.host)) || (domain.port && domain.port !== port)) continue;
      const rank = domain.host.length * 2 + Number(Boolean(domain.port));
      if (rank > score) { best = rule; score = rank; }
    }
    return { ...settings, enabled: best?.action === "off" ? false : best?.action === "on" ? true : settings.enabled, font: best?.font || settings.font, cjkMode: best && best.cjkMode !== "inherit" ? best.cjkMode : settings.cjkMode };
  }
  function characters(value) {
    const settings = normalize(value);
    return [...new Set([...GROUPS.filter(x => settings.groups.includes(x.id)).map(x => x.chars).join(""), ...settings.extra])]
      .filter(x => !/\s/u.test(x) && !(x.codePointAt(0) >= 0xD800 && x.codePointAt(0) <= 0xDFFF))
      .sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
  }
  function unicodeRange(value) {
    const numbers = characters(value).map(x => x.codePointAt(0));
    const ranges = [];
    const code = n => n.toString(16).toUpperCase().padStart(4, "0");
    for (let i = 0; i < numbers.length; i++) {
      const start = numbers[i];
      let end = start;
      while (numbers[i + 1] === end + 1) end = numbers[++i];
      ranges.push("U+" + code(start) + (end !== start ? "-" + code(end) : ""));
    }
    return ranges.join(",");
  }
  function cssString(value) {
    return '"' + value.replace(/["\\\n\r\f\0]/g, x => "\\" + x.codePointAt(0).toString(16) + " ") + '"';
  }
  function fontCSS(value) {
    const range = unicodeRange(value);
    return range ? `@font-face { font-family: ${cssString(FAMILY)}; src: local(${cssString(normalize(value).font)}); unicode-range: ${range}; font-display: swap; }` : "";
  }
  const prefix = cssString(FAMILY) + ", ";
  function familyList(value) {
    const result = [];
    let start = 0;
    let depth = 0;
    let quote = "";
    for (let i = 0; i < value.length; i++) {
      if (value[i] === "\\") { i++; continue; }
      if (quote) { if (value[i] === quote) quote = ""; continue; }
      if (value[i] === '"' || value[i] === "'") { quote = value[i]; continue; }
      if (value.startsWith("/*", i)) { const end = value.indexOf("*/", i + 2); i = end < 0 ? value.length : end + 1; continue; }
      if (value[i] === "(") depth++;
      if (value[i] === ")") depth--;
      if (value[i] === "," && !depth) { result.push(value.slice(start, i)); start = i + 1; }
    }
    result.push(value.slice(start));
    return result;
  }
  function hasFonts(value) { const settings = normalize(value); return Boolean(unicodeRange(settings)) || settings.cjkMode !== "off"; }
  function decodeCSS(value) {
    return value.replace(/\\(?:([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|([^\r\n\f]))/gi, (_, hex, char) => {
      if (!hex) return char;
      const n = parseInt(hex, 16);
      return n === 0 || n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF) ? "\uFFFD" : String.fromCodePoint(n);
    }).replace(/\\(?:\r\n|[\r\n\f])/g, "");
  }
  function familyName(value) {
    let name = value.trim();
    if ((name[0] === '"' || name[0] === "'") && name.at(-1) === name[0]) name = name.slice(1, -1);
    else {
      name = name.replace(/\/\*[\s\S]*?\*\//g, " ").trim();
      if (/[()]/.test(name)) return null;
    }
    return decodeCSS(name).replace(/[\t\r\n\f ]+/g, " ").trim().toLowerCase();
  }
  function hasChineseNonSans(value) {
    const pending = [value];
    for (let i = 0; i < pending.length; i++) for (const part of familyList(pending[i])) {
      const name = familyName(part);
      if (name !== null) {
        if (CHINESE_NON_SANS.has(name) || /[宋楷]|明[体體]/.test(name) || /^(?:noto serif(?: cjk)?|source han serif) (?:sc|cn|tc|tw|hk|hc)$/.test(name)) return true;
      } else {
        const text = decodeCSS(part).replace(/\/\*[\s\S]*?\*\//g, " ").trim();
        if (/^generic\(\s*(?:kai|fangsong)\s*\)$/i.test(text)) return true;
        const variable = text.match(/^var\(([\s\S]*)\)$/i);
        if (variable) {
          const fallback = familyList(variable[1]).slice(1).join(",");
          if (fallback) pending.push(fallback);
        }
      }
    }
    return false;
  }
  function chineseFontFamilies(font) {
    return font.toLowerCase() === "pingfang ui sc" ? [font, "PingFang SC"] : [font];
  }
  function chineseFamilies(value, options, append = true, preserveSystem = false) {
    const settings = normalize(options);
    if (settings.cjkMode === "off") return value;
    const targets = new Set(settings.cjkTargets.map(x => x.toLowerCase()));
    const selected = settings.cjkFont.toLowerCase();
    const parts = familyList(value);
    const font = chineseFontFamilies(settings.cjkFont).map(cssString).join(", ");
    const group = selected === "sf pro text" ? font : cssString("SF Pro Text") + ", " + font;
    const nonSans = hasChineseNonSans(value);
    let found = false;
    const result = parts.map((part, i) => {
      const name = familyName(part);
      if (name === null) {
        const opening = part.indexOf("(");
        if (opening >= 0 && decodeCSS(part.slice(0, opening).trim()).toLowerCase() === "var" && part.trimEnd().endsWith(")")) {
          const closing = part.lastIndexOf(")");
          const args = familyList(part.slice(opening + 1, closing));
          if (args.length > 1) {
            const fallback = args.slice(1).join(",");
            const replacement = chineseFamilies(fallback, settings, false, preserveSystem);
            if (replacement !== fallback) {
              found = true;
              return part.slice(0, opening + 1) + args[0] + "," + replacement + part.slice(closing);
            }
          }
        }
      }
      if ((nonSans || preserveSystem) && systemNames.has(name)) return part;
      if (name === selected || targets.has(name)) {
        found = true;
        return i > 0 && familyName(parts[i - 1]) === "sf pro text" ? font : group;
      }
      return part;
    }).join(",");
    const tail = familyName(parts.at(-1)) === "sf pro text" ? font : group;
    return !found && append && !nonSans ? result + ", " + tail : result;
  }
  function variableReferences(value) {
    const result = new Set();
    for (let i = 0; i < value.length;) {
      if (value.startsWith("/*", i)) { const end = value.indexOf("*/", i + 2); i = end < 0 ? value.length : end + 2; continue; }
      if (value[i] === '"' || value[i] === "'") {
        const quote = value[i++];
        while (i < value.length) { if (value[i] === "\\") { i += 2; continue; } if (value[i++] === quote) break; }
        continue;
      }
      if (value[i] === "\\" || /[\w-]/.test(value[i]) || value.charCodeAt(i) >= 128) {
        const start = i;
        while (i < value.length) {
          if (value[i] === "\\") { const match = value.slice(i).match(/^\\(?:[\da-f]{1,6}(?:\r\n|[\t\n\f\r ])?|[^\r\n\f])/i); if (!match) break; i += match[0].length; continue; }
          if (!(/[\w-]/.test(value[i]) || value.charCodeAt(i) >= 128)) break;
          i++;
        }
        const name = decodeCSS(value.slice(start, i));
        if (i === start) { i++; continue; }
        if (value[i] === "(" && name.toLowerCase() === "var") {
          i++;
          while (i < value.length) {
            if (/[\t\r\n\f ]/.test(value[i])) { i++; continue; }
            if (value.startsWith("/*", i)) { const end = value.indexOf("*/", i + 2); i = end < 0 ? value.length : end + 2; continue; }
            break;
          }
          const begin = i;
          while (i < value.length) {
            if (value[i] === "\\") { const match = value.slice(i).match(/^\\(?:[\da-f]{1,6}(?:\r\n|[\t\n\f\r ])?|[^\r\n\f])/i); if (!match) break; i += match[0].length; continue; }
            if (!(/[\w-]/.test(value[i]) || value.charCodeAt(i) >= 128)) break;
            i++;
          }
          const reference = decodeCSS(value.slice(begin, i));
          if (reference.startsWith("--")) result.add(reference);
        }
        continue;
      }
      i++;
    }
    return result;
  }
  function prepend(value, options, append = true) {
    const family = value.trim();
    if (!family || /^(?:inherit|initial|unset|revert|revert-layer)$/i.test(family) || family.startsWith(prefix)) return value;
    if (!options) return prefix + value;
    const settings = normalize(options);
    const head = unicodeRange(settings) ? prefix : "";
    return head + chineseFamilies(value, settings, append, !append);
  }
  globalThis.SPF = Object.freeze({ FAMILY, CHINESE_FONTS, SYSTEM_FONTS, DEFAULT_TARGETS, CHANNEL, GROUPS, normalize, parseDomain, effective, characters, unicodeRange, cssString, fontCSS, prepend, prefix, familyList, familyName, hasChineseNonSans, chineseFontFamilies, chineseFamilies, variableReferences, hasFonts });
})();
