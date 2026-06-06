import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { getViewableUserProfile } from '@/lib/arenas';
import { ProfileView } from '../../profile/profile-view';

// Profiles read fresh stats on each request.
export const dynamic = 'force-dynamic';

/**
 * `/u/[userId]` — another user's profile. Gated: the viewer must be signed in
 * and share at least one arena with the target (see `getViewableUserProfile`).
 * A missing/unknown/unshared target 404s so the route never reveals whether an
 * account exists. Own id redirects to `/profile` (which shows the email line).
 */
export default async function UserProfilePage({ params }) {
  const { userId } = await params;
  const viewer = await getCurrentUser();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(`/u/${userId}`)}`);
  if (userId === viewer.id) redirect('/profile');

  const profile = await getViewableUserProfile(userId, viewer.id);
  if (!profile) notFound();

  // No email — that's the only field withheld from non-self viewers.
  return <ProfileView name={profile.name} stats={profile.stats} />;
}
