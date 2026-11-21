const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const titles = { dashboard: 'Visão geral', crm: 'CRM', sales: 'Vendas', finance: 'Financeiro', agenda: 'Agenda', mentorships: 'Mentorias', products: 'Ofertas', integrations: 'Integrações' };
const today = () => new Date().toISOString().slice(0, 10);
const uid = (prefix = 'REG') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
const cents = value => {
  const raw = String(value ?? '').trim();
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  return Math.round((Number.parseFloat(normalized) || 0) * 100);
};
const money = amount => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(amount) || 0) / 100);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const shortDate = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(`${value.slice(0, 10)}T12:00:00`)) : '—';
const longDate = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(new Date(`${value.slice(0, 10)}T12:00:00`)) : '';
const dateTime = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
let data = null;
let currentPage = 'dashboard';
let editingId = null;
let toastTimer;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Falha ${response.status}`);
  return result;
}
function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
function setAuthMode(configured) {
  $('#authTitle').textContent = configured ? 'Acesse seu espaço' : 'Crie sua senha de acesso';
  $('#authDescription').textContent = configured ? 'Seus dados ficam protegidos neste computador.' : 'Escolha uma senha forte. Ela também protege os dados locais.';
  $('#authSubmit').textContent = configured ? 'Entrar' : 'Criar senha e iniciar';
  $('#authPassword').autocomplete = configured ? 'current-password' : 'new-password';
  $('#authConfirm').classList.toggle('hidden', configured);
  $('#confirmLabel').classList.toggle('hidden', configured);
  $('#authConfirm').required = !configured;
  $('#authForm').dataset.mode = configured ? 'login' : 'setup';
}
async function start() {
  try {
    const status = await api('/api/auth/status');
    if (status.authenticated) return loadApplication();
    setAuthMode(status.configured);
    $('#authGate').classList.remove('hidden');
  } catch (error) {
    $('#authGate').classList.remove('hidden');
    $('#authTitle').textContent = 'Painel indisponível';
    $('#authDescription').textContent = 'Inicie o servidor local pelo arquivo LEIA-ME.md.';
    $('#authMessage').textContent = error.message;
  }
}
async function loadApplication() {
  try {
    data = await api('/api/data');
    $('#authGate').classList.add('hidden'); $('#appShell').classList.remove('hidden');
    $('#todayLabel').textContent = longDate(today());
    renderAll();
  } catch (error) {
    $('#authMessage').textContent = error.message; $('#authGate').classList.remove('hidden');
  }
}
async function persist() {
  const save = $('#saveState'); save.classList.add('saving'); save.lastChild.textContent = 'Salvando…';
  try {
    const result = await api('/api/data', { method: 'PUT', body: JSON.stringify(data) });
    data.updatedAt = result.updatedAt;
    save.classList.remove('saving'); save.lastChild.textContent = 'Salvo neste computador';
    renderAll();
    return true;
  } catch (error) {
    save.classList.remove('saving'); save.lastChild.textContent = 'Falha ao salvar'; toast(`Não foi salvo: ${error.message}`); return false;
  }
}
function pill(text) {
  const value = String(text || '—');
  const tone = /Recebido|Concluída|Ativo|Confirmado/i.test(value) ? 'green' : /Pendente|Lead|Manual|Planejada/i.test(value) ? 'gold' : /Cancelado|Estornado/i.test(value) ? 'red' : '';
  return `<span class="pill ${tone}">${escapeHtml(value)}</span>`;
}
function renderAll() {
  if (!data) return;
  renderDashboard(); renderContacts(); renderSales(); renderFinance(); renderAgenda(); renderMentorships(); renderProducts(); renderIntegrations();
  $('#navLeadCount').textContent = data.contacts.filter(c => c.profile === 'Lead').length;
}
function renderDashboard() {
  const received = data.transactions.filter(t => t.kind === 'Receita' && t.status === 'Recebido').reduce((sum, t) => sum + (Number(t.amountCents) || 0), 0);
  const receivable = data.transactions.filter(t => t.kind === 'Receita' && t.status === 'Pendente').reduce((sum, t) => sum + (Number(t.amountCents) || 0), 0);
  const expenses = data.transactions.filter(t => t.kind === 'Despesa' && t.status === 'Pago').reduce((sum, t) => sum + (Number(t.amountCents) || 0), 0);
  const net = received - expenses;
  for (const id of ['metricReceived', 'finReceived']) $(`#${id}`).textContent = money(received);
  for (const id of ['metricReceivable', 'finReceivable']) $(`#${id}`).textContent = money(receivable);
  for (const id of ['metricExpenses', 'finExpenses']) $(`#${id}`).textContent = money(expenses);
  for (const id of ['metricNet', 'finNet']) $(`#${id}`).textContent = money(net);
  const activeLeads = data.contacts.filter(c => c.profile === 'Lead');
  $('#dashLeads').textContent = activeLeads.length;
  $('#dashClients').textContent = data.contacts.filter(c => c.profile === 'Cliente').length;
  $('#dashMentees').textContent = data.mentorships.filter(m => !/Concluída|Cancelada/.test(m.status)).length;
  const upcoming = data.appointments.filter(a => a.status !== 'Concluída' && a.status !== 'Cancelada' && a.start >= today()).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 3);
  $('#upcomingPreview').innerHTML = upcoming.length ? upcoming.map(a => `<div class="preview-row"><div><b>${escapeHtml(a.title)}</b><small>${dateTime(a.start)} · ${escapeHtml(a.location || a.type)}</small></div>${pill(a.status)}</div>`).join('') : '<div class="empty-inline">Nenhum compromisso futuro cadastrado.</div>';
  const recent = [...data.sales].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  $('#salesPreview').innerHTML = recent.length ? recent.map(s => `<div class="preview-row"><div><b>${escapeHtml(contactName(s.contactId))}</b><small>${escapeHtml(productName(s.productId))} · ${shortDate(s.date)}</small></div><span class="preview-value">${money(s.amountCents)}</span></div>`).join('') : '<div class="empty-inline">As vendas registradas aparecerão aqui.</div>';
}
function contactName(id) { return data.contacts.find(c => c.id === id)?.name || 'Contato removido'; }
function productName(id) { return data.products.find(p => p.id === id)?.name || 'Oferta removida'; }
function renderContacts() {
  const query = ($('#contactSearch')?.value || '').toLowerCase(); const filter = $('#contactFilter')?.value || 'all';
  const contacts = data.contacts.filter(c => (filter === 'all' || c.profile === filter) && `${c.name} ${c.email} ${c.phone} ${c.source}`.toLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name));
  $('#contactsTable').innerHTML = contacts.map(c => `<tr><td><div class="contact-name">${escapeHtml(c.name)}</div><div class="contact-sub">${escapeHtml(c.phone || c.email || 'Sem contato informado')}</div></td><td>${pill(c.profile)}</td><td>${escapeHtml(c.source || '—')}</td><td>${escapeHtml(c.stage || 'Novo')}</td><td>${c.nextActionDate ? `${shortDate(c.nextActionDate)}<div class="contact-sub">${escapeHtml(c.nextAction || '')}</div>` : '—'}</td><td><button class="row-action" data-action="edit-contact" data-id="${escapeHtml(c.id)}">Editar</button></td></tr>`).join('');
  $('#contactsEmpty').classList.toggle('hidden', contacts.length > 0);
}
function renderSales() {
  const query = ($('#salesSearch')?.value || '').toLowerCase(); const filter = $('#salesFilter')?.value || 'all';
  const sales = [...data.sales].filter(s => (filter === 'all' || s.status === filter) && `${contactName(s.contactId)} ${productName(s.productId)}`.toLowerCase().includes(query)).sort((a, b) => b.date.localeCompare(a.date));
  $('#salesTable').innerHTML = sales.map(s => `<tr><td>${shortDate(s.date)}</td><td><div class="contact-name">${escapeHtml(contactName(s.contactId))}</div></td><td>${escapeHtml(productName(s.productId))}</td><td>${money(s.amountCents)}</td><td>${escapeHtml(s.paymentMethod)}</td><td>${pill(s.status)}</td><td>${s.status === 'Pendente' ? `<button class="row-action" data-action="confirm-sale" data-id="${escapeHtml(s.id)}">Confirmar recebimento</button>` : ''}</td></tr>`).join('');
  $('#salesEmpty').classList.toggle('hidden', sales.length > 0);
  $('#salesCount').textContent = data.sales.length;
  $('#salesPaidCount').textContent = data.sales.filter(s => s.status === 'Recebido').length;
  $('#salesPendingCount').textContent = data.sales.filter(s => s.status === 'Pendente').length;
}
function renderFinance() {
  const filter = $('#transactionFilter')?.value || 'all';
  const tx = [...data.transactions].filter(t => filter === 'all' || t.kind === filter || t.status === filter).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  $('#transactionsTable').innerHTML = tx.map(t => `<tr><td>${shortDate(t.date)}</td><td>${escapeHtml(t.kind)}</td><td><div class="contact-name">${escapeHtml(t.description)}</div>${t.saleId ? `<div class="contact-sub">Venda · ${escapeHtml(contactName(data.sales.find(s => s.id === t.saleId)?.contactId))}</div>` : ''}</td><td>${escapeHtml(t.category || '—')}</td><td>${escapeHtml(t.paymentMethod || '—')}</td><td>${money(t.amountCents)}</td><td>${pill(t.status)}</td><td>${t.status === 'Pendente' ? `<button class="row-action" data-action="confirm-transaction" data-id="${escapeHtml(t.id)}">${t.kind === 'Receita' ? 'Marcar recebido' : 'Marcar pago'}</button>` : ''}</td></tr>`).join('');
  $('#transactionsEmpty').classList.toggle('hidden', tx.length > 0);
}
function renderAgenda() {
  const sorted = [...data.appointments].sort((a, b) => a.start.localeCompare(b.start));
  $('#calendarList').innerHTML = sorted.length ? sorted.map(a => {
    const startDate = a.start.slice(0, 10); const endDate = a.end?.slice(0, 10);
    return `<article class="agenda-card"><div class="agenda-date"><b>${shortDate(startDate)}</b><small>${a.end && endDate !== startDate ? `até ${shortDate(endDate)}` : (a.start.includes('T') ? a.start.slice(11, 16) : '')}</small></div><div class="agenda-info"><h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(a.type)}${a.location ? ` · ${escapeHtml(a.location)}` : ''}${a.contactId ? ` · ${escapeHtml(contactName(a.contactId))}` : ''}</p>${a.notes ? `<small>${escapeHtml(a.notes)}</small>` : ''}</div>${pill(a.status)}</article>`;
  }).join('') : '<div class="empty-state"><span>▦</span><b>Agenda vazia</b><p>Cadastre mentorias, atendimentos e vivências.</p></div>';
}
function renderMentorships() {
  const items = [...data.mentorships].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  $('#mentorshipList').innerHTML = items.length ? items.map(m => `<article class="journey-card"><div class="card-top"><div><h3>${escapeHtml(contactName(m.contactId))}</h3><p>${escapeHtml(productName(m.productId))}</p></div>${pill(m.status)}</div><div class="card-meta">Início: ${shortDate(m.startDate)} · Encerramento: ${shortDate(m.endDate)}</div>${m.nextSession ? `<div class="card-meta">Próximo encontro: ${escapeHtml(m.nextSession)}</div>` : ''}<div class="card-meta">${escapeHtml(m.operationalNote || 'Acompanhamento operacional sem notas íntimas.')}</div></article>`).join('') : '<div class="journey-card"><h3>Nenhuma jornada cadastrada</h3><p>Cadastre uma mentoria após confirmar a inscrição ou registre um acompanhamento já em andamento.</p></div>';
}
function renderProducts() {
  $('#productsList').innerHTML = data.products.map(p => `<article class="product-card"><div class="card-top"><div><p class="eyebrow">${escapeHtml(p.modality || 'Oferta')}</p><h3>${escapeHtml(p.name)}</h3></div>${pill(p.active ? 'Ativa' : 'Inativa')}</div><div class="product-price">${money(p.priceCents)}</div><p>${escapeHtml([p.format, p.duration].filter(Boolean).join(' · '))}</p><div class="card-meta">${escapeHtml(p.notes || '')}</div><button class="row-action" data-action="edit-product" data-id="${escapeHtml(p.id)}">Editar oferta</button></article>`).join('');
}
function renderIntegrations() {
  $('#integrationList').innerHTML = data.integrations.map(item => `<article class="integration-card"><div class="card-top"><div><p class="eyebrow">${item.enabled ? 'CONECTADO' : 'SEM CONEXÃO'}</p><h3><i class="status-dot ${item.status === 'Manual' ? 'manual' : ''}"></i>${escapeHtml(item.name)}</h3></div>${pill(item.status)}</div><p>${escapeHtml(item.notes || '')}</p><button class="row-action" data-action="edit-integration" data-id="${escapeHtml(item.id)}">Editar configuração</button></article>`).join('');
}

function field(name, label, type = 'text', value = '', options = null, full = false, help = '') {
  const attrs = `name="${escapeHtml(name)}" id="field-${escapeHtml(name)}" ${full ? 'class="full-width"' : ''}`;
  const helpHtml = help ? `<small class="help">${escapeHtml(help)}</small>` : '';
  if (type === 'select') return `<div class="field ${full ? 'full-width' : ''}"><label for="field-${escapeHtml(name)}">${escapeHtml(label)}</label><select ${attrs}>${options.map(o => `<option value="${escapeHtml(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>${helpHtml}</div>`;
  if (type === 'textarea') return `<div class="field ${full ? 'full-width' : ''}"><label for="field-${escapeHtml(name)}">${escapeHtml(label)}</label><textarea ${attrs}>${escapeHtml(value)}</textarea>${helpHtml}</div>`;
  return `<div class="field ${full ? 'full-width' : ''}"><label for="field-${escapeHtml(name)}">${escapeHtml(label)}</label><input ${attrs} type="${type}" value="${escapeHtml(value)}" ${type === 'number' ? 'min="0" step="0.01"' : ''}>${helpHtml}</div>`;
}
function optionList(items, idKey = 'id', nameKey = 'name', firstLabel = 'Selecione') { return [{ value: '', label: firstLabel }, ...items.map(x => ({ value: x[idKey], label: x[nameKey] }))]; }
function openModal(type, id = null) {
  editingId = id;
  const existing = id ? findByType(type, id) : null;
  $('#dialogFields').innerHTML = '';
  $('#dialogMessage').textContent = '';
  const productOptions = optionList(data.products.filter(p => p.active), 'id', 'name', 'Selecione a oferta');
  const contactOptions = optionList(data.contacts, 'id', 'name', 'Selecione o contato');
  let title = 'Novo registro'; let eyebrow = 'NOVO REGISTRO'; let html = '';
  if (type === 'contact') {
    title = existing ? 'Editar contato' : 'Novo contato'; eyebrow = 'CRM';
    html = field('name', 'Nome', 'text', existing?.name || '') + field('profile', 'Perfil', 'select', existing?.profile || 'Lead', ['Lead','Cliente','Mentorado'].map(v=>({value:v,label:v}))) + field('phone', 'WhatsApp / telefone', 'tel', existing?.phone || '') + field('email', 'E-mail', 'email', existing?.email || '') + field('source', 'Origem', 'select', existing?.source || 'WhatsApp', ['WhatsApp','Instagram','Site','E-mail','Indicação','Outro'].map(v=>({value:v,label:v}))) + field('stage', 'Etapa', 'select', existing?.stage || 'Novo', ['Novo','Em conversa','Qualificado','Oferta apresentada','Aguardando decisão','Cliente ativo','Encerrado','Não contatar'].map(v=>({value:v,label:v}))) + field('interestProductId', 'Interesse / oferta', 'select', existing?.interestProductId || '', productOptions) + field('nextActionDate', 'Data da próxima ação', 'date', existing?.nextActionDate || '') + field('nextAction', 'Próxima ação', 'text', existing?.nextAction || '') + field('notes', 'Observação comercial breve', 'textarea', existing?.notes || '', null, true, 'Não registre relatos íntimos, informações clínicas ou detalhes sensíveis.');
  } else if (type === 'sale') {
    title = 'Registrar venda'; eyebrow = 'VENDA · PAGAMENTO PENDENTE';
    html = field('contactId', 'Cliente', 'select', '', contactOptions) + field('productId', 'Oferta', 'select', '', productOptions) + field('amount', 'Valor da venda (R$)', 'number', '') + field('date', 'Data da venda', 'date', today()) + field('paymentMethod', 'Forma de pagamento', 'select', 'PIX', ['PIX','Cartão de crédito'].map(v=>({value:v,label:v}))) + field('reference', 'Referência / observação', 'text', '', null, true, 'A venda será registrada como pendente. Confirme o recebimento só depois da conferência.');
  } else if (type === 'transaction') {
    title = 'Novo lançamento'; eyebrow = 'FINANCEIRO · REGISTRO MANUAL';
    html = field('kind', 'Tipo', 'select', 'Receita', ['Receita','Despesa'].map(v=>({value:v,label:v}))) + field('description', 'Descrição', 'text', '') + field('category', 'Categoria', 'text', '') + field('amount', 'Valor (R$)', 'number', '') + field('date', 'Data / vencimento', 'date', today()) + field('paymentMethod', 'Forma', 'select', 'PIX', ['PIX','Cartão de crédito','Transferência','Dinheiro','Outro'].map(v=>({value:v,label:v}))) + field('status', 'Situação atual', 'select', 'Pendente', [{value:'Pendente',label:'Pendente — ainda não confirmado'},{value:'Recebido',label:'Recebido — conferido'},{value:'Pago',label:'Pago — despesa liquidada'}]) + field('notes', 'Observação', 'textarea', '', null, true, 'Use Recebido/Pago somente após conferir a movimentação real.');
  } else if (type === 'appointment') {
    title = 'Novo compromisso'; eyebrow = 'AGENDA';
    html = field('title', 'Título', 'text', '') + field('type', 'Tipo', 'select', 'Mentoria', ['Mentoria','Atendimento','Vivência','Reunião','Outro'].map(v=>({value:v,label:v}))) + field('contactId', 'Contato', 'select', '', contactOptions) + field('start', 'Início', 'datetime-local', '') + field('end', 'Fim', 'datetime-local', '') + field('location', 'Local ou link', 'text', '') + field('status', 'Status', 'select', 'Agendado', ['Agendado','Confirmado','Concluída','Cancelada'].map(v=>({value:v,label:v}))) + field('notes', 'Nota operacional', 'textarea', '', null, true, 'Não registre conteúdo confidencial de sessão.');
  } else if (type === 'mentorship') {
    title = 'Nova jornada de mentoria'; eyebrow = 'ACOMPANHAMENTO';
    html = field('contactId', 'Mentorado', 'select', '', contactOptions) + field('productId', 'Programa', 'select', 'MENTORIA-DESENROLA-FACIL', productOptions) + field('startDate', 'Início', 'date', '') + field('endDate', 'Encerramento previsto', 'date', '') + field('status', 'Status', 'select', 'Onboarding pendente', ['Onboarding pendente','Ativa','Concluída','Pausada','Cancelada'].map(v=>({value:v,label:v}))) + field('nextSession', 'Próximo encontro', 'text', '') + field('operationalNote', 'Nota operacional', 'textarea', '', null, true, 'Somente marcos de entrega e suporte operacional; sem relatos íntimos.');
  } else if (type === 'product') {
    title = existing ? 'Editar oferta' : 'Nova oferta'; eyebrow = 'PORTFÓLIO';
    html = field('name', 'Nome da oferta', 'text', existing?.name || '') + field('price', 'Preço (R$)', 'number', existing ? (existing.priceCents / 100).toFixed(2) : '') + field('format', 'Formato', 'text', existing?.format || '') + field('modality', 'Modalidade / local', 'text', existing?.modality || '') + field('duration', 'Duração', 'text', existing?.duration || '') + field('active', 'Disponibilidade', 'select', existing?.active === false ? 'false' : 'true', [{value:'true',label:'Ativa / aberta'},{value:'false',label:'Inativa / indisponível'}]) + field('notes', 'Notas e campos ainda a definir', 'textarea', existing?.notes || '', null, true);
  } else if (type === 'integration') {
    title = 'Configuração futura'; eyebrow = 'SEM CONEXÃO';
    const item = data.integrations.find(x => x.id === id);
    html = `<div class="field full-width"><label>Integração</label><input value="${escapeHtml(item?.name || '')}" disabled></div>` + field('status', 'Estado documentado', 'select', item?.status || 'Não configurado', ['Manual','Não contratado','Não conectado','Não configurado','Planejada','Em avaliação','Em implementação'].map(v=>({value:v,label:v})), false, 'O estado “Conectada” só será aplicado após integração real e verificada.') + field('notes', 'Observação de configuração', 'textarea', item?.notes || '', null, true, 'Não inclua senhas, tokens, dados bancários ou chaves de API.');
  }
  $('#dialogTitle').textContent = title; $('#dialogEyebrow').textContent = eyebrow; $('#dialogFields').innerHTML = html; $('#recordForm').dataset.type = type;
  $('#recordDialog').showModal();
}
function findByType(type, id) {
  const list = type === 'contact' ? data.contacts : type === 'product' ? data.products : [];
  return list.find(x => x.id === id) || null;
}
function value(form, name) { return new FormData(form).get(name)?.toString().trim() || ''; }
function saveRecord(form) {
  const type = form.dataset.type; const get = key => value(form, key);
  if (type === 'contact') {
    if (!get('name')) throw new Error('Informe o nome do contato.');
    const record = { id: editingId || uid('PESSOA'), name: get('name'), profile: get('profile'), phone: get('phone'), email: get('email'), source: get('source'), stage: get('stage'), interestProductId: get('interestProductId'), nextActionDate: get('nextActionDate'), nextAction: get('nextAction'), notes: get('notes'), updatedAt: new Date().toISOString() };
    const index = data.contacts.findIndex(c => c.id === record.id); if (index >= 0) data.contacts[index] = { ...data.contacts[index], ...record }; else data.contacts.push({ ...record, createdAt: new Date().toISOString() });
  } else if (type === 'sale') {
    if (!get('contactId') || !get('productId') || cents(get('amount')) <= 0) throw new Error('Escolha cliente e oferta e informe um valor válido.');
    const sale = { id: uid('VENDA'), contactId: get('contactId'), productId: get('productId'), amountCents: cents(get('amount')), date: get('date') || today(), paymentMethod: get('paymentMethod'), status: 'Pendente', reference: get('reference'), createdAt: new Date().toISOString() };
    data.sales.push(sale);
    data.transactions.push({ id: uid('FIN'), kind: 'Receita', description: productName(sale.productId), category: 'Venda', amountCents: sale.amountCents, date: sale.date, paymentMethod: sale.paymentMethod, status: 'Pendente', saleId: sale.id, notes: sale.reference, createdAt: new Date().toISOString() });
  } else if (type === 'transaction') {
    if (!get('description') || cents(get('amount')) <= 0) throw new Error('Informe uma descrição e um valor válido.');
    const kind = get('kind'); let status = get('status');
    if (kind === 'Receita' && status === 'Pago') status = 'Pendente';
    if (kind === 'Despesa' && status === 'Recebido') status = 'Pendente';
    data.transactions.push({ id: uid('FIN'), kind, description: get('description'), category: get('category'), amountCents: cents(get('amount')), date: get('date') || today(), paymentMethod: get('paymentMethod'), status, notes: get('notes'), createdAt: new Date().toISOString() });
  } else if (type === 'appointment') {
    if (!get('title') || !get('start')) throw new Error('Informe título e início do compromisso.');
    data.appointments.push({ id: uid('AGENDA'), title: get('title'), type: get('type'), contactId: get('contactId'), start: get('start'), end: get('end'), location: get('location'), status: get('status'), notes: get('notes'), createdAt: new Date().toISOString() });
  } else if (type === 'mentorship') {
    if (!get('contactId') || !get('productId')) throw new Error('Selecione mentorado e programa.');
    const entry = { id: uid('JORNADA'), contactId: get('contactId'), productId: get('productId'), startDate: get('startDate'), endDate: get('endDate'), status: get('status'), nextSession: get('nextSession'), operationalNote: get('operationalNote'), createdAt: new Date().toISOString() };
    data.mentorships.push(entry);
    const person = data.contacts.find(c => c.id === entry.contactId); if (person) person.profile = 'Mentorado';
  } else if (type === 'product') {
    if (!get('name') || cents(get('price')) <= 0) throw new Error('Informe nome e preço válido.');
    const existing = data.products.find(p => p.id === editingId);
    const record = { id: editingId || uid('OFERTA'), name: get('name'), priceCents: cents(get('price')), currency: 'BRL', format: get('format'), modality: get('modality'), duration: get('duration'), active: get('active') === 'true', notes: get('notes'), updatedAt: new Date().toISOString(), priceHistory: existing?.priceHistory || [] };
    if (existing && existing.priceCents !== record.priceCents) record.priceHistory.push({ priceCents: existing.priceCents, changedAt: new Date().toISOString() });
    const index = data.products.findIndex(p => p.id === record.id); if (index >= 0) data.products[index] = record; else data.products.push(record);
  } else if (type === 'integration') {
    const item = data.integrations.find(x => x.id === editingId); if (!item) throw new Error('Integração não encontrada.');
    item.status = get('status'); item.notes = get('notes'); item.enabled = false; item.updatedAt = new Date().toISOString();
  }
  return persist();
}

async function confirmSale(id) {
  const sale = data.sales.find(s => s.id === id); if (!sale || sale.status !== 'Pendente') return;
  if (!confirm(`Você conferiu o recebimento de ${money(sale.amountCents)} de ${contactName(sale.contactId)}?`)) return;
  sale.status = 'Recebido'; sale.receivedAt = new Date().toISOString();
  const transaction = data.transactions.find(t => t.saleId === id); if (transaction) { transaction.status = 'Recebido'; transaction.confirmedAt = sale.receivedAt; }
  const person = data.contacts.find(c => c.id === sale.contactId); if (person) { person.profile = 'Cliente'; person.stage = 'Cliente ativo'; }
  if (String(sale.productId).includes('MENTORIA')) {
    const exists = data.mentorships.some(m => m.saleId === sale.id);
    if (!exists) data.mentorships.push({ id: uid('JORNADA'), saleId: sale.id, contactId: sale.contactId, productId: sale.productId, startDate: '', endDate: '', status: 'Onboarding pendente', nextSession: '', operationalNote: 'Inscrição confirmada; definir início da jornada.', createdAt: new Date().toISOString() });
  }
  if (await persist()) toast('Recebimento confirmado e registrado.');
}
async function confirmTransaction(id) {
  const tx = data.transactions.find(t => t.id === id); if (!tx || tx.status !== 'Pendente') return;
  const label = tx.kind === 'Receita' ? 'recebimento' : 'pagamento desta despesa';
  if (!confirm(`Confirma que conferiu ${label} de ${money(tx.amountCents)}?`)) return;
  tx.status = tx.kind === 'Receita' ? 'Recebido' : 'Pago'; tx.confirmedAt = new Date().toISOString();
  if (tx.saleId) { const sale = data.sales.find(s => s.id === tx.saleId); if (sale) { sale.status = 'Recebido'; sale.receivedAt = tx.confirmedAt; const person = data.contacts.find(c => c.id === sale.contactId); if (person) { person.profile = 'Cliente'; person.stage = 'Cliente ativo'; } } }
  if (await persist()) toast('Lançamento atualizado.');
}
function download(name, content, type) {
  const blob = new Blob([content], { type }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 500);
}
function exportBackup() { download(`desenrola-facil-backup-${today()}.json`, JSON.stringify(data, null, 2), 'application/json'); toast('Backup exportado. Guarde-o em local protegido.'); }
async function restoreBackup(file) {
  let imported;
  try { imported = JSON.parse(await file.text()); }
  catch { toast('O arquivo não contém JSON válido.'); return; }
  const required = ['organization', 'products', 'contacts', 'sales', 'transactions', 'mentorships', 'appointments', 'integrations'];
  if (!imported || required.some(key => !(key in imported)) || required.slice(1).some(key => !Array.isArray(imported[key]))) { toast('O arquivo não é um backup compatível.'); return; }
  if (!confirm('Importar este backup substituirá os dados atuais. Um backup dos dados atuais será baixado antes de continuar. Deseja prosseguir?')) return;
  exportBackup();
  data = imported;
  if (await persist()) toast('Backup restaurado.');
}
function exportCsv(kind) {
  const rows = kind === 'contacts' ? [['Nome','Perfil','Telefone','E-mail','Origem','Etapa','Próxima ação','Data'], ...data.contacts.map(c=>[c.name,c.profile,c.phone,c.email,c.source,c.stage,c.nextAction,c.nextActionDate])] : [['Data','Tipo','Descrição','Categoria','Forma','Valor (centavos)','Status'], ...data.transactions.map(t=>[t.date,t.kind,t.description,t.category,t.paymentMethod,t.amountCents,t.status])];
  const csv = '\ufeff' + rows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(';')).join('\r\n');
  download(`desenrola-facil-${kind}-${today()}.csv`, csv, 'text/csv;charset=utf-8');
}
function go(page) {
  if (!titles[page]) return;
  currentPage = page;
  $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  $$('.nav-item[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $('#pageTitle').textContent = titles[page];
  $('#pageEyebrow').textContent = page === 'dashboard' ? 'CENTRAL DE GESTÃO' : `DESENROLA FÁCIL® · ${titles[page].toUpperCase()}`;
  $('#quickAddButton').textContent = page === 'crm' ? '＋ Novo contato' : page === 'sales' ? '＋ Registrar venda' : page === 'finance' ? '＋ Lançamento' : page === 'agenda' ? '＋ Compromisso' : '＋ Novo contato';
}

$('#authForm').addEventListener('submit', async event => {
  event.preventDefault(); $('#authMessage').textContent = '';
  const password = $('#authPassword').value; const isSetup = event.currentTarget.dataset.mode === 'setup';
  if (isSetup && password !== $('#authConfirm').value) { $('#authMessage').textContent = 'As senhas não coincidem.'; return; }
  try { await api(isSetup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }); await loadApplication(); }
  catch (error) { $('#authMessage').textContent = error.message; }
});
$('#logoutButton').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }); data = null; $('#appShell').classList.add('hidden'); $('#authGate').classList.remove('hidden'); $('#authPassword').value = ''; start(); });
$('#mainNav').addEventListener('click', event => { const button = event.target.closest('[data-page]'); if (button) go(button.dataset.page); });
document.body.addEventListener('click', event => {
  const modal = event.target.closest('[data-modal]'); if (modal) return openModal(modal.dataset.modal);
  const goto = event.target.closest('[data-go]'); if (goto) return go(goto.dataset.go);
  const closer = event.target.closest('[data-close]'); if (closer) return $('#recordDialog').close();
  const action = event.target.closest('[data-action]'); if (!action) return;
  const { action: name, id } = action.dataset;
  if (name === 'confirm-sale') return confirmSale(id);
  if (name === 'confirm-transaction') return confirmTransaction(id);
  if (name === 'edit-contact') return openModal('contact', id);
  if (name === 'edit-product') return openModal('product', id);
  if (name === 'edit-integration') return openModal('integration', id);
});
$('#quickAddButton').addEventListener('click', () => openModal(currentPage === 'sales' ? 'sale' : currentPage === 'finance' ? 'transaction' : currentPage === 'agenda' ? 'appointment' : 'contact'));
$('#recordForm').addEventListener('submit', async event => {
  event.preventDefault();
  try { const success = await saveRecord(event.currentTarget); if (success) { $('#recordDialog').close(); event.currentTarget.reset(); editingId = null; toast('Registro salvo neste computador.'); } }
  catch (error) { $('#dialogMessage').textContent = error.message; }
});
$('#recordDialog').addEventListener('click', event => { if (event.target === $('#recordDialog')) $('#recordDialog').close(); });
$('#contactSearch').addEventListener('input', renderContacts); $('#contactFilter').addEventListener('change', renderContacts);
$('#salesSearch').addEventListener('input', renderSales); $('#salesFilter').addEventListener('change', renderSales); $('#transactionFilter').addEventListener('change', renderFinance);
$('#backupButton').addEventListener('click', exportBackup); $('#exportContacts').addEventListener('click', () => exportCsv('contacts')); $('#exportFinance').addEventListener('click', () => exportCsv('financeiro'));
$('#restoreButton').addEventListener('click', () => $('#restoreFile').click());
$('#restoreFile').addEventListener('change', event => { const file = event.target.files?.[0]; if (file) restoreBackup(file); event.target.value = ''; });
start();
