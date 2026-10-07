const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { createHash } = require("node:crypto");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
let context, server, crossServer, origin, crossOrigin, extensionId;
let chineseReference, westernReference;
const pages = [];
const errors = [];
const routes = new Map();
const crossRoutes = new Map();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();
function serve(routes) {
  return http.createServer((req, res) => {
    const value = routes.get(req.url.split("?")[0]);
    if (!value) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": value.type || "text/html; charset=utf-8", ...(value.headers || {}) }); res.end(value.text);
  });
}
before(async () => {
  const baseline = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await baseline.newPage();
    await page.setContent('<p id=reference style="font-family:PingFang UI SC">中文</p><p id=western style="font-family:SF Pro Text">ABC</p>');
    chineseReference = await fonts(page, "#reference");
    westernReference = await fonts(page, "#western");
  } finally { await baseline.close(); }
  crossServer = serve(crossRoutes); await new Promise(resolve => crossServer.listen(0, "127.0.0.1", resolve)); crossOrigin = `http://127.0.0.1:${crossServer.address().port}`;
  server = serve(routes); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "punctuation-mv3-"));
  context = await chromium.launchPersistentContext(profile, { executablePath, headless: true, args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  extensionId = worker.url().split("/")[2];
  await worker.evaluate(async () => { await chrome.storage.local.set({ settings: { enabled: true, font: "Courier New", cjkMode: "off", groups: ["quotes", "ellipsis", "dashes", "dots", "references"] } }); });
});
after(async () => { await context?.close(); await Promise.all([server && new Promise(r => server.close(r)), crossServer && new Promise(r => crossServer.close(r))]); });
async function pageFor(name, text, headers) {
  routes.set("/" + name, { text, headers });
  const page = await context.newPage(); pages.push(page);
  page.on("pageerror", error => errors.push(name + ": " + error.message));
  await page.goto(origin + "/" + name);
  return page;
}
async function configured(page) {
  await page.waitForFunction(() => [...document.fonts].some(x => x.family.includes("Shared Punctuation Font")));
  await page.evaluate(() => document.fonts.ready);
}
async function fonts(page, selector) {
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
  const doc = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  let { nodeId } = await cdp.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector });
  if (!nodeId && /^#[\w-]+$/.test(selector)) {
    function find(node) {
      const attrs = node.attributes || [];
      if (attrs.some((x, i) => x === "id" && attrs[i + 1] === selector.slice(1))) return node.nodeId;
      for (const child of [...(node.children || []), ...(node.shadowRoots || []), ...(node.contentDocument ? [node.contentDocument] : [])]) { const found = find(child); if (found) return found; }
    }
    nodeId = find(doc.root);
  }
  const result = (await cdp.send("CSS.getPlatformFontsForNode", { nodeId })).fonts.map(x => ({ family: x.familyName, glyphs: x.glyphCount }));
  await cdp.detach();
  return result.sort((a, b) => a.family.localeCompare(b.family));
}
async function splitFonts(page, selector, body, glyphs = 2) {
  assert.deepEqual(await fonts(page, selector), [{ family: body, glyphs: 3 }, { family: "Courier New", glyphs }].sort((a, b) => a.family.localeCompare(b.family)));
}
test("真实 MV3 字体处理不等待默认字体查询，首屏字体立即预加载且控件补充不重建", async () => {
  const worker = context.serviceWorkers()[0];
  await worker.evaluate(() => {
    fontCache.clear();
    globalThis.originalGetFont = chrome.fontSettings.getFont;
    globalThis.defaultFontFinished = false;
    chrome.fontSettings.getFont = (details, callback) => {
      setTimeout(() => originalGetFont(details, value => { defaultFontFinished = true; callback(value); }), 1200);
    };
  });
  try {
    const page = await pageFor("early-font", '<style>#t{font-family:Arial}</style><p id=t>ABC“”</p>');
    await configured(page);
    assert.equal(await worker.evaluate(() => defaultFontFinished), false);
    await splitFonts(page, "#t", "Arial");
    const face = await page.evaluate(() => { window.startupFace = [...document.fonts][0]; return startupFace.status; });
    assert.equal(face, "loaded");
    await page.waitForFunction(() => getComputedStyle(document.documentElement).fontFamily.includes("Shared Punctuation Font"));
    assert.equal(await page.evaluate(() => [...document.fonts][0] === startupFace), true);
  } finally { await worker.evaluate(() => { chrome.fontSettings.getFont = originalGetFont; }); }
});
test("真实 MV3 分别保留 Arial 与 Times New Roman 正文，只替换弯引号", async () => {
  const page = await pageFor("families", '<style>#a{font-family:Arial;font-size:32px;line-height:1.5}#b{font-family:"Times New Roman"}</style><p id=a>ABC“”</p><p id=b>ABC“”</p>');
  await configured(page);
  await splitFonts(page, "#a", "Arial"); await splitFonts(page, "#b", "Times New Roman");
  assert.deepEqual(await page.locator("#a").evaluate(x => ({ text: x.textContent, size: getComputedStyle(x).fontSize, height: getComputedStyle(x).lineHeight })), { text: "ABC“”", size: "32px", height: "48px" });
});
test("纯 CSS 悬停、聚焦、勾选与媒体条件沿用原规则，状态变化不改写样式", async () => {
  const page = await pageFor("states", '<style>#t{font-family:Arial}#t:hover,#t:focus{font-family:"Times New Roman"}#c:checked + #t{font-family:Verdana}@media(max-width:600px){#t{font-family:Georgia}}</style><input id=c type=checkbox><button id=t>ABC“”</button>');
  await configured(page); await splitFonts(page, "#t", "Arial");
  const writes = await page.evaluate(() => { window.styleMutations = 0; new MutationObserver(r => window.styleMutations += r.length).observe(document, { subtree: true, attributes: true, attributeFilter: ["style"] }); return window.styleMutations; });
  await page.locator("#t").hover(); await splitFonts(page, "#t", "Times New Roman");
  await page.mouse.move(0, 0); await page.locator("#t").focus(); await splitFonts(page, "#t", "Times New Roman");
  await page.locator("#c").check(); await splitFonts(page, "#t", "Verdana");
  await page.setViewportSize({ width: 500, height: 700 }); await page.locator("#c").uncheck(); await page.locator("#t").evaluate(x => x.blur()); await page.mouse.move(0, 0);
  await splitFonts(page, "#t", "Georgia");
  assert.equal(await page.evaluate(() => window.styleMutations), writes);
});
test("font 简写、变量字体列表、内联优先级与新增元素正确保留正文", async () => {
  const page = await pageFor("inline", '<style>:root{--body-font:Arial}#a{font:italic 32px/2 Arial}#b{font-family:var(--body-font)}</style><div id=a>ABC“”</div><div id=b>ABC“”</div><div id=c style="font-family:Times New Roman!important">ABC“”</div>');
  await configured(page);
  assert.ok((await fonts(page, "#a")).some(x => x.family === "Arial"));
  await splitFonts(page, "#b", "Arial"); await splitFonts(page, "#c", "Times New Roman");
  assert.equal(await page.locator("#c").evaluate(x => x.style.getPropertyPriority("font-family")), "important");
  await page.evaluate(() => document.documentElement.style.setProperty("--body-font", "Verdana")); await splitFonts(page, "#b", "Verdana");
  await page.evaluate(() => { const x = document.createElement("p"); x.id = "new"; x.style.fontFamily = "Georgia"; x.textContent = "ABC“”"; document.body.append(x); });
  await page.waitForFunction(() => document.getElementById("new").style.fontFamily.startsWith('"Shared Punctuation Font"'));
  await splitFonts(page, "#new", "Georgia");
});
test("CSSOM 字体写入、插入、替换与样式文本更新重新前置且不累积", async () => {
  const page = await pageFor("cssom", '<style id=sheet>#t{font-family:Arial}</style><p id=t>ABC“”</p>');
  await configured(page);
  for (const update of [
    'document.getElementById("sheet").sheet.cssRules[0].style.fontFamily="Times New Roman"',
    'document.getElementById("sheet").sheet.cssRules[0].style.setProperty("font-family","Times New Roman")',
    'document.getElementById("sheet").sheet.cssRules[0].style.cssText="font-family:Times New Roman;color:blue"',
    'document.getElementById("sheet").textContent="#t{font-family:Times New Roman}"',
    'document.getElementById("sheet").sheet.insertRule("#t{font-family:Times New Roman}",document.getElementById("sheet").sheet.cssRules.length)'
  ]) {
    await page.evaluate(update);
    await page.waitForFunction(() => getComputedStyle(document.getElementById("t")).fontFamily.includes("Shared Punctuation Font"));
    await splitFonts(page, "#t", "Times New Roman");
  }
  assert.equal(await page.locator("#t").evaluate(x => getComputedStyle(x).fontFamily.split("Shared Punctuation Font").length - 1), 1);
});
test("跨域样式表与带条件的导入在原位置替换，正文级联顺序保留", async () => {
  crossRoutes.set("/import.css", { type: "text/css", text: '#b{font-family:"Times New Roman"}#b::before{content:""}' });
  crossRoutes.set("/outer.css", { type: "text/css", text: '@import url("./import.css") layer(imported) supports(display:grid) screen; #a{font-family:Arial} #image{background-image:url("./image.svg")}' });
  crossRoutes.set("/image.svg", { type: "image/svg+xml", text: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
  const page = await pageFor("cross", `<style>#a{font-family:Georgia}</style><link rel=stylesheet href="${crossOrigin}/outer.css"><style>#c{font-family:Verdana}</style><p id=a>ABC“”</p><p id=b>ABC“”</p><p id=c>ABC“”</p><div id=image></div>`);
  await configured(page);
  await page.waitForFunction(() => document.querySelector('style[data-spf="stylesheet"]')?.sheet?.cssRules.length > 0);
  await splitFonts(page, "#a", "Arial"); await splitFonts(page, "#b", "Times New Roman"); await splitFonts(page, "#c", "Verdana");
  assert.ok((await page.locator("#image").evaluate(x => getComputedStyle(x).backgroundImage)).includes(crossOrigin + "/image.svg"));
});
test("严格 CSP 下的样式表及专用字体可用", async () => {
  routes.set("/csp.css", { type: "text/css", text: '#t{font-family:Arial}' });
  const page = await pageFor("csp", '<link rel=stylesheet href="/csp.css"><p id=t>ABC“”</p>', { "content-security-policy": "default-src 'self'; style-src 'self'; font-src 'self'; script-src 'none'" });
  await configured(page); await splitFonts(page, "#t", "Arial");
});
test("Shadow DOM、adopted stylesheets 与子框架各自注入", async () => {
  routes.set("/frame", { text: '<style>#t{font-family:Arial}</style><p id=t>ABC“”</p>' });
  const page = await pageFor("shadow", '<div id=host></div><iframe src=/frame></iframe>'); await configured(page);
  await page.evaluate(() => {
    const shadow = document.getElementById("host").attachShadow({ mode: "open" });
    const style = new CSSStyleSheet(); style.replaceSync('p{font-family:Arial}'); shadow.adoptedStyleSheets = [style];
    const p = document.createElement("p"); p.id = "inside"; p.textContent = "ABC“”"; shadow.append(p);
  });
  await page.waitForFunction(() => getComputedStyle(document.getElementById("host").shadowRoot.getElementById("inside")).fontFamily.includes("Shared Punctuation Font"));
  assert.ok(await page.evaluate(() => [...document.fonts].some(x => x.family.includes("Shared Punctuation Font"))));
  await splitFonts(page, "#inside", "Arial");
  const frame = page.frames().find(x => x.url().endsWith("/frame"));
  await frame.waitForFunction(() => getComputedStyle(document.getElementById("t")).fontFamily.includes("Shared Punctuation Font"));
  await page.evaluate(async () => { const s = document.getElementById("host").shadowRoot.adoptedStyleSheets[0]; await s.replace('p{font-family:"Times New Roman"}'); });
  assert.ok((await page.locator("#host").evaluate(x => getComputedStyle(x.shadowRoot.getElementById("inside")).fontFamily)).includes("Times New Roman"));
  await splitFonts(page, "#inside", "Times New Roman");
});
test("输入、选择和长文本更新不读取计算字体或改写目标样式", async () => {
  const page = await pageFor("interaction", '<style>textarea,p{font-family:Arial}</style><textarea id=input>ABC“”</textarea><p id=t>ABC“”</p>'); await configured(page);
  await page.evaluate(() => {
    window.computedCalls = 0; window.attributeWrites = 0;
    const native = window.getComputedStyle; window.getComputedStyle = function (...a) { window.computedCalls++; return native.apply(this, a); };
    new MutationObserver(r => window.attributeWrites += r.length).observe(document, { subtree: true, attributes: true, attributeFilter: ["style"] });
  });
  await page.locator("#input").fill('输入“标点” ABC ' + "text ".repeat(5000));
  await page.locator("#input").evaluate(x => x.setSelectionRange(0, 100));
  await page.locator("#t").evaluate(x => { for (let i = 0; i < 100; i++) x.textContent = "ABC“”" + "正文".repeat(10000); });
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => ({ reads: window.computedCalls, writes: window.attributeWrites })), { reads: 0, writes: 0 });
});
test("正文名单原位替换，Song/SimHei 保留，未命中在最后追加苹方 UI", async () => {
  const worker = context.serviceWorkers()[0];
  await worker.evaluate(async () => { const { settings } = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings: { ...settings, cjkMode: "replace", cjkFont: "PingFang UI SC" } }); });
  const page = await pageFor("body-names", '<style>#a{font-family:Arial,"HarmonyOS Sans SC",sans-serif}#b{font-family:SimSun,serif}#c{font-family:SimHei,sans-serif}#d{font-family:"Microsoft YaHei",Arial}#e{font-family:"HarmonyOS Sans",Arial}#f{font-family:"HarmonyOS_Sans",Arial}#g{font-family:"PingFang TC","PingFang HK","Microsoft JhengHei","Noto Sans TC","Source Han Sans TW",Arial}</style><p id=a>ABC“”</p><p id=b>中文 ABC</p><p id=c>ABC“”</p><p id=d>中文</p><p id=e>ABC“”</p><p id=f>ABC“”</p><p id=g>ABC“”</p>');
  await configured(page);
  const names = await page.evaluate(() => [...document.styleSheets].flatMap(x => [...x.cssRules]).filter(x => x.selectorText?.startsWith("#")).map(x => x.style.fontFamily));
  assert.equal(names[0], '"Shared Punctuation Font", Arial, "SF Pro Text", "PingFang UI SC", "PingFang SC", "SF Pro Text", "PingFang UI SC", "PingFang SC"');
  assert.equal(names[1], '"Shared Punctuation Font", SimSun, serif');
  assert.equal(names[2], '"Shared Punctuation Font", SimHei, "SF Pro Text", "PingFang UI SC", "PingFang SC"');
  assert.equal(names[3], '"Shared Punctuation Font", "SF Pro Text", "PingFang UI SC", "PingFang SC", Arial');
  assert.equal(names[4], '"Shared Punctuation Font", "HarmonyOS Sans", Arial, "SF Pro Text", "PingFang UI SC", "PingFang SC"');
  assert.equal(names[5], '"Shared Punctuation Font", HarmonyOS_Sans, Arial, "SF Pro Text", "PingFang UI SC", "PingFang SC"');
  assert.equal(names[6], '"Shared Punctuation Font", "PingFang TC", "PingFang HK", "Microsoft JhengHei", "Noto Sans TC", "Source Han Sans TW", Arial, "SF Pro Text", "PingFang UI SC", "PingFang SC"');
  await splitFonts(page, "#a", "Arial");
  assert.deepEqual(await fonts(page, "#d"), chineseReference);
  await page.locator("#d").evaluate(x => { x.textContent = "ABC中文"; });
  assert.deepEqual(await fonts(page, "#d"), [...westernReference, ...chineseReference].sort((a, b) => a.family.localeCompare(b.family)));
  assert.ok((await fonts(page, "#b")).some(x => x.family === "SimSun"));
});
test("常见 CSS 模板的简中字体栈原位替换，西文与通用字体保留顺序", async () => {
  const page = await pageFor("template-stacks", '<style>#a{font-family:"Helvetica Neue",Helvetica,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","微软雅黑",Arial,sans-serif}#b{font-family:"PingFang SC","Noto Sans CJK SC","Noto Sans SC","Source Han Sans SC","Microsoft YaHei UI","Microsoft YaHei","Hiragino Sans GB","WenQuanYi Micro Hei",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}</style><p id=a>ABC“”</p><p id=b>中文</p>');
  await configured(page);
  const names = await page.evaluate(() => [...document.styleSheets[0].cssRules].map(x => x.style.fontFamily));
  assert.equal(names[0], '"Shared Punctuation Font", "Helvetica Neue", Helvetica, ' + Array(4).fill('"SF Pro Text", "PingFang UI SC", "PingFang SC"').join(", ") + ', Arial, "SF Pro Text", "PingFang UI SC", "PingFang SC"');
  assert.equal(names[1], '"Shared Punctuation Font", ' + Array(10).fill('"SF Pro Text", "PingFang UI SC", "PingFang SC"').join(", ") + ', "Segoe UI", "SF Pro Text", "PingFang UI SC", "PingFang SC"');
  assert.deepEqual(await fonts(page, "#b"), chineseReference);
});
test("系统字体与 Apple 文本系列使用 SF Pro Text 和苹方 UI，变量切换保留宋体", async () => {
  const source = await fs.readFile(path.join(root, "shared.js"), "utf8");
  const scope = require("node:vm").createContext({ URL });
  require("node:vm").runInContext(source, scope);
  const names = [...scope.SPF.SYSTEM_FONTS];
  const css = names.map((name, i) => `#f${i}{font-family:${name};font-size:28px}`).join("");
  const page = await pageFor("system-fonts", `<style>${css}:root{--body:SimSun}#v{font-family:var(--body),sans-serif}</style>${names.map((_, i) => `<p id=f${i}>ABC中文“”</p>`).join("")}<p id=v>中文“”</p>`);
  await configured(page);
  const declarations = await page.evaluate(() => [...document.styleSheets[0].cssRules].slice(0, 24).map(x => ({ family: x.style.fontFamily, size: x.style.fontSize })));
  for (const declaration of declarations) assert.deepEqual(declaration, { family: '"Shared Punctuation Font", "SF Pro Text", "PingFang UI SC", "PingFang SC"', size: "28px" });
  assert.deepEqual(await fonts(page, "#f0"), [...westernReference, ...chineseReference, { family: "Courier New", glyphs: 2 }].sort((a, b) => a.family.localeCompare(b.family)));
  const variableFamily = () => page.locator("#v").evaluate(x => getComputedStyle(x).fontFamily);
  await page.waitForFunction(() => !getComputedStyle(document.getElementById("v")).fontFamily.includes("PingFang UI SC"));
  assert.ok((await variableFamily()).includes("sans-serif"));
  await page.evaluate(() => document.documentElement.style.setProperty("--body", "Arial"));
  await page.waitForFunction(() => getComputedStyle(document.getElementById("v")).fontFamily.includes("PingFang UI SC"));
  await page.evaluate(() => document.documentElement.style.setProperty("--body", "KaiTi"));
  await page.waitForFunction(() => !getComputedStyle(document.getElementById("v")).fontFamily.includes("PingFang UI SC"));
});
test("宋体、楷体及仿宋跳过追加，CSSOM 与多层字体变量切换同步更新", async () => {
  const page = await pageFor("non-sans", '<style>:root{--serif:SimSun;--chain:var(--serif);--loop-a:var(--loop-b);--loop-b:var(--loop-a,SimSun)}#a{font-family:Arial,SimSun,serif}#b{font-family:KaiTi,serif}#v{font-family:var(--chain),serif}#loop{font-family:var(--loop-a),serif}#mixed{font-family:Arial,"Microsoft YaHei",SimSun}</style><p id=a>中文“”</p><p id=b>中文“”</p><p id=v>中文“”</p><p id=loop>中文</p><p id=mixed>中文</p><p id=inline style="font-family:FangSong,serif!important">中文“”</p>');
  await configured(page);
  await page.waitForFunction(() => !document.styleSheets[0].cssRules[3].style.fontFamily.includes("PingFang UI SC"));
  const names = await page.evaluate(() => Object.fromEntries([...document.styleSheets[0].cssRules].filter(x => x.selectorText?.startsWith("#")).map(x => [x.selectorText, x.style.fontFamily])));
  assert.equal(names["#a"], '"Shared Punctuation Font", Arial, SimSun, serif');
  assert.equal(names["#b"], '"Shared Punctuation Font", KaiTi, serif');
  assert.equal(names["#v"], '"Shared Punctuation Font", var(--chain),serif');
  assert.equal(names["#loop"], '"Shared Punctuation Font", var(--loop-a),serif');
  assert.equal(names["#mixed"], '"Shared Punctuation Font", Arial, "SF Pro Text", "PingFang UI SC", "PingFang SC", SimSun');
  assert.equal(await page.locator("#inline").evaluate(x => x.style.fontFamily), '"Shared Punctuation Font", FangSong, serif');
  assert.equal(await page.locator("#inline").evaluate(x => x.style.getPropertyPriority("font-family")), "important");
  assert.deepEqual(await fonts(page, "#a"), [{ family: "Courier New", glyphs: 2 }, { family: "SimSun", glyphs: 2 }]);
  await page.evaluate(() => document.getElementById("inline").style.setProperty("font-family", "Arial, sans-serif", "important"));
  assert.equal(await page.locator("#inline").evaluate(x => x.style.fontFamily), '"Shared Punctuation Font", Arial, "SF Pro Text", "PingFang UI SC", "PingFang SC"');
  await page.evaluate(() => document.getElementById("inline").style.setProperty("font-family", "KaiTi, serif", "important"));
  assert.equal(await page.locator("#inline").evaluate(x => x.style.fontFamily), '"Shared Punctuation Font", KaiTi, serif');
  for (const [font, appended] of [["Arial", true], ["KaiTi", false], ['"Microsoft YaHei"', true], ["SimSun", false]]) {
    await page.evaluate(value => document.documentElement.style.setProperty("--serif", value), font);
    await page.waitForFunction(expected => document.styleSheets[0].cssRules[3].style.fontFamily.includes("PingFang UI SC") === expected, appended);
  }
  assert.deepEqual(await fonts(page, "#v"), [{ family: "Courier New", glyphs: 2 }, { family: "SimSun", glyphs: 2 }]);
});
test("仅开启中文正文功能时，变量追加与撤回可反复切换", async () => {
  const worker = context.serviceWorkers()[0];
  const saved = await worker.evaluate(async () => { const { settings } = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings: { ...settings, groups: [] } }); return settings; });
  try {
    const page = await pageFor("non-sans-only", '<style>:root{--body:SimSun}#t{font-family:var(--body),serif}</style><p id=t>中文</p>');
    await page.waitForFunction(() => document.styleSheets[0].cssRules[1].style.fontFamily === "var(--body),serif");
    for (const [font, appended] of [["Arial", true], ["SimSun", false], ["Arial", true], ["FangSong", false]]) {
      await page.evaluate(value => document.documentElement.style.setProperty("--body", value), font);
      await page.waitForFunction(expected => document.styleSheets[0].cssRules[1].style.fontFamily.includes("PingFang UI SC") === expected, appended);
    }
    assert.equal(await page.evaluate(() => [...document.fonts].length), 0);
  } finally { await worker.evaluate(settings => chrome.storage.local.set({ settings }), saved); }
});
test("中文与转义字体变量的多层依赖更新，布局变量保持原值，关闭后还原", async () => {
  const page = await pageFor("body-variables", '<style>:root{--字体: "Microsoft YaHei";--chain:var(--字体);--布局:"Microsoft YaHei"}#a{font-family:Arial,var(--chain),sans-serif}#b{font-family:var(--字体)}</style><p id=a>ABC“”</p><p id=b>中文</p>');
  await configured(page);
  await page.waitForFunction(() => document.styleSheets[0].cssRules[0].style.getPropertyValue("--字体").includes("PingFang UI SC"));
  assert.equal(await page.evaluate(() => document.styleSheets[0].cssRules[0].style.getPropertyValue("--布局")), '"Microsoft YaHei"');
  await splitFonts(page, "#a", "Arial");
  assert.deepEqual(await fonts(page, "#b"), chineseReference);
  await page.evaluate(() => document.documentElement.style.setProperty("--字体", '"HarmonyOS_Sans_SC"'));
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--字体").includes("PingFang UI SC"));
  const worker = context.serviceWorkers()[0];
  await worker.evaluate(async () => { const { settings } = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings: { ...settings, cjkMode: "off" } }); });
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--字体").includes("HarmonyOS_Sans_SC"));
  assert.equal(await page.evaluate(() => document.styleSheets[0].cssRules[0].style.getPropertyValue("--字体")), '"Microsoft YaHei"');
  assert.equal(await page.evaluate(() => document.styleSheets[0].cssRules[1].style.fontFamily), '"Shared Punctuation Font", Arial,var(--chain),sans-serif');
});
test("设置保存、字符组选项、本站关闭及全局关闭完整恢复网站声明", async () => {
  const page = await context.newPage(); pages.push(page); await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForFunction(() => document.getElementById("status").textContent === "已保存");
  assert.equal(await page.locator("select").count(), 0);
  await page.locator("#font").fill("Courier New"); await page.locator('[data-group="references"]').uncheck(); await page.locator("#extra").fill("※");
  await page.getByRole("button", { name: "保存设置" }).click();
  await page.waitForFunction(() => document.getElementById("status").textContent === "已保存");
  const target = pages.find(page => page.url().endsWith("/families"));
  await page.locator("#add-rule").click(); await page.locator(".domain").fill("127.0.0.1:" + server.address().port); await page.locator('[data-action="off"]').check();
  await page.getByRole("button", { name: "保存设置" }).click();
  await target.waitForFunction(() => ![...document.fonts].some(x => x.family.includes("Shared Punctuation Font")));
  assert.deepEqual(await fonts(target, "#a"), [{ family: "Arial", glyphs: 5 }]);
  const cross = pages.find(x => x.url().endsWith("/cross"));
  assert.equal(await cross.locator("link").evaluate(x => x.sheet.disabled), false);
  await page.locator(".remove").click(); await page.locator("#enabled").uncheck(); await page.getByRole("button", { name: "保存设置" }).click();
  await target.waitForFunction(() => ![...document.fonts].some(x => x.family.includes("Shared Punctuation Font")));
  await page.locator("#enabled").check(); await page.getByRole("button", { name: "保存设置" }).click();
  await configured(target); await splitFonts(target, "#a", "Arial");
});
test("页面没有扩展运行错误", () => { assert.deepEqual(errors, []); });
