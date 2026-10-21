-- Paraphrases such as MSG translate several verses as one block (e.g. Philippians 4:6–7).
-- The text is stored on the first verse; verse_end is the last verse it covers (null = a single verse).
alter table verses add column verse_end int check (verse_end is null or verse_end > verse);
