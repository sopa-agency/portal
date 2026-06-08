"use client";

import {
  cancelScheduledMarketingTweet,
  deleteMarketingSuggestionRun,
  publishMarketingTweetToBinance,
  publishMarketingTweetToFarcaster,
  publishMarketingTweetToHive,
  recordMarketingXPublish,
  scheduleMarketingTweetPublish,
  setMarketingTweetState,
  updateMarketingRunTweets,
  uploadMarketingDraftImage,
  type MarketingSuggestionRunRow,
} from "@/app/actions/marketing-suggestions";
import {
  TweetBatchDialog,
  type TweetBatchActions,
  type TweetRunPatch,
} from "@/components/tweet-batch-dialog";

// Wires the marketing-suggestions server actions into the generic
// TweetBatchDialog. Mirror of repo-to-social-batch-dialog.tsx but bound to
// the MarketingSuggestionRun table.
const ACTIONS: TweetBatchActions = {
  updateRunTweets: updateMarketingRunTweets,
  setTweetState: setMarketingTweetState,
  scheduleTweetPublish: scheduleMarketingTweetPublish,
  cancelScheduledTweet: cancelScheduledMarketingTweet,
  deleteRun: deleteMarketingSuggestionRun,
  publishTweetToHive: publishMarketingTweetToHive,
  publishTweetToFarcaster: publishMarketingTweetToFarcaster,
  publishTweetToBinance: publishMarketingTweetToBinance,
  recordXPublish: recordMarketingXPublish,
  uploadDraftImage: uploadMarketingDraftImage,
};

type Props = {
  run: MarketingSuggestionRunRow | null;
  open: boolean;
  focusTweetIndex: number | null;
  onFocusTweetIndexChange: (idx: number | null) => void;
  onClose: () => void;
  onUpdate: (patch: Partial<MarketingSuggestionRunRow> & { id: string }) => void;
};

export function MarketingSuggestionsDialog({ onUpdate, ...rest }: Props) {
  const adaptedOnUpdate = (patch: TweetRunPatch) =>
    onUpdate(patch as Partial<MarketingSuggestionRunRow> & { id: string });

  return (
    <TweetBatchDialog<MarketingSuggestionRunRow>
      {...rest}
      actions={ACTIONS}
      onUpdate={adaptedOnUpdate}
    />
  );
}
