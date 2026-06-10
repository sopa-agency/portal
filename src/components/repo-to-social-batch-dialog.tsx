"use client";

import {
  cancelScheduledTweet,
  deleteRepoToSocialRun,
  publishTweetToBinance,
  publishTweetToFarcaster,
  publishTweetToHive,
  recordXPublish,
  scheduleTweetPublish,
  setTweetState,
  updateRunTweets,
  uploadDraftImage,
  type RepoToSocialRunRow,
} from "@/app/actions/repo-to-social";
import {
  TweetBatchDialog,
  type TweetBatchActions,
  type TweetRunPatch,
  type TweetBrand,
} from "@/components/tweet-batch-dialog";

// Wires the repo-to-social server actions into the generic TweetBatchDialog.
// The dialog itself is platform-agnostic — this adapter just binds its 9
// callbacks to RepoToSocialRun-backed mutations.
const ACTIONS: TweetBatchActions = {
  updateRunTweets,
  setTweetState,
  scheduleTweetPublish,
  cancelScheduledTweet,
  deleteRun: deleteRepoToSocialRun,
  publishTweetToHive,
  publishTweetToFarcaster,
  publishTweetToBinance,
  recordXPublish,
  uploadDraftImage,
};

type Props = {
  run: RepoToSocialRunRow | null;
  open: boolean;
  focusTweetIndex: number | null;
  onFocusTweetIndexChange: (idx: number | null) => void;
  onClose: () => void;
  brand: TweetBrand;
  onUpdate: (patch: Partial<RepoToSocialRunRow> & { id: string }) => void;
};

export function RepoToSocialDialog({ onUpdate, ...rest }: Props) {
  // The dialog only ever patches fields shared by all run types (tweets,
  // tweetStates, etc.), so narrowing through TweetRunPatch is safe — the
  // patch is a strict subset of RepoToSocialRunRow.
  const adaptedOnUpdate = (patch: TweetRunPatch) =>
    onUpdate(patch as Partial<RepoToSocialRunRow> & { id: string });

  return (
    <TweetBatchDialog<RepoToSocialRunRow>
      {...rest}
      actions={ACTIONS}
      onUpdate={adaptedOnUpdate}
    />
  );
}
