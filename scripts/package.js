#!/usr/bin/env node
/**
 * Build dist/psalms-way-extension.zip from the package list.
 *
 * Writes the archive with Node's own zlib rather than shelling out to `zip` or
 * Compress-Archive, so the same command produces the same bytes on a developer
 * machine and in CI. Nothing is uploaded or published here.
 */

import { deflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PACKAGE_FILES } from "./package-manifest.js";

const root = new URL("../", import.meta.url);
const resolve = (relative) => fileURLToPath(new URL(relative, root));

// ─── Minimal ZIP writer ───────────────────────────────────────────────────────

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/**
 * @param {Array<{name: string, data: Buffer}>} entries
 * @returns {Buffer}
 */
function buildZip(entries) {
  // A fixed timestamp keeps the archive reproducible: the same inputs produce
  // byte-identical output, so a checksum is meaningful.
  const DOS_TIME = 0;
  const DOS_DATE = 0x21; // 1980-01-01

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuffer = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    // Store uncompressed when deflate does not help.
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuffer, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + payload.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([Buffer.concat(locals), centralBuffer, end]);
}

// ─── Build ────────────────────────────────────────────────────────────────────

const manifest = JSON.parse(readFileSync(resolve("manifest.json"), "utf8"));

/**
 * Read a file for packaging.
 *
 * Text files are normalised to LF. A Windows checkout rewrites them to CRLF,
 * and without this the same commit would produce a different archive, and a
 * different checksum, depending on which machine built it.
 */
function readForPackage(name) {
  const raw = readFileSync(resolve(name));
  if (!/[.](js|json|css|html)$/.test(name)) return raw;
  // Strip carriage returns so a CRLF checkout packages identically to LF.
  const text = raw.toString("utf8").split(String.fromCharCode(13)).join("");
  return Buffer.from(text, "utf8");
}
const entries = PACKAGE_FILES.map((name) => ({
  name,
  data: readForPackage(name),
}));

const zip = buildZip(entries);

const outDir = resolve("dist");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const outPath = resolve("dist/psalms-way-extension.zip");
writeFileSync(outPath, zip);

const sha256 = createHash("sha256").update(zip).digest("hex");
const uncompressed = entries.reduce((sum, entry) => sum + entry.data.length, 0);

console.log("Built dist/psalms-way-extension.zip");
console.log(`  version       ${manifest.version}`);
console.log(`  files         ${entries.length}`);
console.log(`  uncompressed  ${(uncompressed / 1024).toFixed(0)} KB`);
console.log(`  packaged      ${(zip.length / 1024).toFixed(0)} KB`);
console.log(`  sha256        ${sha256}`);
console.log("\nNot published. Upload manually from the Chrome Web Store dashboard.");
