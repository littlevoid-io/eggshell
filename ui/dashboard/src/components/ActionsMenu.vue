<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import type { ActionConfirmPayload, DashboardStatus } from '../types.js';
import ActionsList from './ActionsList.vue';

const props = defineProps<{
  open: boolean;
  status: DashboardStatus | null;
  disabled: boolean;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'action', action: string, body?: unknown): void;
  (event: 'confirm', payload: ActionConfirmPayload): void;
}>();

function handleAction(action: string, body?: unknown): void {
  emit('close');
  emit('action', action, body);
}

function handleConfirm(payload: ActionConfirmPayload): void {
  emit('close');
  emit('confirm', payload);
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

      <ActionsList
        :status="status"
        :disabled="disabled"
        @action="handleAction"
        @confirm="handleConfirm"
      />

      <div class="mt-4 border-t border-zinc-800 pt-3 text-center text-[11px] text-zinc-500">
        Tap outside or press Esc to close
      </div>
    </aside>
  </div>
</template>
