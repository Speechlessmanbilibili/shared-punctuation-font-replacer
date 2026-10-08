const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
let browser;
before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath() }); });
after(async () => { await browser?.close(); });
async function fixture() {
  const page = await browser.newPage();
  const html = (await fs.readFile(path.join(root, "options.html"), "utf8")).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
  await page.setContent(html);
  await page.addStyleTag({ path: path.join(root, "options.css") });
  await page.evaluate(() => {
    window.saves = [];
    window.chrome = { storage: { local: {
      get: () => new Promise(resolve => { window.finishInitial = resolve; }),
      set: value => new Promise((resolve, reject) => { saves.push({ value, resolve, reject }); })
    } } };
  });
  for (const file of ["shared.js", "options.js"]) await page.addScriptTag({ path: path.join(root, file) });
  return page;
}
async function initialize(page) {
  await page.evaluate(() => finishInitial({ settings: { font: "Courier New", cjkMode: "off" } }));
  await page.waitForFunction(() => document.getElementById("status").textContent === "已保存");
}
test("读取设置完成前锁定表单，避免默认值覆盖已保存配置", async () => {
  const page = await fixture();
  try {
    assert.equal(await page.locator("#settings").evaluate(node => node.inert), true);
    await page.evaluate(() => document.getElementById("settings").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(await page.evaluate(() => saves.length), 0);
    await initialize(page);
    assert.equal(await page.locator("#settings").evaluate(node => node.inert), false);
    assert.equal(await page.locator("#font").inputValue(), "Courier New");
  } finally { await page.close(); }
});
test("保存操作串行，保存期间编辑的草稿仍显示未保存，失败后可重试", async () => {
  const page = await fixture();
  try {
    await initialize(page);
    await page.locator("#font").fill("Arial"); await page.getByRole("button", { name: "保存设置" }).click();
    assert.equal(await page.getByRole("button", { name: "保存设置" }).isDisabled(), true);
    await page.locator("#font").fill("Verdana");
    await page.evaluate(() => document.getElementById("settings").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(await page.evaluate(() => saves.length), 1);
    await page.evaluate(() => saves[0].resolve());
    await page.waitForFunction(() => document.getElementById("status").textContent === "有未保存的更改");
    assert.equal(await page.locator("#font").inputValue(), "Verdana");
    await page.getByRole("button", { name: "保存设置" }).click();
    assert.equal(await page.evaluate(() => saves[1].value.settings.font), "Verdana");
    await page.evaluate(() => saves[1].reject(new Error("模拟保存失败")));
    await page.waitForFunction(() => document.getElementById("status").textContent.startsWith("保存失败"));
    assert.equal(await page.getByRole("button", { name: "保存设置" }).isDisabled(), false);
    await page.getByRole("button", { name: "保存设置" }).click();
    await page.evaluate(() => saves[2].resolve());
    await page.waitForFunction(() => document.getElementById("status").textContent === "已保存");
  } finally { await page.close(); }
});
test("字符组清空后清除上次字体检测提示及已注册预览字体", async () => {
  const page = await fixture();
  try {
    await initialize(page);
    await page.waitForFunction(() => document.getElementById("font-status").textContent.includes("已找到"));
    await page.evaluate(() => {
      for (const input of document.querySelectorAll("[data-group]")) input.checked = false;
      document.getElementById("extra").dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(await page.locator("#font-status").textContent(), "未选择标点字符。");
    assert.equal(await page.locator("#font-status").evaluate(node => node.classList.contains("error")), false);
    assert.equal(await page.evaluate(() => [...document.fonts].length), 0);
  } finally { await page.close(); }
});
test("宋体和楷体默认关闭，多字体预览、保存与无效列表提示保持一致", async () => {
  const page = await fixture();
  try {
    await initialize(page);
    assert.equal(await page.locator("#replace-song").isChecked(), false);
    assert.equal(await page.locator("#replace-kai").isChecked(), false);
    assert.equal(await page.locator("#song-font").isDisabled(), true);
    assert.equal(await page.locator("#kai-font").isDisabled(), true);
    await page.locator("#replace-song").check(); await page.locator("#replace-kai").check();
    await page.locator("#song-font").fill("Missing Font, SimSun"); await page.locator("#kai-font").fill("Missing Font，KaiTi");
    await page.locator("#font").fill("Missing Font, Courier New");
    await page.waitForFunction(() => ["font-status", "song-font-status", "kai-font-status"].every(id => document.getElementById(id).textContent.includes("已找到")));
    assert.deepEqual(await page.locator(".preview-kai").evaluate(node => SPF.familyList(node.style.fontFamily).map(SPF.familyName)), ["shared punctuation font", "shared punctuation font 2", "missing font", "kaiti", "serif"]);
    await page.getByRole("button", { name: "保存设置" }).click();
    const stored = await page.evaluate(() => saves[0].value.settings);
    assert.equal(stored.replaceSong, true); assert.equal(stored.replaceKai, true);
    assert.equal(stored.songFont, "Missing Font, SimSun"); assert.equal(stored.kaiFont, "Missing Font，KaiTi");
    await page.evaluate(() => saves[0].resolve());
    await page.waitForFunction(() => document.getElementById("status").textContent === "已保存");
    await page.locator("#song-font").fill(",，,");
    await page.getByRole("button", { name: "保存设置" }).click();
    assert.equal(await page.evaluate(() => saves.length), 1);
    assert.equal(await page.locator("#song-font").evaluate(node => node.validity.customError), true);
    await page.locator("#replace-song").uncheck();
    await page.getByRole("button", { name: "保存设置" }).click();
    assert.equal(await page.evaluate(() => saves.length), 2);
    await page.evaluate(() => saves[1].resolve());
  } finally { await page.close(); }
});

test("字体目录提示完整名称，正文家族识别与标点字形加载分别判断", async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => {
      window.fontCatalogCalls = 0;
      chrome.fontSettings = { getFontList(callback) {
        fontCatalogCalls++;
        callback([{ fontId: "FZNewShuSong-Z10", displayName: "方正新书宋_GBK" }, { fontId: "FZNewShuSong-Z10S", displayName: "方正新书宋简体" }, { fontId: "Catalog Only Family", displayName: "目录测试字体" }]);
      } };
    });
    await initialize(page);
    await page.locator("#replace-song").check();
    for (const name of ["方正新书宋", '"方正新书宋"']) {
      await page.locator("#song-font").fill(name);
      await page.waitForFunction(() => { const text = document.getElementById("song-font-status").textContent; return text.includes("方正新书宋_GBK") && text.includes("方正新书宋简体"); });
      assert.equal(await page.locator("#song-font-status").evaluate(node => node.classList.contains("error")), true);
    }
    await page.locator("#song-font").fill("目录测试字体");
    await page.waitForFunction(() => document.getElementById("song-font-status").textContent === "已找到本机字体。");
    assert.equal(await page.locator("#song-font-status").evaluate(node => node.classList.contains("error")), false);
    await page.locator("#font").fill("目录测试字体");
    await page.waitForFunction(() => document.getElementById("font-status").textContent === "已找到本机字体，但标点字形加载失败。");
    await page.locator("#song-font").fill("不存在的完整测试字体");
    await page.waitForFunction(() => document.getElementById("song-font-status").textContent === "未找到列表中的本机字体，请检查名称或先安装字体。");
    assert.equal(await page.evaluate(() => fontCatalogCalls), 1);
  } finally { await page.close(); }
});

test("字体目录返回前改用可用字体时，旧检测结果不会覆盖新提示", async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => { chrome.fontSettings = { getFontList(callback) { window.finishFontCatalog = callback; } }; });
    await initialize(page);
    await page.locator("#replace-song").check();
    await page.locator("#song-font").fill("不存在的旧字体");
    await page.waitForFunction(() => typeof finishFontCatalog === "function");
    await page.locator("#song-font").fill("SimSun");
    await page.waitForFunction(() => document.getElementById("song-font-status").textContent === "已找到本机字体。");
    await page.evaluate(() => finishFontCatalog([{ fontId: "不存在的旧字体 SC", displayName: "不存在的旧字体 SC" }]));
    await page.waitForFunction(() => document.getElementById("song-font-status").textContent === "已找到本机字体。");
    assert.equal(await page.locator("#song-font-status").evaluate(node => node.classList.contains("error")), false);
  } finally { await page.close(); }
});
