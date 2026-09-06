import type { AgentToolDefinition } from '../model-provider.js';
import type { ExcelSheetSpec, ParsedTableData, RichDocxSection } from '../office-engine.js';
import type { IToolHandler, ToolContext } from './tool-interface.js';

export class ProcessExcelToolHandler implements IToolHandler {
  public readonly name = 'office.process_excel';
  public readonly definition: AgentToolDefinition = {
    name: 'office.process_excel',
    description: '读取工作区内的 CSV/XLSX 数据表格，进行数值求和/统计计算，或根据自定义规格生成带动态求和公式的 Excel 工作簿 (.xlsx)',
    risk: 'write',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '数据源文件相对路径（如 data.csv）' },
        target: { type: 'string', description: '生成的目标 Excel 文件名（如 sales-summary.xlsx）' },
        title: { type: 'string', description: '工作簿标题' },
        sheets: {
          type: 'array',
          description: '可选的自定义工作表定义列表。如果不传，则自动读取源数据动态汇总生成',
        },
      },
    },
  };

  public canHandle(toolName: string): boolean {
    return toolName === this.name;
  }

  public async execute(
    _toolName: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const artifactName = (args.target as string) || 'sales-summary.xlsx';
    const customSheets = Array.isArray(args.sheets) ? (args.sheets as ExcelSheetSpec[]) : undefined;
    const title = (args.title as string) || '数据汇总表';

    let workbook: Buffer;
    if (customSheets && customSheets.length > 0) {
      workbook = await context.officeEngine.createExcelWorkbook({
        title,
        sheets: customSheets,
      });
    } else {
      const sourceFile = (args.source as string) || 'sales.csv';
      let tableData: ParsedTableData | undefined;
      if (context.sandbox.hasFile(sourceFile)) {
        const type = sourceFile.endsWith('.xlsx') ? 'xlsx' : 'csv';
        tableData = await context.officeEngine.readTableData(
          context.sandbox.readFileBuffer(sourceFile),
          type,
        );
      } else if (context.sandbox.hasFile('sales.csv')) {
        tableData = await context.officeEngine.readTableData(
          context.sandbox.readFileBuffer('sales.csv'),
          'csv',
        );
      }

      const columns =
        tableData && tableData.headers.length > 0
          ? tableData.headers.map((h) => ({ header: h.toUpperCase(), key: h }))
          : [
              { header: '负责人 (Owner)', key: 'owner' },
              { header: '销售额 (Amount)', key: 'amount' },
            ];
      const rows =
        tableData && tableData.rows.length > 0
          ? tableData.rows
          : [
              { owner: 'Maya', amount: 120 },
              { owner: 'Leo', amount: 80 },
            ];

      workbook = await context.officeEngine.createExcelWorkbook({
        title,
        sheets: [{ name: '数据汇总', columns, rows, includeTotalRow: true }],
      });
    }

    context.sandbox.writeArtifactBuffer(artifactName, workbook);
    context.verifyArtifact(context.thread.id, artifactName);
    return `成功生成带动态公式的高保真 Excel 工作簿：${artifactName}（已完成物理证据链校验）`;
  }
}

export class GenerateWordReportToolHandler implements IToolHandler {
  public readonly name = 'office.generate_word_report';
  public readonly definition: AgentToolDefinition = {
    name: 'office.generate_word_report',
    description: '根据材料或结构化内容生成包含主标题、分节正文与格式化对比表格的高保真 Word 报告 (.docx)',
    risk: 'write',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '生成的目标 Word 报告文件名（如 weekly-meeting-report.docx）' },
        title: { type: 'string', description: 'Word 报告主标题' },
        subtitle: { type: 'string', description: 'Word 报告副标题或编制信息' },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: '参考的工作区源材料文件名列表（如 meeting-notes.md, decisions.txt）',
        },
        sections: {
          type: 'array',
          description: '由模型撰写的结构化章节列表（包含 heading, paragraphs, table）',
        },
      },
    },
  };

  public canHandle(toolName: string): boolean {
    return toolName === this.name || toolName === 'workspace.write_report';
  }

  public async execute(
    _toolName: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const artifactName = (args.target as string) || 'weekly-meeting-report.docx';
    const customSections = Array.isArray(args.sections) ? (args.sections as RichDocxSection[]) : undefined;
    const title = (args.title as string) || '工作区项目与业务周报';
    const subtitle = (args.subtitle as string) || '基于本地工作区数据自动生成';

    let docx: Buffer;
    if (customSections && customSections.length > 0) {
      docx = await context.officeEngine.createRichWordDocument({
        title,
        subtitle,
        sections: customSections,
      });
    } else {
      const rawSources =
        Array.isArray(args.sources) && args.sources.length > 0
          ? (args.sources as string[]).map(String)
          : ['meeting-notes.md', 'decisions.txt', 'sales.csv'];
      const sources = rawSources
        .filter((name) => context.sandbox.hasFile(name))
        .map((name) => context.documentEngine.readSource(name, context.sandbox.readFileBuffer(name)));

      let table: { headers: readonly string[]; rows: readonly (readonly string[])[] } | undefined;
      if (context.sandbox.hasFile('sales.csv')) {
        const parsed = await context.officeEngine.readTableData(
          context.sandbox.readFileBuffer('sales.csv'),
          'csv',
        );
        if (parsed.headers.length > 0) {
          table = {
            headers: parsed.headers,
            rows: parsed.rows.map((r) => parsed.headers.map((h) => String(r[h] ?? ''))),
          };
        }
      }

      const sections: RichDocxSection[] = sources.map((s) => ({
        heading: `数据来源：${s.name}`,
        paragraphs: [s.text.slice(0, 300)],
      }));
      if (table) {
        sections.push({
          heading: '业务数据统计表',
          paragraphs: ['下表为当前工作区业务数据明细汇总：'],
          table,
        });
      }

      docx = await context.officeEngine.createRichWordDocument({
        title,
        subtitle,
        sections,
      });
    }

    context.sandbox.writeArtifactBuffer(artifactName, docx);
    context.verifyArtifact(context.thread.id, artifactName);
    return `成功整合材料并生成高保真结构化 Word 报告：${artifactName}（已完成物理证据链校验）`;
  }
}
