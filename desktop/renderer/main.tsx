import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/page";
import { AppModel } from "./app/models/app";
import { PluginWindow } from './plugins/window';
import "./app/styles.css";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <section className="startup-screen">
          <div className="startup-content">
            <p role="alert">页面加载未完成，请重新加载。</p>
            <button className="secondary" onClick={() => location.reload()}>
              重新加载
            </button>
          </div>
        </section>
      );
    return this.props.children;
  }
}
const model = window.beingsPluginWindow ? undefined : new AppModel(window.beings);
const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <ErrorBoundary>
      {window.beingsPluginWindow ? <PluginWindow api={window.beingsPluginWindow} /> : <App model={model!} />}
    </ErrorBoundary>
  </StrictMode>,
);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
