/** The dev "acting as" switch can never be on in production (milestone 2). */
import { describe, expect, it } from "vitest";
import { assertDevModeSafe, devActingAsEnabled } from "@/server/dev-mode";

describe("dev acting-as switch", () => {
  it("is on in development and tests unless turned off", () => {
    expect(devActingAsEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(devActingAsEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(devActingAsEnabled({ NODE_ENV: "development", DEV_ACTING_AS: "off" })).toBe(false);
  });

  it("is always off in production, whatever the setting", () => {
    expect(devActingAsEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(devActingAsEnabled({ NODE_ENV: "production", DEV_ACTING_AS: "on" })).toBe(false);
  });

  it("a production server refuses to start if someone tries to enable it", () => {
    expect(() => assertDevModeSafe({ NODE_ENV: "production", DEV_ACTING_AS: "on" })).toThrow(/Refusing to start/);
    expect(() => assertDevModeSafe({ NODE_ENV: "production" })).not.toThrow();
    expect(() => assertDevModeSafe({ NODE_ENV: "production", DEV_ACTING_AS: "off" })).not.toThrow();
    expect(() => assertDevModeSafe({ NODE_ENV: "development", DEV_ACTING_AS: "on" })).not.toThrow();
  });
});
