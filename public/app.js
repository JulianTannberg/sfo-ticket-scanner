(()=>{'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>(Number(n||0)/100).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
const euro=s=>{s=String(s||'').trim();if(!/^(0|[1-9]\d{0,6})([,.]\d{1,2})?$/.test(s))throw Error('Euro-Betrag ungültig: '+s);const [a,b='']=s.replace(',','.').split('.');return Number(a)*100+Number(b.padEnd(2,'0'));};
const date=s=>s?new Date(s).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'–';
let orders=[],current=null,detector=null,cameraStream=null,frame=0,scanBusy=false,scanLast=0,selectedUrls=[],currentTab='orders';
let userRole='admin';
let cameraMode='assign';
let envelopeBatch=[],printPreviewIds=[],envelopeSelection=new Set();
const names={Kombi:'Kombi',Matrosen:'Matrosen',Seemann:'Seemann'};
function alertUser(message,type='warning'){$('systemAlert').textContent=message;$('systemAlert').className='alert '+type;}
function localState(message,type='warning'){$('detailState').textContent=message;$('detailState').style.color=type==='error'?'#f6a9a2':'#f4dfac';}
async function api(path,method='GET',body){
  const opt={method,credentials:'same-origin',headers:{'accept':'application/json'}};
  if(method!=='GET'){opt.headers['content-type']='application/json';opt.headers['x-sturmknoten']='1';opt.body=JSON.stringify(body||{});}
  let r;try{r=await fetch(path,opt)}catch{throw Error('Keine Verbindung zum Server. Bitte Internet prüfen.');}
  let json;try{json=await r.json()}catch{throw Error('Serverantwort unerwartet. Bitte Anmeldung und Verbindung prüfen.');}
  if(!r.ok)throw Error(json.error||'Fehler '+r.status);
  return json;
}
function showTab(tab){
  stopCamera();currentTab=tab;
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.tabcontent').forEach(e=>e.hidden=e.id!=='tab-'+tab);
}
async function overview(){
  const d=await api('/api/overview');
  $('countTickets').textContent=d.tickets.reduce((n,r)=>n+Number(r.count),0);
  $('countAssigned').textContent=d.tickets.filter(r=>r.status==='assigned').reduce((n,r)=>n+Number(r.count),0);
  $('countOrders').textContent=d.orders?.orders??0;
  $('countRevenue').textContent=fmt(d.orders?.paid_cents);
}
async function listOrders(){
  const q=$('searchOrders').value.trim();
  const d=await api('/api/orders?q='+encodeURIComponent(q));orders=d.orders||[];
  const area=$('orderList');area.replaceChildren();
  if(!orders.length){area.innerHTML='<p class="quiet">Noch keine passende Bestellung.</p>';return;}
  for(const o of orders){
    const btn=document.createElement('button');btn.type='button';btn.className='ordercard'+(current?.order.id===o.id?' selected':'');
    const expected=o.qty_kombi+o.qty_matrosen+o.qty_seemann;
    btn.innerHTML=`<strong>${esc(o.full_name)}${o.sales_channel==='internal_test'?' · 🧪 TEST':''}</strong><small>${esc(o.external_order_id||o.id.slice(0,8))} · ${date(o.created_at)}</small>
      <span class="tag ${o.payment_status==='paid'?'':'warn'}">${o.payment_status==='paid'?'Bezahlt':o.payment_status==='partial'?'Teilbezahlt':'Zahlung offen'}</span>
      <span class="tag ${o.shipping_status==='sent'?'':'warn'}">${o.shipping_status==='sent'?'Versendet':o.shipping_status==='ready'?'Versandbereit':'Offen'}</span>
      <small>${o.assigned_count}/${expected} QR zugeordnet · ${fmt(o.paid_amount_cents)} / ${fmt(o.total_amount_cents)}</small>`;
    btn.addEventListener('click',()=>selectOrder(o.id));area.append(btn);
  }
}
async function selectOrder(id){
  stopCamera();
  // Dedicated full page: no dashboard counters, menus, or long detail panel above scanning.
  if(!/^[a-f0-9-]{36}$/.test(id)){alertUser('Ungültige Bestellnummer.','error');return;}
  window.location.assign('/bestellung.html?id='+encodeURIComponent(id));
}
function renderOrder(){
  if(!current)return;
  const o=current.order,assigned={Kombi:0,Matrosen:0,Seemann:0};
  const ep=envelopeBatch.find(e=>e.id===o.id);
  const isDemo=o.sales_channel==='internal_test'&&o.internal_note==='SYSTEMTEST - keine echte Bestellung';
  const packReady=Boolean(ep?.packed_at);
  for(const t of current.tickets)assigned[t.ticket_type]++;
  const expected=o.qty_kombi+o.qty_matrosen+o.qty_seemann;
  const complete=assigned.Kombi===o.qty_kombi&&assigned.Matrosen===o.qty_matrosen&&assigned.Seemann===o.qty_seemann;
  const paid=o.payment_status==='paid';
  const sent=o.shipping_status==='sent';
  const address=[o.full_name,o.address_line1,o.address_line2,[o.postal_code,o.city].filter(Boolean).join(' ')].filter(Boolean);
  $('orderDetail').innerHTML=`
    <div class="summary"><div><strong>${esc(o.full_name)}${o.sales_channel==='internal_test'?' · 🧪 TEST':''}</strong><p class="quiet" style="white-space:pre-line">${esc(address.join('\n'))}</p></div>
      <div class="pill">${esc(o.external_order_id||o.id.slice(0,8))}</div></div>
    <div class="details"><div><small>Bestellung</small><strong>${o.qty_kombi} Kombi · ${o.qty_matrosen} Matrosen · ${o.qty_seemann} Seemann</strong></div>
      <div><small>QR-Codes zugeordnet</small><strong>${current.tickets.length} von ${expected}</strong></div>
      <div><small>Zahlung</small><strong>${fmt(o.paid_amount_cents)} / ${fmt(o.total_amount_cents)}</strong><small>${esc(o.payment_status)}</small></div>
      <div><small>Versand</small><strong>${o.shipping_status==='sent'?'Versendet':o.shipping_status==='ready'?'Versandbereit':'Offen'}</strong><small>${date(o.shipped_at)}</small></div>
      <div><small>Umschlag / Verpackung</small><strong>${ep?esc(isDemo&&ep.printed_at&&!ep.packed_at?'TEST: Umschlagdruck simuliert':envelopeStatus(ep)):'Packliste wird eingerichtet'}</strong></div></div>
      ${isDemo&&ep&&!ep.printed_at?'<div class="box"><p class="quiet">Nur für diesen Test: Du brauchst keinen echten Umschlag. Wir simulieren den Druckstatus.</p><button type="button" id="demoPrintBtn" class="secondary">TEST: Umschlagdruck simulieren</button></div>':''}
      ${ep&&ep.printed_at&&!ep.packed_at&&o.shipping_status!=='sent'?'<div class="box"><p class="quiet">Die richtigen Tickets sind '+(complete?'vollständig zugeordnet.':'noch nicht alle eingescannt.')+'</p><button type="button" id="packedDetailBtn" class="primary" '+(!envelopeDone(ep)?'disabled title="Zuerst alle Tickets einscannen"':'')+'>Vollständig verpackt bestätigen</button></div>':''}
      ${ep&&ep.packed_at?'<p class="hint">✓ Umschlag vollständig verpackt bestätigt.</p>':''}
    ${o.sales_channel==='internal_test'?'<div class="box"><p><strong>TESTBESTELLUNG.</strong> Diese Musteradresse ist erfunden. Ein hier zugeordnetes echtes Ticket ist bis zum Löschen vorübergehend nicht mehr frei. <strong>Vor dem Abschluss wieder löschen!</strong></p><button id="deleteTestOrderBtn" type="button" class="danger">Testbestellung löschen und Ticket freigeben</button></div>':''}
    <div class="flexactions"><button id="printEnvelope" class="secondary smallbtn" type="button">Briefumschlag drucken</button><button id="editCustomer" class="secondary smallbtn" type="button" ${sent?'disabled':''}>Anschrift korrigieren</button><button id="reopenOrders" type="button" class="secondary smallbtn">Liste aktualisieren</button></div>
    <hr class="separator"><h3>1. QR-Code vom gedruckten Ticket zuordnen</h3>
    <p class="quiet">Kombi ${assigned.Kombi}/${o.qty_kombi} · Matrosen ${assigned.Matrosen}/${o.qty_matrosen} · Seemann ${assigned.Seemann}/${o.qty_seemann}</p>
    ${sent?'<p class="hint">Bereits versendet: keine neue Zuordnung möglich.</p>':`<div class="camera" id="cameraWrap"><video id="cameraView" autoplay muted playsinline></video></div>
      <div class="flexactions"><button id="cameraToggle" type="button" class="secondary">Handykamera starten</button><label class="secondary smallbtn" for="qrPhoto" style="margin:0">QR-Foto auswählen</label><input id="qrPhoto" type="file" accept="image/*" style="position:absolute;left:-9999px"></div>
      <label for="assignCode">Oder Ticketkennung / vollständigen QR-Link eingeben</label>
      <div class="formgrid"><input id="assignCode" placeholder="https://sturmflutfestival.de/info/?t=…" autocapitalize="off" spellcheck="false"><button class="primary" type="button" id="assignNow">Ticket zuordnen</button></div>`}
    <div class="state" id="detailState" role="status">${complete?'Alle bestellten QR-Codes sind zugeordnet.':'Bitte gedruckte Tickets einscannen.'}</div>
    <ul class="ticketlist" id="assignedList">${current.tickets.map(t=>`<li><span><b>${esc(t.ticket_type)}</b><br><code>${esc(t.code)}</code></span>${o.shipping_status==='not_ready'?`<button class="danger smallbtn" type="button" data-unassign="${esc(t.code)}">Korrigieren</button>`:''}</li>`).join('')}</ul>
    <hr class="separator"><h3>2. Zahlung erfassen</h3>
    <form id="paymentForm"><div class="formgrid"><label>Betrag in €<input name="amount_eur" inputmode="decimal" required placeholder="z. B. 90,00"></label>
    <label>Zahlungsweg<select name="method"><option value="bank">Überweisung</option><option value="cash">Bar</option><option value="card">Karte</option><option value="other">Sonstiges</option></select></label></div>
    <div class="formgrid"><label>Art<select name="direction"><option value="received">Zahlung erhalten</option><option value="refunded">Erstattung</option></select></label>
    <label>Vermerk / Belegnummer<input name="reference" maxlength="100" placeholder="Optional"></label></div>
    <button class="secondary" type="submit">Zahlung speichern</button></form>
    <ul class="ticketlist">${current.payments.length?current.payments.map(p=>`<li><span>${date(p.occurred_at)} · ${esc(p.method)} ${esc(p.reference||'')}</span><strong>${p.direction==='received'?'+':'−'}${fmt(p.amount_cents)}</strong></li>`).join(''):'<li class="quiet">Noch keine Zahlungen dokumentiert.</li>'}</ul>
    <hr class="separator"><h3>3. Versand abschließen</h3>
    <p class="quiet">Freigabe erst nach vollständiger Zahlung, allen gescannten Tickets und bestätigter Verpackung.</p>
    <div class="flexactions"><button id="readyBtn" class="secondary" ${!complete||!paid||!packReady||sent?'disabled':''}>Als versandbereit markieren</button>
    <button id="sentBtn" class="primary" ${!complete||!paid||!packReady||sent?'disabled':''}>Als versendet bestätigen</button></div>
    ${o.internal_note?`<p class="quiet">Interne Notiz: ${esc(o.internal_note)}</p>`:''}`;
  $('printEnvelope').addEventListener('click',()=>printEnvelope(address));
  if($('deleteTestOrderBtn'))$('deleteTestOrderBtn').addEventListener('click',deleteTestOrder);
  if($('packedDetailBtn'))$('packedDetailBtn').addEventListener('click',()=>setEnvelopeStatus('packed',[o.id]));
  if($('demoPrintBtn'))$('demoPrintBtn').addEventListener('click',()=>setEnvelopeStatus('demo_printed',[o.id]));
  $('editCustomer').addEventListener('click',editCustomer);
  $('reopenOrders').addEventListener('click',()=>refreshCurrent());
  if(!sent){
    $('assignNow').addEventListener('click',assignManual);
    $('assignCode').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();assignManual();}});
    $('cameraToggle').addEventListener('click',toggleCamera);
    $('qrPhoto').addEventListener('change',async e=>{const file=e.target.files[0];if(file)await scanPhoto(file);e.target.value='';});
    document.querySelectorAll('[data-unassign]').forEach(b=>b.addEventListener('click',()=>unassign(b.dataset.unassign)));
  }
  $('paymentForm').addEventListener('submit',savePayment);
  $('readyBtn').addEventListener('click',()=>dispatch('ready'));
  $('sentBtn').addEventListener('click',()=>dispatch('sent'));
}
async function refreshCurrent(){if(!current)return;const id=current.order.id;current=await api('/api/orders/'+id);try{const p=await api('/api/envelopes');envelopeBatch=p.envelopes||[];}catch{}renderOrder();await Promise.all([listOrders(),overview()]);}
async function assignManual(){const code=$('assignCode').value.trim();if(!code){localState('Zuerst einen QR-Code scannen oder einfügen.','error');return;}await assign(code);}
async function assign(code){
  if(!current)return;stopCamera();
  const id=current.order.id;
  try{const updated=await api('/api/orders/'+id+'/assign','POST',{code});current=updated;
    try{const pack=await api('/api/envelopes');envelopeBatch=pack.envelopes||[];}catch{/* Show QR success even if packing data is temporarily unavailable. */}
    renderOrder();localState('Ticket erfolgreich zugeordnet. Wenn alle Mengen stimmen, die Verpackung bestätigen.');await Promise.all([listOrders(),overview()]);}
  catch(e){localState(e.message,'error');}
}
async function editCustomer(){
  if(!current)return;
  const o=current.order;
  const fieldNames=[['full_name','Name'],['address_line1','Straße/Hausnummer'],['address_line2','Adresszusatz'],['postal_code','PLZ'],['city','Ort'],['email','E-Mail'],['phone','Telefon']];
  const section=document.createElement('div');section.className='box';
  const h=document.createElement('h3');h.textContent='Lieferanschrift korrigieren';section.append(h);
  const form=document.createElement('form');form.id='editCustomerForm';
  for(const [name,label] of fieldNames){const l=document.createElement('label');l.textContent=label;const inp=document.createElement('input');inp.name=name;inp.value=o[name]||'';l.append(inp);form.append(l);}
  const button=document.createElement('button');button.className='secondary';button.type='submit';button.textContent='Änderungen speichern';form.append(button);section.append(form);
  $('orderDetail').insertBefore(section,$('orderDetail').querySelector('.separator'));
  $('editCustomer').disabled=true;
  form.addEventListener('submit',async e=>{e.preventDefault();button.disabled=true;
    const data=Object.fromEntries(new FormData(form));
    try{current=await api('/api/orders/'+o.id+'/customer','POST',data);renderOrder();localState('Anschrift wurde geändert.');await listOrders();}
    catch(err){localState(err.message,'error');button.disabled=false;}
  });
}
async function unassign(code){
  if(!confirm('Dieses Ticket wirklich von der Bestellung lösen? Der Vorgang wird protokolliert.'))return;
  try{current=await api('/api/orders/'+current.order.id+'/unassign','POST',{code});renderOrder();localState('Ticket-Zuordnung korrigiert.');await Promise.all([listOrders(),overview()]);}
  catch(e){localState(e.message,'error');}
}
async function savePayment(e){
  e.preventDefault();const form=e.currentTarget;
  let amount;try{amount=euro(new FormData(form).get('amount_eur'));if(!amount)throw Error('Betrag muss größer als 0 sein.');}
  catch(err){localState(err.message,'error');return;}
  const f=new FormData(form),id= form.dataset.pendingId || crypto.randomUUID();form.dataset.pendingId=id;
  const button=form.querySelector('button[type=submit]');button.disabled=true;
  try{current=await api('/api/orders/'+current.order.id+'/payment','POST',{idempotency_key:id,amount_cents:amount,method:f.get('method'),direction:f.get('direction'),reference:f.get('reference')});
    renderOrder();localState('Zahlung ist gespeichert und dem Käufer zugeordnet.');await Promise.all([listOrders(),overview()]);}
  catch(err){localState(err.message,'error');button.disabled=false;}
}
async function dispatch(status){
  if(!confirm(status==='sent'?'Sind Tickets und Umschlag wirklich versendet worden?':'Sind alle Tickets geprüft und die Sendung versandbereit?'))return;
  try{current=await api('/api/orders/'+current.order.id+'/dispatch','POST',{status});renderOrder();localState(status==='sent'?'Versand mit Datum dauerhaft gespeichert.':'Bestellung ist versandbereit.');await listOrders();}
  catch(e){localState(e.message,'error');}
}
function printPages(addresses){
  // Personal addresses are inserted exclusively with textContent.
  const sheet=$('printArea');sheet.replaceChildren();
  for(const lines of addresses){
    const page=document.createElement('div');page.className='envelope-page';
    const label=document.createElement('div');label.className='envelope-address';
    label.textContent=lines.filter(Boolean).join('\n');
    page.append(label);sheet.append(page);
  }
  window.print();
}
function printEnvelope(lines){
  if(!lines[0]||lines.length<3){localState('Anschrift unvollständig.','error');return;}
  printPages([lines]);
}
const envelopeLines=e=>[e.full_name,e.address_line1,e.address_line2,[e.postal_code,e.city].filter(Boolean).join(' ')].filter(Boolean);
function envelopeDone(e){return Number(e.scanned_kombi)===Number(e.qty_kombi)&&Number(e.scanned_matrosen)===Number(e.qty_matrosen)&&Number(e.scanned_seemann)===Number(e.qty_seemann)
  &&Number(e.qty_kombi)+Number(e.qty_matrosen)+Number(e.qty_seemann)>0;}
function envelopeStatus(e){
  if(e.shipping_status==='sent'||e.shipping_status==='handed_over')return 'Versendet';
  if(e.packed_at)return 'Verpackt · noch nicht versendet';
  if(e.printed_at)return 'Gedruckt · Tickets fehlen noch';
  return 'Nicht gedruckt';
}
async function loadEnvelopeBatch(){
  $('bulkState').textContent='Bestellungen werden geladen …';
  try{
    const data=await api('/api/envelopes');
    envelopeBatch=data.envelopes||[];
    printPreviewIds=[];envelopeSelection=new Set(envelopeBatch.filter(e=>!e.printed_at&&['not_ready','ready'].includes(e.shipping_status)).map(e=>e.id));
    renderEnvelopeQueue();
  }catch(e){
    $('bulkState').textContent='Packliste momentan nicht verfügbar: '+e.message;
    $('printAllEnvelopes').disabled=true;
    $('confirmEnvelopePrinted').disabled=true;
  }
}
function renderEnvelopeQueue(){
  const pending=envelopeBatch.filter(e=>!e.printed_at&&['not_ready','ready'].includes(e.shipping_status));
  const printed=envelopeBatch.filter(e=>e.printed_at&&!e.packed_at&&['not_ready','ready'].includes(e.shipping_status));
  const packed=envelopeBatch.filter(e=>e.packed_at&&['not_ready','ready'].includes(e.shipping_status));
  const shipped=envelopeBatch.filter(e=>e.shipping_status==='sent'||e.shipping_status==='handed_over');
  $('bulkState').textContent=pending.length+' nicht gedruckt · '+printed.length+' gedruckt · '+packed.length+' verpackt · '+shipped.length+' versendet';
  $('printAllEnvelopes').disabled=!pending.length||!pending.some(e=>envelopeSelection.has(e.id));
  $('selectPendingEnvelopes').disabled=!pending.length;
  $('clearEnvelopeSelection').disabled=!pending.length;
  $('confirmEnvelopePrinted').disabled=!printPreviewIds.length;
  const list=$('envelopeList');list.replaceChildren();
  if(!envelopeBatch.length){list.innerHTML='<p class="quiet">Noch keine Bestellungen vorhanden.</p>';return;}
  for(const e of envelopeBatch){
    const canPrint=!e.printed_at&&['not_ready','ready'].includes(e.shipping_status);
    const hasPrinted=!!e.printed_at, hasPacked=!!e.packed_at;
    const isActive=['not_ready','ready'].includes(e.shipping_status);
    const item=document.createElement('div');item.className='envelope-item';
    item.innerHTML=`<div class="summary">
      <div><strong>${esc(e.full_name)}</strong> <small>${esc(e.external_order_id||e.id.slice(0,8))}</small></div>
      <span class="tag ${hasPacked||e.shipping_status==='sent'?'':'warn'}">${esc(envelopeStatus(e))}</span>
      </div>
      <div class="quiet">Kombi ${Number(e.scanned_kombi)}/${Number(e.qty_kombi)} · Matrosen ${Number(e.scanned_matrosen)}/${Number(e.qty_matrosen)} · Seemann ${Number(e.scanned_seemann)}/${Number(e.qty_seemann)}</div>`;
    const actions=document.createElement('div');actions.className='flexactions';
    if(canPrint){
      const label=document.createElement('label');label.className='printselect';
      const cb=document.createElement('input');cb.type='checkbox';cb.checked=envelopeSelection.has(e.id);
      cb.addEventListener('change',()=>{
        if(cb.checked)envelopeSelection.add(e.id);else envelopeSelection.delete(e.id);
        $('printAllEnvelopes').disabled=!envelopeBatch.some(x=>!x.printed_at&&envelopeSelection.has(x.id));
      });
      label.append(cb,document.createTextNode(' Zum Druck / zur Druckbestätigung auswählen'));actions.append(label);
    }
    const open=document.createElement('button');open.type='button';open.className='secondary smallbtn';open.textContent='Bestellung öffnen';
    open.addEventListener('click',()=>selectOrder(e.id));actions.append(open);
    if(isActive&&hasPrinted&&!hasPacked){
      const undo=document.createElement('button');undo.type='button';undo.className='secondary smallbtn';undo.textContent='Druckstatus korrigieren';
      undo.addEventListener('click',()=>setEnvelopeStatus('unprinted',[e.id]));
      actions.append(undo);
      const pack=document.createElement('button');pack.type='button';pack.className='primary smallbtn';pack.textContent='Verpackt bestätigen';
      pack.disabled=!envelopeDone(e);
      pack.title=pack.disabled?'Zuerst alle gedruckten Tickets für diese Bestellung einscannen':'Umschlag ist vollständig';
      pack.addEventListener('click',()=>setEnvelopeStatus('packed',[e.id]));
      actions.append(pack);
    }else if(isActive&&hasPacked){
      const undo=document.createElement('button');undo.type='button';undo.className='secondary smallbtn';undo.textContent='Verpackung korrigieren';
      undo.addEventListener('click',()=>setEnvelopeStatus('unpacked',[e.id]));actions.append(undo);
    }
    item.append(actions);list.append(item);
  }
}
async function setEnvelopeStatus(action,ids){
  const questions={
    demo_printed:'Nur TEST: Soll der Druckstatus für Max Mustermann simuliert werden? Es wird nichts ausgedruckt und kein echtes Ticket verändert.',
    printed:'Hast du die ausgewählten Umschläge tatsächlich ausgedruckt und kontrolliert? Nur diese werden als gedruckt gespeichert.',
    unprinted:'Diesen Umschlag wieder als NICHT gedruckt markieren?',
    packed:'Sind die angezeigten Tickets vollständig im richtigen Umschlag? Dann als verpackt markieren.',
    unpacked:'Diesen Umschlag wieder als NICHT verpackt markieren?'
  };
  if(!confirm(questions[action]))return;
  try{
    const r=await api('/api/envelopes/status','POST',{action,ids});
    alertUser(r.changed+' Umschlag-Status geändert.','success');
    await Promise.all([loadEnvelopeBatch(),listOrders()]);
    if(current&&ids.includes(current.order.id)){current=await api('/api/orders/'+current.order.id);renderOrder();}
  }catch(e){alertUser('Status nicht gespeichert: '+e.message,'error');}
}
function printSelectedEnvelopes(){
  const selected=envelopeBatch.filter(e=>!e.printed_at&&envelopeSelection.has(e.id)&&['not_ready','ready'].includes(e.shipping_status));
  if(!selected.length)return;
  if(selected.some(e=>!e.full_name||!e.address_line1||!e.postal_code||!e.city)){
    $('bulkState').textContent='Mindestens eine Versandanschrift ist unvollständig. Bitte korrigieren.';return;
  }
  printPreviewIds=selected.map(e=>e.id);
  $('confirmEnvelopePrinted').disabled=false;
  printPages(selected.map(envelopeLines));
  $('bulkState').textContent=selected.length+' Umschläge im Druckauftrag. Nach dem Druck fehlende Umschläge abwählen und NUR tatsächlich gedruckte bestätigen.';
}
async function confirmPrintedEnvelopes(){
  const selected=printPreviewIds.filter(id=>envelopeSelection.has(id));
  if(!selected.length){$('bulkState').textContent='Kein Umschlag ausgewählt. Fehlende Umschläge bleiben offen.';return;}
  if(!confirm('Sind diese '+selected.length+' Umschläge WIRKLICH aus dem Drucker gekommen? Andere Umschläge bleiben offen.'))return;
  try{
    let changed=0;
    for(let i=0;i<selected.length;i+=100){
      const result=await api('/api/envelopes/status','POST',{action:'printed',ids:selected.slice(i,i+100)});
      changed+=result.changed;
    }
    alertUser(changed+' Umschläge als gedruckt bestätigt. Nicht gedruckte bleiben offen.','success');
    await loadEnvelopeBatch();
  }catch(e){alertUser('Nicht alle Druckbestätigungen abgeschlossen: '+e.message,'error');await loadEnvelopeBatch();}
}

function checkState(message,error=false){
  $('checkState').textContent=message;
  $('checkState').style.color=error?'#f6a9a2':'#c9efd9';
}
async function checkTicket(value){
  if(!String(value||'').trim()){checkState('Bitte zuerst einen QR-Code einlesen oder einfügen.',true);return;}
  checkState('Prüfe den Code …');
  try{
    const result=await api('/api/tickets/check','POST',{code:String(value)});
    if(!result.recognized){checkState(result.reason==='format'?'Kein gültiger Sturmflut-Ticketcode.':'Code nicht in den 700 importierten Tickets gefunden.',true);return;}
    const label=result.ticket_type||'Unbekannte Ticketart';
    const status=result.sales_point?'bei Verkaufsstelle '+result.sales_point:
      result.status==='available'?'noch keiner Bestellung zugeordnet':
      result.status==='assigned'?'bereits einer Bestellung zugeordnet':
      result.status==='blocked'?'gesperrt':'ungültig/storniert';
    checkState('Erkannt: '+label+' · '+status+'. Dieser Test hat nichts verändert.');
  }catch(e){checkState('Prüfung fehlgeschlagen: '+e.message,true);}
}
async function toggleCamera(mode='assign'){
  if(cameraStream){stopCamera();return;}
  cameraMode=mode;
  const check=mode==='check';
  if(!('BarcodeDetector' in window)){
    (check?checkState:localState)('Dieser Browser unterstützt die QR-Kameraerkennung nicht. Versuche das QR-Foto oder die manuelle Eingabe.',true);
    return;
  }
  try{
    const formats=await BarcodeDetector.getSupportedFormats();if(!formats.includes('qr_code'))throw Error('QR-Erkennung nicht unterstützt.');
    detector=new BarcodeDetector({formats:['qr_code']});
    cameraStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
    const video=$(check?'checkCameraView':'cameraView');video.srcObject=cameraStream;await video.play();
    $(check?'checkCameraWrap':'cameraWrap').classList.add('active');
    $(check?'checkCameraToggle':'cameraToggle').textContent='Kamera stoppen';
    scanBusy=false;scanLast=0;frame=requestAnimationFrame(scanLoop);
    if(check)checkState('QR-Code auf dem PC-Bildschirm in den Rahmen halten.');
    else localState('QR-Code vom gedruckten Ticket in den Rahmen halten.');
  }catch(e){
    stopCamera();
    if(check)checkState('Kamera nicht verfügbar: '+e.message,true);
    else localState('Kamera nicht verfügbar: '+e.message,'error');
  }
}
function stopCamera(){
  if(frame)cancelAnimationFrame(frame);frame=0;
  if(cameraStream){for(const track of cameraStream.getTracks())track.stop();cameraStream=null;}
  for(const id of ['cameraView','checkCameraView']){const v=$(id);if(v)v.srcObject=null;}
  for(const id of ['cameraWrap','checkCameraWrap']){const wrap=$(id);if(wrap)wrap.classList.remove('active');}
  if($('cameraToggle'))$('cameraToggle').textContent='Handykamera starten';
  if($('checkCameraToggle'))$('checkCameraToggle').textContent='Handykamera starten (nur prüfen)';
}
async function scanLoop(t){
  if(!cameraStream)return;frame=requestAnimationFrame(scanLoop);
  if(scanBusy||t-scanLast<230)return;
  const mode=cameraMode,video=$(mode==='check'?'checkCameraView':'cameraView');
  if(!video||video.readyState<2)return;
  scanBusy=true;scanLast=t;
  try{
    const result=await detector.detect(video);
    const found=result?.find(x=>x.rawValue)?.rawValue;
    if(found){stopCamera();if(mode==='check')await checkTicket(found);else await assign(found);}
  }catch(e){
    if(mode==='check')checkState('Scan fehlgeschlagen: '+e.message,true);
    else localState('Scan fehlgeschlagen: '+e.message,'error');
    stopCamera();
  }finally{scanBusy=false;}
}
async function scanPhoto(file,mode='assign'){
  const check=mode==='check';
  if(!('BarcodeDetector' in window)){
    if(check)checkState('QR-Fotoerkennung von diesem Browser nicht unterstützt.',true);
    else localState('QR-Fotoerkennung von diesem Browser nicht unterstützt.','error');
    return;
  }
  try{
    const detector=new BarcodeDetector({formats:['qr_code']});
    const bitmap=await createImageBitmap(file);
    let results;
    try{results=await detector.detect(bitmap);}finally{bitmap.close();}
    if(results.length&&results[0].rawValue){
      if(check)await checkTicket(results[0].rawValue);
      else await assign(results[0].rawValue);
    }else if(check)checkState('Auf dem Bild wurde kein QR-Code erkannt.',true);
    else localState('Auf dem Bild wurde kein QR-Code gefunden.','error');
  }catch(e){
    if(check)checkState('Bild konnte nicht verarbeitet werden: '+e.message,true);
    else localState('Bild konnte nicht verarbeitet werden: '+e.message,'error');
  }
}
async function createTestOrder(){
  const btn=$('createTestOrderBtn');
  btn.disabled=true;
  try{
    const result=await api('/api/test-order','POST',{});
    current=result;
    $('searchOrders').value='';
    await selectOrder(result.order.id);
  }catch(e){alertUser('Testbestellung nicht angelegt: '+e.message,'error');}
  finally{btn.disabled=false;}
}
async function deleteTestOrder(){
  if(!current||current.order.sales_channel!=='internal_test')return;
  const id=current.order.id,count=current.tickets.length;
  if(!confirm('Testbestellung von Max Mustermann wirklich LÖSCHEN? '+count+' zugeordnete Tickets werden wieder freigegeben. Das hat KEINEN Einfluss auf deren Gültigkeit am Einlass.'))return;
  const btn=$('deleteTestOrderBtn');if(btn)btn.disabled=true;
  try{
    const result=await api('/api/test-order/delete','POST',{order_id:id});
    current=null;
    $('orderDetail').innerHTML='<p class="quiet">Testbestellung gelöscht. Die Ticketcodes bleiben in der Datenbank erhalten.</p>';
    await Promise.all([listOrders(),overview()]);
    alertUser('Testbestellung gelöscht. '+result.released+' Tickets wieder freigegeben.','success');
  }catch(e){alertUser('Löschen nicht bestätigt: '+e.message,'error');if(btn)btn.disabled=false;}
}
async function createOrder(e){
  e.preventDefault();const form=e.currentTarget;const f=new FormData(form);let data;
  try{data={};for(const [key,val]of f)data[key]=String(val).trim();
    data.qty_kombi=Number(data.qty_kombi);data.qty_matrosen=Number(data.qty_matrosen);data.qty_seemann=Number(data.qty_seemann);
    data.total_amount_cents=euro(data.total_eur);data.postage_cents=euro(data.postage_eur);
    if(data.qty_kombi+data.qty_matrosen+data.qty_seemann<1)throw Error('Mindestens ein Ticket auswählen.');
  }catch(err){alertUser(err.message,'error');return;}
  const btn=$('createOrderBtn');btn.disabled=true;
  try{const result=await api('/api/orders','POST',data);form.reset();
    alertUser('Bestellung gespeichert.','success');await selectOrder(result.order.id);}
  catch(err){alertUser(err.message,'error');}finally{btn.disabled=false;}
}
function csvUrls(text){
  const all=text.match(/https:\/\/sturmflutfestival\.de\/info\/\?t=[A-Za-z0-9]+/g)||[];
  return [...new Set(all)];
}
async function chooseCsv(e){selectedUrls=[];$('importBtn').disabled=true;
  const file=e.target.files[0];if(!file)return;
  if(file.size>3000000){$('importState').textContent='Datei zu groß.';return;}
  const text=await file.text();const list=csvUrls(text);
  selectedUrls=list;$('importBtn').disabled=!list.length;
  $('importState').textContent=list.length?`${list.length} unterschiedliche QR-Links gefunden. Bitte mit der Masterliste vergleichen, bevor du importierst.`:'Keine passenden QR-Links gefunden. Bitte die Original-CSV verwenden.';
}
async function importCsv(){if(!selectedUrls.length)return;const btn=$('importBtn');btn.disabled=true;
  let added=0;
  try{for(let i=0;i<selectedUrls.length;i+=100){
    const b=selectedUrls.slice(i,i+100);const r=await api('/api/tickets/import','POST',{urls:b});added+=r.added;
    $('importState').textContent=`${Math.min(i+100,selectedUrls.length)} von ${selectedUrls.length} verarbeitet · ${added} neu angelegt · Gesamtbestand ${r.total}`;
  }selectedUrls=[];await overview();alertUser('Ticketimport abgeschlossen. Bitte Bestandszahl und echten QR-Code prüfen.','success');}
  catch(e){$('importState').textContent=`Import unterbrochen: ${e.message}. Bereits importierte Codes werden beim erneuten Versuch nicht doppelt angelegt.`;btn.disabled=false;}
}
async function init(){
  document.querySelectorAll('[data-tab]').forEach(el=>el.addEventListener('click',()=>showTab(el.dataset.tab)));
  $('newOrderForm').addEventListener('submit',createOrder);
  $('createTestOrderBtn').addEventListener('click',createTestOrder);
  $('checkNow').addEventListener('click',()=>checkTicket($('checkCodeInput').value.trim()));
  $('checkCodeInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();checkTicket(e.currentTarget.value.trim());}});
  $('checkCameraToggle').addEventListener('click',()=>toggleCamera('check'));
  $('checkQrPhoto').addEventListener('change',async e=>{const file=e.target.files[0];if(file)await scanPhoto(file,'check');e.target.value='';});
  $('sampleEnvelopeBtn').addEventListener('click',()=>printEnvelope(['Max Mustermann','Musterstraße 12','12345 Musterstadt']));
  $('checkEnvelopes').addEventListener('click',loadEnvelopeBatch);
  $('printAllEnvelopes').addEventListener('click',printSelectedEnvelopes);
  $('confirmEnvelopePrinted').addEventListener('click',confirmPrintedEnvelopes);
  $('selectPendingEnvelopes').addEventListener('click',()=>{envelopeSelection=new Set(envelopeBatch.filter(e=>!e.printed_at&&['not_ready','ready'].includes(e.shipping_status)).map(e=>e.id));renderEnvelopeQueue();});
  $('clearEnvelopeSelection').addEventListener('click',()=>{envelopeSelection.clear();renderEnvelopeQueue();});
  $('printThreeSamples').addEventListener('click',()=>printPages([
    ['Max Mustermann','Musterstraße 12','12345 Musterstadt'],
    ['Erika Beispiel','Beispielweg 4','23456 Beispielort'],
    ['Alex Demokunde','Probegasse 8','34567 Testhausen']
  ]));
  $('qrCsv').addEventListener('change',chooseCsv);
  $('importBtn').addEventListener('click',importCsv);
  let timer; $('searchOrders').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>listOrders().catch(err=>alertUser(err.message,'error')),350);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera();});window.addEventListener('pagehide',stopCamera);
  try{const who=await api('/api/me');
    userRole=who.role||'admin';
    if(userRole==='dispatch'){
      document.querySelector('.overview').classList.add('dispatch-overview');
      document.querySelectorAll('.overview>div').forEach((box,i)=>{if(i<2)box.hidden=true;});
      for(const tab of ['import','check'])document.querySelector('[data-tab="'+tab+'"]').hidden=true;
      const demoArea=$('createTestOrderBtn')?.closest('.box');
      if(demoArea)demoArea.hidden=true;
      document.querySelector('.header h1').textContent='Ticketversand & Einnahmen';
      document.querySelector('.header p').textContent='Bestellungen · CSV-Übernahme · Umschläge · QR-Codes';
      document.querySelector('.smalltag').textContent='Versandzugang';
      alertUser('Geschützt angemeldet · Versandzugang','success');
    }else{
      alertUser('Geschützt angemeldet · Administration','success');
    }
    $('mainApp').hidden=false;
    await Promise.all([overview(),listOrders()]);}
  catch(e){alertUser('Verwaltung noch nicht freigeschaltet: '+e.message+' Bitte keine echten Kundendaten eingeben.','error');}
}
init();
})();