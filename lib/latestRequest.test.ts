import { describe, expect, it } from "vitest";
import { createLatestRequestGate } from "@/lib/latestRequest";

describe("latest read results", () => {
  it("keeps the new view when the previous view finishes last", async () => {
    const gate = createLatestRequestGate();
    let finishOld!: (value: string) => void;
    let displayed = "";
    const oldIsCurrent = gate.begin();
    const oldRead = new Promise<string>((resolve) => { finishOld = resolve; })
      .then((value) => { if (oldIsCurrent()) displayed = value; });
    const newIsCurrent = gate.begin();
    if (newIsCurrent()) displayed = "new month";
    finishOld("old month");
    await oldRead;
    expect(displayed).toBe("new month");
  });

  it("prevents a closed detail from being reopened by its late response", () => {
    const gate = createLatestRequestGate();
    const detailIsCurrent = gate.begin();
    gate.invalidate();
    expect(detailIsCurrent()).toBe(false);
    expect(gate.begin()()).toBe(true);
  });
});
