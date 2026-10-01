import { z } from "zod";

export const signInSchema = z.object({
  email: z.email("Enter a valid email address.").max(254),
  // No length rules on sign-in: Supabase Auth owns password policy.
  password: z.string().min(1, "Enter your password.").max(256),
});

export type SignInInput = z.infer<typeof signInSchema>;
