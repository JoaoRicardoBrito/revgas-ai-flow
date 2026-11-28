/**
 * Tela simulada do atendente (issue #13). Todo texto do cliente entra por
 * `textContent`, nunca como HTML.
 */
export const ATTENDANT_PAGE = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Atendente (demonstração)</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 48rem; padding: 0 1rem; }
  article { border: 1px solid #ccc; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
  .late { color: #a33; font-weight: bold; }
  dt { font-weight: bold; }
  dd { margin: 0 0 .4rem; }
  li { white-space: pre-wrap; }
</style>
</head>
<body>
<h1>Atendente (demonstração)</h1>
<p id="status">Carregando...</p>
<main id="list"></main>
<script>
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  let last = '';

  function card(h) {
    const article = el('article');
    article.append(el('h2', h.contact + ' (' + h.channel + ')'));
    article.append(el('p', h.reason + ' · ' + new Date(h.at).toLocaleString('pt-BR')));
    if (h.afterHours) article.append(el('p', 'Pedido fora do horário', 'late'));
    const data = el('dl');
    for (const f of h.summary) data.append(el('dt', f.label), el('dd', f.value));
    article.append(h.summary.length ? data : el('p', 'Nenhum dado coletado.'));
    const details = el('details');
    details.dataset.id = h.id;
    const log = el('ul');
    for (const m of h.messages) log.append(el('li', m.from + ': ' + m.text));
    details.append(el('summary', 'Conversa'), log);
    article.append(details);
    return article;
  }

  async function refresh() {
    const status = document.getElementById('status');
    try {
      const response = await fetch('/attendant/handoffs');
      if (!response.ok) throw new Error();
      const body = await response.text();
      const items = JSON.parse(body);
      status.textContent = items.length ? items.length + ' passagem(ns)' : 'Nenhuma passagem ainda.';
      if (body === last) return;
      last = body;
      const list = document.getElementById('list');
      const open = new Set([...list.querySelectorAll('details[open]')].map((d) => d.dataset.id));
      list.replaceChildren(...items.map(card));
      for (const d of list.querySelectorAll('details')) d.open = open.has(d.dataset.id);
    } catch {
      status.textContent = 'Não consegui carregar. Tentando de novo...';
    }
  }
  refresh();
  setInterval(refresh, 3000);
</script>
</body>
</html>
`;
