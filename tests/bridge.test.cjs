const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
let browser;
before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath() }); });
after(async () => { await browser?.close(); });
async function fixture() {
  const page = await browser.newPage();
  await page.setContent('<style>#t{font-family:Arial}</style><p id=t>ABC“”</p>');
  await page.evaluate(() => {
    window.reads = 0; window.fontQueries = 0; window.rootCalls = []; window.listeners = [];
    window.chrome = { storage: {
      local: { get: async () => { reads++; return { settings: { font: "Courier New", cjkMode: "off" } }; } },
      onChanged: { addListener: fn => listeners.push(fn) }
    }, runtime: { sendMessage: message => {
      if (message.kind === "default-font") { fontQueries++; return new Promise(resolve => { window.finishFont = resolve; }); }
      if (message.kind === "root-style") {
        rootCalls.push(message);
        if (window.rootError) return Promise.resolve({ error: "模拟根样式失败" });
        if (window.holdRoot) return new Promise(resolve => { window.finishRoot = resolve; });
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({ error: "本用例没有跨域资源" });
    } } };
    window.change = enabled => listeners.forEach(fn => fn({ settings: { newValue: { enabled, font: "Courier New", cjkMode: "off" } } }, "local"));
  });
  for (const file of ["shared.js", "main-runtime.js", "bridge.js"]) await page.addScriptTag({ path: path.join(root, file) });
  await page.waitForFunction(() => document.styleSheets[0].cssRules[0].style.fontFamily.includes("Shared Punctuation Font"));
  return page;
}
test("默认字体和根样式失败均不阻塞引擎，准备与控件通知复用配置和已注册字体", async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => { window.firstFace = [...document.fonts][0]; window.rootError = true; finishFont({ font: "Arial" }); });
    await page.waitForFunction(() => rootCalls.length > 0);
    for (let i = 0; i < 4; i++) await page.evaluate(() => window.postMessage({ channel: SPF.CHANNEL, direction: "to-bridge", kind: "ready" }, "*"));
    assert.equal(await page.evaluate(() => reads), 1);
    assert.equal(await page.evaluate(() => fontQueries), 1);
    assert.equal(await page.evaluate(() => [...document.fonts][0] === firstFace), true);
    assert.ok(await page.evaluate(() => document.styleSheets[0].cssRules[0].style.fontFamily.includes("Shared Punctuation Font")));
    await page.evaluate(() => { rootError = false; change(true); });
    await page.waitForFunction(() => rootCalls.length > 1);
    assert.equal(await page.evaluate(() => [...document.fonts][0] === firstFace), true);
  } finally { await page.close(); }
});
test("默认字体查询期间关闭及根样式注入期间关闭，旧任务都不会恢复设置", async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => { change(false); finishFont({ font: "Arial" }); });
    await page.waitForFunction(() => [...document.fonts].length === 0);
    assert.equal(await page.evaluate(() => rootCalls.length), 0);
    assert.equal(await page.evaluate(() => document.styleSheets[0].cssRules[0].style.fontFamily), "Arial");
    await page.evaluate(() => { window.holdRoot = true; change(true); });
    await page.waitForFunction(() => !!window.finishRoot);
    await page.evaluate(() => { change(false); holdRoot = false; finishRoot({ ok: true }); });
    await page.waitForFunction(() => rootCalls.length === 2);
    const calls = await page.evaluate(() => rootCalls);
    assert.equal(calls[1].css, ""); assert.equal(calls[1].previous, calls[0].css);
    assert.equal(await page.evaluate(() => [...document.fonts].length), 0);
    assert.equal(await page.evaluate(() => document.styleSheets[0].cssRules[0].style.fontFamily), "Arial");
  } finally { await page.close(); }
});
