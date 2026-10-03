import type { Metadata } from "next";

import { UserAvatar } from "@/components/layout/user-avatar";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { NotificationPreferencesForm } from "@/features/notifications/components/preferences-form";
import { getMyPreferences } from "@/features/notifications/queries";
import { getEmailProvider } from "@/lib/communication/providers";
import { requireAgent } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Profile" };

export default async function AgentProfilePage() {
  const { user, profile } = await requireAgent();
  const preferences = await getMyPreferences(user.id);

  const details = [
    { label: "Email", value: profile.email },
    { label: "Phone", value: profile.phone },
  ];

  return (
    <>
      <PageHeader title="Profile" />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <UserAvatar profile={profile} />
            <div className="min-w-0">
              <p className="truncate font-medium">{profile.full_name ?? "Agent"}</p>
              <Badge variant="secondary">{profile.role}</Badge>
            </div>
          </div>
          <dl className="space-y-2 text-sm">
            {details.map(({ label, value }) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="truncate">{value ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <NotificationPreferencesForm initial={preferences} emailAvailable={getEmailProvider().enabled} />
      <SignOutButton className="w-full" />
    </>
  );
}
