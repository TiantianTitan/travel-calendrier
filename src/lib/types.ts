export const TRIP_ID = "toulouse-2026";
export const DATES = ["2026-10-31", "2026-11-01", "2026-11-02"] as const;
export type TripDate = (typeof DATES)[number];
export const MEMBERS = [
  { id: "hoting", name: "Hoting", color: "#dce7d8" },
  { id: "mia", name: "Mia", color: "#f2d9d5" },
  { id: "james", name: "James", color: "#dce6f2" },
  { id: "ganggang", name: "Ganggang", color: "#f3e6c9" },
  { id: "kada", name: "Kada", color: "#e6def1" },
] as const;
export type MemberId = (typeof MEMBERS)[number]["id"];
export const EMOJIS = ["❤️", "👍", "🎉"] as const;
export type Emoji = (typeof EMOJIS)[number];
export type Category = "travel" | "explore" | "food" | "rest";
export const PARTICIPATION_STATES = ["going", "not-going", "interested", "maybe"] as const;
export type Participation = (typeof PARTICIPATION_STATES)[number];
export interface ActivityFields {
  date: TripDate;
  time: string;
  endTime: string;
  title: string;
  location: string;
  note: string;
  category: Category;
  sortOrder: number;
}
export interface Activity extends ActivityFields { id: string; revision: number }
export type ActivityTimeRange = Pick<ActivityFields, "date" | "time" | "endTime">;
export interface ChoiceGuard {
  /** The target's exact date/start/end snapshot, not a conflict-group identifier. */
  key: string;
  /** Other directly overlapping activities this member currently attends. */
  previousIds: string[];
}
export interface Response { activityId: string; memberId: MemberId; status: Participation }
export interface Reaction { activityId: string; memberId: MemberId; emoji: Emoji }
export interface MemberProfile { name: string; avatar: string }
export type MemberProfiles = Partial<Record<MemberId, MemberProfile>>;
export interface BoardState {
  version: number;
  activities: Activity[];
  responses: Response[];
  reactions: Reaction[];
  /** Missing entries retain the five original member names and initial avatars. */
  profiles?: MemberProfiles;
}
export type Operation = { id: string } & (
  | { type: "create"; activity: Activity }
  | { type: "update"; activityId: string; patch: Partial<ActivityFields>; base: Partial<ActivityFields> }
  | { type: "delete"; activityId: string; expectedRevision: number }
  | { type: "participate"; activityId: string; memberId: MemberId; status: Participation | null; choice?: ChoiceGuard }
  | { type: "react"; activityId: string; memberId: MemberId; emoji: Emoji; active: boolean }
  | { type: "profile"; memberId: MemberId; patch: Partial<MemberProfile>; base: Partial<MemberProfile> }
);
export interface OperationResult { state: BoardState; duplicate?: boolean }
