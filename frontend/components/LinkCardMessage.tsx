"use client";

import { ExternalLink } from "lucide-react";

import { Card } from "@/components/ui/card";
import { LinkCard } from "@/types";

interface LinkCardMessageProps {
  linkCard: LinkCard;
}

// Clickable link the agent explicitly sent as structured data (LINK_CARD),
// not parsed out of its spoken reply text — see backend/agent/tools.py's
// _send_link_card_internal. Mirrors ReviewCards.tsx's placement under the
// message bubble.
export default function LinkCardMessage({ linkCard }: LinkCardMessageProps) {
  if (!linkCard?.url) return null;

  return (
    <div className="mt-3 w-full max-w-sm">
      <a href={linkCard.url} target="_blank" rel="noopener noreferrer">
        <Card className="p-3 flex-row items-center gap-3 hover:ring-foreground/20 transition-colors cursor-pointer">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary shrink-0">
            <ExternalLink className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {linkCard.label}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {linkCard.url}
            </p>
          </div>
        </Card>
      </a>
    </div>
  );
}
