"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { applyOperation, hasOperationEffect, mergeSnapshot, operationFingerprint, OperationError, parseBoardState, validateOperation } from "../lib/operations";
import { getSupabase } from "../lib/supabase";
import { isMigrationOperationId, planLegacyMigration, readMigrationJournal, saveMigrationJournal, skipMigrationFollowup, type MigrationJournal } from "../lib/legacy-migration";
import { TRIP_ID, type BoardState, type Operation, type OperationResult } from "../lib/types";

type Connection = "connecting" | "live" | "offline" | "error";
type PendingStatus = "queued" | "sending" | "failed" | "uncertain";
interface PendingEntry { operation: Operation; status: PendingStatus; error?: string }
interface LocalRecord { state: BoardState; applied: Record<string, string> }
interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
interface StoreSnapshot {
  state: BoardState;
  authoritativeState: BoardState;
  ready: boolean;
  mode: "cloud" | "local";
  connection: Connection;
  pendingCount: number;
  failedCount: number;
  error: string | null;
  migration: { total: number; completed: number; remaining: number } | null;
}

/** Injectable transport keeps queue ordering and failure semantics independently testable. */
export interface BoardTransport {
  read(): Promise<BoardState>;
  apply(operation: Operation): Promise<OperationResult>;
  subscribe(onState: (state: BoardState) => void, onStatus: (connected: boolean) => void): () => void;
}

export const LOCAL_BOARD_KEY = `travel-calendar:${TRIP_ID}:local:v1`;
const CLOUD_CACHE_KEY = `travel-calendar:${TRIP_ID}:cloud-cache:v1`;
const CLOUD_PENDING_KEY = `travel-calendar:${TRIP_ID}:cloud-pending:v1`;
const messageOf = (error: unknown) => error instanceof Error ? error.message : "暂时无法同步，请稍后重试。";
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
// Historical sample activities are test/migration fixtures, never runtime defaults.
const emptyBoard = (): BoardState => ({ version: 0, activities: [], responses: [], reactions: [] });

function serviceError(error: { message: string }): Error {
  if (error.message.startsWith("CONFLICT:") && error.message.includes("成员资料刚有更新")) return new OperationError("CONFLICT", "成员资料刚有更新，请查看最新内容后重新保存。");
  if (error.message.startsWith("CONFLICT:") && error.message.includes("候选安排刚有变化")) return new OperationError("CONFLICT", "候选安排刚有变化，请查看后重新确认。");
  if (error.message.startsWith("CONFLICT:") && error.message.includes("这次移动会让已参加的安排重合")) return new OperationError("CONFLICT", "这次移动会让已参加的安排重合，请先调整接龙。");
  if (error.message.startsWith("CONFLICT:")) return new OperationError("CONFLICT", "有人刚修改了相同内容。请查看最新活动后重新保存；你的草稿仍在。");
  if (error.message.startsWith("NOT_FOUND:")) return new OperationError("NOT_FOUND", "这个活动已被删除。你的修改尚未保存，可以另存为新活动。");
  if (error.message.startsWith("VALIDATION:")) return new OperationError("VALIDATION", "内容未能保存，请检查日期、时间和文字长度后重试。");
  return new Error("暂时无法连接共享行程。修改尚未同步，可重试。");
}

async function withTimeout<T>(run: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try { return await run(controller.signal); } finally { clearTimeout(timer); }
}

function createTransport(): BoardTransport {
  const client = getSupabase();
  return {
    async read() {
      const { data, error } = await withTimeout((signal) => client.from("trip_boards").select("state").eq("id", TRIP_ID).abortSignal(signal).single());
      if (error) throw serviceError(error);
      return parseBoardState(data?.state);
    },
    async apply(operation) {
      const { data, error } = await withTimeout((signal) => client.rpc("apply_trip_operation", { p_operation: operation }).abortSignal(signal));
      if (error) throw serviceError(error);
      return { state: parseBoardState(data?.state), duplicate: data?.duplicate === true };
    },
    subscribe(onState, onStatus) {
      const channel = client.channel(`trip-board:${TRIP_ID}:${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trip_boards", filter: `id=eq.${TRIP_ID}` }, (payload) => {
          try { onState(parseBoardState(payload.new.state)); } catch { onStatus(false); }
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") onStatus(true);
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") onStatus(false);
        });
      return () => { void client.removeChannel(channel); };
    },
  };
}

/** The authority is never replaced with an optimistic board or an unconfirmed RPC result. */
export class BoardStore {
  private authority: BoardState = emptyBoard();
  private pending: PendingEntry[] = [];
  private callbacks = new Map<string, { resolve: () => void; reject: (error: Error) => void }[]>();
  private listeners = new Set<() => void>();
  private snapshot: StoreSnapshot;
  private initialSnapshot: StoreSnapshot;
  private started = false;
  private initialized = false;
  private sending = false;
  private subscribed = false;
  private hasAuthority = false;
  private readError: string | null = null;
  private storageError: string | null = null;
  private cleanup: (() => void) | null = null;
  private generation = 0;
  private storage?: StorageLike;
  private pendingStorage?: StorageLike;
  private migrationJournal: MigrationJournal | null = null;
  private migrationPrepared = false;
  private preparingMigration: Promise<void> | null = null;
  private advancingMigration = false;
  private migrationError: string | null = null;

  constructor(private transport: BoardTransport | null, storage?: StorageLike, pendingStorage?: StorageLike) {
    this.storage = storage;
    this.pendingStorage = pendingStorage;
    this.snapshot = {
      state: this.authority, authoritativeState: this.authority, ready: false, mode: transport ? "cloud" : "local",
      connection: transport ? "connecting" : "live", pendingCount: 0, failedCount: 0, error: null, migration: null,
    };
    this.initialSnapshot = this.snapshot;
  }

  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => this.initialSnapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private publish(patch: Partial<StoreSnapshot> = {}) {
    let projected = this.authority;
    for (const entry of this.pending) {
      if (entry.status === "failed" || hasOperationEffect(projected, entry.operation)) continue;
      try { projected = applyOperation(projected, entry.operation); } catch { /* A remote conflict is resolved by the authority, never by overwriting it. */ }
    }
    const pendingError = this.pending.find((entry) => entry.status === "failed" || entry.status === "uncertain")?.error;
    this.snapshot = {
      ...this.snapshot, ...patch, state: projected, authoritativeState: this.authority,
      pendingCount: this.pending.length,
      failedCount: this.pending.filter((entry) => entry.status === "failed" || entry.status === "uncertain").length,
      error: pendingError || this.storageError || this.migrationError || this.readError || null,
      migration: this.migrationJournal?.items.length ? {
        total: this.migrationJournal.items.filter((item) => item.operation.type === "create").length,
        completed: this.migrationJournal.items.filter((item) => item.operation.type === "create" && item.outcome !== "pending").length,
        remaining: this.migrationJournal.items.filter((item) => item.outcome === "pending").length,
      } : null,
    };
    this.listeners.forEach((listener) => listener());
  }

  private persistQueue() {
    if (!this.transport || !this.pendingStorage) return;
    try {
      this.pendingStorage.setItem(CLOUD_PENDING_KEY, JSON.stringify(this.pending));
      this.storageError = null;
    } catch {
      this.storageError = "浏览器无法保留待同步修改。请先同步完成，再关闭这个页面。";
    }
  }

  private accept(state: BoardState) {
    this.authority = this.hasAuthority ? mergeSnapshot(this.authority, state) : state;
    this.hasAuthority = true;
    if (this.transport && this.storage) {
      try { this.storage.setItem(CLOUD_CACHE_KEY, JSON.stringify(this.authority)); } catch { /* This optional read cache never confirms a write. */ }
    }
    this.publish();
  }

  private readLocal(): LocalRecord {
    const raw = this.storage?.getItem(LOCAL_BOARD_KEY);
    if (!raw) return { state: emptyBoard(), applied: {} };
    const record = JSON.parse(raw) as LocalRecord;
    const state = parseBoardState(record.state);
    const applied = record.applied && typeof record.applied === "object" && !Array.isArray(record.applied) ? record.applied : {};
    return { state, applied };
  }

  private prepareMigration(): Promise<void> {
    if (this.migrationPrepared || !this.storage) return Promise.resolve();
    if (this.preparingMigration) return this.preparingMigration;
    const storage = this.storage;
    this.preparingMigration = (async () => {
      try {
        let journal = readMigrationJournal(storage);
        if (!journal) {
          const raw = storage.getItem(LOCAL_BOARD_KEY);
          const planned = raw ? await planLegacyMigration(raw) : null;
          // Another tab may have written the durable plan while IDs were calculated.
          journal = readMigrationJournal(storage) ?? (planned?.items.length ? saveMigrationJournal(storage, planned) : null);
        }
        this.migrationJournal = journal;
        this.migrationPrepared = true;
        this.migrationError = null;
        if (journal) {
          const finished = new Set(journal.items.filter((item) => item.outcome !== "pending").map((item) => item.operation.id));
          this.pending = this.pending.filter((entry) => !finished.has(entry.operation.id));
          this.persistQueue();
        }
      } catch {
        this.migrationError = "这台设备的旧安排暂未共享，原记录已保留。请重试。";
      } finally { this.publish(); }
    })().finally(() => { this.preparingMigration = null; });
    return this.preparingMigration;
  }

  private finishMigrationOperation(id: string, outcome: "done" | "skipped") {
    if (!this.storage || !this.migrationJournal?.items.some((item) => item.operation.id === id)) return;
    this.migrationJournal = saveMigrationJournal(this.storage, {
      ...this.migrationJournal,
      items: this.migrationJournal.items.map((item) => item.operation.id === id ? { ...item, outcome } : item),
    });
  }

  private skipMigrationActivity(activityId: string) {
    if (!this.storage || !this.migrationJournal) return;
    this.migrationJournal = saveMigrationJournal(this.storage, {
      ...this.migrationJournal,
      items: this.migrationJournal.items.map((item) => item.activityId === activityId && item.outcome === "pending" ? { ...item, outcome: "skipped" } : item),
    });
  }

  private async advanceMigration() {
    if (!this.started || !this.transport || !this.storage || !this.migrationPrepared || this.advancingMigration || this.migrationError || !this.online()) return;
    this.advancingMigration = true;
    const generation = this.generation;
    try {
      while (this.started && generation === this.generation) {
        this.migrationJournal = readMigrationJournal(this.storage);
        const item = this.migrationJournal?.items.find((candidate) => candidate.outcome === "pending");
        if (!item || this.pending.some((entry) => entry.operation.id === item.operation.id)) break;
        if (item.operation.type === "create" && !item.attempted && this.authority.activities.some((activity) => activity.id === item.activityId)) {
          this.skipMigrationActivity(item.activityId);
          continue;
        }
        // Persist the exact ID and payload BEFORE any network write. A replay
        // after a lost response must reach the server ledger, not re-plan intent.
        this.migrationJournal = saveMigrationJournal(this.storage, {
          ...this.migrationJournal!, items: this.migrationJournal!.items.map((candidate) => candidate.operation.id === item.operation.id ? { ...candidate, attempted: true } : candidate),
        });
        const durable = this.migrationJournal.items.find((candidate) => candidate.operation.id === item.operation.id)!;
        if (durable.outcome !== "pending") continue;
        void this.dispatch(durable.operation).catch(() => { /* The ordinary queue exposes errors and retains the stable operation. */ });
        break;
      }
    } catch {
      this.migrationError = "旧安排尚未全部共享，原记录已保留。请重试。";
    } finally { this.advancingMigration = false; this.publish(); }
  }

  start = () => {
    if (this.started) return;
    this.started = true;
    const generation = ++this.generation;
    if (typeof window !== "undefined") {
      try { this.storage ??= window.localStorage; this.pendingStorage ??= window.sessionStorage; } catch { this.storageError = "浏览器存储不可用，未同步修改可能无法保留。"; }
    }
    if (!this.initialized) {
      this.initialized = true;
      if (this.transport) {
        try {
          const cache = this.storage?.getItem(CLOUD_CACHE_KEY);
          if (cache) { this.authority = parseBoardState(JSON.parse(cache)); this.hasAuthority = true; }
          const queue = JSON.parse(this.pendingStorage?.getItem(CLOUD_PENDING_KEY) || "[]") as PendingEntry[];
          if (!Array.isArray(queue)) throw new Error("Invalid queue");
          this.pending = queue.filter((entry) => !isMigrationOperationId(entry.operation?.id)).map((entry) => {
            validateOperation(entry.operation);
            // An interrupted request may have committed: keep its original ID for the RPC ledger.
            return { ...entry, status: entry.status === "failed" ? "failed" : "queued" };
          });
        } catch { this.readError = "有一份本机缓存无法读取，正在重新加载共享行程。"; }
      } else {
        try {
          const record = this.readLocal();
          this.authority = record.state;
          this.hasAuthority = true;
        } catch { this.readError = "本机行程无法读取，原记录没有被覆盖。请重试。"; }
      }
    }
    this.publish({ ready: !this.transport || this.hasAuthority });
    const onStorage = (event: StorageEvent) => {
      if (this.transport || event.key !== LOCAL_BOARD_KEY || !event.newValue) return;
      try {
        const record = this.readLocal();
        this.accept(record.state);
      } catch { this.readError = "另一页面的修改暂时无法读取，请重试。"; this.publish(); }
    };
    const onOffline = () => { if (this.transport) this.publish({ connection: "offline" }); };
    const onReturn = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (this.transport) {
        this.resumeUncertain();
        void this.refresh();
      } else {
        try { const record = this.readLocal(); this.accept(record.state); } catch { /* Existing error remains visible. */ }
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("storage", onStorage);
      window.addEventListener("offline", onOffline);
      window.addEventListener("online", onReturn);
      window.addEventListener("focus", onReturn);
      document.addEventListener("visibilitychange", onReturn);
    }
    let stopSubscription: (() => void) | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    if (this.transport) {
      stopSubscription = this.transport.subscribe((state) => {
        if (this.started && generation === this.generation) this.accept(state);
      }, (connected) => {
        if (!this.started || generation !== this.generation) return;
        this.subscribed = connected;
        if (connected) {
          this.resumeUncertain();
          // This read begins AFTER subscription acknowledgement, closing the initial loading gap.
          void this.refresh();
        } else {
          this.readError = "实时连接暂时中断，正在重新连接。";
          this.publish({ connection: this.online() ? "error" : "offline" });
        }
      });
      void this.refresh();
      poll = setInterval(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") void this.refresh();
      }, 30_000);
    }
    this.cleanup = () => {
      stopSubscription?.();
      if (poll) clearInterval(poll);
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener("offline", onOffline);
        window.removeEventListener("online", onReturn);
        window.removeEventListener("focus", onReturn);
        document.removeEventListener("visibilitychange", onReturn);
      }
    };
    void this.pump();
  };

  stop = () => {
    this.started = false;
    ++this.generation;
    this.subscribed = false;
    this.cleanup?.();
    this.cleanup = null;
  };

  private online() { return typeof navigator === "undefined" || navigator.onLine !== false; }

  private async refresh() {
    if (!this.transport || !this.started) return;
    const generation = this.generation;
    if (!this.online()) {
      this.markWaitingUncertain("目前离线，修改尚未同步。联网后会使用原操作重试。");
      this.publish({ ready: true, connection: "offline" });
      return;
    }
    try {
      const state = await this.transport.read();
      if (!this.started || generation !== this.generation) return;
      this.accept(state);
      await this.prepareMigration();
      if (!this.started || generation !== this.generation) return;
      this.readError = null;
      this.resumeUncertain();
      this.publish({ ready: true, connection: this.subscribed ? "live" : "error" });
      void this.pump();
    } catch (error) {
      if (!this.started || generation !== this.generation) return;
      this.readError = messageOf(error);
      if (!this.hasAuthority) {
        this.markWaitingUncertain("尚未读取到共享行程，修改仍在本机等待同步。");
      }
      this.publish({ ready: true, connection: this.online() ? "error" : "offline" });
    }
  }

  dispatch = async (operation: Operation): Promise<void> => {
    // Copy the caller's data so switching member or editing the form cannot retarget an in-flight request.
    const captured = clone(operation);
    validateOperation(captured);
    const existing = this.pending.find((entry) => entry.operation.id === captured.id);
    if (existing && operationFingerprint(existing.operation) !== operationFingerprint(captured)) throw new OperationError("CONFLICT", "这次未同步修改的内容已变化，请先处理原修改后重新保存。");
    return new Promise<void>((resolve, reject) => {
      if (existing) {
        if (existing.status === "failed" || existing.status === "uncertain") { existing.status = "queued"; delete existing.error; }
      } else this.pending.push({ operation: captured, status: "queued" });
      this.callbacks.set(captured.id, [...(this.callbacks.get(captured.id) || []), { resolve, reject }]);
      if (this.transport && !this.hasAuthority && this.snapshot.ready) {
        this.markWaitingUncertain("尚未读取到共享行程，修改仍在本机等待同步。");
      } else if (this.pending.some((entry) => entry.status === "uncertain")) {
        this.settle(captured.id, new Error("修改已留在本机，正在等待前面的修改同步。请使用重试。"));
      }
      this.persistQueue();
      this.publish();
      void this.pump();
    });
  };

  private async commitLocal(operation: Operation): Promise<OperationResult> {
    const commit = async () => {
      if (!this.storage) throw new Error("浏览器存储不可用，修改尚未保存。");
      const record = this.readLocal();
      const fingerprint = operationFingerprint(operation);
      if (Object.prototype.hasOwnProperty.call(record.applied, operation.id)) {
        if (record.applied[operation.id] !== fingerprint) throw new OperationError("CONFLICT", "操作标识已被使用，请重新保存。");
        return { state: record.state, duplicate: true };
      }
      const state = applyOperation(record.state, operation);
      const applied = { ...record.applied, [operation.id]: fingerprint };
      try { this.storage.setItem(LOCAL_BOARD_KEY, JSON.stringify({ state, applied })); }
      catch { throw new Error("浏览器没有保存这次修改。请检查存储空间后重试。"); }
      return { state };
    };
    // Atomic read + write between tabs on browsers supporting the Web Locks API.
    if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(LOCAL_BOARD_KEY, commit);
    return commit();
  }

  private async pump() {
    if (!this.started || this.sending || (this.transport && !this.hasAuthority)) return;
    if (this.pending.some((entry) => entry.status === "uncertain")) return;
    const entry = this.pending.find((item) => item.status === "queued");
    if (!entry) { void this.advanceMigration(); return; }
    if (this.transport && !this.online()) {
      entry.status = "uncertain";
      entry.error = "目前离线，修改尚未同步。联网后会使用原操作重试。";
      this.settle(entry.operation.id, new Error(entry.error));
      this.persistQueue();
      this.publish({ connection: "offline" });
      return;
    }
    this.sending = true;
    entry.status = "sending";
    this.persistQueue();
    this.publish();
    try {
      const migrationItem = this.migrationJournal?.items.find((item) => item.operation.id === entry.operation.id);
      if (this.transport && migrationItem && entry.operation.type !== "create") {
        // Journal-owned operations are restored only after the initial cloud read.
        // Re-check every attempt, including a request interrupted before reaching
        // the server; "attempted" alone does not prove a ledger acknowledgement.
        const generation = this.generation;
        const state = await this.transport.read();
        if (!this.started || generation !== this.generation) { entry.status = "queued"; return; }
        this.accept(state);
        if (skipMigrationFollowup(this.authority, migrationItem)) {
          this.finishMigrationOperation(entry.operation.id, "skipped");
          this.pending = this.pending.filter((item) => item !== entry);
          this.settle(entry.operation.id);
          return;
        }
      }
      const result = this.transport ? await this.transport.apply(entry.operation) : await this.commitLocal(entry.operation);
      this.accept(result.state);
      this.finishMigrationOperation(entry.operation.id, "done");
      this.pending = this.pending.filter((item) => item !== entry);
      // An idempotent acknowledgement can describe a create that somebody has
      // since deleted. It is confirmed, but must not be reported as a new card.
      const createdId = entry.operation.type === "create" ? entry.operation.activity.id : null;
      if (createdId && !this.authority.activities.some((activity) => activity.id === createdId)) {
        this.settle(entry.operation.id, new OperationError("NOT_FOUND", "刚添加的活动已被移除。草稿已保留，可以再次添加。"));
      } else this.settle(entry.operation.id);
    } catch (error) {
      entry.status = error instanceof OperationError ? "failed" : "uncertain";
      entry.error = messageOf(error);
      this.settle(entry.operation.id, error instanceof Error ? error : new Error(entry.error));
      if (entry.status === "uncertain") {
        // Keep every queued intent and its ID, but release forms waiting behind
        // the blocked request so they do not stay in a permanent saving state.
        this.pending.forEach((waiting) => {
          if (waiting.status === "queued") this.settle(waiting.operation.id, new Error("前面的修改尚未同步，内容已保留，请重试。"));
        });
      }
      if (this.transport && error instanceof OperationError) void this.refresh();
    } finally {
      this.sending = false;
      this.persistQueue();
      this.publish();
      void this.pump();
    }
  }

  private settle(id: string, error?: Error) {
    this.callbacks.get(id)?.forEach((callback) => error ? callback.reject(error) : callback.resolve());
    this.callbacks.delete(id);
  }

  private markWaitingUncertain(message: string) {
    this.pending.forEach((entry) => {
      if (entry.status === "queued") {
        entry.status = "uncertain";
        entry.error = message;
        this.settle(entry.operation.id, new Error(message));
      }
    });
    this.persistQueue();
  }

  private resumeUncertain() {
    this.pending.forEach((entry) => {
      if (entry.status === "uncertain") { entry.status = "queued"; delete entry.error; }
    });
    this.persistQueue();
    this.publish();
  }

  retry = () => {
    this.readError = null;
    this.storageError = null;
    this.migrationError = null;
    this.pending.forEach((entry) => {
      if (entry.status === "failed" || entry.status === "uncertain") { entry.status = "queued"; delete entry.error; }
    });
    this.persistQueue();
    this.publish({ connection: this.transport ? "connecting" : "live" });
    if (this.transport) void this.refresh();
    else {
      try { const record = this.readLocal(); this.accept(record.state); } catch (error) { this.readError = messageOf(error); this.publish(); }
    }
    void this.pump();
  };

  dropFailed = () => {
    try {
      for (const entry of this.pending.filter((item) => item.status === "failed" || item.status === "uncertain")) {
        const migrationItem = this.migrationJournal?.items.find((item) => item.operation.id === entry.operation.id);
        if (migrationItem?.operation.type === "create") this.skipMigrationActivity(migrationItem.activityId);
        else if (migrationItem) this.finishMigrationOperation(entry.operation.id, "skipped");
      }
    } catch { this.migrationError = "无法停止旧安排的同步，原记录已保留。请重试。"; this.publish(); return; }
    this.pending = this.pending.filter((entry) => entry.status !== "failed" && entry.status !== "uncertain");
    this.persistQueue();
    this.publish();
    void this.pump();
    // Dropping an uncertain request does not reverse a write which may already exist remotely.
    if (this.transport) void this.refresh();
  };

  /** Discard a known rejected edit before deliberately saving against a new baseline. */
  dropOperation = (id: string) => {
    const entry = this.pending.find((item) => item.operation.id === id);
    if (!entry || entry.status !== "failed") return;
    this.pending = this.pending.filter((item) => item !== entry);
    this.persistQueue();
    this.publish();
    void this.pump();
  };

  clearError = () => {
    this.readError = null;
    this.storageError = null;
    // Failed mutations remain visible until retry or explicit dismissal.
    this.publish();
  };
}

export function useBoard() {
  const [store] = useState(() => new BoardStore(createTransport()));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  useEffect(() => { store.start(); return store.stop; }, [store]);
  return { ...snapshot, dispatch: store.dispatch, retry: store.retry, clearError: store.clearError, dropFailed: store.dropFailed, dropOperation: store.dropOperation };
}
