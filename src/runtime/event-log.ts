import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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

export interface RuntimeEventStore {
  load(): readonly AnyRuntimeEvent[];
  append(event: AnyRuntimeEvent): void;
}

export class FileEventStore implements RuntimeEventStore {
  public readonly filePath: string;

  public constructor(filePath: string) {
    this.filePath = resolve(filePath);
    mkdirSync(dirname(this.filePath), { recursive: true });
    if (!existsSync(this.filePath)) {
      writeFileSync(this.filePath, '', 'utf8');
    }
  }

  public load(): readonly AnyRuntimeEvent[] {
    const content = readFileSync(this.filePath, 'utf8');
    if (content.length === 0) {
      return [];
    }

    const lines = content.split('\n');
    const hasTrailingNewline = content.endsWith('\n');
    const completeLineCount = hasTrailingNewline ? lines.length - 1 : lines.length;
    const events: AnyRuntimeEvent[] = [];
    for (let index = 0; index < completeLineCount; index += 1) {
      const line = lines[index]?.trim() ?? '';
      if (line.length === 0) {
        continue;
      }
      try {
        events.push(parsePersistedEvent(JSON.parse(line), index + 1));
      } catch (error) {
        const isTrailingPartialLine = !hasTrailingNewline && index === completeLineCount - 1;
        if (isTrailingPartialLine) {
          break;
        }
        throw error;
      }
    }
    validateEventSequence(events);
    return events;
  }

  public append(event: AnyRuntimeEvent): void {
    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
  }
}

type EventInput<T extends RuntimeEventType> = Omit<
  RuntimeEvent<T>,
  'id' | 'version' | 'sequence' | 'occurredAt'
>;

export interface EventLogOptions {
  readonly store?: RuntimeEventStore;
  readonly initialEvents?: readonly AnyRuntimeEvent[];
}

export class EventLog {
  private readonly events: AnyRuntimeEvent[] = [];
  private readonly listeners = new Set<RuntimeEventListener>();
  private readonly store: RuntimeEventStore | undefined;
  private sequence = 0;

  public constructor(
    private readonly now: RuntimeClock,
    private readonly createId: RuntimeIdFactory,
    options: EventLogOptions = {},
  ) {
    this.store = options.store;
    const initialEvents = options.initialEvents ?? options.store?.load() ?? [];
    validateEventSequence(initialEvents);
    this.events.push(...initialEvents);
    this.sequence = initialEvents.at(-1)?.sequence ?? 0;
  }

  public append<T extends RuntimeEventType>(input: EventInput<T>): RuntimeEvent<T> {
    const event: RuntimeEvent<T> = {
      ...input,
      id: this.createId('event'),
      version: PROTOCOL_VERSION,
      sequence: this.sequence + 1,
      occurredAt: this.now(),
    };
    const storedEvent = event as AnyRuntimeEvent;
    this.store?.append(storedEvent);
    this.sequence = event.sequence;
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

export function maxNumericRuntimeId(events: readonly AnyRuntimeEvent[]): number {
  let maximum = 0;
  const serialized = JSON.stringify(events);
  for (const match of serialized.matchAll(/\b[a-z][a-z0-9-]*-(\d+)\b/g)) {
    const value = Number(match[1]);
    if (Number.isSafeInteger(value)) {
      maximum = Math.max(maximum, value);
    }
  }
  return maximum;
}

export type EventPayload<T extends RuntimeEventType> = RuntimeEventPayloadMap[T];

function parsePersistedEvent(value: unknown, lineNumber: number): AnyRuntimeEvent {
  if (!value || typeof value !== 'object') {
    throw new Error(`invalid runtime event at JSONL line ${lineNumber}`);
  }
  const event = value as Partial<AnyRuntimeEvent>;
  if (
    event.version !== PROTOCOL_VERSION ||
    typeof event.id !== 'string' ||
    typeof event.sequence !== 'number' ||
    !Number.isSafeInteger(event.sequence) ||
    typeof event.occurredAt !== 'string' ||
    typeof event.type !== 'string' ||
    typeof event.threadId !== 'string' ||
    event.payload === undefined
  ) {
    throw new Error(`invalid runtime event shape at JSONL line ${lineNumber}`);
  }
  return event as AnyRuntimeEvent;
}

function validateEventSequence(events: readonly AnyRuntimeEvent[]): void {
  let expected = 1;
  for (const event of events) {
    if (event.sequence !== expected) {
      throw new Error(
        `runtime event sequence is not contiguous: expected ${expected}, got ${event.sequence}`,
      );
    }
    expected += 1;
  }
}
