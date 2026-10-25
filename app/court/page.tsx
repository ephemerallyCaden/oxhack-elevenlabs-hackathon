import Courtroom from '@/components/courtroom/Courtroom';

// Hardcoded scene: a defense cut-in (angry) with prosecution shocked.
// Static showcase of the manga courtroom + expression system; /trial is the live flow.
export default function Court() {
  return (
    <main className="h-dvh w-full">
      <Courtroom
        scene="no"
        moods={{
          prosecution: { expression: 'shocked', talking: false },
          defense: { expression: 'angry', talking: true },
          judge: { expression: 'idle', talking: false },
        }}
        speakerName="DEFENSE · NO"
        speakerColor="#ef4444"
        text="STOP RIGHT THERE! You're quoting the P90. The median poker player makes twelve thousand pounds. That's less than minimum wage."
      />
    </main>
  );
}
