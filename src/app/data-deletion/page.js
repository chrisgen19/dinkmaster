import { LegalShell, LegalSection } from '../legal-shell';

export const metadata = {
  title: 'Data Deletion — DinkMaster',
  description: 'How to delete your DinkMaster account and personal data.',
};

/** Public-facing contact for data-deletion requests. */
const CONTACT_EMAIL = 'chrisgen19@gmail.com';

export default function DataDeletionPage() {
  return (
    <LegalShell
      title="User Data Deletion"
      subtitle="You can delete your DinkMaster account and the personal data we hold at any time. Here's how."
      updated="May 27, 2026"
    >
      <LegalSection heading="Request account deletion">
        <p>
          Email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-emerald-600 hover:text-emerald-700">
            {CONTACT_EMAIL}
          </a>{' '}
          from the email address on your account with the subject{' '}
          <strong>&ldquo;Delete my account&rdquo;</strong>. We&apos;ll verify the request and
          delete your account along with your personal data within <strong>30 days</strong>.
        </p>
        <p>This removes your profile details, login credentials, and any linked social accounts.</p>
      </LegalSection>

      <LegalSection heading="If you signed in with Google">
        <p>
          You can also disconnect DinkMaster from Google directly:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Google Account → Security → Your connections to third-party apps → select{' '}
            <em>DinkMaster</em> → Remove access.
          </li>
        </ul>
        <p>
          Removing the connection stops future sign-ins. To also erase the data we already
          hold, send the deletion request above.
        </p>
      </LegalSection>

      <LegalSection heading="What we keep">
        <p>
          After deletion, some match results may be retained in anonymized form (with your name
          removed) so other players&apos; historical records and ratings remain accurate. This
          data can no longer be linked back to you.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
