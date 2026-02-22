import { useEffect, useRef, useState } from "react";

const VOTE_DEBOUNCE_MS = 500;
const DEFAULT_ERR_MSG = "Failed to vote";

/**
 * Optimistic voting hook with debounced API calls.
 *
 * Maintains two layers: optimistic state (drives UI) and confirmed state
 * (last server-acknowledged snapshot). Optimistic score is always computed
 * relative to the confirmed baseline (`confirmedScore - confirmedVote + newVote`),
 * so rapid clicks never cause cumulative drift.
 *
 * Only the final value after {@link VOTE_DEBOUNCE_MS}ms of inactivity is sent
 * to the server — rapid clicks produce exactly one request.
 *
 * @param initialVote  User's vote value from props or API (1 / -1 / 0)
 * @param initialScore Post net score (upvotes - downvotes) from props or API
 * @param postId       Post ID, also used to reset state when switching posts
 * @param onError      Optional callback invoked with an error message on failure
 *
 * @example
 * // SSR / props-driven (PostCard)
 * const { userVote, score, vote } = useVote(initialVote, upvotes - downvotes, post.id);
 *
 * // Client-fetch-driven (PostPageClient) — pass 0/0 then sync after fetch
 * const { userVote, score, vote, sync } = useVote(0, 0, id);
 * useEffect(() => {
 *   fetch(`/api/posts/${id}`).then(r => r.json()).then(data => {
 *     sync(data.userVote || 0, data.post.upvotes - data.post.downvotes);
 *   });
 * }, [id]);
 */
export function useVote(
  initialVote: number,
  initialScore: number,
  postId: string,
  onError?: (message: string) => void,
) {
  const [userVote, setUserVote] = useState(initialVote);
  const [score, setScore] = useState(initialScore);

  const confirmedVoteRef = useRef(initialVote);
  const confirmedScoreRef = useRef(initialScore);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    setScore(initialScore);
    confirmedScoreRef.current = initialScore;
  }, [postId, initialScore]);

  useEffect(() => {
    setUserVote(initialVote);
    confirmedVoteRef.current = initialVote;
  }, [postId, initialVote]);

  /** Imperatively push confirmed state (e.g. after a client-side fetch). */
  const sync = (serverVote: number, serverScore: number) => {
    setUserVote(serverVote);
    setScore(serverScore);
    confirmedVoteRef.current = serverVote;
    confirmedScoreRef.current = serverScore;
  };

  const vote = (newValue: number) => {
    setUserVote(newValue);
    setScore(confirmedScoreRef.current - confirmedVoteRef.current + newValue);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/posts/${postId}/vote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: newValue }),
        });
        if (res.ok) {
          confirmedScoreRef.current =
            confirmedScoreRef.current - confirmedVoteRef.current + newValue;
          confirmedVoteRef.current = newValue;
        } else {
          setUserVote(confirmedVoteRef.current);
          setScore(confirmedScoreRef.current);
          try {
            const data = await res.json();
            onError?.(
              typeof data?.error === "string" ? data.error : DEFAULT_ERR_MSG,
            );
          } catch {
            onError?.(DEFAULT_ERR_MSG);
          }
        }
      } catch {
        setUserVote(confirmedVoteRef.current);
        setScore(confirmedScoreRef.current);
        onError?.(DEFAULT_ERR_MSG);
      }
    }, VOTE_DEBOUNCE_MS);
  };

  return { userVote, score, vote, sync };
}
