(()=>{'use strict';
const $=id=>document.getElementById(id);
let points=[],currentId='',currentMode='issue',stream=null,detector=null,animation=0,scanBusy=false,scanAt=0,lastCode='',lastDetected=0;
const make=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=String(text);return x;};
async function api(path,method='GET',data){
 const opts={method,credentials:'same-origin',headers:{accept:'application/json'}};
 if(method!=='GET'){opts.headers['content-type']='application/json';opts.headers['x-sturmknoten']='1';opts.body=JSON.stringify(data||{});}
 let response;try{response=await fetch(path,opts);}catch{throw Error('Keine Verbindung zum Server.');}
 let body;try{body=await response.json();}catch{throw Error('Unerwartete Serverantwort.');}
 if(!response.ok)throw Error(body.error||'Serverfehler '+response.status);
 return body;
}
function state(text,error=false){
 const el=$('salesScanState');el.textContent=text;el.style.color=error?'#ffb3a5':'#b9f2d1';
}
function info(text,error=false){
 const el=$('salesAuthStatus');el.textContent=text;el.className='alert '+(error?'error':'success');
}
async function loadPoints(){
 const data=await api('/api/sales-points');points=data.points||[];
 const select=$('salesPointSelect');select.replaceChildren();
 const empty=make('option','','Bitte Verkaufsstelle auswählen');empty.value='';select.append(empty);
 for(const p of points){const opt=make('option','',p.name+' · '+p.ticket_count+' Tickets');opt.value=p.id;select.append(opt);}
 if(currentId&&!points.some(p=>p.id===currentId))currentId='';
 select.value=currentId;
 $('salesPointStats').textContent=currentId?'Verfügbar für die Ausgabe: '+data.free+' Hardtickets.':'Verfügbar für die Ausgabe: '+data.free+' Hardtickets. Erst Verkaufsstelle auswählen.';
 await loadStock();
}
async function loadStock(){
 const listing=$('salesStockList');listing.replaceChildren();
 const p=points.find(x=>x.id===currentId);
 if(!p){$('salesStockSummary').textContent='Keine Verkaufsstelle ausgewählt.';return;}
 const stock=await api('/api/sales-points/'+currentId+'/tickets');
 $('salesStockSummary').textContent=p.ticket_count+(p.name==='Privat verkauft'?' privat verkauft · Kombi ':' Tickets vor Ort · Kombi ')+p.kombi_count+' · Matrosen '+p.matrosen_count+' · Seemann '+p.seemann_count;
 if(!stock.tickets.length){listing.append(make('li','quiet','Noch keine Tickets ausgegeben.'));return;}
 for(const t of stock.tickets){
  const li=make('li'),text=make('span');
  text.append(make('strong','',t.ticket_type),make('br'),make('code','',t.code));
  li.append(text);listing.append(li);
 }
}
function selectedMode(){return document.querySelector('[name=salesMode]:checked')?.value||'issue';}
function updateMode(){
 currentMode=selectedMode();
 $('salesModeHint').textContent=currentMode==='issue'?
 'Jeder gescannte QR-Code wird als Bestand dieser Verkaufsstelle gespeichert. Keine Verkauf- oder Einlassbuchung.':
 'Nur Tickets, die dieser Verkaufsstelle zugeordnet sind, werden bei Rückgabe wieder freigegeben.';
 state(currentMode==='issue'?'Bereit für die Ausgabe.':'Bereit für die Rücknahme.');
}
async function processCode(value){
 const raw=String(value||'').trim();
 if(!currentId){state('Bitte zuerst eine Verkaufsstelle auswählen.',true);return;}
 if(!raw){state('Kein QR-Code gelesen.',true);return;}
 const mode=currentMode,p=points.find(x=>x.id===currentId);
 scanBusy=true;
 try{
  const result=await api('/api/sales-points/'+currentId+'/'+mode,'POST',{code:raw});
  state('✓ '+result.ticket_type+' · '+(mode==='issue'?'an '+p.name+' ausgegeben':'von '+p.name+' zurückgenommen')+'.');
  await loadPoints();
 }catch(e){state('Nicht gespeichert: '+e.message,true);}
 finally{scanBusy=false;}
}
function stopCamera(){
 if(animation)cancelAnimationFrame(animation);animation=0;
 if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
 $('salesCameraView').srcObject=null;$('salesCameraWrap').classList.remove('active');
 $('salesCameraToggle').textContent='Handykamera starten';
}
async function camera(){
 if(stream){stopCamera();return;}
 if(!currentId){state('Bitte zuerst eine Verkaufsstelle auswählen.',true);return;}
 if(!('BarcodeDetector' in window)){state('Dieser Browser unterstützt den QR-Scan nicht. Bitte QR-Foto auswählen.',true);return;}
 try{
  if(!(await BarcodeDetector.getSupportedFormats()).includes('qr_code'))throw Error('QR-Code-Erkennung nicht unterstützt.');
  detector=new BarcodeDetector({formats:['qr_code']});
  stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
  const video=$('salesCameraView');video.srcObject=stream;await video.play();
  $('salesCameraWrap').classList.add('active');
  $('salesCameraToggle').textContent='Kamera stoppen';
  scanAt=0;lastCode='';lastDetected=0;scanBusy=false;
  state('Kamera aktiv. QR-Codes einzeln vor die Kamera halten.');
  animation=requestAnimationFrame(loop);
 }catch(e){stopCamera();state('Kamera nicht verfügbar: '+e.message,true);}
}
async function loop(now){
 if(!stream)return;
 animation=requestAnimationFrame(loop);
 if(scanBusy||now-scanAt<350)return;
 const video=$('salesCameraView');if(video.readyState<2)return;
 scanAt=now;
 try{
  const hits=await detector.detect(video),value=hits?.find(h=>h.rawValue)?.rawValue;
  if(!value){if(now-lastDetected>1200)lastCode='';return;}
  if(value===lastCode)return;
  lastCode=value;lastDetected=now;
  await processCode(value);
 }catch(e){stopCamera();state('Kamerascan fehlgeschlagen: '+e.message,true);}
}
async function photo(file){
 if(!currentId){state('Bitte Verkaufsstelle auswählen.',true);return;}
 if(!('BarcodeDetector' in window)){state('QR-Fotoerkennung nicht verfügbar.',true);return;}
 try{
  const bitmap=await createImageBitmap(file);let hits;
  try{hits=await new BarcodeDetector({formats:['qr_code']}).detect(bitmap);}
  finally{bitmap.close();}
  const code=hits?.find(x=>x.rawValue)?.rawValue;
  if(code)await processCode(code);
  else state('Kein QR-Code im Bild erkannt.',true);
 }catch(e){state('Foto konnte nicht gelesen werden: '+e.message,true);}
}
async function init(){
 try{
  const who=await api('/api/me');
  $('salesApp').hidden=false;info('Angemeldet: '+(who.role==='dispatch'?'Versand & Zahlungskontrolle':'Administration'));
  await loadPoints();
 }catch(e){info('Zugang oder Datenbank nicht verfügbar: '+e.message,true);return;}
 $('salesPointSelect').addEventListener('change',async e=>{
  stopCamera();currentId=e.target.value;
  try{await loadStock();}catch(err){state(err.message,true);}
 });
 $('privateChannel').addEventListener('click',async()=>{try{stopCamera();const result=await api('/api/sales-points','POST',{name:'Privat verkauft'});currentId=result.point.id;await loadPoints();state('Privat verkauft ausgewählt.');}catch(e){state(e.message,true);}});
 $('salesPointForm').addEventListener('submit',async e=>{
  e.preventDefault();const input=$('salesPointName'),name=input.value.trim();
  if(name.length<2){state('Bitte einen Namen eingeben.',true);return;}
  try{const data=await api('/api/sales-points','POST',{name});
   currentId=data.point.id;input.value='';await loadPoints();
   state('Verkaufsstelle „'+data.point.name+'“ ausgewählt.');
  }catch(err){state('Verkaufsstelle nicht angelegt: '+err.message,true);}
 });
 document.querySelectorAll('input[name=salesMode]').forEach(x=>x.addEventListener('change',()=>{stopCamera();updateMode();}));
 $('salesCameraToggle').addEventListener('click',camera);
 $('salesQrPhoto').addEventListener('change',async e=>{const file=e.target.files[0];if(file)await photo(file);e.target.value='';});
 $('salesManualButton').addEventListener('click',async()=>{
  const field=$('salesManualCode'),value=field.value;await processCode(value);if(value)field.value='';
 });
 $('salesManualCode').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('salesManualButton').click();}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera();});
 window.addEventListener('pagehide',stopCamera);
}
init();
})();