# CN Pronunciation — Agent Guide

Personal Mandarin pronunciation trainer for classic HSK 1, Russian UI.

## Goals
- Practice one HSK 1 word at a time.
- Show Hanzi, tone-marked pinyin and Russian translation.
- iFlytek TTS for reference pronunciation.
- iFlytek ISE for learner assessment.
- Show overall score plus per-syllable phone/tone scores when returned.
- Expand HSK 1 example phrases.
- Full searchable HSK 1 vocabulary tab.
- No database and no permanent audio storage.

## Rules
- iFlytek credentials are server-only environment variables.
- Never use NEXT_PUBLIC_ for secrets.
- Audio is processed in memory and discarded after assessment.
- Do not add Telegram.
- Do not fabricate syllable scores when iFlytek does not return them.
- Keep the UI dynamic, compact and mobile-friendly.

## Stack
Next.js App Router + TypeScript + React, deployed to Vercel.
