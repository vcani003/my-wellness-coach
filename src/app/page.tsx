/**
 * Main screen (frontend.md §1): loads who you are and the kitchen on the server, then hands
 * over to the client app. The kitchen read is defensive: if it fails, the Kitchen widget shows
 * its own error state with Retry instead of the page failing (0018).
 */
import { Suspense } from "react";
import type { KitchenState } from "@/contracts/kitchen-state";
import { getKitchenState } from "@/domains/kitchen/queries";
import { getScope, getSession } from "@/server/session";
import { KitchenApp } from "@/ui/app/KitchenApp";
import { AppLoading, NoSession } from "@/ui/app/StatusScreens";

export default function Home() {
  return (
    <Suspense fallback={<AppLoading />}>
      <Main />
    </Suspense>
  );
}

async function Main() {
  const session = await getSession();
  if (!session) return <NoSession />;
  let state: KitchenState | null = null;
  try {
    const ctx = await getScope(session.kitchenId);
    if (ctx) state = await getKitchenState(ctx.db, ctx.scope);
  } catch (error) {
    console.error("page: couldn't load the kitchen; the widget will retry", { error });
  }
  return (
    <KitchenApp
      kitchenId={session.kitchenId}
      me={{ id: session.userId, name: session.displayName }}
      members={session.members}
      devActingAs={session.devActingAs}
      initialState={state}
    />
  );
}
