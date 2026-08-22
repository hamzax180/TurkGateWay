'use client';

/**
 * Temporary visual harness for VisaIntakeCard — mounts every state the card
 * can be in so they can be checked without a database. Delete once verified.
 */
import VisaIntakeCard from '../components/VisaIntakeCard';

import { INTAKE_FIELDS } from '../../lib/visa-fields';

const ALL = INTAKE_FIELDS.filter((f) => !f.optional).map((f) => f.short);

export default function CardPreview() {
  return (
    <div className="min-h-screen bg-[var(--bg)] p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <section>
          <h3 className="text-sm font-bold mb-2 text-[var(--muted)]">Early — 3 of 18, no document</h3>
          <VisaIntakeCard
            state={{ collected: ALL.slice(0, 3), missing: ALL.slice(3), documentAttached: false, status: 'collecting' }}
            language="en"
            onAttach={() => {}}
          />
        </section>

        <section>
          <h3 className="text-sm font-bold mb-2 text-[var(--muted)]">Nearly done — document attached</h3>
          <VisaIntakeCard
            state={{ collected: ALL.slice(0, 16), missing: ALL.slice(16), documentAttached: true, status: 'collecting' }}
            language="en"
          />
        </section>

        <section>
          <h3 className="text-sm font-bold mb-2 text-[var(--muted)]">Ready</h3>
          <VisaIntakeCard
            state={{ collected: ALL, missing: [], documentAttached: true, status: 'ready' }}
            language="en"
          />
        </section>

        <section>
          <h3 className="text-sm font-bold mb-2 text-[var(--muted)]">Being booked</h3>
          <VisaIntakeCard
            state={{ collected: ALL, missing: [], documentAttached: true, status: 'in_progress' }}
            language="en"
          />
        </section>

        <section>
          <h3 className="text-sm font-bold mb-2 text-[var(--muted)]">Turkmen</h3>
          <VisaIntakeCard
            state={{ collected: ALL.slice(0, 14), missing: ALL.slice(14), documentAttached: false, status: 'collecting' }}
            language="tk"
            onAttach={() => {}}
          />
        </section>
      </div>
    </div>
  );
}
