import { FeedbackView } from "@/components/feedback-view";
import { feedbackBoardId, feedbackBoardUrl } from "@/core/links";

export default function FeedbackPage() {
  const board = process.env.NEXT_PUBLIC_VOTEWANT_BOARD;
  return <FeedbackView board={feedbackBoardId(board)} boardUrl={feedbackBoardUrl(board)} />;
}
