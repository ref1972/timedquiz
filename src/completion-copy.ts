import { getAppSetting, setAppSetting } from "./db.ts";

export interface CompletionCopy {
  title: string;
  message: string;
  pendingMessage: string;
  resultsButtonLabel: string;
  chooserButtonLabel: string;
}

export const defaultCompletionCopy: CompletionCopy = {
  title: "Thank you!",
  message: "Your responses have been saved.",
  pendingMessage: "Your score and answers will be available after every response has been graded.",
  resultsButtonLabel: "View my score and answers",
  chooserButtonLabel: "Choose another game",
};

const keys: Record<keyof CompletionCopy, string> = {
  title: "completion_title",
  message: "completion_message",
  pendingMessage: "completion_pending_message",
  resultsButtonLabel: "completion_results_button_label",
  chooserButtonLabel: "completion_chooser_button_label",
};

export function getCompletionCopy(): CompletionCopy {
  return Object.fromEntries(Object.entries(keys).map(([field, key]) => [field, getAppSetting(key) ?? defaultCompletionCopy[field as keyof CompletionCopy]])) as unknown as CompletionCopy;
}

export function setCompletionCopy(copy: CompletionCopy): void {
  for (const [field, key] of Object.entries(keys)) setAppSetting(key, copy[field as keyof CompletionCopy]);
}
