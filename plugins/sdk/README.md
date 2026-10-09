# Grove Plugin SDK 1.3

TypeScript types for the host-injected `window.grove`. This package has no runtime and is not published to npm.

From your plugin project, install this directory or an `npm pack` tarball:

```sh
npm install --save-dev /path/to/Town-Client/plugins/sdk
```

For standalone CI, vendor a fixed copy inside the plugin repository and depend on `file:vendor/grove-plugin-sdk`, as [Starmap](https://github.com/chunqing-liu/starmap) does. Commit the lockfile.

All APIs, permissions, minimum versions, examples and publishing instructions are maintained in the [developer guide](../../DEVELOPER-API-SDK.md#part-3--客户端插件-api--sdk). The type contract is [index.d.ts](index.d.ts).
