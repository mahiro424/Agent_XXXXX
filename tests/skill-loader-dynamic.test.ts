import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import {
  parseSkillMarkdown,
  loadSkillFromFile,
  scanWorkspaceSkills,
} from '../src/runtime/skill-loader.js';
import { SkillRegistry, BUILTIN_SKILLS } from '../src/runtime/skill.js';
import { pruneToolsForSkill } from '../src/runtime/engine.js';
import type { AgentToolDefinition } from '../src/runtime/model-provider.js';

describe('Skill Engine 2.0: SKILL.md Loader, Dynamic Workspace Discovery & Tool Pruning', () => {
  const tempDirs: string[] = [];

  function createTempDir(prefix: string): string {
    const base = join(process.cwd(), '.test-tmp');
    const dir = join(base, `skill-test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of tempDirs) {
      try {
        if (existsSync(d)) {
          rmSync(d, { recursive: true, force: true });
        }
      } catch {
        // ignore
      }
    }
  });

  it('parses standard SKILL.md frontmatter and markdown SOP body', () => {
    const markdown = `---
id: sales-forecaster
name: 销售趋势预测
icon: 📈
description: 专门分析年度销售报表并给出环比预测
requiredTools:
  - workspace.read_file
  - office.process_excel
optionalMcp:
  - sqlite
temperature: 0.2
---

# 角色定义
你是一位高级商业趋势预测专家。

## 标准流程
1. 读取销售历史数据
2. 计算季度复合增长率
3. 生成带图表样式的预测报告
`;

    const skill = parseSkillMarkdown(markdown);
    expect(skill.id).toBe('sales-forecaster');
    expect(skill.name).toBe('销售趋势预测');
    expect(skill.icon).toBe('📈');
    expect(skill.description).toBe('专门分析年度销售报表并给出环比预测');
    expect(skill.requiredTools).toEqual(['workspace.read_file', 'office.process_excel']);
    expect(skill.allowedMcpServers).toEqual(['sqlite']);
    expect(skill.temperature).toBe(0.2);
    expect(skill.systemPrompt).toContain('你是一位高级商业趋势预测专家');
    expect(skill.systemPrompt).toContain('3. 生成带图表样式的预测报告');
  });

  it('dynamically scans and registers skills from workspace .agent/skills/ directory', () => {
    const ws = createTempDir('dynamic-ws');
    const skillDir = join(ws, '.agent', 'skills', 'custom-audit');
    mkdirSync(skillDir, { recursive: true });

    const skillContent = `---
id: audit-expert
name: 财务审计助手
icon: 📑
description: 审计账目并校验发票
requiredTools:
  - workspace.read_file
---
# 审计规程
全面核对收入与支出账目。
`;
    writeFileSync(join(skillDir, 'SKILL.md'), skillContent, 'utf8');

    const discovered = scanWorkspaceSkills(ws);
    expect(discovered.length).toBe(1);
    expect(discovered[0]?.id).toBe('audit-expert');
    expect(discovered[0]?.name).toBe('财务审计助手');

    // Register into SkillRegistry
    const registry = new SkillRegistry();
    expect(registry.list().length).toBe(BUILTIN_SKILLS.length);

    registry.scanWorkspace(ws);
    expect(registry.list().length).toBe(BUILTIN_SKILLS.length + 1);
    expect(registry.get('audit-expert')?.description).toBe('审计账目并校验发票');
  });

  it('prunes tools dynamically according to active skill requirements (Tool Pruning)', () => {
    const allTools: AgentToolDefinition[] = [
      { name: 'workspace.read_file', description: '读文件', risk: 'read', requiresApproval: false },
      { name: 'workspace.write_file', description: '写文件', risk: 'write', requiresApproval: true },
      { name: 'workspace.list_files', description: '列出文件', risk: 'read', requiresApproval: false },
      { name: 'office.process_excel', description: '处理表格', risk: 'write', requiresApproval: false },
      { name: 'office.generate_word_report', description: '生成Word', risk: 'write', requiresApproval: false },
      { name: 'mcp.sqlite.query', description: '查询数据库', risk: 'read', requiresApproval: false },
      { name: 'mcp.github.create_pr', description: '建PR', risk: 'write', requiresApproval: true },
    ];

    // Case 1: No active skill or no required tools -> keeps all
    const unpruned = pruneToolsForSkill(allTools, undefined);
    expect(unpruned.length).toBe(allTools.length);

    // Case 2: Skill specifies requiredTools and allowedMcpServers
    const activeSkill = {
      id: 'excel-only',
      name: 'Excel 专精',
      icon: '📊',
      description: '仅处理表格',
      systemPrompt: 'prompt',
      recommendedTools: ['workspace.read_file', 'office.process_excel'],
      requiredTools: ['office.process_excel'],
      allowedMcpServers: ['sqlite'],
    };

    const pruned = pruneToolsForSkill(allTools, activeSkill);
    const toolNames = pruned.map((t) => t.name);

    // Essential read/list tools must be retained
    expect(toolNames).toContain('workspace.read_file');
    expect(toolNames).toContain('workspace.list_files');
    // Required tool retained
    expect(toolNames).toContain('office.process_excel');
    // Allowed MCP server tool retained
    expect(toolNames).toContain('mcp.sqlite.query');

    // Non-allowed tools pruned
    expect(toolNames).not.toContain('office.generate_word_report');
    expect(toolNames).not.toContain('workspace.write_file');
    expect(toolNames).not.toContain('mcp.github.create_pr');
  });
});
