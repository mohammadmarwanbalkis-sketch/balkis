/**
 * Minimal ZIP reader — .xlsx files are ZIP containers. Reads the central directory
 * and inflates entries with node:zlib; no external dependencies. Supports the two
 * compression methods Excel writes: stored (0) and deflate (8). ZIP64 archives
 * (>4 GB workbooks) are out of scope and rejected explicitly.
 */

import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

export function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) {
    throw new Error(
      "Not a ZIP archive (no end-of-central-directory record) — is this an .xlsx file?",
    );
  }

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (offset === 0xffffffff) throw new Error("ZIP64 archives are not supported.");

  const entries = new Map<string, Buffer>();
  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error("Corrupt ZIP central directory.");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);

    if (method === 8) {
      entries.set(name, inflateRawSync(data));
    } else if (method === 0) {
      entries.set(name, Buffer.from(data));
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for "${name}".`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
