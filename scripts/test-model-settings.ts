import { openAICompatibleUrl } from "../src/lib/openai-compatible-url";
import assert from "node:assert/strict";
import { commonModelKeys, connectionError, serviceWebsite, resolveActivatedBinding, SERVICE_PRESETS, modelConnectionKey, saveConnectionStore, validateConnection, type ModelConnection, type SettingsBinding } from "../src/lib/model-settings";

async function main() {
  assert.equal(validateConnection("http://127.0.0.1:11434/v1", ""), null);
  assert.equal(validateConnection("https://service.example/v1", "key"), null);
  assert.equal(validateConnection("service.example", "key")?.field, "baseUrl");
  assert.equal(validateConnection("https://service.example/v1", "")?.field, "apiKeyLocal");
  assert.equal(validateConnection("https://key@service.example", "key")?.field, "baseUrl");
  assert.equal(validateConnection("https://service.example?key=secret", "key")?.field, "baseUrl");
  const binding = { providerId: "service-a", modelId: "same-model", enabled: true, showInPicker: true, isDefault: false, updatedAt: "now" };
  const bindings: SettingsBinding[] = [
    { ...binding, capability: "image" }, { ...binding, capability: "imageTool" },
    { ...binding, providerId: "service-b", capability: "image" },
    { ...binding, modelId: "disabled", capability: "chat", enabled: false },
  ];
  assert.equal(commonModelKeys(bindings).size, 2, "Count connections, not capability bindings");
  assert.notEqual(modelConnectionKey("a::b", "c"), modelConnectionKey("a", "b::c"));
  assert.match(connectionError("HTTP 401 key=do-not-show"), /密钥/);
  assert.ok(!connectionError("unexpected secret-token").includes("secret-token"));

  const providers: ModelConnection[] = ["service-a", "service-b"].map(id => ({ id, name: id, baseUrl: "https://test.invalid", apiKeyLocal: "fake", type: "custom", enabled: true, createdAt: "now", updatedAt: "now" }));
  assert.equal(resolveActivatedBinding(bindings, providers, "chat", { modelId: "disabled" }), null);
  assert.equal(resolveActivatedBinding(bindings, providers, "image", { providerId: "service-a", modelId: "stale" }), null);
  assert.equal(resolveActivatedBinding([], providers, "image"), null, "No legacy fallback after deactivation");
  assert.equal(resolveActivatedBinding(bindings, providers.map(p => ({ ...p, enabled: false })), "image"), null);
  assert.equal(resolveActivatedBinding(bindings, providers, "chat", { modelId: "same-model" }), null, "Activation respects purpose");
  assert.equal(resolveActivatedBinding(bindings, providers, "imageTool", { providerId: "service-b", modelId: "same-model" })?.providerId, "service-b");
  assert.equal(resolveActivatedBinding(bindings.map(b => ({ ...b, showInPicker: false })), providers, "image"), null);
  for (const name of ["DeepSeek", "火山引擎", "阿里云百炼", "硅基流动", "智谱"]) assert.ok(SERVICE_PRESETS.some(p => p.label === name));
  assert.ok(!SERVICE_PRESETS.some(p => /云雾|codia/i.test(p.label)));
  for (const [base, result] of [
    ["https://api.deepseek.com/v1", "https://api.deepseek.com/v1/chat/completions"],
    ["https://ark.cn-beijing.volces.com/api/v3", "https://ark.cn-beijing.volces.com/api/v3/chat/completions"],
    ["https://open.bigmodel.cn/api/paas/v4", "https://open.bigmodel.cn/api/paas/v4/chat/completions"],
    ["https://dashscope.aliyuncs.com/compatible-mode/v1/", "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"],
    ["https://grsaiapi.com", "https://grsaiapi.com/v1/chat/completions"],
  ]) assert.equal(openAICompatibleUrl(base, "chat/completions"), result);

  assert.equal(serviceWebsite("https://api.deepseek.com/v1"), "https://platform.deepseek.com/");
  assert.equal(serviceWebsite("https://ark.cn-beijing.volces.com/api/v3"), "https://console.volcengine.com/ark/");
  assert.equal(serviceWebsite("https://api.siliconflow.cn/v1"), "https://cloud.siliconflow.cn/");
  assert.equal(serviceWebsite("https://grsaiapi.com"), "https://grsai.ai/");
  assert.equal(serviceWebsite("https://key:secret@relay.example/v1?key=secret#hash"), "https://relay.example/");
  assert.equal(serviceWebsite("https://deepseek.com.other.example/v1"), "https://deepseek.com.other.example/");
  assert.equal(serviceWebsite("https://img-api.apinebula.ai/v1"), "https://apinebula.com/");
  assert.equal(serviceWebsite("https://api.apinebula.com/v1"), "https://apinebula.com/");
  assert.equal(serviceWebsite("javascript:alert(1)"), null);

  const originalFetch = globalThis.fetch;
  const writes: number[] = [];
  let active = 0;
  let maxActive = 0;
  globalThis.fetch = (async (_url, init) => {
    active++; maxActive = Math.max(active, maxActive);
    const value = JSON.parse(String(init?.body)).version;
    await new Promise(resolve => setTimeout(resolve, value === 1 ? 25 : 1));
    writes.push(value); active--;
    return new Response(JSON.stringify({ success: value !== 2 }), { status: value === 2 ? 500 : 200 });
  }) as typeof fetch;
  try {
    const first = saveConnectionStore({ version: 1 });
    const failed = saveConnectionStore({ version: 2 });
    const last = saveConnectionStore({ version: 3 });
    const results = await Promise.allSettled([first, failed, last]);
    assert.deepEqual(results.map(r => r.status), ["fulfilled", "rejected", "fulfilled"]);
    assert.deepEqual(writes, [1, 2, 3], "An older write must not overwrite a newer save");
    assert.equal(maxActive, 1);
  } finally { globalThis.fetch = originalFetch; }
  console.log("Model settings: activation guards, domestic service URLs, validation, identity, error redaction and ordered writes passed.");
}
void main();
