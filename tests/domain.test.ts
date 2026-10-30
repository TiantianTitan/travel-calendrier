import assert from "node:assert/strict";
import { test } from "node:test";
import { BoardStore, LOCAL_BOARD_KEY, type BoardTransport } from "../src/hooks/use-board";
import { activitiesOverlap, applyOperation, choiceKey, groupOverlaps, hasOperationEffect, isMutuallyExclusiveGroup, mergeSnapshot, OperationError, parseBoardState } from "../src/lib/operations";
import { SEED_STATE } from "../src/lib/seed";
import { PARTICIPATION_STATES, type Activity, type BoardState, type Operation, type OperationResult, type Participation, type TripDate } from "../src/lib/types";

const seed = (): BoardState => structuredClone(SEED_STATE);
const activity = (): Activity => seed().activities[0];
const timedActivity = (id: string, time: string, endTime: string, date: TripDate = "2026-10-31"): Activity => ({ ...activity(), id, time, endTime, date });
const participation = (id: string, status: Participation | null, memberId: "hoting" | "mia" = "hoting"): Operation => ({ id, type: "participate", activityId: "arrival", memberId, status });
const reaction = (id: string, active: boolean): Operation => ({ id, type: "react", activityId: "arrival", memberId: "hoting", emoji: "👍", active });

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("The expected queue transition did not occur");
}

function cloud(apply?: (operation: Operation) => Promise<OperationResult>) {
  let remote = seed();
  let onState: (state: BoardState) => void = () => {};
  let onStatus: (connected: boolean) => void = () => {};
  const calls: Operation[] = [];
  const transport: BoardTransport = {
    read: async () => remote,
    apply: async (operation) => {
      calls.push(structuredClone(operation));
      if (apply) return apply(operation);
      remote = applyOperation(remote, operation);
      return { state: remote };
    },
    subscribe(state, status) { onState = state; onStatus = status; queueMicrotask(() => status(true)); return () => {}; },
  };
  const store = new BoardStore(transport, new MemoryStorage(), new MemoryStorage());
  store.start();
  return {
    store, calls, transport,
    emit(state: BoardState) { remote = state; onState(state); },
    status(connected: boolean) { onStatus(connected); },
    remote: () => remote,
  };
}

test("the seed has three dates, parallel proposals, and no fabricated members", () => {
  assert.equal(SEED_STATE.activities.length, 15);
  assert.deepEqual(new Set(SEED_STATE.activities.map((item) => item.date)), new Set(["2026-10-31", "2026-11-01", "2026-11-02"]));
  assert.equal(SEED_STATE.activities.filter((item) => item.date === "2026-10-31" && item.time === "14:30").length, 2);
  assert.equal(SEED_STATE.responses.length, 0);
  assert.equal(SEED_STATE.reactions.length, 0);
  assert.equal(parseBoardState(seed()).activities.length, 15);
});

test("a new local browser starts empty, including its server snapshot, without writing sample activities", () => {
  const storage = new MemoryStorage();
  const store = new BoardStore(null, storage);
  const empty: BoardState = { version: 0, activities: [], responses: [], reactions: [] };
  assert.deepEqual(store.getServerSnapshot().state, empty);
  assert.deepEqual(store.getSnapshot().authoritativeState, empty);
  store.start();
  try {
    assert.equal(store.getSnapshot().ready, true);
    assert.equal(store.getSnapshot().mode, "local");
    assert.deepEqual(store.getSnapshot().state, empty);
    assert.equal(storage.values.size, 0);
  } finally { store.stop(); }
});

test("a new cloud browser shows no samples while loading or after its first read fails", async () => {
  const read = deferred<BoardState>();
  let writes = 0;
  const transport: BoardTransport = {
    read: () => read.promise,
    subscribe: () => () => {},
    apply: async () => { writes += 1; throw new Error("Unexpected write"); },
  };
  const store = new BoardStore(transport, new MemoryStorage(), new MemoryStorage());
  assert.equal(store.getServerSnapshot().state.activities.length, 0);
  store.start();
  try {
    assert.equal(store.getSnapshot().ready, false);
    assert.equal(store.getSnapshot().state.activities.length, 0);
    read.reject(new Error("unreachable"));
    await until(() => store.getSnapshot().ready);
    assert.match(store.getSnapshot().error || "", /unreachable/);
    assert.equal(store.getSnapshot().state.activities.length, 0);
    assert.equal(store.getSnapshot().authoritativeState.activities.length, 0);
    assert.equal(writes, 0);
  } finally { store.stop(); }
});

test("existing local activities, profiles and operation records are preserved on startup", () => {
  const storage = new MemoryStorage();
  const existing: BoardState = { ...seed(), version: 22, profiles: { mia: { name: "米娅", avatar: "🐱" } } };
  const record = JSON.stringify({ state: existing, applied: { "past-operation": "saved-fingerprint" } });
  storage.setItem(LOCAL_BOARD_KEY, record);
  const store = new BoardStore(null, storage);
  store.start();
  try {
    assert.deepEqual(store.getSnapshot().state, existing);
    assert.equal(storage.getItem(LOCAL_BOARD_KEY), record);
  } finally { store.stop(); }
});

test("a newer empty cloud board replaces the old read cache and preserves profiles without refilling samples", async () => {
  const storage = new MemoryStorage();
  const cacheKey = "travel-calendar:toulouse-2026:cloud-cache:v1";
  const old = { ...seed(), version: 22 };
  const cleared: BoardState = { version: 37, activities: [], responses: [], reactions: [], profiles: { mia: { name: "米娅", avatar: "🐱" } } };
  storage.setItem(cacheKey, JSON.stringify(old));
  let emit: (state: BoardState) => void = () => {};
  const transport: BoardTransport = {
    read: async () => cleared,
    subscribe: onState => { emit = onState; return () => {}; },
    apply: async () => { throw new Error("Unexpected write"); },
  };
  const store = new BoardStore(transport, storage, new MemoryStorage());
  store.start();
  try {
    await until(() => store.getSnapshot().authoritativeState.version === cleared.version);
    assert.deepEqual(store.getSnapshot().state, cleared);
    assert.deepEqual(JSON.parse(storage.getItem(cacheKey)!), cleared);
    emit(old);
    assert.deepEqual(store.getSnapshot().state, cleared);
  } finally { store.stop(); }
  const reloaded = new BoardStore(transport, storage, new MemoryStorage());
  reloaded.start();
  try { assert.deepEqual(reloaded.getSnapshot().state, cleared); }
  finally { reloaded.stop(); }
});

test("participation has one explicit state per member and remains independent of likes", () => {
  const original = seed();
  let state = applyOperation(original, reaction("like-1", true));
  assert.equal(state.responses.length, 0);
  state = applyOperation(state, participation("join-1", "going"));
  state = applyOperation(state, participation("skip-1", "not-going"));
  assert.deepEqual(state.responses, [{ activityId: "arrival", memberId: "hoting", status: "not-going" }]);
  assert.equal(state.reactions.length, 1);
  state = applyOperation(state, participation("withdraw-1", null));
  assert.equal(state.responses.length, 0);
  assert.equal(state.reactions.length, 1);
  assert.equal(original.version, SEED_STATE.version);
  assert.equal(original.reactions.length, 0);
});

test("target-state likes never accumulate duplicate votes", () => {
  let state = applyOperation(seed(), reaction("like-1", true));
  state = applyOperation(state, reaction("like-2", true));
  assert.equal(state.reactions.length, 1);
  assert.equal(state.activities[0].revision, activity().revision);
  state = applyOperation(state, reaction("unlike", false));
  assert.equal(state.reactions.length, 0);
});

test("all four participation states are parsed, remain one per activity/member, and leave likes independent", () => {
  let state = applyOperation(seed(), reaction("like-four-states", true));
  for (const status of PARTICIPATION_STATES) {
    state = applyOperation(state, participation(`state-${status}`, status));
    state = parseBoardState(JSON.parse(JSON.stringify(state)));
    assert.deepEqual(state.responses, [{ activityId: "arrival", memberId: "hoting", status }]);
    assert.equal(state.reactions.length, 1);
  }
  const invalid = { ...state, responses: [{ activityId: "arrival", memberId: "hoting", status: "unknown" }] };
  assert.throws(() => parseBoardState(invalid), OperationError);
});

test("choice guards retain an exact date, start, and end snapshot, including an empty end", () => {
  const a = activity();
  const alternative = { ...a, title: "Another title", id: "another" };
  assert.equal(choiceKey(a), choiceKey(alternative));
  assert.notEqual(choiceKey(a), choiceKey({ ...a, date: "2026-11-01" }));
  assert.notEqual(choiceKey(a), choiceKey({ ...a, time: "13:31" }));
  assert.notEqual(choiceKey(a), choiceKey({ ...a, endTime: "14:16" }));
  assert.notEqual(choiceKey(a), choiceKey({ ...a, endTime: "" }));
  assert.equal(choiceKey({ ...a, endTime: "" }), "2026-10-31|13:30|");
});

test("overlap uses valid positive durations and half-open intervals on the same date", () => {
  const a = timedActivity("a", "09:00", "10:00");
  for (const other of [timedActivity("partial", "09:30", "10:30"), timedActivity("inside", "09:15", "09:45"), timedActivity("enclosing", "08:00", "11:00"), { ...a, id: "identical" }]) {
    assert.equal(activitiesOverlap(a, other), true);
    assert.equal(activitiesOverlap(other, a), true);
  }
  for (const other of [timedActivity("touch-after", "10:00", "11:00"), timedActivity("touch-before", "08:00", "09:00"), timedActivity("unknown", "09:30", ""), timedActivity("instant", "09:30", "09:30"), timedActivity("backward", "09:45", "09:15"), timedActivity("invalid", "09:30", "25:00"), timedActivity("other-day", "09:30", "10:30", "2026-11-01")]) {
    assert.equal(activitiesOverlap(a, other), false);
    assert.equal(activitiesOverlap(other, a), false);
  }
});

test("display groups connect overlap chains without declaring every connected activity mutually exclusive", () => {
  const a = timedActivity("a", "09:00", "10:00");
  const c = timedActivity("c", "10:00", "11:00");
  const b = timedActivity("b", "09:30", "10:30");
  const after = timedActivity("after", "11:00", "12:00");
  const unknown = timedActivity("unknown", "09:30", "");
  const otherDay = { ...b, id: "other-day", date: "2026-11-01" as const };
  const input = [a, c, b, after, unknown, otherDay];
  const groups = groupOverlaps(input);
  assert.deepEqual(groups.map((group) => group.map((item) => item.id)), [["a", "c", "b"], ["after"], ["unknown"], ["other-day"]]);
  assert.deepEqual(input.map((item) => item.id), ["a", "c", "b", "after", "unknown", "other-day"]);
  assert.equal(isMutuallyExclusiveGroup(groups[0]), false);
  assert.equal(isMutuallyExclusiveGroup([a, b]), true);
  assert.equal(isMutuallyExclusiveGroup([a, b, timedActivity("within-both", "09:40", "09:50")]), true);
  assert.equal(isMutuallyExclusiveGroup([]), false);
  assert.equal(isMutuallyExclusiveGroup([a]), false);
  assert.deepEqual(groupOverlaps([]), []);
});

test("an overlap chain permits both non-overlapping ends and switching to its middle clears only direct attendance", () => {
  const a = timedActivity("a", "09:00", "10:00");
  const b = timedActivity("b", "09:30", "10:30");
  const c = timedActivity("c", "10:00", "11:00");
  let state: BoardState = { version: 0, activities: [a, b, c], responses: [], reactions: [] };
  const going = (target: Activity, previousIds: string[], memberId: "hoting" | "mia" = "hoting"): Operation => ({ id: `going-${target.id}-${memberId}`, type: "participate", activityId: target.id, memberId, status: "going", choice: { key: choiceKey(target), previousIds } });
  state = applyOperation(state, going(a, []));
  state = applyOperation(state, going(c, []));
  assert.deepEqual(state.responses.map((response) => response.activityId), ["a", "c"]);
  state = applyOperation(state, going(a, [], "mia"));
  state = applyOperation(state, { id: "like-a", type: "react", activityId: a.id, memberId: "hoting", emoji: "👍", active: true });
  state = applyOperation(state, going(b, ["c", "a"]));
  assert.deepEqual(state.responses, [{ activityId: "a", memberId: "mia", status: "going" }, { activityId: "b", memberId: "hoting", status: "going" }]);
  assert.deepEqual(state.reactions, [{ activityId: "a", memberId: "hoting", emoji: "👍" }]);
});

test("open and zero-length activities do not remove attendance even at the same start time", () => {
  const fixed = timedActivity("fixed", "09:00", "10:00");
  const unknown = timedActivity("unknown", "09:00", "");
  const instant = timedActivity("instant", "09:00", "09:00");
  let state: BoardState = { version: 0, activities: [fixed, unknown, instant], responses: [], reactions: [] };
  for (const target of state.activities) {
    state = applyOperation(state, { id: `attend-${target.id}`, type: "participate", activityId: target.id, memberId: "hoting", status: "going", choice: { key: choiceKey(target), previousIds: [] } });
  }
  assert.equal(state.responses.length, 3);
  const before = structuredClone(state);
  assert.throws(() => applyOperation(state, { id: "define-duration", type: "update", activityId: unknown.id, base: { endTime: "" }, patch: { endTime: "09:30" } }), (error) => error instanceof OperationError && error.code === "CONFLICT");
  assert.deepEqual(state, before);
});

test("a guard detects another activity extending into the target without the target's exact time key changing", () => {
  const a = timedActivity("a", "09:00", "10:00");
  const target = timedActivity("target", "10:00", "11:00");
  let state: BoardState = { version: 0, activities: [a, target], responses: [{ activityId: a.id, memberId: "hoting", status: "going" }], reactions: [] };
  const originalChoice: Operation = { id: "confirm-before-extension", type: "participate", activityId: target.id, memberId: "hoting", status: "going", choice: { key: choiceKey(target), previousIds: [] } };
  state = applyOperation(state, { id: "extend-a", type: "update", activityId: a.id, base: { endTime: a.endTime }, patch: { endTime: "10:15" } });
  const before = structuredClone(state);
  assert.throws(() => applyOperation(state, originalChoice), (error) => error instanceof OperationError && error.code === "CONFLICT");
  assert.deepEqual(state, before);
  const confirmed = applyOperation(state, { ...originalChoice, id: "confirm-extension", choice: { key: choiceKey(target), previousIds: [a.id] } });
  assert.deepEqual(confirmed.responses, [{ activityId: target.id, memberId: "hoting", status: "going" }]);
  const noLongerOverlapping = applyOperation(state, { id: "shrink-a", type: "update", activityId: a.id, base: { endTime: "10:15" }, patch: { endTime: "10:00" } });
  assert.throws(() => applyOperation(noLongerOverlapping, { ...originalChoice, choice: { key: choiceKey(target), previousIds: [a.id] } }), (error) => error instanceof OperationError && error.code === "CONFLICT");
});

test("moving into a partial overlap rejects conflicts for any attendee while a touching boundary remains valid", () => {
  const a = timedActivity("a", "09:00", "10:00");
  const b = timedActivity("b", "10:30", "11:00");
  const state: BoardState = { version: 0, activities: [a, b], responses: [{ activityId: a.id, memberId: "mia", status: "going" }, { activityId: b.id, memberId: "mia", status: "going" }], reactions: [] };
  const before = structuredClone(state);
  assert.throws(() => applyOperation(state, { id: "partial-move", type: "update", activityId: b.id, base: { time: b.time }, patch: { time: "09:45" } }), (error) => error instanceof OperationError && error.code === "CONFLICT" && error.message === "这次移动会让已参加的安排重合，请先调整接龙。");
  assert.deepEqual(state, before);
  const moved = applyOperation(state, { id: "boundary-move", type: "update", activityId: b.id, base: { time: b.time }, patch: { time: "10:00" } });
  assert.equal(moved.activities.find((item) => item.id === b.id)?.time, "10:00");
  assert.deepEqual(moved.responses, state.responses);
});

test("changing a definite choice clears only that member's other going response in the identical slot", () => {
  const choose = (id: string, activityId: string, status: Participation, memberId: "hoting" | "mia" = "hoting"): Operation => ({ id, type: "participate", activityId, memberId, status });
  let state = applyOperation(seed(), choose("first-choice", "space-city", "going"));
  state = applyOperation(state, choose("friend-choice", "space-city", "going", "mia"));
  state = applyOperation(state, choose("other-slot", "dinner-first", "going"));
  state = applyOperation(state, { id: "like-first", type: "react", activityId: "space-city", memberId: "hoting", emoji: "❤️", active: true });
  state = applyOperation(state, choose("switch-choice", "machines", "going"));
  assert.equal(state.responses.find((response) => response.activityId === "space-city" && response.memberId === "hoting"), undefined);
  assert.equal(state.responses.find((response) => response.activityId === "machines" && response.memberId === "hoting")?.status, "going");
  assert.equal(state.responses.find((response) => response.activityId === "space-city" && response.memberId === "mia")?.status, "going");
  assert.equal(state.responses.find((response) => response.activityId === "dinner-first" && response.memberId === "hoting")?.status, "going");
  assert.equal(state.reactions.length, 1);
});

test("interested and maybe may coexist with a definite choice without counting as attendance", () => {
  const respond = (id: string, activityId: string, status: Participation): Operation => ({ id, type: "participate", activityId, memberId: "hoting", status });
  let state = applyOperation(seed(), respond("dinner-yes", "dinner-cassoulet", "going"));
  state = applyOperation(state, respond("dinner-interest", "dinner-buffet", "interested"));
  state = applyOperation(state, respond("dinner-maybe", "dinner-market", "maybe"));
  assert.equal(state.responses.filter((response) => response.status === "going").length, 1);
  assert.equal(state.responses.filter((response) => response.status === "interested").length, 1);
  assert.equal(state.responses.filter((response) => response.status === "maybe").length, 1);
  state = applyOperation(state, respond("dinner-switch", "dinner-market", "going"));
  assert.equal(state.responses.find((response) => response.activityId === "dinner-cassoulet"), undefined);
  assert.equal(state.responses.find((response) => response.activityId === "dinner-buffet")?.status, "interested");
  assert.equal(state.responses.find((response) => response.activityId === "dinner-market")?.status, "going");
});

test("different end times still conflict when durations overlap, and a going effect includes clearing overlapping attendance", () => {
  let state = seed();
  state = applyOperation(state, { id: "new-duration", type: "create", activity: { ...state.activities.find((item) => item.id === "space-city")!, id: "short-visit", endTime: "17:00", revision: 1 } });
  state = applyOperation(state, { id: "choose-full", type: "participate", activityId: "space-city", memberId: "hoting", status: "going" });
  state = applyOperation(state, { id: "choose-short", type: "participate", activityId: "short-visit", memberId: "hoting", status: "going" });
  assert.deepEqual(state.responses, [{ activityId: "short-visit", memberId: "hoting", status: "going" }]);
  const op: Operation = { id: "fix-legacy", type: "participate", activityId: "space-city", memberId: "hoting", status: "going" };
  const legacy: BoardState = { ...state, responses: [...state.responses, { activityId: "space-city", memberId: "hoting", status: "going" }] };
  assert.equal(hasOperationEffect(legacy, op), false);
  const corrected = applyOperation(legacy, op);
  assert.equal(hasOperationEffect(corrected, op), true);
  assert.deepEqual(corrected.responses, [{ activityId: "space-city", memberId: "hoting", status: "going" }]);
});

test("moving an attended activity into a conflicting choice group is rejected without changing anyone's responses", () => {
  let state = applyOperation(seed(), participation("join-arrival", "going"));
  state = applyOperation(state, { id: "join-dinner", type: "participate", activityId: "dinner-cassoulet", memberId: "hoting", status: "going" });
  const before = structuredClone(state);
  const a = state.activities.find((item) => item.id === "arrival")!;
  const move: Operation = { id: "conflicting-move", type: "update", activityId: a.id, base: { date: a.date, time: a.time, endTime: a.endTime }, patch: { date: "2026-11-01", time: "19:30", endTime: "21:00" } };
  assert.throws(() => applyOperation(state, move), (error) => error instanceof OperationError && error.code === "CONFLICT" && error.message === "这次移动会让已参加的安排重合，请先调整接龙。");
  assert.deepEqual(state, before);
  state = applyOperation(state, { id: "tentative-dinner", type: "participate", activityId: "dinner-cassoulet", memberId: "hoting", status: "maybe" });
  const moved = applyOperation(state, move);
  assert.equal(moved.activities.find((item) => item.id === "arrival")?.date, "2026-11-01");
  assert.equal(moved.responses.find((response) => response.activityId === "dinner-cassoulet")?.status, "maybe");
});

test("a guarded choice switches exactly the confirmed alternatives and keeps other members intact", () => {
  let state = applyOperation(seed(), { id: "guard-first", type: "participate", activityId: "space-city", memberId: "hoting", status: "going" });
  state = applyOperation(state, { id: "guard-friend", type: "participate", activityId: "space-city", memberId: "mia", status: "going" });
  const target = state.activities.find((item) => item.id === "machines")!;
  const op: Operation = { id: "guard-switch", type: "participate", activityId: target.id, memberId: "hoting", status: "going", choice: { key: choiceKey(target), previousIds: ["space-city"] } };
  const changed = applyOperation(state, op);
  assert.equal(changed.responses.find((response) => response.activityId === "machines" && response.memberId === "hoting")?.status, "going");
  assert.equal(changed.responses.find((response) => response.activityId === "space-city" && response.memberId === "hoting"), undefined);
  assert.equal(changed.responses.find((response) => response.activityId === "space-city" && response.memberId === "mia")?.status, "going");
  assert.equal(hasOperationEffect(changed, op), true);
});

test("a guarded choice rejects a remotely moved target without withdrawing another activity", () => {
  let state = applyOperation(seed(), { id: "future-going", type: "participate", activityId: "dinner-cassoulet", memberId: "hoting", status: "going" });
  const target = state.activities.find((item) => item.id === "machines")!;
  const op: Operation = { id: "stale-slot", type: "participate", activityId: target.id, memberId: "hoting", status: "going", choice: { key: choiceKey(target), previousIds: [] } };
  state = applyOperation(state, { id: "remote-slot", type: "update", activityId: target.id, base: { date: target.date, time: target.time, endTime: target.endTime }, patch: { date: "2026-11-01", time: "19:30", endTime: "21:00" } });
  const before = structuredClone(state);
  assert.throws(() => applyOperation(state, op), (error) => error instanceof OperationError && error.code === "CONFLICT" && error.message === "候选安排刚有变化，请查看后重新确认。");
  assert.deepEqual(state, before);
  assert.equal(state.responses.find((response) => response.activityId === "dinner-cassoulet")?.status, "going");
});

test("a guarded choice rejects a changed previous selection, while previousIds are compared as an unordered set", () => {
  const state = seed();
  const target = state.activities.find((item) => item.id === "dinner-market")!;
  const op: Operation = { id: "stale-previous", type: "participate", activityId: target.id, memberId: "hoting", status: "going", choice: { key: choiceKey(target), previousIds: ["dinner-cassoulet"] } };
  assert.throws(() => applyOperation(state, op), (error) => error instanceof OperationError && error.code === "CONFLICT");
  const legacy: BoardState = { ...state, responses: [
    { activityId: "dinner-cassoulet", memberId: "hoting", status: "going" },
    { activityId: "dinner-buffet", memberId: "hoting", status: "going" },
  ] };
  const changed = applyOperation(legacy, { ...op, choice: { key: choiceKey(target), previousIds: ["dinner-buffet", "dinner-cassoulet"] } });
  assert.deepEqual(changed.responses, [{ activityId: target.id, memberId: "hoting", status: "going" }]);
});

test("choice guards reject duplicate IDs, unknown fields, invalid time ranges, and non-going states", () => {
  const target = seed().activities.find((item) => item.id === "machines")!;
  const op = { id: "invalid-guard", type: "participate" as const, activityId: target.id, memberId: "hoting" as const, status: "going" as const, choice: { key: choiceKey(target), previousIds: [] as string[] } };
  for (const invalid of [
    { ...op, status: "interested" },
    { ...op, choice: { ...op.choice, previousIds: ["space-city", "space-city"] } },
    { ...op, choice: { ...op.choice, extra: true } },
    { ...op, choice: { ...op.choice, key: "2026-10-31|18:00|14:30" } },
    { ...op, choice: { ...op.choice, key: "2026-10-31|25:00|" } },
  ]) assert.throws(() => applyOperation(seed(), invalid as Operation), (error) => error instanceof OperationError && error.code === "VALIDATION");
});

test("different fields merge from the same editing baseline", () => {
  const base = activity();
  let state = applyOperation(seed(), { id: "rename", type: "update", activityId: base.id, base: { title: base.title }, patch: { title: "先喝咖啡" } });
  state = applyOperation(state, { id: "relocate", type: "update", activityId: base.id, base: { location: base.location }, patch: { location: "车站咖啡馆" } });
  assert.equal(state.activities[0].title, "先喝咖啡");
  assert.equal(state.activities[0].location, "车站咖啡馆");
  assert.equal(state.activities[0].revision, base.revision + 2);
});

test("the same field conflicts without reverting other people or mutating the input", () => {
  const base = activity();
  const state = applyOperation(seed(), { id: "first", type: "update", activityId: base.id, base: { title: base.title }, patch: { title: "新的集合安排" } });
  assert.throws(() => applyOperation(state, { id: "second", type: "update", activityId: base.id, base: { title: base.title }, patch: { title: "我的旧草稿" } }), (error) => error instanceof OperationError && error.code === "CONFLICT");
  assert.equal(state.activities[0].title, "新的集合安排");
  assert.equal(state.version, SEED_STATE.version + 1);
});

test("an already equal patch is accepted without claiming operation-ID deduplication", () => {
  const base = activity();
  const op: Operation = { id: "patch-a", type: "update", activityId: base.id, base: { title: base.title }, patch: { title: "新的集合安排" } };
  const state = applyOperation(applyOperation(seed(), op), { ...op, id: "patch-b" });
  assert.equal(state.activities[0].revision, base.revision + 2);
  assert.equal(state.version, SEED_STATE.version + 2);
});

test("moving a proposal preserves its participants and never replaces another proposal", () => {
  const base = activity();
  let state = applyOperation(seed(), participation("join", "going"));
  state = applyOperation(state, { id: "move", type: "update", activityId: base.id, base: { date: base.date, time: base.time, endTime: base.endTime, sortOrder: base.sortOrder }, patch: { date: "2026-11-01", time: "19:30", endTime: "21:00", sortOrder: 450 } });
  assert.equal(state.activities.length, SEED_STATE.activities.length);
  assert.equal(state.activities.filter((item) => item.date === "2026-11-01" && item.time === "19:30").length, 4);
  assert.equal(state.responses.length, 1);
});

test("deleting checks the editing revision and cascades responses and reactions", () => {
  let state = applyOperation(seed(), participation("join", "going"));
  state = applyOperation(state, reaction("like", true));
  assert.throws(() => applyOperation(state, { id: "stale-delete", type: "delete", activityId: "arrival", expectedRevision: activity().revision + 1 }), (error) => error instanceof OperationError && error.code === "CONFLICT");
  state = applyOperation(state, { id: "delete", type: "delete", activityId: "arrival", expectedRevision: activity().revision });
  assert.equal(state.responses.length, 0);
  assert.equal(state.reactions.length, 0);
  assert.throws(() => applyOperation(state, participation("late-join", "going")), (error) => error instanceof OperationError && error.code === "NOT_FOUND");
});

test("time validation permits an open end and rejects backwards, invalid dates, and blank titles", () => {
  const base = activity();
  const created = { ...base, id: "open-ended", endTime: "", revision: 1 };
  assert.equal(applyOperation(seed(), { id: "open", type: "create", activity: created }).activities.at(-1)?.endTime, "");
  for (const invalid of [{ ...created, time: "25:00" }, { ...created, endTime: "12:00" }, { ...created, title: "\t\n " }, { ...created, date: "2026-11-03" }, { ...created, title: "🚀".repeat(61) }]) {
    assert.throws(() => applyOperation(seed(), { id: "invalid", type: "create", activity: invalid as Activity }), OperationError);
  }
});

test("stale authoritative snapshots cannot roll back newer data", () => {
  const newer = applyOperation(seed(), participation("new", "going"));
  assert.equal(mergeSnapshot(newer, seed()), newer);
  assert.equal(mergeSnapshot(newer, { ...seed(), version: newer.version }), newer);
});

test("the cloud queue serializes rapid intents and captures the member at dispatch", async () => {
  const first = deferred<OperationResult>();
  let remote = seed();
  let active = 0;
  let maximum = 0;
  let count = 0;
  const harness = cloud(async (operation) => {
    active += 1;
    maximum = Math.max(maximum, active);
    count += 1;
    if (count === 1) { const result = await first.promise; active -= 1; return result; }
    remote = applyOperation(remote, operation);
    active -= 1;
    return { state: remote };
  });
  try {
    await until(() => harness.store.getSnapshot().ready);
    const mutable = participation("first", "going");
    const one = harness.store.dispatch(mutable);
    const two = harness.store.dispatch(participation("second", "not-going"));
    const three = harness.store.dispatch(participation("third", "going", "mia"));
    if (mutable.type === "participate") mutable.memberId = "mia";
    assert.equal(harness.calls.length, 1);
    assert.deepEqual(harness.store.getSnapshot().state.responses.map((response) => [response.memberId, response.status]), [["hoting", "not-going"], ["mia", "going"]]);
    remote = applyOperation(remote, participation("first", "going"));
    first.resolve({ state: remote });
    await Promise.all([one, two, three]);
    assert.equal(maximum, 1);
    assert.equal(harness.calls[0].type === "participate" && harness.calls[0].memberId, "hoting");
    assert.equal(harness.store.getSnapshot().pendingCount, 0);
    assert.deepEqual(harness.store.getSnapshot().state.responses.map((response) => [response.memberId, response.status]), [["hoting", "not-going"], ["mia", "going"]]);
  } finally { harness.store.stop(); }
});

test("a realtime echo and older RPC response preserve the latest local intent and newer remote fields", async () => {
  const first = deferred<OperationResult>();
  const second = deferred<OperationResult>();
  let count = 0;
  const harness = cloud(() => (++count === 1 ? first : second).promise);
  try {
    await until(() => harness.store.getSnapshot().ready);
    const one = harness.store.dispatch(participation("first", "going"));
    const two = harness.store.dispatch(participation("second", "not-going"));
    const afterFirst = applyOperation(seed(), participation("first", "going"));
    harness.emit(afterFirst);
    assert.equal(harness.store.getSnapshot().state.responses[0].status, "not-going");
    first.resolve({ state: afterFirst });
    await until(() => harness.calls.length === 2);
    const afterSecond = applyOperation(afterFirst, participation("second", "not-going"));
    const newer = applyOperation(afterSecond, { id: "remote-title", type: "update", activityId: "arrival", base: { title: activity().title }, patch: { title: "远端更新的集合地点" } });
    harness.emit(newer);
    second.resolve({ state: afterSecond });
    await Promise.all([one, two]);
    assert.equal(harness.store.getSnapshot().state.version, SEED_STATE.version + 3);
    assert.equal(harness.store.getSnapshot().state.activities[0].title, "远端更新的集合地点");
    assert.equal(harness.store.getSnapshot().state.responses[0].status, "not-going");
  } finally { harness.store.stop(); }
});

test("an uncertain successful create retries the same operation ID and cannot duplicate the activity", async () => {
  const op: Operation = { id: "create-once", type: "create", activity: { ...activity(), id: "new-proposal", title: "大家一起喝咖啡", revision: 1 } };
  let remote = seed();
  let first = true;
  const harness = cloud(async (operation) => {
    if (first) { first = false; remote = applyOperation(remote, operation); throw new Error("reply lost after commit"); }
    return { state: remote, duplicate: true };
  });
  try {
    await until(() => harness.store.getSnapshot().ready);
    await assert.rejects(harness.store.dispatch(op), /reply lost/);
    assert.equal(harness.store.getSnapshot().pendingCount, 1);
    assert.equal(harness.store.getSnapshot().failedCount, 1);
    assert.equal(harness.store.getSnapshot().state.activities.filter((item) => item.id === "new-proposal").length, 1);
    await harness.store.dispatch(op);
    assert.deepEqual(harness.calls.map((operation) => operation.id), ["create-once", "create-once"]);
    assert.equal(harness.store.getSnapshot().pendingCount, 0);
    assert.equal(harness.store.getSnapshot().state.activities.filter((item) => item.id === "new-proposal").length, 1);
  } finally { harness.store.stop(); }
});

test("two callers awaiting the same in-flight operation share one actual write", async () => {
  const result = deferred<OperationResult>();
  const harness = cloud(() => result.promise);
  try {
    await until(() => harness.store.getSnapshot().ready);
    const op = participation("same-op", "going");
    const one = harness.store.dispatch(op);
    const two = harness.store.dispatch(structuredClone(op));
    assert.equal(harness.calls.length, 1);
    result.resolve({ state: applyOperation(seed(), op) });
    await Promise.all([one, two]);
    assert.equal(harness.store.getSnapshot().pendingCount, 0);
  } finally { harness.store.stop(); }
});

test("a definite conflict stays visible while unrelated operations continue", async () => {
  let remote = seed();
  const harness = cloud(async (operation) => {
    if (operation.type === "update") throw new OperationError("CONFLICT", "someone edited the same field");
    remote = applyOperation(remote, operation);
    return { state: remote };
  });
  try {
    await until(() => harness.store.getSnapshot().ready);
    await assert.rejects(harness.store.dispatch({ id: "conflict", type: "update", activityId: "arrival", base: { title: activity().title }, patch: { title: "草稿" } }), /same field/);
    await harness.store.dispatch(participation("unrelated", "going", "mia"));
    assert.equal(harness.store.getSnapshot().pendingCount, 1);
    assert.equal(harness.store.getSnapshot().state.responses[0].memberId, "mia");
    harness.store.clearError();
    assert.match(harness.store.getSnapshot().error || "", /same field/);
    harness.store.dropFailed();
    assert.equal(harness.store.getSnapshot().pendingCount, 0);
  } finally { harness.store.stop(); }
});

test("local persistence deduplicates an operation ID, restores on reload, and reports local mode", async () => {
  const storage = new MemoryStorage();
  const store = new BoardStore(null, storage);
  store.start();
  try {
    const op: Operation = { id: "local-create", type: "create", activity: { ...activity(), id: "local-activity", revision: 1 } };
    await store.dispatch(op);
    await store.dispatch(op);
    assert.equal(store.getSnapshot().mode, "local");
    assert.equal(store.getSnapshot().state.version, 1);
    assert.equal(store.getSnapshot().state.activities.length, 1);
    const reloaded = new BoardStore(null, storage);
    reloaded.start();
    assert.equal(reloaded.getSnapshot().state.activities.length, 1);
    assert.equal(reloaded.getSnapshot().state.version, 1);
    reloaded.stop();
  } finally { store.stop(); }
});

test("a failed local persistence write never becomes an authoritative success", async () => {
  const storage = new MemoryStorage();
  storage.setItem = () => { throw new Error("quota"); };
  const store = new BoardStore(null, storage);
  store.start();
  try {
    await assert.rejects(store.dispatch({ id: "write-fails", type: "create", activity: { ...activity(), id: "unsaved-activity", revision: 1 } }), /没有保存/);
    assert.equal(store.getSnapshot().pendingCount, 1);
    assert.equal(storage.getItem(LOCAL_BOARD_KEY), null);
    store.dropFailed();
    assert.equal(store.getSnapshot().state.version, 0);
    assert.equal(store.getSnapshot().state.activities.length, 0);
    assert.equal(store.getSnapshot().state.responses.length, 0);
  } finally { store.stop(); }
});

test("unconfirmed cloud writes survive a reload as pending and reuse their original operation ID", async () => {
  const cache = new MemoryStorage();
  const pending = new MemoryStorage();
  const calls: string[] = [];
  let shouldFail = true;
  let remote = seed();
  const transport: BoardTransport = {
    read: async () => remote,
    subscribe: (_state, status) => { queueMicrotask(() => status(true)); return () => {}; },
    async apply(operation) {
      calls.push(operation.id);
      if (shouldFail) throw new Error("connection lost");
      remote = applyOperation(remote, operation);
      return { state: remote };
    },
  };
  const first = new BoardStore(transport, cache, pending);
  first.start();
  await until(() => first.getSnapshot().ready);
  await assert.rejects(first.dispatch(participation("persisted-id", "going")), /connection lost/);
  first.stop();
  assert.equal(JSON.parse([...cache.values.values()][0]).responses.length, 0);
  shouldFail = false;
  const reloaded = new BoardStore(transport, cache, pending);
  reloaded.start();
  try {
    await until(() => reloaded.getSnapshot().pendingCount === 0 && reloaded.getSnapshot().state.responses.length === 1);
    assert.deepEqual(calls, ["persisted-id", "persisted-id"]);
    assert.equal(reloaded.getSnapshot().state.responses[0].memberId, "hoting");
  } finally { reloaded.stop(); }
});

test("an initial load failure rejects waiting saves visibly instead of leaving their promises hanging", async () => {
  const read = deferred<BoardState>();
  let recover = false;
  let remote = seed();
  const transport: BoardTransport = {
    read: () => recover ? Promise.resolve(remote) : read.promise,
    subscribe: () => () => {},
    async apply(operation) { remote = applyOperation(remote, operation); return { state: remote }; },
  };
  const store = new BoardStore(transport, new MemoryStorage(), new MemoryStorage());
  store.start();
  try {
    const save = assert.rejects(store.dispatch(participation("before-loaded", "going")), /等待同步/);
    read.reject(new Error("unreachable"));
    await save;
    assert.equal(store.getSnapshot().pendingCount, 1);
    assert.equal(store.getSnapshot().failedCount, 1);
    assert.ok(store.getSnapshot().error);
    recover = true;
    store.retry();
    await until(() => store.getSnapshot().pendingCount === 0);
    assert.equal(store.getSnapshot().state.responses[0].status, "going");
  } finally { store.stop(); }
});

test("stopping and restarting the store during a request does not send the mutation twice", async () => {
  const result = deferred<OperationResult>();
  const harness = cloud(() => result.promise);
  try {
    await until(() => harness.store.getSnapshot().ready);
    const op = participation("strict-mode", "going");
    const save = harness.store.dispatch(op);
    harness.store.stop();
    harness.store.start();
    result.resolve({ state: applyOperation(seed(), op) });
    await save;
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.store.getSnapshot().pendingCount, 0);
  } finally { harness.store.stop(); }
});

test("dropOperation removes only the selected known failed edit", async () => {
  const harness = cloud(async () => { throw new OperationError("CONFLICT", "known conflict"); });
  try {
    await until(() => harness.store.getSnapshot().ready);
    await assert.rejects(harness.store.dispatch(participation("failed-one", "going")), /known conflict/);
    await assert.rejects(harness.store.dispatch(participation("failed-two", "maybe")), /known conflict/);
    assert.equal(harness.store.getSnapshot().pendingCount, 2);
    harness.store.dropOperation("failed-one");
    assert.equal(harness.store.getSnapshot().pendingCount, 1);
    harness.store.dropOperation("missing-id");
    assert.equal(harness.store.getSnapshot().pendingCount, 1);
    harness.store.dropOperation("failed-two");
    assert.equal(harness.store.getSnapshot().pendingCount, 0);
  } finally { harness.store.stop(); }
});

test("dropOperation cannot discard sending, queued, or uncertain writes", async () => {
  const result = deferred<OperationResult>();
  const harness = cloud(() => result.promise);
  try {
    await until(() => harness.store.getSnapshot().ready);
    const save = harness.store.dispatch(participation("sending", "going"));
    const saveFailure = assert.rejects(save, /reply lost/);
    harness.store.dropOperation("sending");
    assert.equal(harness.store.getSnapshot().pendingCount, 1);
    const queuedSave = harness.store.dispatch(participation("queued", "maybe"));
    const queuedFailure = assert.rejects(queuedSave, /前面的修改尚未同步/);
    harness.store.dropOperation("queued");
    assert.equal(harness.store.getSnapshot().pendingCount, 2);
    result.reject(new Error("reply lost"));
    await saveFailure;
    await queuedFailure;
    harness.store.dropOperation("sending");
    assert.equal(harness.store.getSnapshot().failedCount, 1);
    assert.equal(harness.store.getSnapshot().pendingCount, 2);
  } finally { harness.store.stop(); }
});

test("the editor authority never contains an unconfirmed optimistic patch or its failed draft", async () => {
  const result = deferred<OperationResult>();
  const harness = cloud(() => result.promise);
  try {
    await until(() => harness.store.getSnapshot().ready);
    const original = activity();
    const op: Operation = { id: "optimistic-draft", type: "update", activityId: original.id, base: { title: original.title }, patch: { title: "必须保留的草稿" } };
    const save = assert.rejects(harness.store.dispatch(op), /someone changed it/);
    assert.equal(harness.store.getSnapshot().state.activities[0].title, "必须保留的草稿");
    assert.equal(harness.store.getSnapshot().authoritativeState.activities[0].title, original.title);
    assert.equal(harness.store.getSnapshot().authoritativeState.version, SEED_STATE.version);
    const remote = applyOperation(seed(), { id: "other-edit", type: "update", activityId: original.id, base: { title: original.title }, patch: { title: "同行刚修改的名称" } });
    harness.emit(remote);
    assert.equal(harness.store.getSnapshot().authoritativeState.activities[0].title, "同行刚修改的名称");
    result.reject(new OperationError("CONFLICT", "someone changed it"));
    await save;
    assert.equal(harness.store.getSnapshot().authoritativeState.activities[0].title, "同行刚修改的名称");
    assert.equal(harness.store.getSnapshot().state.activities[0].title, "同行刚修改的名称");
  } finally { harness.store.stop(); }
});

test("a network failure releases later saving forms without losing their queued intents or IDs", async () => {
  const firstReply = deferred<OperationResult>();
  let count = 0;
  let remote = seed();
  const harness = cloud(async (operation) => {
    count += 1;
    if (count === 1) return firstReply.promise;
    remote = applyOperation(remote, operation);
    return { state: remote };
  });
  try {
    await until(() => harness.store.getSnapshot().ready);
    const first = assert.rejects(harness.store.dispatch(participation("blocked-first", "going")), /offline/);
    const second = assert.rejects(harness.store.dispatch(participation("waiting-second", "maybe", "mia")), /前面的修改尚未同步/);
    firstReply.reject(new Error("offline"));
    await Promise.all([first, second]);
    assert.equal(harness.store.getSnapshot().pendingCount, 2);
    assert.equal(harness.calls.length, 1);
    harness.store.retry();
    await until(() => harness.store.getSnapshot().pendingCount === 0);
    assert.deepEqual(harness.calls.map((operation) => operation.id), ["blocked-first", "blocked-first", "waiting-second"]);
    assert.equal(harness.store.getSnapshot().state.responses.find((response) => response.memberId === "mia")?.status, "maybe");
  } finally { harness.store.stop(); }
});

test("a duplicated create that has since been deleted rejects as removed and clears its acknowledged pending entry", async () => {
  const op: Operation = { id: "already-created", type: "create", activity: { ...activity(), id: "then-deleted", revision: 1 } };
  const created = applyOperation(seed(), op);
  const deleted = applyOperation(created, { id: "someone-deleted", type: "delete", activityId: "then-deleted", expectedRevision: 1 });
  const harness = cloud(async () => ({ state: deleted, duplicate: true }));
  try {
    await until(() => harness.store.getSnapshot().ready);
    await assert.rejects(harness.store.dispatch(op), (error) => error instanceof OperationError && error.code === "NOT_FOUND" && /可以再次添加/.test(error.message));
    assert.equal(harness.store.getSnapshot().pendingCount, 0);
    assert.equal(harness.store.getSnapshot().failedCount, 0);
    assert.equal(harness.store.getSnapshot().state.activities.some((candidate) => candidate.id === "then-deleted"), false);
  } finally { harness.store.stop(); }
});
