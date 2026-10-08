import { Check, CircleAlert, Clock3 } from "lucide-react";
import { CHAT_SCENE_ACTIVITY_LABELS, type ChatSceneActivity } from "../../../shared/types";
import { ActivitySpinner } from "../../shared/components/activity-spinner";
import { ActivityStopped } from "../../shared/components/activity-stopped";

// Keep queued, in-progress and completed work visibly distinct. The four
// in-progress phases share a mark, with their exact phase in the description.
const visuals: Record<ChatSceneActivity, "queued" | "pending" | "done" | "stopped" | "error"> = {
  queued: "queued", thinking: "pending", replying: "pending",
  working: "pending", waiting: "pending",
  done: "done", error: "error", stopped: "stopped",
};
const icons = { queued: Clock3, done: Check, error: CircleAlert };

export function ChatSceneStatus({ status, id }: { status?: ChatSceneActivity; id: string }) {
  // Reserve the same quiet slot after a reply is read, so the title's
  // truncation boundary does not jump when the activity mark disappears.
  if (!status) return <span className="chat-session-activity" aria-hidden="true" />;
  const visual = visuals[status];
  const label = CHAT_SCENE_ACTIVITY_LABELS[status];
  const Icon = visual === "pending" || visual === "stopped" ? null : icons[visual];
  return <span id={id} className="chat-session-status chat-session-activity" data-status={status}
    role="img" aria-label={label} data-sidebar-hint={label}>
    {visual === "stopped" ? <ActivityStopped /> : Icon ? <Icon className={`chat-session-status-icon${visual === "queued" ? " activity-queued" : ""}`} aria-hidden="true" /> : <ActivitySpinner />}
  </span>;
}
