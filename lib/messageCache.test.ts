import { describe, expect, it } from "vitest";

import {
  compareCreatedAtAsc,
  compareUpdatedCursorAsc,
  cursorFromMessages,
  seqFromMessages,
} from "@/lib/messageCache";
import { makeMessage } from "@/tests/helpers/messages";

describe("compareCreatedAtAsc", () => {
  it("orders by created_at with id as tiebreaker", () => {
    const early = makeMessage({ id: "b", created_at: "2026-07-01T01:00:00.000Z" });
    const late = makeMessage({ id: "a", created_at: "2026-07-01T02:00:00.000Z" });
    const tie = makeMessage({ id: "a", created_at: "2026-07-01T01:00:00.000Z" });
    expect(compareCreatedAtAsc(early, late)).toBeLessThan(0);
    expect(compareCreatedAtAsc(late, early)).toBeGreaterThan(0);
    expect(compareCreatedAtAsc(tie, early)).toBeLessThan(0);
  });
});

describe("compareUpdatedCursorAsc", () => {
  it("orders by updated_at, not created_at", () => {
    const editedOld = makeMessage({
      id: "old",
      created_at: "2026-07-01T01:00:00.000Z",
      updated_at: "2026-07-01T05:00:00.000Z",
    });
    const newer = makeMessage({
      id: "new",
      created_at: "2026-07-01T02:00:00.000Z",
      updated_at: "2026-07-01T02:00:00.000Z",
    });
    expect(compareUpdatedCursorAsc(newer, editedOld)).toBeLessThan(0);
  });

  it("falls back to deleted_at when updated_at is missing on a raw row", () => {
    const raw = makeMessage({
      id: "raw",
      created_at: "2026-07-01T01:00:00.000Z",
      deleted_at: "2026-07-01T06:00:00.000Z",
    });
    // Simulate a DB row that predates the updated_at column.
    (raw as { updated_at?: string }).updated_at = undefined;
    const other = makeMessage({
      id: "other",
      created_at: "2026-07-01T05:00:00.000Z",
      updated_at: "2026-07-01T05:00:00.000Z",
    });
    expect(compareUpdatedCursorAsc(other, raw)).toBeLessThan(0);
  });
});

describe("cursorFromMessages", () => {
  it("returns the (updated_at, id) of the most recently updated row", () => {
    const a = makeMessage({ id: "a", updated_at: "2026-07-01T01:00:00.000Z" });
    const b = makeMessage({ id: "b", updated_at: "2026-07-01T03:00:00.000Z" });
    const c = makeMessage({ id: "c", updated_at: "2026-07-01T02:00:00.000Z" });
    expect(cursorFromMessages([a, b, c])).toEqual({
      cursorUpdatedAt: "2026-07-01T03:00:00.000Z",
      cursorId: "b",
    });
  });

  it("returns nulls for an empty list", () => {
    expect(cursorFromMessages([])).toEqual({
      cursorUpdatedAt: null,
      cursorId: null,
    });
  });
});

describe("seqFromMessages", () => {
  it("returns the max family_seq, ignoring nulls", () => {
    const rows = [
      makeMessage({ id: "a", family_seq: 3 }),
      makeMessage({ id: "b", family_seq: null }),
      makeMessage({ id: "c", family_seq: 7 }),
    ];
    expect(seqFromMessages(rows)).toBe(7);
  });

  it("parses bigint seqs that arrive as strings from PostgREST", () => {
    const rows = [
      makeMessage({ id: "a", family_seq: "12" as unknown as number }),
      makeMessage({ id: "b", family_seq: 9 }),
    ];
    expect(seqFromMessages(rows)).toBe(12);
  });

  it("returns null when no row carries a seq", () => {
    expect(seqFromMessages([makeMessage({ id: "a" })])).toBeNull();
    expect(seqFromMessages([])).toBeNull();
  });
});
