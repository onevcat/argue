import { appendFile, mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ArgueObserver } from "../contracts/delegate.js";
import { JSONL_RUN_EVENT_VERSION, JsonlRunEventSchema, type JsonlRunEvent } from "../contracts/run-log.js";
import type { ArgueEvent } from "../contracts/events.js";

export type JsonlObserverOptions = {
  path: string;
  append?: boolean;
};

export class JsonlObserver implements ArgueObserver {
  readonly path: string;

  private readonly appendMode: boolean;
  private seq = 0;
  private readonly ready: Promise<void>;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: JsonlObserverOptions) {
    this.path = resolve(options.path);
    this.appendMode = options.append ?? true;
    this.ready = this.prepare();
  }

  onEvent(event: ArgueEvent): Promise<void> {
    this.queue = this.queue
      .catch(() => {}) // recover from a previous write failure so the chain is not permanently broken
      .then(async () => {
        await this.ready;

        const record: JsonlRunEvent = JsonlRunEventSchema.parse({
          v: JSONL_RUN_EVENT_VERSION,
          kind: "argue.event",
          seq: this.seq,
          loggedAt: new Date().toISOString(),
          event
        });

        this.seq += 1;
        await appendFile(this.path, `${JSON.stringify(record)}\n`, "utf8");
      });

    return this.queue;
  }

  async flush(): Promise<void> {
    await this.ready;
    await this.queue;
  }

  private async prepare(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });

    if (!this.appendMode) {
      const handle = await open(this.path, "w");
      await handle.close();
      return;
    }

    const handle = await open(this.path, "a");
    await handle.close();
  }
}
