import { appendFileSync, existsSync } from 'fs'
import { spawn } from 'child_process'
import { resolve } from 'path'
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
  } else {
    logger.warn('webhook: hermes-agent bin not found, skipping cron wakeup')
  }

  ctx.body = { ok: true }
}
