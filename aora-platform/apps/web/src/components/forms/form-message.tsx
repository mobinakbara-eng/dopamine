import type { ActionState } from "@/lib/domain/action-state";

interface FormMessageProps {
  state: ActionState;
}

export function FormMessage({ state }: FormMessageProps) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  return (
    <p
      aria-live="polite"
      className="form-message"
      data-status={state.status}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}
