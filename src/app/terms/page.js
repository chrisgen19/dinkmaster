import Link from 'next/link';
import { LegalShell, LegalSection } from '../legal-shell';

export const metadata = {
  title: 'Terms of Service — DinkMaster',
  description: 'The terms that govern your use of DinkMaster.',
};

/** Public-facing contact for terms questions. */
const CONTACT_EMAIL = 'chrisgen19@gmail.com';

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      subtitle="These terms govern your use of DinkMaster. By creating an account or using the app, you agree to them."
      updated="May 27, 2026"
    >
      <LegalSection heading="1. Acceptance of these terms">
        <p>
          DinkMaster (&ldquo;the Service&rdquo;) helps pickleball communities run open play —
          managing queues, mixing partnerships, and tracking matches. By accessing or using the
          Service you agree to these Terms of Service and to our{' '}
          <Link href="/privacy" className="font-semibold text-emerald-600 hover:text-emerald-700">
            Privacy Policy
          </Link>
          . If you do not agree, please do not use the Service.
        </p>
      </LegalSection>

      <LegalSection heading="2. Your account">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>You must provide accurate information and keep it up to date.</li>
          <li>
            You are responsible for activity under your account and for keeping your login
            credentials (including any connected Google account) secure.
          </li>
          <li>You must be old enough to form a binding agreement in your country of residence.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. Acceptable use">
        <p>When using DinkMaster, you agree not to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Break the law or infringe anyone&apos;s rights.</li>
          <li>Harass, abuse, impersonate, or misrepresent other players.</li>
          <li>Disrupt, overload, scrape, reverse-engineer, or attempt to gain unauthorized access to the Service.</li>
          <li>Upload content that is unlawful, offensive, or that you do not have the right to share.</li>
        </ul>
        <p>
          Arena owners and organizers are responsible for managing their own arenas and members
          fairly and lawfully.
        </p>
      </LegalSection>

      <LegalSection heading="4. Your content">
        <p>
          You keep ownership of the content you submit (such as arena names, player names, and
          match data). You grant DinkMaster the limited right to host and display that content as
          needed to operate the Service — for example, showing your stats to other members of an
          arena you belong to.
        </p>
      </LegalSection>

      <LegalSection heading="5. Service availability">
        <p>
          The Service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis.
          We may add, change, suspend, or discontinue features at any time, and we do not
          guarantee that the Service will always be uninterrupted, error-free, or available.
        </p>
      </LegalSection>

      <LegalSection heading="6. Limitation of liability">
        <p>
          To the fullest extent permitted by law, DinkMaster and its operators are not liable for
          any indirect, incidental, or consequential damages arising from your use of the Service.
          The Service is intended to help organize recreational play and is not responsible for
          conduct, disputes, or injuries that occur off the platform.
        </p>
      </LegalSection>

      <LegalSection heading="7. Termination">
        <p>
          You may stop using the Service and delete your account at any time — see our{' '}
          <Link href="/data-deletion" className="font-semibold text-emerald-600 hover:text-emerald-700">
            Data Deletion instructions
          </Link>
          . We may suspend or terminate access if these terms are violated or to protect the
          Service and its users.
        </p>
      </LegalSection>

      <LegalSection heading="8. Changes to these terms">
        <p>
          We may update these terms from time to time. When we do, we&apos;ll revise the
          &ldquo;Last updated&rdquo; date above. Your continued use of the Service after changes
          take effect means you accept the updated terms.
        </p>
      </LegalSection>

      <LegalSection heading="9. Contact">
        <p>
          Questions about these terms? Email us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-emerald-600 hover:text-emerald-700">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}
