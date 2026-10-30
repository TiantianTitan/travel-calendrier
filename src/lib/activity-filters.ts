import type { Activity, BoardState, MemberId, TripDate } from "./types";

export type ActivityFilter = "all" | "mine" | "interested";
export type ActivityScope = TripDate | "all";
type FilterState = Pick<BoardState, "activities" | "responses">;

function selectActivities(state: FilterState, member: MemberId | null, scope: ActivityScope): Record<ActivityFilter, Activity[]> {
  // Canonical snapshots have one response per member/activity. For repeated
  // legacy entries, the last explicit state wins instead of counting both states.
  const responses = new Map(state.responses.filter((response) => response.memberId === member).map((response) => [response.activityId, response.status]));
  const selected: Record<ActivityFilter, Activity[]> = { all: [], mine: [], interested: [] };
  const seen = new Set<string>();
  for (const activity of state.activities) {
    if ((scope !== "all" && activity.date !== scope) || seen.has(activity.id)) continue;
    seen.add(activity.id);
    selected.all.push(activity);
    const status = responses.get(activity.id);
    if (status === "going") selected.mine.push(activity);
    else if (status === "interested") selected.interested.push(activity);
  }
  return selected;
}

/** Scope must match the visible list: the selected date on phones, all dates on desktop. */
export function filterActivities(state: FilterState, member: MemberId | null, filter: ActivityFilter, scope: ActivityScope = "all"): Activity[] {
  return selectActivities(state, member, scope)[filter];
}

export function getActivityFilterCounts(state: FilterState, member: MemberId | null, scope: ActivityScope = "all"): Record<ActivityFilter, number> {
  const selected = selectActivities(state, member, scope);
  return { all: selected.all.length, mine: selected.mine.length, interested: selected.interested.length };
}
