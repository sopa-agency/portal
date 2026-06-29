"use client";

import { useState } from "react";
import { SlidersHorizontal, ChevronDown } from "lucide-react";
import { ImprovePromptButton } from "@/components/improve-prompt-dialog";
import { FeedbackButton } from "@/components/insight-feedback";
import { TakeActionButton } from "@/components/take-action-dialog";
import { EmailBriefingButton } from "@/components/email-briefing-dialog";
import { SendToDiscordButton } from "@/components/send-to-discord-dialog";

export type BriefingOptionsProps = {
  agentSlug: string;
  agentLabel: string;
  briefingDate: string;
  markdownBody: string;
  projectName: string;
  githubRepo?: string;
  postCreatorEnabled: boolean;
  teamEmails: string[];
};

/**
 * Single "Options" button that opens a dropdown with every per-briefing action
 * (Improve prompt, Take action, Email to team, Feedback) — instead of a crowded
 * row of buttons in the header. Each item keeps its own dialog; the popover just
 * groups them and the click-away closes it (modals render their own overlay).
 */
export function BriefingOptions(props: BriefingOptionsProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Options
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-50 mt-1.5 flex w-60 flex-col items-stretch gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-xl">
            <ImprovePromptButton agentSlug={props.agentSlug} agentLabel={props.agentLabel} />
            <TakeActionButton
              agentSlug={props.agentSlug}
              agentLabel={props.agentLabel}
              githubRepo={props.githubRepo}
              postCreatorEnabled={props.postCreatorEnabled}
            />
            <SendToDiscordButton agentSlug={props.agentSlug} agentLabel={props.agentLabel} />
            {props.teamEmails.length > 0 && (
              <EmailBriefingButton
                agentSlug={props.agentSlug}
                agentLabel={props.agentLabel}
                briefingDate={props.briefingDate}
                markdownBody={props.markdownBody}
                projectName={props.projectName}
              />
            )}
            <FeedbackButton kind="briefing" channelKey={props.agentSlug} label={`${props.agentLabel} briefing`} />
          </div>
        </>
      )}
    </div>
  );
}
