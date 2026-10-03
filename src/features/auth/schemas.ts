import { z } from "zod";

export const signInSchema = z.object({
  email: z.email("Enter a valid email address.").max(254),
  // No length rules on sign-in: Supabase Auth owns password policy.
  password: z.string().min(1, "Enter your password.").max(256),
});

export type SignInInput = z.infer<typeof signInSchema>;

export const setPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Use at least 8 characters.")
      .max(72, "Use 72 characters or fewer."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match." });

export const SETUP_LINK_TYPES = ["recovery", "invite"] as const;
