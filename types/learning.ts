export type SourceType = "youtube" | "audio" | "video";

export interface LearningSource {
  id: string;
  user_id: string;
  title: string;
  source_type: SourceType;
  source_url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  created_at: string;
}

export interface Transcript {
  id: string;
  source_id: string;
  language: string;
  raw_text: string;
  created_at: string;
}

export interface Sentence {
  id: string;
  transcript_id: string;
  start_time: number;
  end_time: number;
  text: string;
  tokenized_text: string[] | null;
  furigana: string[] | null;
  romaji: string | null;
  translation: string | null;
  language: string;
  created_at: string;
}

export interface SentenceExplanation {
  id: string;
  sentence_id: string;
  difficulty_level: string | null;
  meaning: string;
  word_explanations: Record<string, string> | null;
  grammar_points: string[] | null;
  natural_expression: string | null;
  business_expression: string | null;
  usage_scenarios: string[] | null;
  created_at: string;
}

export interface SavedSentence {
  id: string;
  user_id: string;
  sentence_id: string;
  created_at: string;
}

export interface SavedWord {
  id: string;
  user_id: string;
  word: string;
  reading: string | null;
  meaning: string | null;
  sentence_id: string | null;
  created_at: string;
}

export type ReviewRating = "again" | "hard" | "good" | "easy";

export interface ReviewItem {
  id: string;
  user_id: string;
  item_type: "sentence" | "word";
  item_id: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string;
  last_reviewed_at: string | null;
  created_at: string;
}

export interface ReviewHistory {
  id: string;
  review_item_id: string;
  rating: ReviewRating;
  reviewed_at: string;
}

export interface LearningSourceWithMeta extends LearningSource {
  transcript_count: number;
  sentence_count: number;
  progress_percent: number;
}

export interface ReviewItemWithSentence extends ReviewItem {
  sentence?: Sentence;
  source?: LearningSource;
}
