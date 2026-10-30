"use client";
import { useState } from "react";
import type { MemberProfile } from "@/lib/member-profiles";

export function MemberAvatar({ profile, small = false, large = false }: { profile: MemberProfile; small?: boolean; large?: boolean }) {
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const avatar = failedAvatar === profile.avatar ? "" : profile.avatar;
  return <span role="img" aria-label={profile.name} title={profile.name} className={`avatar${small ? " avatar-small" : ""}${large ? " avatar-large" : ""}${profile.avatar ? " avatar-custom" : ""}`}>
    {avatar.startsWith("data:image/")
      ? <img src={avatar} alt="" width={128} height={128} decoding="async" onError={() => setFailedAvatar(avatar)} />
      : avatar || Array.from(profile.name)[0]}
  </span>;
}
