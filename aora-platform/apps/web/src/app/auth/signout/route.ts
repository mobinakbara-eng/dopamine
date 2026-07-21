import { type NextRequest, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });

  const response = NextResponse.redirect(new URL("/de/login", request.url), {
    status: 303,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
