import { useMutation } from '@tanstack/react-query'
import { supabaseUntyped } from './supabase'
import { useAuth } from '../app/auth-context'
import { useInvalidateFolders } from './assets/folders'

/**
 * Registering a brand (I35.3).
 *
 * WHY IT IS HERE. Two surfaces do this now: client registration, where it has always lived, and
 * the Brief Wizard, where Edward asked for it on 3 Sep — *"if no brand has already been created
 * for the client... the brand dropdown should offer the option to add the brand"*, explicitly
 * **as per the existing brand registration on client registration**. Two copies of one insert is
 * how "as per" quietly stops being true, and a brand created through the wizard differing from
 * one created through registration is precisely the difference somebody would notice and nobody
 * could explain. A feature cannot import another feature's `api/` (`AGENTS.md` §3), so the
 * shared writer lives in `lib/` — the same reasoning that moved the folder tree at I35.8.
 *
 * WHAT A BRAND IS, TODAY: a client and a name. That is all `brands` holds, and it is exactly what
 * client registration collects, so the wizard's modal is one field rather than an invented form.
 * Additional Brand/IP attributes are a known future step (tracked on `I35.3`) and want their own
 * schema decision — they are not smuggled in here.
 */

export interface NewBrand {
  clientId: string
  name: string
  /** ADR-0123 d.7: what lists and pickers show ("Luma · LUMA"). Optional; blank is stored as null. */
  shortName?: string | null
}

/**
 * Returns the new brand's id, which client registration ignores and the wizard needs: it selects
 * the brand it just made and shows its folders, which are provisioned by
 * `app.provision_brand_folders` on insert and therefore exist by the time this resolves.
 */
export function useCreateBrand() {
  const { claims } = useAuth()
  const invalidateFolders = useInvalidateFolders()
  return useMutation({
    mutationFn: async (args: NewBrand): Promise<string> => {
      const { data, error } = await supabaseUntyped
        .from('brands')
        .insert({ tenant_id: claims.tenantId, client_id: args.clientId, name: args.name.trim(), short_name: args.shortName?.trim() || null })
        .select('id')
        .single()
      if (error) throw error
      return (data as { id: string }).id
    },
    // The insert fires `app.provision_brand_folders`, so the client's folder tree gained Logos /
    // Fonts / Guidelines / Key Visuals and whatever was cached is now wrong. That is what this
    // mutation DID, so it is invalidated here rather than left to a caller to remember — and it
    // is a `lib/assets` concern, not a feature's.
    //
    // The BRAND LISTS are still each caller's business: they live under the callers' own query
    // key namespaces, and a shared writer that knew either of those would be a `lib/` module
    // reaching back into a feature, which is the dependency this file exists to avoid.
    onSuccess: (_id, args) => void invalidateFolders(args.clientId),
  })
}

/**
 * A brand name is unique per client (`uq_brands_client_name`). It is the one brand error somebody
 * routinely causes — two people registering "Harmony" against the same client — so it reads as a
 * sentence rather than as a constraint name.
 */
export function isDuplicateBrandName(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}
