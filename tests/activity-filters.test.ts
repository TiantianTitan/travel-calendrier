import assert from "node:assert/strict";
import { test } from "node:test";
import { filterActivities, getActivityFilterCounts, type ActivityFilter, type ActivityScope } from "../src/lib/activity-filters";
import { DATES, type Activity, type BoardState, type MemberId, type Response, type TripDate } from "../src/lib/types";

const activity = (id: string, date: TripDate): Activity => ({ id, date, time: "10:00", endTime: "11:00", title: id, location: "", note: "", category: "explore", sortOrder: 1, revision: 1 });
const response = (activityId: string, status: Response["status"], memberId: MemberId = "mia"): Response => ({ activityId, memberId, status });
const fixture = (): BoardState => ({
  version: 1,
  activities: [activity("saturday-a", DATES[0]), activity("saturday-b", DATES[0]), activity("sunday-a", DATES[1]), activity("sunday-b", DATES[1]), activity("monday-a", DATES[2]), activity("monday-b", DATES[2])],
  responses: [response("saturday-a", "going"), response("saturday-b", "interested"), response("sunday-a", "interested"), response("sunday-b", "maybe"), response("monday-a", "going"), response("monday-b", "not-going"), response("sunday-b", "going", "hoting"), response("monday-b", "interested", "hoting")],
  reactions: [],
});

test("phone counts include only the selected date, while desktop counts include all three dates", () => {
  const state = fixture();
  assert.deepEqual(getActivityFilterCounts(state, "mia", DATES[0]), { all: 2, mine: 1, interested: 1 });
  assert.deepEqual(getActivityFilterCounts(state, "mia", DATES[1]), { all: 2, mine: 0, interested: 1 });
  assert.deepEqual(getActivityFilterCounts(state, "mia", DATES[2]), { all: 2, mine: 1, interested: 0 });
  assert.deepEqual(getActivityFilterCounts(state, "mia", "all"), { all: 6, mine: 2, interested: 2 });
  assert.deepEqual(filterActivities(state, "mia", "mine", DATES[0]).map((item) => item.id), ["saturday-a"]);
  assert.deepEqual(filterActivities(state, "mia", "mine").map((item) => item.id), ["saturday-a", "monday-a"]);
});

test("each displayed count equals its selectable list across dates, filters and member switches", () => {
  const state = fixture();
  const scopes: ActivityScope[] = [...DATES, "all"];
  const filters: ActivityFilter[] = ["all", "mine", "interested"];
  for (const member of ["mia", "hoting", "kada", null] as const) {
    for (const scope of scopes) {
      const counts = getActivityFilterCounts(state, member, scope);
      for (const filter of filters) assert.equal(counts[filter], filterActivities(state, member, filter, scope).length);
    }
  }
  assert.deepEqual(getActivityFilterCounts(state, "hoting"), { all: 6, mine: 1, interested: 1 });
  assert.deepEqual(getActivityFilterCounts(state, null), { all: 6, mine: 0, interested: 0 });
  assert.deepEqual(getActivityFilterCounts(state, "kada", DATES[0]), { all: 2, mine: 0, interested: 0 });
});

test("duplicate responses and removed activity IDs cannot inflate any filter count", () => {
  const state = fixture();
  state.responses.push(response("saturday-a", "going"), response("saturday-b", "interested"), response("removed", "going"), response("removed-interest", "interested"));
  assert.deepEqual(getActivityFilterCounts(state, "mia"), { all: 6, mine: 2, interested: 2 });
  state.activities = state.activities.filter((item) => item.id !== "saturday-a");
  assert.deepEqual(getActivityFilterCounts(state, "mia", DATES[0]), { all: 1, mine: 0, interested: 1 });
  assert.deepEqual(getActivityFilterCounts(state, "mia"), { all: 5, mine: 1, interested: 2 });
});

test("going, interested, maybe, not-going and reactions do not leak into another filter", () => {
  const state = fixture();
  state.reactions.push({ activityId: "sunday-b", memberId: "mia", emoji: "❤️" });
  assert.deepEqual(filterActivities(state, "mia", "interested").map((item) => item.id), ["saturday-b", "sunday-a"]);
  assert.deepEqual(filterActivities(state, "mia", "mine").map((item) => item.id), ["saturday-a", "monday-a"]);
  // Defensive legacy handling: contradictory repeated entries still represent one state.
  state.responses.push(response("saturday-a", "interested"));
  assert.deepEqual(getActivityFilterCounts(state, "mia", DATES[0]), { all: 2, mine: 0, interested: 2 });
  state.responses.push(response("saturday-a", "not-going"));
  assert.deepEqual(getActivityFilterCounts(state, "mia", DATES[0]), { all: 2, mine: 0, interested: 1 });
});

test("selection preserves input order and never mutates the board", () => {
  const state = fixture();
  state.activities.reverse();
  const before = structuredClone(state);
  const selected = filterActivities(state, "mia", "mine");
  assert.deepEqual(selected.map((item) => item.id), ["monday-a", "saturday-a"]);
  assert.equal(selected[0], state.activities[1]);
  selected.reverse();
  assert.deepEqual(state, before);
});
