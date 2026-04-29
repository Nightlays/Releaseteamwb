import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardHint, CardBody, Divider, Badge, Button, Input, FieldLabel, SegmentControl, EmptyState } from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';
import { normalizeGlmBase } from '../../types';
import { answerWikiQuestion, publishWikiDraft, type WikiDraftAction, type WikiPersona, WIKI_PERSONA_LABELS } from '../../services/wikiIntelligence';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
  sources?: Array<{ label: string; url: string }>;
  draftAction?: WikiDraftAction;
  createdArticle?: { title: string; url: string };
  draftError?: string;
}

function makeMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function renderTextWithLinks(text: string) {
  const raw = String(text || '');
  const urlRe = /(https?:\/\/[^\s)]+)/g;
  const parts = raw.split(urlRe);
  return parts.map((part, index) => {
    if (!part) return null;
    if (/^https?:\/\//i.test(part)) {
      return (
        <a
          key={`${part}-${index}`}
          href={part}
          target="_blank"
          rel="noreferrer"
          style={{ color: '#7C3AED', textDecoration: 'underline' }}
        >
          ссылка
        </a>
      );
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

const SOURCES = [
  { value: 'wiki', label: 'Wiki WB' },
  { value: 'web',  label: 'Интернет' },
  { value: 'all',  label: 'Все источники' },
];

const SUGGESTED = [
  'Как запустить SWAT-прогон для релиза?',
  'Что такое ЧП и как они учитываются?',
  'Как работает ML-оценка риска релиза?',
  'Какие критерии блокируют выпуск релиза?',
  'Как настроить интеграцию с Allure TestOps?',
  'В чём разница между Smoke и High/Blocker прогонами?',
];

function MessageBubble({
  msg,
  onPublishDraft,
  onCopyDraft,
  publishing,
}: {
  msg: Message;
  onPublishDraft?: (msg: Message) => void;
  onCopyDraft?: (msg: Message) => void;
  publishing?: boolean;
}) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      gap: 10,
      alignItems: 'flex-start',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        background: isUser ? 'linear-gradient(135deg,#9B5CFF,#CB11AB)' : 'rgba(155,92,255,.18)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, color: isUser ? '#fff' : '#9B5CFF', fontWeight: 700,
      }}>
        {isUser ? 'Вы' : '◐'}
      </div>
      <div style={{ maxWidth: '72%' }}>
        <div style={{
          padding: '10px 14px',
          background: isUser ? 'linear-gradient(135deg,rgba(155,92,255,.22),rgba(203,17,171,.15))' : 'var(--surface-soft-2)',
          border: `1px solid ${isUser ? 'rgba(155,92,255,.3)' : 'var(--border)'}`,
          borderRadius: isUser ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
          fontSize: 13, color: 'var(--text)', lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
        }}>
          {renderTextWithLinks(msg.text)}
        </div>
        {msg.sources && msg.sources.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {msg.sources.map(s => (
              <a
                key={`${s.url}-${s.label}`}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 99,
                background: 'rgba(155,92,255,.12)', color: '#A78BFA',
                border: '1px solid rgba(155,92,255,.2)',
                textDecoration: 'none',
              }}>
                {s.label}
              </a>
            ))}
          </div>
        )}
        {msg.draftAction && (
          <div style={{
            marginTop: 10,
            padding: '10px 12px',
            borderRadius: 12,
            border: '1px solid rgba(155,92,255,.18)',
            background: 'var(--surface-soft)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                Draft статьи: {msg.draftAction.title}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {msg.draftAction.target.raw}
              </div>
            </div>
            <details>
              <summary style={{ cursor: 'pointer', color: 'var(--text-2)', fontSize: 12, marginBottom: 8 }}>
                Показать draft
              </summary>
              <pre style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                fontSize: 12,
                lineHeight: 1.55,
                color: 'var(--text)',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                background: 'var(--surface-soft-2)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 12,
                maxHeight: 320,
                overflow: 'auto',
              }}>
                {msg.draftAction.markdown}
              </pre>
            </details>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <Button size="sm" variant="primary" onClick={() => onPublishDraft?.(msg)} disabled={publishing || Boolean(msg.createdArticle)}>
                {publishing ? 'Создаю...' : msg.createdArticle ? 'Статья создана' : 'Создать статью'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onCopyDraft?.(msg)}>
                Скопировать draft
              </Button>
              {msg.createdArticle && (
                <a
                  href={msg.createdArticle.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ alignSelf: 'center', fontSize: 12, color: '#7C3AED', textDecoration: 'underline' }}
                >
                  Открыть статью
                </a>
              )}
            </div>
            {msg.draftError && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#EF4444' }}>
                {msg.draftError}
              </div>
            )}
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4, textAlign: isUser ? 'right' : 'left' }}>
          {new Date(msg.ts).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(155,92,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#9B5CFF', fontWeight: 700 }}>◐</div>
      <div style={{ padding: '10px 14px', background: 'var(--surface-soft-2)', border: '1px solid var(--border)', borderRadius: '4px 16px 16px 16px', display: 'flex', gap: 5, alignItems: 'center' }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: '50%', background: '#9B5CFF',
            animation: 'typingBounce .9s ease infinite',
            animationDelay: `${i * .18}s`,
          }} />
        ))}
      </div>
    </div>
  );
}

export function WikiIntelligence() {
  const { settings } = useSettings();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState('');
  const [source, setSource]     = useState('all');
  const [persona, setPersona]   = useState<WikiPersona>('release_engineer');
  const [loading, setLoading]   = useState(false);
  const [publishingDraftId, setPublishingDraftId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Message = { id: makeMessageId(), role: 'user', text: text.trim(), ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const result = await answerWikiQuestion(
        {
          proxyBase: settings.proxyBase,
          proxyMode: settings.proxyMode,
          useProxy: settings.useProxy,
          wikiToken: source === 'web' ? '' : settings.wikiToken,
          glmBase: settings.glmBase,
          glmKey: settings.glmKey,
          glmModel: settings.glmModel,
          useWebSearch: source !== 'wiki' && settings.useWebSearch,
          webSearchKey: source === 'wiki' ? '' : settings.webSearchKey,
          persona,
        },
        text.trim(),
        messages.map(msg => ({ role: msg.role, text: msg.text }))
      );

      setMessages(prev => [...prev, {
        id: makeMessageId(),
        role: 'assistant',
        text: result.answer,
        ts: Date.now(),
        sources: result.sources.map(item => ({ label: item.title, url: item.url })),
        draftAction: result.draftAction,
        createdArticle: result.createdArticle,
      }]);
    } catch (e) {
      setMessages(prev => [...prev, { id: makeMessageId(), role: 'assistant', text: `⚠ Ошибка: ${(e as Error).message}`, ts: Date.now() }]);
    } finally {
      setLoading(false);
    }
  }, [messages, settings, source, loading]);

  const handlePublishDraft = useCallback(async (message: Message) => {
    if (!message.draftAction || publishingDraftId) return;
    setPublishingDraftId(message.id);
    try {
      const created = await publishWikiDraft(
        {
          proxyBase: settings.proxyBase,
          proxyMode: settings.proxyMode,
          useProxy: settings.useProxy,
          wikiToken: settings.wikiToken,
          glmBase: settings.glmBase,
          glmKey: settings.glmKey,
          glmModel: settings.glmModel,
          useWebSearch: settings.useWebSearch,
          webSearchKey: settings.webSearchKey,
        },
        message.draftAction
      );

      setMessages(prev => prev.map(item => item.id === message.id ? {
        ...item,
        createdArticle: created,
        draftError: undefined,
        text: `${item.text}\n\nСтатья создана: ${created.url}`,
      } : item));
    } catch (error) {
      setMessages(prev => prev.map(item => item.id === message.id ? {
        ...item,
        draftError: `Не удалось создать статью: ${String(error instanceof Error ? error.message : error || 'unknown error')}`,
      } : item));
    } finally {
      setPublishingDraftId(null);
    }
  }, [publishingDraftId, settings]);

  const handleCopyDraft = useCallback(async (message: Message) => {
    if (!message.draftAction?.markdown) return;
    try {
      await navigator.clipboard.writeText(message.draftAction.markdown);
    } catch {
      /* ignore clipboard errors */
    }
  }, []);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      height: 'calc(100vh - 112px)',
      maxHeight: 'calc(100vh - 112px)',
      minHeight: 0,
      overflow: 'hidden',
    }}>
      <style>{`@keyframes typingBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}`}</style>

      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(155,92,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>◐</div>
        Wiki Intelligence
        <Badge color="purple" style={{ marginLeft: 4 }}>{settings.glmModel || 'GLM'}</Badge>
      </div>

      {/* SOURCE + PERSONA SELECTOR */}
      <Card>
        <CardBody>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <FieldLabel>Источник знаний</FieldLabel>
              <SegmentControl items={SOURCES} value={source} onChange={setSource} />
            </div>
            <div>
              <FieldLabel>Роль эксперта</FieldLabel>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(Object.keys(WIKI_PERSONA_LABELS) as WikiPersona[]).map(key => (
                  <button
                    key={key}
                    onClick={() => setPersona(key)}
                    style={{
                      padding: '5px 11px',
                      fontSize: 12,
                      borderRadius: 8,
                      border: `1px solid ${persona === key ? 'rgba(155,92,255,.55)' : 'var(--border)'}`,
                      background: persona === key ? 'rgba(155,92,255,.15)' : 'var(--surface-soft)',
                      color: persona === key ? '#A78BFA' : 'var(--text-2)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontWeight: persona === key ? 700 : 400,
                      transition: 'all .12s',
                    }}
                  >
                    {WIKI_PERSONA_LABELS[key]}
                  </button>
                ))}
              </div>
            </div>
            {source !== 'web' && !settings.wikiToken && (
              <div style={{ fontSize: 11, color: '#F59E0B', background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.18)', padding: '6px 12px', borderRadius: 8 }}>
                ⚠ Wiki token не настроен — поиск по wiki-статьям не сработает
              </div>
            )}
            {source !== 'wiki' && !settings.useWebSearch && !settings.webSearchKey && (
              <div style={{ fontSize: 11, color: '#F59E0B', background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.18)', padding: '6px 12px', borderRadius: 8 }}>
                ⚠ Веб-поиск отключён — включи в настройках или добавь Brave API Key
              </div>
            )}
            {source !== 'wiki' && settings.useWebSearch && !settings.webSearchKey && (
              <div style={{ fontSize: 11, color: '#22C55E', background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.18)', padding: '6px 12px', borderRadius: 8 }}>
                🌐 DuckDuckGo (бесплатно)
              </div>
            )}
            {source !== 'wiki' && settings.webSearchKey && (
              <div style={{ fontSize: 11, color: '#22C55E', background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.18)', padding: '6px 12px', borderRadius: 8 }}>
                🌐 Brave Search
              </div>
            )}
            {!normalizeGlmBase(settings.glmBase) && (
              <div style={{ fontSize: 11, color: '#64748B', background: 'rgba(100,116,139,.08)', border: '1px solid rgba(100,116,139,.18)', padding: '6px 12px', borderRadius: 8 }}>
                LLM не настроен — будет локальная выжимка по найденным источникам
              </div>
            )}
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" style={{ marginLeft: 'auto' }} onClick={() => setMessages([])}>
                Очистить чат
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* CHAT */}
      <Card style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            minHeight: 0,
          }}
        >
          {messages.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 20 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>◐</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Wiki Intelligence</div>
                <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Задайте вопрос по базе знаний WB Mobile</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%', maxWidth: 600 }}>
                {SUGGESTED.map(s => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    style={{
                      padding: '10px 14px', fontSize: 12, color: 'var(--text-2)',
                      background: 'var(--surface-soft)', border: '1px solid var(--border)',
                      borderRadius: 10, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                      transition: 'all .12s', lineHeight: 1.4,
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(155,92,255,.1)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(155,92,255,.25)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-soft)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-2)'; }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map(m => (
                <MessageBubble
                  key={m.id}
                  msg={m}
                  onPublishDraft={handlePublishDraft}
                  onCopyDraft={handleCopyDraft}
                  publishing={publishingDraftId === m.id}
                />
              ))}
              {loading && <TypingIndicator />}
            </>
          )}
        </div>

        <Divider />
        <div style={{ padding: '12px 16px', display: 'flex', gap: 10 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Спросите что-нибудь..."
            disabled={loading}
            style={{
              flex: 1, padding: '10px 14px', background: 'var(--surface-soft-3)',
              border: '1px solid var(--border-hi)', borderRadius: 10,
              color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
              transition: 'border-color .12s',
            }}
            onFocus={e => (e.target as HTMLElement).style.borderColor = 'rgba(155,92,255,.5)'}
            onBlur={e => (e.target as HTMLElement).style.borderColor = 'var(--surface-soft-6)'}
          />
          <Button variant="primary" onClick={() => sendMessage(input)} disabled={loading || !input.trim()}>
            {loading ? '...' : '→'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function getDemoAnswer(q: string): string {
  const lower = q.toLowerCase();
  if (lower.includes('swat')) return 'SWAT-прогон запускается из раздела "Запуск релиза" → режим "SWAT". Нужно выбрать версию, дежурных сотрудников и нажать "Запустить сбор". Прогон охватывает High/Blocker тест-кейсы на обеих платформах. Минимальный порог завершения — 90%.';
  if (lower.includes('чп') || lower.includes('чрезвычайное')) return 'ЧП (чрезвычайные происшествия) — это критические баги, влияющие на прод. Классифицируются по типам:\n• Prod — влияет на производственную среду\n• Bug — функциональный баг\n• Crash — падение приложения\n• VLet — нарушение пользовательского опыта\n\nСобираются из YouTrack запросом по тегу "ЧП" для конкретной версии.';
  if (lower.includes('ml') || lower.includes('риск') || lower.includes('модель')) return 'ML-модель оценки риска релиза — это бинарный классификатор CatBoost (17 входных признаков), работающий прямо в браузере через ONNX Runtime.\n\nОсновные признаки: tc_total_delta, chp_total_delta_pct, anom_score и др.\n\nТекущая точность: 90.9% accuracy, 100% recall. Данных пока мало (22 записи) — нужно расширять датасет.';
  if (lower.includes('критери') || lower.includes('блокир') || lower.includes('выпуск')) return 'Критерии блокировки релиза:\n• Critical тесты < 100% (хотя бы один падающий — блок)\n• Smoke тесты < 95%\n• ЧП категории Prod > 2 за последние 24ч\n• ML-оценка риска > 0.7\n• Не все дежурные прошли согласование\n\nПри наличии любого из этих условий кнопка публикации недоступна.';
  if (lower.includes('allure') || lower.includes('токен') || lower.includes('интеграц')) return 'Настройка Allure TestOps:\n1. Откройте Settings (шестерёнка в сайдбаре)\n2. Вкладка "Allure TestOps"\n3. Укажите Base URL (например: https://allure.example.com)\n4. Вставьте Api-Token (из профиля Allure → Access Tokens)\n5. Укажите Project ID\n\nПосле сохранения данные автоматически подгружаются из реального Allure.';
  if (lower.includes('smoke') || lower.includes('blocker') || lower.includes('разниц')) return 'Типы прогонов:\n• High/Blocker — приоритетные тест-кейсы, блокирующие выпуск. Запускаются первыми.\n• Smoke — быстрая проверка ключевых сценариев (~30 мин).\n• Regression — полное регрессионное тестирование (несколько часов).\n• NAPI — тесты нативного API, не зависящие от платформы.\n\nВ дашборде отображаются как "бублики" с процентом завершения.';
  return `Я нашёл несколько упоминаний по теме "${q}" в базе знаний WB Mobile. Для получения точного ответа уточните запрос или настройте реальный LLM URL в настройках (Settings → Proxy/LLM).`;
}
