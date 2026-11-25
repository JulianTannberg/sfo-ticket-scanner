(()=>{'use strict';
const $=id=>document.getElementById(id);
const names=[
 ['external_order_id','Bestellnummer (optional)',['bestellnummer','bestellnr','orderid','ordernumber','nummer','nr']],
 ['full_name','Kunden-/Empfängername *',['kundenname','kunde','empfaenger','empfanger','fullname','name','liefername','vorundnachname']],
 ['address_line1','Straße und Hausnummer *',['strasseundhausnummer','strasse','straße','street','address1','anschrift','lieferstrasse']],
 ['postal_code','Postleitzahl *',['postleitzahl','plz','postcode','zip','zipcode']],
 ['city','Ort *',['ort','stadt','city','lieferort']],
 ['qty_kombi','Anzahl Kombi',['qtykombi','anzahlkombi','kombi','kombiticket','kombi tickets','kombitickets']],
 ['qty_matrosen','Anzahl Matrosen',['qtymatrosen','anzahlmatrosen','matrosen','matrosentickets']],
 ['qty_seemann','Anzahl Seemann',['qtyseemann','anzahlseemann','seemann','seemanntickets']],
 ['source','Importquelle (wenn keine Bestellnummer)',['importquelle']],
 ['source_row','Excelzeile (wenn keine Bestellnummer)',['excelzeile']],
 ['order_date','Bestelldatum (JJJJ-MM-TT)',['bestelldatum','orderdate']],
 ['internal_note','Prüfhinweis / interne Notiz',['prufhinweis','pruefhinweis','internenotiz','notiz']],
 ['address_line2','Adresszusatz',['adresszusatz','address2','zusatz','wohnung']],
 ['email','E-Mail',['email','emailadresse','mail']],
 ['phone','Telefon',['telefon','phone','telefonnummer','mobil']]
];
const required=new Set(['full_name','address_line1','postal_code','city']);
const headersNorm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss').replace(/[^a-z0-9]/g,'');
let headers=[],rows=[],map={},preview=[],sample=false,dirty=true;
function notice(msg,error=false){$('importStatus').textContent=msg;$('importStatus').className='alert '+(error?'error':'success');}
function delimiterOf(line){
  const counts={'\t':0,';':0,',':0};let q=false;
  for(let i=0;i<line.length;i++){
    if(line[i]==='"'){if(q&&line[i+1]==='"'){i++;continue;}q=!q;}
    else if(!q&&line[i] in counts)counts[line[i]]++;
  }
  return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
}
function parseCsv(text){
  text=text.replace(/^\uFEFF/,'');
  const headerLine=text.split(/\r?\n/,1)[0],sep=delimiterOf(headerLine);
  const matrix=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'){
      if(quoted&&text[i+1]==='"'){field+='"';i++;}
      else quoted=!quoted;
    }else if(!quoted&&ch===sep){row.push(field);field='';}
    else if(!quoted&&(ch==='\n'||ch==='\r')){
      if(ch==='\r'&&text[i+1]==='\n')i++;
      row.push(field);field='';
      if(row.some(c=>String(c).trim()))matrix.push(row);
      row=[];
    }else field+=ch;
  }
  if(quoted)throw Error('Ein Anführungszeichen wurde nicht geschlossen.');
  row.push(field);if(row.some(c=>String(c).trim()))matrix.push(row);
  if(matrix.length<2||matrix[0].length<2)throw Error('Keine Tabelle mit Überschriften gefunden. Bitte CSV oder Excel-Tabellenbereich wählen.');
  if(matrix.length>1001)throw Error('Mehr als 1.000 Zeilen. Bitte Datei aufteilen.');
  const width=matrix[0].length;
  const bad=matrix.findIndex((r,i)=>i>0&&r.length!==width);
  if(bad>=0)throw Error('Zeile '+(bad+1)+' hat '+matrix[bad].length+' statt '+width+' Spalten. Bitte die CSV-Datei prüfen.');
  return {headers:matrix[0].map(v=>String(v).trim()),rows:matrix.slice(1)};
}
function mappingGuess(aliases){
  const normalized=headers.map(headersNorm);
  for(const alias of aliases){
    const exact=normalized.findIndex(h=>h===headersNorm(alias));
    if(exact>=0)return exact;
  }
  for(const alias of aliases){
    const needle=headersNorm(alias);
    if(needle.length<5)continue;
    const matched=normalized.map((h,i)=>h.includes(needle)?i:-1).filter(i=>i>=0);
    if(matched.length===1)return matched[0];
  }
  return -1;
}
function mappingUi(){
  const root=$('mappingFields');root.replaceChildren();
  for(const [key,label,aliases] of names){
    const wrap=document.createElement('label');
    wrap.textContent=label;
    const select=document.createElement('select');select.dataset.key=key;
    const absent=document.createElement('option');absent.value='-1';absent.textContent='– Keine passende Spalte –';select.append(absent);
    headers.forEach((head,index)=>{const op=document.createElement('option');op.value=String(index);op.textContent=(index+1)+'. '+head;select.append(op);});
    select.value=String(mappingGuess(aliases));
    wrap.append(select);root.append(wrap);
    select.addEventListener('change',()=>{dirty=true;$('previewSection').hidden=true;});
  }
  $('mappingHint').textContent=headers.length+' Spalten und '+rows.length+' Datenzeilen erkannt. Zuordnungen kontrollieren, insbesondere Ticketanzahlen und Anschriften.';
  $('mappingSection').hidden=false;
}
function intVal(value,field){
  const s=String(value||'').trim();
  if(!s)return 0;
  if(!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(s))throw Error(field+': Anzahl „'+s+'“ ist keine ganze Zahl.');
  const n=Number(s.replace(/\./g,''));
  if(!Number.isSafeInteger(n)||n<0||n>100)throw Error(field+': ungültige Ticketanzahl '+s);
  return n;
}
function readMap(){
  map={};document.querySelectorAll('#mappingFields select').forEach(s=>{map[s.dataset.key]=Number(s.value);});
  for(const key of required)if(map[key]<0)throw Error('Pflichtspalte fehlt: '+names.find(item=>item[0]===key)[1]);
  if(['qty_kombi','qty_matrosen','qty_seemann'].every(k=>map[k]<0))
    throw Error('Keine Ticketmengen gefunden. Beim Export müssen Ticketarten und Stückzahlen enthalten sein.');
  const used=new Map();
  for(const [key,index] of Object.entries(map)){
    if(index<0)continue;
    if(used.has(index))throw Error('Eine Spalte ist doppelt zugeordnet: '+headers[index]+'. Bitte bei '+names.find(x=>x[0]===key)[1]+' prüfen.');
    used.set(index,key);
  }
}
function get(row,key){return map[key]<0?'':String(row[map[key]]??'').trim();}
function previewData(){
  readMap();
  const outputs=[],seen=new Set(),issues=[];
  for(let i=0;i<rows.length;i++){
    const row=rows[i],n=i+2,source=get(row,'source'),line=get(row,'source_row'),external=get(row,'external_order_id'),ext=external||(source&&/^[1-9]\d*$/.test(line)?'IMPORT:'+source+':'+line:''),name=get(row,'full_name'),
    street=get(row,'address_line1'),postal=get(row,'postal_code'),city=get(row,'city');
    if(!ext||ext.length>80||!name||!street||!postal||!city)throw Error('Zeile '+n+': Bestellnummer oder Anschrift unvollständig.');
    if(seen.has(ext))throw Error('Bestellnummer '+ext+' ist mehrfach enthalten. Vermutlich einzelne Produktpositionen – bitte erst Export prüfen, nicht importieren.');
    seen.add(ext);
    const count={qty_kombi:intVal(get(row,'qty_kombi'),'Kombi'),qty_matrosen:intVal(get(row,'qty_matrosen'),'Matrosen'),qty_seemann:intVal(get(row,'qty_seemann'),'Seemann')};
    const total=count.qty_kombi+count.qty_matrosen+count.qty_seemann;
    if(total<1||total>100)throw Error('Zeile '+n+': Ticketanzahl 0 oder über 100.');
    const value={external_order_id:ext,full_name:name,address_line1:street,address_line2:get(row,'address_line2'),
      postal_code:postal,city,email:get(row,'email'),phone:get(row,'phone'),internal_note:get(row,'internal_note'),order_date:get(row,'order_date'),...count};
    if(value.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))
      throw Error('Zeile '+n+': E-Mail nicht gültig.');
    outputs.push(value);
  }
  preview=outputs;dirty=false;
  $('previewRows').replaceChildren();
  for(const entry of outputs){
    const tr=document.createElement('tr');
    for(const val of [
      entry.external_order_id,
      [entry.full_name,entry.address_line1,entry.address_line2,entry.postal_code+' '+entry.city].filter(Boolean).join(' · '),
      ['K '+entry.qty_kombi,'M '+entry.qty_matrosen,'S '+entry.qty_seemann].join(' · '),
      entry.internal_note||'–','Ungeprüft'
    ]){const td=document.createElement('td');td.textContent=val;tr.append(td);}
    $('previewRows').append(tr);
  }
  $('previewInfo').textContent=outputs.length+' Bestellungen geprüft. Alle Positionen werden angezeigt. Alle Zeilen werden erst nach deiner Bestätigung übertragen.';
  $('previewWarning').textContent=sample?'Nur erfundene Musterdaten! Muster dürfen nicht in die echte Datenbank importiert werden.':issues.slice(0,8).join(' · ');
  $('confirmImport').disabled=sample||outputs.length===0;
  $('previewSection').hidden=false;
  $('previewSection').scrollIntoView({behavior:'smooth',block:'start'});
  const totals=['qty_kombi','qty_matrosen','qty_seemann'].map(k=>outputs.reduce((n,o)=>n+o[k],0));notice(outputs.length+' Bestellpositionen · '+totals[0]+' Kombi · '+totals[1]+' Matrosen · '+totals[2]+' Seemann. Anschriften und Mengen kontrollieren.');
}
function parseSource(){
  const text=$('sourceText').value.trim();
  if(text.length<5)throw Error('Bitte eine CSV-Datei auswählen oder einen Tabellenbereich einfügen.');
  if(text.length>1500000)throw Error('Datei zu groß. Bitte in Abschnitte aufteilen.');
  const parsed=parseCsv(text);headers=parsed.headers;rows=parsed.rows;dirty=true;preview=[];
  mappingUi();$('previewSection').hidden=true;
  notice(rows.length+' Datenzeilen erkannt. Bitte die Spaltenzuordnung prüfen.');
}
async function doImport(){
  if(sample||dirty||!preview.length)return;
  if(!confirm('Wirklich '+preview.length+' Bestellungen mit Lieferadressen, Ticketanzahlen in die geschützte Datenbank übernehmen?'))return;
  const btn=$('confirmImport');btn.disabled=true;
  let imported=0,skipped=0;
  try{
    for(let i=0;i<preview.length;i+=20){
      const chunk=preview.slice(i,i+20);
      const opt={method:'POST',credentials:'same-origin',
        headers:{accept:'application/json','content-type':'application/json','x-sturmknoten':'1'},
        body:JSON.stringify({orders:chunk})};
      const res=await fetch('/api/orders/import',opt);
      const data=await res.json().catch(()=>({}));
      if(!res.ok)throw Error(data.error||'Serverfehler '+res.status);
      imported+=data.imported;skipped+=data.skipped;
      notice('Verarbeitet: '+Math.min(i+20,preview.length)+' von '+preview.length+' · '+imported+' neu · '+skipped+' bereits vorhanden.');
    }
    notice('Import fertig: '+imported+' Bestellungen neu angelegt, '+skipped+' übersprungen. Bitte die Bestellübersicht kontrollieren.');
    $('confirmImport').textContent='Import abgeschlossen';
  }catch(e){notice('Import unterbrochen: '+e.message+'. Bereits angelegte Bestellnummern werden bei erneutem Start übersprungen.',true);btn.disabled=false;}
}
$('sourceFile').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  if(file.size>1500000){notice('Datei zu groß (max. 1,5 MB).',true);return;}
  $('sourceText').value=await file.text();sample=false;dirty=true;
  try{parseSource();}catch(err){notice(err.message,true);}
});
$('sourceText').addEventListener('input',()=>{sample=false;dirty=true;$('mappingSection').hidden=true;$('previewSection').hidden=true;});
$('parseSource').addEventListener('click',()=>{try{parseSource();}catch(e){notice(e.message,true);}});
$('preparePreview').addEventListener('click',()=>{try{previewData();}catch(e){$('previewSection').hidden=true;notice(e.message,true);}});
$('confirmImport').addEventListener('click',doImport);

$('demoCsv').addEventListener('click',()=>{
  $('sourceText').value='Bestellnummer;Name;Straße;PLZ;Ort;Kombi;Matrosen;Seemann\nMUSTER-001;Max Mustermann;Musterstraße 12;12345;Musterstadt;1;0;1\nMUSTER-002;Erika Beispiel;Probegasse 4;23456;Beispielort;0;2;0';
  sample=true;
  try{parseSource();notice('Muster geladen. Diese Daten werden NICHT importiert.');}
  catch(e){notice(e.message,true);}
});
})();