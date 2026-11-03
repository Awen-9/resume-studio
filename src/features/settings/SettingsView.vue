<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchAiProviders } from '@/infrastructure/api/localResumeApi'
import {
  loadAiSettings,
  saveAiSettings,
  type ProviderId,
} from '@/infrastructure/storage/aiSettings'

const emit = defineEmits<{ back: [] }>()

const provider = ref<ProviderId>('ollama')
const apiKey = ref('')
const selectedModel = ref('')
const providerModels = ref<Record<ProviderId, string[]>>({ ollama: [], deepseek: [] })
const providerError = ref('')
const connectionNote = ref('')
const savedNote = ref('')

const refreshModels = async (): Promise<void> => {
  providerError.value = ''
  try {
    const result = await fetchAiProviders(apiKey.value.trim() || undefined)
    providerModels.value = { ollama: result.ollama.models, deepseek: result.deepseek.models }
    if (provider.value === 'deepseek' && result.deepseek.error) {
      providerError.value = result.deepseek.error
    }
    const next = providerModels.value[provider.value]
    if (!next.includes(selectedModel.value)) selectedModel.value = next[0] ?? ''
  } catch (error) {
    providerError.value = error instanceof Error ? error.message : '读取模型失败'
  }
}

const applyProvider = async (): Promise<void> => {
  providerError.value = ''
  saveAiSettings({ provider: provider.value, deepseekKey: apiKey.value })
  savedNote.value = '已保存'
  window.setTimeout(() => (savedNote.value = ''), 1500)
  await refreshModels()
  if (provider.value === 'deepseek' && !apiKey.value.trim()) {
    providerError.value = '还没有填 API Key，出题/改简历会先用本地模型'
  }
}

const onProviderChange = async (event: Event): Promise<void> => {
  provider.value = (event.target as HTMLSelectElement).value as ProviderId
  await applyProvider()
}

const onModelChange = async (): Promise<void> => {
  saveAiSettings({
    provider: provider.value,
    deepseekKey: apiKey.value,
    model: selectedModel.value,
  })
  savedNote.value = '已保存'
  window.setTimeout(() => (savedNote.value = ''), 1500)
}

let keyTimer: number | undefined
const onKeyInput = (): void => {
  if (keyTimer) window.clearTimeout(keyTimer)
  keyTimer = window.setTimeout(() => void applyProvider(), 400)
}

const clearKey = (): void => {
  apiKey.value = ''
  saveAiSettings({ provider: provider.value, deepseekKey: '', model: selectedModel.value })
  providerError.value = ''
  connectionNote.value = 'API Key 已清除'
  savedNote.value = ''
  void refreshModels()
}

const testConnection = async (): Promise<void> => {
  connectionNote.value = '正在测试…'
  try {
    const result = await fetchAiProviders(apiKey.value.trim() || undefined)
    const local = result.ollama.models.length
    const cloud = result.deepseek.models.length
    connectionNote.value =
      provider.value === 'deepseek'
        ? cloud > 0
          ? `连接成功：DeepSeek 可用模型 ${cloud} 个`
          : `连接失败：${result.deepseek.error ?? '没有可用模型'}`
        : local > 0
          ? `连接成功：本地可用模型 ${local} 个`
          : `本地 Ollama 不可用：${result.ollama.error ?? '没有可用模型'}`
  } catch (error) {
    connectionNote.value = `连接失败：${error instanceof Error ? error.message : '未知错误'}`
  }
}

onMounted(async () => {
  const settings = loadAiSettings()
  provider.value = settings.provider
  apiKey.value = settings.deepseekKey
  selectedModel.value = settings.model ?? ''
  await refreshModels()
})
</script>

<template>
  <main class="settings-view">
    <header class="interview-header">
      <button type="button" class="icon-button" aria-label="返回" @click="emit('back')">←</button>
      <div class="document-name">
        <h1>设置</h1>
        <span>模型与 API Key 的统一管理</span>
      </div>
    </header>

    <section class="settings-card">
      <h2>模型来源</h2>
      <p class="settings-hint">
        出题、改简历、JD 生成、agent 都会用这里的配置；填了 DeepSeek Key 就走云端，否则自动用本地
        Ollama。
      </p>

      <label class="interview-field">
        <span>模型来源</span>
        <select :value="provider" @change="onProviderChange">
          <option value="ollama">本地 Ollama</option>
          <option value="deepseek">DeepSeek（API Key）</option>
        </select>
      </label>

      <label v-if="provider === 'deepseek'" class="interview-field">
        <span>DeepSeek API Key（只保存在这台浏览器，不会上传）</span>
        <div class="interview-row">
          <input
            v-model="apiKey"
            type="password"
            placeholder="sk-..."
            autocomplete="off"
            @input="onKeyInput"
            @change="applyProvider"
          />
          <button v-if="apiKey" type="button" class="text-button" @click="clearKey">
            清除 Key
          </button>
        </div>
      </label>

      <label class="interview-field">
        <span>默认模型</span>
        <select v-model="selectedModel" @change="onModelChange">
          <option v-for="modelName in providerModels[provider]" :key="modelName" :value="modelName">
            {{ modelName }}
          </option>
        </select>
        <span class="interview-hint">
          <button type="button" class="text-button" @click="refreshModels">刷新可用模型</button>
          <button type="button" class="text-button" @click="testConnection">测试连接</button>
        </span>
      </label>

      <p v-if="connectionNote" class="control-note">{{ connectionNote }}</p>
      <p v-if="providerError" class="control-note control-note--warn">{{ providerError }}</p>
      <p v-if="savedNote" class="control-note">{{ savedNote }}</p>
    </section>
  </main>
</template>
