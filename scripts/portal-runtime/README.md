# Bundled task runtimes

`prepare-portal-runtime.mjs` verifies the archives in `lock.json` and assembles
Python, Node, npm and npx at build time. Tasks do not download interpreters.

## Windows AppContainer compatibility

The restricted task environment supplies ordinary Windows paths, `PATHEXT`,
Node's two `--preserve-symlinks` options and a canonical workspace root. It does
not grant access to the workspace's host ancestors or enable networking.

- `windows-sitecustomize.py` is installed as `python/Lib/sitecustomize.py`.
  With the sandbox marker **and an actual AppContainer token**, it handles
  Python's `mkdir(..., 0700)` under the task's temporary directories. It keeps
  CPython's protected SYSTEM/Administrators/OWNER RIGHTS DACL and adds only the
  current package SID. Host Python and other directories retain their normal
  behavior. This works with `-I`; `-S` deliberately disables site customization.
  An intentionally retained private temp directory can keep the completed
  invocation's orphan SID entry; normal `TemporaryDirectory` cleanup removes it.
  The process tree is destroyed for each invocation. The process token is fresh,
  while the workspace capability SID is stable so the cached workspace grant can
  be reused without rewriting ACLs on every call.
- The build adds the already canonical workspace root to npm Arborist's
  realpath cache. Descendants still go through npm's normal filesystem checks;
  paths outside the root remain subject to OS denial. The pinned archive and
  source anchor must be reviewed when upgrading npm.
- `npm_config_install_links=true` installs local file dependencies as copies.
  They are snapshots, not live symlinks. Node's preserved module paths can
  change module identity for linked projects. Neither setting grants new OS
  permissions.
- Windows Node is built from the checksum-locked official source archive with
  the runtime hunk from [libuv#5181](https://github.com/libuv/libuv/pull/5181).
  The pinned Node's libuv 1.52.1 otherwise hangs when creating child stdout/IPC
  pipes inside AppContainer. The patch uses the container's `LOCAL` pipe
  namespace only when its process token is an AppContainer. Host behavior is
  unchanged. The exact upstream commit is recorded in `lock.json`; the Node
  archive's license remains bundled. Remove this backport once an official
  Node release incorporates the fix and passes the native suite.

The runtime ID includes the Python adapter and layout revision. Bump the layout
revision when changing the inline npm adapter so installed shared runtimes are
replaced. Full-access execution does not opt into these sandbox adapters.

Windows builds require Visual Studio C++ Build Tools with the Clang/LLVM
toolset. The builder uses the bundled Python and a checksum-locked portable
NASM, preserving OpenSSL assembly support. It caches the compiled binary under
`output/`, keyed by the source version and patch, and verifies its digest before
reuse. The build keeps Node’s upstream parallel build settings; forcing one
compiler process exceeded the hosted runner’s 90-minute budget. First builds
take longer because Node must be compiled.

Run `npm run build:portal` followed by `npm run test:portal-permissions` on
Windows. The native suite exercises venv/ensurepip, offline pip and npm/npx,
isolated Python mode, worker threads, filesystem/network denial, foreground and
background execution, restart persistence and damaged-install errors. Windows
`test:all` and release CI run this suite after building the bundled runtime.
`tests/windows-sandbox-cancellation-native.mjs` also checks exact ACL restoration
after foreground timeout, background cancellation and cancellation while queued
for the sandbox lock. These paths let the wrapper finish cleanup before exiting.
An external forced kill of the wrapper, a crash, or cleanup exceeding its bounded
grace period can still leave ACL changes; no crash-recovery journal is installed.

Network isolation is intentional: online package installation requires an
explicitly authorized host operation or dependencies prepared in advance.
