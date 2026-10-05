/**
 * CARDÁPIO ONLINE (delivery) — site do CLIENTE. JavaScript puro, sem login.
 * Conversa só com as rotas públicas do backend (Code.gs): ver cardápio e enviar pedido.
 * O sistema da loja (PDV, estoque, financeiro...) NÃO faz parte deste site.
 */

// ===================== CONFIGURAÇÃO =====================
// URL do Web App do Apps Script (a mesma usada no sistema da loja; termina com /exec).
const API_URL = 'https://script.google.com/macros/s/AKfycbx64kcUSTZpx_TwoopjSJpZrZRZnO5Gxy38-seQL3ytl7cXoTJyZCXpm1cZoGEiX7fY/exec';
// ========================================================

const root = document.querySelector('#root');

// ======================================================================
// Utilitários de interface
// ======================================================================
// Utilitários de interface: formatação, toasts, modais, CSV.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (n) => brl.format(Number(n) || 0);
const num = (n, d = 3) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d }).format(Number(n) || 0);
const parseNum = (s) => {
  if (typeof s === 'number') return s;
  const t = String(s ?? '').trim().replace(/\s/g, '');
  if (!t) return 0;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) || 0;
};

const TZ = 'America/Sao_Paulo';
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: TZ }) : '');
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '');
const fmtDateTime = (d) => (d ? `${fmtDate(d)} ${fmtTime(d)}` : '');
const fmtDay = (s) => (s ? s.split('-').reverse().join('/') : '');
const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const sinceMin = (d) => Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));

const STATUS = {
  NOVO: { label: 'Novo', cls: 'blue', icon: '🔵' },
  CONFIRMADO: { label: 'Confirmado', cls: 'indigo', icon: '🟣' },
  EM_PREPARO: { label: 'Em preparo', cls: 'yellow', icon: '🟡' },
  PRONTO: { label: 'Pronto', cls: 'green', icon: '🟢' },
  ENTREGUE: { label: 'Entregue', cls: 'gray', icon: '⚪' },
  CANCELADO: { label: 'Cancelado', cls: 'red', icon: '🔴' },
};
const statusBadge = (s) => `<span class="badge ${STATUS[s]?.cls}">${STATUS[s]?.icon} ${STATUS[s]?.label || s}</span>`;
const ROLE = { ADMIN: 'Administrador', ATENDENTE: 'Atendente', COZINHA: 'Cozinha' };

function toast(msg, type = 'ok', ms = 3500) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), ms);
}

/** Abre um modal. `body` é HTML. Retorna {el, close}. */
function modal({ title, body, wide = false, onMount }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Fechar">✕</button></div>
    <div class="modal-body">${body}</div></div>`;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  document.body.append(wrap);
  const first = wrap.querySelector('input:not([type=hidden]),select,textarea');
  first?.focus();
  onMount?.(wrap, close);
  return { el: wrap, close };
}

const confirmDialog = (message, { ok = 'Confirmar', danger = false } = {}) => new Promise((resolve) => {
  const m = modal({
    title: 'Confirmação',
    body: `<p>${esc(message)}</p><div class="row end gap"><button class="btn" data-close>Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button></div>`,
  });
  m.el.querySelector('[data-ok]').onclick = () => { m.close(); resolve(true); };
  m.el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) resolve(false); });
});

/** Pede um texto (ex.: motivo). Resolve com string ou null. */
const promptDialog = (title, label, { required = true, ok = 'Confirmar', danger = false } = {}) => new Promise((resolve) => {
  const m = modal({
    title,
    body: `<form class="form"><label>${esc(label)}<textarea name="v" rows="3" ${required ? 'required' : ''}></textarea></label>
      <div class="row end gap"><button type="button" class="btn" data-close>Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}">${esc(ok)}</button></div></form>`,
  });
  m.el.querySelector('form').onsubmit = (e) => { e.preventDefault(); const val = e.target.v.value.trim(); m.close(); resolve(val); };
  m.el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) resolve(null); });
});

function downloadCsv(filename, columns, rows) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [columns.map((c) => cell(c.label)).join(';')];
  for (const r of rows) {
    lines.push(columns.map((c) => {
      const v = r[c.key];
      if (c.type === 'money' || typeof v === 'number') return cell(String(v ?? '').replace('.', ','));
      if (c.type === 'datetime') return cell(fmtDateTime(v));
      if (c.type === 'date') return cell(fmtDay(v));
      return cell(v);
    }).join(';'));
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }); // BOM p/ Excel
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Lê arquivo de imagem e redimensiona para data URL JPEG/PNG leve. */
function imageToDataUrl(file, max = 160, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      // A célula do Google Sheets aceita ~50 mil caracteres: reduz a qualidade até caber.
      const test = c.toDataURL('image/webp', quality);
      const mime = test.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
      let q = quality; let out = c.toDataURL(mime, q);
      while (out.length > 40000 && q > 0.2) { q -= 0.1; out = c.toDataURL(mime, q); }
      if (out.length > 40000) return reject(new Error('Imagem complexa demais; use uma foto menor'));
      resolve(out);
    };
    img.onerror = () => reject(new Error('Imagem inválida'));
    img.src = URL.createObjectURL(file);
  });
}

const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/** Beep curto para novos pedidos (sem arquivo de áudio). */
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.15;
    o.start(); o.stop(ctx.currentTime + 0.25);
    setTimeout(() => ctx.close(), 500);
  } catch { /* áudio bloqueado até interação */ }
}


// ======================================================================
// Chamada ao backend (somente rotas públicas)
// ======================================================================
async function request(method, path, body) {
  if (!API_URL || /COLE_AQUI/.test(API_URL)) throw new Error('Cardápio não configurado: preencha API_URL no início do cardapio.js.');
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ method, path, query: {}, body: body === undefined ? {} : body }),
    });
  } catch {
    throw new Error('Sem conexão com o servidor');
  }
  let data;
  try { data = await res.json(); } catch { throw new Error('Resposta inválida do servidor. Tente novamente em instantes.'); }
  if (data.error) throw Object.assign(new Error(data.error), { status: data.status });
  return data.data;
}

// ======================================================================
// Cardápio público (delivery): página do cliente, sem login
// Acesso: .../index.html?cardapio
// ======================================================================

const waDigits = (n) => { const d = String(n || '').replace(/\D/g, ''); return d.length === 10 || d.length === 11 ? '55' + d : d; };
const waLink = (n, text) => `https://wa.me/${waDigits(n)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

const Shop = (function () {
  const KEY = 'pastelaria.shop';
  const PAY = { PIX: 'Pix (envio o comprovante)', DINHEIRO: 'Dinheiro', CARTAO: 'Cartão na entrega' };
  let menu = null; let cart = {}; let cat = 'all';

  const saved = () => { try { return JSON.parse(localStorage.getItem(KEY + '.customer') || '{}'); } catch { return {}; } };
  const lines = () => Object.entries(cart).map(([id, q]) => { const p = menu.products.find((x) => x.id === Number(id)); return p ? { p, q } : null; }).filter(Boolean);
  const subtotal = () => lines().reduce((s, l) => s + l.p.price * l.q, 0);
  const count = () => lines().reduce((s, l) => s + l.q, 0);
  const saveCart = () => localStorage.setItem(KEY + '.cart', JSON.stringify(cart));
  const wa = () => menu.delivery.whatsapp;

  async function start() {
    root.innerHTML = '<div class="shop"><div class="empty">Carregando cardápio…</div></div>';
    try {
      menu = await request('GET', '/public/menu');
    } catch (e) {
      root.innerHTML = `<div class="shop"><div class="alert err">${esc(e.message)}</div><button class="btn primary" onclick="location.reload()">Tentar de novo</button></div>`;
      return;
    }
    document.title = `${menu.store.name} — Cardápio`;
    try { cart = JSON.parse(localStorage.getItem(KEY + '.cart') || '{}'); } catch { cart = {}; }
    Object.keys(cart).forEach((id) => { if (!menu.products.some((p) => p.id === Number(id) && p.available)) delete cart[id]; }); // item que saiu do cardápio
    root.addEventListener('click', onClick);
    draw();
  }

  function head() {
    const d = menu.delivery;
    return `<header class="shop-head">${menu.store.logo ? `<img src="${menu.store.logo}" alt="">` : '<div class="logo">🥟</div>'}
      <div><h1>${esc(menu.store.name)}</h1><div class="small muted">${menu.store.address ? `📍 ${esc(menu.store.address)}` : ''}</div></div></header>
      ${d.notes ? `<div class="alert info small">${esc(d.notes)}</div>` : ''}
      ${d.enabled && d.min_order > 0 ? `<div class="small muted mb">Pedido mínimo: ${money(d.min_order)} · A taxa de entrega depende do bairro.</div>` : ''}`;
  }

  function card(p) {
    const q = cart[p.id] || 0;
    return `<div class="shop-item ${p.available ? '' : 'off'}">
      <div class="shop-ph">${p.photo ? `<img src="${p.photo}" alt="" loading="lazy">` : '🥟'}</div>
      <div class="shop-info"><b>${esc(p.name)}</b>${p.description ? `<span class="small muted">${esc(p.description)}</span>` : ''}<span class="price">${money(p.price)}</span></div>
      <div class="shop-qty">${!p.available ? '<span class="small" style="color:var(--red)">Indisponível</span>'
        : q ? `<button data-dec="${p.id}" aria-label="Menos">−</button><b>${q}</b><button data-inc="${p.id}" aria-label="Mais">+</button>`
          : `<button class="add" data-inc="${p.id}">Adicionar</button>`}</div></div>`;
  }

  function draw() {
    const y = window.scrollY;
    const d = menu.delivery;
    if (!d.enabled) {
      root.innerHTML = `<div class="shop">${head()}<div class="alert warn">No momento não estamos recebendo pedidos pelo site.${d.whatsapp ? ` Fale com a gente pelo <a href="${waLink(d.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>.` : ''}</div></div>`;
      return;
    }
    const cats = [{ id: 'all', name: 'Tudo' }, ...menu.categories.filter((c) => menu.products.some((p) => p.category_id === c.id))];
    const prods = menu.products.filter((p) => cat === 'all' || p.category_id === cat);
    root.innerHTML = `<div class="shop">${head()}
      <div class="cats shop-cats">${cats.map((c) => `<button class="tab ${String(c.id) === String(cat) ? 'active' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`).join('')}</div>
      <div class="shop-list">${prods.map(card).join('') || '<div class="empty">Nenhum item disponível</div>'}</div>
      ${count() ? `<div class="shop-bar"><button class="btn primary lg" data-act="cart">🛒 Ver pedido · ${count()} ${count() === 1 ? 'item' : 'itens'} · ${money(subtotal())}</button></div>` : ''}</div>`;
    window.scrollTo(0, y);
  }

  function onClick(e) {
    const t = e.target.closest('button, a'); if (!t) return;
    if (t.dataset.cat) { cat = t.dataset.cat === 'all' ? 'all' : Number(t.dataset.cat); draw(); }
    if (t.dataset.inc) { const id = t.dataset.inc; cart[id] = Math.min((cart[id] || 0) + 1, 20); saveCart(); draw(); }
    if (t.dataset.dec) { const id = t.dataset.dec; cart[id] = (cart[id] || 0) - 1; if (cart[id] <= 0) delete cart[id]; saveCart(); draw(); }
    if (t.dataset.act === 'cart') checkout();
  }

  function checkout() {
    const d = menu.delivery; const c = saved();
    const m = modal({
      title: 'Seu pedido',
      body: `<form class="form" id="shopform">
        <div class="shop-lines">${lines().map((l) => `<div class="row between"><span>${l.q}x ${esc(l.p.name)}</span><b>${money(l.p.price * l.q)}</b></div>`).join('')}</div>
        <label>Seu nome<input name="name" required maxlength="80" autocomplete="name" value="${esc(c.name || '')}"></label>
        <label>WhatsApp / telefone (com DDD)<input name="phone" required inputmode="tel" autocomplete="tel" placeholder="(11) 99999-0000" value="${esc(c.phone || '')}"></label>
        <label>Bairro<select name="hood" required><option value="">Selecione…</option>${d.neighborhoods.map((n) => `<option value="${esc(n.name)}" ${n.name === c.hood ? 'selected' : ''}>${esc(n.name)} — taxa ${money(n.fee)}</option>`).join('')}</select></label>
        <label>Endereço (rua, número, complemento)<input name="address" required maxlength="200" autocomplete="street-address" value="${esc(c.address || '')}"></label>
        <fieldset class="shop-pay"><legend>Pagamento na entrega</legend>
          ${Object.entries(PAY).map(([k, l]) => `<label class="check"><input type="radio" name="pay" value="${k}" ${(c.pay || 'PIX') === k ? 'checked' : ''}> ${l}</label>`).join('')}</fieldset>
        <label id="changebox" class="hidden">Troco para quanto? (opcional)<input name="change" inputmode="decimal" placeholder="Ex.: 50"></label>
        <label>Observações<textarea name="notes" rows="2" maxlength="300" placeholder="Ex.: sem cebola, interfone não funciona…"></textarea></label>
        <input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;opacity:0;height:0">
        <div class="totals" id="shoptotals"></div>
        <div class="alert err hidden" id="shoperr"></div>
        <button class="btn success lg" id="sendbtn">Enviar pedido</button>
        <p class="muted small center">${d.save_orders ? 'O pedido é registrado na loja e depois você confirma pelo WhatsApp.' : 'Você será levado ao WhatsApp da loja com o pedido pronto.'}</p></form>`,
    });
    const f = m.el.querySelector('#shopform');
    const fee = () => (d.neighborhoods.find((n) => n.name === f.hood.value) || { fee: 0 }).fee;
    const refresh = () => {
      $('#changebox', m.el).classList.toggle('hidden', f.pay.value !== 'DINHEIRO');
      $('#shoptotals', m.el).innerHTML = `<div class="row between"><span>Subtotal</span><span>${money(subtotal())}</span></div>
        <div class="row between"><span>Entrega${f.hood.value ? ` (${esc(f.hood.value)})` : ''}</span><span>${f.hood.value ? money(fee()) : '—'}</span></div>
        <div class="row between grand"><span>Total</span><span>${money(subtotal() + fee())}</span></div>`;
    };
    f.addEventListener('change', refresh); refresh();

    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const err = (msg) => { const b = $('#shoperr', m.el); b.textContent = msg; b.classList.remove('hidden'); };
      if (subtotal() < (d.min_order || 0)) return err(`Pedido mínimo: ${money(d.min_order)}. Adicione mais itens.`);
      const data = {
        name: f.name.value.trim(), phone: f.phone.value.trim(), hood: f.hood.value, address: f.address.value.trim(), pay: f.pay.value,
        change: f.pay.value === 'DINHEIRO' ? parseNum(f.change.value) : 0, notes: f.notes.value.trim(),
        lines: lines().map((l) => ({ id: l.p.id, q: l.q, name: l.p.name })), sub: subtotal(), fee: fee(), total: subtotal() + fee(),
      };
      const btn = $('#sendbtn', m.el); btn.disabled = true; btn.textContent = 'Enviando…';
      let res = null;
      try {
        if (d.save_orders) {
          res = await request('POST', '/public/order', {
            name: data.name, phone: data.phone, address: data.address, neighborhood: data.hood, payment: data.pay, change_for: data.change || undefined,
            notes: data.notes || undefined, website: f.website.value, items: data.lines.map((l) => ({ product_id: l.id, quantity: l.q })),
          });
          Object.assign(data, { sub: res.subtotal, fee: res.fee, total: res.total }); // valores oficiais calculados pela loja
        }
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Enviar pedido'; return err(e.message);
      }
      localStorage.setItem(KEY + '.customer', JSON.stringify({ name: data.name, phone: data.phone, hood: data.hood, address: data.address, pay: data.pay }));
      cart = {}; saveCart(); draw();
      done(m, res, data);
    };
  }

  function message(res, x) {
    const out = [`*${res ? `Pedido ${res.label}` : 'Novo pedido'} — ${menu.store.name}*`];
    x.lines.forEach((l) => out.push(`${l.q}x ${l.name}`));
    out.push('', `Subtotal: ${money(x.sub)}`, `Entrega (${x.hood}): ${money(x.fee)}`, `*Total: ${money(x.total)}*`, '');
    out.push(`Nome: ${x.name}`, `Tel: ${x.phone}`, `Endereço: ${x.address} — ${x.hood}`);
    out.push(`Pagamento: ${PAY[x.pay]}${x.pay === 'DINHEIRO' && x.change ? ` (troco para ${money(x.change)})` : ''}`);
    if (x.notes) out.push(`Obs: ${x.notes}`);
    return out.join('\n');
  }

  function done(m, res, x) {
    const d = menu.delivery;
    const pix = x.pay === 'PIX'
      ? (d.pix_key ? `<div class="alert info" style="text-align:left">💠 <b>Pague com Pix</b><br>Chave: <b>${esc(d.pix_key)}</b> <button type="button" class="btn sm" data-copy="${esc(d.pix_key)}">Copiar</button>
          ${d.pix_name ? `<br>Favorecido: ${esc(d.pix_name)}` : ''}<br>Valor: <b>${money(x.total)}</b><br><span class="small">Envie o comprovante pelo WhatsApp.</span></div>`
        : '<div class="alert info small">A loja vai enviar a chave Pix pelo WhatsApp.</div>') : '';
    m.el.querySelector('.modal-body').innerHTML = `<div class="center">
      <div style="font-size:3rem">✅</div><h2>${res ? `Pedido ${esc(res.label)} recebido!` : 'Quase lá!'}</h2>
      <p>${res ? 'A loja já recebeu o seu pedido. ' : ''}Toque abaixo para <b>enviar a mensagem no WhatsApp</b> da loja${res ? ' e agilizar a confirmação' : ''}.</p>
      <a class="btn success lg" style="display:inline-block;margin:8px 0 16px;text-decoration:none" target="_blank" rel="noopener" href="${waLink(d.whatsapp, message(res, x))}">💬 Enviar pelo WhatsApp</a>
      ${pix}
      <p class="small muted mt">Total: <b>${money(x.total)}</b> (entrega ${money(x.fee)}) · pagamento na entrega</p>
      <button class="btn" data-close>Fechar</button></div>`;
    m.el.querySelector('[data-copy]')?.addEventListener('click', (e) => navigator.clipboard?.writeText(e.target.dataset.copy).then(() => toast('Chave Pix copiada')));
  }

  return { start };
})();


Shop.start();
