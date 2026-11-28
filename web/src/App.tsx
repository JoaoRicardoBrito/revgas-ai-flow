import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  fetchMetrics,
  fetchProfiles,
  sendMessage,
  type Metrics,
  type Outgoing,
  type Profile,
  type Reply,
} from './api';
import { History, Stopwatch } from './TimePanel';
import { onAnswer, onSend, type OrderTimer } from './timing';

interface Entry {
  from: 'customer' | 'bot' | 'system';
  reply: Reply;
}

export function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [phone, setPhone] = useState('');
  /** Uma conversa por telefone: trocar de cliente não apaga a outra. */
  const [chats, setChats] = useState<Record<string, Entry[]>>({});
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [timers, setTimers] = useState<Record<string, OrderTimer>>({});
  const [metrics, setMetrics] = useState<Metrics>();
  const [metricsFailed, setMetricsFailed] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const entries = chats[phone] ?? [];

  useEffect(() => {
    fetchProfiles().then(
      (list) => {
        setProfiles(list);
        setPhone(list[0]?.phone ?? '');
      },
      () => setLoadError(true),
    );
  }, []);

  function refreshMetrics() {
    fetchMetrics().then(
      (report) => {
        setMetrics(report);
        setMetricsFailed(false);
      },
      () => setMetricsFailed(true),
    );
  }

  useEffect(refreshMetrics, []);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [entries.length, phone]);

  const append = (to: string, ...added: Entry[]) =>
    setChats((all) => ({ ...all, [to]: [...(all[to] ?? []), ...added] }));

  async function send(message: Outgoing, shown: string) {
    const to = phone;
    setBusy(true);
    const previous = timers[to];
    const sentAt = Date.now();
    const setTimer = (timer: OrderTimer | undefined) =>
      setTimers((all) => {
        const next = { ...all };
        if (timer) next[to] = timer;
        else delete next[to];
        return next;
      });
    setTimer(onSend(previous, sentAt));
    append(to, { from: 'customer', reply: { text: shown } });
    try {
      const answer = await sendMessage(to, message);
      setTimer(onAnswer(previous, answer, sentAt, Date.now()));
      append(
        to,
        ...answer.replies.map((reply): Entry => ({ from: 'bot', reply })),
        ...(answer.silenced
          ? [system('Conversa com atendente: o bot não responde.')]
          : []),
      );
    } catch {
      setTimer(previous);
      append(to, system('Não foi possível enviar. Tente de novo.'));
    } finally {
      setBusy(false);
      refreshMetrics();
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const typed = text.trim();
    if (!typed || busy || !phone) return;
    setText('');
    void send({ text: typed }, typed);
  }

  /** Só a última resposta do bot mantém os botões tocáveis. */
  const lastBot = entries.findLastIndex((e) => e.from === 'bot');

  const timer = timers[phone];
  const order = metrics?.orders.find(
    (o) => o.conversationId === timer?.conversationId,
  );

  return (
    <div className="layout">
      <main>
        <header>
          <h1>Simulador de chat</h1>
          <label>
            Cliente simulado
            <select
              value={phone}
              disabled={busy}
              onChange={(e) => setPhone(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.phone} value={p.phone}>
                  {p.label} · {p.phone}
                </option>
              ))}
            </select>
          </label>
          <Stopwatch
            key={phone}
            timer={timer}
            order={order}
            baselineMs={metrics?.baselineMs}
          />
        </header>

        <section aria-live="polite">
          {loadError && (
            <p className="system">
              Simulador indisponível. Ele só funciona em modo mock, nesta
              máquina.
            </p>
          )}
          {!loadError && entries.length === 0 && (
            <p className="system">Mande um “oi” para começar.</p>
          )}
          {entries.map((entry, i) => (
            <div key={i} className={entry.from}>
              <p>{entry.reply.text}</p>
              {i === lastBot && entry.reply.buttons && (
                <div className={`options ${entry.reply.presentation ?? ''}`}>
                  {entry.reply.buttons.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void send({ buttonId: b.id }, b.label)}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div ref={end} />
        </section>

        <form onSubmit={submit}>
          <input
            aria-label="Mensagem"
            placeholder="Mensagem"
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" disabled={busy || !phone || !text.trim()}>
            Enviar
          </button>
        </form>
      </main>
      <History metrics={metrics} failed={metricsFailed} />
    </div>
  );
}

function system(text: string): Entry {
  return { from: 'system', reply: { text } };
}
