import type { Synonym } from "../data/types";

export interface TopicMatch {
  /** Dictionary terms found in the query. */
  terms: string[];
  topics: string[];
}

const normalize = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/**
 * Maps a free-text query to topics through the synonym dictionary.
 * Substring matching keeps it tolerant of Korean particles and endings
 * ("지쳤을 때" contains "지쳤", "불안해요" contains "불안").
 */
export function matchTopics(query: string, synonyms: Synonym[]): TopicMatch {
  const q = normalize(query);
  const terms = new Set<string>();
  const topics = new Set<string>();
  if (!q) return { terms: [], topics: [] };
  for (const { term, topic } of synonyms) {
    if (q.includes(normalize(term))) {
      terms.add(term);
      topics.add(topic);
    }
  }
  return { terms: [...terms], topics: [...topics] };
}
