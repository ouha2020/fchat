import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/chat", "/members", "/settings"];
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const TOKEN_RE =
  /^([0-9a-f]{48}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12})$/i;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const memberId = request.cookies.get("family_chat_member_id")?.value;
  const memberToken = request.cookies.get("family_chat_member_token")?.value;
  if (memberId && memberToken && UUID_RE.test(memberId) && TOKEN_RE.test(memberToken)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/chat/:path*", "/members/:path*", "/settings/:path*"],
};
