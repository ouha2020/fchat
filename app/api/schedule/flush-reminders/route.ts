import { NextResponse } from "next/server";

import { flushDueScheduleReminders } from "@/lib/scheduleReminderServer";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleFlushReminders(request);
}

export async function GET(request: Request) {
  return handleFlushReminders(request);
}

async function handleFlushReminders(request: Request) {
  const secret = process.env.SCHEDULE_REMINDER_SECRET ?? process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "schedule_reminder_not_configured" },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  try {
    const result = await flushDueScheduleReminders();
    return NextResponse.json(result);
  } catch (error) {
    console.warn(
      "[schedule flush-reminders]",
      error instanceof Error ? error.message : "schedule_reminder_failed",
    );
    return NextResponse.json(
      { ok: false, error: "schedule_reminder_failed" },
      { status: 500 },
    );
  }
}
