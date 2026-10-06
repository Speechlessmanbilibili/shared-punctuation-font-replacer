const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
test("CSSOM 拦截与原生参数转换、异常及写入顺序一致", async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath() });
  try {
    const page = await browser.newPage();
    await page.setContent("<p>ABC“”</p>");
    await page.evaluate(() => {
      window.nativeMethods = Object.fromEntries(["setProperty", "removeProperty"].map(name => [name, CSSStyleDeclaration.prototype[name]]));
      window.nativeDeletion = { sheet: CSSStyleSheet.prototype.deleteRule, group: CSSGroupingRule.prototype.deleteRule, keys: CSSKeyframesRule.prototype.deleteRule };
      window.exercise = (method, kind, native) => {
        const trace = [];
        const style = document.createElement("div").style;
        nativeMethods.setProperty.call(style, "--x", "old");
        const token = (name, value) => ({ toString() { trace.push(name); return value; } });
        let name = token("name", "--x");
        if (kind === "symbol") name = Symbol("property");
        if (kind === "object-symbol") name = token("name", Symbol("property"));
        if (kind === "throwing") name = { toString() { trace.push("name"); throw new RangeError("conversion"); } };
        if (kind === "null") name = null;
        if (kind === "undefined") name = undefined;
        if (kind === "number") name = 7;
        const receiver = kind === "receiver" ? {} : kind === "readonly" ? getComputedStyle(document.body) : style;
        const args = kind === "missing" ? [] : method === "removeProperty" ? [name] : [name, token("value", "new"), token("priority", "important")];
        let result, error;
        try { result = (native ? nativeMethods[method] : CSSStyleDeclaration.prototype[method]).apply(receiver, args); }
        catch (value) { error = { name: value.name, message: value.message }; }
        return { trace, result, error, value: style.getPropertyValue("--x"), priority: style.getPropertyPriority("--x") };
      };
    });
    await page.addScriptTag({ path: path.join(root, "main-runtime.js") });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent(SPF.CHANNEL + "/config", { detail: JSON.stringify({ font: "Courier New", cjkMode: "off" }) })));
    for (const method of ["setProperty", "removeProperty"]) for (const kind of ["normal", "symbol", "object-symbol", "throwing", "null", "undefined", "number", "receiver", "readonly", "missing"]) {
      const values = await page.evaluate(([method, kind]) => [exercise(method, kind, true), exercise(method, kind, false)], [method, kind]);
      assert.deepEqual(values[1], values[0], method + ":" + kind);
    }
    await page.evaluate(() => {
      window.exerciseDelete = (type, kind, native) => {
        const trace = [];
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(type === "keys" ? "@keyframes frames{0%{font-family:Arial}100%{font-family:Verdana}}" : type === "group" ? "@media all{p{font-family:Arial}div{font-family:Verdana}}" : "p{font-family:Arial}div{font-family:Verdana}");
        const owner = type === "sheet" ? sheet : sheet.cssRules[0];
        const value = type === "keys" ? "100%" : .5;
        let name = { [Symbol.toPrimitive](hint) { trace.push(hint); return value; } };
        if (kind === "fraction") name = .5;
        if (kind === "symbol") name = Symbol("index");
        if (kind === "throwing") name = { [Symbol.toPrimitive]() { trace.push("throw"); throw new RangeError("index"); } };
        const receiver = kind === "receiver" ? {} : owner;
        const args = kind === "missing" ? [] : [name];
        let result, error;
        try { result = (native ? nativeDeletion[type] : owner.deleteRule).apply(receiver, args); }
        catch (value) { error = { name: value.name, message: value.message }; }
        return { trace, result, error, rules: [...owner.cssRules].map(rule => rule.selectorText || rule.keyText) };
      };
    });
    for (const type of ["sheet", "group", "keys"]) for (const kind of ["normal", "fraction", "symbol", "throwing", "receiver", "missing"]) {
      const values = await page.evaluate(([type, kind]) => [exerciseDelete(type, kind, true), exerciseDelete(type, kind, false)], [type, kind]);
      assert.deepEqual(values[1], values[0], type + ":" + kind);
    }
  } finally { await browser.close(); }
});
