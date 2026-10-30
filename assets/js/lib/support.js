// Support tickets UI shared by the passenger and driver apps.
import { t } from './i18n.js';
import { h, mount, dateTime, badge, field, select, toast } from './ui.js';
import { read, onChange } from './db.js';
import { openTicket, replyTicket } from './engine.js';
import { attempt } from './common.js';

export const CATEGORIES = ['DRIVER_COMPLAINT', 'CUSTOMER_COMPLAINT', 'PAYMENT_ISSUE', 'LOST_ITEM', 'TRIP_ISSUE', 'TECHNICAL_ISSUE', 'SAFETY_ISSUE'];
export const TICKET_KIND = { OPEN: 'warn', ASSIGNED: 'info', IN_PROGRESS: 'info', WAITING_USER: 'brand', RESOLVED: 'good', CLOSED: '' };

export function renderTickets(container, userKey, openerType, trips, preselectTrip = null) {
  let view = preselectTrip ? 'new' : 'list';
  let openId = null;
  const draw = () => {
    const mine = read('tickets').filter((x) => x.userKey === userKey).slice().reverse();
    if (view === 'new') {
      const cats = CATEGORIES.filter((c) => c !== (openerType === 'CUSTOMER' ? 'CUSTOMER_COMPLAINT' : 'DRIVER_COMPLAINT'));
      const cat = select(cats.map((c) => [c, t(`ticket.${c}`)]), preselectTrip ? 'TRIP_ISSUE' : cats[0]);
      const trip = select([['', '—'], ...trips.slice(-15).reverse().map((x) => [x.id, `${x.code} – ${dateTime(x.ts.requested)}`])], preselectTrip?.id ?? '');
      const subject = h('input', { class: 'input' });
      const text = h('textarea', { class: 'input' });
      mount(container,
        field(t('ticket.category'), cat), field(t('ticket.trip'), trip), field(t('ticket.subject'), subject), field(t('ticket.message'), text),
        h('div', { class: 'row' },
          h('button', { class: 'btn grow', onclick: () => { view = 'list'; draw(); } }, t('common.back')),
          h('button', { class: 'btn primary grow', onclick: () => attempt(() => {
            if (!subject.value.trim() || !text.value.trim()) { toast(t('err.fill_all'), 'error'); return; }
            const tk = openTicket(userKey, openerType, { category: cat.value, subject: subject.value.trim(), text: text.value.trim(), tripId: trip.value });
            toast(t('ticket.created', { code: tk.code }), 'good');
            view = 'thread'; openId = tk.id; draw();
          }) }, t('ticket.send'))));
      return;
    }
    if (view === 'thread') {
      const tk = read('tickets').find((x) => x.id === openId);
      const input = h('input', { class: 'input', placeholder: t('chat.placeholder') });
      const send = () => attempt(() => { if (input.value.trim()) { replyTicket(tk.id, openerType, input.value.trim()); } });
      input.addEventListener('keydown', (e) => e.key === 'Enter' && send());
      mount(container,
        h('div', { class: 'row between' }, h('b', {}, `${tk.code} – ${tk.subject}`), badge(t(`ticketStatus.${tk.status}`), TICKET_KIND[tk.status])),
        h('div', { class: 'chat', style: { maxHeight: '320px' } }, tk.messages.filter((m) => !m.internal).map((m) => h('div', { class: `bubble ${m.from === openerType ? 'me' : ''}` },
          m.text, h('div', {}, h('small', { style: { opacity: 0.75 } }, `${m.from === 'ADMIN' ? t('ticket.support_team') : ''} ${dateTime(m.ts)}`))))),
        tk.status !== 'CLOSED' ? h('div', { class: 'row' }, input, h('button', { class: 'btn primary', onclick: send }, t('chat.send'))) : h('small', { class: 'muted' }, t('ticket.closed')),
        h('button', { class: 'btn', onclick: () => { view = 'list'; draw(); } }, t('common.back')));
      return;
    }
    mount(container,
      h('button', { class: 'btn primary block', onclick: () => { view = 'new'; draw(); } }, '+ ', t('ticket.new')),
      mine.length ? h('div', { class: 'list' }, mine.map((tk) => h('button', { class: 'list-item', onclick: () => { view = 'thread'; openId = tk.id; draw(); } },
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, `${tk.code} – ${tk.subject}`), h('small', {}, `${t(`ticket.${tk.category}`)} – ${dateTime(tk.createdAt)}`)),
        badge(t(`ticketStatus.${tk.status}`), TICKET_KIND[tk.status])))) : h('p', { class: 'muted' }, t('ticket.none')));
  };
  draw();
  const off = onChange((tables) => { if (tables.includes('tickets') && view !== 'new') { if (!container.isConnected) off(); else draw(); } });
}
