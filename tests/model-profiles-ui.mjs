// Real desktop model panels with an isolated main-process profile store.
// No live Being, real credential, or Electron user profile is used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const storeBundle = await build({
  entryPoints: ["desktop/main/chat/model-profiles.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { ModelProfileStore, applyRememberedModelConfig, listModelProfiles } = await import(
  "data:text/javascript;base64," + Buffer.from(storeBundle.outputFiles[0].contents).toString("base64")
);
const directory = await mkdtemp(path.join(os.tmpdir(), "portal-model-profiles-ui-"));
const store = new ModelProfileStore(directory, {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value),
  decryptString: value => value.toString(),
});
const secret = "ui-fixture-only-secret";
const patches = [];
let config = { provider: "self-hosted", model: "initial-model", thinking: "medium" };
async function configure(patch) {
  patches.push(patch);
  await new Promise(resolve => setTimeout(resolve, 80));
  const { api_key: _key, ...publicPatch } = patch;
  config = { ...config, ...publicPatch };
  return { ok: true, config };
}

const bundle = await build({
  stdin: {
    contents: `
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { SubagentModelSettings } from './desktop/renderer/app/components/subagent-model-settings';
import { Store } from './desktop/renderer/shared/models/store';
async function apiRequest(path, input) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'fixture request failed');
  return data;
}
const api = {
  modelProfiles: input => apiRequest('/profiles', input),
  beingModelConfig: patch => apiRequest('/config', patch || {}),
  subagentConfig: async () => ({provider:'openai', model:'subagent-fixture', thinking:'medium'}),
  beingModelCatalog: async input => {
    if (input.kind === 'routes') return {status:200,data:{routes:[
      {id:'openrouter',name:'OpenRouter',base_url:'https://openrouter.example/v1',has_key:routeHasKey},
    ]}};
    if (input.kind === 'keys') { routeHasKey = true; return {status:200,data:{ok:true}}; }
    return {status:200,data:{models:[
      {id:'deepseek-v4.1-flash',name:'DeepSeek Flash 测试模型'},
    ]}};
  },
};
let routeHasKey = false;
window.beings = api;
const app = Object.assign(new Store(), {
  modelSettingsTarget:'Heart',
  snapshot:{settings:{hasToken:true}},
  api,
  closeSubagentSettings(){},
  applySnapshot(){},
});
createRoot(document.getElementById('root')).render(
  <StrictMode><div className="workspace-body" style={{height:'100vh'}}>
    <main className="workspace-stage">模型线路自动记忆测试</main>
    <SubagentModelSettings app={app}/>
  </div></StrictMode>
);
`,
    loader: "tsx",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
});
const css = (await readFile("desktop/renderer/app/styles.css", "utf8")).replace(
  '@import "../shared/model-settings.css";',
  "",
) + await readFile("desktop/renderer/shared/model-settings.css", "utf8");

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || "{}");
      let result;
      if (req.url === "/profiles") result = listModelProfiles(input, store);
      else if (req.url === "/config" && !Object.keys(input).length) result = config;
      else if (req.url === "/config") result = await applyRememberedModelConfig(input, store, configure);
      else throw new Error("unknown fixture endpoint");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
      return;
    }
    res.setHeader(
      "Content-Type",
      req.url === "/app.js" ? "text/javascript" : req.url === "/style.css" ? "text/css" : "text/html;charset=utf-8",
    );
    res.end(req.url === "/app.js" ? bundle.outputFiles[0].contents : req.url === "/style.css" ? css :
      '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>');
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message }));
  }
});

let browser;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));

  await page.goto(url);
  await page.getByRole("heading", { name: "initial-model", exact: true }).waitFor();
  assert.equal(await page.getByText("我的模型档案", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "存为当前配置", exact: true }).count(), 0);

  // First successful custom submission is remembered under its provider.
  await page.getByRole("button", { name: "更换", exact: true }).click();
  await page.getByRole("button", { name: "自定义", exact: true }).click();
  await page.getByLabel("接口地址", { exact: true }).fill("https://company.example.test/v1");
  await page.getByLabel("模型 ID", { exact: true }).fill("company-astra");
  await page.getByLabel("协议", { exact: true }).selectOption("portal-custom");
  await page.getByLabel("接口协议", { exact: true }).selectOption("openai-completions");
  await page.getByLabel("API 密钥", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "试连并切换", exact: true }).click();
  await page.getByRole("heading", { name: "company-astra", exact: true }).waitFor();
  assert.deepEqual(patches.at(-1), {
    provider: "portal-custom", api: "openai-completions",
    base_url: "https://company.example.test/v1", model: "company-astra", api_key: secret,
  });
  assert.equal(store.list().length, 1);

  // Selecting the same provider auto-fills public fields but never returns the key.
  await page.getByRole("button", { name: "更换", exact: true }).click();
  await page.getByRole("button", { name: "自定义", exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(await page.getByLabel("接口地址", { exact: true }).inputValue(), "https://company.example.test/v1");
  assert.equal(await page.getByLabel("模型 ID", { exact: true }).inputValue(), "company-astra");
  assert.equal(await page.getByLabel("API 密钥", { exact: true }).inputValue(), "");
  assert.equal(await page.getByText("已记住本机密钥，留空即可沿用。", { exact: true }).count(), 1);
  assert.equal(await page.locator("body").innerText().then(text => text.includes(secret)), false);
  await page.getByRole("button", { name: "试连并切换", exact: true }).click();
  await page.getByRole("heading", { name: "company-astra", exact: true }).waitFor();
  assert.equal(patches.at(-1).api_key, secret, "main process should inject the encrypted key");

  // A second route is saved independently and is auto-selected next time.
  await page.getByRole("button", { name: "更换", exact: true }).click();
  await page.getByRole("button", { name: "OpenRouter", exact: true }).click();
  await page.getByRole("button", { name: /DeepSeek Flash 测试模型/ }).click();
  await page.getByLabel("API 密钥", { exact: true }).fill("openrouter-secret");
  await page.getByRole("button", { name: "保存并加载模型", exact: true }).click();
  await page.getByRole("button", { name: /DeepSeek Flash 测试模型/ }).click();
  await page.getByRole("button", { name: "试连并切换", exact: true }).click();
  await page.getByRole("heading", { name: "DeepSeek Flash 测试模型", exact: true }).waitFor();
  assert.deepEqual(patches.at(-1), {
    provider: "openrouter", model: "deepseek-v4.1-flash",
    base_url: "https://openrouter.example/v1", api_key: "openrouter-secret",
  });
  assert.equal(store.list().length, 2);

  await page.getByRole("button", { name: "更换", exact: true }).click();
  await page.getByRole("button", { name: "OpenRouter", exact: true }).click();
  await page.getByRole("button", { name: /DeepSeek Flash 测试模型/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: "OpenRouter", exact: true }).locator("span").getAttribute("title"), "已有密钥");
  assert.equal(await page.getByLabel("API 密钥", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "试连并切换", exact: true }).click();
  await page.getByRole("heading", { name: "DeepSeek Flash 测试模型", exact: true }).waitFor();
  assert.equal(patches.at(-1).api_key, "openrouter-secret");
  assert.equal(await page.locator("body").innerText().then(text => text.includes("openrouter-secret")), false);

  // Profile data is local and the subagent panel remains separate.
  await page.getByRole("tab", { name: "subagent", exact: true }).click();
  assert.equal(await page.getByText("我的模型档案", { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: no profile-list UI, provider auto-fill, masked local key reuse, per-provider retention, and subagent isolation.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
