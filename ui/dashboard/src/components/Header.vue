<script setup lang="ts">
import { computed } from 'vue';
import type { ConnectionState, DashboardStatus } from '../types.js';

const props = defineProps<{
  status: DashboardStatus | null;
  connectionState: ConnectionState;
  isMenuOpen?: boolean;
}>();

const emit = defineEmits<{
  (event: 'toggleMenu'): void;
}>();

function formatUptime(seconds: number): string {
  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

const uptimeText = computed(() => {
  if (!props.status) return '—';
  return formatUptime(props.status.uptimeSeconds);
});

const memoryText = computed(() => {
  if (!props.status?.memory) return '—';
  const rssMb = Math.round(props.status.memory.rss / (1024 * 1024));
  const heapMb = Math.round(props.status.memory.heapUsed / (1024 * 1024));
  return `${rssMb} MB (${heapMb} MB heap)`;
});

const connectionPillClasses = computed(() => {
  switch (props.connectionState) {
    case 'connected':
      return 'bg-emerald-950 text-emerald-400 border-emerald-800';
    case 'connecting':
      return 'bg-amber-950 text-amber-400 border-amber-800';
    case 'offline':
      return 'bg-red-950 text-red-400 border-red-800';
  }
});

const connectionDotClasses = computed(() => {
  switch (props.connectionState) {
    case 'connected':
      return 'bg-emerald-400';
    case 'connecting':
      return 'bg-amber-400 animate-pulse';
    case 'offline':
      return 'bg-red-400';
  }
});
</script>

<template>
  <header
    class="flex flex-wrap items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-4 py-2.5"
  >
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2">
        <span class="font-semibold tracking-tight text-zinc-100">
          {{ status?.productName ?? 'Eggshell' }}
        </span>
        <span v-if="status?.version" class="text-xs text-zinc-400"> v{{ status.version }} </span>
      </div>

      <span
        v-if="status?.isDev"
        class="rounded border border-amber-700/50 bg-amber-950/60 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-amber-300 uppercase"
      >
        DEV
      </span>
    </div>

    <div class="flex items-center gap-4 text-xs">
      <div class="hidden sm:flex items-center gap-3 text-zinc-400">
        <div>
          <span class="text-zinc-500">Uptime:</span>
          <span class="ml-1 font-mono text-zinc-200">{{ uptimeText }}</span>
        </div>
        <div>
          <span class="text-zinc-500">Memory:</span>
          <span class="ml-1 font-mono text-zinc-200">{{ memoryText }}</span>
        </div>
      </div>

      <div
        class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
        :class="connectionPillClasses"
      >
        <span class="h-1.5 w-1.5 rounded-full" :class="connectionDotClasses" />
        <span class="capitalize">{{ connectionState }}</span>
      </div>

      <button
        type="button"
        aria-label="Quick Actions"
        :aria-expanded="isMenuOpen"
        class="inline-flex items-center justify-center rounded border border-zinc-700 bg-zinc-800 p-1.5 text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white focus:outline-none"
        @click="emit('toggleMenu')"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
    </div>
  </header>
</template>
