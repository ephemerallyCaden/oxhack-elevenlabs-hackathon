// Ace Attorney-style dialogue box pinned to the bottom 22% of the 960×540 scene.
// Sits OUTSIDE the camera wrapper so it stays fixed during camera moves.
export default function TextBox({
  name,
  color,
  text,
  controls,
}: {
  name?: string;
  color: string;
  text?: string;
  controls?: React.ReactNode;
}) {
  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-4 px-6 py-3"
      style={{ height: '22%', background: '#08080e', borderTop: '3px solid #2a3050' }}
    >
      <div className="min-w-0 flex-1">
        {name && (
          <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color }}>
            {name}
          </div>
        )}
        {text && <p className="font-mono text-[18px] leading-snug text-[#e0e0e0]">{text}</p>}
      </div>
      {controls && <div className="w-[300px] shrink-0">{controls}</div>}
    </div>
  );
}
