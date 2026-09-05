import { PROTOCOL_VERSION } from './protocol.js';
import type {
  AnyRuntimeEvent,
  RuntimeEvent,
  RuntimeEventPayloadMap,
  RuntimeEventType,
} from './protocol.js';

export type RuntimeClock = () => string;
export type RuntimeIdFactory = (prefix: string) => string;
export type RuntimeEventListener = (event: AnyRuntimeEvent) => void;

type EventInput<T extends RuntimeEventType> = Omit<RuntimeEvent<T>, 'id' | 'version' | 'sequence' | 'occurredAt'>;

export class EventLog {
  private readonly events: AnyRuntimeEvent[] = [];
  private readonly listeners = new Set<RuntimeEventListener>();
  private sequence = 0;

  public constructor(
    private readonly now: RuntimeClock,
    private readonly createId: RuntimeIdFactory,
  ) {}

  public append<T extends RuntimeEventType>(input: EventInput<T>): RuntimeEvent<T> {
    const event: RuntimeEvent<T> = {
      ...input,
      id: this.createId('event'),
      version: PROTOCOL_VERSION,
      sequence: ++this.sequence,
      occurredAt: this.now(),
    };
    const storedEvent = event as AnyRuntimeEvent;
    this.events.push(storedEvent);
    for (const listener of this.listeners) {
      listener(storedEvent);
    }
    return event;
  }

  public list(threadId: string): readonly AnyRuntimeEvent[] {
    return this.events.filter((event) => event.threadId === threadId);
  }

  public listAll(): readonly AnyRuntimeEvent[] {
    return [...this.events];
  }

  public subscribe(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public latest<T extends RuntimeEventType>(
    type: T,
    threadId: string,
  ): RuntimeEvent<T> | undefined {
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const event = this.events[index];
      if (event && event.threadId === threadId && event.type === type) {
        return event as RuntimeEvent<T>;
      }
    }
    return undefined;
  }
}

export type EventPayload<T extends RuntimeEventType> = RuntimeEventPayloadMap[T];
