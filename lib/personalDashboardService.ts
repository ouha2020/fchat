"use client";

import type { LocalSession } from "@/lib/authLocal";
import { getSupabase } from "@/lib/supabaseClient";
import type {
  PersonalDashboard,
  PersonalDashboardProfile,
} from "@/types/personalDashboard";

export async function getPersonalDashboard(
  session: LocalSession,
  todayStart: Date,
  todayEnd: Date,
  now: Date,
): Promise<PersonalDashboard> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("get_personal_dashboard_for_member", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_today_start: todayStart.toISOString(),
    p_today_end: todayEnd.toISOString(),
    p_now: now.toISOString(),
  });
  if (error) throw error;
  return normalizeDashboard(data, session);
}

function normalizeDashboard(
  data: unknown,
  session: LocalSession,
): PersonalDashboard {
  const raw =
    data && typeof data === "object"
      ? (data as Partial<PersonalDashboard>)
      : {};
  const fallbackProfile: PersonalDashboardProfile = {
    member_id: session.member_id,
    nickname: session.nickname,
    role: session.role,
    is_admin: session.is_admin,
    family_id: session.family_id,
    family_name: session.family_name,
  };

  return {
    profile: raw.profile ?? fallbackProfile,
    today_assigned: Array.isArray(raw.today_assigned) ? raw.today_assigned : [],
    upcoming: Array.isArray(raw.upcoming) ? raw.upcoming : [],
    created_by_me: Array.isArray(raw.created_by_me) ? raw.created_by_me : [],
    recent_done: Array.isArray(raw.recent_done) ? raw.recent_done : [],
  };
}
