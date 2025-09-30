/* SPA estática para gestión de salones — JS puro, modular y comentado.
   Persistencia: IndexedDB (mejor para datos estructurados, transacciones y crecimiento que localStorage).
   Todo corre localmente (GitHub Pages compatible).
*/

// ===== Utilidades =====
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const fmtMoney = (n, c='es-ES', cur='EUR') => new Intl.NumberFormat(c, {style:'currency', currency:cur}).format(Number(n||0));
const fmtDate = (d) => new Date(d).toLocaleDateString('es-ES', {year:'numeric', month:'2-digit', day:'2-digit'});
const fmtTime = (d) => new Date(d).toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'});
const uid = (p='id') => `${p}_${Math.random().toString(36).slice(2,9)}${Date.now().toString(36).slice(-4)}`;
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const toast = (msg)=> {
  const t = document.createElement('div');
  t.className='toast';
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(()=>t.remove(), 3500);
};

const State = {
  currency: 'USD', // se ajusta desde Configuración
  theme: 'dark',
  workHours: { from: '09:00', to: '18:00', days:[1,2,3,4,5,6] }, // 1=Lunes..6=Sábado
};

// ===== IndexedDB Wrapper =====
const DB = (()=> {
  const name = 'salon_db';
  const version = 1;
  let db;

  function open(){
    return new Promise((resolve, reject)=>{
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = (e)=>{
        const db = e.target.result;
        // Tiendas por entidad
        const stores = ['clients','services','appointments','invoices','inventory','settings','counters'];
        stores.forEach(s=>{
          if(!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath:'id' });
        });
      };
      req.onsuccess = ()=>{ db = req.result; resolve(); };
      req.onerror = ()=>reject(req.error);
    });
  }

  function tx(store, mode='readonly'){
    return db.transaction(store, mode).objectStore(store);
  }

  const get = (store, id)=> new Promise((res,rej)=>{ const r=tx(store).get(id); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
  const all = (store)=> new Promise((res,rej)=>{ const r=tx(store).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); });
  const put = (store, obj)=> new Promise((res,rej)=>{ const r=tx(store,'readwrite').put(obj); r.onsuccess=()=>res(obj); r.onerror=()=>rej(r.error); });
  const del = (store, id)=> new Promise((res,rej)=>{ const r=tx(store,'readwrite').delete(id); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });

  return { open, get, all, put, del };
})();

// ===== Seed Demo =====
async function seedIfEmpty(){
  const clients = await DB.all('clients');
  if (clients.length) return;
  const now = Date.now();
  const demoClients = [
    {id:uid('cli'), name:'Ana Pérez', phone:'34600111222', email:'ana@example.com', notes:'Coloración habitual', history:[]},
    {id:uid('cli'), name:'Bruno García', phone:'34600999888', email:'bruno@example.com', notes:'Cabello rizado', history:[]},
  ];
  const demoServices = [
    {id:uid('srv'), name:'Corte', price:18, duration:30},
    {id:uid('srv'), name:'Color', price:35, duration:60},
    {id:uid('srv'), name:'Peinado', price:15, duration:30}
  ];
  const demoInventory = [
    {id:uid('inv'), name:'Tinte rubio', stock:6, min:3},
    {id:uid('inv'), name:'Champú profesional', stock:12, min:5}
  ];
  const appt1Start = new Date(new Date().setHours(10,0,0,0)).toISOString();
  const appt1End = new Date(new Date().setHours(10,30,0,0)).toISOString();
  const demoAppointments = [
    {id:uid('apt'), clientId:demoClients[0].id, services:[demoServices[0].id, demoServices[2].id], start:appt1Start, end:appt1End, note:'—', status:'confirmada'}
  ];
  const demoInvoices = [
    {id:uid('invx'), number:1, date:new Date().toISOString(), clientId:demoClients[0].id, items:[
      {serviceId: demoServices[0].id, name:'Corte', qty:1, price:18},
      {serviceId: demoServices[2].id, name:'Peinado', qty:1, price:15},
    ], tax:0.21, paid:true}
  ];
  const settings = {id:'app_settings', currency:'EUR', theme:'dark', logoDataUrl:'assets/logo.svg', workHours: State.workHours };

  for(const c of demoClients) await DB.put('clients', c);
  for(const s of demoServices) await DB.put('services', s);
  for(const p of demoInventory) await DB.put('inventory', p);
  for(const a of demoAppointments) await DB.put('appointments', a);
  for(const f of demoInvoices) await DB.put('invoices', f);
  await DB.put('counters', {id:'invoice', value:2});
  await DB.put('settings', settings);
}

// ===== Router mínimal =====
const Router = (()=> {
  const routes = {};
  function on(path, render){ routes[path]=render; }
  function go(path){ location.hash = path; }
  async function resolve(){
    const path = location.hash.replace('#','') || '/dashboard';
    const view = routes[path] || routes['/404'];
    await view?.();
    $('#sidebar a.active')?.classList.remove('active');
    $(`#sidebar a[href="#${path}"]`)?.classList.add('active');
    document.title = `Gestión de Salón — ${($('#sidebar a.active')?.textContent)||'App'}`;
    $('#app').focus();
  }
  window.addEventListener('hashchange', resolve);
  return { on, go, resolve };
})();

// ===== Calendario simple (mes/semana/día) =====
const Calendar = {
  current: new Date(),
  view: 'mes', // 'mes'|'semana'|'dia'
  range(){
    const d = new Date(this.current);
    if(this.view==='dia') return {start: new Date(d.setHours(0,0,0,0)), end:new Date(d.setHours(23,59,59,999))};
    if(this.view==='semana'){
      const day = (d.getDay()+6)%7; // lunes=0
      const start = new Date(d); start.setDate(d.getDate()-day); start.setHours(0,0,0,0);
      const end = new Date(start); end.setDate(start.getDate()+6); end.setHours(23,59,59,999);
      return {start, end};
    }
    // mes
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth()+1, 0, 23,59,59,999);
    return {start, end};
  },
  daysOfMonth(){
    const {start} = this.range();
    const firstWeekDay = (new Date(start).getDay()+6)%7; // lunes=0
    const daysInMonth = new Date(start.getFullYear(), start.getMonth()+1, 0).getDate();
    const cells = [];
    const totalCells = Math.ceil((firstWeekDay + daysInMonth)/7)*7;
    for(let i=0;i<totalCells;i++){
      const date = new Date(start);
      date.setDate(1 - firstWeekDay + i);
      cells.push(date);
    }
    return cells;
  }
};

// ===== Render helpers =====
function section(title, inner){
  return `<section class="card" aria-label="${title}"><h2>${title}</h2>${inner||''}</section>`;
}
function btn(label, cls='secondary', attrs=''){ return `<button class="${cls}" ${attrs}>${label}</button>`; }
function selectOptions(arr, getVal=(x=>x.id), getTxt=(x=>x.name), value=null){
  return arr.map(o=>`<option value="${getVal(o)}"${value==getVal(o)?' selected':''}>${getTxt(o)}</option>`).join('');
}

// ===== App Renderers =====
async function renderDashboard(){
  const [apts, invs, inv] = await Promise.all([DB.all('appointments'), DB.all('invoices'), DB.all('inventory')]);
  const now = new Date(); const weekEnd = new Date(); weekEnd.setDate(now.getDate()+7);
  const today = apts.filter(a=> new Date(a.start).toDateString()===now.toDateString()).sort((a,b)=>a.start.localeCompare(b.start));
  const thisWeek = apts.filter(a=> new Date(a.start)>=now && new Date(a.start)<=weekEnd).sort((a,b)=>a.start.localeCompare(b.start)).slice(0,8);
  const lowStock = inv.filter(p=> p.stock<=p.min);

  const html = `
    <div class="grid cols-3">
      <div class="kpi"><div class="kpi"><div>Hoy</div><b>${today.length}</b><div class="muted">Citas</div></div></div>
      <div class="kpi"><div class="kpi"><div>Semana</div><b>${thisWeek.length}</b><div class="muted">Citas próximas</div></div></div>
      <div class="kpi"><div class="kpi"><div>Stock bajo</div><b>${lowStock.length}</b><div class="muted">Productos</div></div></div>
    </div>
    <div class="grid cols-2" style="margin-top:1rem">
      ${section('Próximas citas (7 días)',
        thisWeek.length?`
          <table class="table" role="table">
            <thead><tr><th>Fecha</th><th>Cliente</th><th>Servicios</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              ${await Promise.all(thisWeek.map(async a=>{
                const c = await DB.get('clients', a.clientId); 
                return `<tr>
                  <td>${fmtDate(a.start)} ${fmtTime(a.start)}</td>
                  <td>${c?.name||'—'}</td>
                  <td>${(await servicesNames(a.services)).join(', ')}</td>
                  <td><span class="badge ${a.status==='cancelada'?'danger':a.status==='pendiente'?'warn':'ok'}">${a.status||'—'}</span></td>
                  <td><a class="link" href="#/citas" data-open="${a.id}">ver</a></td>
                </tr>`;})).then(x=>x.join(''))}
            </tbody>
          </table>` : emptyState('Sin citas próximas', 'Crear cita', 'btnNewAppt')
      )}
      ${section('Facturas recientes',
        invs.slice(-7).reverse().length?`
          <table class="table"><thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Importe</th><th>Estado</th></tr></thead>
          <tbody>
            ${await mapAsync(invs.slice(-7).reverse(), async f=>{
              const c = await DB.get('clients', f.clientId);
              const total = invoiceTotal(f);
              return `<tr><td>${f.number}</td><td>${fmtDate(f.date)}</td><td>${c?.name||'—'}</td><td>${fmtMoney(total, 'es-ES', State.currency)}</td><td>${f.paid?'<span class="badge ok">Pagada</span>':'<span class="badge warn">Pendiente</span>'}</td></tr>`;
            }).then(x=>x.join(''))}
          </tbody></table>` : emptyState('Aún no hay facturas', 'Nueva factura', 'btnNewInvoice')
      )}
    </div>
    ${section('Alertas de stock',
      lowStock.length?`
        <table class="table"><thead><tr><th>Producto</th><th>Stock</th><th>Mínimo</th></tr></thead>
        <tbody>${lowStock.map(p=>`<tr><td>${p.name}</td><td>${p.stock}</td><td>${p.min}</td></tr>`).join('')}</tbody></table>
      `: `<div class="badge ok">Todo OK</div>`
    )}
  `;
  $('#app').innerHTML = html;
}

function emptyState(text, cta, bindBtnId){
  const id = uid('tmpbtn');
  queueMicrotask(()=>{
    const btn = $(`#${id}`);
    if(btn && bindBtnId){
      btn.addEventListener('click', ()=>$('#'+bindBtnId).click());
    }
  });
  return `<div class="empty"><img src="assets/empty.svg" alt="">
    <p>${text}</p><button id="${id}" class="primary">${cta}</button></div>`;
}

async function servicesNames(ids){
  const all = await DB.all('services');
  return ids.map(id=> all.find(s=>s.id===id)?.name||'—');
}

async function mapAsync(arr, fn){ const out=[]; for(const el of arr){ out.push(await fn(el)); } return out; }

// ====== Vistas ======
Router.on('/dashboard', renderDashboard);

Router.on('/citas', async ()=>{
  const [apts, services, clients] = await Promise.all([DB.all('appointments'), DB.all('services'), DB.all('clients')]);
  const sMap = new Map(services.map(s=>[s.id, s]));
  const cMap = new Map(clients.map(c=>[c.id, c]));
  const {start, end} = Calendar.range();

  const list = apts.filter(a=> new Date(a.start)>=start && new Date(a.end)<=end)
    .sort((a,b)=> a.start.localeCompare(b.start));

  const controls = `
    <div class="toolbar">
      <div role="group" aria-label="Cambiar vista calendario">
        ${btn('Día', Calendar.view==='dia'?'primary':'secondary','data-cal="dia"')}
        ${btn('Semana', Calendar.view==='semana'?'primary':'secondary','data-cal="semana"')}
        ${btn('Mes', Calendar.view==='mes'?'primary':'secondary','data-cal="mes"')}
      </div>
      <div class="spacer"></div>
      ${btn('Hoy','secondary','data-cal="hoy"')}
      ${btn('Nueva cita','primary','id="createAppt"')}
    </div>`;

  let calendarHtml = '';
  if(Calendar.view==='mes'){
    const cells = Calendar.daysOfMonth();
    calendarHtml = `
      <div class="calendar card">
        <div class="cal-header"><h3>${Calendar.current.toLocaleDateString('es-ES',{month:'long', year:'numeric'})}</h3>
          <div class="spacer"></div>
          ${btn('◀','icon-btn','data-cal="prev"')} ${btn('▶','icon-btn','data-cal="next"')}
        </div>
        <div class="cal-grid">
          ${['L','M','X','J','V','S','D'].map(d=>`<div class="muted" style="text-align:center">${d}</div>`).join('')}
          ${cells.map(date=>{
            const dayApts = list.filter(a=> new Date(a.start).toDateString()===date.toDateString());
            const isToday = date.toDateString()===new Date().toDateString();
            return `<div class="cell ${isToday?'today':''}">
              <div class="date">${date.getDate()}</div>
              ${dayApts.map(a=>`<div class="event" data-open="${a.id}" title="${cMap.get(a.clientId)?.name||''}">
                ${(cMap.get(a.clientId)?.name||'—')} • ${new Date(a.start).toLocaleTimeString('es-ES',{hour:'2-digit', minute:'2-digit'})}
              </div>`).join('')}
            </div>`;
          }).join('')}
        </div>
      </div>`;
  } else {
    // Semana/Día listado simple
    calendarHtml = `
      <div class="card">
        <div class="cal-header"><h3>${Calendar.view==='dia'?'Hoy':'Semana'} ${Calendar.current.toLocaleDateString('es-ES')}</h3>
          <div class="spacer"></div>
          ${btn('◀','icon-btn','data-cal="prev"')} ${btn('▶','icon-btn','data-cal="next"')}
        </div>
        <table class="table"><thead><tr><th>Fecha</th><th>Cliente</th><th>Servicios</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${list.map(a=>`<tr>
            <td>${fmtDate(a.start)} ${fmtTime(a.start)}</td>
            <td>${cMap.get(a.clientId)?.name||'—'}</td>
            <td>${a.services.map(id=>sMap.get(id)?.name).join(', ')}</td>
            <td><span class="badge ${a.status==='cancelada'?'danger':a.status==='pendiente'?'warn':'ok'}">${a.status||'—'}</span></td>
            <td><button class="link" data-open="${a.id}">Editar</button></td>
          </tr>`).join('')}
        </tbody></table>
      </div>`;
  }

  $('#app').innerHTML = section('Citas', controls + calendarHtml + renderApptForm({services, clients}));
});

function renderApptForm({services, clients}, appt=null){
  const defaultStart = new Date(); defaultStart.setMinutes(0,0,0);
  const startIso = appt?.start || defaultStart.toISOString().slice(0,16);
  const endIso = appt?.end || new Date(defaultStart.getTime()+30*60000).toISOString().slice(0,16);
  const selectedServices = appt?.services || [];
  const clientId = appt?.clientId || '';
  const note = appt?.note||'';
  const status = appt?.status||'pendiente';

  return `
    <div class="card" aria-label="${appt?'Editar cita':'Nueva cita'}">
      <h3>${appt?'Editar cita':'Nueva cita'}</h3>
      <form id="formAppt" data-id="${appt?.id||''}">
        <div class="form-row cols-2">
          <div>
            <label for="apptClient">Cliente</label>
            <select id="apptClient" required>
              <option value="" disabled ${clientId?'':'selected'}>— seleccionar —</option>
              ${selectOptions(clients, c=>c.id, c=>c.name, clientId)}
            </select>
          </div>
          <div>
            <label for="apptStatus">Estado</label>
            <select id="apptStatus">
              <option value="pendiente" ${status==='pendiente'?'selected':''}>Pendiente</option>
              <option value="confirmada" ${status==='confirmada'?'selected':''}>Confirmada</option>
              <option value="cancelada" ${status==='cancelada'?'selected':''}>Cancelada</option>
            </select>
          </div>
        </div>
        <div class="form-row cols-2">
          <div>
            <label for="apptStart">Inicio</label>
            <input id="apptStart" type="datetime-local" required value="${startIso.slice(0,16)}" />
          </div>
          <div>
            <label for="apptEnd">Fin</label>
            <input id="apptEnd" type="datetime-local" required value="${endIso.slice(0,16)}" />
          </div>
        </div>
        <div>
          <label for="apptServices">Servicios (Ctrl/⌘ para multi)</label>
          <select id="apptServices" multiple size="4" required>
            ${selectOptions(services)}
          </select>
        </div>
        <div>
          <label for="apptNote">Notas</label>
          <textarea id="apptNote" rows="2" placeholder="Anotaciones…">${note}</textarea>
        </div>
        <div class="toolbar">
          <div class="spacer"></div>
          <a id="whatsLink" class="link" target="_blank" rel="noopener">Enviar WhatsApp</a>
          <a id="gcalLink" class="link" download="cita.ics">Añadir a Google/Calendario</a>
          ${appt?btn('Cancelar cita','link danger','id="cancelAppt"'):''}
          ${btn(appt?'Guardar cambios':'Crear cita','primary','id="saveAppt"')}
        </div>
      </form>
    </div>`;
}

Router.on('/clientes', async ()=>{
  const clients = await DB.all('clients');
  $('#app').innerHTML = `
    ${section('Clientes', `
      <div class="toolbar">
        <input id="clientSearch" class="search" placeholder="Buscar cliente por nombre o teléfono" />
        <div class="spacer"></div>
        ${btn('Nuevo cliente','primary','id="createClient"')}
      </div>
      ${clients.length?`
        <table class="table"><thead><tr><th>Nombre</th><th>Teléfono</th><th>Email</th><th>Notas</th><th></th></tr></thead>
        <tbody>${clients.map(c=>`<tr>
          <td>${c.name}</td><td>${c.phone||'—'}</td><td>${c.email||'—'}</td><td>${c.notes||'—'}</td>
          <td><button class="link" data-edit-client="${c.id}">Editar</button></td></tr>`).join('')}
        </tbody></table>` : emptyState('Sin clientes aún','Nuevo cliente','btnNewClient')
      }
      ${renderClientForm()}
    `)}
  `;
});

function renderClientForm(client=null){
  return `
    <div class="card">
      <h3>${client?'Editar cliente':'Nuevo cliente'}</h3>
      <form id="formClient" data-id="${client?.id||''}">
        <div class="form-row cols-2">
          <div><label>Nombre*</label><input id="cliName" required value="${client?.name||''}"></div>
          <div><label>Teléfono</label><input id="cliPhone" type="tel" pattern="[0-9+ ]{6,}" value="${client?.phone||''}"></div>
        </div>
        <div class="form-row cols-2">
          <div><label>Email</label><input id="cliEmail" type="email" value="${client?.email||''}"></div>
          <div><label>Notas</label><input id="cliNotes" value="${client?.notes||''}"></div>
        </div>
        <div class="toolbar">
          <div class="spacer"></div>
          ${client?btn('Eliminar','link danger','id="deleteClient"'):''}
          ${btn(client?'Guardar':'Agregar','primary','id="saveClient"')}
        </div>
      </form>
    </div>
  `;
}

Router.on('/servicios', async ()=>{
  const services = await DB.all('services');
  $('#app').innerHTML = `
    ${section('Servicios', `
      <div class="toolbar">
        <div class="spacer"></div>
        ${btn('Nuevo servicio','primary','id="createService"')}
      </div>
      ${services.length?`
        <table class="table"><thead><tr><th>Servicio</th><th>Duración</th><th>Precio</th><th></th></tr></thead>
        <tbody>${services.map(s=>`<tr>
          <td>${s.name}</td><td>${s.duration} min</td><td>${fmtMoney(s.price, 'es-ES', State.currency)}</td>
          <td><button class="link" data-edit-service="${s.id}">Editar</button></td></tr>`).join('')}
        </tbody></table>` : emptyState('Aún no hay servicios','Nuevo servicio','createService')
      }
      ${renderServiceForm()}
    `)}
  `;
});

function renderServiceForm(service=null){
  return `
    <div class="card">
      <h3>${service?'Editar servicio':'Nuevo servicio'}</h3>
      <form id="formService" data-id="${service?.id||''}">
        <div class="form-row cols-2">
          <div><label>Nombre*</label><input id="srvName" required value="${service?.name||''}"></div>
          <div><label>Duración (min)*</label><input id="srvDuration" type="number" min="5" max="480" required value="${service?.duration||30}"></div>
        </div>
        <div class="form-row cols-2">
          <div><label>Precio*</label><input id="srvPrice" type="number" step="0.01" min="0" required value="${service?.price||0}"></div>
        </div>
        <div class="toolbar">
          <div class="spacer"></div>
          ${service?btn('Eliminar','link danger','id="deleteService"'):''}
          ${btn(service?'Guardar':'Agregar','primary','id="saveService"')}
        </div>
      </form>
    </div>
  `;
}

Router.on('/facturas', async ()=>{
  const invs = await DB.all('invoices');
  $('#app').innerHTML = `
    ${section('Facturación', `
      <div class="toolbar">
        <div class="spacer"></div>
        ${btn('Nueva factura','primary','id="createInvoice"')}
      </div>
      ${invs.length?`
        <table class="table"><thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Subtotal</th><th>Imp.</th><th>Total</th><th>Estado</th><th></th></tr></thead>
        <tbody>${await mapAsync(invs.slice().sort((a,b)=>a.number-b.number), async f=>{
          const c = await DB.get('clients', f.clientId);
          const {subtotal, taxAmount, total} = invoiceTotals(f);
          return `<tr>
            <td>${f.number}</td><td>${fmtDate(f.date)}</td><td>${c?.name||'—'}</td>
            <td>${fmtMoney(subtotal,'es-ES', State.currency)}</td>
            <td>${fmtMoney(taxAmount,'es-ES', State.currency)}</td>
            <td>${fmtMoney(total,'es-ES', State.currency)}</td>
            <td>${f.paid?'<span class="badge ok">Pagada</span>':'<span class="badge warn">Pendiente</span>'}</td>
            <td><button class="link" data-edit-invoice="${f.id}">Abrir</button></td></tr>`;}).then(x=>x.join(''))}
        </tbody></table>` : emptyState('No hay facturas','Nueva factura','btnNewInvoice')
      }
      ${await renderInvoiceForm()}
    `)}
  `;
});

async function renderInvoiceForm(invoice=null){
  const clients = await DB.all('clients');
  const services = await DB.all('services');
  invoice = invoice || {id:'', number:'', date:new Date().toISOString(), clientId:'', items:[], tax:0.21, paid:false};
  const itemsHtml = (invoice.items.length?invoice.items:[{serviceId:'', qty:1, price:0}]).map((it, idx)=>`
    <tr>
      <td><select data-item="service" data-idx="${idx}">${selectOptions(services, s=>s.id, s=>s.name, it.serviceId)}</select></td>
      <td><input data-item="qty" data-idx="${idx}" type="number" min="1" value="${it.qty||1}"/></td>
      <td><input data-item="price" data-idx="${idx}" type="number" step="0.01" min="0" value="${it.price||0}"/></td>
      <td><button class="link danger" data-item="del" data-idx="${idx}">Quitar</button></td>
    </tr>`).join('');
  const {subtotal, taxAmount, total} = invoiceTotals(invoice);
  return `
    <div class="card">
      <h3>${invoice.id?'Editar factura':'Nueva factura'}</h3>
      <form id="formInvoice" data-id="${invoice.id||''}">
        <div class="form-row cols-2">
          <div><label>Cliente*</label>
            <select id="invClient" required>
              <option value="" disabled ${invoice.clientId?'':'selected'}>— seleccionar —</option>
              ${selectOptions(clients, c=>c.id, c=>c.name, invoice.clientId)}
            </select>
          </div>
          <div><label>Fecha</label><input id="invDate" type="date" value="${invoice.date.slice(0,10)}"></div>
        </div>
        <div class="toolbar"><b>Ítems</b> <div class="spacer"></div> ${btn('Agregar ítem','secondary','id="addItem"')}</div>
        <table class="table"><thead><tr><th>Servicio</th><th>Cant.</th><th>Precio</th><th></th></tr></thead>
        <tbody id="invItems">${itemsHtml}</tbody></table>
        <div class="form-row cols-2">
          <div><label>Impuesto (%)</label><input id="invTax" type="number" step="0.01" min="0" value="${(invoice.tax*100).toFixed(2)}"></div>
          <div style="align-self:end">
            <div>Subtotal: <b>${fmtMoney(subtotal,'es-ES', State.currency)}</b></div>
            <div>Imp.: <b>${fmtMoney(taxAmount,'es-ES', State.currency)}</b></div>
            <div>Total: <b>${fmtMoney(total,'es-ES', State.currency)}</b></div>
          </div>
        </div>
        <div class="toolbar">
          <label><input id="invPaid" type="checkbox" ${invoice.paid?'checked':''}/> Marcar pagado</label>
          <div class="spacer"></div>
          <button type="button" class="secondary" id="btnPrintInvoice">Exportar PDF</button>
          ${invoice.id?btn('Eliminar','link danger','id="deleteInvoice"'):''}
          ${btn(invoice.id?'Guardar':'Crear factura','primary','id="saveInvoice"')}
        </div>
      </form>
    </div>
  `;
}
function invoiceTotals(inv){ 
  const subtotal = inv.items.reduce((a,b)=>a+(Number(b.price||0)*Number(b.qty||1)),0);
  const taxAmount = subtotal * Number(inv.tax||0);
  return {subtotal, taxAmount, total: subtotal + taxAmount};
}
const invoiceTotal = (inv)=> invoiceTotals(inv).total;

Router.on('/inventario', async ()=>{
  const items = await DB.all('inventory');
  $('#app').innerHTML = `
    ${section('Inventario', `
      <div class="toolbar">
        <div class="spacer"></div>
        ${btn('Nuevo producto','primary','id="createStock"')}
      </div>
      ${items.length?`
        <table class="table"><thead><tr><th>Producto</th><th>Stock</th><th>Mínimo</th><th></th></tr></thead>
        <tbody>${items.map(p=>`<tr>
          <td>${p.name}</td><td>${p.stock} ${p.stock<=p.min?'<span class="badge warn">Bajo</span>':''}</td><td>${p.min}</td>
          <td><button class="link" data-edit-stock="${p.id}">Editar</button> <button class="link" data-stock-plus="${p.id}">+1</button> <button class="link" data-stock-minus="${p.id}">-1</button></td>
        </tr>`).join('')}</tbody></table>` : emptyState('Inventario vacío', 'Nuevo producto', 'createStock')
      }
      ${renderStockForm()}
    `)}
  `;
});

function renderStockForm(item=null){
  return `
    <div class="card">
      <h3>${item?'Editar producto':'Nuevo producto'}</h3>
      <form id="formStock" data-id="${item?.id||''}">
        <div class="form-row cols-2">
          <div><label>Nombre*</label><input id="stkName" required value="${item?.name||''}"></div>
          <div><label>Stock*</label><input id="stkStock" type="number" min="0" required value="${item?.stock??0}"></div>
        </div>
        <div class="form-row cols-2">
          <div><label>Mínimo*</label><input id="stkMin" type="number" min="0" required value="${item?.min??0}"></div>
        </div>
        <div class="toolbar"><div class="spacer"></div>
          ${item?btn('Eliminar','link danger','id="deleteStock"'):''}
          ${btn(item?'Guardar':'Agregar','primary','id="saveStock"')}
        </div>
      </form>
    </div>
  `;
}

Router.on('/config', async ()=>{
  const cfg = await DB.get('settings','app_settings') || {currency:State.currency, theme:State.theme, logoDataUrl:'assets/logo.svg', workHours:State.workHours};
  $('#app').innerHTML = `
    ${section('Configuración', `
      <form id="formConfig">
        <div class="form-row cols-2">
          <div><label>Logo (se guarda localmente)</label><input id="cfgLogo" type="file" accept="image/*"></div>
          <div><img id="cfgLogoPreview" src="${cfg.logoDataUrl||'assets/logo.svg'}" alt="Logo" style="height:64px; background:#0b1326; padding:.5rem; border-radius:.5rem; border:1px solid var(--border)"></div>
        </div>
        <div class="form-row cols-2">
          <div>
            <label>Tema</label>
            <select id="cfgTheme">
              <option value="dark" ${cfg.theme==='dark'?'selected':''}>Oscuro</option>
              <option value="light" ${cfg.theme==='light'?'selected':''}>Claro</option>
            </select>
          </div>
          <div>
            <label>Moneda</label>
            <select id="cfgCurrency">
              ${['USD','EUR','MXN','ARS','COP','CLP'].map(m=>`<option ${cfg.currency===m?'selected':''}>${m}</option>`).join('')}
            </select>
          </div>
        </div>
        <fieldset class="card" style="margin-top:1rem">
          <legend>Horarios laborales</legend>
          <div class="form-row cols-2">
            <div><label>Desde</label><input id="cfgFrom" type="time" value="${cfg.workHours?.from||'09:00'}"></div>
            <div><label>Hasta</label><input id="cfgTo" type="time" value="${cfg.workHours?.to||'18:00'}"></div>
          </div>
          <label>Días activos (1=Lun…7=Dom)</label>
          <input id="cfgDays" value="${(cfg.workHours?.days||[1,2,3,4,5,6]).join(',')}" pattern="^([1-7])(,([1-7]))*$" />
        </fieldset>
        <div class="toolbar">
          <div class="spacer"></div>
          <button class="primary" id="saveConfig">Guardar</button>
        </div>
      </form>
    `)}
  `;
});

Router.on('/respaldo', async ()=>{
  $('#app').innerHTML = `
    ${section('Respaldo', `
      <div class="toolbar">
        <button id="btnExport" class="secondary">Exportar JSON</button>
        <input id="fileImport" type="file" accept="application/json" style="display:none">
        <button id="btnImport" class="secondary">Importar JSON</button>
        <div class="spacer"></div>
        <span class="badge">Copia local, sin servidores</span>
      </div>
      <p>Incluye: clientes, servicios, citas, facturas, inventario, configuración.</p>
    `)}
  `;
});

// 404
Router.on('/404', async ()=>{ $('#app').innerHTML = section('No encontrado', '<p>Ruta no encontrada.</p>'); });

// ===== Eventos globales / acciones =====
document.addEventListener('DOMContentLoaded', async ()=>{
  await DB.open();
  await seedIfEmpty();
  await loadSettings();
  await Router.resolve();

  // UI global
  $('#menuToggle').addEventListener('click', ()=>{
    const sb = $('#sidebar'); const open = !sb.classList.contains('open'); sb.classList.toggle('open', open);
    $('#menuToggle').setAttribute('aria-expanded', String(open));
  });
  $$('#sidebar [data-route]').forEach(a=>a.addEventListener('click', ()=>$('#sidebar').classList.remove('open')));

  // Atajos
  window.addEventListener('keydown', (e)=>{
    if(e.key==='/'){ e.preventDefault(); $('#globalSearch').focus(); }
    if(e.key.toLowerCase()==='n'){ $('#btnNewAppt').click(); }
    if(e.key.toLowerCase()==='c'){ $('#btnNewClient').click(); }
    if(e.key.toLowerCase()==='f'){ $('#btnNewInvoice').click(); }
  });

  // Botones rápidos topbar
  $('#btnNewAppt').addEventListener('click', ()=>Router.go('/citas'));
  $('#btnNewClient').addEventListener('click', ()=>Router.go('/clientes'));
  $('#btnNewInvoice').addEventListener('click', ()=>Router.go('/facturas'));

  // Reset demo
  $('#btnResetDemo').addEventListener('click', async ()=>{
    if(!confirm('Restablecer datos de demostración? Se perderán datos actuales.')) return;
    const stores = ['clients','services','appointments','invoices','inventory','settings','counters'];
    for(const s of stores){
      const all = await DB.all(s);
      for(const row of all){ await DB.del(s, row.id); }
    }
    await seedIfEmpty();
    toast('Datos demo restaurados');
    Router.go('/dashboard'); Router.resolve();
  });

  // Búsqueda global
  $('#globalSearch').addEventListener('input', debounce(async (e)=>{
    const q = e.target.value.trim().toLowerCase();
    if(!q){ return; }
    const [clients, apts, invs] = await Promise.all([DB.all('clients'), DB.all('appointments'), DB.all('invoices')]);
    const cRes = clients.filter(c=>[c.name,c.phone,c.email].join(' ').toLowerCase().includes(q)).slice(0,5);
    const aRes = (await mapAsync(apts, async a=>({a, c: await DB.get('clients', a.clientId)}))).filter(x=>(x.c?.name||'').toLowerCase().includes(q)).slice(0,5);
    const iRes = (await mapAsync(invs, async f=>({f, c: await DB.get('clients', f.clientId)}))).filter(x=>(x.c?.name||'').toLowerCase().includes(q)).slice(0,5);
    const html = `
      ${section('Resultados', `
        <div class="card">
          <div><b>Clientes</b></div>
          ${cRes.map(c=>`<div><a class="link" href="#/clientes" data-edit-client="${c.id}">${c.name}</a></div>`).join('')||'<div class="muted">—</div>'}
          <div style="margin-top:.6rem"><b>Citas</b></div>
          ${aRes.map(x=>`<div><a class="link" href="#/citas" data-open="${x.a.id}">${x.c?.name} — ${fmtDate(x.a.start)} ${fmtTime(x.a.start)}</a></div>`).join('')||'<div class="muted">—</div>'}
          <div style="margin-top:.6rem"><b>Facturas</b></div>
          ${iRes.map(x=>`<div><a class="link" href="#/facturas" data-edit-invoice="${x.f.id}">#${x.f.number} — ${x.c?.name}</a></div>`).join('')||'<div class="muted">—</div>'}
        </div>
      `)}
    `;
    $('#app').innerHTML = html;
  }, 250));

  // Notificaciones locales de recordatorio (si el usuario lo permite)
  if('Notification' in window){
    if(Notification.permission==='default'){ /* pedir más tarde al crear cita */ }
    setInterval(checkUpcomingReminders, 60*1000);
  }

  // Registrar Service Worker (PWA)
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('service-worker.js').catch(()=>{});
  }
});

// Delegación de eventos por vista
document.addEventListener('click', async (e)=>{
  const t = e.target;

  // Navegación rápida desde tablas/calendario
  if(t.matches('[data-open]')){ e.preventDefault(); const id=t.getAttribute('data-open'); Router.go('/citas'); await sleep(50); openAppointment(id); }

  // Calendario: cambiar vista/fecha
  if(t.matches('[data-cal]')){
    const a = t.getAttribute('data-cal');
    if(a==='dia'||a==='semana'||a==='mes'){ Calendar.view=a; }
    if(a==='hoy'){ Calendar.current = new Date(); }
    if(a==='prev'){ if(Calendar.view==='mes') Calendar.current.setMonth(Calendar.current.getMonth()-1);
      else Calendar.current.setDate(Calendar.current.getDate() - (Calendar.view==='semana'?7:1)); }
    if(a==='next'){ if(Calendar.view==='mes') Calendar.current.setMonth(Calendar.current.getMonth()+1);
      else Calendar.current.setDate(Calendar.current.getDate() + (Calendar.view==='semana'?7:1)); }
    Router.resolve();
  }

  // Citas
  if(t.id==='createAppt'){ Router.go('/citas'); }
  if(t.id==='saveAppt'){ await saveAppointment(); }
  if(t.id==='cancelAppt'){ await cancelAppointment(); }

  // Clientes
  if(t.id==='createClient'){ Router.go('/clientes'); $('#formClient')?.reset(); }
  if(t.dataset.editClient){ const c = await DB.get('clients', t.dataset.editClient); $('#app').innerHTML = section('Clientes', renderClientForm(c)); }
  if(t.id==='saveClient'){ await saveClient(); }
  if(t.id==='deleteClient'){ await deleteClient(); }

  // Servicios
  if(t.id==='createService'){ $('#app').innerHTML = section('Servicios', renderServiceForm()); }
  if(t.dataset.editService){ const s = await DB.get('services', t.dataset.editService); $('#app').innerHTML = section('Servicios', renderServiceForm(s)); }
  if(t.id==='saveService'){ await saveService(); }
  if(t.id==='deleteService'){ await deleteService(); }

  // Facturas
  if(t.id==='createInvoice'){ $('#app').innerHTML = section('Facturación', await renderInvoiceForm()); }
  if(t.dataset.editInvoice){ const inv = await DB.get('invoices', t.dataset.editInvoice); $('#app').innerHTML = section('Facturación', await renderInvoiceForm(inv)); }
  if(t.id==='addItem'){ addInvoiceItem(); }
  if(t.dataset.item==='del'){ removeInvoiceItem(Number(t.dataset.idx)); }
  if(t.id==='saveInvoice'){ await saveInvoice(); }
  if(t.id==='deleteInvoice'){ await deleteInvoice(); }
  if(t.id==='btnPrintInvoice'){ printInvoice(); }

  // Inventario
  if(t.id==='createStock'){ $('#app').innerHTML = section('Inventario', renderStockForm()); }
  if(t.dataset.editStock){ const s = await DB.get('inventory', t.dataset.editStock); $('#app').innerHTML = section('Inventario', renderStockForm(s)); }
  if(t.id==='saveStock'){ await saveStock(); }
  if(t.id==='deleteStock'){ await deleteStock(); }
  if(t.dataset.stockPlus){ let p = await DB.get('inventory', t.dataset.stockPlus); p.stock++; await DB.put('inventory', p); Router.resolve(); }
  if(t.dataset.stockMinus){ let p = await DB.get('inventory', t.dataset.stockMinus); p.stock=Math.max(0,p.stock-1); await DB.put('inventory', p); Router.resolve(); }

  // Respaldo
  if(t.id==='btnExport'){ await exportJSON(); }
  if(t.id==='btnImport'){ $('#fileImport').click(); }

});

document.addEventListener('change', async (e)=>{
  const t = e.target;
  // Factura: ítems dinámicos
  if(t.matches('[data-item]')){
    const idx = Number(t.dataset.idx);
    if(t.dataset.item==='service'){
      const services = await DB.all('services');
      const s = services.find(s=>s.id===t.value);
      const row = t.closest('tr');
      row.querySelector('[data-item="price"]').value = s?.price||0;
    }
  }

  // Config: logo
  if(t.id==='cfgLogo'){
    const file = t.files?.[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=> $('#cfgLogoPreview').src = reader.result;
    reader.readAsDataURL(file);
  }
});

document.addEventListener('submit', (e)=>{
  // Evitar recargar por formularios
  e.preventDefault();
});

// Import JSON
$('#app').addEventListener('change', async (e)=>{
  if(e.target.id==='fileImport'){
    const file = e.target.files?.[0]; if(!file) return;
    const text = await file.text();
    try{
      const data = JSON.parse(text);
      const stores = ['clients','services','appointments','invoices','inventory','settings','counters'];
      for(const s of stores){
        const rows = data[s]||[];
        for(const r of rows){ await DB.put(s, r); }
      }
      toast('Importado correctamente');
      Router.resolve();
    }catch(err){ alert('Archivo inválido'); }
  }
});

// ===== Lógica de entidades =====
async function saveAppointment(){
  const f = $('#formAppt');
  const id = f.dataset.id || uid('apt');
  const clientId = $('#apptClient').value;
  const status = $('#apptStatus').value;
  const start = new Date($('#apptStart').value).toISOString();
  const end = new Date($('#apptEnd').value).toISOString();
  const note = $('#apptNote').value;
  const servicesSel = Array.from($('#apptServices').selectedOptions).map(o=>o.value);
  if(!clientId || !servicesSel.length){ alert('Cliente y servicios son requeridos'); return; }

  const appt = {id, clientId, services: servicesSel, start, end, note, status};
  await DB.put('appointments', appt);

  // Actualiza enlaces de WhatsApp y Calendario
  setupApptLinks(appt);

  // Pide permiso de notificación la primera vez
  if('Notification' in window && Notification.permission==='default'){
    Notification.requestPermission();
  }

  toast('Cita guardada');
  Router.resolve();
}

async function cancelAppointment(){
  const f = $('#formAppt'); const id = f.dataset.id;
  if(!id) return;
  const appt = await DB.get('appointments', id);
  appt.status = 'cancelada';
  await DB.put('appointments', appt);
  toast('Cita cancelada');
  Router.resolve();
}

async function openAppointment(id){
  const [services, clients, appt] = await Promise.all([DB.all('services'), DB.all('clients'), DB.get('appointments', id)]);
  const form = renderApptForm({services, clients}, appt);
  const wrap = document.createElement('div'); wrap.innerHTML = form;
  $('#app').appendChild(wrap.firstElementChild);
  setupApptLinks(appt);
}

function setupApptLinks(appt){
  const wa = $('#whatsLink'); const gcal = $('#gcalLink'); if(!wa||!gcal) return;
  DB.get('clients', appt.clientId).then(c=>{
    const date = new Date(appt.start);
    const end = new Date(appt.end);
    const msg = encodeURIComponent(`Hola ${c?.name||''}, confirmamos tu cita el ${fmtDate(date)} a las ${fmtTime(date)}.`);
    if(c?.phone) wa.href = `https://wa.me/${c.phone}?text=${msg}`; else wa.removeAttribute('href');
    // ICS simple
    const ics = [
      'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Salon SPA//ES',
      'BEGIN:VEVENT',
      `UID:${appt.id}`,
      `DTSTAMP:${toICS(new Date())}`,
      `DTSTART:${toICS(date)}`,
      `DTEND:${toICS(end)}`,
      `SUMMARY:Cita de salón`,
      `DESCRIPTION:${(appt.note||'')}`,
      'END:VEVENT','END:VCALENDAR'
    ].join('\r\n');
    const blob = new Blob([ics], {type:'text/calendar'});
    gcal.href = URL.createObjectURL(blob);
  });
}
const toICS = (d)=> d.toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';

// Clientes
async function saveClient(){
  const id = $('#formClient').dataset.id || uid('cli');
  const name = $('#cliName').value.trim();
  if(!name) return alert('Nombre requerido');
  const client = {
    id, name,
    phone: $('#cliPhone').value.trim(),
    email: $('#cliEmail').value.trim(),
    notes: $('#cliNotes').value.trim(),
    history: []
  };
  await DB.put('clients', client);
  toast('Cliente guardado');
  Router.go('/clientes'); Router.resolve();
}
async function deleteClient(){
  const id = $('#formClient').dataset.id;
  if(!id) return;
  if(!confirm('Eliminar cliente?')) return;
  await DB.del('clients', id);
  toast('Cliente eliminado');
  Router.resolve();
}

// Servicios
async function saveService(){
  const id = $('#formService').dataset.id || uid('srv');
  const name = $('#srvName').value.trim();
  const duration = Number($('#srvDuration').value);
  const price = Number($('#srvPrice').value);
  if(!name||!duration||price<0) return alert('Complete los campos correctamente');
  await DB.put('services', {id, name, duration, price});
  toast('Servicio guardado');
  Router.resolve();
}
async function deleteService(){
  const id = $('#formService').dataset.id;
  if(!id) return;
  if(!confirm('Eliminar servicio?')) return;
  await DB.del('services', id);
  toast('Servicio eliminado');
  Router.resolve();
}

// Facturas
function addInvoiceItem(){
  const tbody = $('#invItems');
  const idx = tbody.children.length;
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><select data-item="service" data-idx="${idx}"></select></td>
    <td><input data-item="qty" data-idx="${idx}" type="number" min="1" value="1"/></td>
    <td><input data-item="price" data-idx="${idx}" type="number" step="0.01" min="0" value="0"/></td>
    <td><button class="link danger" data-item="del" data-idx="${idx}">Quitar</button></td>`;
  tbody.appendChild(tr);
  DB.all('services').then(s=>{
    tr.querySelector('select').innerHTML = selectOptions(s);
  });
}
function removeInvoiceItem(idx){
  const row = $(`#invItems tr:nth-child(${idx+1})`); if(row) row.remove();
}
async function saveInvoice(){
  const id = $('#formInvoice').dataset.id || uid('inv');
  const num = await nextInvoiceNumber(id);
  const clientId = $('#invClient').value;
  if(!clientId) return alert('Seleccione cliente');
  const date = new Date($('#invDate').value||new Date()).toISOString();
  const items = Array.from($('#invItems tr')).map(tr=>{
    const serviceId = tr.querySelector('[data-item="service"]').value;
    const qty = Number(tr.querySelector('[data-item="qty"]').value)||1;
    const price = Number(tr.querySelector('[data-item="price"]').value)||0;
    const name = (async()=> (await DB.get('services', serviceId))?.name || 'Servicio')();
    return {serviceId, qty, price, namePending:true, namePromise:name};
  });
  // Resolver nombres
  const resolved = [];
  for(const it of items){ resolved.push({...it, name: await it.namePromise}); }
  const inv = {id, number:num, date, clientId, items: resolved.map(({namePending, namePromise, ...rest})=>rest), tax: Number($('#invTax').value)/100, paid: $('#invPaid').checked};
  await DB.put('invoices', inv);
  toast('Factura guardada');
  Router.resolve();
}
async function nextInvoiceNumber(existingId){
  // si edición, mantiene número
  if(existingId){
    const inv = await DB.get('invoices', existingId);
    if(inv?.number) return inv.number;
  }
  let ctr = await DB.get('counters','invoice');
  if(!ctr){ ctr = {id:'invoice', value:1}; }
  const n = ctr.value;
  ctr.value = n+1; await DB.put('counters', ctr);
  return n;
}
async function deleteInvoice(){
  const id = $('#formInvoice').dataset.id; if(!id) return;
  if(!confirm('Eliminar factura?')) return;
  await DB.del('invoices', id);
  toast('Factura eliminada');
  Router.resolve();
}
function printInvoice(){
  const form = $('#formInvoice');
  const id = form?.dataset.id || '(sin guardar)';
  const clientName = $('#invClient option:checked').textContent;
  const date = $('#invDate').value;
  const rows = Array.from($('#invItems tr')).map(tr=>({
    service: tr.querySelector('[data-item="service"] option:checked')?.textContent || '',
    qty: tr.querySelector('[data-item="qty"]').value,
    price: tr.querySelector('[data-item="price"]').value
  }));
  const tax = Number($('#invTax').value);
  const subtotal = rows.reduce((a,r)=>a+(Number(r.qty)*Number(r.price)),0);
  const taxAmt = subtotal * (tax/100);
  const total = subtotal + taxAmt;

  $('#printArea').innerHTML = `
    <section class="card">
      <h2>Factura #${id==='(sin guardar)'?'—':$('#formInvoice').dataset.id ? $('#formInvoice').dataset.id : '—'}</h2>
      <p><b>Cliente:</b> ${clientName} &nbsp; <b>Fecha:</b> ${date}</p>
      <table class="table"><thead><tr><th>Servicio</th><th>Cant.</th><th>Precio</th><th>Importe</th></tr></thead>
      <tbody>
        ${rows.map(r=>`<tr><td>${r.service}</td><td>${r.qty}</td><td>${fmtMoney(r.price,'es-ES', State.currency)}</td><td>${fmtMoney(Number(r.qty)*Number(r.price),'es-ES', State.currency)}</td></tr>`).join('')}
      </tbody></table>
      <p style="text-align:right">Subtotal: <b>${fmtMoney(subtotal,'es-ES', State.currency)}</b><br>
      Impuestos: <b>${fmtMoney(taxAmt,'es-ES', State.currency)}</b><br>
      Total: <b>${fmtMoney(total,'es-ES', State.currency)}</b></p>
    </section>`;
  window.print();
}

// Inventario
async function saveStock(){
  const id = $('#formStock').dataset.id || uid('stk');
  const name = $('#stkName').value.trim();
  const stock = Number($('#stkStock').value);
  const min = Number($('#stkMin').value);
  if(!name || stock<0 || min<0) return alert('Datos inválidos');
  await DB.put('inventory', {id, name, stock, min});
  toast('Producto guardado');
  Router.resolve();
}
async function deleteStock(){
  const id = $('#formStock').dataset.id; if(!id) return;
  if(!confirm('Eliminar producto?')) return;
  await DB.del('inventory', id);
  toast('Producto eliminado');
  Router.resolve();
}

// Config
async function loadSettings(){
  const s = await DB.get('settings','app_settings');
  if(!s) return;
  State.currency = s.currency||State.currency;
  State.theme = s.theme||State.theme;
  State.workHours = s.workHours||State.workHours;
  document.documentElement.dataset.theme = State.theme;
}
$('#app').addEventListener('click', async (e)=>{
  if(e.target.id==='saveConfig'){
    e.preventDefault();
    const logoInput = $('#cfgLogo');
    let logoDataUrl = $('#cfgLogoPreview').src;
    if(logoInput.files?.[0]){
      logoDataUrl = await fileToDataUrl(logoInput.files[0]);
    }
    const settings = {
      id:'app_settings',
      logoDataUrl,
      theme: $('#cfgTheme').value,
      currency: $('#cfgCurrency').value,
      workHours: {
        from: $('#cfgFrom').value,
        to: $('#cfgTo').value,
        days: $('#cfgDays').value.split(',').map(x=>Number(x)).filter(Boolean)
      }
    };
    await DB.put('settings', settings);
    await loadSettings();
    toast('Configuración guardada');
  }
});

// Respaldo
async function exportJSON(){
  const stores = ['clients','services','appointments','invoices','inventory','settings','counters'];
  const data = {};
  for(const s of stores){ data[s] = await DB.all(s); }
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `respaldo_salon_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

// ===== Recordatorios locales de citas (cada minuto) =====
async function checkUpcomingReminders(){
  if(Notification.permission!=='granted') return;
  const apts = await DB.all('appointments');
  const now = Date.now();
  const in15 = now + 15*60*1000;
  apts.filter(a=>a.status!=='cancelada').forEach(async a=>{
    const t = new Date(a.start).getTime();
    if(t>now && t<=in15 && !localStorage.getItem('rem_'+a.id)){
      const c = await DB.get('clients', a.clientId);
      new Notification('Cita próxima', { body: `${c?.name||'Cliente'} — ${fmtTime(a.start)}` });
      localStorage.setItem('rem_'+a.id, '1');
    }
  });
}

// ===== Helpers adicionales =====
function fileToDataUrl(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); }); }
function debounce(fn, wait=250){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; }

// ===== Inicio =====
// (todo se orquesta en DOMContentLoaded)
