import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppServer } from '../src/runtime/app-server.js';
import { DesktopSession } from '../src/desktop/session.js';
import { renderAppShell } from '../src/ui/render.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-desktop-session-'));
  roots.push(root);
  writeFileSync(join(root, 'meeting-notes.md'), '# Notes\nShip Friday.\n', 'utf8');
  writeFileSync(join(root, 'decisions.txt'), 'Owner: Maya\n', 'utf8');
  writeFileSync(join(root, 'sales.csv'), 'owner,amount\nMaya,120\n', 'utf8');
  return root;
}

function preparedSession(): DesktopSession {
  const session = new DesktopSession({ server: new AppServer() });
  session.selectWorkspace(workspace());
  session.setTaskInput('整理会议材料并生成 Word 报告');
  return session;
}

describe('DesktopSession', () => {
  it('exposes empty and ready UI states without leaking the Runtime', () => {
    const session = new DesktopSession({ server: new AppServer() });
    const empty = session.snapshot();
    expect(empty.home.state).toBe('empty');
    expect(empty.home.canSubmit).toBe(false);
    expect(empty.shell.readiness).toBe('empty');

    const ready = session.selectWorkspace(workspace());
    session.setTaskInput('生成报告');
    expect(ready.home.workspaceRoot).toBeDefined();
    expect(session.snapshot().home.canSubmit).toBe(true);
    expect(session.snapshot().workspaceFiles).toContain('sales.csv');
    expect(session.snapshot().workspaceFiles).toContain('meeting-notes.md');
    expect(session.snapshot().workspaceFiles).toContain('decisions.txt');
    expect(session.snapshot()).not.toHaveProperty('server');
    expect(JSON.stringify(session.snapshot())).not.toContain('AppServer');
    expect(JSON.stringify(session.snapshot())).not.toContain('Sandbox');
  });

  it('submits a plan into awaiting approval without starting a tool', () => {
    const session = preparedSession();
    const snapshot = session.submitPlan();

    expect(snapshot.route).toBe('task-plan');
    expect(snapshot.turn?.status).toBe('awaiting_approval');
    expect(snapshot.plan?.steps[0]?.toolName).toBe('workspace.write_report');
    expect(snapshot.approval).toMatchObject({ status: 'pending' });
    expect(snapshot.events.map((event) => event.type)).toEqual([
      'thread.created',
      'turn.started',
      'plan.proposed',
      'approval.requested',
    ]);
  });

  it('updates the snapshot after approval and produces a verified report', () => {
    const session = preparedSession();
    session.submitPlan();
    const snapshot = session.respondApproval('approved');

    expect(snapshot.approval?.status).toBe('approved');
    expect(snapshot.turn?.status).toBe('completed');
    expect(snapshot.events.some((event) => event.type === 'tool.completed')).toBe(true);
    expect(snapshot.events.some((event) => event.type === 'artifact.verified')).toBe(true);
  });

  it('supports rejection and stop without executing a tool', () => {
    const rejected = preparedSession();
    rejected.submitPlan();
    const rejectedSnapshot = rejected.respondApproval('rejected');
    expect(rejectedSnapshot.turn?.status).toBe('cancelled');
    expect(rejectedSnapshot.events.some((event) => event.type === 'tool.started')).toBe(false);

    const stopped = preparedSession();
    stopped.submitPlan();
    const stoppedSnapshot = stopped.stopTask();
    expect(stoppedSnapshot.thread?.status).toBe('cancelled');
    expect(stoppedSnapshot.turn?.status).toBe('cancelled');
    expect(stoppedSnapshot.events.some((event) => event.type === 'tool.started')).toBe(false);
  });

  it('supports full-access permission mode with automatic approval and execution', () => {
    const session = preparedSession();
    session.setPermissionMode('full-access');
    expect(session.snapshot().permissionMode).toBe('full-access');
    expect(session.snapshot().home.permissionMode).toBe('full-access');

    // In full-access mode, submitting a plan automatically approves and completes
    const snapshot = session.submitPlan();
    expect(snapshot.approval?.status).toBe('approved');
    expect(snapshot.turn?.status).toBe('completed');
    expect(snapshot.events.some((event) => event.type === 'tool.completed')).toBe(true);
    expect(snapshot.events.some((event) => event.type === 'artifact.verified')).toBe(true);
  });

  it('manages Codex-style ephemeral sessions, pinned sessions, and projects with folder binding', async () => {
    const session = new DesktopSession({ server: new AppServer() });

    // 1. 创建新临时会话
    const snap1 = await session.createSession({ title: '临时草稿会话' });
    expect(snap1.sessions).toBeDefined();
    expect(snap1.sessions?.length).toBe(1);
    const ephemeralId = snap1.sessions![0]!.id;
    expect(snap1.sessions![0]!.title).toBe('临时草稿会话');
    expect(snap1.sessions![0]!.projectId).toBeUndefined();

    // 2. 置顶会话
    const snap2 = await session.togglePinSession(ephemeralId);
    expect(snap2.sessions?.find((s) => s.id === ephemeralId)?.isPinned).toBe(true);

    // 3. 重命名会话
    const snap3 = await session.renameSession(ephemeralId, '已更名的草稿');
    expect(snap3.sessions?.find((s) => s.id === ephemeralId)?.title).toBe('已更名的草稿');

    // 4. 创建项目并绑定文件夹
    const projectFolder = workspace();
    const snap4 = await session.createProject('核心开发项目', projectFolder);
    expect(snap4.projects).toBeDefined();
    expect(snap4.projects?.length).toBe(1);
    const project = snap4.projects![0]!;
    expect(project.name).toBe('核心开发项目');
    expect(project.folderPath).toBe(projectFolder);

    // 项目创建后自动包含一个初始主会话
    const projectSessions = snap4.sessions?.filter((s) => s.projectId === project.id);
    expect(projectSessions?.length).toBe(1);
    expect(projectSessions![0]!.title).toBe('核心开发项目 - 主会话');

    // 验证 Codex 风格侧边栏 HTML 结构
    const renderedMarkup = renderAppShell(snap4.shell, {
      sessions: snap4.sessions,
      projects: snap4.projects,
      activeSessionId: snap4.activeSessionId,
    });
    expect(renderedMarkup).toContain('核心开发项目');
    expect(renderedMarkup).toContain(projectFolder);
    expect(renderedMarkup).toContain('在此项目创建新会话');
    // 确保 mock 文件概览彻底消除，不污染真实界面
    expect(renderedMarkup).not.toContain('工作区文件概览 (Files)');
    expect(renderedMarkup).not.toContain('sales.csv');

    // 5. 在该项目内创建第二个会话
    const snap5 = await session.createSession({
      projectId: project.id,
      title: '项目功能迭代分析',
    });
    const projSessionsAfter = snap5.sessions?.filter((s) => s.projectId === project.id);
    expect(projSessionsAfter?.length).toBe(2);

    // 6. 切换会话
    const snap6 = await session.switchSession(ephemeralId);
    expect(snap6.activeSessionId).toBe(ephemeralId);

    // 7. 删除临时会话
    const snap7 = await session.deleteSession(ephemeralId);
    expect(snap7.sessions?.some((s) => s.id === ephemeralId)).toBe(false);
  });
});
