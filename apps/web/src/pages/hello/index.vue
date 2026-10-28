<template>
  <main class="hello">
    <section class="welcomePanel" aria-labelledby="welcomeTitle">
      <div class="brand"><img :src="logoUrl" alt="耀好" /><span>耀好原创工作室</span></div>
      <h1 id="welcomeTitle">从灵感，到完整作品。</h1>
      <p class="description">先写好故事，再统一人物、搭建分镜与生成素材。每个阶段都有自己的画布。</p>
      <template v-if="configuring">
        <el-button text @click="configuring = false">返回</el-button>
        <shugando />
      </template>
      <div v-else class="welcomeActions">
        <el-button type="primary" size="large" @click="configuring = true">配置 Shugando 模型服务</el-button>
        <el-button size="large" :loading="saving" @click="completeSetup">{{ customProviders.length ? '进入工作室' : '先进入，稍后配置' }}</el-button>
      </div>
      <el-button v-if="configuring" type="primary" :loading="saving" @click="completeSetup">进入工作室</el-button>
      <p class="footer">基于 Toonflow 开源画布 · 保留 MIT 许可与原作署名</p>
    </section>
    <aside class="workflowPreview" aria-label="原创制作流程">
      <span class="eyebrow">YAOHAO ORIGINAL STUDIO</span>
      <h2>故事为先。<br />每一步，都有迹可循。</h2>
      <ol><li v-for="stage in originalStages" :key="stage.id">{{ stage.label }}</li></ol>
    </aside>
  </main>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import logoUrl from "@toonflow/assets/yaohaoLogo.svg";
import shugando from "@/components/settings/panels/shugando.vue";
import { originalStages } from "@/lib/originalWorkflow";
import { customProviders } from "@/stores/settings";
import { useHelloStore } from "@/stores/hello";

const configuring = ref(false);
const saving = ref(false);
const hello = useHelloStore();
const router = useRouter();
async function completeSetup() {
  if (saving.value) return;
  saving.value = true;
  try { await hello.complete(); await router.replace("/home"); }
  catch { ElMessage.error("引导状态保存失败，请重试"); }
  finally { saving.value = false; }
}
</script>

<style lang="scss" scoped>
.hello {
  display: grid; grid-template-columns: 1.1fr 1fr; min-height: 100dvh; color: var(--el-text-color-primary); background: var(--el-bg-color);
  .welcomePanel {
    padding: clamp(32px, 6vw, 88px); align-self: center; min-width: 0;
    .brand { display: flex; align-items: center; gap: 12px; font-size: 18px; font-weight: 600; img { width: 42px; height: 42px; } }
    h1 { font-size: clamp(28px, 3vw, 44px); line-height: 1.4; margin: 36px 0 12px; }
    .description { color: var(--el-text-color-secondary); line-height: 1.9; margin-bottom: 32px; }
    .welcomeActions { display: flex; flex-direction: column; gap: 14px; .el-button { margin: 0; min-height: 48px; } }
    .footer { margin-top: 40px; font-size: 12px; color: var(--el-text-color-secondary); }
  }
  .workflowPreview {
    padding: clamp(32px, 5vw, 80px); margin: 12px; border-radius: 20px; color: #eeebff;
    background: radial-gradient(ellipse at 90% 10%, #7f69be66, transparent 60%), linear-gradient(145deg, #222335, #323044);
    .eyebrow { font-size: 11px; letter-spacing: 3px; color: #bcb1e8; }
    h2 { font-size: clamp(26px, 3vw, 42px); line-height: 1.6; margin: 50px 0 32px; }
    ol { display: grid; gap: 22px; padding-left: 22px; li { padding-left: 10px; font-size: 15px; &::marker { color: #b6a4ef; } } }
  }
  @media (max-width: 800px) { grid-template-columns: 1fr; .workflowPreview { display: none; } }
}
</style>
