import { Fragment, type CSSProperties, type ReactNode } from "react";
import { activitiesOverlap, choiceKey, isMutuallyExclusiveGroup } from "@/lib/operations";
import type { Activity, BoardState, MemberId } from "@/lib/types";
import "./overlap-group.css";

export interface OverlapGroupProps {
  activities: Activity[];
  state: BoardState;
  member: MemberId | null;
  renderActivity: (activity: Activity, index: number, context: { showTime: boolean; conflicts: string[] }) => ReactNode;
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

function clockLabel(value: number): string {
  const rounded = Math.round(value);
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

/** Activities retain their incoming order; chart and card numbers are one-based. */
export function OverlapGroup({ activities, state, member, renderActivity }: OverlapGroupProps) {
  if (!activities.length) return null;
  if (activities.length === 1) return renderActivity(activities[0], 0, { showTime: true, conflicts: [] });

  const sharedTime = activities.every((activity) => choiceKey(activity) === choiceKey(activities[0]));
  const exclusive = isMutuallyExclusiveGroup(activities);
  const start = Math.min(...activities.map((activity) => minutes(activity.time)));
  const end = Math.max(...activities.map((activity) => minutes(activity.endTime || activity.time)));
  const span = Math.max(end - start, 1);
  const timeLabel = `${clockLabel(start)} — ${clockLabel(end)}`;
  const groupLabel = exclusive ? `${activities.length} 选 1` : "部分重叠";
  const activityIds = new Set(activities.map((activity) => activity.id));
  const going = new Set(state.responses.filter((response) => activityIds.has(response.activityId) && response.memberId === member && response.status === "going").map((response) => response.activityId));
  const compatiblePairs: string[] = [];
  if (!exclusive && activities.length <= 4) {
    activities.forEach((activity, index) => {
      for (let other = index + 1; other < activities.length; other += 1) {
        if (!activitiesOverlap(activity, activities[other])) compatiblePairs.push(`${index + 1} + ${other + 1}`);
      }
    });
  }

  return (
    <div className={`choice-group overlap-group${sharedTime ? "" : " overlap-group--varied"}`} role="group" aria-label={`${timeLabel}，${groupLabel}`}>
      <div className="choice-heading">
        <span>{timeLabel}</span>
        <strong>{groupLabel}</strong>
      </div>
      {!sharedTime && (
        // Card times and conflict text provide the same facts to assistive technology.
        <div className="overlap-timeline" aria-hidden="true">
          <div className="overlap-axis">
            <span>{clockLabel(start)}</span><span>{clockLabel((start + end) / 2)}</span><span>{clockLabel(end)}</span>
          </div>
          <div className="overlap-rows">
            {activities.map((activity, index) => {
              const selected = going.has(activity.id);
              const from = minutes(activity.time);
              const to = minutes(activity.endTime || activity.time);
              const style: CSSProperties = { left: `${(from - start) / span * 100}%`, width: `${Math.max(0, to - from) / span * 100}%` };
              return <div className={`overlap-row${selected ? " overlap-row--going" : ""}`} key={activity.id}>
                <span className="overlap-number">{index + 1}</span>
                <span className="overlap-track"><span className="overlap-bar" style={style} /></span>
              </div>;
            })}
          </div>
          {going.size > 0 && <div className="overlap-legend"><span />你已参加</div>}
        </div>
      )}
      <div className="choice-grid">
        {activities.map((activity, index) => <Fragment key={activity.id}>
          {renderActivity(activity, index, {
            showTime: !sharedTime,
            conflicts: exclusive ? [] : activities.flatMap((other, otherIndex) => otherIndex !== index && activitiesOverlap(activity, other) ? [String(otherIndex + 1)] : []),
          })}
        </Fragment>)}
      </div>
      {!exclusive && <p className="choice-note overlap-compatible">
        {compatiblePairs.length ? `可同选：${compatiblePairs.join("；")}` : "不重叠的活动可同时参加"}
      </p>}
    </div>
  );
}
