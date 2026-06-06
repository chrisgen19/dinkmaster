import { getArenaInviteByCode } from '@/lib/arenas';
import { getCurrentUser } from '@/lib/session';
import { InviteView } from './invite-view';

// Invites are redeemed live (membership/queue mutate), and validity flips when a
// manager revokes — never serve a cached invite page.
export const dynamic = 'force-dynamic';

/**
 * `/join/<code>` — the invite landing. Resolves the invite + viewer on the
 * server and hands a serializable snapshot to the client view, which owns the
 * (invalid / sign-up / redeem) states. The redeem mutation fires on a button
 * tap inside `InviteView`, never on this GET, so link prefetch can't auto-join.
 */
export default async function JoinPage({ params }) {
  const { code } = await params;
  const [invite, user] = await Promise.all([
    getArenaInviteByCode(code),
    getCurrentUser(),
  ]);

  return <InviteView code={code} invite={invite} isAuthenticated={!!user} />;
}
