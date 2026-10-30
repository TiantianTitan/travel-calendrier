import { operationFingerprint, parseBoardState, validateOperation } from "./operations";
import { TRIP_ID, type BoardState, type Operation } from "./types";

export const LEGACY_MIGRATION_KEY = `travel-calendar:${TRIP_ID}:local-to-cloud:v1`;
export const isMigrationOperationId = (id: string): boolean => /^legacy-[a-f0-9]{64}$/.test(id);
export interface MigrationStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
type MigrationOperation = Extract<Operation, { type: "create" | "participate" | "react" }>;
export interface MigrationItem {
  operation: MigrationOperation;
  activityId: string;
  attempted: boolean;
  outcome: "pending" | "done" | "skipped";
}
export interface MigrationJournal { version: 1; items: MigrationItem[] }

/** Only the local commit ledger proves an activity was added, rather than seeded. */
export async function planLegacyMigration(raw: string): Promise<MigrationJournal> {
  const record = JSON.parse(raw) as { state: unknown; applied?: unknown };
  const state = parseBoardState(record.state);
  const created = new Map<string, string>();
  if (record.applied && typeof record.applied === "object" && !Array.isArray(record.applied)) {
    for (const [id, fingerprint] of Object.entries(record.applied)) {
      try {
        if (typeof fingerprint !== "string") continue;
        const operation: Operation = JSON.parse(fingerprint);
        validateOperation(operation);
        if (operation.id === id && operation.type === "create" && operationFingerprint(operation) === fingerprint) created.set(operation.activity.id, id);
      } catch { /* A legacy/unreadable ledger entry is not evidence of a user-created activity. */ }
    }
  }
  const items: MigrationItem[] = [];
  for (const activity of state.activities) {
    const sourceId = created.get(activity.id);
    if (!sourceId) continue;
    const append = async (kind: string, operation: Omit<Extract<Operation, { type: "create" }>, "id"> | Omit<Extract<Operation, { type: "participate" }>, "id"> | Omit<Extract<Operation, { type: "react" }>, "id">) => {
      // Two tabs derive identical IDs without needing a racy random-ID election.
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([TRIP_ID, sourceId, activity.id, kind])));
      const id = `legacy-${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      const payload = { ...operation, id } as MigrationOperation;
      validateOperation(payload);
      items.push({ operation: payload, activityId: activity.id, attempted: false, outcome: "pending" });
    };
    await append("create", { type: "create", activity: { ...activity, revision: 1 } });
    for (const response of state.responses.filter((item) => item.activityId === activity.id)) {
      await append(`response:${response.memberId}`, {
        type: "participate", ...response,
        ...(response.status === "going" ? { choice: { key: `${activity.date}|${activity.time}|${activity.endTime}`, previousIds: [] } } : {}),
      });
    }
    for (const reaction of state.reactions.filter((item) => item.activityId === activity.id)) {
      await append(`reaction:${reaction.memberId}:${reaction.emoji}`, { type: "react", ...reaction, active: true });
    }
  }
  // Recover every activity first; one conflicting intention must not hide later activities.
  return { version: 1, items: [...items.filter((item) => item.operation.type === "create"), ...items.filter((item) => item.operation.type !== "create")] };
}

export function readMigrationJournal(storage: MigrationStorage): MigrationJournal | null {
  const raw = storage.getItem(LEGACY_MIGRATION_KEY);
  if (!raw) return null;
  const journal = JSON.parse(raw) as MigrationJournal;
  if (journal.version !== 1 || !Array.isArray(journal.items)) throw new Error("Invalid migration journal");
  const ids = new Set<string>();
  const created = new Set<string>();
  for (const item of journal.items) {
    validateOperation(item.operation);
    if (!["create", "participate", "react"].includes(item.operation.type) || typeof item.attempted !== "boolean" || !["pending", "done", "skipped"].includes(item.outcome) || ids.has(item.operation.id)) throw new Error("Invalid migration item");
    const id = item.operation.type === "create" ? item.operation.activity.id : item.operation.activityId;
    if (id !== item.activityId || (item.operation.type !== "create" && !created.has(id))) throw new Error("Invalid migration dependency");
    if (item.operation.type === "create") created.add(id);
    ids.add(item.operation.id);
  }
  return journal;
}

/** Original local data is never touched; payloads cannot change after their first durable plan. */
export function saveMigrationJournal(storage: MigrationStorage, journal: MigrationJournal): MigrationJournal {
  const existing = readMigrationJournal(storage);
  let merged = journal;
  if (existing) {
    const incoming = new Map(journal.items.map((item) => [item.operation.id, item]));
    if (existing.items.length !== incoming.size) throw new Error("Migration plan changed");
    merged = { version: 1, items: existing.items.map((old) => {
      const next = incoming.get(old.operation.id);
      if (!next || operationFingerprint(old.operation) !== operationFingerprint(next.operation)) throw new Error("Migration payload changed");
      return { ...old, attempted: old.attempted || next.attempted, outcome: old.outcome !== "pending" ? old.outcome : next.outcome };
    }) };
  }
  storage.setItem(LEGACY_MIGRATION_KEY, JSON.stringify(merged));
  return merged;
}

/** Never import profiles, overwrite a visible response, or revive a removed target. */
export function skipMigrationFollowup(state: BoardState, item: MigrationItem): boolean {
  const operation = item.operation;
  if (operation.type === "create") return false;
  if (!state.activities.some((activity) => activity.id === item.activityId)) return true;
  if (operation.type === "participate") return state.responses.some((response) => response.activityId === item.activityId && response.memberId === operation.memberId);
  return state.reactions.some((reaction) => reaction.activityId === item.activityId && reaction.memberId === operation.memberId && reaction.emoji === operation.emoji);
}
