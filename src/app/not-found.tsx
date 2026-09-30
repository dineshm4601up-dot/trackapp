import Link from "next/link";
import { SearchX } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-4">
      <div className="w-full">
        <EmptyState
          icon={SearchX}
          title="Page not found"
          description="The page you are looking for does not exist or has moved."
          action={
            <Button variant="outline" asChild>
              <Link href="/">Go home</Link>
            </Button>
          }
        />
      </div>
    </main>
  );
}
