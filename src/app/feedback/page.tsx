import { FeedbackView } from "@/components/feedback-view";
import { feedbackBoardUrl } from "@/core/links";

export default function FeedbackPage() {
  return <FeedbackView boardUrl={feedbackBoardUrl(process.env.NEXT_PUBLIC_VOTEWANT_BOARD)} />;
}
