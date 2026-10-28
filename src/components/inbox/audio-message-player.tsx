"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Mic, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

/** Playback speeds, in 0.5 steps up to 2x (WhatsApp's own cycle). */
const SPEEDS = [1, 1.5, 2];
const BAR_COUNT = 38;

/** Speed picked last stays for the next audios, like in WhatsApp. */
let lastRate = 1;
/** Only one audio plays at a time. */
let playingAudio: HTMLAudioElement | null = null;

/** Stable pseudo-random "waveform" per audio (we don't decode the file). */
function waveformFor(seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const bars: number[] = [];
  let prev = 0.5;
  for (let i = 0; i < BAR_COUNT; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const r = ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    prev = 0.35 * prev + 0.65 * r; // smooth neighbours a little
    bars.push(4 + Math.round(prev * 20));
  }
  return bars;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const formatRate = (rate: number) => `${rate.toFixed(1).replace(".", ",")}×`;

interface AudioMessagePlayerProps {
  url: string;
  /** Photo of who sent the audio (contact or team member). */
  avatarUrl?: string | null;
  /** Used for the initial when there is no photo. */
  name?: string;
  /** Time, delivery status and badges, rendered bottom-right. */
  footer: React.ReactNode;
}

/**
 * Voice-message player in WhatsApp's layout: play button, waveform with a
 * seek dot, duration under it, and the sender's photo on the right, which
 * gives way to the speed button (1,0× / 1,5× / 2,0×) once playback starts.
 */
export function AudioMessagePlayer({ url, avatarUrl, name, footer }: AudioMessagePlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(lastRate);

  const bars = useMemo(() => waveformFor(url), [url]);
  const started = playing || current > 0;
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const playedBars = Math.round(progress * BAR_COUNT);

  const syncDuration = useCallback(() => {
    const d = audioRef.current?.duration;
    if (d && Number.isFinite(d)) setDuration(d);
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (playingAudio && playingAudio !== audio) playingAudio.pause();
      playingAudio = audio;
      audio.playbackRate = rate;
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, [rate]);

  const cycleRate = useCallback(() => {
    const next = SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length];
    lastRate = next;
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, [rate]);

  const seekFromPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      const d = audio?.duration;
      if (!audio || !d || !Number.isFinite(d)) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      audio.currentTime = ratio * d;
      setCurrent(audio.currentTime);
    },
    [],
  );

  const initial = (name?.trim().charAt(0) || "?").toUpperCase();

  return (
    <div className="flex w-[290px] max-w-full items-center gap-2">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={syncDuration}
        onDurationChange={syncDuration}
        onTimeUpdate={(e) => {
          setCurrent(e.currentTarget.currentTime);
          syncDuration();
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pausar" : "Reproduzir"}
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
              started ? "bg-white/10 hover:bg-white/15" : "hover:bg-white/10",
            )}
          >
            {playing ? (
              <Pause className="h-5 w-5 fill-current" />
            ) : (
              <Play className="h-5 w-5 fill-current" />
            )}
          </button>

          <div
            role="slider"
            aria-label="Posição do áudio"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(current)}
            tabIndex={0}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              seekFromPointer(e);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromPointer(e);
            }}
            className="relative flex h-8 flex-1 cursor-pointer touch-none items-center justify-between px-1"
          >
            {bars.map((h, i) => (
              <span
                key={i}
                className={cn(
                  "w-[3px] shrink-0 rounded-full",
                  i < playedBars ? "bg-[#d1d7db]" : "bg-[#8696a0]",
                )}
                style={{ height: h }}
              />
            ))}
            <span
              aria-hidden
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-400"
              style={{ left: `calc(4px + (100% - 8px) * ${progress})` }}
            />
          </div>
        </div>

        <div className="-mt-1 flex items-center justify-between pl-[44px] text-[11px] text-wa-meta">
          <span>{formatTime(playing || current > 0 ? current : duration)}</span>
          <span className="inline-flex items-center gap-1">{footer}</span>
        </div>
      </div>

      {started ? (
        <button
          type="button"
          onClick={cycleRate}
          aria-label={`Velocidade ${formatRate(rate)}`}
          title="Alterar a velocidade"
          className="flex h-9 w-14 shrink-0 items-center justify-center rounded-full bg-black/80 text-[13px] font-medium text-white hover:bg-black"
        >
          {formatRate(rate)}
        </button>
      ) : (
        <div className="relative h-14 w-14 shrink-0">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={name ?? ""} className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/30 text-lg font-semibold text-white/80">
              {initial}
            </div>
          )}
          <span className="absolute bottom-0 left-0 flex h-5 w-5 items-center justify-center rounded-full bg-black/60">
            <Mic className="h-3.5 w-3.5 text-sky-400" />
          </span>
        </div>
      )}
    </div>
  );
}
