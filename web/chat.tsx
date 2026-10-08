import { createRoot } from "react-dom/client";
import { ChatApp } from "../desktop/renderer/chat/page";
import { readConnection, deploymentConnection } from "./connection";
import "../desktop/renderer/chat/styles.css";
import "../desktop/renderer/shared/activity.css";
import "../desktop/renderer/shared/model-settings.css";
import "highlight.js/styles/github-dark.min.css";
import "./chat.css";

const root = createRoot(document.getElementById("root")!);
const saved = readConnection();
if (saved) {
  const connection = await deploymentConnection(saved);
  root.render(
    <ChatApp connection={connection} keywordNavigation={false} mobileWeb />,
  );
} else root.render(<p role="status">请先在网页版中连接你的 Being。</p>);
