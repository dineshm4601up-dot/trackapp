import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { Profile } from "@/lib/auth/profile";

function initialsFor(profile: Pick<Profile, "full_name" | "email">) {
  const source = profile.full_name?.trim() || profile.email || "?";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function UserAvatar({ profile }: { profile: Pick<Profile, "full_name" | "email"> }) {
  return (
    <Avatar>
      <AvatarFallback>{initialsFor(profile)}</AvatarFallback>
    </Avatar>
  );
}
