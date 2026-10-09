import { NextResponse, type NextRequest } from "next/server";

/** Site-wide production password (GI_BASIC_AUTH="user:password"); private Server Functions re-check it too. */
export function proxy(request: NextRequest) {
  const expected = process.env.GI_BASIC_AUTH;
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Peakly requires GI_BASIC_AUTH and GI_ENCRYPTION_KEY before production use.", { status: 503 });
    }
    return NextResponse.next();
  }
  if (process.env.NODE_ENV === "production" && !process.env.GI_ENCRYPTION_KEY) {
    return new NextResponse("Peakly requires GI_BASIC_AUTH and GI_ENCRYPTION_KEY before production use.", { status: 503 });
  }
  const header = request.headers.get("authorization");
  let decoded = "";
  try { decoded = header?.startsWith("Basic ") ? atob(header.slice(6)) : ""; } catch { decoded = ""; }
  let diff = decoded.length ^ expected.length;
  for (let i = 0; i < Math.max(decoded.length, expected.length); i++) diff |= (decoded.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  if (diff === 0) return NextResponse.next();
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Growth Insights"' } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
