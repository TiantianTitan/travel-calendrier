"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Check, Pencil } from "lucide-react";
import { getMemberProfile, AVATAR_PRESETS, MAX_PROFILE_NAME_LENGTH, isValidProfileName, type MemberProfile } from "@/lib/member-profiles";
import { OperationError } from "@/lib/operations";
import { MEMBERS, type BoardState, type MemberId, type Operation } from "@/lib/types";
import { MemberAvatar } from "./member-avatar";
import { Sheet } from "./sheet";
import styles from "./members-sheet.module.css";

type ProfileOperation = Extract<Operation, { type: "profile" }>;
interface MembersSheetProps {
  state: BoardState;
  authoritativeState: BoardState;
  member: MemberId | null;
  onChoose: (id: MemberId) => void;
  onClose: () => void;
  onSave: (operation: ProfileOperation) => Promise<void>;
}

function ProfileForm({ memberId, initial, latest, busy, onBusyChange: setBusy, onBack, onSave }: { memberId: MemberId; initial: MemberProfile; latest: MemberProfile; busy: boolean; onBusyChange: (busy: boolean) => void; onBack: () => void; onSave: MembersSheetProps["onSave"] }) {
  const [base, setBase] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<ProfileOperation | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const locked = busy || uncertain;
  const patchDraft = (patch: Partial<MemberProfile>) => { setDraft(value => ({ ...value, ...patch })); setError(""); };
  const chooseAvatar = (avatar: string) => patchDraft({ avatar });
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    const next = { ...draft, name: draft.name.trim() };
    if (!isValidProfileName(next.name)) { setError(`昵称需要 1–${MAX_PROFILE_NAME_LENGTH} 个字`); return; }
    let operation = pending.current;
    if (!operation) {
      const patch: Partial<MemberProfile> = {}, previous: Partial<MemberProfile> = {};
      for (const field of ["name", "avatar"] as const) if (next[field] !== base[field]) { patch[field] = next[field]; previous[field] = base[field]; }
      if (!Object.keys(patch).length) { onBack(); return; }
      operation = { id: crypto.randomUUID(), type: "profile", memberId, patch, base: previous };
      pending.current = operation;
    }
    setBusy(true); setError(""); setConflict(false);
    try { await onSave(operation); pending.current = null; if (alive.current) onBack(); }
    catch (cause) {
      if (!alive.current) return;
      if (cause instanceof OperationError) { pending.current = null; setUncertain(false); setConflict(cause.code === "CONFLICT"); }
      else setUncertain(true);
      setError(cause instanceof Error ? cause.message : "保存失败，请重试");
    } finally { if (alive.current) setBusy(false); }
  };
  return <form className="profile-form" onSubmit={save} aria-busy={busy} aria-label={`${initial.name} 的资料`}>
    <div className="profile-avatar-editor"><MemberAvatar profile={draft} large /><button type="button" className="secondary-button" disabled={locked} aria-label="使用昵称首字" aria-pressed={!draft.avatar} onClick={() => chooseAvatar("")}>首字头像</button></div>
    <label className="field"><span className="field-label">昵称</span><input name="nickname" className="text-input" autoComplete="nickname" value={draft.name} disabled={locked} maxLength={MAX_PROFILE_NAME_LENGTH * 2} onChange={e => patchDraft({ name: e.target.value })} /></label>
    <div className="avatar-options" aria-label="选择头像">{AVATAR_PRESETS.map(avatar => <button type="button" key={avatar} disabled={locked} aria-label={`头像 ${avatar}`} aria-pressed={draft.avatar === avatar} onClick={() => chooseAvatar(avatar)}>{avatar}</button>)}</div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {conflict && <div className="profile-conflict"><span className="profile-latest"><MemberAvatar profile={latest} small />最新：{latest.name}</span><div><button type="button" className="secondary-button" onClick={() => { setBase(latest); setDraft(latest); setConflict(false); setError(""); }}>使用最新资料</button><button type="button" className="secondary-button" onClick={() => { setDraft({ name: draft.name === base.name ? latest.name : draft.name, avatar: draft.avatar === base.avatar ? latest.avatar : draft.avatar }); setBase(latest); setConflict(false); setError(""); }}>保留我的修改</button></div></div>}
    <div className="form-footer"><button type="button" className="secondary-button" onClick={onBack} disabled={busy}>取消</button><button className="primary-button" disabled={busy || conflict}>{busy ? "保存中…" : uncertain ? "重试保存" : "保存"}</button></div>
  </form>;
}

export function MembersSheet({ state, authoritativeState, member, onChoose, onClose, onSave }: MembersSheetProps) {
  const [editing, setEditing] = useState<{ id: MemberId; initial: MemberProfile } | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [direction, setDirection] = useState<"forward" | "back" | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const editButtons = useRef(new Map<MemberId, HTMLButtonElement>());
  const listPosition = useRef<{ id: MemberId; top: number } | null>(null);
  const navigation = useRef<"edit" | "list" | null>(null);
  const editProfile = (id: MemberId) => {
    const sheet = view.current?.closest<HTMLElement>(".members-sheet");
    listPosition.current = { id, top: sheet?.scrollTop ?? 0 };
    navigation.current = "edit";
    setProfileBusy(false);
    setDirection("forward");
    setEditing({ id, initial: getMemberProfile(authoritativeState, id) });
  };
  const returnToList = () => {
    navigation.current = "list";
    setProfileBusy(false);
    setDirection("back");
    setEditing(null);
  };
  useLayoutEffect(() => {
    const destination = navigation.current;
    navigation.current = null;
    if (!destination) return;
    const sheet = view.current?.closest<HTMLElement>(".members-sheet");
    if (!sheet || sheet.dataset.closing === "true") return;
    if (destination === "edit") {
      sheet.scrollTo({ top: 0, behavior: "instant" });
      const title = sheet.querySelector<HTMLElement>(".sheet-header h2");
      if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
      return;
    }
    const previous = listPosition.current;
    if (!previous) return;
    sheet.scrollTo({ top: previous.top, behavior: "instant" });
    const button = editButtons.current.get(previous.id);
    if (!button) return;
    // Restore the list's position, then account for changed names or viewport height.
    const bounds = sheet.getBoundingClientRect();
    const row = (button.closest(".member-choice-row") ?? button).getBoundingClientRect();
    const chrome = window.matchMedia("(max-width: 799px)").matches ? sheet.querySelector<HTMLElement>(".sheet-chrome") : null;
    const top = (chrome?.getBoundingClientRect().bottom ?? bounds.top + sheet.clientTop) + 12;
    const bottom = bounds.top + sheet.clientTop + sheet.clientHeight - 12;
    if (row.top < top) sheet.scrollTop += row.top - top;
    else if (row.bottom > bottom) sheet.scrollTop += row.bottom - bottom;
    button.focus({ preventScroll: true });
  }, [editing]);
  return <Sheet title={editing ? "编辑资料" : "选择角色"} onClose={onClose} onBack={editing ? returnToList : undefined} backLabel="返回角色列表" backDisabled={profileBusy} className="members-sheet">
    <div ref={view} key={editing ? `edit-${editing.id}` : "list"} className={styles.view} data-member-view={editing ? "edit" : "list"} data-direction={direction ?? undefined}>
    {editing ? <ProfileForm key={editing.id} memberId={editing.id} initial={editing.initial} latest={getMemberProfile(authoritativeState, editing.id)} busy={profileBusy} onBusyChange={setProfileBusy} onBack={returnToList} onSave={onSave} /> : <div className="member-list">{MEMBERS.map(({ id }) => {
      const profile = getMemberProfile(state, id);
      return <div className={`member-choice-row${member === id ? " selected" : ""}`} key={id}><button className="member-option" aria-label={`选择 ${profile.name}`} aria-pressed={member === id} onClick={() => onChoose(id)}><MemberAvatar profile={profile} /><strong>{profile.name}</strong>{member === id ? <Check size={18} /> : <ArrowRight size={16} />}</button><button ref={node => { if (node) editButtons.current.set(id, node); else editButtons.current.delete(id); }} className="icon-button member-edit" data-member-id={id} aria-label={`编辑 ${profile.name} 的昵称和头像`} onClick={() => editProfile(id)}><Pencil size={16} /></button></div>;
    })}</div>}
    </div>
  </Sheet>;
}
