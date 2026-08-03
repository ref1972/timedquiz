import { getAppSetting, setAppSetting } from "./db.ts";

export interface IntroCopy {
  eyebrow: string;
  title: string;
  instructions: string;
  warningHeading: string;
  warningBody: string;
  advancement: string;
  buttonLabel: string;
}

export const defaultIntroCopy: IntroCopy = {
  eyebrow: "Trivia Nationals",
  title: "Pop Culture Bee Preliminary",
  instructions: "You will answer 50 text questions, one at a time. Each question has 25 seconds.",
  warningHeading: "If you leave:",
  warningBody: "the current question expires using the most recent saved draft (blank if none). When you return, you continue with the next question, so walking away costs exactly one question.",
  advancement: "You will not see correctness or a score. Your result determines whether you advance to the LIVE game Saturday.",
  buttonLabel: "I’m ready to begin",
};

const keys: Record<keyof IntroCopy, string> = {
  eyebrow: "intro_eyebrow",
  title: "intro_title",
  instructions: "intro_instructions",
  warningHeading: "intro_warning_heading",
  warningBody: "intro_warning_body",
  advancement: "intro_advancement",
  buttonLabel: "intro_button_label",
};

export function getIntroCopy(): IntroCopy {
  return Object.fromEntries(Object.entries(keys).map(([field, key]) => [field, getAppSetting(key) ?? defaultIntroCopy[field as keyof IntroCopy]])) as unknown as IntroCopy;
}

export function setIntroCopy(copy: IntroCopy): void {
  for (const [field, key] of Object.entries(keys)) setAppSetting(key, copy[field as keyof IntroCopy]);
}
