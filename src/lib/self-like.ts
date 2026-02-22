import { toast } from "sonner";
import { createElement } from "react";

const EMOJIS = ["😏", "😎", "🤭", "😌"];

export function showSelfLikeEmoji() {
  const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];

  toast.custom(
    () =>
      createElement(
        "div",
        {
          className:
            "bg-bg-card border border-border rounded-xl shadow-lg px-4 py-2.5 select-none",
          style: {
            fontSize: "1.25rem",
            lineHeight: 1,
          },
        },
        emoji,
      ),
    { id: "self-like", duration: 2000 },
  );
}
