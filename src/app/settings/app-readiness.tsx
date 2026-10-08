import { connection } from "next/server";
import { ReadinessView } from "@/components/settings/readiness-view";
import { getReadiness } from "@/lib/server/apps";

/** Web wrapper: reads readiness on the server (memoized) and renders the shared view. */
export async function AppReadinessList() {
  await connection();
  const result = await getReadiness();
  return result ? <ReadinessView result={result} /> : null;
}
