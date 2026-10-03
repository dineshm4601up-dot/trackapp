"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveNotificationPreferences } from "@/features/notifications/actions";
import { PREFERENCE_FIELDS } from "@/features/notifications/constants";
import type { Preferences } from "@/features/notifications/queries";
import { isNetworkError, NETWORK_ERROR_MESSAGE } from "@/lib/network";

/** The user's own notification preferences. Assignments and cancellations always reach the app. */
export function NotificationPreferencesForm({ initial, emailAvailable }: { initial: Preferences; emailAvailable: boolean }) {
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof Preferences) => (checked: boolean) => setValues((v) => ({ ...v, [key]: checked }));

  function save() {
    startTransition(async () => {
      try {
        const result = await saveNotificationPreferences(values);
        if (result.ok) toast.success(result.message ?? "Saved.");
        else toast.error(result.message);
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        toast.error(NETWORK_ERROR_MESSAGE);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification preferences</CardTitle>
        <CardDescription>
          Choose what you are told about. New, reassigned and cancelled tasks always appear in the app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Row
          id="pref-email_enabled"
          label="E-mail notifications"
          hint={emailAvailable ? "Also send important notifications to your e-mail address." : "E-mail is not set up on this system yet; your choice is saved for when it is."}
          checked={values.email_enabled}
          onChange={set("email_enabled")}
        />
        <div className="space-y-4 border-t pt-4">
          {PREFERENCE_FIELDS.map((field) => (
            <Row
              key={field.key}
              id={`pref-${field.key}`}
              label={field.label}
              hint={field.hint}
              checked={values[field.key]}
              onChange={set(field.key)}
            />
          ))}
        </div>
        <Button onClick={save} disabled={pending}>
          {pending && <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden />}
          {pending ? "Saving…" : "Save preferences"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Row({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-hint`} />
    </div>
  );
}
