<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import type { DashboardStatus } from '../types.js';

const props = defineProps<{
  open: boolean;
  status: DashboardStatus | null;
  disabled: boolean;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'action', action: string, body?: unknown): void;
  (
    event: 'confirm',
    payload: { title: string; message: string; danger?: boolean; action: string; body?: unknown }
  ): void;
}>();

const isOfflineShowing = computed(() => props.status?.overlays.offline.isShowing ?? false);
const isCompanionShowing = computed(() => props.status?.overlays.companion.visible ?? false);

function handleAction(action: string, body?: unknown): void {
  emit('close');
  emit('action', action, body);
}

function onReloadWindows(): void {
  emit('close');
  emit('confirm', {
    title: 'Reload Windows',
    message: 'Reload all exhibit windows?',
    action: 'reload-windows',
  });
}

function onToggleOffline(): void {
  const current = isOfflineShowing.value;
  emit('close');
  emit('confirm', {
    title: current ? 'Hide Offline Overlay' : 'Show Offline Overlay',
    message: `Set offline overlay to ${current ? 'hidden' : 'visible'}?`,
    action: 'toggle-offline',
    body: { show: !current },
  });
}

function onRestart(): void {
  emit('close');
  emit('confirm', {
    title: 'Restart Shell',
    message: 'Restart the entire eggshell process?',
    danger: true,
    action: 'restart',
  });
}

function onQuit(): void {
  emit('close');
  emit('confirm', {
    title: 'Quit Shell',
    message: 'Exit eggshell and close all exhibit windows?',
    danger: true,
    action: 'quit',
  });
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) {
    emit('close');
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 flex justify-end">
    <div
      class="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
      @click="emit('close')"
    />

    <aside
      class="relative z-10 flex h-full w-full max-w-xs flex-col border-l border-zinc-800 bg-zinc-900 p-4 shadow-2xl"
    >
      <div class="mb-4 flex items-center justify-between border-b border-zinc-800 pb-3">
        <h2 class="text-xs font-semibold tracking-wider text-zinc-400 uppercase">Quick Actions</h2>
        <button
          type="button"
          aria-label="Close menu"
          class="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          @click="emit('close')"
        >
          <svg
            class="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
        <button
          type="button"
          :disabled="disabled"
          class="rounded border border-zinc-700 bg-zinc-800/80 px-3 py-2.5 text-left text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
          @click="handleAction('focus-windows')"
        >
          Bring windows to front
        </button>

        <button
          type="button"
          :disabled="disabled"
          class="rounded border border-zinc-700 bg-zinc-800/80 px-3 py-2.5 text-left text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
          @click="handleAction('recalculate-layout')"
        >
          Re-apply layout
        </button>

        <button
          type="button"
          :disabled="disabled"
          class="rounded border border-zinc-700 bg-zinc-800/80 px-3 py-2.5 text-left text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
          @click="onReloadWindows"
        >
          Reload windows
        </button>

        <button
          type="button"
          :disabled="disabled"
          class="rounded border px-3 py-2.5 text-left text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          :class="
            isOfflineShowing
              ? 'border-amber-700 bg-amber-950/60 text-amber-200 hover:bg-amber-900/60'
              : 'border-zinc-700 bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700'
          "
          @click="onToggleOffline"
        >
          Offline overlay: {{ isOfflineShowing ? 'ON' : 'OFF' }}
        </button>

        <button
          type="button"
          :disabled="disabled"
          class="rounded border px-3 py-2.5 text-left text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          :class="
            isCompanionShowing
              ? 'border-indigo-700 bg-indigo-950/60 text-indigo-200 hover:bg-indigo-900/60'
              : 'border-zinc-700 bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700'
          "
          @click="handleAction('toggle-companion', { show: !isCompanionShowing })"
        >
          Companion overlay: {{ isCompanionShowing ? 'ON' : 'OFF' }}
        </button>

        <div class="my-2 border-t border-zinc-800" />

        <button
          type="button"
          :disabled="disabled"
          class="rounded border border-red-900/50 bg-red-950/30 px-3 py-2.5 text-left text-xs font-medium text-red-300 transition-colors hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-40"
          @click="onRestart"
        >
          Restart shell
        </button>

        <button
          type="button"
          :disabled="disabled"
          class="rounded border border-red-900/60 bg-red-950/50 px-3 py-2.5 text-left text-xs font-medium text-red-300 transition-colors hover:bg-red-900/70 disabled:cursor-not-allowed disabled:opacity-40"
          @click="onQuit"
        >
          Quit
        </button>
      </div>

      <div class="mt-4 border-t border-zinc-800 pt-3 text-center text-[11px] text-zinc-500">
        Tap outside or press Esc to close
      </div>
    </aside>
  </div>
</template>
