import { useEffect, useState } from "react";
import { ChatState, type ChatRuntime, type RuntimeOptions } from "../models/chat";
import { createChatRuntime } from "../services/runtime";
import { createChatBridge, type ChatBridge } from "../services/bridge";

interface ChatSession {
  state: ChatState;
  runtime: ChatRuntime;
  bridge: ChatBridge;
}

/** Each mount owns its requests, subscriptions, and stream recovery timers. */
export function useChatSession(connection?: RuntimeOptions['connection']) {
  const [session, setSession] = useState<ChatSession>();
  useEffect(() => {
    const state = new ChatState();
    const bridge = createChatBridge(state);
    const runtime = createChatRuntime(state, {
      connection,
      onSbs: bridge.onSbs,
      onSceneActivity: activity => bridge.send({ type: "beings:scene-activity", activity }),
      onConnection: (value) =>
        bridge.send({ type: "beings:connection", state: value }),
      beforeSend: bridge.beforeSend,
    });
    setSession({ state, runtime, bridge });
    return () => {
      bridge.dispose();
      runtime.dispose();
    };
  }, [connection]);
  return session;
}
