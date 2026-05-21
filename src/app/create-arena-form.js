'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createArena } from './actions';

/** Inline form for creating a new arena; redirects to it on success. */
export function CreateArenaForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    startTransition(async () => {
      const result = await createArena(name);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(`/arena/${result.arena.id}`);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
      <input
        type="text"
        placeholder="New arena name — e.g. Saturday Open Play"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={80}
        className="flex-1 bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 rounded-xl px-4 py-2.5 text-sm outline-none transition text-slate-800 placeholder-slate-400"
      />
      <button
        type="submit"
        disabled={isPending}
        className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold px-5 py-2.5 rounded-xl transition duration-150 shadow-sm shrink-0"
      >
        {isPending ? 'Creating…' : 'Create arena'}
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-600 self-center">
          {error}
        </p>
      )}
    </form>
  );
}
