import { createRoot } from "react-dom/client";
import { ChatApp } from "../desktop/renderer/chat/page";
import { readConnection, deploymentConnection } from "./connection";
import "../desktop/renderer/chat/document.scss";
import "highlight.js/styles/github-dark.min.css";
import "./chat.scss";

const root = createRoot(document.getElementById("root")!);
const saved = readConnection();
if (saved) {
  const connection = await deploymentConnection(saved);
  root.render(
    <ChatApp connection={connection} keywordNavigation={false} mobileWeb />,
  );
} else root.render(<p role="status">请先在网页版中连接你的 Being。</p>);
