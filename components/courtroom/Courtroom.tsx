import Character from "./Character";
import Stage from "./Stage";
import TextBox from "./TextBox";
import TopBar from "./TopBar";
import { ROLE_STYLE, type CourtRole } from "./roles";

type Props = {
  speaker: CourtRole;
  text: string;
  round: number;
  tokens: number;
  names?: Partial<Record<CourtRole, string>>;
};

// Static courtroom: prosecution left, defense right, judge centre-top. No camera panning.
export default function Courtroom({ speaker, text, round, tokens, names = {} }: Props) {
  return (
    <Stage>
      {/* Wall + floor */}
      <div className="absolute inset-0 bg-[linear-gradient(#3b2414_0%,#24160c_62%,#140c06_62%,#0a0603_100%)]" />
      <div className="absolute inset-x-0 top-0 h-[62cqh] bg-[repeating-linear-gradient(90deg,transparent_0_9cqw,rgba(0,0,0,0.25)_9cqw_9.4cqw)]" />

      {/* Judge behind the bench */}
      <div className="absolute left-1/2 top-[8cqh] h-[26cqh] -translate-x-1/2">
        <Character role="judge" speaking={speaker === "judge"} />
      </div>
      <Desk role="judge" name={names.judge} className="left-1/2 top-[28cqh] h-[14cqh] w-[34cqw] -translate-x-1/2" />

      {/* Prosecution (left) and defense (right) behind their desks */}
      <div className="absolute bottom-[42cqh] left-[9cqw] h-[30cqh]">
        <Character role="prosecution" speaking={speaker === "prosecution"} />
      </div>
      <Desk role="prosecution" name={names.prosecution} className="bottom-[34cqh] left-[4cqw] h-[13cqh] w-[30cqw]" />

      <div className="absolute bottom-[42cqh] right-[9cqw] h-[30cqh]">
        <Character role="defense" speaking={speaker === "defense"} />
      </div>
      <Desk role="defense" name={names.defense} className="bottom-[34cqh] right-[4cqw] h-[13cqh] w-[30cqw]" />

      <TopBar round={round} totalRounds={3} tokens={tokens} />
      <TextBox speaker={speaker} name={names[speaker]} text={text} />
    </Stage>
  );
}

function Desk({ role, name, className }: { role: CourtRole; name?: string; className: string }) {
  const { label, color } = ROLE_STYLE[role];
  return (
    <div
      className={`absolute flex items-center justify-center rounded-t-[1cqh] border-t-[0.8cqh] bg-[linear-gradient(#6b3f1f,#3d2210)] shadow-[0_1cqh_3cqh_rgba(0,0,0,0.6)] ${className}`}
      style={{ borderColor: color }}
    >
      <span
        className="rounded-[0.6cqh] px-[1cqw] py-[0.4cqh] text-[2cqh] font-bold uppercase tracking-wider text-white"
        style={{ backgroundColor: color }}
      >
        {name ?? label}
      </span>
    </div>
  );
}
