import { AdminMobileNav } from "@/components/layout/admin-mobile-nav";
import { Brand } from "@/components/layout/brand";
import { UserAvatar } from "@/components/layout/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SignOutMenuItem } from "@/features/auth/components/sign-out-button";
import type { Profile } from "@/lib/auth/profile";

export function AdminHeader({ profile }: { profile: Profile }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-6">
      <AdminMobileNav />
      <div className="lg:hidden">
        <Brand href="/admin" />
      </div>
      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label="Account menu"
          >
            <UserAvatar profile={profile} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="truncate text-foreground">{profile.full_name ?? "Administrator"}</span>
              <span className="truncate text-xs font-normal">{profile.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <SignOutMenuItem />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
