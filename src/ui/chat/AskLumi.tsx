"use client";
/**
 * A place's shortcut into the chat ("Ideas to use these up", "Get ideas"): it sends a message to
 * Lumi as if you'd typed it, so the reply, receipt and Undo work exactly as in chat. Chat is online
 * only (0044), so `canAsk` is false while offline or while a reply is on its way.
 */
import { createContext, useContext } from "react";

export interface AskLumi {
  /** Sends the text; false if it couldn't be sent (busy or offline). */
  ask(text: string): boolean;
  canAsk: boolean;
}

const Ctx = createContext<AskLumi>({ ask: () => false, canAsk: false });
export const AskLumiProvider = Ctx.Provider;
export const useAskLumi = () => useContext(Ctx);
