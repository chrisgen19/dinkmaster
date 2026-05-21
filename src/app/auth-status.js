'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession, signOut } from '@/lib/auth-client';

/**
 * Header auth control: shows the signed-in user with a sign-out button, or a
 * sign-in link for guests. Guests can still view the arena — only managing it
 * requires an account.
 */
export function AuthStatus() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  if (isPending) {
    return <div className="h-9 w-24 rounded-xl bg-slate-100 animate-pulse" />;
  }

  if (!session) {
    return (
      <Link
        href="/login"
        className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2.5 rounded-xl transition-all font-semibold shadow-sm"
      >
        Sign in
      </Link>
    );
  }

  const handleSignOut = async () => {
    await signOut();
    router.refresh();
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 hidden sm:block">
        {session.user.name || session.user.email}
      </span>
      <button
        onClick={handleSignOut}
        className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-3.5 py-2.5 rounded-xl border border-slate-200/60 transition-all font-semibold"
      >
        Sign out
      </button>
    </div>
  );
}
