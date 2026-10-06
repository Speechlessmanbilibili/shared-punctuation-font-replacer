const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { inflateRawSync } = require("node:zlib");
const root = path.resolve(__dirname, "..");
test("安装包中央目录与本地文件头路径一致，版本和全部文件字节与源码相同", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const zip = fs.readFileSync(path.join(root, "dist", `shared-punctuation-font-replacer-v${manifest.version}.zip`));
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0);
  let cursor = zip.readUInt32LE(end + 16);
  const names = [];
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50);
    const method = zip.readUInt16LE(cursor + 10);
    const size = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const offset = zip.readUInt32LE(cursor + 42);
    assert.equal(zip.readUInt32LE(offset), 0x04034b50);
    const localLength = zip.readUInt16LE(offset + 26);
    assert.equal(zip.subarray(offset + 30, offset + 30 + localLength).toString("utf8"), name);
    assert.ok(!name.includes("\\") && !name.startsWith("/") && !name.includes(".."));
    const dataOffset = offset + 30 + localLength + zip.readUInt16LE(offset + 28);
    const compressed = zip.subarray(dataOffset, dataOffset + size);
    const data = method === 8 ? inflateRawSync(compressed) : compressed;
    assert.ok(data.equals(fs.readFileSync(path.join(root, name))), name);
    if (name === "manifest.json") assert.equal(JSON.parse(data).version, manifest.version);
    names.push(name);
    cursor += 46 + nameLength + zip.readUInt16LE(cursor + 30) + zip.readUInt16LE(cursor + 32);
  }
  assert.ok(names.includes("manifest.json") && names.includes("main-runtime.js"));
  assert.equal(names.length, 12);
  assert.equal(new Set(names).size, names.length);
  assert.equal(fs.readFileSync(path.join(root, "main-runtime.js"), "utf8"), fs.readFileSync(path.join(root, "shared.js"), "utf8") + "\n" + fs.readFileSync(path.join(root, "engine.js"), "utf8"));
  assert.ok(fs.readFileSync(path.join(root, "build-release.ps1")).subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])));
});
