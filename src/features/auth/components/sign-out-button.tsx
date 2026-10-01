"use client";

import { useTransition } from "react";
import { Loader2, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { signOut } from "@/features/auth/actions";

function useSignOut() {
  const [pending, startTransition] = useTransition();
  return { pending, run: () => startTransition(() => signOut()) };
}

export function SignOutButton({ className }: { className?: string }) {
  const { pending, run } = useSignOut();
  return (
    <Button variant="outline" size="xl" className={className} onClick={run} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}

export function SignOutMenuItem() {
  const { pending, run } = useSignOut();
  return (
    <DropdownMenuItem
      disabled={pending}
      onSelect={(event) => {
        event.preventDefault(); // keep the menu open to show progress
        run();
      }}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
      {pending ? "Signing out…" : "Sign out"}
    </DropdownMenuItem>
  );
}
