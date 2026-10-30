import { DATES, EMOJIS, MEMBERS, PARTICIPATION_STATES, type Activity, type ActivityFields, type ActivityTimeRange, type BoardState, type MemberProfile, type Operation, type Participation } from "./types";
import { getMemberProfile, isValidAvatar, isValidProfileName, MAX_PROFILE_OPERATION_BYTES } from "./member-profiles";

export type OperationErrorCode = "CONFLICT" | "NOT_FOUND" | "VALIDATION";
export class OperationError extends Error {
  constructor(public readonly code: OperationErrorCode, message: string) {
    super(message);
    this.name = "OperationError";
  }
}

const FIELDS = ["date", "time", "endTime", "title", "location", "note", "category", "sortOrder"] as const;
const FIELD_SET = new Set<string>(FIELDS);
const CATEGORIES = ["travel", "explore", "food", "rest"];
const IDS = new Set<string>(MEMBERS.map((member) => member.id));
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** An exact time snapshot for confirmation guards; overlap defines conflicts. */
export function choiceKey(activity: ActivityTimeRange): string {
  return `${activity.date}|${activity.time}|${activity.endTime}`;
}

/** Unknown or zero-length durations are not guessed; touching endpoints are free. */
export function activitiesOverlap(a: ActivityTimeRange, b: ActivityTimeRange): boolean {
  return a.date === b.date &&
    [a.time, a.endTime, b.time, b.endTime].every((time) => TIME_PATTERN.test(time)) &&
    a.endTime > a.time && b.endTime > b.time &&
    a.time < b.endTime && b.time < a.endTime;
}

/** Connected groups for display only. Attendance conflicts are always direct. */
export function groupOverlaps<T extends ActivityTimeRange>(activities: readonly T[]): T[][] {
  const parents = activities.map((_, index) => index);
  const root = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  for (let first = 0; first < activities.length; first += 1) {
    for (let second = first + 1; second < activities.length; second += 1) {
      if (activitiesOverlap(activities[first], activities[second])) parents[root(second)] = root(first);
    }
  }
  const groups = new Map<number, T[]>();
  activities.forEach((activity, index) => {
    const key = root(index);
    const group = groups.get(key);
    if (group) group.push(activity);
    else groups.set(key, [activity]);
  });
  return [...groups.values()];
}

/** Only pairwise-overlapping groups can truthfully be labelled "N choose one". */
export function isMutuallyExclusiveGroup(activities: readonly ActivityTimeRange[]): boolean {
  return activities.length > 1 && activities.every((activity, index) =>
    activities.slice(index + 1).every((other) => activitiesOverlap(activity, other)));
}

function overlappingActivityIds(state: BoardState, activity: Activity): Set<string> {
  return new Set(state.activities.filter((candidate) => candidate.id !== activity.id && activitiesOverlap(candidate, activity)).map((candidate) => candidate.id));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new OperationError("VALIDATION", message);
}

function validateId(value: unknown) {
  assert(typeof value === "string" && ID_PATTERN.test(value), "活动标识无效，请重新打开后再试。");
}

function validateField(key: string, value: unknown) {
  assert(FIELD_SET.has(key), "包含不支持的活动字段。");
  switch (key) {
    case "date": assert(DATES.includes(value as (typeof DATES)[number]), "请选择这次旅行的日期。"); break;
    case "time": assert(typeof value === "string" && TIME_PATTERN.test(value), "请填写有效时间。"); break;
    case "endTime": assert(value === "" || (typeof value === "string" && TIME_PATTERN.test(value)), "请填写有效时间。"); break;
    case "title": assert(typeof value === "string" && value.trim().length > 0 && value.length <= 120, "活动名称需要 1–120 个字。"); break;
    case "location": assert(typeof value === "string" && value.length <= 160, "地点最多填写 160 个字。"); break;
    case "note": assert(typeof value === "string" && value.length <= 2000, "备注最多填写 2000 个字。"); break;
    case "category": assert(CATEGORIES.includes(value as string), "请选择有效的活动类型。"); break;
    case "sortOrder": assert(typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e9, "活动排序无效。"); break;
  }
}

function validateProfileField(key: string, value: unknown) {
  assert(key === "name" || key === "avatar", "包含不支持的成员资料字段。");
  if (key === "name") assert(isValidProfileName(value), "昵称需为 1–24 个字符，首尾不能留空，也不能含控制字符。");
  else assert(isValidAvatar(value), "请选择有效的头像表情。");
}

export function validateActivity(activity: unknown): asserts activity is Activity {
  assert(isObject(activity), "活动内容无效。");
  assert(Object.keys(activity).every((key) => FIELD_SET.has(key) || key === "id" || key === "revision"), "活动包含未知字段。");
  validateId(activity.id);
  FIELDS.forEach((key) => validateField(key, activity[key]));
  assert(activity.endTime === "" || (activity.endTime as string) >= (activity.time as string), "结束时间不能早于开始时间。");
  assert(Number.isInteger(activity.revision) && Number(activity.revision) >= 1 && Number(activity.revision) <= 2147483647, "活动版本无效。");
}

export function validateOperation(operation: unknown): asserts operation is Operation {
  assert(isObject(operation), "操作内容无效。");
  assert(new TextEncoder().encode(JSON.stringify(operation)).byteLength <= (operation.type === "profile" ? MAX_PROFILE_OPERATION_BYTES : 16384), "一次修改的内容太多，请缩短备注或头像后重试。");
  validateId(operation.id);
  const keys: Record<string, string[]> = {
    create: ["id", "type", "activity"],
    update: ["id", "type", "activityId", "patch", "base"],
    delete: ["id", "type", "activityId", "expectedRevision"],
    participate: ["id", "type", "activityId", "memberId", "status"],
    react: ["id", "type", "activityId", "memberId", "emoji", "active"],
    profile: ["id", "type", "memberId", "patch", "base"],
  };
  assert(typeof operation.type === "string" && own(keys, operation.type), "不支持这个操作。");
  const allowed = keys[operation.type];
  const optionalChoice = operation.type === "participate" && own(operation, "choice");
  assert(Object.keys(operation).length === allowed.length + Number(optionalChoice) && allowed.every((key) => own(operation, key)), "操作字段不完整。");
  if (operation.type === "create") {
    validateActivity(operation.activity);
    assert(operation.activity.revision === 1, "新增活动的版本无效。");
    return;
  }
  if (operation.type === "profile") {
    assert(typeof operation.memberId === "string" && IDS.has(operation.memberId), "请选择有效成员。");
    assert(isObject(operation.patch) && isObject(operation.base), "成员资料无效。");
    const patch = operation.patch;
    const base = operation.base;
    const fields = Object.keys(patch);
    assert(fields.length > 0 && fields.length === Object.keys(base).length, "请只保存已经修改的资料字段。");
    fields.forEach((field) => {
      assert(own(base, field), "缺少修改前的资料，请重新打开后再试。");
      validateProfileField(field, patch[field]);
      validateProfileField(field, base[field]);
    });
    return;
  }
  validateId(operation.activityId);
  if (operation.type === "update") {
    assert(isObject(operation.patch) && isObject(operation.base), "修改内容无效。");
    const patch = operation.patch;
    const base = operation.base;
    const fields = Object.keys(patch);
    assert(fields.length > 0 && fields.length === Object.keys(base).length, "请只保存已经修改的字段。");
    fields.forEach((key) => {
      assert(own(base, key), "缺少修改前的内容，请重新打开活动。");
      validateField(key, patch[key]);
      validateField(key, base[key]);
    });
  } else if (operation.type === "delete") {
    assert(Number.isInteger(operation.expectedRevision) && Number(operation.expectedRevision) >= 1 && Number(operation.expectedRevision) <= 2147483647, "活动版本无效。");
  } else {
    assert(typeof operation.memberId === "string" && IDS.has(operation.memberId), "请先选择你的名字。");
    if (operation.type === "participate") {
      assert(operation.status === null || PARTICIPATION_STATES.includes(operation.status as Participation), "请选择有效的参加状态。");
      if (optionalChoice) {
        assert(operation.status === "going" && isObject(operation.choice), "只有参加操作可以包含候选确认。");
        const choice = operation.choice;
        assert(Object.keys(choice).length === 2 && own(choice, "key") && own(choice, "previousIds"), "候选确认内容无效。");
        assert(typeof choice.key === "string" && choice.key.length <= 80, "候选时段无效。");
        const parts = choice.key.split("|");
        assert(parts.length === 3, "候选时段无效。");
        validateField("date", parts[0]); validateField("time", parts[1]); validateField("endTime", parts[2]);
        assert(parts[2] === "" || parts[2] >= parts[1], "候选时段无效。");
        assert(Array.isArray(choice.previousIds) && choice.previousIds.length <= 500, "原参加候选无效。");
        choice.previousIds.forEach(validateId);
        assert(new Set(choice.previousIds).size === choice.previousIds.length, "原参加候选不能重复。");
      }
    } else {
      assert(EMOJIS.includes(operation.emoji as (typeof EMOJIS)[number]), "这个表情暂不支持。");
      assert(typeof operation.active === "boolean", "表情状态无效。");
    }
  }
}

/** Domain rules shared by local persistence and the optimistic cloud projection. */
export function applyOperation(state: BoardState, operation: Operation): BoardState {
  validateOperation(operation);
  const next: BoardState = { ...state, version: state.version + 1 };
  if (operation.type === "profile") {
    const current = getMemberProfile(state, operation.memberId);
    for (const key of Object.keys(operation.patch) as (keyof MemberProfile)[]) {
      if (current[key] !== operation.base[key] && current[key] !== operation.patch[key]) {
        throw new OperationError("CONFLICT", "成员资料刚有更新，请查看最新内容后重新保存。");
      }
    }
    return { ...next, profiles: { ...state.profiles, [operation.memberId]: { ...current, ...operation.patch } } };
  }
  if (operation.type === "create") {
    if (state.activities.length >= 500) throw new OperationError("VALIDATION", "活动数量已达上限，请先整理一些活动。");
    if (state.activities.some((activity) => activity.id === operation.activity.id)) {
      throw new OperationError("CONFLICT", "这个活动已经存在，请重新添加。");
    }
    return { ...next, activities: [...state.activities, { ...operation.activity }] };
  }
  const activity = state.activities.find((item) => item.id === operation.activityId);
  if (!activity) throw new OperationError("NOT_FOUND", "这个活动已被删除。你的修改没有覆盖其他内容。");
  if (operation.type === "update") {
    const fields = Object.keys(operation.patch) as (keyof ActivityFields)[];
    for (const key of fields) {
      if (activity[key] !== operation.base[key] && activity[key] !== operation.patch[key]) {
        throw new OperationError("CONFLICT", "有人刚修改了相同内容。请查看最新活动后重新保存；你的草稿仍在。");
      }
    }
    const updated = { ...activity, ...operation.patch, revision: activity.revision + 1 };
    validateActivity(updated);
    if (choiceKey(updated) !== choiceKey(activity)) {
      const goingMembers = new Set(state.responses.filter((response) => response.activityId === activity.id && response.status === "going").map((response) => response.memberId));
      const destinationIds = overlappingActivityIds(state, updated);
      if (state.responses.some((response) => response.activityId !== activity.id && destinationIds.has(response.activityId) && response.status === "going" && goingMembers.has(response.memberId))) {
        throw new OperationError("CONFLICT", "这次移动会让已参加的安排重合，请先调整接龙。");
      }
    }
    return { ...next, activities: state.activities.map((item) => item.id === activity.id ? updated : item) };
  }
  if (operation.type === "delete") {
    if (activity.revision !== operation.expectedRevision) {
      throw new OperationError("CONFLICT", "这个活动刚有更新，请查看最新内容后再删除。");
    }
    return {
      ...next,
      activities: state.activities.filter((item) => item.id !== activity.id),
      responses: state.responses.filter((item) => item.activityId !== activity.id),
      reactions: state.reactions.filter((item) => item.activityId !== activity.id),
    };
  }
  if (operation.type === "participate") {
    const alternatives = operation.status === "going" ? overlappingActivityIds(state, activity) : null;
    if (operation.choice) {
      const previousIds = state.responses.filter((response) => response.activityId !== activity.id && alternatives?.has(response.activityId) && response.memberId === operation.memberId && response.status === "going").map((response) => response.activityId).sort();
      const confirmedIds = [...operation.choice.previousIds].sort();
      if (operation.choice.key !== choiceKey(activity) || previousIds.length !== confirmedIds.length || previousIds.some((id, index) => id !== confirmedIds[index])) {
        throw new OperationError("CONFLICT", "候选安排刚有变化，请查看后重新确认。");
      }
    }
    const responses = state.responses.filter((item) => {
      if (item.memberId !== operation.memberId) return true;
      if (item.activityId === activity.id) return false;
      // Clear only directly overlapping attendance, never the whole connected group.
      return !(alternatives?.has(item.activityId) && item.status === "going");
    });
    if (operation.status !== null) responses.push({ activityId: activity.id, memberId: operation.memberId, status: operation.status });
    return { ...next, responses };
  }
  const reactions = state.reactions.filter((item) => item.activityId !== activity.id || item.memberId !== operation.memberId || item.emoji !== operation.emoji);
  if (operation.active) reactions.push({ activityId: activity.id, memberId: operation.memberId, emoji: operation.emoji });
  return { ...next, reactions };
}

/** Reapplying an already acknowledged effect must not double the optimistic revision. */
export function hasOperationEffect(state: BoardState, operation: Operation): boolean {
  if (operation.type === "profile") {
    const current = getMemberProfile(state, operation.memberId);
    return (Object.keys(operation.patch) as (keyof MemberProfile)[]).every((key) => current[key] === operation.patch[key]);
  }
  const id = operation.type === "create" ? operation.activity.id : operation.activityId;
  const activity = state.activities.find((item) => item.id === id);
  if (operation.type === "delete") return !activity;
  if (operation.type === "create") return Boolean(activity);
  if (!activity) return false;
  if (operation.type === "update") return (Object.keys(operation.patch) as (keyof ActivityFields)[]).every((key) => activity[key] === operation.patch[key]);
  if (operation.type === "participate") {
    if ((state.responses.find((item) => item.activityId === id && item.memberId === operation.memberId)?.status ?? null) !== operation.status) return false;
    if (operation.status !== "going") return true;
    const alternatives = overlappingActivityIds(state, activity);
    return !state.responses.some((item) => item.activityId !== id && alternatives.has(item.activityId) && item.memberId === operation.memberId && item.status === "going");
  }
  return state.reactions.some((item) => item.activityId === id && item.memberId === operation.memberId && item.emoji === operation.emoji) === operation.active;
}

/** A stale snapshot can never replace a newer authoritative board. */
export function mergeSnapshot(current: BoardState, incoming: BoardState): BoardState {
  return incoming.version > current.version ? incoming : current;
}

export function operationFingerprint(operation: Operation): string {
  const canonical = (value: unknown): unknown => Array.isArray(value)
    ? value.map(canonical)
    : isObject(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
      : value;
  return JSON.stringify(canonical(operation));
}

export function parseBoardState(value: unknown): BoardState {
  assert(isObject(value), "读取行程失败，请重试。");
  assert(Number.isSafeInteger(value.version) && Number(value.version) >= 0, "行程版本无效，请重试。");
  assert(Array.isArray(value.activities) && Array.isArray(value.responses) && Array.isArray(value.reactions), "行程数据不完整，请重试。");
  if (own(value, "profiles")) {
    assert(isObject(value.profiles), "成员资料无效，请重试。");
    Object.entries(value.profiles).forEach(([memberId, profile]) => {
      assert(IDS.has(memberId) && isObject(profile) && Object.keys(profile).length === 2 && own(profile, "name") && own(profile, "avatar"), "成员资料无效，请重试。");
      validateProfileField("name", profile.name);
      validateProfileField("avatar", profile.avatar);
    });
  }
  const activityIds = new Set<string>();
  value.activities.forEach((activity) => {
    validateActivity(activity);
    assert(!activityIds.has(activity.id), "活动数据重复，请重试。");
    activityIds.add(activity.id);
  });
  const responseKeys = new Set<string>();
  value.responses.forEach((response) => {
    assert(isObject(response) && activityIds.has(response.activityId as string) && IDS.has(response.memberId as string) && PARTICIPATION_STATES.includes(response.status as Participation), "参与数据无效，请重试。");
    const key = `${response.activityId}:${response.memberId}`;
    assert(!responseKeys.has(key), "参与数据重复，请重试。");
    responseKeys.add(key);
  });
  const reactionKeys = new Set<string>();
  value.reactions.forEach((reaction) => {
    assert(isObject(reaction) && activityIds.has(reaction.activityId as string) && IDS.has(reaction.memberId as string) && EMOJIS.includes(reaction.emoji as (typeof EMOJIS)[number]), "表情数据无效，请重试。");
    const key = `${reaction.activityId}:${reaction.memberId}:${reaction.emoji}`;
    assert(!reactionKeys.has(key), "表情数据重复，请重试。");
    reactionKeys.add(key);
  });
  return value as unknown as BoardState;
}
