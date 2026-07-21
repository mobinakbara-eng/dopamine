import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/de";
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = safeNextPath(request.nextUrl.searchParams.get("next"));
  const supabase = await createSupabaseServerClient();
  let errorMessage: string | null = null;

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    errorMessage = error?.message ?? null;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    errorMessage = error?.message ?? null;
  } else {
    errorMessage = "Missing authentication token.";
  }

  if (!errorMessage) {
    const response = NextResponse.redirect(new URL(nextPath, request.url));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  const errorUrl = new URL("/de/login", request.url);
  errorUrl.searchParams.set("error", "link_invalid");
  const response = NextResponse.redirect(errorUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
