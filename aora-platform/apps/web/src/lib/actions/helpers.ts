import "server-only";

import { ZodError } from "zod";

import type { ActionState } from "@/lib/domain/action-state";

export function fieldErrors(error: ZodError): Record<string, string[]> {
  const flattened = error.flatten().fieldErrors;
  const result: Record<string, string[]> = {};

  Object.entries(flattened).forEach(([field, messages]) => {
    if (messages?.length) {
      result[field] = messages;
    }
  });

  return result;
}

export function actionFailure(error: unknown): ActionState {
  if (error instanceof ZodError) {
    return {
      status: "error",
      message: "Please review the highlighted fields.",
      fieldErrors: fieldErrors(error),
    };
  }

  return {
    status: "error",
    message:
      error instanceof Error
        ? error.message
        : "The action could not be completed.",
  };
}

export function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
