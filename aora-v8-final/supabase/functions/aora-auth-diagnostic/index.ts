import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(()=>new Response("Diagnostic endpoint disabled",{
  status:410,
  headers:{
    "content-type":"text/plain; charset=utf-8",
    "cache-control":"no-store",
    "x-content-type-options":"nosniff"
  }
}));
