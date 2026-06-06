import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { getUserPlayerStats } from '@/lib/arenas';
import { ProfileView } from './profile-view';

// Always read fresh stats on each request.
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const stats = await getUserPlayerStats(user.id);
  // Own profile includes the email line; the shared view hides it when omitted.
  return <ProfileView name={user.name} email={user.email} stats={stats} />;
}
