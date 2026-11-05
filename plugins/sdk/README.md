# Town Plugin SDK package 1.6

TypeScript types for the host-injected `window.grove`. This package has no runtime and is not published to npm.

From your plugin project, install this directory or an `npm pack` tarball:

```sh
npm install --save-dev /path/to/Town-Client/plugins/sdk
```

For standalone CI, vendor a fixed copy inside the plugin repository and depend on `file:vendor/grove-plugin-sdk`, as [Starmap](https://github.com/chunqing-liu/starmap) does. Commit the lockfile.

All APIs, permissions, minimum versions, examples and publishing instructions are maintained in the [developer guide](../../DEVELOPER-API-SDK.md#grove-插件-sdk). The type contract is [index.d.ts](index.d.ts).

SDK 1.4 adds opt-in plugin agent contracts and Being-scoped records through `grove.agent`. Plugin behavior is discovered through the existing authenticated Portal `@plugins` client command. It does not modify Being prompts, normal chat messages, or the core agent loop. See [agent.d.ts](agent.d.ts) and the developer guide.

SDK 1.5 adds clickable HTTP(S) links and `grove.ui.openExternal()` (`external.open` capability), plus unrestricted HTTP(S) API access (`network` capability). Use browser `fetch` for CORS-enabled endpoints or `grove.network.fetch()` for host requests without browser CORS restrictions. No domain allowlist is required.

Package 1.6 adds the DSH compatibility type entry [dsh.d.ts](dsh.d.ts), also exported from the package root. The Grove runtime remains `sdkVersion: '1.5.0'`; these new services live on a DSH Cordis Context, **not** `window.grove`.

The DSH subset includes local commands, sidebar tabs, default shortcuts, Town scene navigation, settings navigation, host-selected OpenAI-compatible streaming text/image generation, image storage and credential resolution. Installed service providers take precedence. See [DSH compatibility](../DSH-COMPATIBILITY.md) and [dsh-pet support and limitations](../../docs/dsh-pet-compatibility.md) before depending on an API. The host types describe Town's supported subset; continue using the upstream DSH packages for Cordis Context augmentation.

Image references use Harness's `sha256:<64 lowercase hex>` identifier. Pass this ID unchanged to `attachments.imageHostPath`; the host resolves the local object path. The original dsh-pet attachment route is tested both immediately after upload and after a cold host restart.

Desktop helpers belong to plugins. Town implements the shared listener and authentication contracts (`webServer.host/protocol/port/getOrigin`, `connection.authenticatedUrl/requestRejection`) and Cordis disposal. A plugin may launch its own Electron or other native process using Node. Town never imports a specific plugin's internal main/preload modules, injects its private globals/environment variables, or implements its private HTTP routes. Helper runtime downloads, native IPC, OS permissions and process shutdown belong to that plugin. A helper that hardcodes a different application's URL scheme must be updated by its author to use the authenticated host URL.

Shortcut defaults are preserved. Collisions with Town's command palette or another plugin are reported in the catalog and management page; conflicted combinations are not dispatched or silently remapped. Theme selection only uses the public theme service and Town's own storage; plugin-owned startup state remains plugin-owned.

DSH surface layout: plugin settings stay inside Client Settings → Plugins, with official plugins first. Original settings expand within the list and share the client settings scroll area; Kit configuration links lead to this same settings category. There is no separate DeepSeek model configuration page. Right sidebar content receives the remaining height below the host toolbar and compatibility notice. A plugin may use `height: 100%; min-height: 0` and its own message-list scrolling; `rightbar` owner props report the measured content width as it changes. Fullscreen/restore keeps the mounted component and its draft state. Town's switch styling excludes plugin settings, sidebars, main panels and overlays so ordinary plugin checkboxes retain their own appearance. These are host layout conventions, not new plugin-specific APIs.

Default model selection checks the current Being model first. The present Being contract cannot perform stateless plugin generation, so Town falls back to the existing local subagent model. Chat Completions configurations are supported; unsupported protocols, disabled/missing configuration and OAuth-only credentials report an explicit reason. The renderer never receives the API key. Speech transcription remains an unavailable service placeholder in the desktop product. The legacy service-config types are retained for isolated host integrations; they do not expose another configuration UI.
