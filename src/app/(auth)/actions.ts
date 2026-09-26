"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { hash, login, logout, rateLimit, register } from "@/lib/auth";
import { AppError } from "@/lib/domain";

export type AuthState = { error?: string } | undefined;

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(255),
  password: z.string().min(10, "Use at least 10 characters.").max(128),
});

export async function loginAction(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await rateLimit(`login:${hash(parsed.data.email)}`, 10, 900);
    await login(parsed.data.email, parsed.data.password);
  } catch (e) {
    return { error: e instanceof AppError ? e.message : "Sign-in failed. Try again." };
  }
  const next = String(form.get("next") || "/dashboard");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function registerAction(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = credentials.extend({ name: z.string().trim().min(1, "Enter your name.").max(80) }).safeParse({
    email: form.get("email"),
    password: form.get("password"),
    name: form.get("name"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await rateLimit("register:global", 30, 3600);
    await register(parsed.data.email, parsed.data.password, parsed.data.name, String(form.get("invite") || "") || undefined);
  } catch (e) {
    return { error: e instanceof AppError ? e.message : "Sign-up failed. Try again." };
  }
  redirect("/dashboard?welcome=1");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}
