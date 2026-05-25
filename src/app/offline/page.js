import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "Offline — DinkMaster",
};

/**
 * Fallback shown by the service worker when a document request can't be served
 * from the network or cache (e.g. a route the user has never visited while
 * offline). Kept fully static so it precaches cleanly.
 */
export default function OfflinePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 text-center bg-slate-50">
      <div className="relative h-16 w-16 overflow-hidden rounded-2xl ring-1 ring-inset ring-slate-200/80 shadow-sm">
        <Image
          src="/icons/icon-192.png"
          alt="DinkMaster logo"
          fill
          sizes="64px"
          className="object-cover"
        />
      </div>
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-bold text-slate-900">
          You&apos;re offline
        </h1>
        <p className="max-w-sm text-sm text-slate-500">
          This page hasn&apos;t been saved for offline use yet. Reconnect to the
          internet to keep stacking the rack.
        </p>
      </div>
      <Link
        href="/"
        className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
      >
        Back to home
      </Link>
    </main>
  );
}
