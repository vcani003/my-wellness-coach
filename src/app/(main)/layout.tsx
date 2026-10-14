/**
 * Main screen layout (frontend.md §1): loads who you are, the kitchen and your latest saved chat on
 * the server, then hands over to the client app. It's a layout, so it stays mounted while you move
 * between `/` and `/recipe/[mealId]`: the chat dock never reloads, and the page (null on `/`, the
 * Recipe on `/recipe/…`) renders inside the workspace. Both reads are defensive: if the kitchen fails, the
 * Kitchen widget shows its own error state with Retry; if the chat fails, the chat loads it
 * itself (with "Try again") instead of the page failing (0018). It also reads which of your
 * allergies or diets someone else added and you haven't confirmed (AI7), for the home banner;
 * if that fails, there's simply no banner.
 */
import { Suspense, type ReactNode } from "react";
import type { ChatHistoryPage } from "@/contracts/chat-history";
import type { KitchenState } from "@/contracts/kitchen-state";
import { listChatHistory } from "@/domains/chat/queries";
import { getKitchenState } from "@/domains/kitchen/queries";
import { getSettingsView } from "@/server/account/settings";
import { getScope, getSession } from "@/server/session";
import { KitchenApp } from "@/ui/app/KitchenApp";
import { AppLoading, NoSession } from "@/ui/app/StatusScreens";
import { pendingConfirms, type PendingConfirm } from "@/ui/settings/model";

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<AppLoading />}>
      <Main>{children}</Main>
    </Suspense>
  );
}

async function Main({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) return <NoSession />;
  let state: KitchenState | null = null;
  let history: ChatHistoryPage | null = null;
  let pending: PendingConfirm[] = [];
  try {
    const ctx = await getScope(session.kitchenId);
    if (ctx) {
      const [kitchen, chat, profile] = await Promise.allSettled([
        getKitchenState(ctx.db, ctx.scope),
        listChatHistory(ctx.db, ctx.scope),
        getSettingsView(ctx.db, session.userId),
      ]);
      if (kitchen.status === "fulfilled") state = kitchen.value;
      else console.error("page: couldn't load the kitchen; the widget will retry", { error: kitchen.reason });
      if (chat.status === "fulfilled") history = chat.value;
      else console.error("page: couldn't load the chat; the dock will retry", { error: chat.reason });
      if (profile.status === "fulfilled") pending = pendingConfirms(profile.value);
      else console.error("page: couldn't check for allergies to confirm; no banner", { error: profile.reason });
    }
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
      initialHistory={history}
      initialPendingConfirm={pending}
    >
      {children}
    </KitchenApp>
  );
}
