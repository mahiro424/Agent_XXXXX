import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { AgentSkill } from './skill.js';

export interface SkillFrontmatter {
  id?: string;
  name?: string;
  icon?: string;
  description?: string;
  requiredTools?: string[];
  recommendedTools?: string[];
  optionalMcp?: string[];
  temperature?: number;
}

/**
 * 健壮的零依赖 YAML/JSON Frontmatter 解析器
 */
export function parseSkillMarkdown(content: string, filePath?: string): AgentSkill {
  const lines = content.split(/\r?\n/);
  const frontmatter: SkillFrontmatter = {};
  let bodyStartIndex = 0;

  if (lines.length > 0 && lines[0]?.trim() === '---') {
    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]?.trim() === '---') {
        endIndex = i;
        break;
      }
    }

    if (endIndex > 0) {
      const fmLines = lines.slice(1, endIndex);
      bodyStartIndex = endIndex + 1;

      let currentArrayKey: string | null = null;
      for (const line of fmLines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          continue;
        }

        // 匹配 array item: "- value"
        if (trimmed.startsWith('-') && currentArrayKey) {
          const itemVal = trimmed.slice(1).trim().replace(/^['"]|['"]$/g, '');
          if (currentArrayKey === 'requiredTools') {
            frontmatter.requiredTools = frontmatter.requiredTools ?? [];
            frontmatter.requiredTools.push(itemVal);
          } else if (currentArrayKey === 'recommendedTools') {
            frontmatter.recommendedTools = frontmatter.recommendedTools ?? [];
            frontmatter.recommendedTools.push(itemVal);
          } else if (currentArrayKey === 'optionalMcp') {
            frontmatter.optionalMcp = frontmatter.optionalMcp ?? [];
            frontmatter.optionalMcp.push(itemVal);
          }
          continue;
        }

        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim();
          const rawVal = line.slice(colonIdx + 1).trim();

          if (rawVal === '' || rawVal.startsWith('#')) {
            currentArrayKey = key;
          } else {
            currentArrayKey = null;
            const val = rawVal.replace(/^['"]|['"]$/g, '');

            if (key === 'id') frontmatter.id = val;
            else if (key === 'name') frontmatter.name = val;
            else if (key === 'icon') frontmatter.icon = val;
            else if (key === 'description') frontmatter.description = val;
            else if (key === 'temperature') frontmatter.temperature = Number.parseFloat(val);
            else if (key === 'requiredTools' || key === 'recommendedTools' || key === 'optionalMcp') {
              if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
                const items = rawVal
                  .slice(1, -1)
                  .split(',')
                  .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
                  .filter(Boolean);
                if (key === 'requiredTools') frontmatter.requiredTools = items;
                if (key === 'recommendedTools') frontmatter.recommendedTools = items;
                if (key === 'optionalMcp') frontmatter.optionalMcp = items;
              }
            }
          }
        }
      }
    }
  }

  const bodyContent = lines.slice(bodyStartIndex).join('\n').trim();

  // 如果没有显式 id，从父文件夹或文件名推断
  const inferredId = filePath
    ? basename(dirname(filePath)) !== 'skills'
      ? basename(dirname(filePath))
      : basename(filePath, '.md')
    : 'custom-skill';

  const id = frontmatter.id || inferredId;
  const name = frontmatter.name || id;
  const icon = frontmatter.icon || '🪄';
  const description = frontmatter.description || name;
  const systemPrompt = bodyContent.length > 0 ? bodyContent : description;

  const tools = [
    ...(frontmatter.requiredTools ?? []),
    ...(frontmatter.recommendedTools ?? []),
  ];
  const uniqueTools = Array.from(new Set(tools));

  return {
    id,
    name,
    icon,
    description,
    systemPrompt,
    recommendedTools: uniqueTools.length > 0 ? uniqueTools : ['workspace.read_file'],
    requiredTools: frontmatter.requiredTools,
    allowedMcpServers: frontmatter.optionalMcp,
    temperature: frontmatter.temperature,
    isBuiltin: false,
    filePath,
  };
}

export function loadSkillFromFile(filePath: string): AgentSkill | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    const content = readFileSync(filePath, 'utf8');
    return parseSkillMarkdown(content, filePath);
  } catch (err) {
    console.warn(`[SkillLoader] Failed to load skill from ${filePath}:`, err);
    return undefined;
  }
}

export function scanWorkspaceSkills(workspacePath: string): readonly AgentSkill[] {
  const discovered: AgentSkill[] = [];
  const searchDirs = [
    join(workspacePath, '.agent', 'skills'),
    join(workspacePath, 'skills'),
  ];

  for (const dir of searchDirs) {
    if (!existsSync(dir)) {
      continue;
    }
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const entryPath = join(dir, entry);
        const stat = statSync(entryPath);

        if (stat.isDirectory()) {
          const skillMd = join(entryPath, 'SKILL.md');
          const skill = loadSkillFromFile(skillMd);
          if (skill) {
            discovered.push(skill);
          }
        } else if (stat.isFile() && entry.endsWith('.md')) {
          const skill = loadSkillFromFile(entryPath);
          if (skill) {
            discovered.push(skill);
          }
        }
      }
    } catch (err) {
      console.warn(`[SkillLoader] Error scanning skills in ${dir}:`, err);
    }
  }

  return discovered;
}
