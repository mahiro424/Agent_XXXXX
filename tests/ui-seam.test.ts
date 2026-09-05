import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppServer } from '../src/runtime/app-server.js';
import { AppShellController } from '../src/ui/app-shell.js';
import { DemoHomeController } from '../src/ui/demo-home.js';
import {
  renderAppShell,
  renderDemoHome,
  renderEventTimeline,
  renderTaskPlan,
} from '../src/ui/render.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-ui-'));
  roots.push(root);
  return root;
}

describe('app-shell UI contract', () => {
  it('covers empty, disabled, and default shell readiness states', () => {
    const controller = new AppShellController({
      server: new AppServer(),
      modelConnected: true,
      sandboxReady: false,
    });

    expect(controller.view()).toMatchObject({
      pageId: 'app-shell',
      readiness: 'empty',
      disabledReason: '尚未选择本地工作区',
      network: 'disabled',
    });

    controller.selectWorkspace(workspace());
    expect(controller.view().readiness).toBe('default');

    controller.setModelConnected(false);
    expect(controller.view()).toMatchObject({
      readiness: 'disabled',
      disabledReason: '模型尚未连接',
    });
  });

  it('keeps a running thread alive while navigating and exposes tray stop', () => {
    const server = new AppServer();
    const thread = server.createThread({ workspaceId: 'memory-only' });
    const turn = server.startTurn({ threadId: thread.id, input: '读取材料' });
    const controller = new AppShellController({ server, sandboxReady: true });
    controller.selectWorkspace(workspace());
    controller.bindThread(thread, turn);

    controller.navigate('cases');
    controller.minimizeToTray();
    expect(controller.view()).toMatchObject({
      route: 'cases',
      threadId: thread.id,
      turnId: turn.id,
      threadStatus: 'active',
      turnStatus: 'awaiting_approval',
      minimizedToTray: true,
      canStopTask: true,
    });

    const stopped = controller.stopCurrentTask();
    expect(stopped?.status).toBe('cancelled');
    expect(server.getThread(thread.id).status).toBe('cancelled');
    controller.restoreFromTray();
    expect(controller.view().minimizedToTray).toBe(false);
  });
});

describe('demo-home UI contract', () => {
  it('covers empty, disabled, default, and loading-compatible submission states', () => {
    const root = workspace();
    const server = new AppServer();
    const controller = new DemoHomeController({ server });

    expect(controller.view()).toMatchObject({
      pageId: 'demo-home',
      state: 'empty',
      canSubmit: false,
      disabledReason: '尚未选择工作区',
    });

    controller.selectWorkspace(root);
    expect(controller.view()).toMatchObject({
      state: 'disabled',
      disabledReason: '输入任务后才能生成方案',
    });

    controller.setTaskInput('整理会议材料并生成 Word 报告');
    expect(controller.view()).toMatchObject({ state: 'default', canSubmit: true });

    const submission = controller.submit();
    expect(submission.route).toBe('task-plan');
    expect(submission.turn.status).toBe('awaiting_approval');
    expect(server.listEvents(submission.thread.id).map((event) => event.type)).toEqual([
      'thread.created',
      'turn.started',
      'plan.proposed',
      'approval.requested',
    ]);
  });

  it('does not pretend Live Model is available and supports quick-task input', () => {
    const controller = new DemoHomeController({
      server: new AppServer(),
      liveModelAvailable: false,
    });
    controller.selectWorkspace(workspace());
    controller.chooseQuickTask('读取销售数据并生成周报');
    controller.setModelMode('live');

    expect(controller.view()).toMatchObject({
      state: 'disabled',
      canSubmit: false,
      disabledReason: 'Live Model 尚未配置，当前可使用 Fake Model Demo',
      taskInput: '读取销售数据并生成周报',
    });
  });

  it('renders semantic app-shell and demo-home skeleton markup', () => {
    const server = new AppServer();
    const shell = new AppShellController({ server });
    const home = new DemoHomeController({ server });

    expect(renderAppShell(shell.view())).toContain('data-page="app-shell"');
    expect(renderAppShell(shell.view())).toContain('aria-label="主导航"');
    expect(renderDemoHome(home.view())).toContain('data-page="demo-home"');
    expect(renderDemoHome(home.view())).toContain('data-action="submit-plan"');
    expect(renderDemoHome(home.view())).toContain('尚未选择工作区');
  });

  it('renders plan approval controls and escaped event timeline entries', () => {
    const plan = renderTaskPlan({
      threadStatus: 'active',
      turnStatus: 'awaiting_approval',
      plan: {
        id: 'plan-1',
        turnId: 'turn-1',
        status: 'proposed',
        steps: [
          {
            id: 'step-1',
            title: '<读取材料>',
            toolName: 'workspace.read',
            risk: 'read',
            requiresApproval: true,
          },
        ],
      },
      approval: {
        id: 'approval-1',
        turnId: 'turn-1',
        planId: 'plan-1',
        status: 'pending',
        reason: '<需要用户确认>',
      },
    });
    const timeline = renderEventTimeline([
      {
        id: 'event-1',
        version: 1,
        sequence: 1,
        occurredAt: '2026-09-05T00:00:00.000Z',
        type: 'approval.requested',
        threadId: 'thread-1',
        payload: { reason: '<safe>' },
      },
    ]);

    expect(plan).toContain('data-action="approve-plan"');
    expect(plan).toContain('data-action="reject-plan"');
    expect(plan).toContain('&lt;读取材料&gt;');
    expect(timeline).toContain('data-event-type="approval.requested"');
    expect(timeline).toContain('&lt;safe&gt;');
  });
});
