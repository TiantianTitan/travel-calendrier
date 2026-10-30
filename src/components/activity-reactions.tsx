"use client";

import { Plus } from "lucide-react";
import { useRef } from "react";
import { EMOJIS, type Activity, type Emoji, type MemberId, type Reaction } from "@/lib/types";
import styles from "./activity-reactions.module.css";

interface ActivityReactionsProps {
  activity: Activity;
  reactions: Reaction[];
  member: MemberId | null;
  onReact: (activity: Activity, emoji: Emoji) => void;
  onAdd: (activity: Activity) => void;
}

export function ActivityReactions({ activity, reactions, member, onReact, onAdd }: ActivityReactionsProps) {
  const addButton = useRef<HTMLButtonElement>(null);
  const membersByEmoji = new Map<Emoji, Set<MemberId>>();
  for (const reaction of reactions) {
    if (reaction.activityId !== activity.id) continue;
    const members = membersByEmoji.get(reaction.emoji) ?? new Set<MemberId>();
    members.add(reaction.memberId);
    membersByEmoji.set(reaction.emoji, members);
  }

  return (
    <div className={styles.row} role="group" aria-label={`${activity.title}的表情`}>
      {EMOJIS.map((emoji) => {
        const members = membersByEmoji.get(emoji);
        if (!members?.size) return null;
        const selected = member !== null && members.has(member);
        return (
          <button
            key={emoji}
            type="button"
            className={styles.chip}
            aria-pressed={selected}
            aria-label={`${activity.title}：${selected ? "取消" : "添加"}${emoji}表情，${members.size}人`}
            onClick={(event) => {
              if (selected && members.size === 1 && document.activeElement === event.currentTarget) {
                addButton.current?.focus({ preventScroll: true });
              }
              onReact(activity, emoji);
            }}
          >
            <span className={styles.emoji} aria-hidden="true">{emoji}</span>
            <span className={styles.count} aria-hidden="true">{members.size}</span>
          </button>
        );
      })}
      <button ref={addButton} type="button" className={styles.add} aria-label={`${activity.title}：添加表情`} onClick={() => onAdd(activity)}>
        <Plus size={17} aria-hidden="true" />
      </button>
    </div>
  );
}
