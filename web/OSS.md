# OSS 静态网站部署

此目录是纯静态网页，不需要在 OSS 运行 Node.js、Electron 或安装 npm 依赖。它连接真实服务，不包含演示数据。

## 上传与访问

1. 解压 `town-web-oss.zip`，把里面的所有文件按原目录结构上传到 Bucket 根目录或 `town/` 等子目录。不要只上传 ZIP 文件。
2. 推荐绑定 HTTPS 自定义域名。阿里云 OSS 默认域名访问 HTML 可能触发下载，不应当作网页正式访问地址。
3. 在 OSS 静态网站托管中设置默认首页 `index.html`。子目录部署也可直接访问 `https://你的域名/town/index.html`；页面路由使用 `#`，无需 SPA 路由重写。
4. `index.html`、`chat.html`、`web-config.json`、`manifest.webmanifest` 使用 `Cache-Control: no-cache`；`assets/` 中带哈希的文件可长缓存。
5. 确认文件元数据：HTML 为 `text/html`，JS 为 `text/javascript`，CSS 为 `text/css`，JSON 为 `application/json`，manifest 为 `application/manifest+json`，PNG 为 `image/png`。

## 真实 Town 数据：直连或 API 转发服务

静态包默认直接请求真实 `https://beings.town`。在「设置 → Town 身份」中直接自动或手动配对，不做域名检测、连接预验证，也不因 `apiBase` 为空而阻止请求。

浏览器仍遵循服务端 CORS 响应；如果某个部署来源不受 Town 允许，可由部署者使用下面的可选转发配置。正常配对无需配置转发。

可使用另一个包 `town-web.tar.gz` 中的服务作为 API 转发服务，部署在服务器上：

```sh
WEB_ALLOWED_ORIGINS=https://你的静态站点域名 HOST=0.0.0.0 node server.mjs
```

给该服务配置 HTTPS 域名，例如 `https://api.example.com`；反向代理须支持 SSE、关闭流式响应缓冲。`WEB_ALLOWED_ORIGINS` 只填写精确来源（协议 + 域名 + 端口），多个来源逗号分隔，不含目录路径。服务默认转发真实 `https://beings.town`，不保存用户凭据。

然后修改本目录的 `web-config.json`：

```json
{
  "mode": "static",
  "apiBase": "https://api.example.com"
}
```

`apiBase` 是已部署的本项目 API 转发服务地址，不是 Being 链接，也不能直接填 `https://beings.town`。留空表示直接连接 Town。可额外设置 `townOrigin` 为其他 Town 的 HTTPS 域名；使用转发时，服务端 `WEB_TOWN_ORIGIN` 应与该域名一致。请勿在此文件中放 token、API Key 或任何凭据。

Being 默认直接连接用户输入的 Loom 地址，服务需允许网页来源。如需转发 Being，可在 API 服务端配置固定 `WEB_LOOM_ENDPOINT`，网页会自动识别匹配地址并使用 `/loom-api`。浏览器不能动态修改转发上游。

## 添加到主屏幕

启动地址明确指向 `./index.html#chat`，不依赖目录默认首页。若旧图标打开后显示 0 KB 文件，请更新 manifest，刷新 CDN 对 `manifest.webmanifest`、`index.html` 和 `chat.html` 的缓存，删除旧图标，再从完整 `index.html` 网页重新添加。某些 OSS 目录占位对象会返回 0 字节 `application/octet-stream`，不可作为启动入口。确认首页为 `text/html`，且没有 `Content-Disposition: attachment`；入口文件和 manifest 不应配置长期 CDN 缓存。

设置页提供添加入口。iPhone/iPad 按提示通过 Safari 分享菜单添加；支持原生安装提示的 Chrome/Edge 可直接发起安装。图标、manifest 和独立窗口配置已包含。主屏幕 App 首次打开若未继承浏览器连接，连接一次即可；Being/Town 凭据保存在当前设备的 localStorage，后续启动自动恢复，主动断开时清除。清除网站数据、卸载 App 或凭据失效后需重新连接。对话和小镇数据需要联网，不提供离线数据缓存。

## 从源码重新打包

```sh
npm run package:web:static
```

输出 `out/town-web-oss.zip`。可通过环境变量 `WEB_STATIC_API_BASE` 提前指定 API 转发地址，也可以解压后修改 `web-config.json`，无需重新编译。
