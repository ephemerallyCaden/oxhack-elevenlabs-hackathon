import { notFound } from "next/navigation";

// The tuning labs (/dev/trial, /dev/voices, /dev/sounds, /dev/onboarding) are for the team, not visitors:
// a production build hides them unless DEV_PAGES=on at build time (they are prerendered).
export default function DevLayout({ children }: LayoutProps<"/dev">) {
  if (process.env.NODE_ENV === "production" && process.env.DEV_PAGES !== "on") notFound();
  return children;
}
