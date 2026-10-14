/** UI translations stay in step with the backend's English message templates (0015). */
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/messages/en.json";
import { msg } from "@/shared/messages";

describe("en.json msg.* mirrors src/shared/messages.ts", () => {
  it.each(Object.entries(en.msg))("%s", (code, text) => {
    expect(msg(code).text).toBe(text);
  });
});
