import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { AttachmentItem } from './protocol.js';
import { LocalDocumentEngine } from './document-engine.js';

export interface ExtractedAttachmentContent {
  readonly id: string;
  readonly name: string;
  readonly path?: string | undefined;
  readonly type: string;
  readonly size: number;
  readonly textContent: string;
  readonly isTruncated: boolean;
  readonly dataUrl?: string | undefined;
}

export interface AttachmentReaderOptions {
  readonly maxCharsPerFile?: number | undefined;
}

export class AttachmentReader {
  private readonly maxChars: number;

  public constructor(options: AttachmentReaderOptions = {}) {
    this.maxChars = options.maxCharsPerFile ?? 4000;
  }

  public extract(item: AttachmentItem): ExtractedAttachmentContent {
    if (!item.path || !existsSync(item.path)) {
      return {
        id: item.id,
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
        textContent: `[文件未在本地磁盘找到或仅为远程引用: ${item.name}]`,
        isTruncated: false,
      };
    }

    const stat = statSync(item.path);
    if (!stat.isFile()) {
      return {
        id: item.id,
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
        textContent: `[路径为目录而非文件: ${item.path}]`,
        isTruncated: false,
      };
    }

    const ext = extname(item.name).toLowerCase();

    // 图像文件
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext) || item.type.startsWith('image/')) {
      const buffer = readFileSync(item.path);
      const b64 = buffer.toString('base64');
      const mime = item.type || (ext === '.png' ? 'image/png' : 'image/jpeg');
      const dataUrl = `data:${mime};base64,${b64}`;
      return {
        id: item.id,
        name: item.name,
        path: item.path,
        type: mime,
        size: stat.size,
        dataUrl,
        textContent: `[图片附件: ${item.name} (${Math.round(stat.size / 1024)}KB) 路径: ${item.path}]`,
        isTruncated: false,
      };
    }

    // Word 文档 (.docx)
    if (ext === '.docx') {
      try {
        const buffer = readFileSync(item.path);
        const docxText = new LocalDocumentEngine().readDocx(buffer);
        return {
          id: item.id,
          name: item.name,
          path: item.path,
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: stat.size,
          textContent: docxText || `[Word 文档: ${item.name} 已挂载]`,
          isTruncated: false,
        };
      } catch {
        // 容错降级
      }
    }

    // 文本/代码/数据文件
    try {
      const raw = readFileSync(item.path, 'utf8');
      if (raw.length <= this.maxChars) {
        return {
          id: item.id,
          name: item.name,
          path: item.path,
          type: item.type || 'text/plain',
          size: stat.size,
          textContent: raw,
          isTruncated: false,
        };
      }

      const half = Math.floor(this.maxChars / 2);
      const head = raw.slice(0, half);
      const tail = raw.slice(raw.length - half);
      const truncated = `${head}\n\n... [为防止上下文溢出已自动折叠截断中间 ${raw.length - this.maxChars} 字符] ...\n\n${tail}`;
      return {
        id: item.id,
        name: item.name,
        path: item.path,
        type: item.type || 'text/plain',
        size: stat.size,
        textContent: truncated,
        isTruncated: true,
      };
    } catch {
      // 二进制文件容错
      return {
        id: item.id,
        name: item.name,
        path: item.path,
        type: item.type || 'application/octet-stream',
        size: stat.size,
        textContent: `[二进制文件: ${item.name}，大小 ${stat.size} 字节，已挂载至工作区上下文]`,
        isTruncated: false,
      };
    }
  }

  public extractAll(items: readonly AttachmentItem[]): readonly ExtractedAttachmentContent[] {
    return items.map((item) => this.extract(item));
  }

  public formatPrompt(extractedList: readonly ExtractedAttachmentContent[]): string {
    if (!extractedList || extractedList.length === 0) {
      return '';
    }

    const blocks = extractedList.map((ext) => {
      const pathAttr = ext.path ? ` path="${ext.path}"` : '';
      return `<attachment name="${ext.name}" type="${ext.type}" size="${ext.size}"${pathAttr}>\n${ext.textContent}\n</attachment>`;
    });

    return `<attachments>\n${blocks.join('\n\n')}\n</attachments>`;
  }
}
