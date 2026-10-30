"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Clock } from "lucide-react";
import { DATES, type Activity, type ActivityFields, type Category, type TripDate } from "@/lib/types";
import { findPlaceByLocation } from "@/lib/places";
import { Sheet, SheetClose } from "@/components/sheet";
import { googleMapsUrl } from "@/lib/maps";
import styles from "./activity-editor.module.css";

interface ActivityEditorProps {
  activity?: Activity;
  latestActivity?: Activity | null;
  defaultDate: TripDate;
  defaultTime?: string;
  initialFields?: Partial<ActivityFields>;
  draftKey?: string;
  placeInfo?: { hours: string; hoursUrl: string; hoursByDate?: Partial<Record<TripDate, string>> };
  memberName?: string;
  onSave: (fields: ActivityFields, join: boolean, base: ActivityFields | undefined) => Promise<void>;
  onClose: () => void;
}

interface Draft {
  fields: ActivityFields;
  base: ActivityFields | undefined;
  join: boolean;
}

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "explore", label: "游览" },
  { value: "food", label: "吃饭" },
  { value: "travel", label: "出行" },
  { value: "rest", label: "休息" },
];
const DATE_LABELS = ["10 月 31 日 · 周六", "11 月 1 日 · 周日", "11 月 2 日 · 周一"];

function buildInitialFields(activity: Activity | undefined, defaultDate: TripDate, defaultTime?: string, prefill?: Partial<ActivityFields>): ActivityFields {
  return {
    date: activity?.date ?? defaultDate,
    time: activity?.time ?? prefill?.time ?? defaultTime ?? "10:00",
    endTime: activity?.endTime ?? prefill?.endTime ?? "",
    title: activity?.title ?? prefill?.title ?? "",
    location: activity?.location ?? prefill?.location ?? "",
    note: activity?.note ?? prefill?.note ?? "",
    category: activity?.category ?? prefill?.category ?? "explore",
    sortOrder: activity?.sortOrder ?? 0,
  };
}

function draftStorageKey(activity: Activity | undefined, date: TripDate, key?: string, prefill?: Partial<ActivityFields>): string {
  if (activity) return `travel-calendar:activity-draft:${activity.id}`;
  // A stable attraction ID is preferred. Content-based isolation also protects
  // callers that supply a prefill without an explicit draft key.
  const source = key || (prefill ? `prefill:${JSON.stringify([
    prefill.title ?? "", prefill.location ?? "", prefill.note ?? "",
    prefill.time ?? "", prefill.endTime ?? "", prefill.category ?? "",
  ])}` : "");
  return `travel-calendar:activity-draft:new:${date}${source ? `:${source}` : ""}`;
}

function storedFields(value: unknown): value is ActivityFields {
  if (!value || typeof value !== "object") return false;
  const fields = value as Partial<ActivityFields>;
  return DATES.includes(fields.date as TripDate) &&
    CATEGORIES.some(({ value: category }) => category === fields.category) &&
    typeof fields.title === "string" && fields.title.length <= 120 &&
    typeof fields.location === "string" && fields.location.length <= 160 &&
    typeof fields.note === "string" && fields.note.length <= 2000 &&
    typeof fields.time === "string" && /^(?:(?:[01]\d|2[0-3]):[0-5]\d)?$/.test(fields.time) &&
    typeof fields.endTime === "string" && /^(?:(?:[01]\d|2[0-3]):[0-5]\d)?$/.test(fields.endTime) &&
    typeof fields.sortOrder === "number" && Number.isFinite(fields.sortOrder);
}

const EDITABLE_FIELDS = ["date", "time", "endTime", "title", "location", "note", "category"] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];
const FIELD_LABELS: Record<EditableField, string> = {
  date: "日期", time: "开始", endTime: "结束", title: "名称",
  location: "地点", note: "备注", category: "分类",
};

function fieldValue(field: EditableField, value: string): string {
  if (!value) return "未填写";
  if (field === "date") return DATE_LABELS[DATES.indexOf(value as TripDate)] ?? value;
  if (field === "category") return CATEGORIES.find((category) => category.value === value)?.label ?? value;
  return value;
}

function conflictFields(draft: Draft, latest: Activity | null | undefined): EditableField[] {
  if (!draft.base || !latest) return [];
  return EDITABLE_FIELDS.filter((field) => draft.fields[field] !== draft.base![field] &&
    latest[field] !== draft.base![field] && latest[field] !== draft.fields[field]);
}

function reconcileUntouchedFields(draft: Draft, latest: Activity): Draft {
  if (!draft.base) return draft;
  const fields = { ...draft.fields };
  const base = { ...draft.base };
  let changed = false;
  for (const field of [...EDITABLE_FIELDS, "sortOrder"] as const) {
    // Keep local edits in place. Updates to untouched fields, including a remote
    // move, become the new baseline rather than accidental edits on submission.
    if (fields[field] === base[field] || fields[field] === latest[field]) {
      if (fields[field] !== latest[field] || base[field] !== latest[field]) changed = true;
      Object.assign(fields, { [field]: latest[field] });
      Object.assign(base, { [field]: latest[field] });
    }
  }
  return changed ? { ...draft, fields, base } : draft;
}

function readDraft(raw: string | null, fallback: Draft): Draft {
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("fields" in parsed)) return fallback;
    const fields = parsed.fields;
    if (!storedFields(fields)) return fallback;
    const join = "join" in parsed && parsed.join === true;
    if (!fallback.base) return { fields, base: undefined, join };

    // Only a draft with its original baseline can distinguish a local change
    // from a stale copy of somebody else's fields. Ignore older edit formats.
    const savedBase = "base" in parsed ? parsed.base : undefined;
    if (!storedFields(savedBase)) return fallback;

    const mergedFields = { ...fallback.fields };
    const mergedBase = { ...fallback.base };
    for (const field of EDITABLE_FIELDS) {
      if (fields[field] !== savedBase[field]) {
        Object.assign(mergedFields, { [field]: fields[field] });
        Object.assign(mergedBase, { [field]: savedBase[field] });
      }
    }
    return {
      fields: mergedFields,
      base: mergedBase,
      join,
    };
  } catch {
    return fallback;
  }
}

export function ActivityEditor({ activity, latestActivity, defaultDate, defaultTime, initialFields: prefill, draftKey, memberName, onSave, onClose }: ActivityEditorProps) {
  const id = useId();
  const [storageKey] = useState(() => draftStorageKey(activity, defaultDate, draftKey, prefill));
  const [session] = useState(() => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  const [draft, setDraft] = useState<Draft>(() => {
    const fields = buildInitialFields(activity, defaultDate, defaultTime, prefill);
    return { fields, base: activity ? { ...fields } : undefined, join: false };
  });
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const initialDraft = useRef(draft);
  const conflictPanel = useRef<HTMLElement>(null);
  const removed = !!activity && latestActivity === null;
  const conflicts = conflictFields(draft, latestActivity);
  const matchedPlace = findPlaceByLocation(draft.fields.location);
  const mapUrl = draft.fields.location.trim()
    ? googleMapsUrl(draft.fields.location)
    : undefined;

  useEffect(() => {
    mounted.current = true;
    try {
      setDraft(readDraft(localStorage.getItem(storageKey), initialDraft.current));
    } catch {
      // Private browsing can make storage unavailable; the form remains usable.
    }
    setReady(true);
    return () => { mounted.current = false; };
  }, [storageKey]);

  useEffect(() => {
    if (!ready || !latestActivity) return;
    setDraft((current) => reconcileUntouchedFields(current, latestActivity));
  }, [latestActivity, ready]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: 2, session, ...draft }));
    } catch {
      // A storage quota failure must not prevent saving to the shared itinerary.
    }
  }, [draft, storageKey, ready, session]);

  function change<K extends keyof ActivityFields>(field: K, value: ActivityFields[K]) {
    setDraft((current) => ({ ...current, fields: { ...current.fields, [field]: value } }));
    setError(null);
  }

  function resolveConflicts(keepMine: boolean) {
    if (!latestActivity) return;
    setDraft((current) => {
      if (!current.base) return current;
      const fields = { ...current.fields };
      const base = { ...current.base };
      for (const field of conflictFields(current, latestActivity)) {
        if (!keepMine) Object.assign(fields, { [field]: latestActivity[field] });
        Object.assign(base, { [field]: latestActivity[field] });
      }
      return { ...current, fields, base };
    });
    setError(null);
  }

  function viewConflicts() {
    const panel = conflictPanel.current;
    if (!panel) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
    panel.focus({ preventScroll: true });
    const sheet = panel.closest<HTMLElement>("[data-travel-sheet]");
    if (!sheet) { panel.scrollIntoView({ block: "start", behavior }); return; }
    const bounds = sheet.getBoundingClientRect();
    const chrome = window.matchMedia("(max-width: 799px)").matches ? sheet.querySelector<HTMLElement>(".sheet-chrome") : null;
    const visibleTop = (chrome?.getBoundingClientRect().bottom ?? bounds.top + sheet.clientTop) + 12;
    sheet.scrollTo({ top: Math.max(0, sheet.scrollTop + panel.getBoundingClientRect().top - visibleTop), behavior });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !ready) return;
    if (conflicts.length) {
      setError("请选择要保留的内容。");
      return;
    }
    const fields: ActivityFields = {
      ...draft.fields,
      title: draft.fields.title.trim(),
      location: draft.fields.location.trim(),
      note: draft.fields.note.trim(),
    };
    if (!fields.title) {
      setError("请填写活动名称。");
      return;
    }
    if (fields.endTime && fields.endTime < fields.time) {
      setError("结束时间不能早于开始时间。");
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(fields, !removed && !activity && !!memberName && draft.join, removed ? undefined : draft.base);
      // A reopened editor owns a different session, even for the same activity.
      // An old success must not remove its newer draft.
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { session?: string } | null;
        if (saved?.session === session) localStorage.removeItem(storageKey);
      } catch {
        // The successful server save does not depend on browser storage.
      }
    } catch (reason) {
      if (mounted.current) {
        const message = reason instanceof Error && /[\u3400-\u9fff]/.test(reason.message)
          ? reason.message
          : "保存失败，草稿已保留。";
        setError(message);
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <Sheet title={activity ? "编辑活动" : "添加活动"} onClose={onClose}>
      <form onSubmit={submit} aria-busy={saving}>
        {matchedPlace && (
          <div className="place-hours" aria-live="polite">
            <Clock size={15} aria-hidden="true" />
            <span>
              {matchedPlace.hoursByDate[draft.fields.date] ?? matchedPlace.hours}
              {matchedPlace.hoursNote && <span className="place-hours-note">{matchedPlace.hoursNote}</span>}
            </span>
            <a href={matchedPlace.hoursUrl} target="_blank" rel="noreferrer">开放时间</a>
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor={`${id}-title`}>名称</label>
          <input id={`${id}-title`} className="text-input" data-sheet-autofocus name="title" value={draft.fields.title}
            onChange={(event) => change("title", event.target.value)} required maxLength={120}
            autoComplete="off" disabled={saving} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-date`}>日期</label>
          <select id={`${id}-date`} className="text-input" name="date" value={draft.fields.date}
            onChange={(event) => change("date", event.target.value as TripDate)} disabled={saving}>
            {DATES.map((date, index) => <option value={date} key={date}>{DATE_LABELS[index]}</option>)}
          </select>
        </div>
        <div className="field-row">
          <div className="field">
            <label className="field-label" htmlFor={`${id}-time`}>开始</label>
            <input id={`${id}-time`} className="text-input" type="time" name="time" required value={draft.fields.time}
              onChange={(event) => change("time", event.target.value)} disabled={saving} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-end-time`}>结束（选填）</label>
            <input id={`${id}-end-time`} className="text-input" type="time" name="endTime" value={draft.fields.endTime}
              onChange={(event) => change("endTime", event.target.value)} min={draft.fields.time || undefined} disabled={saving} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <div className="field-label-row">
              <label className="field-label" htmlFor={`${id}-location`}>地点（选填）</label>
              {mapUrl && <a className="map-link" href={mapUrl} target="_blank" rel="noreferrer">地图</a>}
            </div>
            <input id={`${id}-location`} className="text-input" name="location" value={draft.fields.location}
              onChange={(event) => change("location", event.target.value)} maxLength={160} disabled={saving} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-category`}>分类</label>
            <select id={`${id}-category`} className="text-input" name="category" value={draft.fields.category}
              onChange={(event) => change("category", event.target.value as Category)} disabled={saving}>
              {CATEGORIES.map(({ value, label }) => <option value={value} key={value}>{label}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-note`}>备注（选填）</label>
          <textarea id={`${id}-note`} className="text-input textarea" name="note" rows={3} value={draft.fields.note}
            onChange={(event) => change("note", event.target.value)} maxLength={2000} disabled={saving} />
        </div>
        {!activity && memberName && (
          <label className="checkbox-field">
            <input type="checkbox" checked={draft.join} onChange={(event) => setDraft((current) => ({ ...current, join: event.target.checked }))} disabled={saving} />
            <span>我也参加 · {memberName}</span>
          </label>
        )}
        {conflicts.length > 0 && latestActivity && (
          <section ref={conflictPanel} id={`${id}-conflicts`} className={`conflict-panel ${styles.conflictPanel}`} tabIndex={-1} aria-label="处理活动更新" aria-live="polite">
            <p className="form-error">以下内容已更新</p>
            {conflicts.map((field) => (
              <div className="field" key={field}>
                <strong className="field-label">{FIELD_LABELS[field]}</strong>
                <dl className="conflict-values">
                  <div><dt>当前</dt><dd>{fieldValue(field, latestActivity[field])}</dd></div>
                  <div><dt>我的</dt><dd>{fieldValue(field, draft.fields[field])}</dd></div>
                </dl>
              </div>
            ))}
            <div className="conflict-actions">
              <button type="button" className="secondary-button" onClick={() => resolveConflicts(false)} disabled={saving}>采用最新</button>
              <button type="button" className="secondary-button" onClick={() => resolveConflicts(true)} disabled={saving}>保留我的</button>
            </div>
          </section>
        )}
        {removed && <p className="form-error" role="status">活动已删除，可另存。</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-footer">
          <SheetClose asChild><button type="button" className="secondary-button">取消</button></SheetClose>
          {conflicts.length > 0
            ? <button type="button" className="primary-button" aria-controls={`${id}-conflicts`} onClick={viewConflicts} disabled={saving || !ready}>查看更新</button>
            : <button type="submit" className="primary-button" disabled={saving || !ready}>{saving ? "保存中…" : removed ? "另存为新活动" : "保存"}</button>}
        </div>
      </form>
    </Sheet>
  );
}
