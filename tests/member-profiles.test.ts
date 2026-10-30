import assert from "node:assert/strict";
import { test } from "node:test";
import { BoardStore, LOCAL_BOARD_KEY, type BoardTransport } from "../src/hooks/use-board";
import { AVATAR_PRESETS, getMemberProfile, isValidAvatar, isValidProfileName, MAX_AVATAR_BYTES, MAX_PROFILE_OPERATION_BYTES } from "../src/lib/member-profiles";
import { applyOperation, hasOperationEffect, OperationError, parseBoardState, validateOperation } from "../src/lib/operations";
import { SEED_STATE } from "../src/lib/seed";
import { MEMBERS, type BoardState, type MemberProfile, type Operation } from "../src/lib/types";

const seed = (): BoardState => structuredClone(SEED_STATE);
const profile = (id: string, patch: Partial<MemberProfile>, base: Partial<MemberProfile>): Operation => ({ id, type: "profile", memberId: "mia", patch, base });
const jpeg = (size = 5, fill = 0): string => {
  const bytes = Buffer.alloc(size, fill);
  bytes.set([255, 216, 255]); bytes.set([255, 217], size - 2);
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
};
const validation = (error: unknown) => error instanceof OperationError && error.code === "VALIDATION";

test("legacy boards retain the original five stable identities without writing profiles", () => {
  const state = parseBoardState(seed());
  for (const member of MEMBERS) assert.deepEqual(getMemberProfile(state, member.id), { name: member.name, avatar: "" });
  assert.equal(Object.hasOwn(state, "profiles"), false);
  assert.deepEqual(parseBoardState({ ...state, profiles: {} }).profiles, {});
});

test("profiles round-trip through snapshot parsing and reject malformed public snapshots", () => {
  const state = applyOperation(seed(), profile("profile-roundtrip", { name: "米娅", avatar: "🐱" }, { name: "Mia", avatar: "" }));
  assert.deepEqual(parseBoardState(JSON.parse(JSON.stringify(state))), state);
  for (const profiles of [null, [], { outsider: { name: "Extra", avatar: "" } }, { mia: { name: "Mia" } }, { mia: { name: "Mia", avatar: "", other: true } }, { mia: { name: "Mia", avatar: "https://example.com/a.jpg" } }]) {
    assert.throws(() => parseBoardState({ ...state, profiles }), validation);
  }
});

test("profile changes preserve participation, reactions, activities and all stable member IDs", () => {
  let state = applyOperation(seed(), { id: "profile-going", type: "participate", activityId: "arrival", memberId: "mia", status: "going" });
  state = applyOperation(state, { id: "profile-like", type: "react", activityId: "arrival", memberId: "mia", emoji: "👍", active: true });
  const before = structuredClone(state);
  state = applyOperation(state, profile("profile-both", { name: "米娅", avatar: "🐱" }, { name: "Mia", avatar: "" }));
  assert.deepEqual(state.activities, before.activities);
  assert.deepEqual(state.responses, before.responses);
  assert.deepEqual(state.reactions, before.reactions);
  assert.equal(state.version, before.version + 1);
  assert.deepEqual(getMemberProfile(state, "mia"), { name: "米娅", avatar: "🐱" });
  assert.deepEqual(getMemberProfile(state, "hoting"), { name: "Hoting", avatar: "" });
  state = applyOperation(state, { id: "after-profile", type: "update", activityId: "arrival", patch: { title: "集合" }, base: { title: state.activities[0].title } });
  state = applyOperation(state, { id: "after-profile-delete", type: "delete", activityId: "arrival", expectedRevision: state.activities[0].revision });
  assert.deepEqual(getMemberProfile(state, "mia"), { name: "米娅", avatar: "🐱" });
});

test("name and avatar edits merge independently; same-field conflicts are atomic", () => {
  const original = seed();
  let state = applyOperation(original, profile("name-first", { name: "Mimi" }, { name: "Mia" }));
  state = applyOperation(state, profile("avatar-second", { avatar: "🐼" }, { avatar: "" }));
  assert.deepEqual(getMemberProfile(state, "mia"), { name: "Mimi", avatar: "🐼" });
  const before = structuredClone(state);
  assert.throws(() => applyOperation(state, profile("profile-conflict", { name: "M", avatar: "😎" }, { name: "Mia", avatar: "🐼" })), (error) => error instanceof OperationError && error.code === "CONFLICT");
  assert.deepEqual(state, before);
  const equal = profile("already-equal", { name: "Mimi" }, { name: "Mia" });
  assert.equal(hasOperationEffect(state, equal), true);
  assert.equal(hasOperationEffect(state, profile("not-equal", { name: "Other" }, { name: "Mia" })), false);
  assert.equal(applyOperation(state, equal).version, state.version + 1);
  assert.equal(original.profiles, undefined);
});

test("nicknames count Unicode code points and reject controls, untrimmed strings and lone surrogates", () => {
  for (const valid of ["Mia", "米娅", "🚀".repeat(24), "a b", "é"]) assert.equal(isValidProfileName(valid), true, valid);
  for (const invalid of ["", " ", " Mia", "Mia\u00a0", "🚀".repeat(25), "A\nB", "A\u0000B", "A\u007fB", "A\u009fB", "\ud800", 7, null]) {
    assert.equal(isValidProfileName(invalid), false);
    assert.throws(() => validateOperation(profile("invalid-name", { name: invalid as string }, { name: "Mia" })), validation);
  }
});

test("avatar whitelist and canonical raster signatures reject arbitrary URLs, SVG and disguised content", () => {
  const png = `data:image/png;base64,${Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), Buffer.alloc(8)]).toString("base64")}`;
  const webp = `data:image/webp;base64,${Buffer.from("RIFFxxxxWEBP").toString("base64")}`;
  for (const valid of ["", ...AVATAR_PRESETS, jpeg(), png, webp]) assert.equal(isValidAvatar(valid), true);
  for (const invalid of ["❤️", "https://example.com/a.jpg", "javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/jpeg;base64,YWJj", jpeg().replace("jpeg", "png"), jpeg() + "\n", jpeg().replace(/=$/, ""), "data:image/jpeg;base64,/9j//9l=", "data:image/png;base64,AA==", webp.replace("RIFF", "xxxx") + " "]) assert.equal(isValidAvatar(invalid), false, invalid);
});

test("all 36 distinct emoji avatars round-trip, including a switch from a legacy photo", () => {
  assert.equal(AVATAR_PRESETS.length, 36);
  assert.equal(new Set(AVATAR_PRESETS).size, 36);
  let state = parseBoardState({ ...seed(), profiles: { mia: { name: "Mia", avatar: jpeg() } } });
  for (const [index, avatar] of AVATAR_PRESETS.entries()) {
    state = applyOperation(state, profile(`emoji-preset-${index}`, { avatar }, { avatar: getMemberProfile(state, "mia").avatar }));
    state = parseBoardState(JSON.parse(JSON.stringify(state)));
    assert.deepEqual(getMemberProfile(state, "mia"), { name: "Mia", avatar });
  }
  assert.equal(getMemberProfile(state, "mia").avatar, "✈️");
});

test("a maximum-size old and new photo fit together without raising the limit on activity requests", () => {
  const previous = jpeg(MAX_AVATAR_BYTES);
  const next = jpeg(MAX_AVATAR_BYTES, 1);
  assert.equal(isValidAvatar(previous), true);
  assert.equal(isValidAvatar(jpeg(MAX_AVATAR_BYTES + 1)), false);
  const operation = profile("replace-large-photo", { avatar: next }, { avatar: previous });
  assert.ok(Buffer.byteLength(JSON.stringify(operation)) > 65536);
  assert.ok(Buffer.byteLength(JSON.stringify(operation)) < MAX_PROFILE_OPERATION_BYTES);
  assert.doesNotThrow(() => validateOperation(operation));
  assert.throws(() => validateOperation({ id: "large-activity", type: "update", activityId: "arrival", patch: { note: previous }, base: { note: "" } }), validation);
  assert.throws(() => validateOperation(profile("large-invalid-profile", { avatar: "x".repeat(MAX_PROFILE_OPERATION_BYTES) }, { avatar: "" })), validation);
});

test("profile patch/base keys are exact, nonempty, known and both sides are validated", () => {
  const valid = profile("profile-validation", { name: "New" }, { name: "Mia" });
  for (const invalid of [
    { ...valid, memberId: "outsider" }, { ...valid, patch: {}, base: {} },
    { ...valid, patch: { unknown: "x" }, base: { unknown: "y" } },
    { ...valid, base: { avatar: "" } }, { ...valid, base: { name: "Mia", avatar: "" } },
    { ...valid, base: { name: "" } }, { ...valid, activityId: "arrival" },
  ]) assert.throws(() => validateOperation(invalid), validation);
});

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
async function until(check: () => boolean) {
  for (let n = 0; n < 100; n += 1) { if (check()) return; await new Promise<void>((resolve) => setImmediate(resolve)); }
  assert.fail("Expected store transition did not occur");
}

test("local profile retries are idempotent and survive reload without changing existing activities", async () => {
  const disk = new MemoryStorage();
  disk.setItem(LOCAL_BOARD_KEY, JSON.stringify({ state: seed(), applied: {} }));
  const store = new BoardStore(null, disk, new MemoryStorage());
  store.start();
  await until(() => store.getSnapshot().ready);
  const operation = profile("local-profile", { name: "Mimi", avatar: "🦊" }, { name: "Mia", avatar: "" });
  await store.dispatch(operation);
  await store.dispatch(operation);
  const state = store.getSnapshot().state;
  assert.equal(state.version, SEED_STATE.version + 1);
  assert.deepEqual(state.activities, SEED_STATE.activities);
  store.stop();
  const restored = new BoardStore(null, disk, new MemoryStorage());
  restored.start();
  await until(() => restored.getSnapshot().ready);
  assert.deepEqual(restored.getSnapshot().state, state);
  restored.stop();
});

test("uncertain cloud profile retry keeps the same request and accepts a newer authoritative profile", async () => {
  let remote = seed();
  const calls: Operation[] = [];
  const transport: BoardTransport = {
    read: async () => remote,
    subscribe(_onState, onStatus) { queueMicrotask(() => onStatus(true)); return () => {}; },
    apply: async (operation) => {
      calls.push(structuredClone(operation));
      if (calls.length === 1) {
        remote = applyOperation(remote, operation);
        throw new Error("Response lost after commit");
      }
      return { state: remote, duplicate: true };
    },
  };
  const store = new BoardStore(transport, new MemoryStorage(), new MemoryStorage());
  store.start();
  await until(() => store.getSnapshot().ready);
  const operation = profile("cloud-profile", { name: "Mimi" }, { name: "Mia" });
  await assert.rejects(store.dispatch(operation), /Response lost/);
  remote = applyOperation(remote, profile("remote-followup", { name: "米娅" }, { name: "Mimi" }));
  await store.dispatch(operation);
  assert.deepEqual(calls, [operation, operation]);
  assert.equal(store.getSnapshot().pendingCount, 0);
  assert.equal(getMemberProfile(store.getSnapshot().state, "mia").name, "米娅");
  assert.deepEqual(store.getSnapshot().authoritativeState, remote);
  store.stop();
});
