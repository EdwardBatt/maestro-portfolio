import { useTranslation } from 'react-i18next'

/** The one-line words for what a task waits for (the row link and the editor's chips agree). */
export function useWaitsWords() {
  const { t } = useTranslation()
  return (titles: readonly string[]) =>
    titles.length === 0
      ? t('schedule.sc.waits.any')
      : titles.length === 1
        ? t('schedule.sc.waits.one', { task: titles[0] })
        : t('schedule.sc.waits.many', { task: titles[0], count: titles.length - 1 })
}
