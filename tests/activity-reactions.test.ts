import assert from "node:assert/strict";
import { test } from "node:test";
import { BoardStore, type BoardTransport } from "../src/hooks/use-board";
import { applyOperation, OperationError, parseBoardState, validateOperation } from "../src/lib/operations";
import { SEED_STATE } from "../src/lib/seed";
import { EMOJIS, type BoardState, type Emoji, type MemberId, type Operation } from "../src/lib/types";

const seed = (): BoardState => ({ ...structuredClone(SEED_STATE), profiles: { mia: { name: "米娅", avatar: "✈️" } } });
const reaction = (id: string, emoji: Emoji, active: boolean, memberId: MemberId = "mia", activityId = "arrival"): Extract<Operation, { type: "react" }> => ({ id, type: "react", activityId, memberId, emoji, active });

test("all 24 activity reactions validate, round-trip in snapshots, and can be independently removed", () => {
  assert.equal(EMOJIS.length, 24);
  assert.equal(new Set(EMOJIS).size, 24);
  const original = seed();
  let state = original;
  for (const [index, emoji] of EMOJIS.entries()) {
    const operation = reaction(`add-preset-${index}`, emoji, true);
    validateOperation(operation);
    state = parseBoardState(JSON.parse(JSON.stringify(applyOperation(state, operation))));
    assert.equal(state.reactions.filter((item) => item.emoji === emoji).length, 1);
  }
  assert.equal(state.reactions.length, 24);
  assert.equal(state.version, original.version + 24);
  for (const [index, emoji] of EMOJIS.entries()) state = applyOperation(state, reaction(`remove-preset-${index}`, emoji, false));
  assert.equal(state.reactions.length, 0);
  assert.deepEqual(state.activities, original.activities);
  assert.deepEqual(state.responses, original.responses);
  assert.deepEqual(state.profiles, original.profiles);
  assert.equal(original.reactions.length, 0, "operations do not mutate the original snapshot");
});

test("reaction counts represent distinct members; cancellation preserves other emoji, members, activities and attendance", () => {
  let state = applyOperation(seed(), { id: "attend", type: "participate", activityId: "arrival", memberId: "mia", status: "interested" });
  state = applyOperation(state, reaction("mia-fire", "🔥", true));
  state = applyOperation(state, reaction("mia-fire-repeat", "🔥", true));
  state = applyOperation(state, reaction("hoting-fire", "🔥", true, "hoting"));
  state = applyOperation(state, reaction("mia-photo", "📸", true));
  state = applyOperation(state, reaction("mia-other-activity", "🔥", true, "mia", "machines"));
  const members = state.reactions.filter((item) => item.activityId === "arrival" && item.emoji === "🔥");
  assert.equal(members.length, 2);
  assert.deepEqual(new Set(members.map((item) => item.memberId)), new Set(["mia", "hoting"]));
  const before = structuredClone(state);
  state = applyOperation(state, reaction("mia-unfire", "🔥", false));
  assert.deepEqual(state.reactions, before.reactions.filter((item) => !(item.activityId === "arrival" && item.memberId === "mia" && item.emoji === "🔥")));
  assert.deepEqual(state.responses, before.responses);
  assert.deepEqual(state.activities, before.activities);
  assert.deepEqual(state.profiles, before.profiles);
});

test("reaction validation rejects unlisted Unicode variants and invalid snapshot values", () => {
  for (const emoji of ["❤", "🔥🔥", "🦊", "❤️ ", "", null]) {
    const operation = { ...reaction("invalid", "🔥", true), emoji };
    assert.throws(() => validateOperation(operation as Operation), OperationError);
    assert.throws(() => parseBoardState({ ...seed(), reactions: [{ activityId: "arrival", memberId: "mia", emoji }] }), OperationError);
  }
  assert.throws(() => validateOperation({ ...reaction("wrong-active", "🔥", true), active: "true" } as unknown as Operation), OperationError);
  assert.throws(() => validateOperation({ ...reaction("inflated-count", "🔥", true), count: 99 } as Operation), OperationError);
});

test("rapid new-emoji toggles serialize and keep the member captured before a role switch", async () => {
  let remote = seed();
  let releaseFirst!: () => void;
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const calls: Operation[] = [];
  let inFlight = 0;
  let maximumInFlight = 0;
  const transport: BoardTransport = {
    read: async () => remote,
    subscribe: () => () => {},
    async apply(operation) {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      calls.push(structuredClone(operation));
      if (calls.length === 1) await first;
      remote = applyOperation(remote, operation);
      inFlight -= 1;
      return { state: remote };
    },
  };
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const store = new BoardStore(transport, storage, storage);
  store.start();
  try {
    for (let attempt = 0; !store.getSnapshot().ready && attempt < 100; attempt += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(store.getSnapshot().ready, true);
    let selectedMember: MemberId = "mia";
    const mutable = reaction("rapid-on", "🔥", true, selectedMember);
    const on = store.dispatch(mutable);
    const off = store.dispatch(reaction("rapid-off", "🔥", false, selectedMember));
    selectedMember = "hoting";
    const otherMember = store.dispatch(reaction("switched-member-on", "🔥", true, selectedMember));
    mutable.memberId = selectedMember;
    mutable.emoji = "🥐";
    mutable.active = false;
    assert.deepEqual(store.getSnapshot().state.reactions, [{ activityId: "arrival", memberId: "hoting", emoji: "🔥" }]);
    assert.equal(calls.length, 1, "later toggles wait for the first acknowledgement");
    releaseFirst();
    await Promise.all([on, off, otherMember]);
    assert.equal(maximumInFlight, 1);
    assert.deepEqual(calls, [reaction("rapid-on", "🔥", true, "mia"), reaction("rapid-off", "🔥", false, "mia"), reaction("switched-member-on", "🔥", true, "hoting")]);
    assert.deepEqual(remote.reactions, [{ activityId: "arrival", memberId: "hoting", emoji: "🔥" }]);
    assert.deepEqual(store.getSnapshot().authoritativeState, remote);
    assert.equal(store.getSnapshot().pendingCount, 0);
  } finally { releaseFirst(); store.stop(); }
});
