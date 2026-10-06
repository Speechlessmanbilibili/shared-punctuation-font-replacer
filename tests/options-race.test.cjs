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
