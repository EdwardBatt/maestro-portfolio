/**
 * "You are the most booked in your team this week" (plan View 2, Your week — I59 Track 6).
 *
 * True when the viewer has a team, at least one teammate is on it, and the viewer's booked share of
 * the week (`utilPct`, the Team page's figure) is strictly higher than every teammate's. A tie is
 * not "the most". Pure — the week's figures come from `useTeamLoad`.
 */
export function isMostBookedInTeam(
  people: readonly { userId?: string | null; teamId: string | null; utilPct: number }[],
  userId: string | null,
): boolean {
  if (!userId) return false
  const me = people.find((p) => p.userId === userId)
  if (!me || !me.teamId) return false
  const mates = people.filter((p) => p.teamId === me.teamId && p.userId !== userId)
  if (mates.length === 0) return false
  return mates.every((p) => me.utilPct > p.utilPct)
}
