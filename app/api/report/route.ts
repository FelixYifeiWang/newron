import { env } from "@/lib/runtime-env";
import {
  sanitizeUserReport,
  storeUserReport,
} from "@/lib/setup-diagnostics.mjs";
import { checkOrigin, HttpError, fail, userRequired } from "@/lib/server";
// Report a problem (app/report): a signed-in person sends what went wrong with Nox or setup.
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await userRequired();
    const raw = await request.text();
    if (raw.length > 24000) throw new HttpError(413, "Report too large.");
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "Send valid JSON.");
    }
    let report;
    try {
      report = sanitizeUserReport(body);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : "Invalid report.",
      );
    }
    if (
      !(await storeUserReport(env.DB, user.userId, crypto.randomUUID(), report))
    )
      throw new HttpError(
        429,
        "You've sent several reports today. Try again tomorrow.",
      );
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
