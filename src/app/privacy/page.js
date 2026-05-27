import Link from 'next/link';
import { LegalShell, LegalSection } from '../legal-shell';

export const metadata = {
  title: 'Privacy Policy — DinkMaster',
  description: 'How DinkMaster collects, uses, and protects your information.',
};

/** Public-facing contact for privacy and data requests. */
const CONTACT_EMAIL = 'chrisgen19@gmail.com';

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      subtitle="DinkMaster helps pickleball communities run open play. This policy explains what we collect, why, and the choices you have."
      updated="May 27, 2026"
    >
      <LegalSection heading="Information we collect">
        <p>When you create an account or use DinkMaster, we collect:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Account details</strong> you provide — your first and last name, email
            address, and password (stored only as a secure hash). Optionally, a phone number,
            address, birthday, and gender if you choose to add them.
          </li>
          <li>
            <strong>Social login data</strong> — if you sign in with Google, we receive your
            name, email address, and profile picture from Google to create or match your
            account. We do not receive your Google password.
          </li>
          <li>
            <strong>Gameplay data</strong> — the arenas you join, matches you play, scores,
            queue activity, and the ratings/statistics derived from them.
          </li>
          <li>
            <strong>Session data</strong> — a sign-in cookie that keeps you logged in, plus
            basic technical details (such as IP address and browser) tied to that session.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="How we use your information">
        <p>We use the information above to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Provide and operate the service — authentication, arenas, queues, and matches.</li>
          <li>Calculate stats, ratings, and weekly leaderboards.</li>
          <li>Keep your account secure and prevent abuse.</li>
        </ul>
        <p>We do not sell your personal information, and we do not use it for advertising.</p>
      </LegalSection>

      <LegalSection heading="What other people can see">
        <p>
          DinkMaster is collaborative. Within an arena you join, other members can see your
          display name and your gameplay stats (wins, losses, rating, leaderboard position).
          Your email, phone, address, birthday, and gender are not shown to other players.
        </p>
      </LegalSection>

      <LegalSection heading="Third-party services">
        <p>We rely on a small number of providers to run DinkMaster:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Google</strong> — only if you choose to sign in with Google.</li>
          <li><strong>Hosting &amp; database</strong> — to store your data and serve the app.</li>
        </ul>
        <p>These providers process data on our behalf and under their own privacy terms.</p>
      </LegalSection>

      <LegalSection heading="Data retention &amp; deletion">
        <p>
          We keep your data while your account is active. You can request deletion of your
          account and associated personal data at any time — see our{' '}
          <Link href="/data-deletion" className="font-semibold text-emerald-600 hover:text-emerald-700">
            Data Deletion instructions
          </Link>
          . Some match history may be retained in anonymized form so other players&apos;
          records stay accurate.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          For any privacy question or request, email us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-emerald-600 hover:text-emerald-700">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}
