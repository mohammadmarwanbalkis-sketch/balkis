/**
 * Test helper: assemble a real .xlsx (ZIP with stored entries + correct CRC32s)
 * from sheet definitions, so the reader is tested against the actual binary
 * format rather than mocks.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(files: ReadonlyMap<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    locals.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 10); // method: stored
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);

    offset += 30 + nameBuffer.length + data.length;
  }
  const centralStart = offset;
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.size, 8);
  eocd.writeUInt16LE(files.size, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

export interface SheetSpec {
  readonly name: string;
  /** ref → number | quoted-string (prefix ') | formula (prefix =) */
  readonly cells: Readonly<Record<string, number | string>>;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Build a minimal but standards-shaped .xlsx from sheets of cells. */
export function buildXlsx(sheets: readonly SheetSpec[]): Buffer {
  const sharedStrings: string[] = [];
  const stringIndex = (text: string): number => {
    const existing = sharedStrings.indexOf(text);
    if (existing !== -1) return existing;
    sharedStrings.push(text);
    return sharedStrings.length - 1;
  };

  const files = new Map<string, string>();
  const sheetTags: string[] = [];
  const relTags: string[] = [];

  sheets.forEach((sheet, index) => {
    const cells = Object.entries(sheet.cells)
      .map(([ref, raw]) => {
        if (typeof raw === "number") return `<c r="${ref}"><v>${raw}</v></c>`;
        if (raw.startsWith("=")) {
          return `<c r="${ref}"><f>${escapeXml(raw.slice(1))}</f><v>0</v></c>`;
        }
        const text = raw.startsWith("'") ? raw.slice(1) : raw;
        return `<c r="${ref}" t="s"><v>${stringIndex(text)}</v></c>`;
      })
      .join("");
    files.set(
      `xl/worksheets/sheet${index + 1}.xml`,
      `<?xml version="1.0"?><worksheet><sheetData><row>${cells}</row></sheetData></worksheet>`,
    );
    sheetTags.push(
      `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    );
    relTags.push(
      `<Relationship Id="rId${index + 1}" Type="worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    );
  });

  files.set(
    "xl/workbook.xml",
    `<?xml version="1.0"?><workbook xmlns:r="r"><sheets>${sheetTags.join("")}</sheets></workbook>`,
  );
  files.set(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0"?><Relationships>${relTags.join("")}</Relationships>`,
  );
  files.set(
    "xl/sharedStrings.xml",
    `<?xml version="1.0"?><sst>${sharedStrings
      .map((text) => `<si><t>${escapeXml(text)}</t></si>`)
      .join("")}</sst>`,
  );
  return zipStored(files);
}
