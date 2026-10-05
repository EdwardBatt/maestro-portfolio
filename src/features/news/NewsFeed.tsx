import { useTranslation } from 'react-i18next'

/**
 * Company & industry news feed (task M7.4, ADR-0018 §9). Every role's default
 * dashboard carries this slot to keep users current on company and industry
 * developments. Interim: a placeholder marking that it is coming. The real feed
 * (content source / authoring, industry pull, per-tenant, moderation) is post-
 * pilot; the content-source choice is OD 31.
 */
export function NewsFeed() {
  const { t } = useTranslation()
  return (
    <aside className="news-feed" data-testid="news-feed" aria-label={t('news.title')}>
      <div className="news-head">
        <h2 className="news-title">{t('news.title')}</h2>
        <span className="news-tag">{t('news.soonTag')}</span>
      </div>
      <p className="news-empty muted">{t('news.comingSoon')}</p>
    </aside>
  )
}
