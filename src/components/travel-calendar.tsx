"use client";

import Image from "next/image";
import { BRAND_IMAGE, BRAND_NAME } from "@/lib/brand";
import { OverlapGroup } from "./overlap-group";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDroppable, pointerWithin, closestCenter, type DragStartEvent, type DragEndEvent, type DragOverEvent, type CollisionDetection } from "@dnd-kit/core";
import { SortableContext, useSortable, rectSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, ArrowUpRight, ArrowUp, ArrowDown, ArrowRight, Check, MoreHorizontal, GripVertical, MapPin, Users, X, Share2, ChevronDown, CalendarDays, TrainFront, Utensils, Compass, Coffee, Pencil, MoveRight, Trash2, AlertCircle, LoaderCircle, ArrowLeft, CheckCheck, Clock, Sparkles, CircleHelp } from "lucide-react";
import { activitiesOverlap, groupOverlaps, choiceKey, OperationError } from "@/lib/operations";
import { googleMapsUrl } from "@/lib/maps";
import { filterActivities, getActivityFilterCounts, type ActivityFilter } from "@/lib/activity-filters";
import { findPlaceByLocation, type Place } from "@/lib/places";
import { PlacesStrip } from "./places-strip";
import { useBoard } from "@/hooks/use-board";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { ActivityEditor } from "./activity-editor";
import { ActivityReactions } from "./activity-reactions";
import { Sheet, SheetClose } from "./sheet";
import { MembersSheet } from "./members-sheet";
import { MemberAvatar } from "./member-avatar";
import { getMemberProfile } from "@/lib/member-profiles";
import { DATES, MEMBERS, EMOJIS, type Activity, type ActivityFields, type BoardState, type Category, type Emoji, type MemberId, type Participation, type Operation, type TripDate } from "@/lib/types";

const DAYS = [
  { date: DATES[0], day: "31", month: "10月", weekday: "周六", label: "10月31日", accent: "#b56243", pale: "#f6e7db", number: "01" },
  { date: DATES[1], day: "01", month: "11月", weekday: "周日", label: "11月1日", accent: "#667b57", pale: "#e9eddf", number: "02" },
  { date: DATES[2], day: "02", month: "11月", weekday: "周一", label: "11月2日", accent: "#607e99", pale: "#e4ecf3", number: "03" },
];
const CATEGORIES = { travel: { label: "出行", Icon: TrainFront }, explore: { label: "游览", Icon: Compass }, food: { label: "餐饮", Icon: Utensils }, rest: { label: "休息", Icon: Coffee } };
const sortActivities = (a: Activity, b: Activity) => a.time.localeCompare(b.time) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);
const uid = () => crypto.randomUUID();
const readLocal = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeLocal = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Cloud actions still work without browser storage. */ } };
const removeLocal = (key: string) => { try { localStorage.removeItem(key); } catch { /* Storage is optional. */ } };
const INTENTS: { status: Participation; label: string; Icon: typeof Check }[] = [
  { status: "going", label: "参加", Icon: Check },
  { status: "interested", label: "感兴趣", Icon: Sparkles },
  { status: "maybe", label: "考虑考虑", Icon: CircleHelp },
  { status: "not-going", label: "不参加", Icon: X },
];
const intentLabel = (status?: Participation) => INTENTS.find(i => i.status === status)?.label ?? "未表态";
// Date and time changes stay available in the editor; direct movement is hidden to avoid accidental changes.
const ACTIVITY_MOVING_ENABLED = false;
type DetailPosition = { id: string; top: number };
function endAfterMove(activity: Activity, time: string) {
  if (!activity.endTime) return "";
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const end = minutes(time) + minutes(activity.endTime) - minutes(activity.time);
  return end < 1440 ? `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` : "";
}

interface CardProps { activity: Activity; state: BoardState; member: MemberId | null; onDetails: (id: string) => void; onRespond: (a: Activity) => void; optionIndex?: number; showTime?: boolean; conflicts?: string[]; onReact: (a: Activity, emoji: Emoji) => void; onAddReaction: (a: Activity) => void; }
export function ActivityCard({ activity: a, state, member, onDetails, onRespond, onReact, onAddReaction, optionIndex, showTime = true, conflicts = [] }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: a.id, disabled: !ACTIVITY_MOVING_ENABLED, data: { type: "activity", activity: a } });
  const attendees = state.responses.filter(r => r.activityId === a.id && r.status === "going");
  const answered = state.responses.filter(r => r.activityId === a.id).length;
  const interested = state.responses.filter(r => r.activityId === a.id && r.status === "interested").length;
  const maybe = state.responses.filter(r => r.activityId === a.id && r.status === "maybe").length;
  const selected = state.responses.find(r => r.activityId === a.id && r.memberId === member)?.status;
  const { Icon, label } = CATEGORIES[a.category];
  return <article ref={setNodeRef} data-activity-id={a.id} className={`activity-card ${optionIndex !== undefined ? "choice-card" : ""} ${isDragging ? "is-dragging" : ""}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
    <div className="card-top"><span className="activity-kind">{optionIndex !== undefined ? <b className="option-letter">{optionIndex + 1}</b> : <><Icon size={14} strokeWidth={1.7} />{label}</>}</span><div className="card-tools">
      {ACTIVITY_MOVING_ENABLED && <button className="icon-button drag-handle" {...attributes} {...listeners} aria-label={`拖动 ${a.title}`} title="拖动调整位置"><GripVertical size={16} /></button>}
      <button className="icon-button" onClick={() => onDetails(a.id)} aria-label={`${a.title} 的详情与操作`}><MoreHorizontal size={19} /></button>
    </div></div>
    <button className="card-main" onClick={() => onDetails(a.id)} aria-label={`查看 ${a.title}${showTime ? `，${a.time}${a.endTime && a.endTime !== a.time ? ` 至 ${a.endTime}` : ""}` : ""}`}><div className="card-time" hidden={!showTime}>{a.time}{a.endTime && a.endTime !== a.time && <><span className="time-dash">—</span>{a.endTime}</>}</div><h3>{a.title}</h3></button>{a.location && <a className="card-location" href={googleMapsUrl(a.location)} target="_blank" rel="noreferrer" aria-label={`${a.location}，Google 地图`}><MapPin size={13} /><span>{a.location}</span><ArrowUpRight size={12} /></a>}
    {conflicts.length > 0 && <p className="card-conflicts">与 {conflicts.join("、")} 重叠</p>}
    <button className="attendance-summary" onClick={() => onDetails(a.id)} aria-label={`查看 ${a.title} 的参加名单`}>
      {attendees.length > 0 ? <><span className="avatar-stack">{attendees.map(r => <MemberAvatar key={r.memberId} profile={getMemberProfile(state, r.memberId)} small />)}</span><span>{attendees.length} 人参加{answered < 5 && <span className="attendance-pending"> · {5 - answered} 人未表态</span>}</span></> : <><span className="empty-attendance"><Users size={14} /></span><span>{interested ? `${interested} 人感兴趣` : maybe ? `${maybe} 人考虑中` : answered === 5 ? "0 人参加" : "0 人参加"}</span></>}
      <ArrowUpRight size={13} className="summary-arrow" />
    </button>
    <div className="card-footer"><button className={`intent-button intent-${selected ?? "none"}`} aria-label={`${a.title}：${selected ? intentLabel(selected) : "选择意向"}`} onClick={() => onRespond(a)}>{selected === "going" ? <Check size={14} /> : selected === "interested" ? <Sparkles size={14} /> : selected === "maybe" ? <CircleHelp size={14} /> : selected === "not-going" ? <X size={14} /> : <Plus size={14} />}<span>{selected ? intentLabel(selected) : "选择意向"}</span><ChevronDown size={12} /></button><ActivityReactions activity={a} reactions={state.reactions} member={member} onReact={onReact} onAdd={onAddReaction} /></div>
  </article>;
}
function DayTab({ day, selected, onSelect }: { day: typeof DAYS[number]; selected: boolean; onSelect: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.date}`, disabled: !ACTIVITY_MOVING_ENABLED, data: { type: "day", date: day.date } });
  return <button ref={setNodeRef} className={`date-tab ${selected ? "selected" : ""} ${isOver ? "drop-hover" : ""}`} onClick={onSelect} aria-pressed={selected} style={{ "--day-color": day.accent, "--day-pale": day.pale } as CSSProperties}><span className="tab-date">{day.month}{day.day}日</span><span className="tab-weekday">{day.weekday}<span className="tab-dot" /></span></button>;
}
function DayColumn({ day, selected, children }: { day: typeof DAYS[number]; selected: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${day.date}`, disabled: !ACTIVITY_MOVING_ENABLED, data: { type: "day", date: day.date } });
  return <section ref={setNodeRef} className={`day-column ${selected ? "current-day" : ""} ${isOver ? "drop-hover" : ""}`} style={{ "--day-color": day.accent, "--day-pale": day.pale } as CSSProperties} aria-label={`${day.month}${day.day}日 ${day.weekday}`}>{children}</section>;
}

export function TravelCalendar() {
  const board = useBoard();
  const reducedMotion = useReducedMotion();
  const { state, dispatch } = board;
  const [member, setMember] = useState<MemberId | null>(null);
  const [date, setDate] = useState<TripDate>(DATES[0]);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const memberRef = useRef(member); memberRef.current = member;
  const filterRef = useRef(filter); filterRef.current = filter;
  const [showMembers, setShowMembers] = useState(false);
  const [intentTarget, setIntentTarget] = useState<{ activity: Activity; memberId: MemberId; origin?: DetailPosition } | null>(null);
  const [reactionTarget, setReactionTarget] = useState<{ activityId: string; memberId: MemberId } | null>(null);
  const detailReturn = useRef<DetailPosition | null>(null);
  const [switchChoice, setSwitchChoice] = useState<{ activity: Activity; previous: Activity[]; memberId: MemberId } | null>(null);
  const afterMember = useRef<((id: MemberId) => void) | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ key: string; activity?: Activity; date: TripDate; time?: string; place?: Place } | null>(null);
  const editorRef = useRef(editor); editorRef.current = editor;
  const [moveTarget, setMoveTarget] = useState<Activity | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Activity | null>(null);
  const moveRef = useRef(moveTarget); moveRef.current = moveTarget;
  const deleteRef = useRef(deleteTarget); deleteRef.current = deleteTarget;
  const dateRef = useRef(date); dateRef.current = date;
  const pendingCreates = useRef(new Map<string, Extract<Operation, { type: "create" }>>());
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const toastSequence = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [drag, setDrag] = useState<Activity | null>(null);
  const dragRef = useRef<{ activity: Activity; date: TripDate; scrollY: number; pointerId: number | null; activatorEvent: Event } | null>(null);
  const pendingDragPointer = useRef<number | null>(null);
  const [animateDrop, setAnimateDrop] = useState(false);
  const [dndKey, setDndKey] = useState(0);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRestoreFrame = useRef<number | null>(null);
  const dragViewSequence = useRef(0);
  const scrollPositions = useRef<Partial<Record<string, number>>>({});
  const dateAnchor = useRef<HTMLDivElement>(null);
  const dateFrame = useRef<number | null>(null);
  const dateAnimation = useRef<Animation | null>(null);
  const stateRef = useRef(state); stateRef.current = state;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const notify = useCallback((message: string) => { setToast({ id: ++toastSequence.current, message }); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 3200); }, []);
  useEffect(() => {
    const saved = readLocal("toulouse-member"); if (MEMBERS.some(m => m.id === saved)) setMember(saved as MemberId);
    const savedDate = readLocal("toulouse-date"); if (DATES.includes(savedDate as TripDate)) setDate(savedDate as TripDate);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      if (dragRestoreFrame.current !== null) cancelAnimationFrame(dragRestoreFrame.current);
      ++dragViewSequence.current;
      if (dateFrame.current !== null) cancelAnimationFrame(dateFrame.current);
      dateAnimation.current?.cancel();
    };
  }, []);
  useEffect(() => { if (reducedMotion) dateAnimation.current?.cancel(); }, [reducedMotion]);
  const clearDragRestore = useCallback(() => {
    ++dragViewSequence.current;
    if (dragRestoreFrame.current !== null) cancelAnimationFrame(dragRestoreFrame.current);
    dragRestoreFrame.current = null;
  }, []);
  const cancelDrag = useCallback((event?: Pick<DragEndEvent, "active" | "activatorEvent">) => {
    if (event && (dragRef.current?.activatorEvent !== event.activatorEvent || dragRef.current.activity.id !== event.active.id)) return;
    pendingDragPointer.current = null;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    const active = dragRef.current;
    dragRef.current = null;
    setDrag(null); setAnimateDrop(false);
    if (!active) return;
    clearDragRestore();
    dateRef.current = active.date; setDate(active.date);
    const sequence = dragViewSequence.current;
    // A shorter preview day can clamp the document scroll position. Restore it
    // only after the original day is visible, unless a newer action takes over.
    dragRestoreFrame.current = requestAnimationFrame(() => {
      if (sequence !== dragViewSequence.current) return;
      dragRestoreFrame.current = null;
      if (!dragRef.current && dateRef.current === active.date) window.scrollTo({ top: active.scrollY, behavior: "instant" });
    });
  }, [clearDragRestore]);
  useEffect(() => {
    const cancel = () => { if (document.hidden && dragRef.current) { cancelDrag(); setDndKey(k => k + 1); } };
    document.addEventListener("visibilitychange", cancel); return () => document.removeEventListener("visibilitychange", cancel);
  }, [cancelDrag]);
  useEffect(() => {
    if (!ACTIVITY_MOVING_ENABLED) return;
    const cancelForSecondPointer = (event: PointerEvent) => {
      const active = dragRef.current;
      const pointerId = active ? active.pointerId : pendingDragPointer.current;
      if (pointerId === null) {
        if (!active && event.isPrimary && event.button === 0 && event.target instanceof Element && event.target.closest(".drag-handle")) pendingDragPointer.current = event.pointerId;
        return;
      }
      if (pointerId === event.pointerId) return;
      cancelDrag();
      // End the sensor's document listeners before a later pointerup can submit.
      document.dispatchEvent(new PointerEvent("pointercancel", { pointerId }));
      setDndKey(k => k + 1);
    };
    const clearPendingPointer = (event: PointerEvent) => { if (event.pointerId === pendingDragPointer.current) pendingDragPointer.current = null; };
    document.addEventListener("pointerdown", cancelForSecondPointer, true);
    document.addEventListener("pointerup", clearPendingPointer, true);
    document.addEventListener("pointercancel", clearPendingPointer, true);
    return () => {
      document.removeEventListener("pointerdown", cancelForSecondPointer, true);
      document.removeEventListener("pointerup", clearPendingPointer, true);
      document.removeEventListener("pointercancel", clearPendingPointer, true);
      pendingDragPointer.current = null;
    };
  }, [cancelDrag]);
  useEffect(() => {
    const active = dragRef.current;
    if (active && state.activities.find(a => a.id === active.activity.id)?.revision !== active.activity.revision) { cancelDrag(); setDndKey(k => k + 1); notify("这个活动有更新，已取消移动"); }
  }, [state.activities, cancelDrag, notify]);
  const viewKey = (day: TripDate, view: ActivityFilter, id: MemberId | null) => `${day}:${view === "all" ? "all" : `${view}:${id ?? "none"}`}`;
  const selectView = (nextDate: TripDate, nextFilter: ActivityFilter, nextMember: MemberId | null) => {
    clearDragRestore();
    const previousKey = viewKey(dateRef.current, filterRef.current, memberRef.current);
    const nextKey = viewKey(nextDate, nextFilter, nextMember);
    memberRef.current = nextMember; setMember(nextMember);
    if (previousKey === nextKey) return;
    const mobile = window.matchMedia("(max-width: 799px)").matches;
    // A rapid second switch must not save the previous view's scroll under a
    // destination whose own restoration has not run yet.
    if (mobile && dateFrame.current === null) scrollPositions.current[previousKey] = window.scrollY;
    if (dateFrame.current !== null) cancelAnimationFrame(dateFrame.current);
    dateFrame.current = null;
    dateAnimation.current?.cancel(); dateAnimation.current = null;
    const anchorTop = (dateAnchor.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
    const top = scrollPositions.current[nextKey] ?? Math.min(window.scrollY, anchorTop);
    dateRef.current = nextDate; filterRef.current = nextFilter;
    setDate(nextDate); setFilter(nextFilter); writeLocal("toulouse-date", nextDate);
    if (mobile) {
      const frame = requestAnimationFrame(() => {
        if (dateFrame.current !== frame || viewKey(dateRef.current, filterRef.current, memberRef.current) !== nextKey) return;
        dateFrame.current = null;
        if (!window.matchMedia("(max-width: 799px)").matches) return;
        window.scrollTo({ top, behavior: "instant" });
        const column = document.querySelector<HTMLElement>(".day-column.current-day");
        if (!dragRef.current && !document.hidden && !window.matchMedia("(prefers-reduced-motion: reduce)").matches && column?.animate) {
          dateAnimation.current = column.animate([{ opacity: .65 }, { opacity: 1 }], { duration: 130, easing: "ease-out" });
        }
      });
      dateFrame.current = frame;
    }
  };
  const selectDay = (next: TripDate) => selectView(next, filterRef.current, memberRef.current);
  const withMember = (action: (id: MemberId) => void) => { if (memberRef.current) action(memberRef.current); else { afterMember.current = action; setShowMembers(true); } };
  const selectFilter = (next: ActivityFilter) => {
    if (next !== "all") withMember(id => selectView(dateRef.current, next, id));
    else selectView(dateRef.current, next, memberRef.current);
  };
  const chooseMember = (id: MemberId) => { selectView(dateRef.current, filterRef.current, id); writeLocal("toulouse-member", id); setShowMembers(false); const action = afterMember.current; afterMember.current = null; action?.(id); };
  const respond = (a: Activity) => {
    const origin = detailId === a.id ? { id: a.id, top: document.querySelector<HTMLElement>(".activity-detail-sheet")?.scrollTop ?? 0 } : undefined;
    withMember(id => { setDetailId(null); setIntentTarget({ activity: a, memberId: id, origin }); });
  };
  const returnToDetails = () => {
    const origin = intentTarget?.origin;
    setIntentTarget(null);
    if (!origin || !stateRef.current.activities.some(a => a.id === origin.id)) return;
    detailReturn.current = origin;
    setDetailId(origin.id);
  };
  const previousChoices = (a: Activity, id: MemberId) => stateRef.current.activities.filter(other => other.id !== a.id && activitiesOverlap(other, a) && stateRef.current.responses.some(r => r.activityId === other.id && r.memberId === id && r.status === "going"));
  const submitIntent = (a: Activity, id: MemberId, status: Participation | null, justCreated = false, allowConfirmation = true) => {
    const latest = stateRef.current.activities.find(other => other.id === a.id) ?? (justCreated ? a : undefined);
    if (!latest) { notify("这个活动已移除，请重新选择"); return; }
    if (status === "going") {
      const previous = previousChoices(latest, id);
      if (previous.length) {
        // A completed background save must not replace the user's current sheet.
        if (!allowConfirmation) return "deferred";
        setSwitchChoice({ activity: latest, previous, memberId: id }); return;
      }
      void dispatch({ id: uid(), type: "participate", activityId: latest.id, memberId: id, status, choice: { key: choiceKey(latest), previousIds: [] } }).catch(() => {});
      return;
    }
    void dispatch({ id: uid(), type: "participate", activityId: latest.id, memberId: id, status }).catch(() => {});
  };
  const confirmChoice = () => {
    if (!switchChoice) return;
    const { activity, previous, memberId } = switchChoice;
    const latest = stateRef.current.activities.find(a => a.id === activity.id);
    if (!latest) { setSwitchChoice(null); notify("这个活动已移除，请重新选择"); return; }
    const currentPrevious = previousChoices(latest, memberId);
    const ids = (items: Activity[]) => items.map(a => a.id).sort().join("|");
    if (choiceKey(latest) !== choiceKey(activity) || ids(previous) !== ids(currentPrevious)) {
      setSwitchChoice(null); notify("安排有更新，请确认新的选择");
      setIntentTarget({ activity: latest, memberId }); return;
    }
    setSwitchChoice(null);
    void dispatch({ id: uid(), type: "participate", activityId: latest.id, memberId, status: "going", choice: { key: choiceKey(latest), previousIds: currentPrevious.map(a => a.id).sort() } }).catch(() => {});
  };
  const submitReaction = (activityId: string, memberId: MemberId, emoji: Emoji, toggle: boolean) => {
    if (!stateRef.current.activities.some(a => a.id === activityId)) { notify("这个活动已移除"); return; }
    const selected = stateRef.current.reactions.some(r => r.activityId === activityId && r.memberId === memberId && r.emoji === emoji);
    if (!toggle && selected) return;
    void dispatch({ id: uid(), type: "react", activityId, memberId, emoji, active: toggle ? !selected : true }).catch(() => {});
  };
  const react = (a: Activity, emoji: Emoji) => withMember(id => submitReaction(a.id, id, emoji, true));
  const openReactions = (a: Activity) => withMember(id => {
    if (!stateRef.current.activities.some(item => item.id === a.id)) { notify("这个活动已移除"); return; }
    setReactionTarget({ activityId: a.id, memberId: id });
  });
  const openEditor = (day: TripDate, activity?: Activity, time?: string) => { setDetailId(null); setEditor({ key: uid(), activity, date: day, time }); };
  const saveEditor = async (fields: ActivityFields, join: boolean, editorBase: ActivityFields | undefined) => {
    const session = editorRef.current; if (!session) return;
    const capturedMember = member;
    let participationDeferred = false;
    const updateFields = async (activityId: string, baseline: ActivityFields) => {
      const patch: Partial<ActivityFields> = {}, base: Partial<ActivityFields> = {};
      for (const field of Object.keys(fields) as (keyof ActivityFields)[]) if (fields[field] !== baseline[field] && field !== "sortOrder") { Object.assign(patch, { [field]: fields[field] }); Object.assign(base, { [field]: baseline[field] }); }
      if (Object.keys(patch).length) {
        const operationId = uid();
        try { await dispatch({ id: operationId, type: "update", activityId, patch, base }); }
        catch (error) { if (error instanceof OperationError) board.dropOperation(operationId); throw error; }
      }
    };
    if (session.activity && editorBase) await updateFields(session.activity.id, editorBase);
    else {
      // An ambiguous network failure must never turn one draft into two activities.
      const key = `travel-calendar:create-request:${session.activity?.id ?? `${session.date}:${session.place?.id ?? "blank"}`}`;
      let operation = pendingCreates.current.get(key);
      if (!operation) { try { const stored = JSON.parse(readLocal(key) ?? "null"); if (stored?.type === "create" && stored.activity?.id) operation = stored; } catch { /* Ignore malformed draft metadata. */ } }
      if (!operation) operation = { id: uid(), type: "create", activity: { ...fields, id: uid(), revision: 1, sortOrder: Date.now() / 10000 } };
      pendingCreates.current.set(key, operation); writeLocal(key, JSON.stringify(operation));
      const createOperationId = operation.id;
      const clearCreateRequest = () => {
        // A later session may already own a different request for this draft key.
        if (pendingCreates.current.get(key)?.id === createOperationId) pendingCreates.current.delete(key);
        try { if (JSON.parse(readLocal(key) ?? "null")?.id === createOperationId) removeLocal(key); }
        catch { /* Unreadable metadata must not be mistaken for this request. */ }
      };
      try {
        await dispatch(operation);
        await updateFields(operation.activity.id, operation.activity);
      } catch (error) {
        if (error instanceof OperationError && (error.code === "VALIDATION" || error.code === "NOT_FOUND")) { board.dropOperation(operation.id); clearCreateRequest(); }
        throw error;
      }
      clearCreateRequest();
      if (join && capturedMember) participationDeferred = submitIntent({ ...operation.activity, ...fields }, capturedMember, "going", true, editorRef.current?.key === session.key) === "deferred";
    }
    if (editorRef.current?.key === session.key) { setEditor(null); selectDay(fields.date); }
    notify(participationDeferred ? `「${fields.title}」已添加，意向待确认` : session.activity && editorBase ? "活动已更新" : "活动已添加");
  };
  const move = async (a: Activity, nextDate: TripDate, time: string, order?: number) => {
    if (!ACTIVITY_MOVING_ENABLED) return;
    await dispatch({ id: uid(), type: "update", activityId: a.id, base: { date: a.date, time: a.time, endTime: a.endTime, sortOrder: a.sortOrder }, patch: { date: nextDate, time, endTime: endAfterMove(a, time), sortOrder: order ?? Date.now() / 10000 } });
  };
  const reorder = async (a: Activity, direction: number) => {
    const sameTime = state.activities.filter(b => b.date === a.date && b.time === a.time).sort(sortActivities);
    const at = sameTime.findIndex(b => b.id === a.id); const neighbor = sameTime[at + direction]; if (!neighbor) return;
    const next = sameTime[at + direction * 2];
    await move(a, a.date, a.time, next && next.sortOrder !== neighbor.sortOrder ? (neighbor.sortOrder + next.sortOrder) / 2 : neighbor.sortOrder + direction * (next ? .001 : 1024));
    notify("顺序已调整");
  };
  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    pendingDragPointer.current = null;
    clearDragRestore();
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    if (dateFrame.current !== null) cancelAnimationFrame(dateFrame.current);
    dateFrame.current = null;
    dateAnimation.current?.cancel();
    setAnimateDrop(false);
    const a = stateRef.current.activities.find(a => a.id === active.id);
    if (a) { dragRef.current = { activity: { ...a }, date: dateRef.current, scrollY: window.scrollY, activatorEvent, pointerId: "pointerId" in activatorEvent && typeof activatorEvent.pointerId === "number" ? activatorEvent.pointerId : null }; setDrag(a); }
  };
  const onDragOver = ({ over }: DragOverEvent) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    const active = dragRef.current;
    const targetDate = over?.data.current?.type === "day" ? over.data.current.date as TripDate : undefined;
    if (!active || !targetDate || !DATES.includes(targetDate) || targetDate === dateRef.current) return;
    const sequence = dragViewSequence.current;
    hoverTimer.current = setTimeout(() => {
      if (dragRef.current !== active || sequence !== dragViewSequence.current) return;
      hoverTimer.current = null;
      dateRef.current = targetDate; setDate(targetDate);
    }, 450);
  };
  const onDragEnd = async ({ active: sourceActivity, activatorEvent, over }: DragEndEvent) => {
    const active = dragRef.current;
    if (!active || active.activatorEvent !== activatorEvent || active.activity.id !== sourceActivity.id) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    if (!over || over.id === active.activity.id) { cancelDrag(); return; }
    const current = stateRef.current.activities.find(a => a.id === active.activity.id);
    if (!current || current.revision !== active.activity.revision) { cancelDrag(); notify("活动有更新，请重新移动"); return; }
    const target = over.data.current;
    let nextDate: TripDate = current.date, time = current.time, order: number | undefined;
    if (target?.type === "activity") {
      const other = stateRef.current.activities.find(a => a.id === over.id);
      if (!other) { cancelDrag(); return; }
      nextDate = other.date; time = other.time;
      const sorted = stateRef.current.activities.filter(a => a.date === other.date && a.time === other.time && a.id !== current.id).sort(sortActivities);
      const at = sorted.findIndex(a => a.id === other.id);
      const after = current.date === other.date && current.time === other.time && current.sortOrder < other.sortOrder;
      const adjacent = sorted[at + (after ? 1 : -1)]; order = adjacent && adjacent.sortOrder !== other.sortOrder ? (other.sortOrder + adjacent.sortOrder) / 2 : other.sortOrder + (after ? 1 : -1) * (adjacent ? .001 : 1024);
    } else if (target?.type === "slot") { nextDate = target.date; time = target.time; }
    else if (target?.type === "day") { nextDate = target.date; }
    else { cancelDrag(); return; }
    if (!DATES.includes(nextDate)) { cancelDrag(); return; }
    const source = document.querySelector<HTMLElement>(`[data-activity-id="${current.id}"]`);
    const rect = source?.getBoundingClientRect();
    // dnd-kit's default drop measures and scrolls to the source node. A hidden
    // source day has a zero rect, so cross-day drops must not animate toward it.
    setAnimateDrop(nextDate === current.date && !!source?.getClientRects().length && !!rect && rect.width > 0 && rect.height > 0);
    dragRef.current = null; setDrag(null);
    try {
      const viewedDate = dateRef.current, sequence = dragViewSequence.current;
      await move(current, nextDate, time, order);
      if (sequence === dragViewSequence.current && !dragRef.current && dateRef.current === viewedDate) {
        dateRef.current = nextDate; setDate(nextDate); writeLocal("toulouse-date", nextDate);
      }
      notify("安排已移动");
    } catch { /* status bar retains retry */ }
  };
  const collision: CollisionDetection = args => { const hits = pointerWithin(args); return hits.length ? hits.filter(h => args.droppableContainers.find(c => c.id === h.id)?.data.current?.type === "activity").concat(hits.filter(h => args.droppableContainers.find(c => c.id === h.id)?.data.current?.type !== "activity")) : args.pointerCoordinates ? [] : closestCenter(args); };
  const details = state.activities.find(a => a.id === detailId);
  const detailPlace = details ? findPlaceByLocation(details.location) : undefined;
  const visible = filterActivities(state, member, filter);
  const dayCounts = getActivityFilterCounts(state, member, date);
  const tripCounts = getActivityFilterCounts(state, member);
  const totalGoing = state.responses.filter(r => r.status === "going").length;
  const selectedMember = member ? { id: member, ...getMemberProfile(state, member) } : null;
  const syncLabel = board.mode === "cloud" ? (
    board.pendingCount ? `${board.pendingCount} 项待同步`
      : board.error ? "未同步"
      : board.migration?.remaining ? "旧安排同步中"
      : board.connection === "live" ? "已同步"
      : board.connection === "connecting" ? "连接中"
      : board.connection === "offline" ? "离线" : "连接中断"
  ) : null;
  const share = async () => {
    try { if (navigator.share) await navigator.share({ title: "图图小分队三日游", text: "图卢兹行程", url: location.href }); else { await navigator.clipboard.writeText(location.href); notify("链接已复制"); } } catch (e) { if ((e as Error).name !== "AbortError") notify("请复制浏览器地址分享"); }
  };
  return <div className="app-shell">
    <header className="topbar"><a className="wordmark" href="/" aria-label={`${BRAND_NAME}首页`}><Image className="brand-photo" src={BRAND_IMAGE} alt="图卢兹加龙河与新桥" width={36} height={36} sizes="36px" preload /><h1>{BRAND_NAME}</h1></a><div className="topbar-actions">{syncLabel && <span className={`sync-status ${board.connection === "live" ? "live" : ""}`} title={syncLabel}><i />{syncLabel}</span>}<button className="member-switch" aria-label={selectedMember ? `切换角色，当前 ${selectedMember.name}` : "选择角色"} onClick={() => { afterMember.current = null; setShowMembers(true); }}>{selectedMember ? <><MemberAvatar profile={selectedMember} small /><span>{selectedMember.name}</span></> : <><Users size={16} /><span>选择角色</span></>}<ChevronDown size={13} /></button><button className="icon-button share-button" onClick={share} aria-label="分享行程"><Share2 size={18} /></button></div></header>
    <main>
      <PlacesStrip date={date} onCreate={(place, nextDate) => setEditor({ key: uid(), date: nextDate, place })} />
      <DndContext id="trip-calendar" key={dndKey} sensors={ACTIVITY_MOVING_ENABLED ? sensors : []} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={cancelDrag} accessibility={{ screenReaderInstructions: { draggable: ACTIVITY_MOVING_ENABLED ? "按空格开始移动，使用方向键调整位置，空格放下，Escape取消。也可以使用活动详情中的移动到按钮。" : "" } }}>
        <div ref={dateAnchor} aria-hidden="true" />
        <div className="mobile-date-tabs" style={{ "--selected-day": DATES.indexOf(date) } as CSSProperties}>{DAYS.map(day => <DayTab key={day.date} day={day} selected={day.date === date} onSelect={() => selectDay(day.date)} />)}</div>
        <div className="plan-toolbar">
          <div className="view-switch" role="group" aria-label="筛选安排">
            {([['all', '全部安排'], ['mine', '我参加的'], ['interested', '感兴趣的']] as const).map(([value, label]) => <button key={value} className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => selectFilter(value)}>{label}{(value === "all" || member) && <><span className="filter-day-count">{dayCounts[value]}</span><span className="filter-trip-count">{tripCounts[value]}</span></>}</button>)}
          </div>
          <div className="toolbar-right">{syncLabel && <span className={`mobile-sync ${board.connection === "live" ? "live" : ""}`}>{syncLabel}</span>}<button className="primary-button desktop-add" onClick={() => openEditor(date)}><Plus size={16} />添加活动</button></div>
        </div>
        {board.error && <div className="error-banner" role="alert"><AlertCircle size={17} /><span>{board.error}</span><button onClick={board.retry}>重试</button>{board.failedCount > 0 && <button onClick={board.dropFailed}>停止重试</button>}</div>}
        {!board.ready ? <div className="loading-state"><LoaderCircle className="spinning" size={22} /><span>加载中…</span></div> : <div className="calendar-board">{DAYS.map(day => <DayColumn key={day.date} day={day} selected={day.date === date}>
          <div className="day-heading"><div className="day-date"><span>{day.day}</span><div><b>{day.weekday}</b><small>{day.month}</small></div></div></div>
          {filter !== "all" && visible.filter(a => a.date === day.date).length === 0 ? <div className="mine-empty"><CalendarDays size={25} strokeWidth={1.5} /><p>{filter === "interested" ? "暂无感兴趣的活动" : "暂无参加的活动"}</p><button className="text-button" onClick={() => selectFilter("all")}>全部安排 <ArrowRight size={14} /></button></div> : (() => {
            const groups = groupOverlaps(visible.filter(a => a.date === day.date).sort(sortActivities));
            return <SortableContext items={groups.flat().map(a => a.id)} strategy={rectSortingStrategy}>
              {groups.map(options => options.length === 1
                ? <ActivityCard key={options[0].id} activity={options[0]} state={state} member={member} onDetails={setDetailId} onRespond={respond} onReact={react} onAddReaction={openReactions} />
                : <OverlapGroup key={options.map(a => a.id).join(":")} activities={options} state={state} member={member} renderActivity={(a, index, context) => <ActivityCard key={a.id} optionIndex={index} {...context} activity={a} state={state} member={member} onDetails={setDetailId} onRespond={respond} onReact={react} onAddReaction={openReactions} />} />)}
            </SortableContext>;
          })()}
          <button className="day-add" onClick={() => openEditor(day.date)}><Plus size={15} />添加活动</button>
        </DayColumn>)}</div>}
        <DragOverlay dropAnimation={reducedMotion || !animateDrop ? null : { duration: 160, easing: "ease-out" }}>{drag ? <div className="drag-preview"><span>{drag.time}</span><strong>{drag.title}</strong><GripVertical size={20} /></div> : null}</DragOverlay>
      </DndContext>

    </main>
    <button className="mobile-add primary-button" onClick={() => openEditor(date)}><Plus size={20} />添加活动</button>
    {toast && <div key={toast.id} className="toast" role="status">{toast.message}</div>}
    {showMembers && <MembersSheet state={state} authoritativeState={board.authoritativeState} member={member} onChoose={chooseMember} onClose={() => { setShowMembers(false); afterMember.current = null; }} onSave={async operation => {
      try { await dispatch(operation); }
      catch (error) { if (error instanceof OperationError) board.dropOperation(operation.id); throw error; }
    }} />}
    {editor && <ActivityEditor key={editor.key} activity={editor.activity} defaultDate={editor.date} defaultTime={editor.time} draftKey={editor.place?.id} initialFields={editor.place ? { title: editor.place.shortName, location: editor.place.locationQuery, category: editor.place.category, time: editor.place.hoursByDate[editor.date].match(/\d{2}:\d{2}/)?.[0] ?? "09:00", endTime: "", note: "" } : undefined} placeInfo={editor.place ? { hours: editor.place.hours, hoursUrl: editor.place.hoursUrl, hoursByDate: editor.place.hoursByDate } : undefined} latestActivity={editor.activity ? board.authoritativeState.activities.find(a => a.id === editor.activity!.id) ?? null : undefined} memberName={selectedMember ? selectedMember.name : undefined} onSave={saveEditor} onClose={() => setEditor(null)} />}
    {detailId && !details && <Sheet title="活动已移除" onClose={() => setDetailId(null)}><SheetClose asChild><button className="primary-button">回到行程</button></SheetClose></Sheet>}
    {details && <Sheet title={details.title} mobileBodyTitle onClose={() => setDetailId(null)} className="activity-detail-sheet"><ActivityDetailBody activityId={details.id} returnPosition={detailReturn}><div className="detail-meta"><span><CalendarDays size={16} />{details.date.slice(5).replace("-", "月")}日 · {details.time}{details.endTime ? ` — ${details.endTime}` : ""}</span>{details.location && <a className="map-link" href={googleMapsUrl(details.location)} target="_blank" rel="noreferrer"><MapPin size={16} />{details.location}<ArrowUpRight size={14} /></a>}</div>{detailPlace && <div className="place-hours"><Clock size={15} /><span>{detailPlace.hoursByDate[details.date]}</span><a href={detailPlace.hoursUrl} target="_blank" rel="noreferrer">开放时间</a>{detailPlace.hoursNote && <small>{detailPlace.hoursNote}</small>}</div>}{details.note && <p className="detail-note">{details.note}</p>}<h3 className="section-label">参与情况</h3><div className="participant-list">{MEMBERS.map(m => { const status = state.responses.find(r => r.activityId === details.id && r.memberId === m.id)?.status; return <div key={m.id} className="participant-row"><MemberAvatar profile={getMemberProfile(state, m.id)} small /><span>{getMemberProfile(state, m.id).name}{member === m.id && <small>你</small>}</span><span className={`participant-status ${status ?? "unanswered"}`}>{status === "going" ? <><Check size={13} />参加</> : intentLabel(status)}</span></div>; })}</div><div className="detail-responses"><button className="primary-button" onClick={() => respond(details)}><Check size={16} />{member ? `我的意向 · ${intentLabel(state.responses.find(r => r.activityId === details.id && r.memberId === member)?.status)}` : "填写我的意向"}<ChevronDown size={14} /></button></div><div className="detail-actions"><button onClick={() => openEditor(details.date, { ...details })}><Pencil size={16} />编辑活动</button>{ACTIVITY_MOVING_ENABLED && <button onClick={() => { setMoveTarget({ ...details }); setDetailId(null); }}><MoveRight size={16} />移动到</button>}<button className="danger-text" onClick={() => { setDeleteTarget({ ...details }); setDetailId(null); }}><Trash2 size={16} />移除</button></div></ActivityDetailBody></Sheet>}
    {reactionTarget && <Sheet title="添加表情" onClose={() => setReactionTarget(null)}><div className="reaction-picker" role="group" aria-label="表情">{EMOJIS.map(emoji => {
      const selected = state.reactions.some(r => r.activityId === reactionTarget.activityId && r.memberId === reactionTarget.memberId && r.emoji === emoji);
      return <button key={emoji} type="button" aria-label={`添加 ${emoji}`} aria-pressed={selected} onClick={() => {
        const target = reactionTarget;
        setReactionTarget(null);
        submitReaction(target.activityId, target.memberId, emoji, false);
      }}><span aria-hidden="true">{emoji}</span>{selected && <Check size={12} aria-hidden="true" />}</button>;
    })}</div></Sheet>}
    {intentTarget && <Sheet title="参与意向" description={`${getMemberProfile(state, intentTarget.memberId).name} · ${intentTarget.activity.title}`} onClose={() => setIntentTarget(null)} onBack={intentTarget.origin ? returnToDetails : undefined} backLabel="返回活动详情"><div className="intent-options">{INTENTS.map(({status,label,Icon}) => { const selected = state.responses.some(r => r.activityId === intentTarget.activity.id && r.memberId === intentTarget.memberId && r.status === status); return <button key={status} className={`intent-option intent-${status} ${selected ? "selected" : ""}`} onClick={() => { setIntentTarget(null); submitIntent(intentTarget.activity, intentTarget.memberId, status); }}><span><Icon size={19} /></span><strong>{label}</strong>{selected && <Check size={18} />}</button>; })}</div><button className="clear-intent" onClick={() => { setIntentTarget(null); submitIntent(intentTarget.activity, intentTarget.memberId, null); }}>清除选择</button></Sheet>}
    {switchChoice && <Sheet title="更改参加活动" onClose={() => setSwitchChoice(null)}><p className="choice-switch-note">参加「{switchChoice.activity.title}」，「{switchChoice.previous.map(a => a.title).join("、")}」恢复未表态。</p><div className="form-footer"><SheetClose asChild><button className="secondary-button">取消</button></SheetClose><button className="primary-button" onClick={confirmChoice}>改选<ArrowRight size={16} /></button></div></Sheet>}
    {ACTIVITY_MOVING_ENABLED && moveTarget && <MoveSheet activity={moveTarget} onClose={() => setMoveTarget(null)} onMove={async (nextDate, time) => { const target = moveTarget; await move(target, nextDate, time); if (moveRef.current === target) setMoveTarget(null); notify("安排已移动"); }} onReorder={async direction => { const target = moveTarget; await reorder(target, direction); if (moveRef.current === target) setMoveTarget(null); }} state={state} />}
    {deleteTarget && <DeleteSheet activity={deleteTarget} onClose={() => setDeleteTarget(null)} onDelete={async () => { const target = deleteTarget; await dispatch({ id: uid(), type: "delete", activityId: target.id, expectedRevision: target.revision }); if (deleteRef.current === target) setDeleteTarget(null); notify("活动已移除"); }} />}
  </div>;
}

function ActivityDetailBody({ activityId, returnPosition, children }: { activityId: string; returnPosition: RefObject<DetailPosition | null>; children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const previous = returnPosition.current;
    const sheet = body.current?.closest<HTMLElement>("[data-travel-sheet]");
    if (!sheet || previous?.id !== activityId) return;
    returnPosition.current = null;
    sheet.scrollTo({ top: previous.top, behavior: "instant" });
    const button = body.current?.querySelector<HTMLButtonElement>(".detail-responses button");
    if (!button) return;
    const bounds = sheet.getBoundingClientRect(), item = button.getBoundingClientRect();
    const chrome = window.matchMedia("(max-width: 799px)").matches ? sheet.querySelector<HTMLElement>(".sheet-chrome") : null;
    const top = (chrome?.getBoundingClientRect().bottom ?? bounds.top + sheet.clientTop) + 12;
    const bottom = bounds.top + sheet.clientTop + sheet.clientHeight - 12;
    if (item.top < top) sheet.scrollTop += item.top - top;
    else if (item.bottom > bottom) sheet.scrollTop += item.bottom - bottom;
    // Also mark the destination for Radix's later open-autofocus phase.
    button.dataset.sheetAutofocus = "";
    button.focus({ preventScroll: true });
  }, [activityId, returnPosition]);
  return <div ref={body}>{children}</div>;
}

function MoveSheet({ activity, onClose, onMove, onReorder, state }: { activity: Activity; onClose: () => void; onMove: (date: TripDate, time: string) => Promise<void>; onReorder: (direction: number) => Promise<void>; state: BoardState }) {
  const [date, setDate] = useState(activity.date), [time, setTime] = useState(activity.time), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const sameTime = state.activities.filter(a => a.date === activity.date && a.time === activity.time).sort(sortActivities); const at = sameTime.findIndex(a => a.id === activity.id);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <Sheet title="移动活动" description={activity.title} onClose={onClose}><form onSubmit={e => { e.preventDefault(); void run(() => onMove(date, time)); }}><label className="field"><span className="field-label">日期</span><select className="text-input" value={date} onChange={e => setDate(e.target.value as TripDate)}>{DAYS.map(d => <option key={d.date} value={d.date}>{d.month}{d.day}日 · {d.weekday}</option>)}</select></label><label className="field"><span className="field-label">开始时间</span><input className="text-input" type="time" value={time} required onChange={e => setTime(e.target.value)} /></label>{sameTime.length > 1 && <div className="reorder-actions"><span>顺序</span><button type="button" className="secondary-button" disabled={busy || at === 0} onClick={() => void run(() => onReorder(-1))}><ArrowUp size={16} />上移</button><button type="button" className="secondary-button" disabled={busy || at === sameTime.length - 1} onClick={() => void run(() => onReorder(1))}><ArrowDown size={16} />下移</button></div>}{error && <p className="form-error" role="alert">{error}</p>}<div className="form-footer"><SheetClose asChild><button type="button" className="secondary-button">取消</button></SheetClose><button className="primary-button" disabled={busy}>{busy ? "移动中…" : "移到这里"}<ArrowRight size={16} /></button></div></form></Sheet>;
}
function DeleteSheet({ activity, onClose, onDelete }: { activity: Activity; onClose: () => void; onDelete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <Sheet title="移除这个活动？" description={`${activity.title} 的安排、参与和表情将一起移除。`} onClose={onClose}>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-footer"><SheetClose asChild><button className="secondary-button">保留</button></SheetClose><button className="primary-button danger-button" disabled={busy} onClick={async () => { setBusy(true); try { await onDelete(); } catch (e) { setError((e as Error).message); setBusy(false); } }}>{busy ? "移除中…" : "确认移除"}</button></div></Sheet>;
}
