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
  for (const value of ["foo*.example.com", "**.example.com", "*"]) assert.equal(S.parseDomain(value), null);
  assert.equal(S.parseDomain("*.example.com").host, "example.com");
  assert.equal(S.parseDomain("https://example.com/a:b?q=search*").host, "example.com");
  for (const value of ["HTTPS://EXAMPLE.COM:443/path?q=font#body", "https://example.com:443/path?q=font#body"]) {
    assert.equal(S.parseDomain(value).host, "example.com");
    assert.equal(S.parseDomain(value).port, "443");
  }
});
test("常见正文字体原位替换，宋体与 SimHei 保留，无命中在列表末尾追加", () => {
  assert.equal(S.prepend('Arial, "Microsoft YaHei", sans-serif', { cjkMode: "replace" }), S.prefix + 'Arial,"SF Pro Text", "PingFang UI SC", "PingFang SC","SF Pro Text", "PingFang UI SC", "PingFang SC"');
  assert.equal(S.prepend('Arial, SimSun, serif', { cjkMode: "replace" }), S.prefix + 'Arial, SimSun, serif');
  assert.equal(S.prepend('"A,B", var(--fonts, serif), sans-serif', { cjkMode: "replace" }), S.prefix + '"A,B", var(--fonts, serif),"SF Pro Text", "PingFang UI SC", "PingFang SC"');
  assert.equal(S.prepend('Arial', { groups: [], cjkMode: "replace" }), 'Arial, "SF Pro Text", "PingFang UI SC", "PingFang SC"');
  assert.equal(S.chineseFamilies('"Noto Serif SC", "Source Han Serif SC", "宋体", "仿宋", serif', {}), '"Noto Serif SC", "Source Han Serif SC", "宋体", "仿宋", serif');
  assert.equal(S.chineseFamilies('"Noto Sans JP", "Apple SD Gothic Neo", serif', {}), '"Noto Sans JP", "Apple SD Gothic Neo", serif, "SF Pro Text", "PingFang UI SC", "PingFang SC"');
  assert.equal(S.chineseFamilies('"Noto Sans SC", Arial', {}), '"SF Pro Text", "PingFang UI SC", "PingFang SC", Arial');
  assert.equal(S.chineseFamilies('"HarmonyOS Sans SC", Arial', {}), '"SF Pro Text", "PingFang UI SC", "PingFang SC", Arial');
  assert.equal(S.chineseFamilies('"HarmonyOS_Sans_SC", Arial', {}), '"SF Pro Text", "PingFang UI SC", "PingFang SC", Arial');
  for (const name of ["HarmonyOS Sans", "HarmonyOS_Sans", "HarmonyOS Sans TC", "HarmonyOS Sans HK", "HarmonyOS_Sans_TC"]) {
    assert.equal(S.chineseFamilies('"' + name + '", Arial', {}), '"' + name + '", Arial, "SF Pro Text", "PingFang UI SC", "PingFang SC"');
    assert.ok(!S.CHINESE_FONTS.includes(name));
  }
  assert.equal(S.chineseFamilies('SimHei, "黑体", "华文黑体", Arial', {}), 'SimHei, "黑体", "华文黑体", Arial, "SF Pro Text", "PingFang UI SC", "PingFang SC"');
  assert.equal(S.effective({ cjkMode: "replace", siteRules: [{ domain: "example.com", cjkMode: "off" }] }, "https://example.com").cjkMode, "off");
});
test("明确的宋体、楷体、仿宋及变量回退阻止追加，正文黑体仍原位替换", () => {
  for (const family of ["SimSun", "NSimSun", "STSong", '"Songti SC"', '"宋体"', '"方正书宋"', "KaiTi", "KaiTi_GB2312", "STKaiti", '"Kaiti SC"', '"楷体"', "FangSong", "STFangsong", '"仿宋"', '"Noto Serif CJK SC"', '"Source Han Serif CN"', String.raw`"\5b8b \4f53 "`, "generic(kai)", "generic(fangsong)", "var(--body, var(--backup, SimSun))"]) {
    const value = "Arial, " + family + ", serif";
    assert.equal(S.chineseFamilies(value, {}), value, family);
    assert.equal(S.prepend(value, {}), S.prefix + value, family);
  }
  assert.equal(S.chineseFamilies('Arial, "Microsoft YaHei", SimSun', {}), 'Arial,"SF Pro Text", "PingFang UI SC", "PingFang SC", SimSun');
  for (const value of ['Arial, serif', '"Times New Roman", serif', '"Noto Serif", serif', '"My SimSun Theme", serif']) {
    assert.equal(S.chineseFamilies(value, {}), value + ', "SF Pro Text", "PingFang UI SC", "PingFang SC"');
  }
});
test("默认名单限定简中 CSS 字体栈，繁体、港版及额外家族保留", () => {
  const original = '"PingFang TC", "PingFang HK", "Noto Sans TC", "Noto Sans CJK HK", "Microsoft JhengHei", "Source Han Sans TW", MiSans, OPPOSans, Arial';
  assert.equal(S.chineseFamilies(original, {}), original + ', "SF Pro Text", "PingFang UI SC", "PingFang SC"');
  assert.equal(S.chineseFamilies('"WenQuanYi Micro Hei", sans-serif', {}), '"SF Pro Text", "PingFang UI SC", "PingFang SC","SF Pro Text", "PingFang UI SC", "PingFang SC"');
  assert.equal(S.CHINESE_FONTS.length, 14);
});
test("SF Pro Text 紧邻目标中文字体，已有相邻项不重复，自选目标字体同样处理", () => {
  const original = 'Arial,"SF Pro Text", "PingFang UI SC", sans-serif';
  assert.equal(S.chineseFamilies(original, {}), 'Arial,"SF Pro Text","PingFang UI SC", "PingFang SC","SF Pro Text", "PingFang UI SC", "PingFang SC"');
  assert.equal(S.chineseFamilies('Arial,"SF Pro Text"', {}), 'Arial,"SF Pro Text", "PingFang UI SC", "PingFang SC"');
  assert.equal(S.chineseFamilies('Arial, "Microsoft YaHei", sans-serif', { cjkFont: "Custom Chinese" }), 'Arial,"SF Pro Text", "Custom Chinese","SF Pro Text", "Custom Chinese"');
  assert.equal(S.chineseFamilies('"Microsoft YaHei", sans-serif', { cjkFont: "SF Pro Text" }), '"SF Pro Text","SF Pro Text"');
  assert.equal(S.chineseFamilies('"Microsoft YaHei", Arial', { cjkFont: "pingfang ui sc" }), '"SF Pro Text", "pingfang ui sc", "PingFang SC", Arial');
  assert.equal(S.chineseFamilies('"Microsoft YaHei", Arial', { cjkMode: "off" }), '"Microsoft YaHei", Arial');
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
    assert.equal(S.chineseFamilies('Arial, ' + name, {}), 'Arial,"SF Pro Text", "PingFang UI SC", "PingFang SC"', name);
    assert.equal(S.chineseFamilies('SimSun, ' + name, {}), 'SimSun, ' + name, name);
    assert.equal(S.prepend('var(--song), ' + name, {}, false), S.prefix + 'var(--song), ' + name, name);
    assert.equal(S.chineseFamilies(name, {}, false), '"SF Pro Text", "PingFang UI SC", "PingFang SC"', name);
  }
  assert.equal(S.SYSTEM_FONTS.length, 24);
  assert.ok(!S.DEFAULT_TARGETS.includes("Apple UI System"));
  assert.equal(S.chineseFamilies('ui-serif, ui-monospace, monospace', {}), 'ui-serif, ui-monospace, monospace, "SF Pro Text", "PingFang UI SC", "PingFang SC"');
});
test("变量引用支持中文、CSS 转义、嵌套回退、注释及大小写敏感名称", () => {
  assert.deepEqual([...S.variableReferences('var(--字体, var(--Font))')].sort(), ["--Font", "--字体"].sort());
  assert.deepEqual([...S.variableReferences('v\\61 r(--\\5b57 \\4f53 )')], ["--字体"]);
  assert.deepEqual([...S.variableReferences('"var(--fake)" /* var(--other) */ var(--real)')], ["--real"]);
});
test("字体列表保留引号内逗号，按输入顺序去重并生成独立本机字体引用", () => {
  assert.deepEqual([...S.fontNames('Arial， "A,B", Arial, "Times New Roman"\nCourier New')], ["Arial", "A,B", "Times New Roman", "Courier New"]);
  assert.deepEqual([...S.fontNames(String.raw`"A\22 B", "A\2c B"`)], ['A"B', "A,B"]);
  assert.deepEqual([...S.chineseFontFamilies('PingFang UI SC, Custom Font, PingFang SC')], ["PingFang UI SC", "Custom Font", "PingFang SC"]);
  assert.equal(S.chineseFamilies('"Microsoft YaHei", Arial', { cjkFont: '"A,B", Custom Font' }), '"SF Pro Text", "A,B", "Custom Font", Arial');
  const css = S.fontCSS({ font: 'Missing Font, "A,B", Courier New' });
  assert.ok(css.indexOf('local("Missing Font")') < css.indexOf('local("A,B")'));
  assert.ok(css.indexOf('local("A,B")') < css.indexOf('local("Courier New")'));
  assert.deepEqual([...S.punctuationFaces({ font: 'Arial, PingFang UI SC' })].map(x => [x.family, x.weight]), [["Shared Punctuation Font", "normal"], ["Shared Punctuation Font 2", "100 900"]]);
  const modified = S.prepend('Arial', { cjkMode: "off", font: 'Courier New, Arial' });
  assert.equal(modified, '"Shared Punctuation Font", "Shared Punctuation Font 2", Arial');
  assert.equal(S.prepend(modified, { cjkMode: "off", font: 'Courier New, Arial' }), modified);
});
test("宋体与楷体独立选择替换，默认关闭，关闭黑体时仍处理变量回退", () => {
  assert.equal(S.normalize({}).replaceSong, false);
  assert.equal(S.normalize({}).replaceKai, false);
  const settings = { cjkMode: "off", replaceSong: true, songFont: "Song Custom, SimSun", replaceKai: true, kaiFont: "Kai Custom, KaiTi" };
  assert.equal(S.hasFonts({ ...settings, groups: [] }), true);
  assert.equal(S.chineseFamilies('Arial, SimSun, KaiTi, FangSong, serif', settings), 'Arial,"Song Custom", "SimSun","Kai Custom", "KaiTi", FangSong, serif');
  assert.equal(S.chineseFamilies('var(--song, var(--missing, "宋体")), serif', settings), 'var(--song, var(--missing,"Song Custom", "SimSun")), serif');
  assert.equal(S.chineseFamilies('"思源宋体", "楷体", "Songti TC", "Kaiti TC"', { ...settings, replaceKai: false }), '"思源宋体", "楷体", "Songti TC", "Kaiti TC"');
  assert.equal(S.chineseFamilies('generic(kai), serif', settings), '"Kai Custom", "KaiTi", serif');
  assert.equal(S.chineseFamilies('"SF Pro Text", SimSun', settings), '"SF Pro Text","Song Custom", "SimSun"');
  assert.equal(S.chineseFamilies('KaiTi', { ...settings, kaiFont: '"SF Pro Text", Kai Custom' }), '"SF Pro Text", "Kai Custom"');
  assert.equal(S.chineseFamilies('Arial, serif', settings), 'Arial, serif');
  assert.equal(S.hasFonts({ groups: [], cjkMode: "off", replaceSong: false, replaceKai: false }), false);
});
test("宋体开关只匹配宋体与 SimSun，其他宋体名称保留原列表及变量回退", () => {
  for (const cjkMode of ["off", "replace"]) {
    const settings = { cjkMode, replaceSong: true, songFont: "Song Custom" };
    for (const family of ['"宋体"', "SimSun", "simsun", String.raw`"\5b8b \4f53 "`]) {
      assert.equal(S.chineseFamilies(`Arial, ${family}, serif`, settings), 'Arial,"Song Custom", serif');
    }
    for (const family of ["NSimSun", "STSong", "Songti SC", "新宋体", "华文宋体", "宋体-简", "Noto Serif SC", "Noto Serif CJK SC", "Source Han Serif SC", "思源宋体", "Songti TC"]) {
      const value = `Arial, "${family}", sans-serif`;
      assert.equal(S.chineseFamilies(value, settings), value, family);
      const fallback = `var(--font, var(--backup, "${family}")), serif`;
      assert.equal(S.chineseFamilies(fallback, settings), fallback, family);
    }
  }
});
test("站点关闭中文替换时同步停用宋体与楷体，独立标点字体列表仍生效", () => {
  const configured = { replaceSong: true, replaceKai: true, siteRules: [{ domain: "example.com", cjkMode: "off", font: "Courier New, Arial" }] };
  const effective = S.effective(configured, "https://example.com");
  assert.equal(effective.replaceSong, false);
  assert.equal(effective.replaceKai, false);
  assert.equal(effective.font, "Courier New, Arial");
  assert.equal(S.effective(configured, "https://other.example").replaceSong, true);
});

test("serif 原位组合保留前置字体和显式字体名称，嵌套回退及重复处理保持一致", () => {
  const settings = { replaceSerif: true, serifChinese: "Missing Chinese, SimSun", serifWestern: "Missing Western, Times New Roman" };
  const group = '"Mixed Serif Chinese", "Mixed Serif Chinese 2", "Mixed Serif Western", "Mixed Serif Western 2", serif';
  assert.equal(S.normalize({}).replaceSerif, false);
  assert.equal(S.normalize({}).serifShared, "chinese");
  assert.equal(S.prepend("Arial, serif", settings), "Arial," + group);
  assert.equal(S.prepend("serif", settings), group);
  assert.equal(S.prepend("SimSun", settings), group.replace(/serif$/, "SimSun"));
  assert.equal(S.prepend('"宋体"', settings), group.replace(/serif$/, '"宋体"'));
  assert.equal(S.normalize({ replaceSong: true, replaceSerif: true }).replaceSong, false);
  assert.equal(S.prepend(S.prepend("Arial, serif", settings), settings), "Arial," + group);
  assert.equal(S.prepend(String.raw`s\65 rif`, settings).includes('"Mixed Serif Chinese"'), true);
  for (const value of ['"serif"', "ui-serif", "sans-serif", "monospace", '"Times New Roman"', '"Songti SC"', '"新宋体"', '"思源宋体"']) {
    assert.equal(S.hasSerif(value), false, value);
    assert.equal(S.prepend(value, settings).includes("Mixed Serif"), false, value);
  }
  const nested = S.prepend("var(--a, var(--b, serif))", settings);
  assert.ok(nested.includes('var(--b,' + group + ")"));
  assert.ok(!nested.includes("Shared Punctuation Font"));
  assert.equal(S.hasSerif('var(--a, "serif")'), false);
  assert.equal(S.prepend("var(--a)", settings, false, true), "var(--a)");
  assert.equal(S.hasFonts({ groups: [], cjkMode: "off", replaceSerif: true }), true);
  assert.equal(S.effective({ ...settings, siteRules: [{ domain: "example.com", cjkMode: "off" }] }, "https://example.com").replaceSerif, false);
});

test("serif 中西文范围不重叠，汉字扩展、全角标点、西文与共用字符正确分配", () => {
  const intervals = text => text.split(",").map(item => item.slice(2).split("-").map(x => parseInt(x, 16))).map(([start, end]) => [start, end ?? start]);
  const contains = (ranges, char) => ranges.some(([start, end]) => char.codePointAt(0) >= start && char.codePointAt(0) <= end);
  for (const side of ["chinese", "western"]) {
    const ranges = S.serifRanges(side), cn = intervals(ranges.chinese), west = intervals(ranges.western);
    for (const [start, end] of cn) assert.ok(!west.some(([otherStart, otherEnd]) => start <= otherEnd && end >= otherStart));
    for (const char of "中文。，㐀𠀀𱍐") { assert.ok(contains(cn, char), char); assert.ok(!contains(west, char), char); }
    for (const char of "ABC2026éΩЖ") { assert.ok(contains(west, char), char); assert.ok(!contains(cn, char), char); }
    for (const char of "“”…—·※§†©±") assert.equal(contains(cn, char), side === "chinese", char);
    for (const [start, end] of [...cn, ...west]) assert.ok(end < 0xD800 || start > 0xDFFF);
  }
  const faces = S.serifFaces({ replaceSerif: true, serifChinese: "PingFang UI SC, SimSun", serifWestern: "Arial" });
  assert.deepEqual([...faces].map(x => [x.side, x.weight]), [["chinese", "100 900"], ["chinese", "normal"], ["western", "normal"]]);
});
