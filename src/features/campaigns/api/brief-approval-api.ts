import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { allRows } from '../../../lib/query/all-pages'

/**
 * Accepting a department brief, and finding the ones nobody has (ADR-0070).
 *
 * The account manager approves the campaign; each department's brief is then delivered to its
 * leads, who accept it; and only then can that deliverable's tasks be assigned (d.4). This file is
 * the two halves of that a person touches: the approve action, and the list of what is outstanding.
 *
 * NO CLOCK (d.9). ADR-0066's T+1 still ends at campaign approval and is untouched by this. What is
 * shown here is what is waiting, not a judgement about lateness — a department-level threshold is
 * anticipated and deliberately undecided.
 */

export const briefApprovalKeys = {
  all: ['brief-approval'] as const,
  awaiting: () => [...briefApprovalKeys.all, 'awaiting'] as const,
  approvers: (campaignId: string | null) =>
    [...briefApprovalKeys.all, 'approvers', campaignId] as const,
}

export interface AwaitingBrief {
  briefId: string
  campaignId: string
  campaignName: string
  departmentId: string
  departmentName: string
  /** When the campaign was approved — i.e. when this brief was delivered. */
  deliveredAt: string | null
  /**
   * True when NOBODY in that department can approve it (d.7).
   *
   * This is the one that cannot be fixed by waiting, and it is the exact shape of the 29 August
   * deadlock — a campaign under a client with no account manager could be approved by nobody and
   * sat pending for ever. Power Admin and Traffic Manager can still open it, so nothing is stuck;
   * what this flags is that the department has no voice of its own in the decision.
   */
  noDepartmentApprover: boolean
}

/**
 * Briefs still waiting to be accepted, on campaigns the account manager has already approved.
 *
 * An UNAPPROVED campaign's briefs are excluded deliberately: they have not been delivered yet, so
 * nobody is late and listing them would make the panel a list of work in progress rather than of
 * things somebody is waiting on.
 */
export function useAwaitingBriefApproval() {
  return useQuery({
    queryKey: briefApprovalKeys.awaiting(),
    queryFn: async (): Promise<AwaitingBrief[]> => {
      // Every page (I59.35): tenant-wide, and a brief nobody accepts stays on it.
      const data = await allRows((a, b) =>
        supabaseUntyped
          .from('campaign_briefs')
          .select(
            'id, campaign_id, department_id, ' +
              'campaigns!inner(name, status, approved_at), departments(name)',
          )
          .is('approved_at', null)
          .eq('campaigns.status', 'approved')
          .order('id')
          .range(a, b))

      const rows = data as unknown as {
        id: string
        campaign_id: string
        department_id: string
        campaigns: { name: string; approved_at: string | null } | null
        departments: { name: string } | { name: string }[] | null
      }[]
      if (rows.length === 0) return []

      // Which of these departments has somebody who could accept it — asked of the DATABASE, from
      // grants and scope, never from a role list written here (ADR-0072). One call per campaign
      // rather than one per row: the answer is campaign-shaped, because who is relevant depends on
      // which teams that campaign actually gives work to.
      const campaignIds = [...new Set(rows.map((r) => r.campaign_id))]
      const lists = await Promise.all(campaignIds.map((id) => fetchApprovers(id)))
      const covered = new Set<string>()
      for (const list of lists) {
        for (const [departmentId, people] of list) {
          if (people.length > 0) covered.add(departmentId)
        }
      }

      const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
      return rows.map((r) => ({
        briefId: r.id,
        campaignId: r.campaign_id,
        campaignName: r.campaigns?.name ?? '',
        departmentId: r.department_id,
        departmentName: one(r.departments)?.name ?? '',
        deliveredAt: r.campaigns?.approved_at ?? null,
        noDepartmentApprover: !covered.has(r.department_id),
      }))
    },
  })
}

/**
 * Accept a department brief.
 *
 * The RPC decides who may — `briefs:approve` plus write scope over that department — so nothing
 * here guesses at it. The surface hides the control where the answer is obviously no, and the
 * function refuses where the surface was wrong; the refusal is the authority, not the button.
 */
export interface BriefApprover {
  name: string
  /** True where THIS CAMPAIGN gave them the work, rather than their leading the department.
   *  Edward, 5 Sep: the only names that belong here are the person assigned and the dept lead. */
  isAssignedOwner: boolean
}

/**
 * Who will accept each department's brief, by name (I40).
 *
 * The wizard used to list DEPARTMENTS under "Brief approvers" — Edward, 5 Sep: *"the brief approver
 * is CREATIVE instead of the team leader's name."* Naming people instead then produced the opposite
 * complaint, because the set was built from a role list written here: *"it shows the brief approvers
 * as the assigned owner, the Department Lead and 2 other team leaders and a team member for the same
 * department."*
 *
 * Both faults had one cause — the client deciding who can approve. It cannot: a per-user grant
 * (ADR-0036) is invisible to a role list, and being in the department is not the same as being in
 * scope of it. `department_brief_approvers` answers from grants and scope, the way the refusal does
 * (ADR-0072), and returns the department's own lead plus whoever this campaign actually assigned the
 * work to — the PERSON on the deliverable, not their team: reading it as the team was the second
 * version of the same mistake, because it still listed a lead whose colleague was assigned. The agency-wide failsafe is deliberately absent, for the same reason it is off the
 * `brief_awaiting_approval` notification (ADR-0070 d.6): it can approve everything, so naming it
 * would put the same people under every department.
 *
 * **And neither is a per-user scope grant** (I40.15). Edward, 6 Sep: *"it lists all account managers
 * and all team leads as well as the dept lead."* Five of those names held a `user_scope_grants` row
 * over the department — three Account Managers, the Account Director and a Team Leader, none of them
 * given work here and none of them leading it. A scope grant says what somebody may WRITE, not whose
 * brief they answer for. They can all still approve; being off the list is not being unable, which is
 * the same rule that keeps the failsafe off it.
 */
async function fetchApprovers(campaignId: string): Promise<Map<string, BriefApprover[]>> {
  const { data, error } = await supabaseUntyped.rpc('department_brief_approvers', {
    p_campaign: campaignId,
  })
  if (error) throw error
  const rows = (data ?? []) as {
    department_id: string
    display_name: string
    is_assigned_owner: boolean
  }[]
  const byDepartment = new Map<string, BriefApprover[]>()
  for (const r of rows) {
    byDepartment.set(r.department_id, [
      ...(byDepartment.get(r.department_id) ?? []),
      { name: r.display_name, isAssignedOwner: r.is_assigned_owner },
    ])
  }
  return byDepartment
}

export function useDepartmentApprovers(campaignId: string | null) {
  return useQuery({
    queryKey: briefApprovalKeys.approvers(campaignId),
    // A draft that has not been created yet has nobody to look up — step 1 has not been left.
    enabled: Boolean(campaignId),
    queryFn: () => fetchApprovers(campaignId as string),
  })
}

// Approving and re-opening a department brief from the screen are gone (ADR-0104 d.4, I57.40): the
// only caller could reach neither since ADR-0100. The RPCs stay — pgTAP drives the retired machinery.
