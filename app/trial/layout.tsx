'use client';
import { Fragment } from 'react';
import { useRouter } from 'next/navigation';

// Cache Components keeps visited routes alive (React Activity) and restores their state. A new
// trial (router.push / <Link> to /trial) must start fresh: its intro, the onboarding question and
// the orchestrator all live in page state. Browser back/forward keep the same id, so they still
// restore the trial in progress.
export default function TrialLayout({ children }: { children: React.ReactNode }) {
  return <Fragment key={useRouter().bfcacheId}>{children}</Fragment>;
}
