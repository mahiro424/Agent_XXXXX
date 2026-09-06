import { describe, expect, it } from 'vitest';
import {
  BRIDGE_PROTOCOL_VERSION,
  OptionalDesktopBridge,
  SAFE_BRIDGE_CAPABILITIES,
  createBridgeRequest,
} from '../src/runtime/bridge.js';
import type {
  BridgeRequest,
  BridgeResponse,
  DesktopBridgeAdapter,
} from '../src/runtime/bridge.js';

class DeterministicBridgeAdapter implements DesktopBridgeAdapter {
  public readonly requests: BridgeRequest[] = [];

  public invoke(request: BridgeRequest): BridgeResponse {
    this.requests.push(request);
    const evidence =
      request.capability === 'open_output_directory'
        ? { outputDirectory: request.outputDirectory ?? 'unknown-output' }
        : request.capability === 'read_window_state'
          ? { windowState: { visible: true, title: 'File Explorer' } }
          : { screenshotPath: 'task-output/bridge-shot.png' };
    return {
      version: BRIDGE_PROTOCOL_VERSION,
      requestId: request.requestId,
      capability: request.capability,
      status: 'completed',
      taskId: request.taskId,
      ...(request.turnId === undefined ? {} : { turnId: request.turnId }),
      ...(request.eventId === undefined ? {} : { eventId: request.eventId }),
      evidence,
    };
  }
}

function request(
  capability: BridgeRequest['capability'],
  overrides: Partial<BridgeRequest> = {},
): BridgeRequest {
  return createBridgeRequest({
    requestId: `request-${capability}`,
    capability,
    taskId: 'task-1',
    turnId: 'turn-1',
    eventId: 'event-1',
    authorization: { sandboxDecisionId: 'sandbox-decision-1' },
    ...overrides,
  });
}

describe('Optional Windows Bridge contract', () => {
  it('exposes only the three optional safe capabilities', () => {
    expect(SAFE_BRIDGE_CAPABILITIES).toEqual([
      'open_output_directory',
      'read_window_state',
      'capture_screenshot',
    ]);
    expect(SAFE_BRIDGE_CAPABILITIES).not.toContain('mouse_keyboard_takeover');
  });

  it('is disabled by default and reports an observable status', () => {
    const bridge = new OptionalDesktopBridge();
    const response = bridge.invoke(
      request('open_output_directory', { outputDirectory: 'task-output' }),
    );

    expect(response.status).toBe('disabled');
    expect(response.errorCode).toBe('bridge_disabled');
    expect(response.taskId).toBe('task-1');
    expect(response.turnId).toBe('turn-1');
  });

  it('requires a prior Sandbox decision before delegating to a sidecar', () => {
    const adapter = new DeterministicBridgeAdapter();
    const bridge = new OptionalDesktopBridge({ enabled: true, adapter });
    const response = bridge.invoke(
      request('open_output_directory', {
        outputDirectory: 'task-output',
        authorization: { sandboxDecisionId: '' },
      }),
    );

    expect(response.status).toBe('denied');
    expect(response.errorCode).toBe('sandbox_authorization_required');
    expect(adapter.requests).toHaveLength(0);
  });

  it('delegates allowed capabilities with task/turn/event correlation', () => {
    const adapter = new DeterministicBridgeAdapter();
    const bridge = new OptionalDesktopBridge({ enabled: true, adapter });

    const opened = bridge.invoke(
      request('open_output_directory', { outputDirectory: 'task-output' }),
    );
    const window = bridge.invoke(request('read_window_state'));
    const screenshot = bridge.invoke(request('capture_screenshot'));

    expect(opened).toMatchObject({ status: 'completed', evidence: { outputDirectory: 'task-output' } });
    expect(window).toMatchObject({ status: 'completed', evidence: { windowState: { visible: true } } });
    expect(screenshot).toMatchObject({
      status: 'completed',
      evidence: { screenshotPath: 'task-output/bridge-shot.png' },
    });
    expect(adapter.requests).toHaveLength(3);
    expect(adapter.requests.every((item) => item.taskId === 'task-1' && item.turnId === 'turn-1')).toBe(
      true,
    );
  });

  it('reports a missing sidecar and invalid output-directory request without pretending success', () => {
    const unavailable = new OptionalDesktopBridge({ enabled: true });
    expect(unavailable.invoke(request('read_window_state'))).toMatchObject({
      status: 'unavailable',
      errorCode: 'bridge_unavailable',
    });

    const adapter = new DeterministicBridgeAdapter();
    const bridge = new OptionalDesktopBridge({ enabled: true, adapter });
    expect(
      bridge.invoke(request('open_output_directory')),
    ).toMatchObject({
      status: 'failed',
      errorCode: 'invalid_request',
    });
    expect(adapter.requests).toHaveLength(0);
  });
});
