// Real settings panel with an isolated catalog adapter; never accesses a live Being.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
const bundle = await build({
  stdin: {
    contents: `
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { SubagentModelSettings } from './desktop/renderer/app/components/subagent-model-settings';
import { Store } from './desktop/renderer/shared/models/store';
let config = {provider:'router',model:'vendor/original',thinking:'medium',history:[{provider:'router',model:'vendor/original'}]};
const routes = [{id:'router',name:'聚合线路',base_url:'https://router.invalid/v1',has_key:true},{id:'direct',name:'官方线路',base_url:'https://direct.invalid/api',has_key:false},{id:'slow',name:'慢线路',base_url:'https://slow.invalid/v1',has_key:true}];
window.patches=[];window.keySaves=[];window.catalogCalls=[];
const app = Object.assign(new Store(), {modelSettingsTarget:'Heart',snapshot:{settings:{hasToken:true}},
 api:{
  beingModelConfig:async patch=>{
   if(!patch)return config;
   window.patches.push(patch);
   if(patch.model==='vendor/expired' && !window.keySaves.some(item=>item.route==='router'))return {ok:false,http_status:401,error:'invalid API key'};
   if(patch.model==='vendor/fail')return {ok:false,http_status:404,error:'upstream model missing',candidates:['vendor/new']};
   if(patch.model==='vendor/rollback')return {ok:true,rolled_back:true,config};
   config={...config,...patch}; return {ok:true,config};
  },
  beingModelCatalog:async input=>{
   window.catalogCalls.push(input.kind+':'+(input.route||''));
   if(input.kind==='routes')return {status:200,data:{routes}};
   if(input.kind==='keys'){window.keySaves.push(input);routes.find(r=>r.id===input.route).has_key=true;return {status:200,data:{ok:true}};}
   if(input.route==='slow')await new Promise(resolve=>setTimeout(resolve,400));
   return {status:200,data:{models: input.route==='router' ? [
    {id:'vendor/original',name:'当前模型',context:1048576,reasoning:true,tool_call:true,release_date:'2026-01-01'},
    {id:'vendor/new',name:'新版模型',release_date:'2026-10-01',context:262144,source:'catalog'},
    {id:'vendor/expired',name:'过期密钥模型'}, {id:'vendor/fail',name:'失败模型'}, {id:'vendor/rollback',name:'回退模型'}
   ]:[{id:input.route+'/model',name:input.route==='slow'?'过期响应':'官方模型'}]}};
  },subagentConfig:async()=>({provider:'openai',model:'local-model',thinking:'high'})
 },closeSubagentSettings(){window.closeCalls=(window.closeCalls||0)+1},applySnapshot(){}
});
createRoot(document.getElementById('root')).render(<StrictMode><div className="workspace-body" style={{height:'100vh'}}><main className="workspace-stage">本地模型设置验证</main><SubagentModelSettings app={app}/></div></StrictMode>);
`,
    loader: "tsx",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  platform: "browser",
});
const css =
  (await readFile("desktop/renderer/app/styles.css", "utf8")).replace(
    '@import "../shared/model-settings.css";',
    "",
  ) + (await readFile("desktop/renderer/shared/model-settings.css", "utf8"));
const server = createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/app.js"
      ? "text/javascript"
      : req.url === "/style.css"
        ? "text/css"
        : "text/html;charset=utf-8",
  );
  res.end(
    req.url === "/app.js"
      ? bundle.outputFiles[0].contents
      : req.url === "/style.css"
        ? css
        : '<!doctype html><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>',
  );
});
await new Promise((resolve) =>
  server.listen(
    process.argv.includes("--serve") ? 4186 : 0,
    "127.0.0.1",
    resolve,
  ),
);
if (process.argv.includes("--serve"))
  console.log("Model catalog fixture: http://127.0.0.1:4186");
else {
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({
      viewport: { width: 1100, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page
      .getByRole("heading", { name: "vendor/original", exact: true })
      .waitFor();
    assert.equal(await page.getByRole("searchbox").count(), 0);
    assert.equal(
      await page.getByText("回答随机性", { exact: true }).count(),
      0,
    );
    await page.getByRole("button", { name: "高", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.patches.at(-1)), {
      thinking: "high",
    });
    await page.getByRole("button", { name: "更换", exact: true }).click();
    await page
      .getByRole("button", { name: /当前模型.*vendor\/original/ })
      .waitFor();
    assert.match(
      await page.locator(".llm-model-row").first().innerText(),
      /当前模型/,
    );
    assert.match(
      await page.locator(".llm-model-row").nth(1).innerText(),
      /未验证/,
    );
    await page.getByRole("searchbox").fill("vendor new");
    assert.equal(await page.locator(".llm-model-row").count(), 1);
    await page.getByRole("searchbox").fill("");
    await page.getByRole("button", { name: /失败模型/ }).click();
    const patchCount = await page.evaluate(() => window.patches.length);
    assert.equal(
      patchCount,
      1,
      "Selecting a model must not mutate configuration",
    );
    await page.getByRole("button", { name: "试连并切换", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "上没有" }).waitFor();
    await page.getByRole("button", { name: "vendor/new", exact: true }).click();
    await page.getByRole("button", { name: "试连并切换", exact: true }).click();
    await page
      .getByRole("heading", { name: "新版模型", exact: true })
      .waitFor();
    assert.deepEqual(await page.evaluate(() => window.patches.at(-1)), {
      provider: "router",
      model: "vendor/new",
      base_url: "https://router.invalid/v1",
    });
    await page.getByRole("button", { name: "更换", exact: true }).click();
    await page.getByRole("button", { name: /回退模型/ }).click();
    await page.getByRole("button", { name: "试连并切换", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "已恢复上次可用配置" })
      .waitFor();
    await page.getByRole("button", { name: /过期密钥模型/ }).click();
    await page.getByRole("button", { name: "试连并切换", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "拒绝了这个密钥" })
      .waitFor();
    await page
      .getByLabel("API 密钥", { exact: true })
      .fill("replacement-fixture-key");
    await page
      .getByRole("button", { name: "保存并加载模型", exact: true })
      .click();
    await page
      .getByLabel("API 密钥", { exact: true })
      .waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "试连并切换", exact: true }).click();
    await page
      .getByRole("heading", { name: "过期密钥模型", exact: true })
      .waitFor();
    await page.waitForFunction(
      () => document.activeElement?.textContent === "更换",
    );
    // One Escape from the overview must reach the containing panel's close action.
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.closeCalls), 1);
    await page.getByRole("button", { name: "更换", exact: true }).click();
    await page.getByRole("button", { name: "官方线路", exact: true }).click();
    await page.getByLabel("API 密钥", { exact: true }).fill("fixture-key-only");
    await page
      .getByRole("button", { name: "保存并加载模型", exact: true })
      .click();
    await page.getByRole("button", { name: /官方模型/ }).waitFor();
    await page
      .getByLabel("API 密钥", { exact: true })
      .waitFor({ state: "hidden" });
    assert.deepEqual(await page.evaluate(() => window.keySaves.at(-1)), {
      kind: "keys",
      route: "direct",
      api_key: "fixture-key-only",
    });
    assert.equal(
      await page.evaluate(() =>
        window.patches.some((p) => p.api_key === "fixture-key-only"),
      ),
      false,
    );
    await page.getByRole("button", { name: "慢线路", exact: true }).click();
    await page.getByRole("button", { name: "聚合线路", exact: true }).click();
    await page.waitForTimeout(550);
    assert.equal(
      await page.getByRole("button", { name: /过期响应/ }).count(),
      0,
      "Late responses cannot replace the selected route",
    );
    await page.getByRole("button", { name: "自定义", exact: true }).click();
    await page
      .getByLabel("接口地址", { exact: true })
      .fill("https://custom.invalid/v1");
    await page.getByLabel("模型 ID", { exact: true }).fill("exact/model-id");
    await page.getByLabel("协议", { exact: true }).selectOption("anthropic");
    await page
      .getByLabel("API 密钥", { exact: true })
      .fill("custom-fixture-key");
    await page.getByRole("tab", { name: "subagent", exact: true }).click();
    await page
      .getByRole("heading", { name: "local-model", exact: true })
      .waitFor();
    await page.getByRole("tab", { name: "Being 模型", exact: true }).click();
    assert.equal(
      await page.getByLabel("模型 ID", { exact: true }).inputValue(),
      "exact/model-id",
    );
    await page.getByRole("button", { name: "试连并切换", exact: true }).click();
    await page
      .getByRole("heading", { name: "exact/model-id", exact: true })
      .waitFor();
    assert.deepEqual(await page.evaluate(() => window.patches.at(-1)), {
      provider: "anthropic",
      model: "exact/model-id",
      base_url: "https://custom.invalid/v1",
      api_key: "custom-fixture-key",
    });
    await page.getByRole("button", { name: "更换", exact: true }).click();
    await page.getByRole("button", { name: "聚合线路", exact: true }).click();
    await page.getByRole("searchbox").press("ArrowDown");
    assert.equal(
      await page
        .locator(".llm-model-row")
        .first()
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: "试连并切换", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .getByRole("button", { name: "试连并切换", exact: true })
        .count(),
      0,
    );
    await mkdir("test-results", { recursive: true });
    await page.screenshot({ path: "test-results/model-catalog-light.png" });
    await page.setViewportSize({ width: 700, height: 720 });
    assert.equal(
      await page
        .locator("#settings-panel")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
      true,
    );
    await page.screenshot({ path: "test-results/model-catalog-narrow.png" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: catalog routes, search, recent models, exact IDs, keys, failure/candidates/rollback, stale requests, custom protocol, tab drafts and keyboard navigation.",
    );
  } finally {
    await browser?.close();
    server.close();
  }
}
