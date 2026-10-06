const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
function background(fetch) {
  let listener;
  const event = { addListener() {} };
  const scope = vm.createContext({ URL, TextDecoder, AbortSignal, Uint8Array, fetch, setTimeout() {}, chrome: {
    fontSettings: { onFontChanged: event }, action: { onClicked: event },
    runtime: { onInstalled: event, onMessage: { addListener(fn) { listener = fn; } } }
  } });
  vm.runInContext(source, scope);
  return (url, encoding) => new Promise(resolve => listener({ kind: "read-css", url, encoding }, { tab: { id: 1 } }, resolve));
}
test("后台 CSS 解码遵循 BOM、HTTP、精确 charset 声明及环境编码", async () => {
  const css = ':root{--字体:"Microsoft YaHei"}';
  const gbk = Buffer.concat([Buffer.from(':root{--'), Buffer.from("d7d6cce5", "hex"), Buffer.from(':"Microsoft YaHei"}')]);
  const declared = Buffer.concat([Buffer.from('@charset "gbk";'), gbk]);
  const utf16be = Buffer.from(css, "utf16le"); utf16be.swap16();
  const cases = [
    [gbk, "text/css; charset=GBK", undefined, css, "gbk"],
    [gbk, "text/css ; charset=GBK", undefined, css, "gbk"],
    [declared, "text/css", undefined, '@charset "gbk";' + css, "gbk"],
    [declared, "text/css; charset=unknown", undefined, '@charset "gbk";' + css, "gbk"],
    [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(css)]), "text/css; charset=GBK", undefined, css, "utf-8"],
    [Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(css, "utf16le")]), "text/css; charset=utf-8", undefined, css, "utf-16le"],
    [Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be]), "text/css; charset=utf-8", undefined, css, "utf-16be"],
    [Buffer.from('@charset "utf-16le";' + css), "text/css", "gbk", '@charset "utf-16le";' + css, "utf-8"],
    [gbk, "text/css", "GBK", css, "gbk"],
    [Buffer.from(css), "text/css", "unknown", css, "utf-8"],
    [Buffer.from(css), 'text/css; other="charset=GBK"', undefined, css, "utf-8"],
    [Buffer.from(css), 'text/css; other="x; charset=GBK"; charset=utf-8', undefined, css, "utf-8"],
    [gbk, 'text/css; other="x; y=z"; charset="\\g\\b\\k"', undefined, css, "gbk"],
    [Buffer.from(css), "text/css; charset=unknown; charset=GBK", undefined, css, "utf-8"]
  ];
  for (const [bytes, contentType, environment, expected, encoding] of cases) {
    const read = background(async () => new Response(bytes, { headers: { "Content-Type": contentType } }));
    const result = await read("https://example.com/font.css", environment);
    assert.equal(result.css, expected, contentType + "/" + environment);
    assert.equal(result.encoding, encoding);
  }
});
test("同一地址的 CSS 按环境编码分别解码，等价编码标签合并请求", async () => {
  let release, calls = 0;
  const barrier = new Promise(resolve => { release = resolve; });
  const bytes = Buffer.concat([Buffer.from(':root{--'), Buffer.from("d7d6cce5", "hex"), Buffer.from(':Arial}')]);
  const read = background(async () => { calls++; await barrier; return new Response(bytes, { headers: { "Content-Type": "text/css" } }); });
  const pending = [read("https://example.com/font.css", "utf-8"), read("https://example.com/font.css", "GBK"), read("https://example.com/font.css", "gbk")];
  assert.equal(calls, 2);
  release();
  const results = await Promise.all(pending);
  assert.equal(results[0].css, new TextDecoder().decode(bytes));
  assert.equal(results[1].css, ':root{--字体:Arial}');
  assert.equal(results[2].css, results[1].css);
});
