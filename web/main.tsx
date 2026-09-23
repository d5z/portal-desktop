import { createRoot } from "react-dom/client";
import { WebApp } from "./page";
import "../desktop/renderer/app/styles.css";
import "./styles.css";
import { InstallController } from "./install";

const installation = new InstallController(window);
installation.start();
createRoot(document.getElementById("root")!).render(
  <WebApp installation={installation} />,
);
