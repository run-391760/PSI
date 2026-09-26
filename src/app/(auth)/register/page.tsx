import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Create account" };

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await currentUser()) redirect("/dashboard");
  return (
    <>
      <h1 className="text-[22px] font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 mb-6 text-[13.5px] text-text-2">Start with demo data instantly; connect live data any time.</p>
      <AuthForm mode="register" inviteRequired={process.env.NODE_ENV === "production" && process.env.ALLOW_SIGNUPS !== "true"} />
    </>
  );
}
