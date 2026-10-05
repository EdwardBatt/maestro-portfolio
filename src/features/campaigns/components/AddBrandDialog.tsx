import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, ModalFooter, ModalHeader } from '../../../components/Modal'
import { NoticeDialog } from '../../../components/Notice'
import { Field } from '../../../components/Field'
import { Button } from '../../../components/Button'
import { isDuplicateBrandName, useCreateBrand } from '../../../lib/brands'
import { isPermissionDenied } from '../../../lib/errors/classify'

/**
 * Register a brand without leaving the wizard (I35.3).
 *
 * Edward, 3 Sep: *"if no brand has already been created for the client in particular (during
 * client registration) the brand dropdown should offer the option to add the brand, if this option
 * is selected it should open a modal to enter the Brand/IP details **as per the existing brand
 * registration on client registration**."*
 *
 * ONE FIELD, AND THAT IS NOT AN OVERSIGHT. A brand today is a client and a name — `brands` holds
 * nothing else — so "as per client registration" IS one text box. Inventing a richer form here
 * would put fields in the wizard that the clients screen does not have and the schema cannot
 * store. Further Brand/IP attributes are tracked on `I35.3` as a future step with its own schema
 * decision.
 *
 * The INSERT is `lib/brands.ts`, shared with client registration, so the two cannot drift — which
 * is the whole force of the word "as per".
 */
export interface AddBrandDialogProps {
  clientId: string
  clientName: string
  /** Called with the new brand's id, so the wizard can select what was just made. */
  onCreated: (brandId: string) => void
  onCancel: () => void
}

export function AddBrandDialog({ clientId, clientName, onCreated, onCancel }: AddBrandDialogProps) {
  const { t } = useTranslation()
  const create = useCreateBrand()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  // ADR-0092 d.2/d.3: a genuine failure (not a duplicate name) is an error MODAL. A permission
  // denial is said plainly and is NOT reportable; an unexpected failure is.
  const [failure, setFailure] = useState<{ message: string; reportable: boolean; cause?: unknown } | null>(null)

  function submit() {
    const trimmed = name.trim()
    if (!trimmed) return
    setError(null)
    setFailure(null)
    create.mutate(
      { clientId, name: trimmed },
      {
        onSuccess: (brandId) => onCreated(brandId),
        onError: (err) => {
          // A duplicate name is field validation — "that name exists" — and stays on the field.
          if (isDuplicateBrandName(err)) setError(t('campaigns.brandDialog.exists'))
          // A permission denial: say exactly that, and do not offer to report it (it is not a bug).
          else if (isPermissionDenied(err)) setFailure({ message: t('campaigns.brandDialog.noPermission'), reportable: false })
          // Anything else is an unexpected failure: reportable.
          else setFailure({ message: t('campaigns.brandDialog.saveFailed'), reportable: true, cause: err })
        },
      },
    )
  }

  const folders = ['folderLogos', 'folderFonts', 'folderGuidelines', 'folderKeyVisuals'] as const

  return (
    <Modal onClose={onCancel} labelledById="add-brand-title" testId="add-brand-dialog">
      <ModalHeader
        id="add-brand-title"
        eyebrow={t('campaigns.brandDialog.eyebrow')}
        // Names the client, because the wizard's client picker is a step away by then and a brand
        // registered under the wrong client is a folder tree in the wrong place.
        title={t('campaigns.brandDialog.title', { client: clientName })}
        subtitle={t('campaigns.brandDialog.intro')}
      />
      <form
        className="modal-body"
        onSubmit={(e) => { e.preventDefault(); submit() }}
      >
        {/* ONE field, by the data model (a brand is a client and a name — the code note below the
            imports says why). The frame's "short name" has no column, so it is not shown; the
            visual — the shell, the folder preview — is the frame's. */}
        <Field label={t('campaigns.brandDialog.name')} required error={error ?? undefined}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="add-brand-name"
          />
        </Field>

        {/* The four folders `app.provision_brand_folders` creates on insert — shown, not invented. */}
        <div className="folder-preview">
          <span className="folder-preview-head">{t('campaigns.brandDialog.foldersHeading')}</span>
          <div className="folder-preview-chips">
            {folders.map((k) => (
              <span className="folder-chip" key={k}>
                <span className="folder-chip-icon" aria-hidden="true" />
                {t(`campaigns.brandDialog.${k}`)}
              </span>
            ))}
          </div>
          <span className="folder-preview-note">{t('campaigns.brandDialog.foldersNote')}</span>
        </div>
        {error && <span hidden data-testid="add-brand-error">{error}</span>}
      </form>
      <ModalFooter note={t('campaigns.brandDialog.note')}>
        <Button
          type="button"
          variant="primary"
          busy={create.isPending}
          disabled={!name.trim()}
          onClick={submit}
          data-testid="add-brand-submit"
        >
          {t('campaigns.brandDialog.submit')}
        </Button>
        <Button variant="secondary" onClick={onCancel} data-testid="add-brand-cancel">
          {t('schedule.cancel')}
        </Button>
      </ModalFooter>
      {failure && (
        <NoticeDialog
          kind="error"
          message={failure.message}
          testId="add-brand-failure"
          reportable={failure.reportable}
          reportCause={failure.cause}
          reportWhere="Add brand"
          reportContext={`Registering a brand for ${clientName}`}
          onClose={() => setFailure(null)}
        />
      )}
    </Modal>
  )
}
