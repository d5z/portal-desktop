# Source provenance

- Model settings self-hosted preset support: aligned with [d5z/loom-local](https://github.com/d5z/loom-local/blob/a18812c35d2e2322f745f841d1d94fdec6015893/loom.html), `main` at `a18812c35d2e2322f745f841d1d94fdec6015893` (checked 2026-09-16). Presets come from the connected Being's `/api/llm/config`; `self-hosted` models appear first and switch directly without an API key form. The PATCH preserves the full model ID and uses the upstream canonical base URL `http://115.190.110.33:7860/v1`. The desktop uses the server's returned config, including rollback, to confirm the current model. This does not start or deploy a local model server.

- Client: https://github.com/baiye0/loom-local, original base commit `5d347107326fd754fafea1c1dc373a42986ff49f`.
- Heart Portal fork: https://github.com/d5z/heart-portal, Git submodule at `heart-portal/`, tracking `codex/portal-desktop-compat` for explicit source updates.
- Upstream Heart Portal: https://github.com/baiye0/heart-portal.
- Pinned compatibility revision: `383d915396aef8f7bc1e91e2127271d704288217` on `codex/portal-desktop-compat`.
- Upstream Portal base: `70191f5` (0.8.2), merged with the existing client compatibility changes. The parent repository's gitlink is the authoritative build revision.

The compatibility branch is based on upstream main. It keeps client-managed
launches in place, publishes connection state on both platforms, and prevents
standalone engine upgrades from bypassing the client transaction. See
`heart-portal/docs/town-client.md`. No separate Portal release is required.
Client packaging compiles the pinned source on the target operating system and
ships the resulting engine inside the same client release.

Clone with `git clone --recurse-submodules`, or initialize an existing clone with
`git submodule update --init --recursive`. After pulling Portal Desktop, run the latter
command again to use its recorded Portal revision. Builds never follow a moving
branch or run `git pull` automatically.

Keep all Portal Desktop compatibility changes on the long-lived
`codex/portal-desktop-compat` branch in the Portal fork. Merge upstream updates
into that branch, verify the client and engine together, and publish the Portal
commit before updating the client gitlink. Do not point the client at a temporary
local branch or directly at upstream main.

To intentionally update Portal: run `git submodule update --remote heart-portal`,
verify the client and engine together, then commit the `heart-portal` gitlink in
Portal Desktop. Retain the original license notices in `heart-portal/LICENSE` and
`resources/HEART-PORTAL-LICENSE`.

The `hardening/` directory contains historical design and verification notes from
the original workspace; they are not a description of the current source layout.
