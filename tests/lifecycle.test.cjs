const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
let context, worker, server, crossServer, origin, crossOrigin;
const routes = new Map();
const crossRoutes = new Map();
const errors = [];
const defaultSettings = { enabled: true, font: "Courier New", cjkMode: "replace" };
before(async () => {
  crossServer = http.createServer((req, res) => {
    const value = crossRoutes.get(req.url);
    res.writeHead(200, { "content-type": value?.type || "text/css" });
    res.end(value?.bytes || value || "#t{font-family:Verdana;color:red}");
  });
  await new Promise(resolve => crossServer.listen(0, "127.0.0.1", resolve));
  crossOrigin = `http://127.0.0.1:${crossServer.address().port}`;
  server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": req.url.endsWith(".css") ? "text/css" : "text/html; charset=utf-8" });
    res.end(routes.get(req.url) || "");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "punctuation-lifecycle-"));
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  context.setDefaultTimeout(5000);
  worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await worker.evaluate(settings => chrome.storage.local.set({ settings }), defaultSettings);
});
after(async () => {
  await context?.close();
  await new Promise(resolve => server?.close(resolve));
  await new Promise(resolve => crossServer?.close(resolve));
});
beforeEach(async () => { await settings(defaultSettings); });
async function pageFor(name, text) {
  routes.set("/" + name, text);
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(name + ": " + error.message));
  await page.goto(origin + "/" + name);
  await page.waitForFunction(() => [...document.fonts].some(face => face.family.includes("Shared Punctuation Font")));
  return page;
}
async function settings(value) { await worker.evaluate(settings => chrome.storage.local.set({ settings }), value); }

test("移除样式资源时还原已有 CSSOM 对象，挂回及关闭后仍保留网站声明", async () => {
  const page = await pageFor("sheet", '<style id=s>:root{--正文:"Microsoft YaHei"}#t{font-family:var(--正文)}</style><p id=t>ABC“”</p>');
  await page.waitForFunction(() => document.getElementById("s").sheet.cssRules[0].style.getPropertyValue("--正文").includes("PingFang UI SC"));
  await page.evaluate(() => { window.resource = document.getElementById("s"); window.originalSheet = resource.sheet; resource.remove(); });
  await page.waitForFunction(() => originalSheet.cssRules[1].style.fontFamily === "var(--正文)");
  assert.equal(await page.evaluate(() => originalSheet.cssRules[0].style.getPropertyValue("--正文")), '"Microsoft YaHei"');
  await page.evaluate(() => document.head.append(resource));
  await page.waitForFunction(() => getComputedStyle(document.getElementById("t")).fontFamily.includes("Shared Punctuation Font"));
  await settings({ ...defaultSettings, enabled: false });
  await page.waitForFunction(() => ![...document.fonts].some(face => face.family.includes("Shared Punctuation Font")));
  assert.equal(await page.evaluate(() => resource.sheet.cssRules[1].style.fontFamily), "var(--正文)");
  await settings(defaultSettings);
});

test("Shadow DOM 宿主挂回后恢复观察，闭合影子根的动态资源与内联声明继续处理", async () => {
  const page = await pageFor("shadow", '<div id=host></div>');
  await page.evaluate(() => {
    window.host = document.getElementById("host");
    window.shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = '<style id=s>p{font-family:Arial}</style><p id=t>ABC“”</p><p id=i style="font-family:Arial">ABC“”</p>';
  });
  await page.waitForFunction(() => shadow.getElementById("i").style.fontFamily.includes("Shared Punctuation Font"));
  await page.evaluate(() => host.remove());
  await page.waitForFunction(() => shadow.getElementById("i").style.fontFamily === "Arial");
  await page.evaluate(() => document.body.append(host));
  await page.waitForFunction(() => shadow.getElementById("i").style.fontFamily.includes("Shared Punctuation Font"));
  await page.evaluate(() => {
    shadow.getElementById("s").textContent = "p{font-family:Verdana}";
    shadow.getElementById("i").setAttribute("style", "font-family:Georgia!important");
  });
  await page.waitForFunction(() => getComputedStyle(shadow.getElementById("t")).fontFamily.includes("Shared Punctuation Font") && shadow.getElementById("i").style.fontFamily.includes("Shared Punctuation Font"));
  assert.ok((await page.evaluate(() => getComputedStyle(shadow.getElementById("t")).fontFamily)).includes("Verdana"));
  await settings({ ...defaultSettings, enabled: false });
  await page.waitForFunction(() => shadow.getElementById("i").style.fontFamily === "Georgia");
  assert.equal(await page.evaluate(() => shadow.getElementById("i").style.getPropertyPriority("font-family")), "important");
  await settings(defaultSettings);
});

test("网站只改变已改写声明的优先级时，关闭后保留新的 important", async () => {
  const page = await pageFor("priority", '<style>:root{--正文:"Microsoft YaHei"}</style><p id=t style="font-family:Arial">ABC“”</p><p style="font-family:var(--正文)">中文</p>');
  await page.waitForFunction(() => document.styleSheets[0].cssRules[0].style.getPropertyValue("--正文").includes("PingFang UI SC"));
  await page.evaluate(() => {
    const family = document.getElementById("t").style;
    family.setProperty("font-family", family.getPropertyValue("font-family"), "important");
    const source = document.styleSheets[0].cssRules[0].style;
    source.setProperty("--正文", source.getPropertyValue("--正文"), "important");
  });
  await settings({ ...defaultSettings, enabled: false });
  await page.waitForFunction(() => document.getElementById("t").style.fontFamily === "Arial");
  assert.equal(await page.evaluate(() => document.getElementById("t").style.getPropertyPriority("font-family")), "important");
  assert.equal(await page.evaluate(() => document.styleSheets[0].cssRules[0].style.getPropertyPriority("--正文")), "important");
  await settings(defaultSettings);
});

test("字体变量的多层回退原位替换正文黑体，宋体回退继续阻止追加", async () => {
  const page = await pageFor("fallback", '<style>#a{font-family:var(--missing,"Microsoft YaHei"),Arial}#b{font-family:var(--missing,var(--next,"HarmonyOS Sans SC")),Arial}#c{font-family:var(--missing,SimSun),sans-serif}</style><p id=a>中文</p><p id=b>中文</p><p id=c>中文</p>');
  await page.waitForFunction(() => document.styleSheets[0].cssRules[0].style.fontFamily.includes("Shared Punctuation Font"));
  const names = await page.evaluate(() => [...document.styleSheets[0].cssRules].map(rule => rule.style.fontFamily));
  assert.equal(names[0], '"Shared Punctuation Font", var(--missing,"SF Pro Text", "PingFang UI SC"),Arial');
  assert.equal(names[1], '"Shared Punctuation Font", var(--missing,var(--next,"SF Pro Text", "PingFang UI SC")),Arial');
  assert.equal(names[2], '"Shared Punctuation Font", var(--missing,SimSun),sans-serif');
  assert.equal(await page.locator("#a").evaluate(node => getComputedStyle(node).fontFamily), '"Shared Punctuation Font", "SF Pro Text", "PingFang UI SC", Arial');
});

test("空存储值恢复默认配置，不中断内容脚本", async () => {
  await settings(null);
  const page = await context.newPage();
  routes.set("/empty", '<style>p{font-family:Arial}</style><p id=t>ABC“”</p>');
  page.on("pageerror", error => errors.push("empty: " + error.message));
  await page.goto(origin + "/empty");
  await page.waitForFunction(() => document.styleSheets[0].cssRules[0].style.fontFamily.includes("Shared Punctuation Font"));
  await settings(defaultSettings);
});
test("跨域副本跟随原样式表的 CSSOM 禁用状态和媒体条件，关闭后保留最终状态", async () => {
  const page = await pageFor("opaque-state", `<link id=l rel=stylesheet href="${crossOrigin}/s.css"><p id=t>ABC“”</p>`);
  await page.waitForFunction(() => document.querySelector('style[data-spf="stylesheet"]')?.sheet?.cssRules.length);
  assert.equal(await page.locator("#l").evaluate(node => node.sheet.disabled), false);
  await page.evaluate(() => { document.getElementById("l").sheet.disabled = true; });
  await page.waitForFunction(() => getComputedStyle(document.getElementById("t")).color !== "rgb(255, 0, 0)");
  await page.evaluate(() => { document.getElementById("l").sheet.disabled = false; });
  await page.waitForFunction(() => getComputedStyle(document.getElementById("t")).color === "rgb(255, 0, 0)");
  await page.evaluate(() => { document.getElementById("l").sheet.media.mediaText = "not all"; });
  await page.waitForFunction(() => getComputedStyle(document.getElementById("t")).color !== "rgb(255, 0, 0)");
  await page.evaluate(() => { document.getElementById("l").sheet.media.deleteMedium("not all"); });
  await page.waitForFunction(() => getComputedStyle(document.getElementById("t")).color === "rgb(255, 0, 0)");
  await page.evaluate(() => { document.getElementById("l").sheet.media.appendMedium("not all"); });
  await page.waitForFunction(() => getComputedStyle(document.getElementById("t")).color !== "rgb(255, 0, 0)");
  await settings({ ...defaultSettings, enabled: false });
  await page.waitForFunction(() => !document.querySelector('style[data-spf="stylesheet"]'));
  assert.equal(await page.locator("#l").evaluate(node => node.sheet.disabled), false);
  assert.equal(await page.locator("#l").evaluate(node => node.sheet.media.mediaText), "not all");
});
test("分组规则中插入字体声明后立即处理，移除变量规则同步重建字体依赖", async () => {
  const page = await pageFor("groups", '<style id=s>@media all { :root{--正文:SimSun} #t{font-family:var(--正文,Arial),sans-serif} }</style><p id=t>ABC中文“”</p>');
  await page.waitForFunction(() => !document.styleSheets[0].cssRules[0].cssRules[1].style.fontFamily.includes("PingFang UI SC"));
  await page.evaluate(() => document.getElementById("s").sheet.cssRules[0].deleteRule(0));
  await page.waitForFunction(() => document.styleSheets[0].cssRules[0].cssRules[0].style.fontFamily.includes("PingFang UI SC"));
  await page.evaluate(() => document.getElementById("s").sheet.cssRules[0].insertRule("#t{font-family:Verdana}", 1));
  await page.waitForFunction(() => getComputedStyle(document.getElementById("t")).fontFamily.includes("Shared Punctuation Font") && getComputedStyle(document.getElementById("t")).fontFamily.includes("Verdana"));
});
test("同源导入表移除后还原子表，变量依赖不残留", async () => {
  routes.set("/imported.css", ':root{--正文:SimSun}#imported{font-family:Arial}');
  const page = await pageFor("import-lifecycle", '<style id=s>@import url("/imported.css");</style><style>#t{font-family:var(--正文,Arial),sans-serif}</style><p id=t>ABC中文“”</p><p id=imported>ABC“”</p>');
  await page.waitForFunction(() => document.getElementById("s").sheet.cssRules[0].styleSheet.cssRules[1].style.fontFamily.includes("Shared Punctuation Font"));
  await page.waitForFunction(() => !document.styleSheets[1].cssRules[0].style.fontFamily.includes("PingFang UI SC"));
  await page.evaluate(() => {
    window.childSheet = document.getElementById("s").sheet.cssRules[0].styleSheet;
    document.getElementById("s").sheet.deleteRule(0);
  });
  await page.waitForFunction(() => getComputedStyle(document.getElementById("t")).fontFamily.includes("PingFang UI SC"));
  assert.equal(await page.evaluate(() => childSheet.cssRules[1].style.fontFamily), "Arial");
});
test("跨域导入及资源 URL 的 CSS 转义保持来源地址和导入条件", async () => {
  crossRoutes.set("/escaped.css", String.raw`@\69mport u\72l("./child.css") la\79 er(imported) s\75 pports(display:grid) screen;#image{background-image:u\72l("./image.svg")}`);
  crossRoutes.set("/child.css", "#t{font-family:Verdana;color:blue}");
  const page = await pageFor("escaped-url", `<link rel=stylesheet href="${crossOrigin}/escaped.css"><p id=t>ABC“”</p><div id=image></div>`);
  await page.waitForFunction(() => document.querySelector('style[data-spf="stylesheet"]')?.sheet?.cssRules.length);
  await page.waitForFunction(() => getComputedStyle(document.getElementById("t")).fontFamily.includes("Shared Punctuation Font"));
  assert.equal(await page.locator("#t").evaluate(node => getComputedStyle(node).color), "rgb(0, 0, 255)");
  assert.ok((await page.locator("#image").evaluate(node => getComputedStyle(node).backgroundImage)).includes(crossOrigin + "/image.svg"));
});
test("转义的命名空间声明继续保留原跨域样式表", async () => {
  crossRoutes.set("/namespace.css", String.raw`@n\61mespace svg "http://www.w3.org/2000/svg";svg|text{font-family:Arial;color:red}`);
  const page = await pageFor("namespace", `<link id=l rel=stylesheet href="${crossOrigin}/namespace.css"><svg xmlns="http://www.w3.org/2000/svg"><text>ABC“”</text></svg>`);
  await page.waitForTimeout(100);
  assert.equal(await page.locator('style[data-spf="stylesheet"]').count(), 0);
  assert.equal(await page.locator("#l").evaluate(node => node.sheet.disabled), false);
});
test("跨域读取等待期间修改 CSSOM，副本采用网站最新开关及媒体条件", async () => {
  await worker.evaluate(() => {
    globalThis.nativeFetchForRace = fetch;
    globalThis.fetch = async (...args) => {
      if (String(args[0]).includes("/delayed.css")) await new Promise(resolve => setTimeout(resolve, 350));
      return nativeFetchForRace(...args);
    };
  });
  try {
    const page = await pageFor("opaque-race", `<link id=l rel=stylesheet href="${crossOrigin}/delayed.css"><p id=t>ABC“”</p>`);
    await page.evaluate(() => {
      const sheet = document.getElementById("l").sheet;
      sheet.disabled = true; sheet.media.mediaText = "not all";
    });
    await page.waitForFunction(() => document.querySelector('style[data-spf="stylesheet"]')?.sheet?.cssRules.length);
    assert.equal(await page.locator('style[data-spf="stylesheet"]').evaluate(node => node.sheet.disabled), true);
    assert.equal(await page.locator('style[data-spf="stylesheet"]').evaluate(node => node.media), "not all");
  } finally { await worker.evaluate(() => { globalThis.fetch = nativeFetchForRace; }); }
});
test("替换只有字体变量的构造样式表时，释放旧变量声明及依赖", async () => {
  const page = await pageFor("variable-sheet-replace", '<style>#t{font-family:var(--正文,Arial),sans-serif}</style><p id=t>ABC中文“”</p>');
  for (const method of ["replaceSync", "replace"]) {
    await page.evaluate(() => {
      window.variableSheet = new CSSStyleSheet(); variableSheet.replaceSync(":root{--正文:SimSun}");
      document.adoptedStyleSheets = [variableSheet];
    });
    await page.waitForFunction(() => !getComputedStyle(document.getElementById("t")).fontFamily.includes("PingFang UI SC"));
    await page.evaluate(async method => { await variableSheet[method](""); }, method);
    await page.waitForFunction(() => getComputedStyle(document.getElementById("t")).fontFamily.includes("PingFang UI SC"));
  }
});
test("动态关键帧的追加、替换和删除处理字体声明", async () => {
  const page = await pageFor("keyframes-cssom", '<style id=s>@keyframes fonts{}#t{font-family:Arial;animation:fonts 1s linear paused;animation-delay:-.5s}</style><p id=t>ABC“”</p>');
  await page.evaluate(() => {
    window.keys = document.getElementById("s").sheet.cssRules[0];
    keys.appendRule("0%{font-family:Verdana}"); keys.appendRule("100%{font-family:Verdana}");
  });
  await page.waitForFunction(() => [...keys.cssRules].every(rule => rule.style.fontFamily.includes("Shared Punctuation Font")));
  assert.ok((await page.locator("#t").evaluate(node => getComputedStyle(node).fontFamily)).includes("Shared Punctuation Font"));
  await page.evaluate(() => { window.oldKey = keys.findRule("100%"); keys.deleteRule("100%"); });
  assert.equal(await page.evaluate(() => oldKey.style.fontFamily), "Verdana");
});
test("CSSOM 属性名保留浏览器字符串转换语义", async () => {
  const page = await pageFor("cssom-coercion", '<p id=t style="font-family:Arial">ABC“”</p>');
  const state = await page.evaluate(() => {
    const style = document.getElementById("t").style;
    const errors = [];
    for (const name of [null, undefined, 0]) for (const method of ["setProperty", "removeProperty"]) {
      try { style[method](name, "Arial"); } catch (error) { errors.push(method + ":" + error.name); }
    }
    let conversions = 0;
    style.setProperty({ toString() { conversions++; return "font-family"; } }, "Verdana");
    return { errors, conversions, family: style.fontFamily };
  });
  assert.deepEqual(state.errors, []);
  assert.equal(state.conversions, 1);
  assert.ok(state.family.includes("Shared Punctuation Font") && state.family.includes("Verdana"));
});
test("无 referrer 的特殊来源框架按创建页端口执行站点规则", async () => {
  const page = await pageFor("origin-frames", '<meta name=referrer content=no-referrer><div id=frames></div>');
  const port = server.address().port;
  await settings({ ...defaultSettings, siteRules: [{ domain: "127.0.0.1:" + port, action: "off" }] });
  await page.waitForFunction(() => [...document.fonts].length === 0);
  await page.evaluate(() => {
    const content = '<style>#t{font-family:Arial}</style><p id=t>ABC“”</p>';
    for (const mode of ["data", "blob", "srcdoc", "blank"]) {
      const frame = document.createElement("iframe"); frame.id = mode; frame.referrerPolicy = "no-referrer";
      if (mode === "srcdoc") frame.srcdoc = content;
      else if (mode === "data") frame.src = "data:text/html," + encodeURIComponent(content);
      else if (mode === "blob") frame.src = URL.createObjectURL(new Blob([content], { type: "text/html" }));
      else frame.src = "about:blank";
      document.getElementById("frames").append(frame);
      if (mode === "blank") { frame.contentDocument.open(); frame.contentDocument.write(content); frame.contentDocument.close(); }
    }
  });
  const frames = [];
  for (const mode of ["data", "blob", "srcdoc", "blank"]) {
    const frame = await (await page.locator("#" + mode).elementHandle()).contentFrame();
    await frame.waitForFunction(() => typeof SPF === "object" && document.getElementById("t"));
    frames.push(frame);
  }
  await page.waitForTimeout(150);
  for (const frame of frames) assert.equal(await frame.evaluate(() => [...document.fonts].length), 0, frame.url());
  await settings({ ...defaultSettings, siteRules: [{ domain: "127.0.0.1:" + (port + 1), action: "off" }] });
  for (const frame of frames) {
    await frame.waitForFunction(() => getComputedStyle(document.getElementById("t")).fontFamily.includes("Shared Punctuation Font"));
    assert.equal(await frame.evaluate(() => [...document.fonts].length), 1);
  }
});
test("document.open 重建页面后保留字体处理及配置开关", async () => {
  const page = await pageFor("document-open", '<style>p{font-family:Arial}</style><p id=t>ABC“”</p>');
  await page.evaluate(() => { document.open(); document.write('<style>p{font-family:Verdana}</style><p id=t>ABC“”</p>'); document.close(); });
  await page.waitForFunction(() => getComputedStyle(document.getElementById("t")).fontFamily.includes("Shared Punctuation Font"));
  assert.equal(await page.evaluate(() => [...document.fonts].length), 1);
  assert.ok((await page.evaluate(() => getComputedStyle(document.documentElement).fontFamily)).includes("Shared Punctuation Font"));
  await settings({ ...defaultSettings, enabled: false });
  await page.waitForFunction(() => [...document.fonts].length === 0);
  assert.equal(await page.locator("#t").evaluate(node => getComputedStyle(node).fontFamily), "Verdana");
  await settings(defaultSettings);
  await page.waitForFunction(() => getComputedStyle(document.getElementById("t")).fontFamily.includes("Shared Punctuation Font"));
});
test("GBK 跨域字体变量及中文字体名正确解码，子导入继承父表编码", async () => {
  const variable = Buffer.from("d7d6cce5", "hex");
  const font = Buffer.from("cea2c8edd1c5bada", "hex");
  const declaration = Buffer.concat([Buffer.from(':root{--'), variable, Buffer.from(':"'), font, Buffer.from('"}#t{font-family:var(--'), variable, Buffer.from(')}')]);
  crossRoutes.set("/gbk-http.css", { type: "text/css; charset=GBK", bytes: declaration });
  const direct = await pageFor("gbk-http", `<link rel=stylesheet href="${crossOrigin}/gbk-http.css"><p id=t>中文“”</p>`);
  await direct.waitForFunction(() => getComputedStyle(document.getElementById("t")).fontFamily.includes("PingFang UI SC"));
  assert.equal(await direct.evaluate(() => [...document.querySelector('style[data-spf="stylesheet"]').sheet.cssRules].some(rule => rule.style?.getPropertyValue("--字体").includes("PingFang UI SC"))), true);
  crossRoutes.set("/gbk-parent.css", { bytes: Buffer.concat([Buffer.from('@charset "gbk";@import "./gbk-child.css";:root{--'), variable, Buffer.from(':"'), font, Buffer.from('"}')]) });
  crossRoutes.set("/gbk-child.css", { bytes: Buffer.concat([Buffer.from('#t{font-family:var(--'), variable, Buffer.from(');color:blue}')]) });
  const imported = await pageFor("gbk-imported", `<link rel=stylesheet href="${crossOrigin}/gbk-parent.css"><p id=t>中文“”</p>`);
  await imported.waitForFunction(() => getComputedStyle(document.getElementById("t")).fontFamily.includes("PingFang UI SC"));
  assert.equal(await imported.locator("#t").evaluate(node => getComputedStyle(node).color), "rgb(0, 0, 255)");
  assert.ok((await imported.locator("#t").evaluate(node => getComputedStyle(node).fontFamily)).includes("Shared Punctuation Font"));
});
test("生命周期回归没有页面脚本错误", () => assert.deepEqual(errors, []));
