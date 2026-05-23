-- Learning product tables
-- Requires Supabase Auth to be enabled (auth.users table)

-- 1. Learning sources (imported content)
create table if not exists learning_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_type text not null check (source_type in ('youtube', 'audio', 'video')),
  source_url text not null,
  thumbnail_url text,
  duration_seconds numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_learning_sources_user_id on learning_sources(user_id, created_at desc);

-- 2. Transcripts
create table if not exists transcripts (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references learning_sources(id) on delete cascade,
  language text not null default 'ja',
  raw_text text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_transcripts_source_id on transcripts(source_id);

-- 3. Sentences (timed segments from transcript)
create table if not exists sentences (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references transcripts(id) on delete cascade,
  start_time numeric not null,
  end_time numeric not null,
  text text not null,
  tokenized_text jsonb,
  furigana jsonb,
  romaji text,
  translation text,
  language text not null default 'ja',
  created_at timestamptz not null default now()
);

create index if not exists idx_sentences_transcript_id on sentences(transcript_id, start_time);

-- 4. AI-generated sentence explanations (cached)
create table if not exists sentence_explanations (
  id uuid primary key default gen_random_uuid(),
  sentence_id uuid not null references sentences(id) on delete cascade,
  difficulty_level text,
  meaning text not null,
  word_explanations jsonb,
  grammar_points jsonb,
  natural_expression text,
  business_expression text,
  usage_scenarios jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_sentence_explanations_sentence_id on sentence_explanations(sentence_id);

-- 5. User saved sentences (bookmarks)
create table if not exists saved_sentences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sentence_id uuid not null references sentences(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, sentence_id)
);

create index if not exists idx_saved_sentences_user_id on saved_sentences(user_id, created_at desc);

-- 6. User saved words
create table if not exists saved_words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null,
  reading text,
  meaning text,
  sentence_id uuid references sentences(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_saved_words_user_id on saved_words(user_id, created_at desc);

-- 7. SRS review items
create table if not exists review_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null check (item_type in ('sentence', 'word')),
  item_id uuid not null,
  ease_factor numeric not null default 2.5,
  interval_days integer not null default 0,
  repetitions integer not null default 0,
  next_review_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_review_items_user_next on review_items(user_id, next_review_at)
  where next_review_at <= now();

create index if not exists idx_review_items_user_item on review_items(user_id, item_type, item_id);

-- 8. Review history
create table if not exists review_history (
  id uuid primary key default gen_random_uuid(),
  review_item_id uuid not null references review_items(id) on delete cascade,
  rating text not null check (rating in ('again', 'hard', 'good', 'easy')),
  reviewed_at timestamptz not null default now()
);

create index if not exists idx_review_history_item_id on review_history(review_item_id);

-- ============================================================
-- RLS: Enable on all tables
-- ============================================================
alter table learning_sources enable row level security;
alter table transcripts enable row level security;
alter table sentences enable row level security;
alter table sentence_explanations enable row level security;
alter table saved_sentences enable row level security;
alter table saved_words enable row level security;
alter table review_items enable row level security;
alter table review_history enable row level security;

-- ============================================================
-- RLS Policies: User isolation via auth.uid()
-- ============================================================

-- learning_sources
drop policy if exists "Users can read own learning sources" on learning_sources;
create policy "Users can read own learning sources" on learning_sources
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own learning sources" on learning_sources;
create policy "Users can insert own learning sources" on learning_sources
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own learning sources" on learning_sources;
create policy "Users can update own learning sources" on learning_sources
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own learning sources" on learning_sources;
create policy "Users can delete own learning sources" on learning_sources
  for delete using (auth.uid() = user_id);

-- transcripts (accessible through source ownership)
drop policy if exists "Users can read transcripts of own sources" on transcripts;
create policy "Users can read transcripts of own sources" on transcripts
  for select using (
    exists (
      select 1 from learning_sources
      where learning_sources.id = transcripts.source_id
      and learning_sources.user_id = auth.uid()
    )
  );

drop policy if exists "Users can insert transcripts for own sources" on transcripts;
create policy "Users can insert transcripts for own sources" on transcripts
  for insert with check (
    exists (
      select 1 from learning_sources
      where learning_sources.id = transcripts.source_id
      and learning_sources.user_id = auth.uid()
    )
  );

-- sentences (accessible through transcript → source ownership)
drop policy if exists "Users can read sentences of own transcripts" on sentences;
create policy "Users can read sentences of own transcripts" on sentences
  for select using (
    exists (
      select 1 from transcripts
      join learning_sources on learning_sources.id = transcripts.source_id
      where transcripts.id = sentences.transcript_id
      and learning_sources.user_id = auth.uid()
    )
  );

drop policy if exists "Users can insert sentences for own transcripts" on sentences;
create policy "Users can insert sentences for own transcripts" on sentences
  for insert with check (
    exists (
      select 1 from transcripts
      join learning_sources on learning_sources.id = transcripts.source_id
      where transcripts.id = sentences.transcript_id
      and learning_sources.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update sentences of own transcripts" on sentences;
create policy "Users can update sentences of own transcripts" on sentences
  for update using (
    exists (
      select 1 from transcripts
      join learning_sources on learning_sources.id = transcripts.source_id
      where transcripts.id = sentences.transcript_id
      and learning_sources.user_id = auth.uid()
    )
  );

-- sentence_explanations (accessible through sentence → transcript → source)
drop policy if exists "Users can read explanations of own sentences" on sentence_explanations;
create policy "Users can read explanations of own sentences" on sentence_explanations
  for select using (
    exists (
      select 1 from sentences
      join transcripts on transcripts.id = sentences.transcript_id
      join learning_sources on learning_sources.id = transcripts.source_id
      where sentences.id = sentence_explanations.sentence_id
      and learning_sources.user_id = auth.uid()
    )
  );

drop policy if exists "Users can insert explanations for own sentences" on sentence_explanations;
create policy "Users can insert explanations for own sentences" on sentence_explanations
  for insert with check (
    exists (
      select 1 from sentences
      join transcripts on transcripts.id = sentences.transcript_id
      join learning_sources on learning_sources.id = transcripts.source_id
      where sentences.id = sentence_explanations.sentence_id
      and learning_sources.user_id = auth.uid()
    )
  );

-- saved_sentences
drop policy if exists "Users can read own saved sentences" on saved_sentences;
create policy "Users can read own saved sentences" on saved_sentences
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own saved sentences" on saved_sentences;
create policy "Users can insert own saved sentences" on saved_sentences
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can delete own saved sentences" on saved_sentences;
create policy "Users can delete own saved sentences" on saved_sentences
  for delete using (auth.uid() = user_id);

-- saved_words
drop policy if exists "Users can read own saved words" on saved_words;
create policy "Users can read own saved words" on saved_words
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own saved words" on saved_words;
create policy "Users can insert own saved words" on saved_words
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can delete own saved words" on saved_words;
create policy "Users can delete own saved words" on saved_words
  for delete using (auth.uid() = user_id);

-- review_items
drop policy if exists "Users can read own review items" on review_items;
create policy "Users can read own review items" on review_items
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own review items" on review_items;
create policy "Users can insert own review items" on review_items
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own review items" on review_items;
create policy "Users can update own review items" on review_items
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own review items" on review_items;
create policy "Users can delete own review items" on review_items
  for delete using (auth.uid() = user_id);

-- review_history
drop policy if exists "Users can read own review history" on review_history;
create policy "Users can read own review history" on review_history
  for select using (
    exists (
      select 1 from review_items
      where review_items.id = review_history.review_item_id
      and review_items.user_id = auth.uid()
    )
  );

drop policy if exists "Users can insert own review history" on review_history;
create policy "Users can insert own review history" on review_history
  for insert with check (
    exists (
      select 1 from review_items
      where review_items.id = review_history.review_item_id
      and review_items.user_id = auth.uid()
    )
  );

-- ============================================================
-- Grant permissions
-- ============================================================
grant select, insert, update, delete on learning_sources to authenticated;
grant select, insert on transcripts to authenticated;
grant select, insert, update on sentences to authenticated;
grant select, insert on sentence_explanations to authenticated;
grant select, insert, delete on saved_sentences to authenticated;
grant select, insert, delete on saved_words to authenticated;
grant select, insert, update, delete on review_items to authenticated;
grant select, insert on review_history to authenticated;
