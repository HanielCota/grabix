"use client";

import { Globe, Play, Tv, Video } from "lucide-react";

const PLATFORM_CONFIG: Record<string, { icon: typeof Video; label: string; bg: string; text: string }> = {
  youtube: { icon: Play, label: "YouTube", bg: "bg-red-500/15", text: "text-red-400" },
  twitch: { icon: Tv, label: "Twitch", bg: "bg-purple-500/15", text: "text-purple-400" },
  vimeo: { icon: Play, label: "Vimeo", bg: "bg-cyan-500/15", text: "text-cyan-400" },
  dailymotion: { icon: Play, label: "Dailymotion", bg: "bg-blue-500/15", text: "text-blue-400" },
  twitter: { icon: Globe, label: "X", bg: "bg-sky-500/15", text: "text-sky-400" },
  tiktok: { icon: Video, label: "TikTok", bg: "bg-pink-500/15", text: "text-pink-400" },
  instagram: { icon: Video, label: "Instagram", bg: "bg-fuchsia-500/15", text: "text-fuchsia-400" },
  holodex: { icon: Tv, label: "Holodex", bg: "bg-emerald-500/15", text: "text-emerald-400" },
  bilibili: { icon: Tv, label: "Bilibili", bg: "bg-cyan-500/15", text: "text-cyan-300" },
  niconico: { icon: Tv, label: "Niconico", bg: "bg-zinc-500/15", text: "text-zinc-300" },
  direct: { icon: Video, label: "Direto", bg: "bg-zinc-500/10", text: "text-[var(--g-sub)]" },
};

interface PlatformIconProps {
  platform: string | null;
  size?: number;
  showLabel?: boolean;
}

export function PlatformIcon({ platform, size = 14, showLabel = false }: PlatformIconProps) {
  const config = platform ? PLATFORM_CONFIG[platform] : null;
  const Icon = config?.icon ?? Globe;
  const label = config?.label ?? platform ?? "Web";
  const text = config?.text ?? "text-[var(--g-muted)]";
  const bg = config?.bg ?? "bg-zinc-500/10";

  if (!showLabel) {
    return (
      <span className={`inline-flex items-center ${text}`}>
        <Icon size={size} />
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ${bg} ${text}`}>
      <Icon size={size - 2} />
      <span className="text-[10px] font-bold uppercase tracking-wider leading-none">{label}</span>
    </span>
  );
}
