<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
  extractRemainingFields,
  formatLogTime,
  levelColorClass,
  mapLevel,
  matchesLog,
  parseLogLine,
  type LogFilter,
} from '../log.js';
import type { ParsedLogLine } from '../types.js';

const props = defineProps<{
  lines: readonly string[];
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const activeFilter = ref<LogFilter>('all');
const searchQuery = ref('');
let shouldAutoScroll = true;

const parsedLines = computed(() => {
  const result: ParsedLogLine[] = [];
  const limit = Math.min(props.lines.length, 2000);
  const start = Math.max(0, props.lines.length - limit);
  for (let i = start; i < props.lines.length; i++) {
    const raw = props.lines[i];
    if (!raw) continue;
    const item = parseLogLine(raw);
    if (item !== null) {
      result.push(item);
    }
  }
  return result;
});

const warnCount = computed(
  () => parsedLines.value.filter(l => mapLevel(l.level) === 'warn').length
);

const errorCount = computed(
  () => parsedLines.value.filter(l => mapLevel(l.level) === 'error').length
);

const filteredLines = computed(() =>
  parsedLines.value.filter(l => matchesLog(l, activeFilter.value, searchQuery.value.trim()))
);

function handleScroll(): void {
  const el = containerRef.value;
  if (!el) return;
  shouldAutoScroll = el.scrollHeight - el.scrollTop - el.clientHeight <= 30;
}

function scrollToBottom(): void {
  const el = containerRef.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

watch(
  () => filteredLines.value.length,
  async () => {
    if (!shouldAutoScroll) return;
    await nextTick();
    scrollToBottom();
  }
);

onMounted(() => {
  scrollToBottom();
});
</script>

<template>
  <div
    class="flex h-full flex-col rounded-lg border border-zinc-800 bg-zinc-900/60 overflow-hidden"
  >
    <div
      class="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 p-2.5 bg-zinc-900/80"
    >
      <div class="flex items-center gap-1 text-xs">
        <button
          type="button"
          class="rounded px-2.5 py-1 font-medium transition-colors"
          :class="
            activeFilter === 'all' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:bg-zinc-800'
          "
          @click="activeFilter = 'all'"
        >
          All
        </button>
        <button
          type="button"
          class="rounded px-2.5 py-1 font-medium transition-colors"
          :class="
            activeFilter === 'info' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:bg-zinc-800'
          "
          @click="activeFilter = 'info'"
        >
          Info
        </button>
        <button
          type="button"
          class="rounded px-2.5 py-1 font-medium transition-colors"
          :class="
            activeFilter === 'warn'
              ? 'bg-amber-950 text-amber-300 border border-amber-800'
              : 'text-zinc-400 hover:bg-zinc-800'
          "
          @click="activeFilter = 'warn'"
        >
          Warn ({{ warnCount }})
        </button>
        <button
          type="button"
          class="rounded px-2.5 py-1 font-medium transition-colors"
          :class="
            activeFilter === 'error'
              ? 'bg-red-950 text-red-300 border border-red-800'
              : 'text-zinc-400 hover:bg-zinc-800'
          "
          @click="activeFilter = 'error'"
        >
          Error ({{ errorCount }})
        </button>
      </div>

      <div class="w-full sm:w-48">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search logs..."
          class="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
        />
      </div>
    </div>

    <div
      ref="containerRef"
      class="flex-1 overflow-y-auto p-2 font-mono text-xs leading-relaxed"
      @scroll="handleScroll"
    >
      <div
        v-for="(line, index) in filteredLines"
        :key="index"
        class="flex flex-wrap items-baseline gap-x-2 py-0.5"
        :class="levelColorClass(line.level)"
      >
        <span class="text-zinc-500 select-none">{{ formatLogTime(line.time) }}</span>
        <span v-if="line.scope" class="font-semibold text-cyan-400">[{{ line.scope }}]</span>
        <span class="break-all">{{ line.msg }}</span>
        <span v-if="extractRemainingFields(line)" class="break-all text-[11px] text-zinc-500">
          {{ extractRemainingFields(line) }}
        </span>
      </div>

      <div
        v-if="filteredLines.length === 0"
        class="py-16 text-center font-sans text-sm text-zinc-500"
      >
        No matching logs
      </div>
    </div>
  </div>
</template>
