import { appendFileSync, existsSync } from 'fs'
import { spawn } from 'child_process'
import { resolve } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { config } from '../config'
import { logger } from '../services/logger'

/**
 * Evolution-event webhook stub (migrated from the patched npm global package).
 *
 * makeMoney side posts evolution events to `POST /webhook`; this stub:
 *   1. appends the event to `<HERMES_WEB_UI_HOME>/webhook-events.jsonl`
 *   2. asynchronously wakes the evo-round-watcher cron job (`cron run`) so the
 *      monitor loop reacts within seconds instead of waiting for the next tick.
 *
 * Paths are computed at runtime (never hardcoded with raw backslashes):
 *   - webhook-events.jsonl: under config.appHome (HERMES_WEB_UI_HOME)
 *   - hermes-agent bin: HERMES_WEBHOOK_AGENT_BIN override, otherwise derived
 *     from the webui home sibling directory F:\Hermes\home\hermes-agent\...
 *
 * The spawned child ALWAYS gets an 'error' handler — the old npm bundle
 * crashed the whole server when spawn failed (ENOENT → uncaught 'error').
 */

const EVO_ROUND_WATCHER_CRON_ID = '05cc8748debb'

function webhookEventsFile(): string {
  return resolve(config.appHome, 'webhook-events.jsonl')
}

function resolveHermesAgentBin(): string | null {
  // 1) 显式环境变量优先（例如 HERMES_WEBHOOK_AGENT_BIN=...）
  const explicit = process.env.HERMES_WEBHOOK_AGENT_BIN?.trim()
  if (explicit) return explicit
  // 2) 由 HERMES_WEB_UI_HOME（webui-data）推导 sibling 目录
  //    F:\Hermes\home\hermes-agent\venv\Scripts\hermes.exe
  const computed = resolve(
    config.appHome,
    '..',
    'home',
    'hermes-agent',
    'venv',
    'Scripts',
    'hermes.exe',
  )
  return existsSync(computed) ? computed : null
}

function resolveHermesHome(): string {
  return resolve(config.appHome, '..', 'home')
}

function resolveCronExecutionsDb(): string {
  return resolve(resolveHermesHome(), 'cron', 'executions.db')
}

/**
 * 防堆积守卫：该 cron job 近 5 分钟内有 running 执行时返回 true。
 *
 * webhook 是"秒级唤醒"，但 scheduler 每 10 分钟也会 builtin 触发；
 * 两者并发跑 agent 会抢同一个 LLM 端点导致挂起（2026-08-10 17:40 实测：
 * builtin run 与 webhook direct run 并发，direct run 卡 20+ 分钟）。
 * 忙时跳过本次唤醒，事件在下一个 tick 自然被 monitor 判到。
 * 任何异常一律 fail-open（照常 spawn，不阻塞唤醒）。
 */
function isEvoRoundWatcherBusy(now = Date.now(), windowMs = 30 * 60 * 1000): boolean {
  try {
    const dbPath = resolveCronExecutionsDb()
    if (!existsSync(dbPath)) return false
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const rows = db.prepare(
        "SELECT started_at FROM executions WHERE job_id = ? AND status = 'running'",
      ).all(EVO_ROUND_WATCHER_CRON_ID) as Array<{ started_at: string | null }>
      return rows.some(row => {
        if (!row.started_at) return false
        const started = Date.parse(row.started_at)
        return Number.isFinite(started) && (now - started) < windowMs
      })
    } finally {
      db.close()
    }
  } catch (err) {
    logger.warn(err, 'webhook: cron busy-check failed, proceeding with wakeup')
    return false
  }
}

export async function consumeEvolutionWebhook(ctx: any): Promise<void> {
  const body = (ctx.request && ctx.request.body) || {}
  const event = body.event
  if (!event) {
    ctx.status = 400
    ctx.body = { error: 'Missing event field' }
    return
  }

  logger.info('Received webhook event: %s', event)

  try {
    appendFileSync(
      webhookEventsFile(),
      JSON.stringify({
        ts: Date.now(),
        event,
        title: body.title ?? null,
        level: body.level ?? 'info',
        body: String(body.body ?? '').slice(0, 2000),
      }) + '\n',
    )
  } catch (err) {
    logger.warn(err, 'webhook: failed to append webhook-events.jsonl')
  }

  const hermesBin = resolveHermesAgentBin()
  if (hermesBin) {
    if (isEvoRoundWatcherBusy()) {
      logger.info('webhook: evo-round-watcher already running, skipping cron wakeup')
    } else {
      try {
        const child = spawn(hermesBin, ['cron', 'run', EVO_ROUND_WATCHER_CRON_ID], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          // 显式指定 HERMES_HOME（F:\Hermes\home），不依赖子进程的隐式探测
          env: {
            ...process.env,
            HERMES_HOME: resolveHermesHome(),
          },
        })
        // 必须挂 error handler：spawn 失败（ENOENT 等）不能崩掉整个 server
        child.on('error', (err) => {
          logger.warn(err, 'webhook: spawn hermes cron run failed (%s)', hermesBin)
        })
        child.unref()
      } catch (err) {
        logger.warn(err, 'webhook: spawn setup failed')
      }
    }
  } else {
    logger.warn('webhook: hermes-agent bin not found, skipping cron wakeup')
  }

  ctx.body = { ok: true }
}
