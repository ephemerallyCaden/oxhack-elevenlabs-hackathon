// 16:9 letterboxed stage. Children size themselves in cqw/cqh so everything scales with the screen.
export default function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh w-full items-center justify-center overflow-hidden bg-black">
      <div
        className="relative aspect-video w-[min(100vw,177.78dvh)] overflow-hidden"
        style={{ containerType: "size" }}
      >
        {children}
      </div>
    </div>
  );
}
