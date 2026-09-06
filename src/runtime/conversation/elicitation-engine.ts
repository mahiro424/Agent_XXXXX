export interface ElicitationOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly recommended?: boolean;
}

export interface ElicitationRequest {
  readonly id: string;
  readonly turnId?: string;
  readonly question: string;
  readonly options: readonly ElicitationOption[];
  readonly allowCustomInput?: boolean;
  readonly createdAt: string;
}

export interface ElicitationResponse {
  readonly requestId: string;
  readonly selectedOptionId?: string;
  readonly customInput?: string;
  readonly respondedAt: string;
}

export class ElicitationEngine {
  private readonly pendingRequests = new Map<string, ElicitationRequest>();

  public createRequest(input: {
    id: string;
    turnId?: string;
    question: string;
    options: readonly ElicitationOption[];
    allowCustomInput?: boolean;
  }): ElicitationRequest {
    const req: ElicitationRequest = {
      ...input,
      createdAt: new Date().toISOString(),
    };
    this.pendingRequests.set(req.id, req);
    return req;
  }

  public getPendingRequest(id: string): ElicitationRequest | undefined {
    return this.pendingRequests.get(id);
  }

  public resolveRequest(id: string): ElicitationRequest | undefined {
    const req = this.pendingRequests.get(id);
    if (req) {
      this.pendingRequests.delete(id);
    }
    return req;
  }
}
