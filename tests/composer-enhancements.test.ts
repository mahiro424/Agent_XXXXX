import { describe, expect, it } from 'vitest';
import { DefaultApprovalPolicy } from '../src/runtime/approval-policy.js';
import { DemoHomeController } from '../src/ui/demo-home.js';
import { AppServer } from '../src/runtime/app-server.js';
import { DesktopSession } from '../src/desktop/session.js';
import { renderComposerCard, formatTokens } from '../src/ui/render.js';
import type { AttachmentItem } from '../src/runtime/protocol.js';

describe('Composer Enhancements (EvoX-inspired)', () => {
  describe('5-Tier Approval Policy', () => {
    it('handles full-access tier by allowing reads and writes without prompting', () => {
      const policy = new DefaultApprovalPolicy();
      policy.setTier('full-access');
      expect(policy.getTier()).toBe('full-access');

      expect(policy.decide({ operation: 'read', targetPath: 'data.csv' }).decision).toBe('allowed');
      expect(policy.decide({ operation: 'workspace_write', targetPath: 'data.csv' }).decision).toBe('allowed');
    });

    it('handles auto tier by allowing edits but requiring approval on destructive or external ops', () => {
      const policy = new DefaultApprovalPolicy();
      policy.setTier('auto');

      expect(policy.decide({ operation: 'read', targetPath: 'data.csv' }).decision).toBe('allowed');
      expect(policy.decide({ operation: 'workspace_write', targetPath: 'data.csv' }).decision).toBe('allowed');
      expect(policy.decide({ operation: 'overwrite_input', targetPath: 'inputs/data.csv' }).decision).toBe('approval_required');
      expect(policy.decide({ operation: 'external_access', targetPath: 'C:/external' }).decision).toBe('approval_required');
    });

    it('handles accept-edits tier by allowing artifact writes and prompting for general writes', () => {
      const policy = new DefaultApprovalPolicy();
      policy.setTier('accept-edits');

      expect(policy.decide({ operation: 'read', targetPath: 'data.csv' }).decision).toBe('allowed');
      expect(policy.decide({ operation: 'write_artifact', targetPath: 'artifacts/res.xlsx' }).decision).toBe('allowed');
      expect(policy.decide({ operation: 'workspace_write', targetPath: 'data.csv' }).decision).toBe('approval_required');
      expect(policy.decide({ operation: 'external_access', targetPath: 'C:/external' }).decision).toBe('approval_required');
    });

    it('handles risk-gated tier by allowing read and requiring review for writes', () => {
      const policy = new DefaultApprovalPolicy();
      policy.setTier('risk-gated');

      expect(policy.decide({ operation: 'read', targetPath: 'data.csv' }).decision).toBe('allowed');
      expect(policy.decide({ operation: 'workspace_write', targetPath: 'data.csv' }).decision).toBe('approval_required');
    });

    it('handles ask-approval tier by requiring approval for writes and external access', () => {
      const policy = new DefaultApprovalPolicy();
      policy.setTier('ask-approval');

      expect(policy.decide({ operation: 'read', targetPath: 'data.csv' }).decision).toBe('allowed');
      expect(policy.decide({ operation: 'workspace_write', targetPath: 'data.csv' }).decision).toBe('approval_required');
    });
  });

  describe('Attachment Management & DemoHomeController', () => {
    it('allows adding, removing, and clearing attachments', () => {
      const server = new AppServer();
      const controller = new DemoHomeController({ server });

      const item1: AttachmentItem = {
        id: 'att-1',
        name: 'data.xlsx',
        path: 'C:/data.xlsx',
        size: 2048,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
      const item2: AttachmentItem = {
        id: 'att-2',
        name: 'chart.png',
        path: 'C:/chart.png',
        size: 512,
        type: 'image/png',
      };

      controller.addAttachment(item1);
      controller.addAttachment(item2);
      expect(controller.view().attachments).toHaveLength(2);
      expect(controller.view().attachments[0]?.name).toBe('data.xlsx');

      controller.removeAttachment('att-1');
      expect(controller.view().attachments).toHaveLength(1);
      expect(controller.view().attachments[0]?.name).toBe('chart.png');

      controller.clearAttachments();
      expect(controller.view().attachments).toHaveLength(0);
    });

    it('allows setting reasoning effort in controller', () => {
      const server = new AppServer();
      const controller = new DemoHomeController({ server });

      expect(controller.view().reasoningEffort).toBe('max');
      controller.setReasoningEffort('medium');
      expect(controller.view().reasoningEffort).toBe('medium');
      controller.setReasoningEffort('off');
      expect(controller.view().reasoningEffort).toBe('off');
    });
  });

  describe('DesktopSession & Context Compaction', () => {
    it('supports attachments and serializes them into input prompt', async () => {
      const session = new DesktopSession({ server: new AppServer() });
      session.selectWorkspace('E:/Agent');
      session.addAttachment({
        id: 'att-test',
        name: 'report.docx',
        path: 'E:/Agent/report.docx',
        size: 4096,
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      const snapshot = session.snapshot();
      expect(snapshot.home.attachments).toHaveLength(1);

      // Session sendMessage serializes attachments into prompt and clears attachments
      await session.sendMessage('请分析这份报告');
      const messages = session.snapshot().messages ?? [];
      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg).toBeDefined();
      expect(userMsg?.content).toContain('请分析这份报告');
      expect(userMsg?.content).toContain('<attachments>');
      expect(userMsg?.content).toContain('report.docx');
      expect(userMsg?.content).toContain('</attachments>');

      // Attachments should be cleared for subsequent input
      expect(session.snapshot().home.attachments).toHaveLength(0);
    });

    it('intercepts /compact slash command and triggers compaction', async () => {
      const session = new DesktopSession({ server: new AppServer() });
      session.selectWorkspace('E:/Agent');
      await session.sendMessage('初始任务');

      // Type /compact command
      const afterCompact = await session.sendMessage('/compact');
      expect(afterCompact.home.isCompacting).toBe(false);

      const messagesAfter = session.snapshot().messages ?? [];
      expect(messagesAfter.some((m) => m.content.includes('[系统上下文整理与记忆压缩]'))).toBe(true);

      const tokenSnap = session.computeTokenSnapshot();
      expect(tokenSnap.usedTokens).toBeGreaterThan(0);
      expect(tokenSnap.contextWindow).toBe(128000);
    });

    it('formats token counters properly', () => {
      expect(formatTokens(500)).toBe('500');
      expect(formatTokens(1500)).toBe('2k');
      expect(formatTokens(24000)).toBe('24k');
      expect(formatTokens(1500000)).toBe('1.5M');
    });
  });

  describe('Composer Card UI Rendering', () => {
    it('renders attachment trigger, token ring, tier selector, and popover', () => {
      const server = new AppServer();
      const controller = new DemoHomeController({ server });
      controller.addAttachment({
        id: 'a1',
        name: 'demo.pdf',
        path: '/path/to/demo.pdf',
        size: 1024,
        type: 'application/pdf',
      });
      controller.setPermissionMode('accept-edits');
      controller.setReasoningEffort('high');

      const markup = renderComposerCard(controller.view());

      expect(markup).toContain('id="composer-card"');
      expect(markup).toContain('data-action="open-file-picker"');
      expect(markup).toContain('demo.pdf');
      expect(markup).toContain('class="ring-svg"');
      expect(markup).toContain('data-action="toggle-context-panel"');
      expect(markup).toContain('data-action="compact-context"');
      expect(markup).toContain('data-action="set-reasoning-effort"');
      expect(markup).toContain('data-action="set-permission-mode"');
      expect(markup).toContain('value="accept-edits" selected');
      expect(markup).toContain('value="high" selected');
      expect(markup).not.toContain('sandbox-artifacts');
      expect(markup).not.toContain('沙箱写保护');
    });

    it('allocates an ephemeral scratchpad CWD when sending message without selected workspace', async () => {
      const session = new DesktopSession({ server: new AppServer() });
      const snapshot = await session.sendMessage('临时对话：写一个简单的问候');
      expect(snapshot.messages).toBeDefined();
      expect(snapshot.messages?.length).toBeGreaterThanOrEqual(2);
    });
  });
});
