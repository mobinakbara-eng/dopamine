"use client";

import { useFormStatus } from "react-dom";

interface SubmitButtonProps {
  idleLabel: string;
  pendingLabel: string;
  disabled?: boolean;
}

export function SubmitButton({
  idleLabel,
  pendingLabel,
  disabled = false,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      className="button button--primary"
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
