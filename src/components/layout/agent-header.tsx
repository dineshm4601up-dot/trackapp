import Link from "next/link";

import { Brand } from "@/components/layout/brand";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function AgentHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <Brand href="/agent" />
      <Link
        href="/agent/profile"
        aria-label="Profile"
        className="flex size-11 items-center justify-center rounded-full"
      >
        <Avatar>
          <AvatarFallback>AG</AvatarFallback>
        </Avatar>
      </Link>
    </header>
  );
}
