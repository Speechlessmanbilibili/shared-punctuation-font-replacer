const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const scope = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "shared.js"), "utf8"), scope);
const S = scope.SPF;

test("默认字符包括共用标点，正文与英文标点由独立选项控制", () => {
  const chars = S.characters({}).join("");
  for (const c of "“”‘’…—·•※§¶†‡") assert.ok(chars.includes(c), c);
  for (const c of "ABC中文0123\"'") assert.ok(!chars.includes(c), c);
});
test("Unicode 范围合并连续码位，支持补充平面并忽略空白与孤立代理", () => {
  assert.equal(S.unicodeRange({ groups: [], extra: "ABCBA 😀\uD800\n" }), "U+0041-0043,U+1F600");
  assert.equal(S.fontCSS({ groups: [], extra: "" }), "");
  assert.ok(S.fontCSS({ font: 'Font"\\Name' }).includes('local("Font\\22 \\5c Name")'));
});
test("前置专用字体保留原列表，重复处理与全局关键字保持原义", () => {
  const family = 'Arial, "Times New Roman", sans-serif';
  assert.equal(S.prepend(family), S.prefix + family);
  assert.equal(S.prepend(S.prepend(family)), S.prepend(family));
  for (const value of ["", "inherit", "initial", "unset", "revert", "revert-layer"]) assert.equal(S.prepend(value), value);
});
test("站点规则匹配子域名、显式端口、默认端口与相同规则顺序", () => {
  const settings = { enabled: true, font: "Arial", siteRules: [
    { domain: "example.com", action: "off" },
    { domain: "sub.example.com", action: "on", font: "Courier New" },
    { domain: "sub.example.com:443", action: "off" }
  ] };
  assert.equal(S.effective(settings, "https://example.com").enabled, false);
  assert.equal(S.effective(settings, "http://sub.example.com").font, "Courier New");
  assert.equal(S.effective(settings, "https://sub.example.com").enabled, false);
  assert.equal(S.effective(settings, "https://evil-example.com").enabled, true);
  assert.equal(S.effective({ siteRules: [{ domain: "example.com", action: "off" }, { domain: "example.com", action: "on" }] }, "https://example.com").enabled, false);
  for (const name of ["example.com:abc", "example.com:99999", "bad host", "ftp://example.com", "http://u:p@example.com"]) assert.equal(S.parseDomain(name), null, name);
  assert.equal(S.parseDomain("[::1]:8080").port, "8080");
});
test("常见正文字体原位替换，宋体与 SimHei 保留，无命中在列表末尾追加", () => {
  assert.equal(S.prepend('Arial, "Microsoft YaHei", sans-serif', { cjkMode: "replace" }), S.prefix + 'Arial,"SF Pro Text", "PingFang UI SC","SF Pro Text", "PingFang UI SC"');
  assert.equal(S.prepend('Arial, SimSun, serif', { cjkMode: "replace" }), S.prefix + 'Arial, SimSun, serif');
  assert.equal(S.prepend('"A,B", var(--fonts, serif), sans-serif', { cjkMode: "replace" }), S.prefix + '"A,B", var(--fonts, serif),"SF Pro Text", "PingFang UI SC"');
  assert.equal(S.prepend('Arial', { groups: [], cjkMode: "replace" }), 'Arial, "SF Pro Text", "PingFang UI SC"');
  assert.equal(S.chineseFamilies('"Noto Serif SC", "Source Han Serif SC", "宋体", "仿宋", serif', {}), '"Noto Serif SC", "Source Han Serif SC", "宋体", "仿宋", serif');
  assert.equal(S.chineseFamilies('"Noto Sans JP", "Apple SD Gothic Neo", serif', {}), '"Noto Sans JP", "Apple SD Gothic Neo", serif, "SF Pro Text", "PingFang UI SC"');
  assert.equal(S.chineseFamilies('"Noto Sans SC", Arial', {}), '"SF Pro Text", "PingFang UI SC", Arial');
  assert.equal(S.chineseFamilies('"HarmonyOS Sans SC", Arial', {}), '"SF Pro Text", "PingFang UI SC", Arial');
  assert.equal(S.chineseFamilies('"HarmonyOS_Sans_SC", Arial', {}), '"SF Pro Text", "PingFang UI SC", Arial');
  for (const name of ["HarmonyOS Sans", "HarmonyOS_Sans", "HarmonyOS Sans TC", "HarmonyOS Sans HK", "HarmonyOS_Sans_TC"]) {
    assert.equal(S.chineseFamilies('"' + name + '", Arial', {}), '"' + name + '", Arial, "SF Pro Text", "PingFang UI SC"');
    assert.ok(!S.CHINESE_FONTS.includes(name));
  }
  assert.equal(S.chineseFamilies('SimHei, "黑体", "华文黑体", Arial', {}), 'SimHei, "黑体", "华文黑体", Arial, "SF Pro Text", "PingFang UI SC"');
  assert.equal(S.effective({ cjkMode: "replace", siteRules: [{ domain: "example.com", cjkMode: "off" }] }, "https://example.com").cjkMode, "off");
});
test("明确的宋体、楷体、仿宋及变量回退阻止追加，正文黑体仍原位替换", () => {
  for (const family of ["SimSun", "NSimSun", "STSong", '"Songti SC"', '"宋体"', '"方正书宋"', "KaiTi", "KaiTi_GB2312", "STKaiti", '"Kaiti SC"', '"楷体"', "FangSong", "STFangsong", '"仿宋"', '"Noto Serif CJK SC"', '"Source Han Serif CN"', String.raw`"\5b8b \4f53 "`, "generic(kai)", "generic(fangsong)", "var(--body, var(--backup, SimSun))"]) {
    const value = "Arial, " + family + ", serif";
    assert.equal(S.chineseFamilies(value, {}), value, family);
    assert.equal(S.prepend(value, {}), S.prefix + value, family);
  }
  assert.equal(S.chineseFamilies('Arial, "Microsoft YaHei", SimSun', {}), 'Arial,"SF Pro Text", "PingFang UI SC", SimSun');
  for (const value of ['Arial, serif', '"Times New Roman", serif', '"Noto Serif", serif', '"My SimSun Theme", serif']) {
    assert.equal(S.chineseFamilies(value, {}), value + ', "SF Pro Text", "PingFang UI SC"');
  }
});
test("默认名单限定简中 CSS 字体栈，繁体、港版及额外家族保留", () => {
  const original = '"PingFang TC", "PingFang HK", "Noto Sans TC", "Noto Sans CJK HK", "Microsoft JhengHei", "Source Han Sans TW", MiSans, OPPOSans, Arial';
  assert.equal(S.chineseFamilies(original, {}), original + ', "SF Pro Text", "PingFang UI SC"');
  assert.equal(S.chineseFamilies('"WenQuanYi Micro Hei", sans-serif', {}), '"SF Pro Text", "PingFang UI SC","SF Pro Text", "PingFang UI SC"');
  assert.equal(S.CHINESE_FONTS.length, 14);
});
test("SF Pro Text 紧邻目标中文字体，已有相邻项不重复，自选目标字体同样处理", () => {
  const original = 'Arial,"SF Pro Text", "PingFang UI SC", sans-serif';
  assert.equal(S.chineseFamilies(original, {}), 'Arial,"SF Pro Text","PingFang UI SC","SF Pro Text", "PingFang UI SC"');
  assert.equal(S.chineseFamilies('Arial,"SF Pro Text"', {}), 'Arial,"SF Pro Text", "PingFang UI SC"');
  assert.equal(S.chineseFamilies('Arial, "Microsoft YaHei", sans-serif', { cjkFont: "Custom Chinese" }), 'Arial,"SF Pro Text", "Custom Chinese","SF Pro Text", "Custom Chinese"');
  assert.equal(S.chineseFamilies('"Microsoft YaHei", sans-serif', { cjkFont: "SF Pro Text" }), '"SF Pro Text","SF Pro Text"');
});
test("已保存的旧默认名单迁移，增删过的名单与显式空名单保持原样", () => {
  const old = [
    "Microsoft YaHei", "Microsoft YaHei UI", "微软雅黑", "微软雅黑 UI",
    "Microsoft JhengHei", "Microsoft JhengHei UI", "微軟正黑體", "微軟正黑體 UI",
    "HarmonyOS Sans SC", "HarmonyOS_Sans_SC", "MiSans", "MiSans VF", "OPPO Sans", "OPPOSans",
    "PingFang SC", "PingFang TC", "PingFang HK", "PingFang UI SC", "苹方", "苹方-简", "苹方-繁", "苹方-港",
    "Hiragino Sans GB", "冬青黑体简体中文",
    "Noto Sans SC", "Noto Sans TC", "Noto Sans HK", "Noto Sans CJK SC", "Noto Sans CJK TC", "Noto Sans CJK HK",
    "Source Han Sans SC", "Source Han Sans CN", "Source Han Sans TC", "Source Han Sans TW", "Source Han Sans HK", "Source Han Sans HC",
    "SourceHanSansSC", "SourceHanSansCN", "SourceHanSansTC", "SourceHanSansTW", "SourceHanSansHK", "SourceHanSansHC",
    "思源黑体", "思源黑体 CN", "思源黑体 SC", "思源黑體", "思源黑體 TC", "思源黑體 HK"
  ];
  assert.deepEqual([...S.normalize({ cjkTargets: old }).cjkTargets], [...S.DEFAULT_TARGETS]);
  const beforeSC = [...old, "HarmonyOS Sans", "HarmonyOS Sans TC", "HarmonyOS Sans HK", "HarmonyOS_Sans", "HarmonyOS_Sans_TC"];
  assert.deepEqual([...S.normalize({ cjkTargets: beforeSC.reverse().map(x => x.toLowerCase()) }).cjkTargets], [...S.DEFAULT_TARGETS]);
  assert.deepEqual([...S.normalize({ cjkTargets: [...S.CHINESE_FONTS] }).cjkTargets], [...S.DEFAULT_TARGETS]);
  for (const custom of [[], old.slice(1), [...old, "Design Font"], [...old.slice(1), "Design Font"]]) {
    assert.deepEqual([...S.normalize({ cjkTargets: custom }).cjkTargets], custom);
  }
});
test("系统无衬线与 Apple 文本样式原位替换，中文衬线栈保留系统回退", () => {
  for (const name of S.SYSTEM_FONTS) {
    assert.equal(S.chineseFamilies('Arial, ' + name, {}), 'Arial,"SF Pro Text", "PingFang UI SC"', name);
    assert.equal(S.chineseFamilies('SimSun, ' + name, {}), 'SimSun, ' + name, name);
    assert.equal(S.prepend('var(--song), ' + name, {}, false), S.prefix + 'var(--song), ' + name, name);
    assert.equal(S.chineseFamilies(name, {}, false), '"SF Pro Text", "PingFang UI SC"', name);
  }
  assert.equal(S.SYSTEM_FONTS.length, 24);
  assert.ok(!S.DEFAULT_TARGETS.includes("Apple UI System"));
  assert.equal(S.chineseFamilies('ui-serif, ui-monospace, monospace', {}), 'ui-serif, ui-monospace, monospace, "SF Pro Text", "PingFang UI SC"');
});
test("变量引用支持中文、CSS 转义、嵌套回退、注释及大小写敏感名称", () => {
  assert.deepEqual([...S.variableReferences('var(--字体, var(--Font))')].sort(), ["--Font", "--字体"].sort());
  assert.deepEqual([...S.variableReferences('v\\61 r(--\\5b57 \\4f53 )')], ["--字体"]);
  assert.deepEqual([...S.variableReferences('"var(--fake)" /* var(--other) */ var(--real)')], ["--real"]);
});
