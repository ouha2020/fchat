import { describe, expect, it } from "vitest";

import { WEB_PUSH_DELIVERY_OPTIONS } from "@/lib/webPushServer";

describe("web push delivery options", () => {
  it("requests timely Android delivery", () => {
    expect(WEB_PUSH_DELIVERY_OPTIONS).toEqual({
      TTL: 60 * 60,
      urgency: "high",
    });
  });
});
