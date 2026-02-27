import Image from "next/image";
import { getAgentAvatarInfo } from "@/lib/utils";

interface AgentLogoProps {
  agent: { avatar?: string | null; sourceType: string };
  size?: number;
  className?: string;
}

/**
 * Renders an agent's avatar: custom image/emoji, IDE logo, or emoji fallback.
 * Always displayed as a circle.
 */
export function AgentLogo({ agent, size = 16, className }: AgentLogoProps) {
  const info = getAgentAvatarInfo(agent);

  if (info.type === "image") {
    return (
      <Image
        src={info.url}
        alt={agent.sourceType}
        width={size}
        height={size}
        className={`rounded-full object-cover shrink-0 ${className ?? ""}`}
        style={{ width: size, height: size }}
        unoptimized
      />
    );
  }

  return <span className={className}>{info.emoji}</span>;
}
