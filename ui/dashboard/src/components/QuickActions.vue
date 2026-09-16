<script setup lang="ts">
import { computed } from 'vue';
import type { DashboardStatus } from '../types.js';

const props = defineProps<{
  status: DashboardStatus | null;
  disabled: boolean;
}>();

const emit = defineEmits<{
  (event: 'action', action: string, body?: unknown): void;
  (
    event: 'confirm',
    payload: { title: string; message: string; danger?: boolean; action: string; body?: unknown }
  ): void;
}>();

const isOfflineShowing = computed(() => props.status?.overlays.offline.isShowing ?? false);
const isCompanionShowing = computed(() => props.status?.overlays.companion.visible ?? false);

function onReloadWindows(): void {
  emit('confirm', {
    title: 'Reload Windows',
    message: 'Reload all exhibit windows?',
    action: 'reload-windows',
  });
}

function onToggleOffline(): void {
  const current = isOfflineShowing.value;
  emit('confirm', {
    title: current ? 'Hide Offline Overlay' : 'Show Offline Overlay',
    message: `Set offline overlay to ${current ? 'hidden' : 'visible'}?`,
    action: 'toggle-offline',
    body: { show: !current },
  });
}

function onRestart(): void {
  emit('confirm', {
    title: 'Restart Shell',
    message: 'Restart the entire eggshell process?',
    danger: true,
    action: 'restart',
  });
}

function onQuit(): void {
  emit('confirm', {
    title: 'Quit Shell',
    message: 'Exit eggshell and close all exhibit windows?',
    danger: true,
    action: 'quit',
  });
}
</script>

<template>
  <div class="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
    <h2 class="mb-3 text-xs font-semibold tracking-wider text-zinc-400 uppercase">Quick Actions</h2>

    <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <button
        type="button"
        :disabled="disabled"
        class="rounded border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-left text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
        @click="emit('action', 'focus-windows')"
      >
        Bring windows to front
      </button>

      <button
        type="button"
        :disabled="disabled"
        class="rounded border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-left text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
        @click="emit('action', 'recalculate-layout')"
      >
        Re-apply layout
      </button>

      <button
        type="button"
        :disabled="disabled"
        class="rounded border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-left text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
        @click="onReloadWindows"
      >
        Reload windows
      </button>

      <button
        type="button"
        :disabled="disabled"
        class="rounded border px-3 py-2 text-left text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
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
        class="rounded border px-3 py-2 text-left text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        :class="
          isCompanionShowing
            ? 'border-indigo-700 bg-indigo-950/60 text-indigo-200 hover:bg-indigo-900/60'
            : 'border-zinc-700 bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700'
        "
        @click="emit('action', 'toggle-companion', { show: !isCompanionShowing })"
      >
        Companion overlay: {{ isCompanionShowing ? 'ON' : 'OFF' }}
      </button>

      <button
        type="button"
        :disabled="disabled"
        class="rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-left text-xs font-medium text-red-300 transition-colors hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-40"
        @click="onRestart"
      >
        Restart shell
      </button>

      <button
        type="button"
        :disabled="disabled"
        class="rounded border border-red-900/60 bg-red-950/50 px-3 py-2 text-left text-xs font-medium text-red-300 transition-colors hover:bg-red-900/70 sm:col-span-2 disabled:cursor-not-allowed disabled:opacity-40"
        @click="onQuit"
      >
        Quit
      </button>
    </div>
  </div>
</template>
