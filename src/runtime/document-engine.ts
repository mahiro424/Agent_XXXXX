import { basename } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { LocalWorkspaceSandbox } from './sandbox.js';

export type DocumentSourceKind = 'markdown' | 'text' | 'csv';

export interface DocumentSource {
  readonly name: string;
  readonly kind: DocumentSourceKind;
  readonly text: string;
}

export interface ReportDocumentInput {
  readonly title: string;
  readonly sources: readonly DocumentSource[];
}

export interface WorkspaceDocumentEngine {
  readSource(name: string, content: Uint8Array): DocumentSource;
  createDocx(input: ReportDocumentInput): Buffer;
  readDocx(content: Uint8Array): string;
  renderDocx(content: Uint8Array): string;
}

export type DocumentSourceFormat = 'markdown' | 'text' | 'csv';

export interface DocumentTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface StructuredDocument {
  readonly sourcePath: string;
  readonly format: DocumentSourceFormat;
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly table?: DocumentTable;
}

export interface DocumentDraft {
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly table?: DocumentTable;
  readonly sourcePaths: readonly string[];
}

export interface DocumentEngineCapabilities {
  readonly fixture: 'available';
  readonly docx: 'unavailable';
  readonly render: 'unavailable';
}

export type DocumentEngineResultStatus = 'completed' | 'unavailable' | 'failed';

export interface DocumentEngineResult {
  readonly status: DocumentEngineResultStatus;
  readonly format: 'docx' | 'fixture-json' | 'render';
  readonly path?: string;
  readonly reason?: string;
  readonly evidence?: readonly string[];
}

/** Compatibility contract for the first fixture-only document seam. */
export interface DocumentEngine {
  readonly capabilities: DocumentEngineCapabilities;
  readSource(sourcePath: string): StructuredDocument;
  createDocx(draft: DocumentDraft, artifactName: string): DocumentEngineResult;
  createFixtureArtifact(draft: DocumentDraft, artifactName: string): DocumentEngineResult;
  renderArtifact(artifactPath: string): DocumentEngineResult;
}

interface ZipEntry {
  readonly name: string;
  readonly content: Buffer;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export class LocalDocumentEngine implements WorkspaceDocumentEngine {
  public readSource(name: string, content: Uint8Array): DocumentSource {
    const kind = sourceKindFor(name);
    const rawText = textDecoder.decode(content);
    const text = normalizeSourceText(kind, rawText);
    return { name, kind, text };
  }

  public createDocx(input: ReportDocumentInput): Buffer {
    const paragraphs = [
      input.title,
      ...input.sources.flatMap((source) => [source.name, ...source.text.split('\n')]),
    ];
    const documentXml = createDocumentXml(paragraphs);
    const entries: readonly ZipEntry[] = [
      {
        name: '[Content_Types].xml',
        content: Buffer.from(contentTypesXml, 'utf8'),
      },
      {
        name: '_rels/.rels',
        content: Buffer.from(rootRelationshipsXml, 'utf8'),
      },
      {
        name: 'word/document.xml',
        content: Buffer.from(documentXml, 'utf8'),
      },
      {
        name: 'word/_rels/document.xml.rels',
        content: Buffer.from(documentRelationshipsXml, 'utf8'),
      },
      {
        name: 'word/styles.xml',
        content: Buffer.from(stylesXml, 'utf8'),
      },
      {
        name: 'docProps/core.xml',
        content: Buffer.from(corePropertiesXml, 'utf8'),
      },
    ];
    return createStoredZip(entries);
  }

  public readDocx(content: Uint8Array): string {
    const entries = readStoredOrDeflatedZip(Buffer.from(content));
    const documentXml = entries.get('word/document.xml');
    if (!documentXml) {
      throw new Error('docx is missing word/document.xml');
    }
    return documentXmlToText(documentXml.toString('utf8'));
  }

  public renderDocx(content: Uint8Array): string {
    return this.readDocx(content);
  }
}

/**
 * Compatibility fixture for the first document-engine seam. It intentionally
 * models an unavailable Office renderer; LocalDocumentEngine is the real
 * offline OOXML implementation used by the workspace runtime.
 */
export class FixtureDocumentEngine implements DocumentEngine {
  public readonly capabilities: DocumentEngineCapabilities = {
    fixture: 'available',
    docx: 'unavailable',
    render: 'unavailable',
  };

  public constructor(private readonly sandbox: LocalWorkspaceSandbox) {}

  public readSource(sourcePath: string): StructuredDocument {
    const content = this.sandbox.readFile(sourcePath);
    const kind = sourceKindFor(sourcePath);
    if (kind === 'markdown') {
      return parseMarkdown(sourcePath, content);
    }
    if (kind === 'csv') {
      return parseCsv(sourcePath, content);
    }
    return parseText(sourcePath, content);
  }

  public createDocx(_draft: DocumentDraft, _artifactName: string): DocumentEngineResult {
    return {
      status: 'unavailable',
      format: 'docx',
      reason: 'office_renderer_unavailable',
      evidence: ['No Office/LibreOffice/ONLYOFFICE renderer is configured in this environment'],
    };
  }

  public createFixtureArtifact(draft: DocumentDraft, artifactName: string): DocumentEngineResult {
    const payload = {
      kind: 'document-fixture',
      format: 'fixture-json',
      title: draft.title,
      paragraphs: draft.paragraphs,
      ...(draft.table === undefined ? {} : { table: draft.table }),
      sourcePaths: draft.sourcePaths,
    };
    const written = this.sandbox.writeArtifact(artifactName, JSON.stringify(payload, null, 2));
    return {
      status: 'completed',
      format: 'fixture-json',
      path: written.path,
      evidence: [
        'fixture written through LocalWorkspaceSandbox',
        `bytes=${written.bytes}`,
        `source_count=${draft.sourcePaths.length}`,
      ],
    };
  }

  public renderArtifact(_artifactPath: string): DocumentEngineResult {
    return {
      status: 'unavailable',
      format: 'render',
      reason: 'office_renderer_unavailable',
      evidence: ['Fixture inspection is available; Office rendering remains an external dependency'],
    };
  }
}

function sourceKindFor(name: string): DocumentSourceKind {
  const extension = name.toLowerCase().split('.').at(-1);
  if (extension === 'md' || extension === 'markdown') {
    return 'markdown';
  }
  if (extension === 'csv') {
    return 'csv';
  }
  return 'text';
}

function parseMarkdown(sourcePath: string, content: string): StructuredDocument {
  const lines = content.split(/\r?\n/);
  const heading = lines.find((line) => /^#\s+/.test(line));
  const paragraphs = lines
    .filter((line) => line.trim().length > 0 && !/^#\s+/.test(line))
    .map((line) => line.trim());
  return {
    sourcePath,
    format: 'markdown',
    title: heading ? heading.replace(/^#\s+/, '').trim() : basename(sourcePath),
    paragraphs,
  };
}

function parseText(sourcePath: string, content: string): StructuredDocument {
  return {
    sourcePath,
    format: 'text',
    title: basename(sourcePath),
    paragraphs: content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  };
}

function parseCsv(sourcePath: string, content: string): StructuredDocument {
  const rows = content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine);
  const [headers = [], ...dataRows] = rows;
  return {
    sourcePath,
    format: 'csv',
    title: basename(sourcePath),
    paragraphs: [],
    table: { headers, rows: dataRows },
  };
}

function normalizeSourceText(kind: DocumentSourceKind, text: string): string {
  const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
  if (kind !== 'csv') {
    return normalized;
  }
  return normalized
    .split('\n')
    .map((line) => parseCsvLine(line).join(' | '))
    .join('\n');
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? '';
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === ',' && !quoted) {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function createDocumentXml(paragraphs: readonly string[]): string {
  const body = paragraphs
    .flatMap((paragraph) => paragraph.split('\n'))
    .map(
      (paragraph) =>
        `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r></w:p>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
}

function documentXmlToText(xml: string): string {
  const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((match) => {
    const paragraphXml = match[1] ?? '';
    const text = [...paragraphXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((textMatch) => decodeXml(textMatch[1] ?? ''))
      .join('');
    return text;
  });
  return paragraphs.join('\n');
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

function crc32(content: Uint8Array): number {
  let checksum = 0xffffffff;
  for (const byte of content) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function createStoredZip(entries: readonly ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(textEncoder.encode(entry.name));
    const content = entry.content;
    const checksum = crc32(content);
    const localHeader = Buffer.alloc(30 + name.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    name.copy(localHeader, 30);
    localParts.push(localHeader, content);

    const centralHeader = Buffer.alloc(46 + name.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    name.copy(centralHeader, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + content.length;
  }

  const localDirectory = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localDirectory.length, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([localDirectory, centralDirectory, end]);
}

function readStoredOrDeflatedZip(content: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 4 <= content.length && content.readUInt32LE(offset) === 0x04034b50) {
    if (offset + 30 > content.length) {
      throw new Error('docx local ZIP header is truncated');
    }
    const flags = content.readUInt16LE(offset + 6);
    const compression = content.readUInt16LE(offset + 8);
    const compressedSize = content.readUInt32LE(offset + 18);
    const nameLength = content.readUInt16LE(offset + 26);
    const extraLength = content.readUInt16LE(offset + 28);
    if ((flags & 0x08) !== 0) {
      throw new Error('docx ZIP data descriptors are not supported');
    }
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > content.length) {
      throw new Error('docx ZIP entry is truncated');
    }
    const name = content.subarray(nameStart, dataStart - extraLength).toString('utf8');
    const compressed = content.subarray(dataStart, dataEnd);
    const uncompressed =
      compression === 0
        ? Buffer.from(compressed)
        : compression === 8
          ? inflateRawSync(compressed)
          : undefined;
    if (!uncompressed) {
      throw new Error(`unsupported docx ZIP compression method: ${compression}`);
    }
    entries.set(name, uncompressed);
    offset = dataEnd;
  }
  if (entries.size === 0) {
    throw new Error('content is not a readable docx ZIP package');
  }
  return entries;
}

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
const rootRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
const documentRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
const corePropertiesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Agent_XXXXX Document</dc:title><dc:creator>Agent_XXXXX Local Workspace</dc:creator></cp:coreProperties>`;

