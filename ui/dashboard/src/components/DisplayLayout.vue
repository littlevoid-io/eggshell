<script setup lang="ts">
import { computed } from 'vue';
import type { DisplaySnapshot, WindowSummary } from '../types.js';

const props = defineProps<{
  displays: readonly DisplaySnapshot[];
  windows: readonly WindowSummary[];
}>();

const PADDING = 20;
const BASE_WIDTH = 760;

function computeBounds(displays: readonly DisplaySnapshot[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const item of displays) {
    minX = Math.min(minX, item.bounds.x);
    minY = Math.min(minY, item.bounds.y);
    maxX = Math.max(maxX, item.bounds.x + item.bounds.width);
    maxY = Math.max(maxY, item.bounds.y + item.bounds.height);
  }

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  return { minX, minY, width, height };
}

const union = computed(() => computeBounds(props.displays));
const scale = computed(() => BASE_WIDTH / union.value.width);

const viewBox = computed(() => {
  const width = BASE_WIDTH + PADDING * 2;
  const height = union.value.height * scale.value + PADDING * 2;
  return `0 0 ${width} ${height}`;
});

const mappedDisplays = computed(() => {
  const { minX, minY } = union.value;
  const factor = scale.value;

  return props.displays.map(d => ({
    id: d.id,
    label: d.label || `Display ${d.id}`,
    hasTouch: d.touchSupport === 'available',
    x: PADDING + (d.bounds.x - minX) * factor,
    y: PADDING + (d.bounds.y - minY) * factor,
    width: d.bounds.width * factor,
    height: d.bounds.height * factor,
  }));
});

const activeWindows = computed(() => {
  const { minX, minY } = union.value;
  const factor = scale.value;

  return props.windows
    .filter(w => !w.isDestroyed && w.bounds !== null)
    .map(w => ({
      id: w.id,
      x: PADDING + (w.bounds!.x - minX) * factor,
      y: PADDING + (w.bounds!.y - minY) * factor,
      width: w.bounds!.width * factor,
      height: w.bounds!.height * factor,
    }));
});
</script>

<template>
  <div class="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-xs font-semibold tracking-wider text-zinc-400 uppercase">
        Displays & Windows
      </h2>
      <span class="text-xs text-zinc-500">
        {{ displays.length }} display{{ displays.length === 1 ? '' : 's' }}
      </span>
    </div>

    <div v-if="displays.length === 0" class="py-12 text-center text-sm text-zinc-500">
      No displays detected
    </div>

    <div v-else class="w-full overflow-hidden rounded bg-zinc-950 p-2">
      <svg class="w-full h-auto block" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet">
        <g v-for="d in mappedDisplays" :key="d.id">
          <rect
            :x="d.x"
            :y="d.y"
            :width="d.width"
            :height="d.height"
            rx="6"
            class="fill-zinc-900 stroke-zinc-700"
            stroke-width="1.5"
          />
          <text :x="d.x + 10" :y="d.y + 20" font-size="11" font-weight="600" class="fill-zinc-300">
            {{ d.label }}
          </text>
          <g v-if="d.hasTouch">
            <rect
              :x="d.x + 10"
              :y="d.y + 28"
              width="44"
              height="16"
              rx="3"
              class="fill-emerald-950/80 stroke-emerald-700/60"
              stroke-width="1"
            />
            <text
              :x="d.x + 32"
              :y="d.y + 39"
              font-size="9"
              text-anchor="middle"
              class="fill-emerald-400 font-medium"
            >
              Touch
            </text>
          </g>
        </g>

        <g v-for="w in activeWindows" :key="w.id">
          <rect
            :x="w.x + 4"
            :y="w.y + 4"
            :width="Math.max(1, w.width - 8)"
            :height="Math.max(1, w.height - 8)"
            rx="4"
            class="fill-blue-500/20 stroke-blue-400/70"
            stroke-width="1.5"
          />
          <text
            :x="w.x + w.width / 2"
            :y="w.y + w.height / 2 + 4"
            font-size="11"
            font-weight="500"
            text-anchor="middle"
            class="fill-blue-200"
          >
            {{ w.id }}
          </text>
        </g>
      </svg>
    </div>
  </div>
</template>
