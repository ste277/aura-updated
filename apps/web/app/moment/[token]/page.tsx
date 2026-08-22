import type { Metadata } from 'next';
import { resolvePublicAuraMoment } from '../../../lib/auraMoments';
import { AuraMomentClient } from './AuraMomentClient';

/**
 * Public Aura Moment page (brief section 6/9) -- works fully logged out.
 * A Server Component so the initial render/metadata never round-trips
 * through a client fetch: resolvePublicAuraMoment() is the entire read path
 * (token -> stored snapshot -> sanitized DTO), no Panchang/Muhurta/natal
 * computation (section 23). Interactivity (Accept/Another time) lives in
 * the small 'use client' AuraMomentClient below it.
 */

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const outcome = await resolvePublicAuraMoment(params.token);
  if (outcome.status !== 'OK') {
    return { title: 'Aura Moment', description: 'A shared moment from Aura.' };
  }
  // Section 20: safe metadata only -- activity + date/time, never birth data,
  // astrology detail, or Tara Bala. Dynamic OG *images* are deferred per the
  // brief ("if substantial work, defer them; metadata itself is sufficient").
  const { moment } = outcome;
  const title = `❤️ A moment from Aura — ${moment.activityTitle}`;
  const description = moment.explanationSnapshot ?? 'Aura found a favorable moment to share.';
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary', title, description },
  };
}

export default async function MomentPage({ params }: { params: { token: string } }) {
  const outcome = await resolvePublicAuraMoment(params.token);
  return <AuraMomentClient token={params.token} initialOutcome={outcome} />;
}
