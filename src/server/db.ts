/**
 * The app server's database handle: Neon when DATABASE_URL is set, otherwise the local embedded
 * PGlite (backend-data.md §2, §10). One handle per server process; see `getDb` in `@/db/client`.
 */
import "server-only";
export { getDb } from "@/db/client";
