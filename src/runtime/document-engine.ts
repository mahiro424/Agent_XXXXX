import { extname, basename } from 'node:path';
import type { ArtifactWriteResult } from './protocol.js';
import type { LocalWorkspaceSandbox } from './sandbox.js';

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

export interface DocumentEngine {
  readonly capabilities: DocumentEngineCapabilities;
  readSource(sourcePath: string): StructuredDocument;
  createDocx(draft: DocumentDraft, artifactName: string): DocumentEngineResult;
  createFixtureArtifact(draft: DocumentDraft, artifactName: string): DocumentEngineResult;
  renderArtifact(artifactPath: string): DocumentEngineResult;
}

export class FixtureDocumentEngine implements DocumentEngine {
  public readonly capabilities: DocumentEngineCapabilities = {
    fixture: 'available',
    docx: 'unavailable',
    render: 'unavailable',
  };

  public constructor(private readonly sandbox: LocalWorkspaceSandbox) {}

  public readSource(sourcePath: string): StructuredDocument {
    const content = this.sandbox.readFile(sourcePath);
    const extension = extname(sourcePath).toLowerCase();
    if (extension === '.md' || extension === '.markdown') {
      return parseMarkdown(sourcePath, content);
    }
    if (extension === '.csv') {
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
    const written: ArtifactWriteResult = this.sandbox.writeArtifact(
      artifactName,
      JSON.stringify(payload, null, 2),
    );
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

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}
