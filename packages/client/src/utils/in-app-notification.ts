import { createDiscreteApi, darkTheme, type NotificationApi } from 'naive-ui'

/**
 * In-app completion banner (naive-ui discrete API).
 * Works outside component setup, so chat store can trigger it on run completion.
 * Complements the OS-level system notification: this one is always visible in
 * the page, even while the document is focused (system notifications only show
 * when the app is in the background).
 */

let notificationApi: NotificationApi | null = null

function notification(): NotificationApi {
  if (!notificationApi) {
    notificationApi = createDiscreteApi(['notification'], {
      configProviderProps: { theme: darkTheme },
    }).notification
  }
  return notificationApi
}

export function showInAppCompletionNotification(options: {
  title: string
  body?: string
}): void {
  try {
    const api = notification()
    api.success({
      title: options.title,
      content: options.body,
      duration: 8000,
      keepAliveOnHover: true,
    })
  } catch (err) {
    console.warn('[in-app-notification] failed to show banner:', err)
  }
}
