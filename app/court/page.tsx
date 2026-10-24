import Courtroom from "@/components/courtroom/Courtroom";

// Hardcoded scene until the event player (C4) drives it.
export default function Court() {
  return (
    <Courtroom
      speaker="defense"
      round={1}
      tokens={3}
      text="STOP RIGHT THERE! You're quoting the P90. The median poker player makes twelve thousand pounds. That's less than minimum wage."
    />
  );
}
