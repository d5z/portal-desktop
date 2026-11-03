import './document.scss';
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatApp } from "./page";
import { UIExamplesPage } from "./ui-examples-page";
const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    {new URLSearchParams(location.search).get("ui_examples") === "1" ? <UIExamplesPage /> : <ChatApp />}
  </StrictMode>,
);
