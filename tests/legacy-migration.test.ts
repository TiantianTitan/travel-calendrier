import assert from "node:assert/strict";
import { test } from "node:test";
import { BoardStore, LOCAL_BOARD_KEY, type BoardTransport } from "../src/hooks/use-board";
import { LEGACY_MIGRATION_KEY, planLegacyMigration, readMigrationJournal, saveMigrationJournal } from "../src/lib/legacy-migration";
import { applyOperation, operationFingerprint } from "../src/lib/operations";
import { SEED_STATE } from "../src/lib/seed";
import type { Activity, BoardState, Operation } from "../src/lib/types";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const empty = (): BoardState => ({ version: 42, activities: [], responses: [], reactions: [], profiles: { mia: { name: "Shared Mia", avatar: "🐱" } } });
const activity = (id: string): Activity => ({ id, revision: 1, title: id, date: "2026-10-31", time: "10:00", endTime: "11:00", location: "Toulouse", category: "explore", note: "", sortOrder: 1 });
function localRecord(operations: Operation[], initial = empty()) {
  let state = structuredClone(initial);
  const applied: Record<string, string> = {};
  for (const operation of operations) { state = applyOperation(state, operation); applied[operation.id] = operationFingerprint(operation); }
  return JSON.stringify({ state, applied });
}
const create = (id: string): Operation => ({ id: `original-${id}`, type: "create", activity: activity(id) });
const interested = (id: string): Operation => ({ id: `interest-${id}`, type: "participate", activityId: id, memberId: "mia", status: "interested" });
const like = (id: string): Operation => ({ id: `like-${id}`, type: "react", activityId: id, memberId: "mia", emoji: "👍", active: true });
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("Expected migration transition did not occur");
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function server(storage: MemoryStorage, initial = empty()) {
  let state = structuredClone(initial);
  const calls: Operation[] = [];
  const applied = new Map<string, string>();
  const listeners = new Set<(state: BoardState) => void>();
  let loseAcknowledgement = false;
  let beforeApply: ((operation: Operation) => void) | null = null;
  let readOverride: (() => Promise<BoardState>) | null = null;
  const transport: BoardTransport = {
    read: () => readOverride ? readOverride() : Promise.resolve(structuredClone(state)),
    subscribe(onState) { listeners.add(onState); return () => { listeners.delete(onState); }; },
    async apply(operation) {
      const durable = readMigrationJournal(storage)?.items.find((item) => item.operation.id === operation.id);
      assert.equal(durable?.attempted, true, "journal must be durable before every migration RPC");
      assert.equal(operationFingerprint(durable.operation), operationFingerprint(operation));
      calls.push(structuredClone(operation));
      beforeApply?.(operation);
      const old = applied.get(operation.id);
      if (old) { assert.equal(old, operationFingerprint(operation)); return { state: structuredClone(state), duplicate: true }; }
      state = applyOperation(state, operation);
      applied.set(operation.id, operationFingerprint(operation));
      if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error("Lost acknowledgement"); }
      return { state: structuredClone(state) };
    },
  };
  return {
    transport, calls, applied, state: () => state,
    replace(next: BoardState, emit = false) { state = next; if (emit) listeners.forEach((listener) => listener(structuredClone(next))); },
    loseNextAck() { loseAcknowledgement = true; },
    beforeApply(callback: (operation: Operation) => void) { beforeApply = callback; },
    readWith(callback: () => Promise<BoardState>) { readOverride = callback; },
  };
}

test("plan imports only live proven creates, keeps latest fields, resets revision, and excludes seeds/profiles", async () => {
  const raw = localRecord([
    create("mine"), create("deleted"),
    { id: "edit-mine", type: "update", activityId: "mine", base: { title: "mine" }, patch: { title: "Latest local title" } },
    { id: "delete-local", type: "delete", activityId: "deleted", expectedRevision: 1 },
    interested("mine"), like("mine"),
    { id: "local-profile", type: "profile", memberId: "mia", base: { name: "Mia" }, patch: { name: "Local Mia" } },
  ], structuredClone(SEED_STATE));
  const journal = await planLegacyMigration(raw);
  assert.equal(journal.items.length, 3);
  const created = journal.items[0].operation;
  assert.equal(created.type, "create");
  if (created.type !== "create") return;
  assert.equal(created.activity.title, "Latest local title");
  assert.equal(created.activity.revision, 1);
  assert.deepEqual(journal, await planLegacyMigration(raw), "two tabs derive identical IDs and payloads");
  const invalid = JSON.parse(raw);
  invalid.applied["forged-id"] = operationFingerprint(create("arrival"));
  invalid.applied["not-json"] = "unknown old fingerprint";
  assert.equal((await planLegacyMigration(JSON.stringify(invalid))).items.length, 3);
});

test("first cloud read is required, then seven local activities and intentions share without altering the original record", async () => {
  const storage = new MemoryStorage();
  const raw = localRecord([...Array.from({ length: 7 }, (_, index) => create(`phone-${index}`)), interested("phone-0"), like("phone-0")]);
  storage.setItem(LOCAL_BOARD_KEY, raw);
  const cloud = server(storage);
  const first = deferred<BoardState>();
  cloud.readWith(() => first.promise);
  const store = new BoardStore(cloud.transport, storage, new MemoryStorage());
  store.start();
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(storage.getItem(LEGACY_MIGRATION_KEY), null);
    assert.equal(cloud.calls.length, 0);
    cloud.readWith(async () => structuredClone(cloud.state()));
    first.resolve(empty());
    await until(() => store.getSnapshot().migration?.remaining === 0);
    assert.equal(cloud.state().activities.length, 7);
    assert.equal(cloud.state().responses[0]?.status, "interested");
    assert.equal(cloud.state().reactions.length, 1);
    assert.deepEqual(cloud.state().profiles, empty().profiles);
    assert.equal(storage.getItem(LOCAL_BOARD_KEY), raw);
    assert.equal(cloud.calls.length, 9);
  } finally { store.stop(); }
});

test("lost create acknowledgement resumes with its original payload and never revives a subsequently deleted activity", async () => {
  const storage = new MemoryStorage();
  const raw = localRecord([create("lost")]);
  storage.setItem(LOCAL_BOARD_KEY, raw);
  const cloud = server(storage);
  cloud.loseNextAck();
  const first = new BoardStore(cloud.transport, storage, new MemoryStorage());
  first.start();
  await until(() => first.getSnapshot().failedCount === 1);
  first.stop();
  assert.equal(cloud.state().activities.length, 1);
  const reloaded = new BoardStore(cloud.transport, storage, new MemoryStorage());
  reloaded.start();
  try { await until(() => reloaded.getSnapshot().migration?.remaining === 0); }
  finally { reloaded.stop(); }
  assert.equal(cloud.calls.length, 2);
  assert.deepEqual(cloud.calls[0], cloud.calls[1]);
  assert.equal(cloud.applied.size, 1);
  cloud.replace(applyOperation(cloud.state(), { id: "remote-delete", type: "delete", activityId: "lost", expectedRevision: 1 }));
  const third = new BoardStore(cloud.transport, storage, new MemoryStorage());
  third.start();
  try {
    await until(() => third.getSnapshot().ready);
    assert.equal(third.getSnapshot().state.activities.length, 0);
    assert.equal(cloud.calls.length, 2);
    assert.equal(storage.getItem(LOCAL_BOARD_KEY), raw);
  } finally { third.stop(); }
});

test("two tabs share the durable plan and server ledger, producing one activity and one reaction", async () => {
  const storage = new MemoryStorage();
  storage.setItem(LOCAL_BOARD_KEY, localRecord([create("two-tabs"), like("two-tabs")]));
  const cloud = server(storage);
  const stores = [new BoardStore(cloud.transport, storage, new MemoryStorage()), new BoardStore(cloud.transport, storage, new MemoryStorage())];
  stores.forEach((store) => store.start());
  try {
    await until(() => stores.every((store) => store.getSnapshot().migration?.remaining === 0));
    assert.equal(cloud.state().activities.length, 1);
    assert.equal(cloud.state().reactions.length, 1);
    assert.equal(cloud.applied.size, 2);
    assert.equal(new Set(cloud.calls.filter((operation) => operation.type === "create").map((operation) => operation.id)).size, 1);
  } finally { stores.forEach((store) => store.stop()); }
});

test("existing shared activity IDs skip their entire local group and do not block a later new activity", async () => {
  const storage = new MemoryStorage();
  storage.setItem(LOCAL_BOARD_KEY, localRecord([create("shared"), interested("shared"), like("shared"), create("new")]));
  const remote = applyOperation(empty(), { id: "shared-original", type: "create", activity: { ...activity("shared"), title: "Cloud title" } });
  const cloud = server(storage, applyOperation(remote, { id: "shared-response", type: "participate", activityId: "shared", memberId: "mia", status: "not-going" }));
  const store = new BoardStore(cloud.transport, storage, new MemoryStorage());
  store.start();
  try {
    await until(() => store.getSnapshot().migration?.remaining === 0);
    assert.equal(cloud.state().activities.find((item) => item.id === "shared")?.title, "Cloud title");
    assert.equal(cloud.state().responses[0].status, "not-going");
    assert.equal(cloud.state().reactions.length, 0);
    assert.equal(cloud.calls.length, 1);
    assert.equal(cloud.state().activities.length, 2);
  } finally { store.stop(); }
});

test("a conflicting going intention never clears shared attendance and all local activities are recovered first", async () => {
  const storage = new MemoryStorage();
  const raw = localRecord([create("local-conflict"), { id: "local-going", type: "participate", activityId: "local-conflict", memberId: "mia", status: "going" }, create("later")]);
  storage.setItem(LOCAL_BOARD_KEY, raw);
  const existing = applyOperation(empty(), create("remote-event"));
  const cloud = server(storage, applyOperation(existing, { id: "remote-going", type: "participate", activityId: "remote-event", memberId: "mia", status: "going" }));
  const store = new BoardStore(cloud.transport, storage, new MemoryStorage());
  store.start();
  try {
    await until(() => store.getSnapshot().failedCount === 1);
    assert.equal(cloud.state().activities.length, 3);
    assert.deepEqual(cloud.state().responses, [{ activityId: "remote-event", memberId: "mia", status: "going" }]);
    assert.equal(store.getSnapshot().migration?.remaining, 1);
    assert.match(store.getSnapshot().error || "", /候选安排/);
    assert.equal(storage.getItem(LOCAL_BOARD_KEY), raw);
    store.dropFailed();
    await until(() => store.getSnapshot().migration?.remaining === 0);
    const calls = cloud.calls.length;
    store.retry();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(cloud.calls.length, calls, "explicitly stopped migration does not immediately restart");
  } finally { store.stop(); }
});

test("journal storage failure sends no RPC and a later retry can prepare and complete", async () => {
  const storage = new MemoryStorage();
  storage.setItem(LOCAL_BOARD_KEY, localRecord([create("quota")]));
  const original = storage.setItem.bind(storage);
  let blocked = true;
  storage.setItem = (key, value) => { if (blocked && key === LEGACY_MIGRATION_KEY) throw new Error("Full"); original(key, value); };
  const cloud = server(storage);
  const store = new BoardStore(cloud.transport, storage, new MemoryStorage());
  store.start();
  try {
    await until(() => Boolean(store.getSnapshot().error));
    assert.equal(cloud.calls.length, 0);
    blocked = false;
    store.retry();
    await until(() => store.getSnapshot().migration?.remaining === 0);
    assert.equal(cloud.state().activities.length, 1);
  } finally { store.stop(); }
});

test("restored followups wait for the initial cloud read and preserve an existing newer response", async () => {
  const storage = new MemoryStorage();
  storage.setItem(LOCAL_BOARD_KEY, localRecord([create("restored"), interested("restored")]));
  const journal = await planLegacyMigration(storage.getItem(LOCAL_BOARD_KEY)!);
  journal.items[0].outcome = "done";
  journal.items.forEach((item) => { item.attempted = true; });
  saveMigrationJournal(storage, journal);
  const old = applyOperation(empty(), create("restored"));
  storage.setItem("travel-calendar:toulouse-2026:cloud-cache:v1", JSON.stringify(old));
  const session = new MemoryStorage();
  session.setItem("travel-calendar:toulouse-2026:cloud-pending:v1", JSON.stringify([{ operation: journal.items[1].operation, status: "sending" }]));
  const current = applyOperation(old, { id: "new-response", type: "participate", activityId: "restored", memberId: "mia", status: "not-going" });
  const cloud = server(storage, current);
  const read = deferred<BoardState>();
  cloud.readWith(() => read.promise);
  const store = new BoardStore(cloud.transport, storage, session);
  store.start();
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(cloud.calls.length, 0);
    cloud.readWith(async () => structuredClone(cloud.state()));
    read.resolve(current);
    await until(() => store.getSnapshot().migration?.remaining === 0);
    assert.equal(cloud.calls.length, 0);
    assert.equal(cloud.state().responses[0].status, "not-going");
  } finally { store.stop(); }
});

test("a newer realtime response arriving during the followup read wins over that stale read", async () => {
  const storage = new MemoryStorage();
  storage.setItem(LOCAL_BOARD_KEY, localRecord([create("realtime"), interested("realtime")]));
  const journal = await planLegacyMigration(storage.getItem(LOCAL_BOARD_KEY)!);
  journal.items[0].outcome = "done";
  saveMigrationJournal(storage, journal);
  const old = applyOperation(empty(), create("realtime"));
  const cloud = server(storage, old);
  const followupRead = deferred<BoardState>();
  let reads = 0;
  cloud.readWith(async () => ++reads === 1 ? old : followupRead.promise);
  const store = new BoardStore(cloud.transport, storage, new MemoryStorage());
  store.start();
  try {
    await until(() => reads === 2);
    const newer = applyOperation(old, { id: "realtime-choice", type: "participate", activityId: "realtime", memberId: "mia", status: "maybe" });
    cloud.replace(newer, true);
    followupRead.resolve(old);
    await until(() => store.getSnapshot().migration?.remaining === 0);
    assert.equal(cloud.calls.length, 0);
    assert.equal(cloud.state().responses[0].status, "maybe");
  } finally { store.stop(); }
});

test("failed followup retries re-read the shared response instead of overwriting a later intention", async () => {
  const storage = new MemoryStorage();
  storage.setItem(LOCAL_BOARD_KEY, localRecord([create("retry-intent"), interested("retry-intent")]));
  const cloud = server(storage);
  let fail = true;
  cloud.beforeApply((operation) => { if (fail && operation.type === "participate") throw new Error("Request never reached server"); });
  const store = new BoardStore(cloud.transport, storage, new MemoryStorage());
  store.start();
  try {
    await until(() => store.getSnapshot().failedCount === 1);
    cloud.replace(applyOperation(cloud.state(), { id: "later-intention", type: "participate", activityId: "retry-intent", memberId: "mia", status: "not-going" }));
    fail = false;
    store.retry();
    await until(() => store.getSnapshot().migration?.remaining === 0);
    assert.equal(cloud.state().responses[0].status, "not-going");
    assert.equal(cloud.calls.filter((operation) => operation.type === "participate").length, 1);
  } finally { store.stop(); }
});
