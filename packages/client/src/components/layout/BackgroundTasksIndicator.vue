<script setup lang="ts">
import { computed } from 'vue'
import { useChatStore, type SubagentStream } from '@/stores/hermes/chat'

const chat = useChatStore()

/**
 * Global indicator for background delegated tasks (Hermes background subagents).
 * Shows a small card per running task with an indeterminate progress bar
 * (the agent stream carries text progress, not a percent) plus the current
 * stage text. Clicking a card jumps to that session.
 */

const runningTasks = computed(() =>
  [...chat.subagentStreams.values()]
    .filter(stream => stream.status === 'running')
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(0, 4),
)

function latestLine(stream: SubagentStream): string {
  const entries = stream.entries
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.kind === 'tool' && entry.toolName) {
      return entry.text ? `${entry.toolName} · ${entry.text}` : entry.toolName
    }
    if (entry.kind === 'status' && entry.text) return entry.text
    if (entry.kind === 'text' && entry.text) return entry.text
  }
  return ''
}

function sessionTitle(sessionId: string): string {
  return chat.sessions.find(session => session.id === sessionId)?.title || sessionId
}

function openSession(sessionId: string) {
  void chat.switchSession(sessionId)
}
</script>

<template>
  <div v-if="runningTasks.length" class="bg-tasks-indicator" role="status" aria-live="polite">
    <div
      v-for="task in runningTasks"
      :key="`${task.sessionId}:${task.subagentId}`"
      class="bg-task"
      @click="openSession(task.sessionId)"
    >
      <div class="bg-task-head">
        <span class="pulse-dot" />
        <span class="task-label">{{ task.taskIndex + 1 }}/{{ task.taskCount }}</span>
        <span class="task-goal">{{ task.goal || sessionTitle(task.sessionId) }}</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" />
      </div>
      <div class="task-line">{{ latestLine(task) || task.goal || '…' }}</div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.bg-tasks-indicator {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 4000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 360px;
  pointer-events: auto;
}

.bg-task {
  background: var(--bg-main-surface, #1c1c1e);
  border: 1px solid rgba(var(--border-rgb, 255 255 255), 0.14);
  border-radius: 10px;
  padding: 8px 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
  cursor: pointer;
  transition: border-color 0.15s ease;

  &:hover {
    border-color: rgba(var(--accent-primary-rgb, 59 130 246), 0.6);
  }
}

.bg-task-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pulse-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 50%;
  background: var(--accent-primary, #3b82f6);
  animation: bgTaskPulse 1.4s ease-in-out infinite;
}

@keyframes bgTaskPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.8); }
}

.task-label {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #a1a1aa);
}

.task-goal {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #fafafa);
}

.progress-track {
  height: 4px;
  border-radius: 2px;
  background: rgba(128, 128, 128, 0.22);
  overflow: hidden;
  margin: 6px 0 4px;
}

.progress-fill {
  height: 100%;
  width: 35%;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, var(--accent-primary, #3b82f6), transparent);
  animation: bgTaskSlide 1.3s ease-in-out infinite;
}

@keyframes bgTaskSlide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(320%); }
}

.task-line {
  font-size: 12px;
  color: var(--text-tertiary, #71717a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
