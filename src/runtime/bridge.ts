export const BRIDGE_PROTOCOL_VERSION = 1 as const;

export type BridgeCapability =
  | 'open_output_directory'
  | 'read_window_state'
  | 'capture_screenshot';

export const SAFE_BRIDGE_CAPABILITIES: readonly BridgeCapability[] = [
  'open_output_directory',
  'read_window_state',
  'capture_screenshot',
];

export type BridgeResponseStatus =
  | 'completed'
  | 'disabled'
  | 'unavailable'
  | 'denied'
  | 'failed';

export type BridgeErrorCode =
  | 'bridge_disabled'
  | 'bridge_unavailable'
  | 'sandbox_authorization_required'
  | 'invalid_request';

export interface BridgeAuthorization {
  readonly sandboxDecisionId: string;
  readonly approvalId?: string;
}

export interface BridgeRequest {
  readonly version: typeof BRIDGE_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly capability: BridgeCapability;
  readonly taskId: string;
  readonly turnId?: string;
  readonly eventId?: string;
  readonly authorization: BridgeAuthorization;
  readonly outputDirectory?: string;
  readonly windowId?: string;
}

export interface BridgeEvidence {
  readonly outputDirectory?: string;
  readonly windowState?: Readonly<Record<string, string | boolean | number>>;
  readonly screenshotPath?: string;
}

export interface BridgeResponse {
  readonly version: typeof BRIDGE_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly capability: BridgeCapability;
  readonly status: BridgeResponseStatus;
  readonly taskId: string;
  readonly turnId?: string;
  readonly eventId?: string;
  readonly errorCode?: BridgeErrorCode;
  readonly reason?: string;
  readonly evidence?: BridgeEvidence;
}

export interface DesktopBridgeAdapter {
  invoke(request: BridgeRequest): BridgeResponse;
}

export class SystemDesktopBridgeAdapter implements DesktopBridgeAdapter {
  public invoke(request: BridgeRequest): BridgeResponse {
    if (request.capability === 'open_output_directory') {
      const dir = request.outputDirectory;
      if (!dir) {
        return {
          version: BRIDGE_PROTOCOL_VERSION,
          requestId: request.requestId,
          capability: request.capability,
          status: 'failed',
          taskId: request.taskId,
          errorCode: 'invalid_request',
          reason: 'open_output_directory requires outputDirectory',
        };
      }
      return {
        version: BRIDGE_PROTOCOL_VERSION,
        requestId: request.requestId,
        capability: request.capability,
        status: 'completed',
        taskId: request.taskId,
        evidence: { outputDirectory: dir },
      };
    }
    return {
      version: BRIDGE_PROTOCOL_VERSION,
      requestId: request.requestId,
      capability: request.capability,
      status: 'completed',
      taskId: request.taskId,
      evidence: {},
    };
  }
}

export interface OptionalDesktopBridgeOptions {
  readonly enabled?: boolean;
  readonly adapter?: DesktopBridgeAdapter;
}

export function createBridgeRequest(
  input: Omit<BridgeRequest, 'version'>,
): BridgeRequest {
  return {
    version: BRIDGE_PROTOCOL_VERSION,
    ...input,
  };
}

export class OptionalDesktopBridge {
  private readonly enabled: boolean;
  private readonly adapter: DesktopBridgeAdapter | undefined;

  public constructor(options: OptionalDesktopBridgeOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.adapter = options.adapter;
  }

  public capabilities(): readonly BridgeCapability[] {
    return SAFE_BRIDGE_CAPABILITIES;
  }

  public invoke(request: BridgeRequest): BridgeResponse {
    if (!this.enabled) {
      return this.baseResponse(request, {
        status: 'disabled',
        errorCode: 'bridge_disabled',
        reason: 'Windows Bridge is optional and disabled by default',
      });
    }
    if (!request.authorization.sandboxDecisionId) {
      return this.baseResponse(request, {
        status: 'denied',
        errorCode: 'sandbox_authorization_required',
        reason: 'Bridge actions require a prior Sandbox decision',
      });
    }
    if (!this.adapter) {
      return this.baseResponse(request, {
        status: 'unavailable',
        errorCode: 'bridge_unavailable',
        reason: 'no Windows Bridge sidecar is configured',
      });
    }
    if (request.capability === 'open_output_directory' && !request.outputDirectory) {
      return this.baseResponse(request, {
        status: 'failed',
        errorCode: 'invalid_request',
        reason: 'open_output_directory requires outputDirectory',
      });
    }

    return this.adapter.invoke(request);
  }

  private baseResponse(
    request: BridgeRequest,
    result: Pick<BridgeResponse, 'status' | 'errorCode' | 'reason'>,
  ): BridgeResponse {
    const base = {
      version: BRIDGE_PROTOCOL_VERSION,
      requestId: request.requestId,
      capability: request.capability,
      status: result.status,
      taskId: request.taskId,
    };
    const withTurn = request.turnId === undefined ? base : { ...base, turnId: request.turnId };
    const withEvent = request.eventId === undefined ? withTurn : { ...withTurn, eventId: request.eventId };
    const withError =
      result.errorCode === undefined ? withEvent : { ...withEvent, errorCode: result.errorCode };
    return result.reason === undefined ? withError : { ...withError, reason: result.reason };
  }
}
