(() => {
  "use strict";

  const PROJECT_URL = "https://xqgkawskftzurbujrpex.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_DA_L16_qVM9opFpQcYz16g_kTBwFpKZ";
  const ACCESS_URL = `${PROJECT_URL}/functions/v1/aora-access`;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const match = url.match(/\/rest\/v1\/rpc\/(demo_directory|demo_login|demo_logout)(?:\?|$)/);
    if (!match) return nativeFetch(input, init);

    let payload = {};
    try {
      payload = typeof init.body === "string" ? JSON.parse(init.body) : (init.body || {});
    } catch {
      payload = {};
    }

    const actionBody = match[1] === "demo_directory"
      ? { action: "directory", workspaceSlug: payload.p_workspace_slug }
      : match[1] === "demo_login"
        ? {
            action: "login",
            workspaceSlug: payload.p_workspace_slug,
            role: payload.p_role,
            subjectId: payload.p_subject_id,
            pin: payload.p_pin,
          }
        : { action: "logout", token: payload.p_token };

    return nativeFetch(ACCESS_URL, {
      method: "POST",
      headers: {
        apikey: PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(actionBody),
      credentials: "omit",
      cache: "no-store",
    });
  };
})();
