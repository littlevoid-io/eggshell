<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { openLogStream, post } from './api.js';
import ActionsMenu from './components/ActionsMenu.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import DisplayLayout from './components/DisplayLayout.vue';
import Header from './components/Header.vue';
import LogConsole from './components/LogConsole.vue';
import type { ConnectionState, DashboardStatus, SseEvent } from './types.js';

interface ConfirmState {
  title: string;
  message: string;
  danger?: boolean;
  onConfirm: () => void;
}

const status = ref<DashboardStatus | null>(null);
const logLines = ref<string[]>([]);
const connectionState = ref<ConnectionState>('connecting');
const pendingConfirm = ref<ConfirmState | null>(null);
const isMenuOpen = ref(false);

let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function handleSseEvent(event: SseEvent): void {
  connectionState.value = 'connected';
  if (event.type === 'status') {
    status.value = event.status;
  } else if (event.type === 'logs') {
    logLines.value = event.lines.slice(-2000);
  } else if (event.type === 'log') {
    logLines.value.push(event.line);
    if (logLines.value.length > 2000) {
      logLines.value.splice(0, logLines.value.length - 2000);
    }
  }
}

function handleStreamError(): void {
  connectionState.value = 'offline';
  if (eventSource !== null) {
    eventSource.close();
    eventSource = null;
  }
  if (reconnectTimer === null) {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectStream();
    }, 3000);
  }
}

function handleStreamOpen(): void {
  connectionState.value = 'connected';
}

function connectStream(): void {
  if (eventSource !== null) {
    eventSource.close();
  }
  connectionState.value = 'connecting';
  eventSource = openLogStream(handleSseEvent, handleStreamError, handleStreamOpen);
}

async function executeAction(action: string, body?: unknown): Promise<void> {
  try {
    await post(action, body);
  } catch {
    // Action error handling
  }
}

function handleConfirmRequest(payload: {
  title: string;
  message: string;
  danger?: boolean;
  action: string;
  body?: unknown;
}): void {
  pendingConfirm.value = {
    title: payload.title,
    message: payload.message,
    danger: payload.danger,
    onConfirm: () => {
      executeAction(payload.action, payload.body);
      pendingConfirm.value = null;
    },
  };
}

onMounted(() => {
  connectStream();
});

onUnmounted(() => {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
  }
  if (eventSource !== null) {
    eventSource.close();
  }
});
</script>

<template>
  <div
    class="flex min-h-screen w-full flex-col bg-zinc-950 text-zinc-100 antialiased select-none lg:h-screen lg:overflow-hidden"
  >
    <Header
      :status="status"
      :connection-state="connectionState"
      :is-menu-open="isMenuOpen"
      @toggle-menu="isMenuOpen = !isMenuOpen"
    />

    <main class="flex flex-1 flex-col gap-3 p-3 lg:grid lg:grid-cols-2 lg:overflow-hidden">
      <div class="flex flex-col gap-3 lg:overflow-y-auto pr-1">
        <DisplayLayout :displays="status?.displays ?? []" :windows="status?.windows ?? []" />
      </div>

      <div class="flex flex-col h-[520px] lg:h-full lg:min-h-0 overflow-hidden">
        <LogConsole :lines="logLines" />
      </div>
    </main>

    <ActionsMenu
      :open="isMenuOpen"
      :status="status"
      :disabled="connectionState !== 'connected'"
      @close="isMenuOpen = false"
      @action="executeAction"
      @confirm="handleConfirmRequest"
    />

    <ConfirmDialog
      v-if="pendingConfirm"
      :title="pendingConfirm.title"
      :message="pendingConfirm.message"
      :danger="pendingConfirm.danger"
      @confirm="pendingConfirm.onConfirm()"
      @cancel="pendingConfirm = null"
    />
  </div>
</template>
