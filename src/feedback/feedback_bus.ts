import {
  expectedPrivacyClass,
  FEEDBACK_SCHEMA_VERSION,
  type FeedbackEventKind,
  type FeedbackEventV1,
} from "./contracts.generated";

export type FeedbackConsentMode = "disabled" | "local" | "share-on-export";

export interface FeedbackStoreStatus {
  readonly consentMode: FeedbackConsentMode;
  readonly eventCount: number;
  readonly logicalBytes: number;
  readonly databaseSchemaVersion: number;
  readonly eventSchemaVersion: number;
}

export interface FeedbackBatchReceipt {
  readonly accepted: number;
  readonly duplicates: number;
  readonly persistedAtUnixMs: number;
}

export interface FeedbackEventPage {
  readonly events: readonly FeedbackEventV1[];
  readonly hasMore: boolean;
}

export interface FeedbackQuery {
  readonly sessionId?: string;
  readonly kind?: FeedbackEventKind;
  readonly beforeUnixMs?: number;
  readonly afterUnixMs?: number;
  readonly limit?: number;
}

export interface FeedbackDeleteReceipt {
  readonly rowsDeleted: number;
  readonly attachmentsDeleted: number;
}

export type FeedbackDeleteRequest =
  | { readonly scope: "all" | "expired"; readonly sessionId?: never }
  | { readonly scope: "session"; readonly sessionId: string };

export interface FeedbackTransport {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

type FeedbackEventByKind<K extends FeedbackEventKind> = Extract<
  FeedbackEventV1,
  { readonly kind: K }
>;
export type FeedbackPayload<K extends FeedbackEventKind> =
  FeedbackEventByKind<K>["payload"];

export interface FeedbackEmitOptions {
  readonly runId?: string;
  readonly workspaceId?: string;
  readonly gitRevision?: string;
  readonly userContentConfirmed?: boolean;
}

export interface FeedbackBusMetrics {
  readonly queued: number;
  readonly dropped: number;
  readonly flushFailures: number;
}

interface QueuedEvent {
  readonly event: FeedbackEventV1;
  readonly bytes: number;
  readonly userContentConfirmed: boolean;
}

export interface FeedbackBusOptions {
  readonly transport: FeedbackTransport;
  readonly sessionId: string;
  readonly appVersion: string;
  readonly flushIntervalMs?: number;
  readonly maxQueueEvents?: number;
  readonly maxBatchEvents?: number;
  readonly maxBatchBytes?: number;
  readonly now?: () => number;
  readonly createId?: () => string;
}

const DEFAULT_FLUSH_INTERVAL_MS = 250;
const DEFAULT_MAX_QUEUE_EVENTS = 4096;
const DEFAULT_MAX_BATCH_EVENTS = 100;
const DEFAULT_MAX_BATCH_BYTES = 1024 * 1024;
const MAX_EVENT_BYTES = 64 * 1024;
const PERFORMANCE_KIND: FeedbackEventKind = "performance.sampled";

let fallbackId = 0;

function createEventId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackId += 1;
  return `event-${Date.now()}-${fallbackId}`;
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function findLastPerformance(queue: readonly QueuedEvent[]): number {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (queue[index]?.event.kind === PERFORMANCE_KIND) return index;
  }
  return -1;
}

export class FeedbackBus {
  private readonly transport: FeedbackTransport;
  private readonly sessionId: string;
  private readonly appVersion: string;
  private readonly flushIntervalMs: number;
  private readonly maxQueueEvents: number;
  private readonly maxBatchEvents: number;
  private readonly maxBatchBytes: number;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly queue: QueuedEvent[] = [];
  private consentMode: FeedbackConsentMode = "disabled";
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeFlush: Promise<FeedbackBatchReceipt | null> | null = null;
  private dropped = 0;
  private flushFailures = 0;
  private closed = false;

  constructor(options: FeedbackBusOptions) {
    if (!options.sessionId || options.sessionId.length > 128) {
      throw new Error("sessionId de feedback no es valido.");
    }
    if (!options.appVersion || options.appVersion.length > 64) {
      throw new Error("appVersion de feedback no es valido.");
    }

    this.transport = options.transport;
    this.sessionId = options.sessionId;
    this.appVersion = options.appVersion;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxQueueEvents = options.maxQueueEvents ?? DEFAULT_MAX_QUEUE_EVENTS;
    this.maxBatchEvents = options.maxBatchEvents ?? DEFAULT_MAX_BATCH_EVENTS;
    this.maxBatchBytes = options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? createEventId;

    if (
      this.maxQueueEvents < 1
      || this.maxBatchEvents < 1
      || this.maxBatchEvents > 100
      || this.maxBatchBytes < 1
      || this.maxBatchBytes > DEFAULT_MAX_BATCH_BYTES
    ) {
      throw new Error("Los limites del FeedbackBus no son validos.");
    }
  }

  async initialize(): Promise<FeedbackStoreStatus> {
    const status = await this.transport.invoke<FeedbackStoreStatus>(
      "get_feedback_status",
    );
    this.consentMode = status.consentMode;
    if (this.consentMode !== "disabled") this.startTimer();
    return status;
  }

  getConsentMode(): FeedbackConsentMode {
    return this.consentMode;
  }

  getMetrics(): FeedbackBusMetrics {
    return {
      queued: this.queue.length,
      dropped: this.dropped,
      flushFailures: this.flushFailures,
    };
  }

  async getStatus(): Promise<FeedbackStoreStatus> {
    return this.transport.invoke<FeedbackStoreStatus>("get_feedback_status");
  }

  emit<K extends FeedbackEventKind>(
    kind: K,
    payload: FeedbackPayload<K>,
    options: FeedbackEmitOptions = {},
  ): boolean {
    if (this.closed || this.consentMode === "disabled") return false;

    const privacyClass = expectedPrivacyClass(kind);
    if (privacyClass === "user-content" && options.userContentConfirmed !== true) {
      return false;
    }

    const event = {
      schemaVersion: FEEDBACK_SCHEMA_VERSION,
      eventId: this.createId(),
      occurredAtUnixMs: this.now(),
      sessionId: this.sessionId,
      appVersion: this.appVersion,
      privacyClass,
      kind,
      payload,
      ...(options.runId ? { runId: options.runId } : {}),
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      ...(options.gitRevision ? { gitRevision: options.gitRevision } : {}),
    } as FeedbackEventV1;
    const bytes = encodedBytes(event);
    if (bytes > MAX_EVENT_BYTES) {
      this.dropped += 1;
      return false;
    }

    if (kind === PERFORMANCE_KIND) {
      const previous = findLastPerformance(this.queue);
      if (previous >= 0) {
        this.queue.splice(previous, 1);
        this.dropped += 1;
      }
    }

    if (!this.makeRoomFor(kind)) {
      this.dropped += 1;
      return false;
    }

    this.queue.push({
      event,
      bytes,
      userContentConfirmed: options.userContentConfirmed === true,
    });
    if (this.queue.length >= this.maxBatchEvents) {
      void this.flush().catch(() => undefined);
    }
    return true;
  }

  async setConsent(mode: FeedbackConsentMode): Promise<FeedbackStoreStatus> {
    if (mode === "disabled") {
      this.consentMode = "disabled";
      this.stopTimer();
      this.queue.splice(0);
      const status = await this.transport.invoke<FeedbackStoreStatus>(
        "set_feedback_consent",
        { mode },
      );
      return status;
    }

    const status = await this.transport.invoke<FeedbackStoreStatus>(
      "set_feedback_consent",
      { mode },
    );
    this.consentMode = status.consentMode;
    this.startTimer();
    return status;
  }

  flush(): Promise<FeedbackBatchReceipt | null> {
    if (this.activeFlush) return this.activeFlush;
    if (this.consentMode === "disabled" || this.queue.length === 0) {
      return Promise.resolve(null);
    }

    this.activeFlush = this.flushNextBatch().finally(() => {
      this.activeFlush = null;
    });
    return this.activeFlush;
  }

  async query(query: FeedbackQuery = {}): Promise<FeedbackEventPage> {
    return this.transport.invoke<FeedbackEventPage>("query_feedback_events", {
      query,
    });
  }

  async export(query: FeedbackQuery = {}): Promise<FeedbackEventPage> {
    return this.transport.invoke<FeedbackEventPage>("export_feedback_events", {
      query,
    });
  }

  async delete(request: FeedbackDeleteRequest): Promise<FeedbackDeleteReceipt> {
    if (request.scope === "all") {
      this.queue.splice(0);
    }
    const receipt = await this.transport.invoke<FeedbackDeleteReceipt>(
      "delete_feedback_data",
      { request },
    );
    if (request.scope === "all") {
      this.consentMode = "disabled";
      this.stopTimer();
    }
    return receipt;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.stopTimer();

    while (this.queue.length > 0 && this.consentMode !== "disabled") {
      await this.flush();
    }
    await this.transport.invoke<void>("flush_feedback_store");
    this.closed = true;
  }

  private async flushNextBatch(): Promise<FeedbackBatchReceipt | null> {
    const batch: QueuedEvent[] = [];
    let bytes = 0;
    while (batch.length < this.maxBatchEvents && this.queue.length > 0) {
      const candidate = this.queue[0]!;
      if (batch.length > 0 && bytes + candidate.bytes > this.maxBatchBytes) break;
      if (candidate.bytes > this.maxBatchBytes) {
        this.queue.shift();
        this.dropped += 1;
        continue;
      }
      batch.push(this.queue.shift()!);
      bytes += candidate.bytes;
    }
    if (batch.length === 0) return null;

    try {
      return await this.transport.invoke<FeedbackBatchReceipt>(
        "ingest_feedback_batch",
        {
          batch: {
            events: batch.map((item) => item.event),
            userContentConfirmed: batch.some(
              (item) => item.userContentConfirmed,
            ),
          },
        },
      );
    } catch (error) {
      this.flushFailures += 1;
      this.restoreBatch(batch);
      throw error;
    }
  }

  private restoreBatch(batch: readonly QueuedEvent[]): void {
    this.queue.unshift(...batch);
    while (this.queue.length > this.maxQueueEvents) {
      const performanceIndex = this.queue.findIndex(
        (item) => item.event.kind === PERFORMANCE_KIND,
      );
      const index = performanceIndex >= 0 ? performanceIndex : this.queue.length - 1;
      this.queue.splice(index, 1);
      this.dropped += 1;
    }
  }

  private makeRoomFor(kind: FeedbackEventKind): boolean {
    if (this.queue.length < this.maxQueueEvents) return true;
    if (kind === PERFORMANCE_KIND) return false;

    const performanceIndex = this.queue.findIndex(
      (item) => item.event.kind === PERFORMANCE_KIND,
    );
    if (performanceIndex < 0) return false;
    this.queue.splice(performanceIndex, 1);
    this.dropped += 1;
    return true;
  }

  private startTimer(): void {
    if (this.timer || this.flushIntervalMs <= 0 || this.closed) return;
    this.timer = setInterval(() => {
      void this.flush().catch(() => undefined);
    }, this.flushIntervalMs);
  }

  private stopTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
