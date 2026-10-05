import { test, expect, session, otherMemberId } from "./fixtures";

const replacement = { ...session, member_id: otherMemberId, member_token: "replacement-synthetic-token", nickname: "新会话成员" };

for (const path of ["/", "/join", "/members", "/settings", "/album", "/me", "/schedule"]) {
  test(`a delayed restore on ${path} cannot restore or erase a replacement identity`, async ({ page, context, app }) => {
    const stale = app.hold("validate_member", { data: [session] });
    await page.goto(path); await stale.arrived;
    // A different tab changes the real shared storage while the first request is outstanding.
    const other = await context.newPage(); await other.goto("/fixture-cache.html");
    app.activeSession = replacement;
    await other.evaluate((local) => localStorage.setItem("family-chat:session", JSON.stringify(local)), replacement);
    stale.release(); await stale.finished;
    await expect.poll(() => other.evaluate(() => JSON.parse(localStorage.getItem("family-chat:session") ?? "null")?.member_id))
      .toBe(replacement.member_id);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("family-chat:session") ?? "null")?.member_id)).toBe(replacement.member_id);
  });
}

test("a failed join restore preserves membership for a later retry", async ({ page, app }) => {
  const stale = app.hold("validate_member", { data: { message: "offline" }, status: 500 });
  await page.goto("/join"); await stale.arrived; stale.release(); await stale.finished;
  await expect(page.getByRole("heading", { name: "加入家庭" })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("family-chat:session") ?? "null")?.member_id)).toBe(session.member_id);
});

test("opened member content is retired when another tab signs out", async ({ page, app, context }) => {
  await page.goto("/members"); await expect(page.getByText("回归家人", { exact: true })).toBeVisible();
  const expiry = app.hold("validate_member", { data: [] });
  const other = await context.newPage(); await other.goto("/chat"); await expiry.arrived;
  expiry.release(); await expiry.finished;
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("回归家人", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("family-chat:session"))).toBeNull();
});
