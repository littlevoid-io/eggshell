<script setup lang="ts">
defineProps<{
  title: string;
  message: string;
  danger?: boolean;
}>();

const emit = defineEmits<{
  (event: 'confirm'): void;
  (event: 'cancel'): void;
}>();
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    @keydown.escape="emit('cancel')"
    tabindex="0"
  >
    <div class="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
      <h3 class="text-base font-semibold text-zinc-100">
        {{ title }}
      </h3>
      <p class="mt-2 text-sm text-zinc-300">
        {{ message }}
      </p>
      <div class="mt-5 flex justify-end gap-3">
        <button
          type="button"
          class="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
          @click="emit('cancel')"
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded px-3 py-1.5 text-xs font-medium text-white transition-colors"
          :class="
            danger ? 'bg-red-600 hover:bg-red-500' : 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200'
          "
          @click="emit('confirm')"
        >
          Confirm
        </button>
      </div>
    </div>
  </div>
</template>
