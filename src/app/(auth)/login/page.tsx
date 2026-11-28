import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { googleSignInEnabled } from "@/lib/google/signin";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = { google_off: "Google sign-in is not set up on this server yet." };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await currentUser()) redirect("/dashboard");
  const { next, error } = await searchParams;
  const err = typeof error === "string" ? (ERRORS[error] ?? error.slice(0, 300)) : undefined;
  return (
    <>
      <h1 className="text-[22px] font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 mb-6 text-[13.5px] text-text-2">Sign in to your SEO workspace.</p>
      <AuthForm mode="login" next={typeof next === "string" ? next : undefined} google={googleSignInEnabled()} initialError={err} />
    </>
  );
}
