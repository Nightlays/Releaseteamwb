# YouTrack Wiki Q&A: section-RAG approach

Source article:
https://habr.com/ru/companies/raiffeisenbank/articles/1012666/

## What matters from the article

The useful part of the article is not "use RAG" in general.
The key idea is:

1. Search on small chunks for precision.
2. Return full sections for meaning.
3. Structure documentation so headings and logical blocks are stable.
4. Measure failures and use them to improve docs, not only prompts.

The most important production takeaway is:

- do not feed whole pages to the model;
- do not answer from arbitrary snippets;
- use section as the semantic unit;
- attach metadata to each chunk: page id, section id, section title, source page.

## Recommended architecture for YouTrack wiki

### Ingestion

1. Load articles from YouTrack API.
2. Parse article markdown/html into sections by H2/H3 headings.
3. Store:
   - article metadata
   - section metadata
   - full section text
   - chunk embeddings
4. For each chunk keep metadata:
   - articleId
   - articleTitle
   - sectionId
   - sectionTitle
   - project
   - updatedAt

### Retrieval

1. User sends a general question.
2. System expands/normalizes query.
3. Vector or hybrid search runs on chunks.
4. Top chunk hits are grouped by sectionId.
5. Full text of matched sections is loaded.
6. Final context is built from top sections, not from isolated chunks.

### Answering

1. Generate direct answer to user question.
2. Show best source articles.
3. Show best sections inside those articles.
4. Show practical next steps, entities, artifacts, owners, testplans.
5. If context is weak, answer with uncertainty and propose follow-up queries.

### Quality loop

Collect:

- user query
- retrieved chunks
- retrieved sections
- final answer
- clicked sources
- unanswered / low-confidence queries

Then use this as a documentation quality backlog.

## What is already implemented in the current MVP

The current HTML MVP now emulates this pattern client-side:

1. Runs scoped YouTrack search for candidate articles.
2. Splits top articles into sections locally.
3. Scores smaller chunk windows inside sections.
4. Promotes whole matched sections to the answer context.
5. Builds:
   - direct local answer
   - recommended articles
   - relevant sections
   - practical action plan
   - follow-up queries
6. Uses those sections as context for LLM if API key is configured.

This is enough for an internal MVP and UX validation.

## What should be done next for production

1. Move retrieval to backend.
2. Build a persistent section/chunk index.
3. Add embeddings and hybrid retrieval.
4. Add per-project and per-space filtering.
5. Add query logs and failure review.
6. Add source citations in every answer block.
7. Add confidence thresholds and fallback when context is weak.

## Practical rollout plan

1. Standardize wiki pages:
   - stable H2 sections
   - definitions
   - checklists
   - owners
   - links to artifacts/testplans
2. Build backend indexer for YouTrack wiki.
3. Launch on one domain first:
   - migrations
   - release regress
   - ownership / duty pages
4. Review failed questions weekly.
5. Expand to the rest of the wiki after quality stabilizes.
