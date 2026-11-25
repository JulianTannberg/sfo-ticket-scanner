(()=>{'use strict';
const $=id=>document.getElementById(id);
const fmt=n=>(Number(n||0)/100).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
const euro=s=>{s=String(s||'').trim();if(!/^(0|[1-9]\\d{0,6})([,.]\\d{1,2})?$/.test(s))throw Error('Bitte gültigen Eurobetrag eingeben.');const [a,b='']=s.replace(',','.').split('.');return Number(a)*100+Number(b.padEnd(2,'0'));};
const uuid=/^[a-f0-9-]{36}$/;
const id=new URLSearchParams(location.search).get('id');
let record=null,envelope=null,stream=null,detector=null,animation=0,busy=false,lastScan=0;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
async function api(path,method='GET',body){
  const opt={method,credentials:'same-origin',headers:{accept:'application/json'}};
  if(method!=='GET'){opt.headers['content-type']='application/json';opt.headers['x-sturmknoten']='1';opt.body=JSON.stringify(body||{});}
  let r;try{r=await fetch(path,opt)}catch{throw Error('Keine Verbindung. Bitte Internet prüfen.');}
  let val;try{val=await r.json()}catch{throw Error('Unerwartete Serverantwort. Bitte Anmeldung prüfen.');}
  if(!r.ok)throw Error(val.error||'Fehler '+r.status);
  return val;
}
function message(str,kind='ok'){
  const node=$('pageStatus');node.textContent=str;
  node.className='alert '+(kind==='error'?'error':'success');
  node.hidden=false;
}
function scanMessage(str,kind='ok'){
  const node=$('scanFeedback');node.textContent=str;
  node.className='state '+(kind==='error'?'pack-error':'pack-good');
}
function statusName(s){
  return ({not_ready:'Offen',ready:'Versandbereit',sent:'Versendet',handed_over:'Übergeben',cancelled:'Storniert'})[s]||s;
}
function lines(o){return [o.full_name,o.address_line1,o.address_line2,[o.postal_code,o.city].filter(Boolean).join(' ')].filter(Boolean);}
function isDemo(o){return o.sales_channel==='internal_test'&&o.internal_note==='SYSTEMTEST - keine echte Bestellung';}
function counts(o,tickets){
  const expected={Kombi:Number(o.qty_kombi),Matrosen:Number(o.qty_matrosen),Seemann:Number(o.qty_seemann)};
  const actual={Kombi:0,Matrosen:0,Seemann:0};
  for(const t of tickets){if(actual[t.ticket_type]!==undefined)actual[t.ticket_type]++;}
  const total=Object.values(expected).reduce((a,b)=>a+b,0);
  const done=Object.values(actual).reduce((a,b)=>a+b,0);
  const complete=total>0&&Object.keys(expected).every(k=>expected[k]===actual[k]);
  return {expected,actual,total,done,complete};
}
async function reload(showStatus=false){
  if(!uuid.test(id||'')){message('Diese Bestelladresse ist ungültig. Bitte über die Bestellliste öffnen.','error');return;}
  try{
    const [order,pack]=await Promise.all([api('/api/orders/'+id),api('/api/envelopes')]);
    record=order;
    envelope=(pack.envelopes||[]).find(e=>e.id===id)||null;

    render();
    $('orderView').hidden=false;
    if(showStatus)message('Bestellung aktualisiert.');
    else $('pageStatus').hidden=true;
  }catch(e){message('Bestellung konnte nicht geladen werden: '+e.message,'error');}
}
function render(){
  if(!record)return;
  const o=record.order,c=counts(o,record.tickets),printed=Boolean(envelope?.printed_at),packed=Boolean(envelope?.packed_at);
  const sent=['sent','handed_over','cancelled'].includes(o.shipping_status),demo=isDemo(o);
  $('buyerName').textContent=o.full_name;
  $('orderBadge').hidden=!demo;
  $('orderBadge').textContent='TEST';
  $('orderReference').textContent=o.external_order_id||'Bestellung '+o.id.slice(0,8);
  const target=$('ticketCounts');target.replaceChildren();
  for(const k of ['Kombi','Matrosen','Seemann']){
    if(!c.expected[k])continue;
    const row=el('div','pack-ticket-row');
    const title=el('span','pack-ticket-title',k);
    const qty=el('strong',c.actual[k]===c.expected[k]?'pack-counter complete':'pack-counter',c.actual[k]+' / '+c.expected[k]);
    row.append(title,qty);target.append(row);
  }
  $('scanSummary').textContent=c.complete?'✓ Alle '+c.total+' Tickets vollständig zugeordnet':c.done+' von '+c.total+' Tickets zugeordnet';
  $('scanSummary').className='pack-summary '+(c.complete?'pack-done':'');
  $('assignedLabel').textContent='('+record.tickets.length+')';
  const list=$('assignedTickets');list.replaceChildren();
  for(const t of record.tickets){
    const item=el('li');const content=el('span');
    content.append(el('strong','',t.ticket_type),el('br'),el('code','',t.code));
    item.append(content);
    if(!sent&&!packed){
      const b=el('button','danger smallbtn','Korrigieren');b.type='button';b.addEventListener('click',()=>unassign(t.code));
      item.append(b);
    }
    list.append(item);
  }
  const eligible=o.payment_status==='paid'||demo;
  const canAssign=eligible&&!sent&&!packed&&!c.complete;
  $('startScan').disabled=!canAssign;
  $('orderQrPhoto').disabled=!canAssign;
  $('manualAssign').disabled=!canAssign;
  $('manualCode').disabled=!canAssign;
  $('packStatus').textContent=packed?'✓ Vollständig verpackt':printed?(demo?'TEST: Druck simuliert · noch nicht verpackt':'Umschlag gedruckt · noch nicht verpackt'):'Umschlag noch nicht gedruckt';
  $('packStatus').className='pack-summary '+(packed?'pack-done':'');
  $('confirmPrint').hidden=demo||printed||sent||!eligible;$('printOne').disabled=!eligible||sent;
  $('demoPrint').hidden=!demo||printed||sent;
  $('confirmPacked').hidden=packed||sent;
  $('confirmPacked').disabled=!eligible||!printed||!c.complete||sent;
  $('undoPacked').hidden=!packed||sent;
  $('packHint').textContent=packed?'Fertig. Die Packliste hat die Verpackung gespeichert.':!printed?'Zuerst den Umschlagdruck bestätigen.':!c.complete?'Es fehlen noch Tickets. Bitte die richtige Ticketart einscannen.':'Alle Tickets stimmen. Jetzt die Verpackung bestätigen.';
  $('shippingAddress').textContent=lines(o).join('\n');
  const f=$('addressForm');for(const key of ['full_name','address_line1','address_line2','postal_code','city','email','phone'])f.elements[key].value=o[key]||'';
  const addressInputs=f.querySelectorAll('input');for(const field of addressInputs)field.disabled=sent;
  f.querySelector('button[type=submit]').disabled=sent;
  const labels={unchecked:'Ungeprüft',open:'Zahlung offen',paid:'Bezahlt',partial:'Teilweise bezahlt',refunded:'Erstattet',partial_refund:'Teilweise erstattet'};$('paymentStatus').textContent=labels[o.review_state]||'Ungeprüft';$('paymentTop').textContent=$('paymentStatus').textContent+(o.shipping_status==='cancelled'?' · Storniert':'');
  const pf=$('paymentForm');pf.hidden=demo||o.shipping_status==='cancelled';pf.elements.state.value=o.review_state||'unchecked';pf.elements.internal_note.value=o.internal_note||'';for(const k of ['qty_kombi','qty_matrosen','qty_seemann']){pf.elements[k].value=o[k];pf.elements[k].disabled=sent;} $('quantityEdit').hidden=sent;$('cancelOrder').hidden=sent;
  $('shippingStatus').textContent=statusName(o.shipping_status);
  const allowShipping=!demo&&!sent&&c.complete&&packed&&o.payment_status==='paid';
  $('markReady').disabled=!allowShipping;
  $('markSent').disabled=!allowShipping;
  $('internalNote').textContent=o.internal_note?'Notiz: '+o.internal_note:'';
  $('demoControls').hidden=!demo;
}
async function doAction(action,confirmation,success){
  if(!record)return;
  if(!confirm(confirmation))return;
  try{
    await api('/api/envelopes/status','POST',{action,ids:[id]});
    await reload();
    message(success);
  }catch(e){message('Änderung nicht gespeichert: '+e.message,'error');}
}
async function assign(raw){
  if(!record)return;
  stopCamera();
  try{
    record=await api('/api/orders/'+id+'/assign','POST',{code:raw});
    const pack=await api('/api/envelopes');envelope=(pack.envelopes||[]).find(e=>e.id===id)||envelope;
    render();
    $('manualCode').value='';
    scanMessage('✓ Ticket erkannt und zugeordnet.','ok');
    $('pageStatus').hidden=true;
  }catch(e){scanMessage('Nicht zugeordnet: '+e.message,'error');}
}
async function unassign(code){
  if(!confirm('Dieses Ticket wieder freigeben?'))return;
  try{await api('/api/orders/'+id+'/unassign','POST',{code});await reload();scanMessage('Zuordnung korrigiert.');}
  catch(e){scanMessage(e.message,'error');}
}
function stopCamera(){
  if(animation)cancelAnimationFrame(animation);animation=0;busy=false;
  if(stream){for(const t of stream.getTracks())t.stop();stream=null;}
  const v=$('orderVideo');v.srcObject=null;
  $('orderCamera').classList.remove('active');
  $('startScan').textContent='QR-Code scannen';
}
async function startCamera(){
  if(stream){stopCamera();return;}
  if(!('BarcodeDetector' in window)){scanMessage('QR-Kameraerkennung nicht verfügbar. Bitte QR-Foto auswählen oder Code manuell eingeben.','error');return;}
  try{
    if(!(await BarcodeDetector.getSupportedFormats()).includes('qr_code'))throw Error('QR-Erkennung nicht unterstützt.');
    detector=new BarcodeDetector({formats:['qr_code']});
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    const v=$('orderVideo');v.srcObject=stream;await v.play();
    $('orderCamera').classList.add('active');
    $('startScan').textContent='Kamera stoppen';
    scanMessage('QR-Code ruhig und vollständig ins Kamerabild halten.');
    lastScan=0;busy=false;animation=requestAnimationFrame(scanLoop);
  }catch(e){stopCamera();scanMessage('Kamera nicht gestartet: '+e.message,'error');}
}
async function scanLoop(time){
  if(!stream)return;
  animation=requestAnimationFrame(scanLoop);
  if(busy||time-lastScan<230)return;
  const v=$('orderVideo');if(!v||v.readyState<2)return;
  busy=true;lastScan=time;
  try{
    const hits=await detector.detect(v),url=hits?.find(x=>x.rawValue)?.rawValue;
    if(url){stopCamera();await assign(url);}
  }catch(e){stopCamera();scanMessage('Scan fehlgeschlagen: '+e.message,'error');}
  finally{busy=false;}
}
async function scanFile(file){
  if(!('BarcodeDetector' in window)){scanMessage('QR-Fotoerkennung wird hier nicht unterstützt.','error');return;}
  try{
    const bitmap=await createImageBitmap(file),scanner=new BarcodeDetector({formats:['qr_code']});
    let hits;try{hits=await scanner.detect(bitmap);}finally{bitmap.close();}
    if(hits.length&&hits[0].rawValue)await assign(hits[0].rawValue);
    else scanMessage('Auf dem Foto wurde kein QR-Code erkannt.','error');
  }catch(e){scanMessage('QR-Foto konnte nicht gelesen werden: '+e.message,'error');}
}
function printEnvelope(){
  if(!record)return;
  const p=$('printArea');p.replaceChildren();
  const page=el('div','envelope-page'),addr=el('div','envelope-address',lines(record.order).join('\n'));
  page.append(addr);p.append(page);window.print();
}
async function saveAddress(e){
  e.preventDefault();
  if(!record)return;
  const f=e.currentTarget,data=Object.fromEntries(new FormData(f));
  try{await api('/api/orders/'+id+'/customer','POST',data);await reload();message('Anschrift gespeichert.');}
  catch(err){message('Anschrift nicht geändert: '+err.message,'error');}
}
async function savePayment(e,cancel=false){
  e.preventDefault();if(!record)return;
  const f=$('paymentForm'),o=record.order,data=new FormData(f),state=data.get('state');
  if(!confirm(cancel?'Bestellung wirklich stornieren? Zugeordnete Tickets zuvor lösen.':'Zahlungsstatus und Änderungen speichern?'))return;
  const body={state,expected_state:o.review_state,expected_updated_at:o.updated_at,internal_note:data.get('internal_note'),cancel};
  if(!cancel&&['not_ready','ready'].includes(o.shipping_status)){
    const quantities=Object.fromEntries(['qty_kombi','qty_matrosen','qty_seemann'].map(k=>[k,Number(data.get(k))]));
    if(Object.keys(quantities).some(k=>quantities[k]!==o[k]))body.quantities=quantities;
  }
  const buttons=f.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
  try{await api('/api/orders/'+id+'/payment','POST',body);await reload();message(cancel?'Bestellung storniert.':'Änderungen gespeichert.');}
  catch(err){message('Nicht gespeichert: '+err.message,'error');}finally{buttons.forEach(b=>b.disabled=false);}
}
async function dispatch(status){
  if(!confirm(status==='sent'?'Ist dieser Umschlag tatsächlich verschickt worden?':'Sind alle Tickets geprüft und der Umschlag versandbereit?'))return;
  try{await api('/api/orders/'+id+'/dispatch','POST',{status});await reload();message(status==='sent'?'Versand bestätigt.':'Versandbereitschaft gespeichert.');}
  catch(e){message('Versand nicht geändert: '+e.message,'error');}
}
async function deleteDemo(){
  if(!record||!isDemo(record.order))return;
  if(!confirm('Testbestellung von Max Mustermann löschen und zugeordnete Tickets freigeben?'))return;
  const button=$('deleteDemo');button.disabled=true;
  try{
    const result=await api('/api/test-order/delete','POST',{order_id:id});
    stopCamera();
    $('orderView').hidden=true;
    message('Testbestellung gelöscht. '+result.released+' Ticket(s) wieder verfügbar.');
    const a=el('a','order-back','← Zur Bestellübersicht');a.href='/';$('pageStatus').after(a);
  }catch(e){button.disabled=false;message('Löschen fehlgeschlagen: '+e.message,'error');}
}
function setup(){
  $('startScan').addEventListener('click',startCamera);
  $('orderQrPhoto').addEventListener('change',async e=>{const file=e.target.files[0];if(file)await scanFile(file);e.target.value='';});
  $('manualAssign').addEventListener('click',()=>{const code=$('manualCode').value.trim();if(code)assign(code);else scanMessage('Bitte erst einen Code eingeben.','error');});
  $('manualCode').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('manualAssign').click();}});
  $('confirmPrint').addEventListener('click',()=>doAction('printed','Ist dieser Umschlag tatsächlich ausgedruckt und kontrolliert worden?','Umschlag als gedruckt bestätigt.'));
  $('demoPrint').addEventListener('click',()=>doAction('demo_printed','TEST: Druckstatus für Max Mustermann simulieren?','Test-Druckstatus gespeichert.'));
  $('confirmPacked').addEventListener('click',()=>doAction('packed','Sind alle richtigen Tickets tatsächlich in diesem Umschlag?','✓ Vollständig verpackt.'));
  $('undoPacked').addEventListener('click',()=>doAction('unpacked','Verpackung wieder zurücknehmen?','Verpackungsstatus zurückgenommen.'));
  $('printOne').addEventListener('click',printEnvelope);
  $('addressForm').addEventListener('submit',saveAddress);
  $('paymentForm').addEventListener('submit',e=>savePayment(e));$('cancelOrder').addEventListener('click',e=>savePayment(e,true));
  $('markReady').addEventListener('click',()=>dispatch('ready'));
  $('markSent').addEventListener('click',()=>dispatch('sent'));
  $('deleteDemo').addEventListener('click',deleteDemo);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera();});
  window.addEventListener('pagehide',stopCamera);
  reload();
}
setup();
})();
