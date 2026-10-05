import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { formatIraqDate } from '../../../lib/time/iraq'
import type { SimilarJob } from '../api/intake-api'
import { matchPercent } from '../lib/single-job'

/**
 * SJ-v3-S1 — a similar job on this client (Figma `B · SINGLE JOB — BRIEF FIRST`, 22 Sep; the
 * mechanics are ADR-0086 d.2–d.7).
 *
 * Fires on Next from Who and when — the Figma's step 3 — over this client's open jobs only, once
 * the title is typed. It warns and offers; it never refuses (d.4). The score is SHOWN — a number
 * the person can see is a number they can disagree with (d.3). CHECK THIS FIRST in amber; the
 * best match in an amber card, the others plain; each with who raised it, when, which department,
 * and its status. "Add it to that job" attaches this draft to the selected one, "Keep them
 * separate" carries on to the review.
 *
 * Presentation only: the rows arrive ranked from `similar_open_jobs`; the choices are callbacks.
 */
export function SimilarJobsDialog({
  jobs,
  clientName,
  askedBy,
  busy,
  onAttach,
  onKeepSeparate,
  onCancel,
}: {
  jobs: SimilarJob[]
  clientName: string
  askedBy: string
  busy: boolean
  onAttach: (targetCampaignId: string) => void
  onKeepSeparate: () => void
  onCancel: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'ar' ? 'ar' : 'en'
  const [selected, setSelected] = useState(jobs[0]?.campaignId ?? '')
  const top = jobs[0]

  return (
    <Modal onClose={() => !busy && onCancel()} labelledById="sj-similar-title" testId="sj-similar-dialog">
      <header className="flow-dialog-head">
        <span className="tag tag-amber">{t('intake.similar.eyebrow')}</span>
        <h2 id="sj-similar-title" className="flow-dialog-title">{t('intake.similar.title', { client: clientName })}</h2>
        <p className="flow-dialog-sub">
          {top
            ? t('intake.similar.intro', {
                name: top.name,
                when: top.raisedAt ? formatIraqDate(top.raisedAt, locale) : t('intake.similar.recently'),
                who: top.raisedBy ?? t('intake.similar.someone'),
                department: top.departmentNames[0] ?? t('intake.similar.aDepartment'),
              })
            : null}
        </p>
      </header>

      <div className="flow-dialog-body">
        <div className="similar-list" data-testid="sj-similar-list" role="radiogroup">
          {jobs.map((j, i) => {
            const on = j.campaignId === selected
            return (
              // A div with the radio role, not a button: the name inside is a link that opens the
              // existing job in a new tab (ADR-0086 d.7 — the request being typed is not lost).
              <div
                key={j.campaignId}
                role="radio"
                tabIndex={0}
                aria-checked={on}
                className={`similar-card${i === 0 ? ' is-top' : ''}${on ? ' is-on' : ''}`}
                onClick={() => setSelected(j.campaignId)}
                onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setSelected(j.campaignId) } }}
                data-testid={`sj-similar-${j.campaignId}`}
              >
                <span className="similar-card-head">
                  <a
                    className="similar-card-name"
                    href={`/campaigns/${j.campaignId}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title={t('intake.similar.openIt')}
                    data-testid={`sj-similar-open-${j.campaignId}`}
                  >
                    {j.name}
                  </a>
                  <span className={`tag ${i === 0 ? 'tag-amber' : 'tag-neutral'}`}>
                    <span data-testid={`sj-similar-score-${j.campaignId}`}>{t('intake.similar.score', { pct: matchPercent(j.score) })}</span>
                  </span>
                </span>
                <span className="similar-card-meta">
                  <span>
                    {[j.raisedBy, j.raisedAt ? formatIraqDate(j.raisedAt, locale) : null, j.departmentNames[0] ?? null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className={`tag ${j.status === 'approved' ? 'tag-accent' : 'tag-ok'}`}>{t(`intake.similar.status.${j.status}`, { defaultValue: j.status })}</span>
                </span>
              </div>
            )
          })}
        </div>
        <p className="similar-why" data-testid="sj-similar-why">
          {askedBy ? t('intake.similar.why', { who: askedBy }) : t('intake.similar.whyNoOne')}
        </p>
      </div>

      <footer className="flow-dialog-foot">
        <Button type="button" variant="primary" className="btn-amber" busy={busy} disabled={!selected} onClick={() => onAttach(selected)} data-testid="sj-similar-attach">
          {t('intake.similar.attach')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onKeepSeparate} data-testid="sj-similar-separate">
          {t('intake.similar.keepSeparate')}
        </Button>
      </footer>
    </Modal>
  )
}
