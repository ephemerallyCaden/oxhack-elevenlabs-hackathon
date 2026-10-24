import { elevenlabs, TTS_MODEL, voiceIdFor } from "./client";
import { VOICE_SETTINGS, type VoiceRole } from "./configs";

export type TtsResult = {
  audioBase64: string;
  mimeType: "audio/mpeg" | "audio/wav";
  durationMs: number;
  // Per-character timings of the input text (includes [tags]); lets the typewriter follow the voice.
  alignment?: { characters: string[]; startSeconds: number[]; endSeconds: number[] };
  mock: boolean;
};

// Server-only: generates one line of speech for a courtroom role.
export async function synthesize(text: string, role: VoiceRole, voiceId?: string): Promise<TtsResult> {
  if (!elevenlabs) return mockSpeech(text);

  const res = await elevenlabs.textToSpeech.convertWithTimestamps(voiceIdFor(voiceId), {
    text,
    modelId: TTS_MODEL,
    voiceSettings: VOICE_SETTINGS[role],
    outputFormat: "mp3_44100_128",
  });
  const a = res.alignment;
  return {
    audioBase64: res.audioBase64,
    mimeType: "audio/mpeg",
    durationMs: Math.round((a?.characterEndTimesSeconds.at(-1) ?? estimateSeconds(text)) * 1000),
    alignment: a && { characters: a.characters, startSeconds: a.characterStartTimesSeconds, endSeconds: a.characterEndTimesSeconds },
    mock: false,
  };
}

// ~14 spoken characters per second, ignoring [audio tags].
function estimateSeconds(text: string) {
  return Math.max(1, text.replace(/\[[^\]]*\]/g, "").trim().length / 14);
}

// Silent WAV of the estimated length, so timing-dependent UI still works without a key.
function mockSpeech(text: string): TtsResult {
  const seconds = estimateSeconds(text);
  const sampleRate = 8000;
  const dataBytes = Math.round(seconds * sampleRate) * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  return { audioBase64: wav.toString("base64"), mimeType: "audio/wav", durationMs: Math.round(seconds * 1000), mock: true };
}
