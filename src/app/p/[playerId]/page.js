import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { getViewablePlayerProfile } from '@/lib/arenas';
import { ProfileView } from '../../profile/profile-view';

// Profiles read fresh stats on each request.
export const dynamic = 'force-dynamic';

/**
 * `/p/[playerId]` — a single player's profile, used for walk-ins (no account).
 * Gated: signed in, and a member of the walk-in's arena. A linked player
 * redirects to its canonical cross-arena profile at `/u/[userId]`. Missing or
 * inaccessible players 404 (don't reveal existence).
 */
export default async function PlayerProfilePage({ params }) {
  const { playerId } = await params;
  const viewer = await getCurrentUser();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(`/p/${playerId}`)}`);

  const profile = await getViewablePlayerProfile(playerId, viewer.id);
  if (!profile) notFound();
  if (profile.redirectUserId) redirect(`/u/${profile.redirectUserId}`);

  return <ProfileView name={profile.name} stats={profile.stats} badge="Walk-in" />;
}
