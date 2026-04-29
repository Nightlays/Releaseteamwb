import { normalizeGlmBase } from '../types';
import { proxyFetch, type ProxyMode } from './proxy';

export interface WikiIntelligenceConfig {
  proxyBase?: string;
  proxyMode?: ProxyMode;
  useProxy?: boolean;
  wikiBase?: string;
  wikiToken?: string;
  glmBase?: string;
  glmKey?: string;
  glmModel?: string;
  useWebSearch?: boolean;
  webSearchKey?: string;
  persona?: WikiPersona;
  signal?: AbortSignal;
}

export interface WikiChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface WikiKnowledgeSource {
  uid: string;
  id: string;
  title: string;
  url: string;
  apiUrl: string;
  spaceId: string;
  articleNumber: string;
  summary: string;
  excerpt: string;
  content: string;
  updatedAt: number;
  author: string;
  score: number;
}

export interface WikiAnswerResult {
  answer: string;
  sources: WikiKnowledgeSource[];
  draftAction?: WikiDraftAction;
  createdArticle?: {
    title: string;
    url: string;
  };
}

type WikiResponseProfile = 'brief' | 'standard' | 'detailed' | 'deep';

export type WikiPersona = 'release_engineer' | 'analyst' | 'manager' | 'qa' | 'frontend' | 'backend' | 'devops';

export const WIKI_PERSONA_LABELS: Record<WikiPersona, string> = {
  release_engineer: 'Release Engineer',
  analyst:          'Аналитик',
  manager:          'Менеджер',
  qa:               'QA',
  frontend:         'Frontend',
  backend:          'Backend',
  devops:           'DevOps',
};

interface WikiCreateTarget {
  spaceId: string;
  parentArticleNumber?: string;
  raw: string;
}

interface WikiCreateCommand {
  requested: boolean;
  title: string;
  topic: string;
  target?: WikiCreateTarget;
  missing: string[];
}

export interface WikiDraftAction {
  type: 'create_wiki_article';
  title: string;
  topic: string;
  markdown: string;
  target: WikiCreateTarget;
}

interface WikiAnswerPlan {
  originalQuestion: string;
  effectiveQuestion: string;
  topicQuestion: string;
  isFollowUp: boolean;
  profile: WikiResponseProfile;
  persona: WikiPersona;
  searchPageSize: number;
  hydrateLimit: number;
  contextSourceLimit: number;
  passageLimit: number;
  historyLimit: number;
  maxTokens: number;
}

function replaceSourceMarkers(text: string, sources: WikiKnowledgeSource[]) {
  let output = String(text || '').trim();
  sources.forEach((source, index) => {
    const marker = index + 1;
    const url = source.url;
    output = output.replace(new RegExp(`\\[W${marker}\\]`, 'g'), `(${url})`);
    output = output.replace(new RegExp(`\\(\\s*W${marker}\\s*\\)`, 'gi'), `(${url})`);
    output = output.replace(new RegExp(`\\bW${marker}\\b`, 'g'), url);
  });
  return output;
}

function sanitizeAnswerText(text: string) {
  return String(text || '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^\|(.+)\|$/gm, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const DEFAULT_WIKI_BASE = 'https://wiki.wb.ru';
const BASE_SEARCH_PAGE_SIZE = 40;
const BASE_HYDRATE_LIMIT = 16;
const BASE_CONTEXT_SOURCE_LIMIT = 10;
const BASE_PASSAGE_LIMIT = 6;

const STOPWORDS = new Set([
  'и', 'в', 'во', 'на', 'по', 'с', 'со', 'к', 'ко', 'у', 'о', 'об', 'от', 'до', 'для',
  'как', 'что', 'это', 'эта', 'этот', 'эти', 'или', 'ли', 'не', 'но', 'а', 'из', 'за',
  'the', 'and', 'for', 'with', 'from', 'into', 'about', 'wiki', 'статья', 'статьи',
  'документация', 'док', 'нужно', 'можно', 'где', 'какой', 'какая', 'какие',
]);

const BRIEF_HINT_RE = /\b(кратко|коротко|сжато|в двух словах|быстро)\b/i;
const DETAIL_HINT_RE = /\b(подроб|развернут|разв[её]рнут|углуб|детальн|пошагов|полный контекст|максимально|со всеми деталями|с пояснениями|глубже|шире)\b/i;
const DEEP_HINT_RE = /\b(максимально подробно|максимально развернуто|собери полный контекст|раскрой полностью|глубокий разбор|углубленный ответ|углубл[её]нный ответ|очень подробно)\b/i;
const FOLLOW_UP_ONLY_RE = /^(а\s+)?(теперь\s+)?((сделай|дай|раскрой|объясни|распиши|расскажи|покажи)\s+)?(более\s+)?(подробн(?:ый|о)|развернут(?:ый|о)|разв[её]рнут(?:ый|о)|углублен(?:ный|но)|углубл[её]н(?:ный|но)|детальн(?:о|ый)|глубже|шире|полнее|пошагово|с пояснениями|со всеми деталями)(\s+ответ)?$/i;
const CREATE_VERB_RE = /(создай|создать|сделай|подготовь|сгенерируй|опубликуй|добавь)/i;
const ARTICLE_NOUN_RE = /(стать[яю]|вики[\s-]*стать[яю]|wiki[\s-]*стать[яю]|wiki\s+article|wiki\s+page|страниц[ау])/i;

function uniqueValues<T>(list: T[]) {
  return Array.from(new Set(list));
}

function normalizeWikiBase(raw?: string) {
  return String(raw || '').trim().replace(/\/+$/, '') || DEFAULT_WIKI_BASE;
}

function normalizeBearerToken(raw?: string) {
  const value = String(raw || '').trim();
  if (!value) return '';
  return /^Bearer\s+/i.test(value) ? value : `Bearer ${value}`;
}

function buildWikiHeaders(token?: string) {
  const bearer = normalizeBearerToken(token);
  if (!bearer) return null;
  return {
    Accept: 'application/json',
    Authorization: bearer,
  };
}

function shouldBypassProxyForUrl(targetUrl: string) {
  try {
    const url = new URL(targetUrl);
    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function fetchWithRouting(cfg: WikiIntelligenceConfig, targetUrl: string, init?: RequestInit) {
  if (!shouldBypassProxyForUrl(targetUrl) && cfg.useProxy !== false && String(cfg.proxyBase || '').trim()) {
    return proxyFetch(
      {
        base: String(cfg.proxyBase || '').trim(),
        mode: cfg.proxyMode,
        signal: cfg.signal,
      },
      targetUrl,
      init
    );
  }
  return fetch(targetUrl, { ...init, signal: cfg.signal });
}

async function fetchJson<T>(cfg: WikiIntelligenceConfig, targetUrl: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithRouting(cfg, targetUrl, init);
  if (!response.ok) {
    const text = String(await response.text().catch(() => '') || '').trim().slice(0, 220);
    throw new Error(`HTTP ${response.status}${text ? `: ${text}` : ''}`);
  }
  return response.json() as Promise<T>;
}

function extractWikiArticleRef(raw: string) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const directUrl = value.match(/https?:\/\/wiki\.wb\.ru\/(?:api\/v1\/)?space\/\d+\/(?:article|page)\/\d+/i);
  if (directUrl) return directUrl[0];
  const inlineRef = value.match(/\b\d+\s*\/\s*\d+\b/);
  if (inlineRef) return inlineRef[0].replace(/\s+/g, '');
  return '';
}

function parseWikiArticleRef(raw: string) {
  const value = extractWikiArticleRef(raw);
  if (!value) return null;
  const apiMatch = value.match(/\/api\/v1\/space\/(\d+)\/(?:article|page)\/(\d+)/i);
  if (apiMatch) return { spaceId: apiMatch[1], articleRef: apiMatch[2] };
  const uiMatch = value.match(/\/space\/(\d+)\/(?:article|page)\/(\d+)/i);
  if (uiMatch) return { spaceId: uiMatch[1], articleRef: uiMatch[2] };
  const compactMatch = value.match(/^(\d+)\/(\d+)$/);
  if (compactMatch) return { spaceId: compactMatch[1], articleRef: compactMatch[2] };
  return null;
}

function buildArticleApiUrl(base: string, spaceId: string, articleNumber: string) {
  return `${base}/api/v1/space/${encodeURIComponent(spaceId)}/article/${encodeURIComponent(articleNumber)}`;
}

function buildArticleCreateUrls(base: string, spaceId: string) {
  const encoded = encodeURIComponent(spaceId);
  return [
    `${base}/api/v1/space/${encoded}/article`,
    `${base}/api/v1/space/${encoded}/articles`,
  ];
}

function buildArticleUiUrl(base: string, spaceId: string, articleNumber: string, title = '', spacePrefix = '') {
  const encodedPrefix = String(spacePrefix || '').trim() ? `/${encodeURIComponent(String(spacePrefix).trim())}` : '';
  const encodedTitle = title ? `/${encodeURIComponent(title)}` : '';
  return `${base}/space/${encodeURIComponent(spaceId)}${encodedPrefix}/page/${encodeURIComponent(articleNumber)}${encodedTitle}`;
}

function parseWikiSpaceRef(raw: string) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const directUrl = value.match(/https?:\/\/wiki\.wb\.ru\/(?:api\/v1\/)?space\/(\d+)(?:\/|$)/i);
  if (directUrl) return directUrl[1];
  const inline = value.match(/\bspace\/(\d+)\b/i);
  if (inline) return inline[1];
  const named = value.match(/\b(?:space|спейс|пространство)\s*[:#-]?\s*(\d+)\b/i);
  if (named) return named[1];
  return '';
}

function extractArticleNumber(item: any) {
  return String(
    item?.article_number ||
    item?.articleNumber ||
    item?.article_id ||
    item?.articleId ||
    item?.id ||
    item?.number ||
    item?.page_id ||
    item?.pageId ||
    item?.article?.article_number ||
    item?.article?.articleNumber ||
    item?.article?.id ||
    ''
  ).trim();
}

function parseSpaceArticleRef(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const apiMatch = raw.match(/\/api\/v1\/space\/(\d+)\/(?:article|page)\/(\d+)/i);
  if (apiMatch) return { spaceId: apiMatch[1], articleNumber: apiMatch[2] };
  const uiMatch = raw.match(/\/space\/(\d+)\/(?:article|page)\/(\d+)/i);
  if (uiMatch) return { spaceId: uiMatch[1], articleNumber: uiMatch[2] };
  return null;
}

function extractSpaceArticleRef(item: any) {
  const directSpaceId = String(
    item?.space_id ||
    item?.spaceId ||
    item?.space?.id ||
    item?.space?.space_id ||
    item?.space_info?.id ||
    item?.path?.space_id ||
    item?.path?.spaceId ||
    ''
  ).trim();
  const directArticleNumber = extractArticleNumber(item);
  if (directSpaceId && directArticleNumber) {
    return { spaceId: directSpaceId, articleNumber: directArticleNumber };
  }

  const pathLikeCandidates = [
    item?.url,
    item?.web_url,
    item?.link,
    item?.path,
    item?.page_url,
    item?.article_url,
    item?.article?.url,
    item?.article?.web_url,
    item?.article?.link,
    item?.article?.path,
  ];

  for (const candidate of pathLikeCandidates) {
    const parsed = parseSpaceArticleRef(candidate);
    if (parsed) return parsed;
  }

  return null;
}

function extractArticleList(payload: any) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.articles)) return payload.articles;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data?.articles)) return payload.data.articles;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function normalizeText(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[_/\\]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s.-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectKeywords(question: string) {
  return uniqueValues(
    normalizeText(question)
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length >= 3 && !STOPWORDS.has(token))
  ).slice(0, 12);
}

function isSubstantiveQuestion(text: string) {
  if (parseWikiArticleRef(text)) return true;
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (FOLLOW_UP_ONLY_RE.test(raw)) return false;
  const keywords = collectKeywords(raw);
  return keywords.length >= 2 || raw.length >= 18;
}

function findLastTopicQuestion(history: WikiChatTurn[]) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (turn.role !== 'user') continue;
    if (isSubstantiveQuestion(turn.text)) return String(turn.text || '').trim();
  }
  return '';
}

function isContextFollowUp(question: string) {
  const raw = String(question || '').trim();
  if (!raw) return false;
  if (FOLLOW_UP_ONLY_RE.test(raw)) return true;
  const normalized = normalizeText(raw);
  if (DETAIL_HINT_RE.test(raw) && collectKeywords(raw).length <= 2) return true;
  if (normalized.split(/\s+/).length <= 5 && /\b(это|этот|эта|эту|тема|процесс|шаги|детали|нюансы|пример|примеры|роль|роли)\b/i.test(normalized)) return true;
  if (/^(а\s+)?(что|как|почему|зачем|когда|где|кто)\b/i.test(normalized) && collectKeywords(raw).length <= 2) return true;
  return false;
}

function resolveResponseProfile(question: string, history: WikiChatTurn[]): WikiResponseProfile {
  const raw = String(question || '').trim();
  if (BRIEF_HINT_RE.test(raw)) return 'brief';
  if (DEEP_HINT_RE.test(raw)) return 'deep';
  if (DETAIL_HINT_RE.test(raw)) return 'detailed';
  if (FOLLOW_UP_ONLY_RE.test(raw) && history.length) return 'deep';
  return 'standard';
}

function buildAnswerPlan(question: string, history: WikiChatTurn[], persona: WikiPersona = 'release_engineer'): WikiAnswerPlan {
  const originalQuestion = String(question || '').trim();
  const profile = resolveResponseProfile(originalQuestion, history);
  const previousTopic = findLastTopicQuestion(history);
  const followUp = Boolean(previousTopic) && isContextFollowUp(originalQuestion);

  let effectiveQuestion = originalQuestion;
  if (followUp) {
    effectiveQuestion = FOLLOW_UP_ONLY_RE.test(originalQuestion)
      ? previousTopic
      : `${previousTopic}. ${originalQuestion}`;
  }

  const topicQuestion = followUp ? previousTopic : originalQuestion;

  const profileMap: Record<WikiResponseProfile, Omit<WikiAnswerPlan, 'originalQuestion' | 'effectiveQuestion' | 'topicQuestion' | 'isFollowUp' | 'profile' | 'persona'>> = {
    brief: {
      searchPageSize: 16,
      hydrateLimit: 4,
      contextSourceLimit: 4,
      passageLimit: 2,
      historyLimit: 4,
      maxTokens: 900,
    },
    standard: {
      searchPageSize: 20,
      hydrateLimit: 6,
      contextSourceLimit: 6,
      passageLimit: 4,
      historyLimit: 6,
      maxTokens: 1600,
    },
    detailed: {
      searchPageSize: 30,
      hydrateLimit: 10,
      contextSourceLimit: 8,
      passageLimit: 5,
      historyLimit: 10,
      maxTokens: 2200,
    },
    deep: {
      searchPageSize: 40,
      hydrateLimit: 14,
      contextSourceLimit: 10,
      passageLimit: 6,
      historyLimit: 12,
      maxTokens: 3000,
    },
  };

  return {
    originalQuestion,
    effectiveQuestion,
    topicQuestion,
    isFollowUp: followUp,
    profile,
    persona,
    ...profileMap[profile],
  };
}

function detectCreateArticleIntent(question: string) {
  const raw = String(question || '').trim();
  if (!raw) return false;
  const normalized = raw.replace(/[«»“”]/g, '"');
  return CREATE_VERB_RE.test(normalized) && ARTICLE_NOUN_RE.test(normalized);
}

function extractQuotedTitle(question: string) {
  const raw = String(question || '').trim();
  const direct = raw.match(/(?:название|заголовок|title)\s*[:\-]\s*[«"“]([^"»”\n]+)[»"”]/i);
  if (direct) return direct[1].trim();
  const afterArticle = raw.match(/(?:стать[ьюя]|wiki[\s-]*стать[ьюя]|вики[\s-]*стать[ьюя])\s*[«"“]([^"»”\n]+)[»"”]/i);
  if (afterArticle) return afterArticle[1].trim();
  const named = raw.match(/(?:назови|с названием)\s*[«"“]([^"»”\n]+)[»"”]/i);
  if (named) return named[1].trim();
  const plain = raw.match(/(?:стать[ьюя]|wiki[\s-]*стать[ьюя]|вики[\s-]*стать[ьюя])\s+(.+?)(?=\s+(?:в|во)\s+(?:https?:\/\/wiki\.wb\.ru\/\S+|space\/\d+|\d+\s*\/\s*\d+)|\s+(?:по теме|на тему|тема|контент|содержание)\b|$)/i);
  if (plain?.[1]) return plain[1].trim().replace(/^["«“]|["»”]$/g, '');
  return '';
}

function extractCreateTopic(question: string, title: string) {
  const raw = String(question || '').trim();
  const explicit = raw.match(/(?:контент|содержание|описание|по теме|на тему|тема)\s*[:\-]?\s*(.+)$/i);
  if (explicit?.[1]) return explicit[1].trim();
  let residual = raw
    .replace(CREATE_VERB_RE, ' ')
    .replace(ARTICLE_NOUN_RE, ' ')
    .replace(/(?:в|во)\s+https?:\/\/wiki\.wb\.ru\/\S+/gi, ' ')
    .replace(/\b(?:space|спейс|пространство)\s*[:#-]?\s*\d+\b/gi, ' ')
    .replace(/\b\d+\s*\/\s*\d+\b/g, ' ')
    .replace(/(?:название|заголовок|title)\s*[:\-]\s*[«"][^"»\n]+[»"]/gi, ' ')
    .replace(/(?:с названием|назови)\s*[«"][^"»\n]+[»"]/gi, ' ')
    .trim();
  if (title) residual = residual.replace(title, ' ').trim();
  residual = residual.replace(/\s+/g, ' ').trim();
  return residual || title || '';
}

function parseCreateTarget(question: string): WikiCreateTarget | undefined {
  const articleRef = parseWikiArticleRef(question);
  if (articleRef?.spaceId) {
    return {
      spaceId: articleRef.spaceId,
      parentArticleNumber: articleRef.articleRef,
      raw: extractWikiArticleRef(question) || `${articleRef.spaceId}/${articleRef.articleRef}`,
    };
  }
  const spaceId = parseWikiSpaceRef(question);
  if (!spaceId) return undefined;
  return { spaceId, raw: `space/${spaceId}` };
}

function parseCreateCommand(question: string, history: WikiChatTurn[]): WikiCreateCommand {
  if (!detectCreateArticleIntent(question)) {
    return { requested: false, title: '', topic: '', missing: [] };
  }

  const title = extractQuotedTitle(question);
  const target = parseCreateTarget(question);
  let topic = extractCreateTopic(question, title);
  if (!topic) {
    const previousTopic = findLastTopicQuestion(history);
    if (previousTopic && !detectCreateArticleIntent(previousTopic)) topic = previousTopic;
  }

  const missing: string[] = [];
  if (!target) missing.push('куда создать');
  if (!title) missing.push('название статьи');
  if (!topic) missing.push('о чём должна быть статья');

  return {
    requested: true,
    title,
    topic,
    target,
    missing,
  };
}

function buildKeywordVariants(question: string, keywords: string[]) {
  const variants = [...keywords];
  const normalizedQuestion = normalizeText(question);
  if (normalizedQuestion.length >= 6) variants.push(normalizedQuestion);

  if (/(регресс|регресса|regress|regression)/i.test(normalizedQuestion)) {
    variants.push(
      'регресс',
      'регресса',
      'процесс регресса',
      'прохождение регресса',
      'process regressa',
      'process regress',
      'regressa',
      'regression'
    );
  }

  if (/(прогон|smoke|high blocker|селектив|selective)/i.test(normalizedQuestion)) {
    variants.push('smoke', 'high blocker', 'selective', 'прогон');
  }

  return uniqueValues(variants.map(item => normalizeText(item)).filter(Boolean)).slice(0, 24);
}

function buildQueryCandidates(question: string, keywords: string[]) {
  const queries = [
    question.trim(),
    keywords.join(' ').trim(),
    keywords.slice(0, 6).join(' ').trim(),
    ...keywords.slice(0, 6),
  ].filter(Boolean);

  queries.push(
    ...keywords.filter(item => item.includes(' ')).slice(0, 8),
    ...keywords.filter(item => /[a-z]/i.test(item)).slice(0, 8)
  );

  const normalizedQuestion = normalizeText(question);
  if (/(регресс|regress|regression)/i.test(normalizedQuestion)) {
    queries.push('регресс релиз', 'регрессионное тестирование', 'process regress', 'process regressa');
  }
  if (/(чп|prod|crash|bug|vlet)/i.test(normalizedQuestion)) {
    queries.push('чп релиз', 'prod bug crash', 'vlet');
  }
  if (/(rollback|откат)/i.test(normalizedQuestion)) {
    queries.push('rollback релиз', 'откат релиза');
  }

  return uniqueValues(queries.map(item => item.trim()).filter(Boolean)).slice(0, 10);
}

function buildSourceDigest(question: string, sources: WikiKnowledgeSource[], passageLimit = BASE_PASSAGE_LIMIT) {
  const keywordVariants = buildKeywordVariants(question, collectKeywords(question));
  const normalizedQuestion = normalizeText(question);
  const lines = sources.map((source, index) => {
    const titleNorm = normalizeText(source.title);
    const titleMatch = keywordVariants.filter(item => item && titleNorm.includes(item)).slice(0, 6);
    const passages = extractPassages(source.content || source.excerpt || source.summary, keywordVariants, Math.min(4, passageLimit));
    return [
      `Источник ${index + 1}: ${source.title}`,
      `Ссылка: ${source.url}`,
      `Почему попал в контекст: ${titleMatch.length ? `совпадения в title — ${titleMatch.join(', ')}` : 'релевантен по содержанию и excerpt'}`,
      `Главные выдержки:`,
      ...passages.map(item => `- ${item}`),
    ].join('\n');
  });

  const explicitMatches = sources.filter(source => normalizeText(source.title).includes(normalizedQuestion));
  const phraseMatches = sources.filter(source => keywordVariants.some(item => item.includes(' ') && normalizeText(source.title).includes(item)));

  return [
    `По вопросу найдено ${sources.length} статей.`,
    explicitMatches.length ? `Точное/почти точное совпадение по title есть у ${explicitMatches.map(item => item.title).join('; ')}.` : '',
    phraseMatches.length ? `Сильные phrase-match статьи: ${phraseMatches.map(item => item.title).join('; ')}.` : '',
    ...lines,
  ].filter(Boolean).join('\n\n');
}

function scoreText(text: string, title: string, keywords: string[]) {
  const titleNorm = normalizeText(title);
  const textNorm = normalizeText(text);
  const haystack = `${titleNorm} ${textNorm}`;
  let score = 0;
  for (const keyword of keywords) {
    if (!keyword) continue;
    const weight = keyword.includes(' ') ? 2.2 : 1;
    if (titleNorm === keyword) score += 40 * weight;
    else if (titleNorm.includes(keyword)) score += 18 * weight;
    if (textNorm.includes(keyword)) score += 6 * weight;
    if (haystack.includes(keyword)) score += 2 * weight;
  }
  return score;
}

function stripMarkup(value: string) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[#>*_~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeText(value: string, max = 260) {
  const text = stripMarkup(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function extractPassages(content: string, keywords: string[], maxPassages = BASE_PASSAGE_LIMIT) {
  const cleaned = String(content || '');
  const parts = cleaned
    .split(/\n{2,}|(?<=\.)\s+(?=[A-ZА-ЯЁ])/)
    .map(part => stripMarkup(part))
    .filter(part => part.length >= 30);

  const scored = parts
    .map(part => ({
      text: part,
      score: keywords.reduce((sum, keyword) => sum + (normalizeText(part).includes(keyword) ? 1 : 0), 0),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.text.length - a.text.length)
    .slice(0, maxPassages)
    .map(item => summarizeText(item.text, 320));

  if (scored.length) return scored;
  return parts.slice(0, maxPassages).map(part => summarizeText(part, 320));
}

function extractLlmTextFromPayload(payload: any) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  for (const choice of choices) {
    const content = choice?.message?.content ?? choice?.delta?.content;
    if (typeof content === 'string' && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const joined = content
        .map((part: any) => typeof part === 'string' ? part : String(part?.text || part?.content || ''))
        .join('')
        .trim();
      if (joined) return joined;
    }
  }
  return '';
}

function extractLlmFinishReason(payload: any) {
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  for (const choice of choices) {
    const finishReason = String(choice?.finish_reason || choice?.finishReason || '').trim();
    if (finishReason) return finishReason;
  }
  return '';
}

function looksTruncatedText(text: string) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/[.!?…»"]$/.test(value)) return false;
  if (/(\)|\]|\})$/.test(value)) return false;
  return true;
}

async function requestLlmText(
  cfg: WikiIntelligenceConfig,
  body: Record<string, unknown>
) {
  const glmBase = normalizeGlmBase(cfg.glmBase);
  if (!glmBase) return { text: '', finishReason: '' };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (String(cfg.glmKey || '').trim()) headers.Authorization = `Bearer ${String(cfg.glmKey || '').trim()}`;

  const response = await fetchWithRouting(cfg, `${glmBase}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = String(await response.text().catch(() => '') || '').trim().slice(0, 220);
    throw new Error(`LLM error: ${response.status}${text ? ` — ${text}` : ''}`);
  }

  const payload = await response.json().catch(() => ({}));
  return {
    text: extractLlmTextFromPayload(payload),
    finishReason: extractLlmFinishReason(payload),
  };
}

async function requestLlmWithContinuation(
  cfg: WikiIntelligenceConfig,
  params: {
    model: string;
    system: string;
    user: string;
    maxTokens: number;
    temperature: number;
    sanitize?: boolean;
    replaceSourcesWith?: WikiKnowledgeSource[];
  }
) {
  const {
    model,
    system,
    user,
    maxTokens,
    temperature,
    sanitize = true,
    replaceSourcesWith = [],
  } = params;

  let combined = '';
  let finishReason = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const messages = attempt === 0
      ? [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ]
      : [
          { role: 'system', content: system },
          { role: 'user', content: user },
          { role: 'assistant', content: combined },
          { role: 'user', content: 'Продолжи ответ с того места, где остановился. Не повторяй уже написанное. Верни только продолжение.' },
        ];

    const chunk = await requestLlmText(cfg, {
      model,
      stream: false,
      temperature,
      max_tokens: maxTokens,
      messages,
    });

    const piece = String(chunk.text || '').trim();
    if (!piece) break;
    combined = [combined, piece].filter(Boolean).join(combined ? '\n' : '');
    finishReason = chunk.finishReason;

    if (finishReason && finishReason !== 'length' && !looksTruncatedText(piece)) {
      break;
    }
    if (!looksTruncatedText(piece) && finishReason !== 'length') {
      break;
    }
  }

  const withSources = replaceSourcesWith.length ? replaceSourceMarkers(combined, replaceSourcesWith) : combined;
  return sanitize ? sanitizeAnswerText(withSources) : String(withSources || '').replace(/\n{3,}/g, '\n\n').trim();
}

/* ─── WEB SEARCH ─────────────────────────────────────────── */

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  content: string;
}

function htmlToText(html: string): string {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}


async function searchWebDuckDuckGo(cfg: WikiIntelligenceConfig, query: string): Promise<WebSearchResult[]> {
  const response = await fetchWithRouting(cfg, 'https://lite.duckduckgo.com/lite/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (compatible; WikiIntelligence/1.0)',
      'Accept': 'text/html',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    },
    body: `q=${encodeURIComponent(query)}&kl=ru-ru`,
  });

  if (!response.ok) return [];
  const html = await response.text().catch(() => '');

  const results: WebSearchResult[] = [];

  // DDG Lite uses single quotes: href="URL" class='result-link'>Title</a>
  // href comes before class in the actual markup
  const linkRe = /href="(https?:\/\/[^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g;

  const links: Array<{ url: string; title: string }> = [];
  let m: RegExpExecArray | null;

  while ((m = linkRe.exec(html)) !== null && links.length < 10) {
    const url = String(m[1] || '').trim();
    const title = htmlToText(m[2]).trim();
    if (url && title) links.push({ url, title });
  }

  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) !== null) {
    const text = htmlToText(m[1]).trim();
    if (text) snippets.push(text);
  }

  for (let i = 0; i < Math.min(links.length, 8); i++) {
    const snippet = snippets[i] || '';
    results.push({ title: links[i].title, url: links[i].url, snippet, content: snippet });
  }

  return results.filter(r => r.title && r.url);
}

async function searchWebBrave(cfg: WikiIntelligenceConfig, query: string, count = 8): Promise<WebSearchResult[]> {
  const key = String(cfg.webSearchKey || '').trim();
  const searchUrl = `${BRAVE_SEARCH_URL}?${new URLSearchParams({
    q: query,
    count: String(count),
    country: 'ru',
    search_lang: 'ru',
    text_decorations: 'false',
    result_filter: 'web',
  })}`;

  const response = await fetchWithRouting(cfg, searchUrl, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': key,
    },
  });

  if (!response.ok) {
    const text = String(await response.text().catch(() => '') || '').trim().slice(0, 220);
    throw new Error(`Brave Search error: ${response.status}${text ? ` — ${text}` : ''}`);
  }

  const payload = await response.json().catch(() => ({}));
  const items: any[] = Array.isArray(payload?.web?.results) ? payload.web.results : [];
  return items.map((item: any) => ({
    title: String(item?.title || '').trim(),
    url: String(item?.url || '').trim(),
    snippet: String(item?.description || '').trim(),
    content: String(item?.description || '').trim(),
  })).filter(r => r.title && r.url);
}

async function searchWeb(cfg: WikiIntelligenceConfig, query: string): Promise<WebSearchResult[]> {
  const key = String(cfg.webSearchKey || '').trim();
  const results = key
    ? await searchWebBrave(cfg, query)
    : await searchWebDuckDuckGo(cfg, query);
  return results.filter(r => r.title && r.url);
}

/* ─── WIKI SEARCH ────────────────────────────────────────── */

async function searchWikiArticles(cfg: WikiIntelligenceConfig, question: string, plan: WikiAnswerPlan) {
  const headers = buildWikiHeaders(cfg.wikiToken);
  if (!headers) throw new Error('Wiki token не настроен');

  const base = normalizeWikiBase(cfg.wikiBase);
  const baseKeywords = collectKeywords(question);
  const keywords = buildKeywordVariants(question, baseKeywords);
  const queries = buildQueryCandidates(question, keywords);

  const merged = new Map<string, WikiKnowledgeSource>();

  const explicitRef = parseWikiArticleRef(question);
  if (explicitRef) {
    try {
      const apiUrl = buildArticleApiUrl(base, explicitRef.spaceId, explicitRef.articleRef);
      const payload = await fetchJson<any>(cfg, apiUrl, { headers });
      const article = payload?.article || payload?.data?.article || payload?.data || payload;
      const content = String(article?.markdown || article?.content || payload?.markdown || payload?.content || '');
      const title = String(article?.title || article?.name || `Wiki article ${explicitRef.articleRef}`).trim();
      const source: WikiKnowledgeSource = {
        uid: `wiki:${explicitRef.spaceId}:${explicitRef.articleRef}`,
        id: `space/${explicitRef.spaceId}/article/${explicitRef.articleRef}`,
        title,
        url: buildArticleUiUrl(base, explicitRef.spaceId, explicitRef.articleRef, title),
        apiUrl,
        spaceId: explicitRef.spaceId,
        articleNumber: explicitRef.articleRef,
        summary: summarizeText(content || title),
        excerpt: extractPassages(content || title, keywords, Math.min(2, plan.passageLimit))[0] || summarizeText(content || title),
        content,
        updatedAt: Number(article?.updated_at || article?.updatedAt || article?.created_at || article?.createdAt || 0),
        author: String(article?.author?.name || article?.updated_by?.name || article?.created_by?.name || '—'),
        score: 1000,
      };
      merged.set(source.uid, source);
    } catch {
      /* ignore explicit fetch failure; continue with search */
    }
  }

  const searchResults = await Promise.all(
    queries.map(query =>
      fetchJson<any>(cfg, `${base}/api/v1/article_search`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json;charset=UTF-8' },
        body: JSON.stringify({ query, exact_match: false, page: 1, page_size: plan.searchPageSize }),
      }).catch(() => null).then(payload => ({ query, payload }))
    )
  );

  for (const { query, payload } of searchResults) {
    const items = extractArticleList(payload);
    for (const item of items) {
      const ref = extractSpaceArticleRef(item);
      if (!ref?.spaceId || !ref?.articleNumber) continue;
      const spaceId = ref.spaceId;
      const articleNumber = ref.articleNumber;
      const uid = `wiki:${spaceId}:${articleNumber}`;
      const title = String(item?.title || item?.name || item?.article?.title || `Wiki article ${articleNumber}`).trim();
      const content = String(item?.snippet || item?.summary || item?.description || item?.content || item?.excerpt || title);
      const score = scoreText(content, title, keywords) + (normalizeText(query) === normalizeText(question) ? 6 : 0);

      const source: WikiKnowledgeSource = {
        uid,
        id: `space/${spaceId}/article/${articleNumber}`,
        title,
        url: buildArticleUiUrl(base, spaceId, articleNumber, title),
        apiUrl: buildArticleApiUrl(base, spaceId, articleNumber),
        spaceId,
        articleNumber,
        summary: summarizeText(content || title),
        excerpt: extractPassages(content || title, keywords, Math.min(2, plan.passageLimit))[0] || summarizeText(content || title),
        content,
        updatedAt: Number(item?.updated_at || item?.updatedAt || item?.created_at || item?.createdAt || 0),
        author: String(item?.author?.name || item?.updated_by?.name || item?.created_by?.name || '—'),
        score,
      };

      const existing = merged.get(uid);
      if (!existing || existing.score < source.score) merged.set(uid, source);
    }
  }

  const ranked = Array.from(merged.values())
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
    .slice(0, plan.hydrateLimit);

  const hydrated = await Promise.all(ranked.map(async source => {
    const payload = await fetchJson<any>(cfg, source.apiUrl, { headers }).catch(() => null);
    if (!payload) return source;
    const article = payload?.article || payload?.data?.article || payload?.data || payload;
    const content = String(article?.markdown || article?.content || payload?.markdown || payload?.content || source.content || '');
    const title = String(article?.title || article?.name || source.title).trim();
    return {
      ...source,
      title,
      summary: summarizeText(content || title),
      excerpt: extractPassages(content || title, keywords, plan.passageLimit).join('\n- ') || source.excerpt,
      content,
      updatedAt: Number(article?.updated_at || article?.updatedAt || article?.created_at || article?.createdAt || source.updatedAt || 0),
      author: String(article?.author?.name || article?.updated_by?.name || article?.created_by?.name || source.author || '—'),
      score: source.score + scoreText(content, title, keywords),
    };
  }));

  return hydrated
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
    .slice(0, plan.contextSourceLimit);
}

// ─── PERSONA SYSTEM ──────────────────────────────────────────

interface PersonaConfig {
  title: string;
  domain: string;
  thinking: string[];
  learningHint: string;
  structures: Record<WikiResponseProfile, string>;
  articleApproach: string[];
}

const PERSONA_CONFIG: Record<WikiPersona, PersonaConfig> = {
  release_engineer: {
    title: 'Senior Release Engineer в release-команде Wildberries',
    domain: 'Глубокая экспертиза в мобильных релизах iOS/Android, QA-автоматизации, CI/CD, управлении инцидентами и тестировании.',
    thinking: [
      'Разбираешь что реально спрашивают — за буквой вопроса ищешь практическую задачу',
      'Анализируешь источники на противоречия, устаревшие данные, пробелы',
      'Отвечаешь как практик: рекомендации и выводы важнее пересказа документации',
      'Разделяешь "что делать", "почему именно так", "что может сломаться"',
      'Называешь числа, конкретные команды и шаги — без расплывчатых формулировок',
      'Если источники расходятся — явно объясняешь в чём расхождение и какой актуальнее',
      'Если данных не хватает — прямо говоришь что именно неясно и как это выяснить',
    ],
    learningHint: 'Замечаешь паттерны в истории диалога — если тема углубляется, с каждым ответом раскрываешь больше деталей и связей. Не повторяешь уже озвученные выводы, а строишь поверх них.',
    structures: {
      brief: [
        'Структура ответа (plain text):',
        'Разбор: [1-2 предложения — суть вопроса и что говорят источники]',
        'Ответ: [прямой и конкретный, без воды]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      standard: [
        'Структура ответа (plain text, маркеры •):',
        'Разбор: [2-3 предложения — что спрашивают, что говорят источники, есть ли противоречия]',
        'Ответ: [прямой ответ 1-3 предложения]',
        'Как это работает:',
        '• [конкретный шаг или механика]',
        'На что обратить внимание:',
        '• [риск, нюанс, типичная ошибка]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      detailed: [
        'Структура ответа (plain text, маркеры •):',
        'Разбор: [3-4 предложения — анализ вопроса, оценка источников, противоречия или пробелы]',
        'Ответ: [прямой и конкретный]',
        'Детальный разбор: [шаги, механика, примеры — всё нужное для практического применения]',
        'Риски и подводные камни:',
        '• [что может пойти не так и почему]',
        'Расхождения между источниками: [если есть — объясни какой актуальнее]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      deep: [
        'Максимально глубокий разбор. Используй весь доступный контекст.',
        'Структура ответа (plain text, маркеры •):',
        'Разбор: [4-5 предложений — полный анализ: что спрашивают, что говорят источники, противоречия, пробелы]',
        'Ответ: [прямой и конкретный]',
        'Полный разбор: [исчерпывающая механика, шаги, причины — как объяснял бы senior коллеге]',
        'Практическое применение: [конкретные действия, последовательность, примеры]',
        'Риски, нюансы и edge cases:',
        '• [детально — что может сломаться, когда, почему, как предотвратить]',
        'Расхождения и неочевидные моменты: [всё что противоречит или вызывает сомнения]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
    },
    articleApproach: [
      'Пишешь как практик: каждый раздел отвечает на конкретный вопрос — "что делать" и "почему именно так"',
      'Числа, команды, ссылки на инструменты — везде где они есть в источниках',
      'Если источники расходятся — явно указываешь где и какой актуальнее',
      'Структура: введение (зачем статья) → механика/шаги → нюансы и подводные камни → Источники',
    ],
  },

  analyst: {
    title: 'Senior Data/Release Analyst в Wildberries',
    domain: 'Глубокая экспертиза в анализе качества релизов, метриках тестирования, ЧП и инцидентах, аномальных паттернах и трендах мобильных приложений iOS/Android.',
    thinking: [
      'Видишь данные за словами — переводишь вопрос в конкретные метрики и измеримые показатели',
      'Ищешь корреляции, аномалии и тренды — не просто описываешь, а интерпретируешь',
      'Сравниваешь текущее с историческим: что изменилось, на сколько, почему',
      'Разделяешь "что произошло", "почему это произошло", "что из этого следует"',
      'Оцениваешь бизнес-импакт: сколько пользователей затронуто, критичность, влияние на метрики релиза',
      'Ищешь root cause, а не только симптомы — задаёшь себе вопрос "почему?" минимум 3 раза',
      'Называешь конкретные пороговые значения, дельты, коэффициенты — никаких расплывчатых "примерно"',
      'Если данных недостаточно — явно указываешь какие именно данные нужны для вывода',
    ],
    learningHint: 'Строишь анализ поверх того, что уже обсуждалось — не повторяешь выводы, а углубляешь и уточняешь картину. Если пользователь уточняет метрику — погружаешься в неё глубже каждый ответ.',
    structures: {
      brief: [
        'Структура ответа (plain text):',
        'Разбор данных: [1-2 предложения — что за метрика/явление, что говорят источники]',
        'Вывод: [чёткий аналитический вывод с цифрой или оценкой]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      standard: [
        'Структура ответа (plain text, маркеры •):',
        'Разбор данных: [2-3 предложения — что измеряем, что показывают источники, есть ли аномалии]',
        'Вывод: [конкретный аналитический вывод]',
        'Что это значит на практике:',
        '• [интерпретация, бизнес-импакт или следствие для команды]',
        'Что проверить дополнительно:',
        '• [какие данные и метрики нужны для полного вывода]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      detailed: [
        'Структура ответа (plain text, маркеры •):',
        'Разбор данных: [3-4 предложения — что анализируем, какие данные есть, где пробелы]',
        'Аналитический вывод: [конкретный ответ с цифрами]',
        'Тренды и корреляции:',
        '• [наблюдаемые паттерны, сравнения с историческим]',
        'Root cause анализ:',
        '• [почему это происходит, цепочка причин]',
        'Бизнес-импакт: [влияние на метрики продукта и процессы релиза]',
        'Для полной картины нужно: [что ещё проверить или запросить]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      deep: [
        'Максимально глубокий аналитический разбор. Используй весь доступный контекст.',
        'Структура ответа (plain text, маркеры •):',
        'Разбор данных: [4-5 предложений — полный контекст: что измеряем, источники данных, пробелы и ограничения]',
        'Аналитический вывод: [конкретный с числами и оценкой достоверности]',
        'Полный анализ трендов:',
        '• [исторические паттерны, сезонность, корреляции с другими метриками]',
        'Root cause и гипотезы:',
        '• [детальная цепочка причин, альтернативные объяснения и их вероятность]',
        'Бизнес-импакт и риски: [влияние на продукт, команду, релизный процесс]',
        'Рекомендации:',
        '• [конкретные действия на основе анализа, приоритизированные]',
        'Что нужно для продолжения анализа: [какие данные, метрики, дополнительный контекст]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
    },
    articleApproach: [
      'Пишешь с аналитической точки зрения: чёткие метрики, методология, интерпретация данных',
      'Каждое утверждение подкреплено данными или ссылкой — никаких голословных выводов',
      'Явно указываешь что измеряется, как, с какой периодичностью и по каким пороговым значениям',
      'Структура: введение (что анализируем и зачем) → методология/метрики → выводы → рекомендации → Источники',
    ],
  },

  manager: {
    title: 'Senior Release/Project Manager в Wildberries',
    domain: 'Глубокая экспертиза в управлении мобильными релизами iOS/Android, координации команд QA/Dev/DevOps, управлении рисками, принятии решений Go/No-Go и коммуникации со стейкхолдерами.',
    thinking: [
      'Смотришь на задачу с точки зрения доставки: что нужно сделать, кто ответственен, в какой срок',
      'Первым делом идентифицируешь риски и зависимости — что может заблокировать релиз',
      'Переводишь технические детали в управленческие решения: Go/No-Go, эскалация, митигация',
      'Структурируешь коммуникацию: что сказать команде, что донести стейкхолдерам, что зафиксировать',
      'Предлагаешь конкретный следующий шаг с ответственным и сроком — не только описание ситуации',
      'Отделяешь блокеры от некритичных проблем — не всё одинаково важно для выпуска',
      'Оцениваешь trade-offs: скорость vs качество, риск vs бизнес-ценность',
    ],
    learningHint: 'Учитываешь из истории диалога контекст текущего релиза, уже принятые решения и открытые вопросы — не спрашиваешь повторно то, что уже прояснено. Строишь ответ как часть единого управленческого потока.',
    structures: {
      brief: [
        'Структура ответа (plain text):',
        'Ситуация: [1-2 предложения — суть вопроса и текущий статус]',
        'Решение: [конкретное решение или ответ]',
        'Следующий шаг: [кто, что, когда]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      standard: [
        'Структура ответа (plain text, маркеры •):',
        'Ситуация: [2-3 предложения — что происходит, текущий статус, контекст]',
        'Решение: [конкретный ответ или рекомендация]',
        'Риски и зависимости:',
        '• [что может помешать, кто вовлечён]',
        'Следующие шаги:',
        '• [конкретные действия с ответственными]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      detailed: [
        'Структура ответа (plain text, маркеры •):',
        'Ситуация: [3-4 предложения — полный контекст, ключевые факты, текущий статус]',
        'Решение: [конкретная рекомендация с обоснованием]',
        'Детальный план:',
        '• [шаги с ответственными и временными рамками]',
        'Риски и митигация:',
        '• [риск → как снизить или устранить]',
        'Коммуникационный план: [что сообщить команде, что — стейкхолдерам]',
        'Go/No-Go критерии: [что должно выполниться для продолжения]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      deep: [
        'Максимально глубокий управленческий разбор. Используй весь контекст.',
        'Структура ответа (plain text, маркеры •):',
        'Ситуация: [4-5 предложений — полный контекст, история вопроса, все вовлечённые стороны]',
        'Решение: [конкретная рекомендация с полным обоснованием]',
        'Полный план действий:',
        '• [детальные шаги: что, кто, когда, как проверить результат]',
        'Анализ рисков:',
        '• [риск → вероятность → импакт → митигация → резервный план]',
        'Коммуникационная матрица: [кому, что, в каком формате и когда сообщать]',
        'Критерии Go/No-Go: [точные измеримые условия для каждого решения]',
        'Эскалационный путь: [когда и к кому эскалировать если что-то пойдёт не так]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
    },
    articleApproach: [
      'Пишешь с управленческой точки зрения: процессы, ответственности, критерии решений',
      'Явно указываешь кто принимает решения, кто исполняет, кто информируется (RACI)',
      'Каждый процесс описан с входными данными, шагами, выходными данными и критериями готовности',
      'Структура: введение (что за процесс и когда применяется) → участники и роли → шаги → критерии Go/No-Go → типовые риски → Источники',
    ],
  },

  qa: {
    title: 'Senior QA Engineer в Wildberries',
    domain: 'Глубокая экспертиза в тестировании мобильных приложений iOS/Android, Allure TestOps, регрессионном тестировании, SWAT-прогонах, анализе дефектов и управлении качеством релизов.',
    thinking: [
      'Разбираешь вопрос с позиции качества: что может сломаться, как проверить, какой риск',
      'Разделяешь типы проверок по применимости: smoke, regression, high/blocker, SWAT, exploratory',
      'Анализируешь покрытие: что покрыто тестами, где пробелы, какие сценарии наиболее рискованные',
      'Оцениваешь дефекты по severity/priority, риску для релиза, воспроизводимости и изолированности',
      'Предлагаешь конкретные тест-кейсы или шаги воспроизведения, а не абстрактные рекомендации',
      'Мыслишь рисками: для каждого изменения думаешь что может зарегрессировать',
      'Разделяешь ручное и автоматическое тестирование — где что применимо и почему',
      'Если данных о покрытии нет — явно указываешь это как риск',
    ],
    learningHint: 'Замечаешь из диалога какие тест-сценарии и дефекты уже обсуждались — не повторяешь, строишь более глубокий анализ. Если тема повторяется — предлагаешь системное решение для предотвращения.',
    structures: {
      brief: [
        'Структура ответа (plain text):',
        'Разбор: [1-2 предложения — суть вопроса с позиции качества]',
        'Ответ по качеству: [конкретный ответ или оценка риска]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      standard: [
        'Структура ответа (plain text, маркеры •):',
        'Разбор: [2-3 предложения — что проверяется, какие риски, что говорят источники]',
        'Ответ по качеству: [конкретный ответ с оценкой риска]',
        'Тест-сценарии:',
        '• [конкретные шаги проверки или тест-кейс]',
        'Риски и дефекты:',
        '• [что может сломаться, какой severity]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      detailed: [
        'Структура ответа (plain text, маркеры •):',
        'Разбор: [3-4 предложения — полный QA-контекст, текущее покрытие, пробелы]',
        'Ответ по качеству: [конкретная оценка или рекомендация]',
        'Тест-сценарии:',
        '• [детальные шаги: preconditions, steps, expected result]',
        'Анализ дефектов и рисков:',
        '• [дефект → severity → priority → риск для релиза]',
        'Покрытие: [что покрыто автотестами, что требует ручной проверки, где пробелы]',
        'Рекомендация: [можно ли выпускать, что заблокировать, что отложить]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      deep: [
        'Максимально глубокий QA-разбор. Используй весь доступный контекст.',
        'Структура ответа (plain text, маркеры •):',
        'Разбор: [4-5 предложений — полный QA-контекст, история дефектов, состояние покрытия]',
        'Ответ по качеству: [чёткая оценка с обоснованием]',
        'Полный набор тест-сценариев:',
        '• [приоритизированный список: critical path → smoke → regression → edge cases]',
        'Детальный анализ дефектов:',
        '• [дефект → severity → priority → компонент → ожидаемое поведение → фактическое]',
        'Регрессионные риски:',
        '• [что могло зарегрессировать, почему, как проверить]',
        'Покрытие и пробелы: [текущее состояние по типам тестов, критические непокрытые сценарии]',
        'QA-решение для релиза: [Go/No-Go с чёткими условиями и критериями]',
        'Системные улучшения: [что исправить в процессе тестирования чтобы не повторялось]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
    },
    articleApproach: [
      'Пишешь с позиции QA: тест-кейсы, критерии готовности, риски качества',
      'Каждый процесс описан с точки зрения верификации: как проверить что сделано правильно',
      'Явно указываешь severity рисков, типы тестирования и критерии Go/No-Go',
      'Структура: введение (что тестируем и почему важно) → типы проверок → тест-сценарии → критерии Go/No-Go → типичные дефекты → Источники',
    ],
  },

  frontend: {
    title: 'Senior Frontend Developer в Wildberries',
    domain: 'Глубокая экспертиза в React, React Native, TypeScript, архитектуре UI-компонентов, производительности мобильных интерфейсов iOS/Android, state management и доступности.',
    thinking: [
      'Разбираешь задачу с точки зрения UX и технической реализации одновременно',
      'Оцениваешь влияние на производительность: bundle size, лишние re-renders, memory leaks, FPS',
      'Думаешь об архитектуре компонентов: переиспользуемость, изоляция состояния, testability',
      'Рассматриваешь совместимость: iOS vs Android различия в поведении, версии ОС, edge cases',
      'Предлагаешь конкретные паттерны и примеры кода — а не общие рекомендации',
      'Проверяешь на типичные ошибки: prop drilling, stale closures, uncontrolled re-renders, утечки',
      'Разделяешь "работает сейчас" и "масштабируется под нагрузку и сложность"',
      'Если решение имеет trade-offs — явно называешь каждый из них',
    ],
    learningHint: 'Замечаешь из диалога контекст конкретного компонента или фичи — строишь ответ в этом контексте. Если тема углубляется, переходишь от концепций к конкретным реализациям с кодом.',
    structures: {
      brief: [
        'Структура ответа (plain text):',
        'Разбор задачи: [1-2 предложения — суть технической задачи]',
        'Решение: [конкретный подход или паттерн]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      standard: [
        'Структура ответа (plain text, маркеры •):',
        'Разбор задачи: [2-3 предложения — что реализуем, ограничения, технический контекст]',
        'Решение: [конкретный подход с кратким обоснованием]',
        'Реализация:',
        '• [ключевые шаги или паттерн]',
        'Производительность и edge-cases:',
        '• [что оптимизировать, платформо-специфичные нюансы]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      detailed: [
        'Структура ответа (plain text, маркеры •):',
        'Разбор задачи: [3-4 предложения — полный технический контекст, ограничения, UX-требования]',
        'Решение: [конкретный подход с обоснованием]',
        'Реализация шаг за шагом:',
        '• [детальные шаги с примерами кода там где уместно]',
        'Производительность:',
        '• [что может тормозить, конкретные оптимизации]',
        'iOS vs Android различия:',
        '• [платформо-специфичные нюансы если есть]',
        'Типичные ошибки: [что обычно идёт не так и как избежать]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      deep: [
        'Максимально глубокий frontend-разбор. Используй весь доступный контекст.',
        'Структура ответа (plain text, маркеры •):',
        'Разбор задачи: [4-5 предложений — полный технический контекст, архитектурные ограничения, UX-требования]',
        'Решение: [конкретный подход с полным обоснованием]',
        'Детальная реализация:',
        '• [все шаги с примерами кода, альтернативными подходами и trade-offs]',
        'Архитектурные решения:',
        '• [как вписывается в общую архитектуру, паттерны, data flow]',
        'Производительность:',
        '• [метрики, узкие места, конкретные оптимизации]',
        'Совместимость и edge-cases:',
        '• [iOS/Android различия, версии ОС, необычные устройства]',
        'Тестируемость: [как тестировать этот код, подходы и инструменты]',
        'Технический долг: [что можно улучшить потом, возможные рефакторинги]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
    },
    articleApproach: [
      'Пишешь с позиции разработчика: конкретные паттерны, примеры кода, архитектурные решения',
      'Каждое техническое решение сопровождается обоснованием — почему именно так, какие альтернативы',
      'Явно указываешь производительностные trade-offs и платформо-специфичные нюансы',
      'Структура: введение (что решаем) → архитектурное решение → реализация → производительность и edge-cases → тестирование → Источники',
    ],
  },

  backend: {
    title: 'Senior Backend Developer в Wildberries',
    domain: 'Глубокая экспертиза в микросервисной архитектуре, REST/gRPC API, производительности и масштабировании, надёжности серверных систем, безопасности и интеграциях.',
    thinking: [
      'Разбираешь задачу с позиции надёжности: что может сломаться под нагрузкой или при сбое',
      'Оцениваешь архитектурные trade-offs: latency vs consistency, coupling vs isolation, sync vs async',
      'Анализируешь data flow: где могут быть race conditions, deadlocks, data corruption, N+1 запросы',
      'Рассматриваешь безопасность: аутентификацию, авторизацию, injection, data leakage, audit trail',
      'Предлагаешь конкретные решения с обоснованием — не просто "лучшие практики"',
      'Называешь конкретные инструменты, паттерны с объяснением почему именно они',
      'Разделяешь "быстрый fix сейчас" и "правильное решение на потом"',
      'Оцениваешь масштабируемость: как решение ведёт себя при 10x и 100x нагрузке',
    ],
    learningHint: 'Замечаешь из диалога контекст конкретного сервиса или интеграции — строишь ответ в этом контексте. Если тема углубляется — переходишь от архитектуры к конкретным деталям реализации.',
    structures: {
      brief: [
        'Структура ответа (plain text):',
        'Разбор архитектуры: [1-2 предложения — суть технической задачи]',
        'Решение: [конкретный подход или паттерн]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      standard: [
        'Структура ответа (plain text, маркеры •):',
        'Разбор архитектуры: [2-3 предложения — что решаем, ограничения, контекст]',
        'Решение: [конкретный подход с кратким обоснованием]',
        'Реализация:',
        '• [ключевые шаги или паттерн]',
        'Риски надёжности:',
        '• [что может сломаться, как предотвратить]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      detailed: [
        'Структура ответа (plain text, маркеры •):',
        'Разбор архитектуры: [3-4 предложения — полный технический контекст, зависимости, требования]',
        'Решение: [конкретный подход с обоснованием]',
        'Детальная реализация:',
        '• [шаги с API-контрактами, схемами данных, паттернами]',
        'Производительность и масштабирование:',
        '• [узкие места, оптимизации, поведение под нагрузкой]',
        'Безопасность: [угрозы специфичные для данного решения и как митигировать]',
        'Типичные ошибки: [что обычно идёт не так при реализации]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      deep: [
        'Максимально глубокий backend-разбор. Используй весь доступный контекст.',
        'Структура ответа (plain text, маркеры •):',
        'Разбор архитектуры: [4-5 предложений — полный технический контекст, архитектурные ограничения, SLA]',
        'Решение: [конкретный подход с полным архитектурным обоснованием]',
        'Детальная реализация:',
        '• [полные шаги: API-контракты, схемы данных, паттерны, примеры кода]',
        'Производительность и масштабирование:',
        '• [throughput, latency, bottlenecks, горизонтальное масштабирование]',
        'Надёжность и отказоустойчивость:',
        '• [retry-стратегии, circuit breakers, fallbacks, частичные сбои]',
        'Безопасность:',
        '• [threat model: аутентификация, авторизация, валидация, аудит]',
        'Observability: [метрики, логи, трейсинг — что мониторить и как диагностировать]',
        'Эволюция: [технический долг, migration path, что улучшить потом]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
    },
    articleApproach: [
      'Пишешь с позиции backend-разработчика: архитектурные решения, API-контракты, схемы данных',
      'Каждое решение сопровождается trade-offs — почему именно так, какие альтернативы и когда они лучше',
      'Явно указываешь нефункциональные требования: производительность, надёжность, безопасность',
      'Структура: введение (что решаем и почему) → архитектура → реализация → производительность → безопасность → мониторинг → Источники',
    ],
  },

  devops: {
    title: 'Senior DevOps/SRE Engineer в Wildberries',
    domain: 'Глубокая экспертиза в CI/CD пайплайнах мобильных приложений, Kubernetes, GitLab CI, мониторинге и алертинге, управлении инцидентами, автоматизации деплоя и надёжности инфраструктуры.',
    thinking: [
      'Разбираешь задачу с точки зрения надёжности системы: MTTR, MTBF, SLA, error budget',
      'Первым делом оцениваешь blast radius: что сломается, сколько систем затронет, как быстро восстановить',
      'Разделяешь "сейчас нужно починить" и "потом нужно исправить системно" — hot fix vs root cause',
      'Думаешь об observability: как это мониторить, что алертить, как диагностировать в 3 часа ночи',
      'Предлагаешь конкретные команды, конфиги, pipeline шаги — без абстрактных рекомендаций',
      'Оцениваешь безопасность инфраструктуры: secrets management, network policies, RBAC, audit logs',
      'Думаешь о воспроизводимости: любое ручное действие должно стать автоматизированным',
      'Разделяешь "работает на машине разработчика" и "работает в production 24/7 под нагрузкой"',
    ],
    learningHint: 'Замечаешь из диалога паттерны инцидентов и уже принятые решения — не переспрашиваешь. Если тема повторяется — предлагаешь системное решение. Строишь ответы как последовательные runbook-шаги.',
    structures: {
      brief: [
        'Структура ответа (plain text):',
        'Разбор системы: [1-2 предложения — суть инфраструктурной задачи]',
        'Решение: [конкретные команды или шаги]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      standard: [
        'Структура ответа (plain text, маркеры •):',
        'Разбор системы: [2-3 предложения — что решаем, текущее состояние, blast radius]',
        'Решение: [конкретные команды или конфигурация]',
        'Шаги:',
        '• [действие → ожидаемый результат → как проверить]',
        'Мониторинг:',
        '• [что проверить после, какие алерты настроить]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      detailed: [
        'Структура ответа (plain text, маркеры •):',
        'Разбор системы: [3-4 предложения — полный контекст: архитектура, зависимости, blast radius]',
        'Решение: [конкретный подход с обоснованием]',
        'Runbook:',
        '• [последовательные шаги с командами и ожидаемым выводом]',
        'Rollback план:',
        '• [как откатить если что-то пойдёт не так]',
        'Мониторинг и алерты: [какие метрики смотреть, какие пороги настроить]',
        'Безопасность: [secrets, RBAC, audit что нужно проверить]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
      deep: [
        'Максимально глубокий DevOps/SRE разбор. Используй весь доступный контекст.',
        'Структура ответа (plain text, маркеры •):',
        'Разбор системы: [4-5 предложений — полный инфраструктурный контекст, SLA, зависимости, история инцидентов]',
        'Решение: [конкретный подход с полным техническим обоснованием]',
        'Детальный Runbook:',
        '• [полные шаги с командами, флагами, проверками и ожидаемыми выводами]',
        'Rollback и disaster recovery:',
        '• [полный план отката, RPO/RTO оценка, резервные процедуры]',
        'Observability:',
        '• [метрики → алерты → dashboard → runbook для дежурного]',
        'Безопасность инфраструктуры:',
        '• [secrets rotation, RBAC, network policies, supply chain, audit logs]',
        'CI/CD автоматизация: [как встроить в пайплайн, gates и approval процессы]',
        'Системное предотвращение: [что изменить в архитектуре чтобы проблема не повторялась]',
        'Источники: [URL через перенос строки]',
      ].join('\n'),
    },
    articleApproach: [
      'Пишешь как runbook: конкретные команды, конфиги, последовательность действий',
      'Каждый шаг: команда/действие → ожидаемый результат → как проверить',
      'Явно указываешь требования к доступам/правам, потенциальный blast radius и rollback план',
      'Структура: введение (что за процедура и когда применяется) → предварительные требования → шаги → верификация → rollback → мониторинг → Источники',
    ],
  },
};

function buildPersonaSystemPrompt(
  persona: WikiPersona,
  sources: WikiKnowledgeSource[],
  hasWeb: boolean,
  profile: WikiResponseProfile
): string {
  const cfg = PERSONA_CONFIG[persona];
  const sourceHint = sources.length > 0 && hasWeb
    ? 'В контексте есть внутренние wiki-статьи WB (приоритет для внутренних процессов) и веб-источники (для дополнения)'
    : sources.length > 0
      ? 'Отвечай на основе переданных wiki-источников release-команды WB'
      : 'Отвечай на основе веб-источников — внутренних материалов нет';

  return [
    `Ты — ${cfg.title}.`,
    cfg.domain,
    '',
    'Как ты думаешь и отвечаешь:',
    ...cfg.thinking.map(t => `• ${t}`),
    '',
    'Адаптация к диалогу:',
    `• ${cfg.learningHint}`,
    '',
    `• ${sourceHint}`,
    '',
    'Пиши по-русски, конкретно, без канцелярита. Только plain text — никаких markdown-заголовков, таблиц, code fences. Маркеры •.',
    '',
    cfg.structures[profile],
  ].join('\n');
}

function buildPersonaArticleSystemPrompt(
  persona: WikiPersona,
  sources: WikiKnowledgeSource[],
  hasWeb: boolean
): string {
  const cfg = PERSONA_CONFIG[persona];
  const sourceHint = sources.length > 0 && hasWeb
    ? 'В контексте есть wiki-статьи WB (приоритет для внутренних процессов) и веб-источники (для дополнения)'
    : sources.length > 0
      ? 'Опирайся на переданные wiki-материалы как на основной источник'
      : 'Используй веб-источники как основу — внутренних материалов нет';

  return [
    `Ты — ${cfg.title}.`,
    'Тебе поручено написать wiki-статью — внутренний рабочий документ для команды Wildberries.',
    '',
    'Как ты пишешь статью:',
    ...cfg.articleApproach.map(a => `• ${a}`),
    '',
    'Дополнительные правила:',
    '• Не дублируешь информацию из разных источников — синтезируешь в одно связное объяснение',
    '• Если источники расходятся — явно указываешь где и какой актуальнее',
    `• ${sourceHint}`,
    '',
    'Формат вывода:',
    '• Только тело статьи в markdown — без code fences вокруг всего документа',
    '• Не добавляй заголовок H1 с названием — title создаётся через API отдельно',
    '• Разделы через ## заголовки, подразделы через ###',
    '• В разделе "## Источники" используй markdown-ссылки: [Название](url)',
  ].join('\n');
}

// ─── END PERSONA SYSTEM ───────────────────────────────────────

function buildPrompt(plan: WikiAnswerPlan, sources: WikiKnowledgeSource[], history: WikiChatTurn[], webResults: WebSearchResult[] = []) {
  const trimmedHistory = history.slice(-plan.historyLimit).map(turn => `${turn.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${turn.text}`);
  const keywordVariants = buildKeywordVariants(plan.effectiveQuestion, collectKeywords(plan.effectiveQuestion));
  const digest = buildSourceDigest(plan.effectiveQuestion, sources, plan.passageLimit);
  const sourceBlock = sources.map((source, index) => [
    `[W${index + 1}] ${source.title}`,
    `URL: ${source.url}`,
    `Обновлено: ${source.updatedAt ? new Date(source.updatedAt).toLocaleString('ru-RU') : '—'} · Автор: ${source.author || '—'}`,
    `Кратко: ${source.summary}`,
    `Фрагменты:`,
    ...extractPassages(source.content || source.excerpt || source.summary, keywordVariants, plan.passageLimit).map(item => `- ${item}`),
  ].join('\n')).join('\n\n');

  const hasWeb = webResults.length > 0;
  const webSourceBlock = hasWeb
    ? webResults.map((r, i) => [
        `[Web${i + 1}] ${r.title}`,
        `URL: ${r.url}`,
        `Кратко: ${r.snippet}`,
      ].join('\n')).join('\n\n')
    : '';

  return {
    system: buildPersonaSystemPrompt(plan.persona, sources, hasWeb, plan.profile),
    user: [
      trimmedHistory.length ? `История диалога:\n${trimmedHistory.join('\n')}` : '',
      plan.isFollowUp
        ? `Контекст: пользователь продолжает тему "${plan.topicQuestion}". Новый вопрос: ${plan.originalQuestion}`
        : `Вопрос: ${plan.originalQuestion}`,
      sources.length > 0 ? `\nДоступно ${sources.length} wiki-источников${hasWeb ? ` и ${webResults.length} веб-источников` : ''}:` : '',
      sources.length > 0 ? sourceBlock : '',
      hasWeb ? `\nВеб-источники:\n${webSourceBlock}` : '',
    ].filter(s => s !== '').join('\n\n'),
  };
}

function buildArticleDraftPrompt(command: WikiCreateCommand, sources: WikiKnowledgeSource[], history: WikiChatTurn[], webResults: WebSearchResult[] = [], persona: WikiPersona = 'release_engineer') {
  const trimmedHistory = history.slice(-8).map(turn => `${turn.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${turn.text}`);
  const topic = command.topic || command.title;
  const keywords = buildKeywordVariants(topic, collectKeywords(topic));
  const sourceBlock = sources.slice(0, 8).map((source, index) => [
    `[W${index + 1}] ${source.title}`,
    `URL: ${source.url}`,
    `Обновлено: ${source.updatedAt ? new Date(source.updatedAt).toLocaleString('ru-RU') : '—'} · Автор: ${source.author || '—'}`,
    `Кратко: ${source.summary}`,
    `Фрагменты:`,
    ...extractPassages(source.content || source.excerpt || source.summary, keywords, 4).map(item => `- ${item}`),
  ].join('\n')).join('\n\n');
  const hasWeb = webResults.length > 0;
  const webSourceBlock = hasWeb
    ? webResults.slice(0, 6).map((r, i) => [
        `[Web${i + 1}] ${r.title}`,
        `URL: ${r.url}`,
        `Кратко: ${r.snippet}`,
      ].join('\n')).join('\n\n')
    : '';

  return {
    system: buildPersonaArticleSystemPrompt(persona, sources, hasWeb),
    user: [
      trimmedHistory.length ? `История диалога:\n${trimmedHistory.join('\n')}` : '',
      `Название статьи: ${command.title}`,
      `Куда создаётся статья: ${command.target?.raw || `space/${command.target?.spaceId || ''}`}`,
      `Тема и задача статьи: ${topic}`,
      sources.length > 0 ? `\nДоступно ${sources.length} wiki-источников${hasWeb ? ` и ${webResults.length} веб-источников` : ''}:` : '',
      sources.length > 0 ? sourceBlock : '',
      hasWeb ? `\nВеб-источники:\n${webSourceBlock}` : '',
      '\nНапиши полноценный markdown-текст статьи.',
    ].filter(s => s !== '').join('\n\n'),
  };
}

function buildLocalAnswer(plan: WikiAnswerPlan, sources: WikiKnowledgeSource[]) {
  const top = sources.slice(0, plan.profile === 'deep' ? 6 : plan.profile === 'detailed' ? 4 : 3);
  const leading = top.map(source => `• ${source.title} (${source.url}): ${source.excerpt || source.summary}`);
  const detailedContext = plan.profile === 'detailed' || plan.profile === 'deep'
    ? [
        '',
        'Развернутый разбор:',
        ...top.flatMap(source => {
          const passages = extractPassages(source.content || source.excerpt || source.summary, buildKeywordVariants(plan.effectiveQuestion, collectKeywords(plan.effectiveQuestion)), 2);
          return passages.map(item => `• ${source.title}: ${item} (${source.url})`);
        }),
      ]
    : [];

  return [
    `По вопросу "${plan.effectiveQuestion}" я нашёл ${sources.length} wiki-источников.`,
    '',
    'Короткий ответ:',
    ...leading,
    ...detailedContext,
    '',
    'Источники:',
    ...top.map(source => source.url),
  ].join('\n');
}

function ensureAnswerDepth(answer: string, plan: WikiAnswerPlan, sources: WikiKnowledgeSource[]) {
  const cleaned = sanitizeAnswerText(replaceSourceMarkers(answer, sources));
  if (plan.profile === 'brief' || plan.profile === 'standard') return cleaned;

  const enoughLength = plan.profile === 'deep' ? cleaned.length >= 1400 : cleaned.length >= 850;
  const hasDeepSections = /(Развернутый разбор|Что важно на практике|Нюансы|Расхождения|по шагам)/i.test(cleaned);
  if (enoughLength && hasDeepSections) return cleaned;

  const appendix = [
    'Дополнительный контекст из документов:',
    ...sources.slice(0, plan.profile === 'deep' ? 5 : 3).flatMap(source =>
      extractPassages(
        source.content || source.excerpt || source.summary,
        buildKeywordVariants(plan.effectiveQuestion, collectKeywords(plan.effectiveQuestion)),
        2
      ).map(item => `• ${source.title}: ${item} (${source.url})`)
    ),
  ].join('\n');

  return [cleaned, appendix].filter(Boolean).join('\n\n');
}

function buildLocalArticleDraft(command: WikiCreateCommand, sources: WikiKnowledgeSource[]) {
  const topic = command.topic || command.title;
  const keywords = buildKeywordVariants(topic, collectKeywords(topic));
  const top = sources.slice(0, 5);
  return [
    `Кратко`,
    '',
    `${command.title} описывает тему "${topic}" на основе актуальных wiki-материалов release-команды Wildberries.`,
    '',
    `Основные шаги`,
    '',
    ...top.slice(0, 3).map((source, index) => `${index + 1}. ${source.title}: ${extractPassages(source.content || source.excerpt || source.summary, keywords, 1)[0] || source.summary}`),
    '',
    `Нюансы`,
    '',
    ...top.slice(0, 3).map(source => `• ${source.title}: ${summarizeText(source.excerpt || source.summary, 220)}`),
    '',
    `Источники`,
    '',
    ...top.map(source => `• [ссылка](${source.url})`),
  ].join('\n');
}

function extractCreatedArticleRef(payload: any) {
  const article = payload?.article || payload?.data?.article || payload?.data || payload;
  const spaceId = String(article?.space_id || article?.spaceId || article?.space?.id || payload?.space_id || '').trim();
  const articleNumber = String(
    article?.article_number ||
    article?.articleNumber ||
    article?.page_id ||
    article?.pageId ||
    payload?.article_number ||
    payload?.articleNumber ||
    ''
  ).trim();
  const articleId = String(
    article?.article_id ||
    article?.articleId ||
    article?.id ||
    payload?.article_id ||
    payload?.articleId ||
    payload?.id ||
    ''
  ).trim();
  const title = String(article?.title || article?.name || payload?.title || '').trim();
  const spacePrefix = String(
    article?.space_prefix ||
    article?.spacePrefix ||
    article?.space?.prefix ||
    payload?.space_prefix ||
    payload?.spacePrefix ||
    ''
  ).trim();
  const articleSlug = String(
    article?.article_slug ||
    article?.articleSlug ||
    payload?.article_slug ||
    payload?.articleSlug ||
    title ||
    ''
  ).trim();
  if (!spaceId || (!articleNumber && !articleId)) return null;
  return { spaceId, articleNumber, articleId, title, spacePrefix, articleSlug };
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(value: string) {
  let output = escapeHtml(value);
  output = output.replace(/`([^`]+)`/g, '<code>$1</code>');
  output = output.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  output = output.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  output = output.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  output = output.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>');
  return output;
}

function renderMarkdownToHtml(markdown: string) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let listMode: 'ul' | 'ol' | null = null;
  let codeFence = false;
  let codeLines: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p><span style="white-space: pre-wrap;">${renderInlineMarkdown(paragraph.join(' '))}</span></p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listMode) return;
    html.push(`</${listMode}>`);
    listMode = null;
  };

  const flushCode = () => {
    if (!codeFence) return;
    html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    codeFence = false;
    codeLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '    ');
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flushParagraph();
      flushList();
      if (codeFence) {
        flushCode();
      } else {
        codeFence = true;
        codeLines = [];
      }
      continue;
    }

    if (codeFence) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(6, heading[1].length);
      html.push(`<h${level}><span style="white-space: pre-wrap;">${renderInlineMarkdown(heading[2])}</span></h${level}>`);
      continue;
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      flushParagraph();
      flushList();
      html.push('<hr />');
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (listMode !== 'ul') {
        flushList();
        listMode = 'ul';
        html.push('<ul>');
      }
      html.push(`<li><span style="white-space: pre-wrap;">${renderInlineMarkdown(bullet[1])}</span></li>`);
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (listMode !== 'ol') {
        flushList();
        listMode = 'ol';
        html.push('<ol>');
      }
      html.push(`<li><span style="white-space: pre-wrap;">${renderInlineMarkdown(ordered[1])}</span></li>`);
      continue;
    }

    const quote = trimmed.match(/^>\s+(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote><span style="white-space: pre-wrap;">${renderInlineMarkdown(quote[1])}</span></blockquote>`);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushCode();
  return html.join('');
}

async function resolveParentArticleId(
  cfg: WikiIntelligenceConfig,
  headers: Record<string, string>,
  base: string,
  target: WikiCreateTarget
) {
  const parentNumber = String(target.parentArticleNumber || '').trim();
  if (!parentNumber) return 0;
  const payload = await fetchJson<any>(cfg, buildArticleApiUrl(base, target.spaceId, parentNumber), { headers });
  const article = payload?.article || payload?.data?.article || payload?.data || payload;
  const parentId = Number(article?.article_id || article?.articleId || article?.id || 0);
  if (!Number.isFinite(parentId) || parentId <= 0) {
    throw new Error(`Не удалось определить parent_id для статьи ${target.spaceId}/${parentNumber}`);
  }
  return parentId;
}

async function updateWikiArticleContent(
  cfg: WikiIntelligenceConfig,
  headers: Record<string, string>,
  base: string,
  article: { spaceId: string; articleNumber: string; title: string },
  markdown: string
) {
  const html = renderMarkdownToHtml(markdown);
  const response = await fetchWithRouting(cfg, buildArticleApiUrl(base, article.spaceId, article.articleNumber), {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': 'application/json;charset=UTF-8',
    },
    body: JSON.stringify({
      title: article.title,
      markdown,
      content: html,
    }),
  });

  if (!response.ok) {
    const text = String(await response.text().catch(() => '') || '').trim().slice(0, 320);
    throw new Error(`Не удалось заполнить статью контентом: HTTP ${response.status}${text ? `: ${text}` : ''}`);
  }

  return response.json().catch(() => ({}));
}

async function generateArticleDraft(
  cfg: WikiIntelligenceConfig,
  command: WikiCreateCommand,
  sources: WikiKnowledgeSource[],
  history: WikiChatTurn[],
  webResults: WebSearchResult[] = []
) {
  const glmBase = normalizeGlmBase(cfg.glmBase);
  if (!glmBase) return buildLocalArticleDraft(command, sources);

  const prompt = buildArticleDraftPrompt(command, sources, history, webResults, cfg.persona ?? 'release_engineer');
  const text = await requestLlmWithContinuation(cfg, {
      model: String(cfg.glmModel || 'glm-5.1'),
      system: prompt.system,
      user: prompt.user,
      temperature: 0.2,
      maxTokens: 3200,
      sanitize: false,
      replaceSourcesWith: sources,
  });
  return text || buildLocalArticleDraft(command, sources);
}

async function createWikiArticle(
  cfg: WikiIntelligenceConfig,
  command: Pick<WikiCreateCommand, 'title' | 'target'>,
  markdown: string
) {
  const headers = buildWikiHeaders(cfg.wikiToken);
  if (!headers) throw new Error('Wiki token не настроен');
  if (!command.target?.spaceId) throw new Error('Не удалось определить space для создания статьи');

  const base = normalizeWikiBase(cfg.wikiBase);
  const parentId = await resolveParentArticleId(cfg, headers, base, command.target);
  const createUrl = `${base}/api/v1/space/${encodeURIComponent(command.target.spaceId)}/article`;
  const createResponse = await fetchWithRouting(cfg, createUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json;charset=UTF-8',
    },
    body: JSON.stringify({
      position: 1,
      parent_id: parentId,
      title: command.title,
    }),
  }).catch(error => {
    throw new Error(String(error instanceof Error ? error.message : error || 'unknown error'));
  });

  if (!createResponse.ok) {
    const text = String(await createResponse.text().catch(() => '') || '').trim().slice(0, 320);
    throw new Error(`Не удалось создать статью: HTTP ${createResponse.status}${text ? `: ${text}` : ''}`);
  }

  const createPayload = await createResponse.json().catch(() => ({}));
  const created = extractCreatedArticleRef(createPayload);
  if (!created?.spaceId || !created?.articleNumber) {
    throw new Error('Wiki API создала статью, но не вернула article_number для сохранения контента');
  }

  await updateWikiArticleContent(
    cfg,
    headers,
    base,
    {
      spaceId: created.spaceId,
      articleNumber: created.articleNumber,
      title: created.title || command.title,
    },
    markdown
  );

  return {
    title: created.title || command.title,
    url: buildArticleUiUrl(
      base,
      created.spaceId,
      created.articleNumber,
      created.articleSlug || created.title || command.title,
      created.spacePrefix
    ),
  };
}

export async function publishWikiDraft(
  cfg: WikiIntelligenceConfig,
  draftAction: WikiDraftAction
) {
  return createWikiArticle(
    cfg,
    {
      title: draftAction.title,
      target: draftAction.target,
    },
    draftAction.markdown
  );
}

export async function answerWikiQuestion(
  cfg: WikiIntelligenceConfig,
  question: string,
  history: WikiChatTurn[] = []
): Promise<WikiAnswerResult> {
  const createCommand = parseCreateCommand(question, history);
  if (createCommand.requested) {
    if (createCommand.missing.length) {
      return {
        answer: [
          'Чтобы создать wiki-статью, мне сейчас не хватает данных:',
          ...createCommand.missing.map(item => `• ${item}`),
          '',
          'Поддерживаемый формат запроса:',
          '• Создай статью "Название" в https://wiki.wb.ru/space/308/page/5554/... по теме процесс регресса',
          '• Создай статью "Название" в space/308 по теме ...',
          '',
          'Если хочешь, можешь прямо в одном сообщении дать:',
          '• куда создать',
          '• название статьи',
          '• тему или краткое описание содержания',
        ].join('\n'),
        sources: [],
      };
    }

    const draftPlan = buildAnswerPlan(createCommand.topic || createCommand.title, history, cfg.persona ?? 'release_engineer');
    draftPlan.profile = 'deep';
    draftPlan.searchPageSize = Math.max(draftPlan.searchPageSize, 64);
    draftPlan.hydrateLimit = Math.max(draftPlan.hydrateLimit, 24);
    draftPlan.contextSourceLimit = Math.max(draftPlan.contextSourceLimit, 14);
    draftPlan.passageLimit = Math.max(draftPlan.passageLimit, 8);
    draftPlan.maxTokens = Math.max(draftPlan.maxTokens, 3200);

    const hasWikiToken = Boolean(String(cfg.wikiToken || '').trim());
    const hasWebSearch = cfg.useWebSearch === true || Boolean(String(cfg.webSearchKey || '').trim());

    const [sources, draftWebResults] = await Promise.all([
      hasWikiToken
        ? searchWikiArticles(cfg, draftPlan.effectiveQuestion, draftPlan).catch(() => [] as WikiKnowledgeSource[])
        : Promise.resolve([] as WikiKnowledgeSource[]),
      hasWebSearch
        ? searchWeb(cfg, `${createCommand.title} ${createCommand.topic}`.trim()).catch(() => [] as WebSearchResult[])
        : Promise.resolve([] as WebSearchResult[]),
    ]);

    if (!sources.length && !draftWebResults.length) {
      throw new Error('Не удалось собрать контекст для создания статьи ни из Wiki, ни из интернета');
    }

    const markdown = await generateArticleDraft(cfg, createCommand, sources, history, draftWebResults);
    const allDraftSources = [
      ...sources,
      ...draftWebResults.map(r => ({
        uid: `web:${r.url}`, id: r.url, title: `🌐 ${r.title}`, url: r.url,
        apiUrl: r.url, spaceId: '', articleNumber: '',
        summary: r.snippet, excerpt: r.snippet, content: r.content,
        updatedAt: 0, author: '', score: 0,
      } as WikiKnowledgeSource)),
    ];
    return {
      answer: [
        `Подготовил draft статьи: ${createCommand.title}`,
        `Куда планируется создать: ${createCommand.target?.raw || `space/${createCommand.target?.spaceId}`}`,
        'Сначала проверь draft ниже. Если всё ок, нажми "Создать статью".',
        '',
        'Что использовал как основу:',
        ...sources.slice(0, 4).map(source => `• ${source.title} (${source.url})`),
        ...draftWebResults.slice(0, 3).map(r => `• 🌐 ${r.title} (${r.url})`),
      ].join('\n'),
      sources: allDraftSources,
      draftAction: createCommand.target
        ? {
            type: 'create_wiki_article',
            title: createCommand.title,
            topic: createCommand.topic,
            markdown,
            target: createCommand.target,
          }
        : undefined,
    };
  }

  const plan = buildAnswerPlan(question, history, cfg.persona ?? 'release_engineer');

  const hasWikiTokenQA = Boolean(String(cfg.wikiToken || '').trim());
  const hasWebSearchQA = cfg.useWebSearch === true || Boolean(String(cfg.webSearchKey || '').trim());

  const [sources, webResults] = await Promise.all([
    hasWikiTokenQA
      ? searchWikiArticles(cfg, plan.effectiveQuestion, plan).catch(() => [] as WikiKnowledgeSource[])
      : Promise.resolve([] as WikiKnowledgeSource[]),
    hasWebSearchQA
      ? searchWeb(cfg, plan.effectiveQuestion).catch(() => [] as WebSearchResult[])
      : Promise.resolve([] as WebSearchResult[]),
  ]);

  if (!sources.length && !webResults.length) {
    throw new Error('Не нашли подходящих материалов ни в Wiki, ни в интернете');
  }

  const glmBase = normalizeGlmBase(cfg.glmBase);

  const allSources: WikiKnowledgeSource[] = [
    ...sources,
    ...webResults.map(r => ({
      uid: `web:${r.url}`, id: r.url, title: `🌐 ${r.title}`, url: r.url,
      apiUrl: r.url, spaceId: '', articleNumber: '',
      summary: r.snippet, excerpt: r.snippet, content: r.content,
      updatedAt: 0, author: '', score: 0,
    } as WikiKnowledgeSource)),
  ];

  if (!glmBase) {
    return {
      answer: buildLocalAnswer(plan, sources.length ? sources : allSources),
      sources: allSources,
    };
  }

  const prompt = buildPrompt(plan, sources, history, webResults);
  const text = await requestLlmWithContinuation(cfg, {
      model: String(cfg.glmModel || 'glm-5.1'),
      system: prompt.system,
      user: prompt.user,
      temperature: 0.15,
      maxTokens: plan.maxTokens,
      sanitize: false,
      replaceSourcesWith: sources,
  });
  return {
    answer: ensureAnswerDepth(text, plan, sources.length ? sources : allSources) || buildLocalAnswer(plan, sources.length ? sources : allSources),
    sources: allSources,
  };
}
