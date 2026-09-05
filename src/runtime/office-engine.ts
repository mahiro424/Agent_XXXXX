import ExcelJS from 'exceljs';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { LocalDocumentEngine } from './document-engine.js';
import type {
  DocumentSource,
  ReportDocumentInput,
  WorkspaceDocumentEngine,
} from './document-engine.js';

export interface ExcelColumnSpec {
  readonly header: string;
  readonly key: string;
  readonly width?: number;
}

export interface ExcelSheetSpec {
  readonly name: string;
  readonly columns: readonly ExcelColumnSpec[];
  readonly rows: readonly Record<string, unknown>[];
  readonly includeTotalRow?: boolean;
}

export interface ExcelWorkbookSpec {
  readonly title?: string;
  readonly sheets: readonly ExcelSheetSpec[];
}

export interface ParsedTableData {
  readonly headers: readonly string[];
  readonly rows: readonly Record<string, string | number>[];
  readonly summary: {
    readonly totalRows: number;
    readonly numericSums: Record<string, number>;
  };
}

export interface RichDocxSection {
  readonly heading?: string;
  readonly paragraphs?: readonly string[];
  readonly table?: {
    readonly headers: readonly string[];
    readonly rows: readonly (readonly string[])[];
  };
}

export interface RichDocxSpec {
  readonly title: string;
  readonly subtitle?: string;
  readonly sections: readonly RichDocxSection[];
}

export class ProductionOfficeEngine implements WorkspaceDocumentEngine {
  private readonly fallbackEngine = new LocalDocumentEngine();

  public readSource(name: string, content: Uint8Array): DocumentSource {
    return this.fallbackEngine.readSource(name, content);
  }

  public createDocx(input: ReportDocumentInput): Buffer {
    return this.fallbackEngine.createDocx(input);
  }

  public readDocx(content: Uint8Array): string {
    return this.fallbackEngine.readDocx(content);
  }

  public renderDocx(content: Uint8Array): string {
    return this.fallbackEngine.renderDocx(content);
  }

  /**
   * 基于 exceljs 生成专业带样式和公式的 Excel 工作簿
   */
  public async createExcelWorkbook(spec: ExcelWorkbookSpec): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Agent_XXXXX Production Office Engine';
    workbook.created = new Date();

    for (const sheetSpec of spec.sheets) {
      const sheet = workbook.addWorksheet(sheetSpec.name, {
        views: [{ showGridLines: true }],
      });

      sheet.columns = sheetSpec.columns.map((col) => ({
        header: col.header,
        key: col.key,
        width: col.width ?? Math.max(col.header.length * 2 + 4, 14),
      }));

      // 表头样式：背景色 #1E6FFF，白色粗体居中
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E6FFF' },
      };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
      headerRow.height = 24;

      for (const rowData of sheetSpec.rows) {
        sheet.addRow(rowData);
      }

      // 添加汇总统计行
      if (sheetSpec.includeTotalRow && sheetSpec.rows.length > 0) {
        const totalRowData: Record<string, unknown> = {};
        const firstColKey = sheetSpec.columns[0]?.key;
        if (firstColKey) {
          totalRowData[firstColKey] = '合计 (Total)';
        }

        const startRowIndex = 2;
        const endRowIndex = sheetSpec.rows.length + 1;

        for (let colIdx = 0; colIdx < sheetSpec.columns.length; colIdx++) {
          const col = sheetSpec.columns[colIdx];
          if (!col || colIdx === 0) continue;

          // 检查该列数据是否全为数值
          const isNumeric = sheetSpec.rows.every(
            (r) => typeof r[col.key] === 'number' && !Number.isNaN(r[col.key]),
          );

          if (isNumeric) {
            // Excel 列字母 (例如 1 -> A, 2 -> B)
            const colLetter = String.fromCharCode(65 + colIdx);
            totalRowData[col.key] = {
              formula: `SUM(${colLetter}${startRowIndex}:${colLetter}${endRowIndex})`,
            };
          }
        }

        const totalRow = sheet.addRow(totalRowData);
        totalRow.font = { bold: true };
        totalRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF3F4F6' },
        };
        totalRow.border = {
          top: { style: 'thin' },
          bottom: { style: 'double' },
        };
      }

      // 边框和内边距对齐
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          row.alignment = { vertical: 'middle' };
          row.height = 20;
        }
      });
    }

    const uint8 = await workbook.xlsx.writeBuffer();
    return Buffer.from(uint8);
  }

  /**
   * 解析 CSV 或 XLSX 表格数据为结构化数据
   */
  public async readTableData(
    content: Uint8Array,
    format: 'csv' | 'xlsx',
  ): Promise<ParsedTableData> {
    const workbook = new ExcelJS.Workbook();
    if (format === 'csv') {
      const text = new TextDecoder('utf8').decode(content);
      // 利用简易流式或换行解析 CSV
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const firstLine = lines[0];
      if (!firstLine || lines.length === 0) {
        return { headers: [], rows: [], summary: { totalRows: 0, numericSums: {} } };
      }
      const headers = firstLine.split(',').map((h) => h.trim());
      const rows: Array<Record<string, string | number>> = [];
      const numericSums: Record<string, number> = {};

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const values = line.split(',').map((v) => v.trim());
        const row: Record<string, string | number> = {};
        for (let j = 0; j < headers.length; j++) {
          const key = headers[j];
          if (!key) continue;
          const rawVal = values[j] ?? '';
          const num = Number(rawVal);
          if (!Number.isNaN(num) && rawVal !== '') {
            row[key] = num;
            numericSums[key] = (numericSums[key] ?? 0) + num;
          } else {
            row[key] = rawVal;
          }
        }
        rows.push(row);
      }

      return {
        headers,
        rows,
        summary: {
          totalRows: rows.length,
          numericSums,
        },
      };
    }

    await workbook.xlsx.load(content as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return { headers: [], rows: [], summary: { totalRows: 0, numericSums: {} } };
    }

    const headers: string[] = [];
    const rows: Array<Record<string, string | number>> = [];
    const numericSums: Record<string, number> = {};

    sheet.eachRow((row, rowNumber) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      if (rowNumber === 1) {
        for (const val of values) {
          headers.push(String(val ?? ''));
        }
      } else {
        const record: Record<string, string | number> = {};
        for (let i = 0; i < headers.length; i++) {
          const key = headers[i];
          if (!key) continue;
          const raw = values[i];
          if (typeof raw === 'number') {
            record[key] = raw;
            numericSums[key] = (numericSums[key] ?? 0) + raw;
          } else if (typeof raw === 'object' && raw !== null && 'result' in raw) {
            const num = Number((raw as { result: unknown }).result);
            record[key] = Number.isNaN(num) ? String(raw) : num;
          } else {
            record[key] = String(raw ?? '');
          }
        }
        rows.push(record);
      }
    });

    return {
      headers,
      rows,
      summary: {
        totalRows: rows.length,
        numericSums,
      },
    };
  }

  /**
   * 基于 docx 库生成结构严谨、排版高保真的 Word 文档
   */
  public async createRichWordDocument(spec: RichDocxSpec): Promise<Buffer> {
    const children: Array<Paragraph | Table> = [];

    // 主标题
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 120 },
        children: [
          new TextRun({
            text: spec.title,
            bold: true,
            size: 36,
            color: '111827',
          }),
        ],
      }),
    );

    // 副标题
    if (spec.subtitle) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
          children: [
            new TextRun({
              text: spec.subtitle,
              italics: true,
              size: 24,
              color: '6B7280',
            }),
          ],
        }),
      );
    }

    // 分节内容
    for (const section of spec.sections) {
      if (section.heading) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 240, after: 120 },
            children: [
              new TextRun({
                text: section.heading,
                bold: true,
                size: 28,
                color: '1E6FFF',
              }),
            ],
          }),
        );
      }

      if (section.paragraphs) {
        for (const text of section.paragraphs) {
          children.push(
            new Paragraph({
              spacing: { before: 80, after: 80, line: 360 },
              children: [
                new TextRun({
                  text,
                  size: 24,
                  color: '374151',
                }),
              ],
            }),
          );
        }
      }

      if (section.table && section.table.headers.length > 0) {
        const tableRows: TableRow[] = [];

        // 表头
        tableRows.push(
          new TableRow({
            tableHeader: true,
            children: section.table.headers.map(
              (header) =>
                new TableCell({
                  shading: { fill: '1E6FFF' },
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({
                          text: header,
                          bold: true,
                          color: 'FFFFFF',
                          size: 22,
                        }),
                      ],
                    }),
                  ],
                }),
            ),
          }),
        );

        // 数据行
        for (const rowData of section.table.rows) {
          tableRows.push(
            new TableRow({
              children: rowData.map(
                (cellText) =>
                  new TableCell({
                    shading: { fill: 'FFFFFF' },
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: cellText,
                            size: 20,
                            color: '1F2937',
                          }),
                        ],
                      }),
                    ],
                  }),
              ),
            }),
          );
        }

        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: tableRows,
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
              insideVertical: { style: BorderStyle.NONE },
            },
          }),
        );
      }
    }

    const doc = new Document({
      creator: 'Agent_XXXXX Production Office Engine',
      sections: [
        {
          children,
        },
      ],
    });

    return await Packer.toBuffer(doc);
  }
}
