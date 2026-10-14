import { describe, expect, it } from "vitest";

import { assertDevModeSafe, devActingAsEnabled } from "@/server/dev-mode";

describe("dev acting-as switch", () => {
  it("is on locally only when DEV_ACTING_AS names a user", () => {
    expect(devActingAsEnabled({ NODE_ENV: "development", DEV_ACTING_AS: "demo-vero" })).toBe(true);
    expect(devActingAsEnabled({ NODE_ENV: "test", DEV_ACTING_AS: "tester-1" })).toBe(true);
    expect(devActingAsEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(devActingAsEnabled({ NODE_ENV: "development", DEV_ACTING_AS: " " })).toBe(false);
  });

  it("is never on in production", () => {
    expect(devActingAsEnabled({ NODE_ENV: "production", DEV_ACTING_AS: "demo-vero" })).toBe(false);
  });

  it("refuses to start a production server with it set", () => {
    expect(() => assertDevModeSafe({ NODE_ENV: "production", DEV_ACTING_AS: "demo-vero" })).toThrow(/Refusing to start/);
    expect(() => assertDevModeSafe({ NODE_ENV: "production" })).not.toThrow();
    expect(() => assertDevModeSafe({ NODE_ENV: "development", DEV_ACTING_AS: "demo-vero" })).not.toThrow();
  });
});
