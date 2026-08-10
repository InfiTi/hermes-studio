import Router from '@koa/router'
import { consumeEvolutionWebhook } from '../controllers/evolution-webhook'

/**
 * 进化事件 webhook（公开端点，无鉴权——makeMoney 侧直接 POST 事件）。
 * 与旧 npm 全局包补丁保持一致：POST /webhook。
 */
export const evolutionWebhookRoutes = new Router()

evolutionWebhookRoutes.post('/webhook', consumeEvolutionWebhook)
