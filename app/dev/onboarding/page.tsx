"use client";

import { useState } from "react";
import VoiceStep, { type VoiceStepResult } from "@/components/onboarding/VoiceStep";

// B8 test page: the onboarding voice step on its own.
export default function OnboardingDev() {
  const [result, setResult] = useState<VoiceStepResult | null>(null);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-3xl font-bold">Onboarding: voice step</h1>
      {result ? (
        <pre data-testid="result" className="max-w-2xl whitespace-pre-wrap rounded bg-zinc-900 p-4 text-sm">{JSON.stringify(result, null, 2)}</pre>
      ) : (
        <VoiceStep onDone={setResult} />
      )}
    </main>
  );
}
