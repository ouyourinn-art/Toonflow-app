<template>
  <div class="shugandoPanel">
    <p class="description">配置耀好原创的语言模型服务。保存后，创作助手与文本节点共用此供应商；可在模型选择器中选择具体模型。</p>
    <el-form labelPosition="top" :disabled="saving || fetching" @submit.prevent>
      <el-form-item label="API 基础地址">
        <el-input v-model="apiUrl" placeholder="https://api.shugando.jp/v1" autocomplete="off" />
      </el-form-item>
      <el-form-item label="API Key">
        <el-input v-model="apiKey" type="password" showPassword autocomplete="off" placeholder="填写自己的中转 API Key" />
      </el-form-item>
      <el-form-item label="接口协议">
        <el-select v-model="protocol" aria-label="接口协议">
          <el-option label="OpenAI Responses" value="openai-responses" />
          <el-option label="OpenAI Chat Completions" value="openai-completions" />
          <el-option label="Anthropic Messages" value="anthropic-messages" />
        </el-select>
      </el-form-item>
      <el-form-item label="可用模型">
        <el-select v-model="modelIds" multiple filterable allowCreate defaultFirstOption placeholder="获取后选择，或输入上游准确模型 ID" aria-label="可用模型">
          <el-option v-for="model in availableModels" :key="model.id" :label="model.label" :value="model.id" />
        </el-select>
      </el-form-item>
    </el-form>
    <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" showIcon />
    <div class="panelActions">
      <el-button :loading="fetching" :disabled="saving || !apiKey.trim()" @click="fetchModels">获取模型列表</el-button>
      <el-button type="primary" :loading="saving" :disabled="fetching || !apiKey.trim() || !modelIds.length" @click="saveProvider">保存模型配置</el-button>
      <el-button tag="a" href="https://api.shugando.jp" target="_blank" rel="noopener noreferrer">打开 Shugando 控制台</el-button>
    </div>
    <p v-if="saved" class="savedMessage" role="status">配置已保存。可返回创作页面选择模型。</p>
    <p class="description">账号登录、钱包及媒体模型的统一接入尚未完成；当前页面保存 API 连接配置。获取模型列表不提交生成任务。</p>
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { onScopeDispose, ref, watch } from "vue";
import { customProviders, saveSettings, type CustomProvider, type CustomProviderModel } from "@/stores/settings";

const existing = customProviders.value.find(provider => provider.id === "shugando");
const apiUrl = ref(existing?.apiUrl || "https://api.shugando.jp/v1");
const apiKey = ref(existing?.apiKey || "");
const protocol = ref(existing?.protocol || "openai-responses");
const modelIds = ref(existing?.models.map(model => model.id) || []);
const availableModels = ref<CustomProviderModel[]>(existing?.models || []);
const saving = ref(false);
const fetching = ref(false);
const errorMessage = ref("");
const saved = ref(false);
const lifetime = new AbortController();
onScopeDispose(() => lifetime.abort());
watch([apiUrl, apiKey, protocol, modelIds], () => { saved.value = false; }, { deep: true });

function connection() {
  const url = new URL(apiUrl.value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("请填写不含查询参数的 HTTP API 基础地址");
  const key = apiKey.value.trim();
  if (!key || key.length > 8192) throw new Error("请填写有效 API Key");
  return { apiUrl: url.href.replace(/\/+$/, ""), apiKey: key, protocol: protocol.value };
}

function showError(error: unknown) {
  errorMessage.value = axios.isAxiosError(error) ? error.response?.data?.message || "模型服务请求失败，请检查地址、Key 和协议" : error instanceof Error ? error.message : "操作失败，请重试";
}

async function fetchModels() {
  if (fetching.value || saving.value) return;
  fetching.value = true;
  errorMessage.value = "";
  try {
    const { data } = await axios.post<{ code: number; data: CustomProviderModel[]; message?: string }>("/api/providers/models", connection(), { signal: lifetime.signal, timeout: 35000 });
    if (data.code !== 200 || !Array.isArray(data.data)) throw new Error(data.message || "模型列表格式无效");
    availableModels.value = data.data;
    if (!data.data.length) throw new Error("上游未返回模型，可输入准确模型 ID 后保存");
  } catch (error) { if (!lifetime.signal.aborted) showError(error); }
  finally { fetching.value = false; }
}

async function saveProvider() {
  if (saving.value || fetching.value) return;
  saving.value = true;
  errorMessage.value = "";
  try {
    const provider: CustomProvider = {
      id: "shugando", label: "Shugando · 耀好", ...connection(),
      models: [...new Set(modelIds.value.map(id => id.trim()).filter(Boolean))].map(id => availableModels.value.find(model => model.id === id) || { id, label: id }),
    };
    if (!provider.models.length) throw new Error("请至少选择一个模型");
    await saveSettings(current => {
      const providers = current.customProviders ?? [];
      if (!Array.isArray(providers)) throw new Error("现有供应商配置格式无效");
      return { customProviders: [...providers.filter(item => item?.id !== provider.id), provider] };
    });
    saved.value = true;
  } catch (error) { if (!lifetime.signal.aborted) showError(error); }
  finally { saving.value = false; }
}
</script>

<style lang="scss" scoped>
.shugandoPanel {
  max-width: 640px;
  .description { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.8; margin: 0 0 20px; }
  .panelActions { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0; .el-button { margin: 0; } }
  .savedMessage { color: var(--el-color-success); font-size: 13px; }
}
</style>
