// SturmKnoten 2027: secure ticket sales and dispatch API.
// All dynamic routes deny access unless a signed Cloudflare Access token is
// verified AND the identity email matches the configured admin or dispatcher.
// Dispatch access is limited server-side to sales/packing/shipping operations.
// All input is parameterized; no customer data or QR secrets belong in GitHub.

const COMMON_HEADERS = {
  'cache-control': 'no-store, max-age=0',
  'pragma': 'no-cache',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};
const codeFormat = /^[KMS]27[A-HJ-NP-Z2-9]{13}$/;
const types = { K: 'Kombi', M: 'Matrosen', S: 'Seemann' };
const clean = (x, limit=200) => String(x ?? '').trim().slice(0, limit);
const makeId = () => crypto.randomUUID();
const json = (data, status=200) => new Response(JSON.stringify(data), {
  status,
  headers: {...COMMON_HEADERS, 'content-type': 'application/json; charset=utf-8'},
});
function fail(code, message){ const e = new Error(message); e.status = code; throw e; }
function integer(n, name, max=100000000){
  if (!Number.isSafeInteger(n) || n < 0 || n > max) fail(400, `${name}: ungültige Zahl`);
  return n;
}
function positive(n, name, max=100000000){
  integer(n,name,max); if(n===0) fail(400,`${name} muss größer als 0 sein`); return n;
}
function decodeBase64Url(s) {
  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length>8000) throw new Error('JWT-Teil ungültig');
  const value=s.replace(/-/g,'+').replace(/_/g,'/');
  const binary=atob(value+'='.repeat((4-value.length%4)%4));
  return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
const parseJWTPart = s => JSON.parse(new TextDecoder().decode(decodeBase64Url(s)));

async function accessEmail(request, env){
  const team=String(env.TEAM_DOMAIN||'').replace(/\/$/,'');
  const audience=clean(env.ACCESS_AUD,128);
  const admin=clean(env.ADMIN_EMAIL,254).toLowerCase();
  // Extra staff email is configured privately in Cloudflare, never in GitHub.
  const dispatch=clean(env.DISPATCH_EMAIL,254).toLowerCase();
  if(!/^https:\/\/[\w-]+\.cloudflareaccess\.com$/.test(team)||!audience||!admin){
    fail(503,'Administrationszugang noch nicht vollständig eingerichtet.');
  }
  const cookieMatch=(request.headers.get('cookie')||'').match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  const token=request.headers.get('Cf-Access-Jwt-Assertion')||cookieMatch?.[1]||'';
  const pieces=token.split('.');
  if(pieces.length!==3||token.length>15000)fail(403,'Cloudflare-Anmeldung fehlt.');
  let header,payload;
  try { header=parseJWTPart(pieces[0]);payload=parseJWTPart(pieces[1]); }
  catch {fail(403,'Anmeldung ist ungültig.');}
  if(header?.alg!=='RS256'||!header.kid||!payload||typeof payload!=='object')fail(403,'Ungültiger Anmeldetoken.');
  const now=Math.floor(Date.now()/1000);
  if(payload.iss!==team||!(Array.isArray(payload.aud)?payload.aud:[payload.aud]).includes(audience)||
     typeof payload.exp!=='number'||payload.exp<=now||typeof payload.iat!=='number'||payload.iat>now+120||
     (typeof payload.nbf==='number'&&payload.nbf>now+120))fail(403,'Anmeldung abgelaufen oder für andere Anwendung.');
  const verifiedEmail=String(payload.email||'').trim().toLowerCase();
  const role=verifiedEmail===admin?'admin':(dispatch&&verifiedEmail===dispatch?'dispatch':null);
  if(!role)fail(403,'Für diese E-Mail ist kein SturmKnoten-Zugang eingerichtet.');
  let certs;
  try {
    const res=await fetch(`${team}/cdn-cgi/access/certs`, {cf:{cacheTtl:600}});
    if(!res.ok)throw new Error('No certificate');
    certs=await res.json();
  } catch {fail(503,'Cloudflare-Signaturprüfung gerade nicht verfügbar.');}
  const jwk=(certs.keys||[]).find(k=>k.kid===header.kid&&k.kty==='RSA');
  if(!jwk)fail(403,'Cloudflare-Signaturschlüssel nicht erkannt.');
  try {
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    const verified=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decodeBase64Url(pieces[2]),new TextEncoder().encode(`${pieces[0]}.${pieces[1]}`));
    if(!verified)fail(403,'Cloudflare-Signatur ungültig.');
  }catch(e){if(e.status)throw e;fail(403,'Cloudflare-Signatur ungültig.');}
  return {email:verifiedEmail,role};
}
async function readBody(request){
  const length=Number(request.headers.get('content-length')||0);
  if(length>120000)fail(413,'Eingabe zu groß');
  const raw=await request.text();
  if(raw.length>120000)fail(413,'Eingabe zu groß');
  try{const obj=JSON.parse(raw);if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error();return obj;}
  catch{fail(400,'Ungültige Eingabedaten');}
}
function parseCode(value){
  const text=clean(value,200);
  if(codeFormat.test(text))return text;
  try {
    const u=new URL(text);
    if(u.protocol!=='https:'||u.hostname!=='sturmflutfestival.de'||u.pathname!=='/info/'||!u.searchParams.has('t'))return null;
    const code=u.searchParams.get('t');
    if(!codeFormat.test(code))return null;
    return code;
  }catch{return null;}
}
function enforceOrigin(request){
  const expected=new URL(request.url).origin;
  if(request.headers.get('origin')!==expected||request.headers.get('x-sturmknoten')!=='1')fail(403,'Ungültige Anfrageherkunft');
  if(!(request.headers.get('content-type')||'').startsWith('application/json'))fail(415,'JSON erforderlich');
}
async function getOrder(db,id,role='admin'){
  const order=await db.prepare(`SELECT o.*, c.full_name,c.address_line1,c.address_line2,c.postal_code,c.city,c.country,c.email,c.phone
    FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?`).bind(id).first();
  if(!order)fail(404,'Bestellung nicht gefunden.');
  if(role==='dispatch'&&order.sales_channel==='internal_test')fail(403,'Testbestellungen sind nicht für den Versandzugang freigegeben.');
  const [tickets,payments]=await Promise.all([
    db.prepare('SELECT code,ticket_type,assigned_at FROM tickets WHERE order_id=? ORDER BY assigned_at,code').bind(id).all(),
    db.prepare('SELECT id,direction,method,amount_cents,reference,occurred_at FROM payments WHERE order_id=? ORDER BY occurred_at,id').bind(id).all()
  ]);
  if(role==='dispatch'){
    // Shipping and finance staff may view payment details, but not admin-only audit or test data.
    const safe={};
    for(const key of [
      'id','external_order_id','sales_channel','full_name','address_line1','address_line2',
      'postal_code','city','email','phone','qty_kombi','qty_matrosen','qty_seemann',
      'payment_status','shipping_status','total_amount_cents','postage_cents','paid_amount_cents','shipped_at'
    ])safe[key]=order[key];
    safe.internal_note=order.sales_channel==='internal_test'?'SYSTEMTEST - keine echte Bestellung':null;
    return {order:safe,tickets:tickets.results||[],payments:payments.results||[]};
  }
  return {order,tickets:tickets.results||[],payments:payments.results||[]};
}
function orderCompleteClause(){
  return `(SELECT COUNT(*) FROM tickets WHERE order_id=orders.id AND ticket_type='Kombi')=qty_kombi
    AND (SELECT COUNT(*) FROM tickets WHERE order_id=orders.id AND ticket_type='Matrosen')=qty_matrosen
    AND (SELECT COUNT(*) FROM tickets WHERE order_id=orders.id AND ticket_type='Seemann')=qty_seemann`;
}
// Schema installation is idempotent and runs only after admin identity validation.
// No existing ticket, customer or order records are modified.
let envelopeSchemaInit=null;
async function ensureEnvelopeSchema(db){
  if(!envelopeSchemaInit){
    envelopeSchemaInit=(async()=>{
      await db.prepare(`CREATE TABLE IF NOT EXISTS envelope_progress (
        order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
        printed_at TEXT,
        packed_at TEXT,
        updated_by TEXT,
        CHECK (packed_at IS NULL OR printed_at IS NOT NULL)
      )`).run();
      await db.prepare('CREATE INDEX IF NOT EXISTS idx_envelope_progress_printed ON envelope_progress(printed_at,packed_at)').run();
    })();
    envelopeSchemaInit.catch(()=>{envelopeSchemaInit=null;});
  }
  return envelopeSchemaInit;
}
function audit(db,actor,action,entity,id,metadata={}){
  return db.prepare('INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,metadata_json) VALUES (?,?,?,?,?,?)')
    .bind(makeId(),actor,action,entity,id,JSON.stringify(metadata).slice(0,2000));
}

// Explicitly allow only operational routes for the second organizer.
// This is server-side authorization: hidden buttons or direct API calls cannot bypass it.
function dispatchAllowed(method,path){
  if(method==='GET'&&['/api/me','/api/overview','/api/orders','/api/envelopes'].includes(path))return true;
  if(method==='POST'&&path==='/api/tickets/check')return true;
  if(method==='POST'&&path==='/api/orders')return true;
  if(method==='POST'&&path==='/api/envelopes/status')return true;
  if(/^\/api\/orders\/[a-f0-9-]{36}$/.test(path)&&method==='GET')return true;
  if(/^\/api\/orders\/[a-f0-9-]{36}\/(assign|unassign|customer|payment|dispatch)$/.test(path)&&method==='POST')return true;
  return false;
}
async function handleApi(request,env,actor){
  if(!env.DB)fail(503,'Datenbank-Verbindung fehlt.');
  const db=env.DB;
  const user=actor;actor=user.email;
  const url=new URL(request.url);
  const path=url.pathname, method=request.method;
  const role=user.role;
  if(role==='dispatch'&&!dispatchAllowed(method,path))fail(403,'Dieser Vorgang ist nur für die Administration freigegeben.');
  if(method==='GET'&&path==='/api/me')return json({email:user.email,role});
  if(role==='dispatch'&&method==='POST'&&path==='/api/envelopes/status'){
    // Do not allow fictitious test prints from a real shipping account.
    const input=await request.clone().json().catch(()=>null);
    if(input?.action==='demo_printed')fail(403,'Testfunktionen sind ausschließlich für die Administration.');
  }
  if(method==='POST'&&path==='/api/tickets/check'){
    // Read-only QR test. Never assign, redeem, or log a ticket as scanned.
    const b=await readBody(request);
    const code=parseCode(b.code);
    if(!code)return json({recognized:false,reason:'format'});
    const ticket=await db.prepare('SELECT ticket_type,status,order_id FROM tickets WHERE code=?').bind(code).first();
    if(!ticket)return json({recognized:false,reason:'unknown'});
    return json({recognized:true,ticket_type:ticket.ticket_type,status:ticket.status,
      assigned:Boolean(ticket.order_id)});
  }
  if(method==='GET'&&path==='/api/overview'){
    const [tickets,orders]=await Promise.all([
      db.prepare(`SELECT ticket_type,status,COUNT(*) AS count FROM tickets GROUP BY ticket_type,status`).all(),
      db.prepare(`SELECT COUNT(*) AS orders,COALESCE(SUM(paid_amount_cents),0) AS paid_cents,
        SUM(CASE WHEN shipping_status='sent' THEN 1 ELSE 0 END) AS sent FROM orders`).first()
    ]);
    return json({tickets:tickets.results||[],orders});
  }
  if(method==='GET'&&path==='/api/orders'){
    const q=clean(url.searchParams.get('q'),80);
    const rows=await db.prepare(`SELECT o.id,o.external_order_id,o.created_at,o.payment_status,o.shipping_status,o.sales_channel,
      o.total_amount_cents,o.paid_amount_cents,o.qty_kombi,o.qty_matrosen,o.qty_seemann,c.full_name,
      (SELECT COUNT(*) FROM tickets WHERE order_id=o.id) AS assigned_count
      FROM orders o JOIN customers c ON c.id=o.customer_id
      WHERE (?='' OR c.full_name LIKE ? OR o.external_order_id LIKE ?)
        AND (?='admin' OR o.sales_channel<>'internal_test')
      ORDER BY o.created_at DESC,o.id DESC LIMIT 150`).bind(q,`%${q}%`,`%${q}%`,role).all();
    return json({orders:rows.results||[]});
  }
  if(method==='GET'&&path==='/api/envelopes'){
    await ensureEnvelopeSchema(db);
    const list=await db.prepare(`SELECT o.id,o.external_order_id,o.shipping_status,o.payment_status,
      o.qty_kombi,o.qty_matrosen,o.qty_seemann,o.sales_channel,
      c.full_name,c.address_line1,c.address_line2,c.postal_code,c.city,
      ep.printed_at,ep.packed_at,
      (SELECT COUNT(*) FROM tickets WHERE order_id=o.id AND ticket_type='Kombi') AS scanned_kombi,
      (SELECT COUNT(*) FROM tickets WHERE order_id=o.id AND ticket_type='Matrosen') AS scanned_matrosen,
      (SELECT COUNT(*) FROM tickets WHERE order_id=o.id AND ticket_type='Seemann') AS scanned_seemann
      FROM orders o JOIN customers c ON c.id=o.customer_id
      LEFT JOIN envelope_progress ep ON ep.order_id=o.id
      WHERE o.shipping_status<>'cancelled' AND (?='admin' OR o.sales_channel<>'internal_test')
      ORDER BY c.full_name COLLATE NOCASE,o.created_at,o.id
      LIMIT 2001`).bind(role).all();
    const rows=list.results||[];
    if(rows.length>2000)fail(413,'Mehr als 2000 Bestellungen. Bitte zuerst in Gruppen arbeiten.');
    return json({envelopes:rows});
  }
  if(method==='POST'&&path==='/api/envelopes/status'){
    await ensureEnvelopeSchema(db);
    const b=await readBody(request), action=clean(b.action,20);
    if(!['printed','unprinted','packed','unpacked','demo_printed'].includes(action))fail(400,'Unbekannter Umschlagstatus.');
    const ids=Array.isArray(b.ids)?[...new Set(b.ids)]:[];
    if(ids.length===0||ids.length>100||ids.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id)))fail(400,'Ungültige Bestellauswahl.');
    if(role==='dispatch'){
      const placeholders=ids.map(()=>'?').join(',');
      const demo=await db.prepare(`SELECT 1 FROM orders WHERE id IN (${placeholders}) AND sales_channel='internal_test' LIMIT 1`).bind(...ids).first();
      if(demo)fail(403,'Testbestellungen dürfen nicht über den Versandzugang bearbeitet werden.');
    }
    if(action!=='printed'&&ids.length!==1)fail(400,'Diese Korrektur nur für eine Bestellung.');
    if(action==='demo_printed'){
      // Only for the explicitly labelled fictional demo order, without a physical print.
      const id=ids[0],stamp=new Date().toISOString();
      const changes=await db.batch([
        db.prepare(`INSERT INTO envelope_progress(order_id,updated_by)
          SELECT id,? FROM orders
          WHERE id=? AND sales_channel='internal_test'
            AND internal_note='SYSTEMTEST - keine echte Bestellung'
            AND shipping_status IN ('not_ready','ready')
          ON CONFLICT(order_id) DO NOTHING`).bind(actor,id),
        db.prepare(`UPDATE envelope_progress SET printed_at=?,updated_by=?
          WHERE order_id=? AND packed_at IS NULL AND printed_at IS NULL
          AND EXISTS(SELECT 1 FROM orders WHERE orders.id=envelope_progress.order_id
            AND sales_channel='internal_test' AND internal_note='SYSTEMTEST - keine echte Bestellung'
            AND shipping_status IN ('not_ready','ready'))`).bind(stamp,actor,id),
        db.prepare(`INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,metadata_json)
          SELECT ?,?,'envelope.demo_printed','order',?,'{}'
          WHERE EXISTS (SELECT 1 FROM envelope_progress WHERE order_id=? AND printed_at=?)`)
          .bind(makeId(),actor,id,id,stamp)
      ]);
      if((changes[1]?.meta?.changes||0)!==1)fail(409,'Test-Druckstatus nicht geändert. Ist es eine offene Testbestellung?');
      return json({changed:1,requested:1,simulated:true});
    }
    if(action==='printed'){
      // One atomic D1 batch for up to 100 physical print confirmations.
      // Opening a browser print dialog NEVER changes the database.
      const marks=ids.map(()=>'?').join(',');
      const stamp=new Date().toISOString();
      const batch=await db.batch([
        db.prepare(`INSERT INTO envelope_progress(order_id,updated_by)
          SELECT id,? FROM orders WHERE id IN (${marks}) AND shipping_status IN ('not_ready','ready')
          ON CONFLICT(order_id) DO NOTHING`).bind(actor,...ids),
        db.prepare(`UPDATE envelope_progress SET printed_at=?,updated_by=?
          WHERE order_id IN (${marks}) AND printed_at IS NULL AND packed_at IS NULL
          AND EXISTS(SELECT 1 FROM orders WHERE orders.id=envelope_progress.order_id
            AND shipping_status IN ('not_ready','ready'))`).bind(stamp,actor,...ids),
        db.prepare(`INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,metadata_json)
          SELECT lower(hex(randomblob(16))),?,'envelope.printed','order',ep.order_id,'{}'
          FROM envelope_progress ep WHERE ep.order_id IN (${marks})
            AND ep.printed_at=? AND ep.updated_by=?`).bind(actor,...ids,stamp,actor)
      ]);
      const changed=batch[1].meta?.changes||0;
      if(!changed)fail(409,'Keine Umschläge bestätigt. Bitte Druckstatus prüfen.');
      return json({changed,requested:ids.length});
    }
    let changed=0;
    for(const id of ids){
      if(action==='unprinted'){
        const r=await db.prepare(`UPDATE envelope_progress SET printed_at=NULL,updated_by=?
          WHERE order_id=? AND printed_at IS NOT NULL AND packed_at IS NULL
          AND EXISTS(SELECT 1 FROM orders WHERE id=? AND shipping_status IN ('not_ready','ready'))`).bind(actor,id,id).run();
        changed+=r.meta?.changes||0;
        if(r.meta?.changes)await audit(db,actor,'envelope.print_reversed','order',id).run();
      }else if(action==='packed'){
        const r=await db.prepare(`UPDATE envelope_progress SET packed_at=CURRENT_TIMESTAMP,updated_by=?
          WHERE order_id=? AND printed_at IS NOT NULL AND packed_at IS NULL
          AND EXISTS(SELECT 1 FROM orders WHERE id=? AND shipping_status IN ('not_ready','ready')
            AND (qty_kombi+qty_matrosen+qty_seemann)>0 AND ${orderCompleteClause()})`).bind(actor,id,id).run();
        changed+=r.meta?.changes||0;
        if(r.meta?.changes)await audit(db,actor,'envelope.packed','order',id).run();
      }else {
        const r=await db.prepare(`UPDATE envelope_progress SET packed_at=NULL,updated_by=?
          WHERE order_id=? AND packed_at IS NOT NULL
          AND EXISTS(SELECT 1 FROM orders WHERE id=? AND shipping_status IN ('not_ready','ready'))`).bind(actor,id,id).run();
        changed+=r.meta?.changes||0;
        if(r.meta?.changes)await audit(db,actor,'envelope.unpack_reversed','order',id).run();
      }
    }
    if(!changed)fail(409,'Keine Statusänderung möglich. Bestellung oder Voraussetzung prüfen.');
    return json({changed,requested:ids.length});
  }
  if(method==='POST'&&path==='/api/test-order'){
    // A reproducible demo order with fictional address. No customer input and no migration.
    const existing=await db.prepare("SELECT id FROM orders WHERE sales_channel='internal_test' AND internal_note='SYSTEMTEST - keine echte Bestellung' AND shipping_status='not_ready' LIMIT 1").first();
    if(existing)return json(await getOrder(db,existing.id,role));
    const cid=makeId(),id=makeId(),stamp=new Date().toISOString();
    const external='DEMO-2027-'+id.slice(0,8);
    await db.batch([
      db.prepare(`INSERT INTO customers(id,full_name,address_line1,address_line2,postal_code,city,country,email,phone,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,NULL,NULL,?,?)`)
        .bind(cid,'Max Mustermann','Musterstraße 12',null,'12345','Musterstadt','DE',stamp,stamp),
      db.prepare(`INSERT INTO orders(id,customer_id,external_order_id,sales_channel,total_amount_cents,postage_cents,
        paid_amount_cents,payment_status,shipping_status,qty_kombi,qty_matrosen,qty_seemann,internal_note,created_at,updated_at)
        VALUES(?,?,?,'internal_test',0,0,0,'unpaid','not_ready',0,1,0,'SYSTEMTEST - keine echte Bestellung',?,?)`)
        .bind(id,cid,external,stamp,stamp),
      audit(db,actor,'test_order.created','order',id,{kind:'demo',ticket_type:'Matrosen'})
    ]);
    return json(await getOrder(db,id,role),201);
  }
  if(method==='POST'&&path==='/api/test-order/delete'){
    const b=await readBody(request),id=clean(b.order_id,80);
    if(!/^[0-9a-f-]{36}$/.test(id))fail(400,'Ungültige Testbestellung.');
    const order=await db.prepare('SELECT id,customer_id,sales_channel,internal_note,shipping_status FROM orders WHERE id=?').bind(id).first();
    if(!order||order.sales_channel!=='internal_test'||order.internal_note!=='SYSTEMTEST - keine echte Bestellung')
      fail(403,'Nur eigens angelegte Testbestellungen dürfen gelöscht werden.');
    if(!['not_ready','ready'].includes(order.shipping_status))fail(409,'Eine versendete Bestellung wird nicht gelöscht.');
    const hasPayments=await db.prepare('SELECT 1 FROM payments WHERE order_id=? LIMIT 1').bind(id).first();
    if(hasPayments)fail(409,'Bestellung hat Zahlungen. Test nicht automatisch löschen.');
    const unsafe=await db.prepare(`SELECT code FROM tickets WHERE order_id=? AND
      (status<>'assigned' OR admitted_at IS NOT NULL OR
       EXISTS(SELECT 1 FROM scan_events s WHERE s.ticket_code=tickets.code AND s.event_type='accepted')) LIMIT 1`).bind(id).first();
    if(unsafe)fail(409,'Ein Ticket besitzt Einlassdaten oder einen abweichenden Status. Bitte manuell prüfen.');
    const hasEnvelope=await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='envelope_progress'").first();
    const statements=[
      db.prepare(`UPDATE tickets SET order_id=NULL,status='available',assigned_at=NULL,holder_name=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE order_id=? AND status='assigned' AND admitted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM scan_events s WHERE s.ticket_code=tickets.code AND s.event_type='accepted')`).bind(id)
    ];
    if(hasEnvelope)statements.push(db.prepare('DELETE FROM envelope_progress WHERE order_id=?').bind(id));
    statements.push(
      db.prepare(`DELETE FROM orders WHERE id=? AND sales_channel='internal_test' AND internal_note='SYSTEMTEST - keine echte Bestellung'
        AND shipping_status IN ('not_ready','ready') AND NOT EXISTS(SELECT 1 FROM payments WHERE order_id=?)`).bind(id,id),
      db.prepare('DELETE FROM customers WHERE id=? AND NOT EXISTS(SELECT 1 FROM orders WHERE customer_id=?)').bind(order.customer_id,order.customer_id),
      audit(db,actor,'test_order.deleted','order',id,{kind:'demo',tickets_released:true})
    );
    // D1 batch is transactional: on any failure the whole batch rolls back.
    const result=await db.batch(statements);
    const orderDeleteIndex=hasEnvelope?2:1;
    if((result[orderDeleteIndex]?.meta?.changes||0)!==1)fail(409,'Testbestellung konnte nicht vollständig gelöscht werden. Bitte Bestand prüfen.');
    return json({deleted:true,released:result[0]?.meta?.changes||0});
  }
  if(method==='POST'&&path==='/api/orders'){
    const b=await readBody(request), full_name=clean(b.full_name,120);
    if(full_name.length<2)fail(400,'Kundenname fehlt.');
    const address=clean(b.address_line1,180),postal=clean(b.postal_code,20),city=clean(b.city,90);
    const email=clean(b.email,150),phone=clean(b.phone,50),note=clean(b.internal_note,500);
    if(!address||!postal||!city)fail(400,'Vollständige Versandanschrift erforderlich.');
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Ungültige E-Mail-Adresse.');
    const qK=integer(b.qty_kombi,'Kombi',500),qM=integer(b.qty_matrosen,'Matrosen',100),qS=integer(b.qty_seemann,'Seemann',100);
    if(qK+qM+qS<1||qK+qM+qS>100)fail(400,'Mindestens ein Ticket, maximal 100 pro Bestellung.');
    const total=integer(b.total_amount_cents,'Bestellbetrag');
    const postage=integer(b.postage_cents??0,'Versandbetrag');
    const channel=clean(b.sales_channel,40)||'manual';
    if(!['manual','online','sales_point','other'].includes(channel))fail(400,'Ungültiger Verkaufskanal.');
    const external=clean(b.external_order_id,80)||null;
    const cid=makeId(),id=makeId(),stamp=new Date().toISOString();
    await db.batch([
      db.prepare('INSERT INTO customers(id,full_name,address_line1,address_line2,postal_code,city,country,email,phone,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .bind(cid,full_name,address,clean(b.address_line2,180)||null,postal,city,'DE',email||null,phone||null,stamp,stamp),
      db.prepare(`INSERT INTO orders(id,customer_id,external_order_id,sales_channel,total_amount_cents,postage_cents,paid_amount_cents,payment_status,shipping_status,qty_kombi,qty_matrosen,qty_seemann,internal_note,created_at,updated_at)
        VALUES(?,?,?,?,?,?,0,'unpaid','not_ready',?,?,?,?,?,?)`)
        .bind(id,cid,external,channel,total,postage,qK,qM,qS,note||null,stamp,stamp),
      audit(db,actor,'order.created','order',id,{external,qK,qM,qS,total})
    ]);
    return json(await getOrder(db,id,role),201);
  }
  const match=path.match(/^\/api\/orders\/([a-f0-9-]{36})(?:\/(assign|unassign|payment|dispatch|customer))?$/);
  if(match){
    const id=match[1],op=match[2];
    if(role==='dispatch'){
      const row=await db.prepare('SELECT sales_channel FROM orders WHERE id=?').bind(id).first();
      if(row?.sales_channel==='internal_test')fail(403,'Testbestellungen dürfen nicht über den Versandzugang bearbeitet werden.');
    }
    if(method==='GET'&&!op)return json(await getOrder(db,id,role));
    if(method==='POST'&&op==='assign'){
      const b=await readBody(request),code=parseCode(b.code);
      if(!code)fail(400,'QR-Code hat kein gültiges Ticketformat.');
      const existing=await db.prepare('SELECT code,ticket_type,status,order_id FROM tickets WHERE code=?').bind(code).first();
      if(!existing)fail(404,'Dieser QR-Code gehört nicht zu den importierten 700 Tickets.');
      if(existing.order_id){
        if(existing.order_id===id)fail(409,'Dieses Ticket ist der Bestellung bereits zugeordnet.');
        fail(409,'Dieses Ticket ist schon einer anderen Bestellung zugeordnet.');
      }
      if(existing.status!=='available')fail(409,'Ticket ist gesperrt oder nicht verfügbar.');
      const order=await db.prepare('SELECT shipping_status FROM orders WHERE id=?').bind(id).first();
      if(!order)fail(404,'Bestellung nicht gefunden.');
      if(order.shipping_status==='sent'||order.shipping_status==='handed_over'||order.shipping_status==='cancelled')fail(409,'Bestellung nicht mehr bearbeitbar.');
      const stamp=new Date().toISOString();
      const update=await db.batch([
        db.prepare(`UPDATE tickets SET order_id=?,status='assigned',assigned_at=?,updated_at=?
          WHERE code=? AND status='available' AND order_id IS NULL
          AND EXISTS(SELECT 1 FROM orders WHERE id=? AND shipping_status IN ('not_ready','ready'))
          AND (SELECT COUNT(*) FROM tickets WHERE order_id=? AND ticket_type=tickets.ticket_type)
            < (SELECT CASE tickets.ticket_type WHEN 'Kombi' THEN qty_kombi WHEN 'Matrosen' THEN qty_matrosen ELSE qty_seemann END FROM orders WHERE id=?)`)
          .bind(id,stamp,stamp,code,id,id,id),
        db.prepare(`INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,metadata_json)
          SELECT ?,?,'ticket.assigned','ticket',?,? WHERE EXISTS (SELECT 1 FROM tickets WHERE code=? AND order_id=? AND assigned_at=?)`)
          .bind(makeId(),actor,code,JSON.stringify({order_id:id}),code,id,stamp)
      ]);
      if((update[0]?.meta?.changes||0)!==1)fail(409,'Ticketart bereits vollständig oder Ticket zwischenzeitlich vergeben.');
      return json(await getOrder(db,id,role));
    }
    if(method==='POST'&&op==='customer'){
      const b=await readBody(request);
      const name=clean(b.full_name,120),address=clean(b.address_line1,180),postal=clean(b.postal_code,20),city=clean(b.city,90);
      const email=clean(b.email,150),phone=clean(b.phone,50);
      if(name.length<2||!address||!postal||!city)fail(400,'Name oder Versandanschrift unvollständig.');
      if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Ungültige E-Mail-Adresse.');
      const changed=await db.prepare(`UPDATE customers SET full_name=?,address_line1=?,address_line2=?,postal_code=?,city=?,email=?,phone=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=(SELECT customer_id FROM orders WHERE id=? AND shipping_status NOT IN ('sent','handed_over'))`)
        .bind(name,address,clean(b.address_line2,180)||null,postal,city,email||null,phone||null,id).run();
      if((changed.meta?.changes||0)!==1)fail(409,'Anschrift konnte nicht geändert werden; Bestellung möglicherweise bereits versendet.');
      await audit(db,actor,'customer.updated','order',id).run();
      return json(await getOrder(db,id,role));
    }
    if(method==='POST'&&op==='unassign'){
      const b=await readBody(request),code=parseCode(b.code);
      if(!code)fail(400,'Ungültige Ticketkennung.');
      const order=await db.prepare('SELECT shipping_status FROM orders WHERE id=?').bind(id).first();
      if(!order||!['not_ready','ready'].includes(order.shipping_status))fail(409,'Zuordnung nach Versand nicht mehr korrigierbar.');
      await ensureEnvelopeSchema(db);
      const packed=await db.prepare('SELECT 1 FROM envelope_progress WHERE order_id=? AND packed_at IS NOT NULL').bind(id).first();
      if(packed)fail(409,'Umschlag bereits als verpackt bestätigt. Erst Verpackungsstatus zurücknehmen.');
      const changed=await db.prepare(`UPDATE tickets SET order_id=NULL,status='available',assigned_at=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE code=? AND order_id=? AND status='assigned' AND admitted_at IS NULL
        AND EXISTS(SELECT 1 FROM orders WHERE id=? AND shipping_status IN ('not_ready','ready'))
        AND NOT EXISTS(SELECT 1 FROM envelope_progress WHERE order_id=? AND packed_at IS NOT NULL)`).bind(code,id,id,id).run();
      if((changed.meta?.changes||0)!==1)fail(409,'Ticket konnte nicht freigegeben werden.');
      await db.batch([
        db.prepare("UPDATE orders SET shipping_status='not_ready',updated_at=CURRENT_TIMESTAMP WHERE id=? AND shipping_status='ready'").bind(id),
        audit(db,actor,'ticket.unassigned','ticket',code,{order_id:id})
      ]);
      return json(await getOrder(db,id,role));
    }
    if(method==='POST'&&op==='payment'){
      const b=await readBody(request),direction=clean(b.direction,20),method=clean(b.method,20),reference=clean(b.reference,100);
      if(!['received','refunded'].includes(direction)||!['bank','cash','card','other'].includes(method))fail(400,'Zahlungsart ungültig.');
      const amount=positive(b.amount_cents,'Betrag');
      const payid=clean(b.idempotency_key,80);
      if(!/^[0-9a-f-]{36}$/.test(payid))fail(400,'Buchungs-ID fehlt.');
      const order=await db.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
      if(!order)fail(404,'Bestellung nicht gefunden.');
      if(order.sales_channel==='internal_test')fail(409,'Testbestellung: keine echten Zahlungen buchen.');
      const previously=await db.prepare('SELECT * FROM payments WHERE id=?').bind(payid).first();
      if(previously){
        if(previously.order_id!==id||previously.direction!==direction||previously.method!==method||previously.amount_cents!==amount||
          (previously.reference||'')!==reference)fail(409,'Buchungs-ID wird bereits für eine andere Zahlung verwendet.');
        return json(await getOrder(db,id,role));
      }
      if(order.shipping_status==='cancelled')fail(409,'Stornierte Bestellung.');
      if(direction==='refunded'&&amount>order.paid_amount_cents)fail(409,'Erstattung darf die vorhandenen Zahlungseingänge nicht überschreiten.');
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO payments(id,order_id,direction,method,amount_cents,reference,created_by)
          VALUES(?,?,?,?,?,?,?)`).bind(payid,id,direction,method,amount,reference||null,actor),
        db.prepare(`UPDATE orders SET paid_amount_cents=(SELECT COALESCE(SUM(CASE WHEN direction='received' THEN amount_cents ELSE -amount_cents END),0) FROM payments WHERE order_id=?),
          payment_status=(CASE
            WHEN (SELECT COALESCE(SUM(CASE WHEN direction='received' THEN amount_cents ELSE -amount_cents END),0) FROM payments WHERE order_id=?)=0
              THEN (CASE WHEN EXISTS(SELECT 1 FROM payments WHERE order_id=? AND direction='refunded') THEN 'refunded' ELSE 'unpaid' END)
            WHEN (SELECT COALESCE(SUM(CASE WHEN direction='received' THEN amount_cents ELSE -amount_cents END),0) FROM payments WHERE order_id=?)>=total_amount_cents THEN 'paid'
            ELSE 'partial' END),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(id,id,id,id,id),
        db.prepare(`INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,metadata_json)
          SELECT ?,?,'payment.recorded','payment',?,? WHERE EXISTS (SELECT 1 FROM payments WHERE id=? AND order_id=?)`)
          .bind(makeId(),actor,payid,JSON.stringify({order_id:id,direction,amount,method}),payid,id)
      ]);
      return json(await getOrder(db,id,role));
    }
    if(method==='POST'&&op==='dispatch'){
      await ensureEnvelopeSchema(db);
      const b=await readBody(request),status=clean(b.status,30);
      if(!['ready','sent'].includes(status))fail(400,'Ungültiger Versandstatus.');
      const shipped=status==='sent';
      const res=await db.prepare(`UPDATE orders SET shipping_status=?,shipped_at=(CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE shipped_at END),updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND shipping_status IN ('not_ready','ready') AND payment_status='paid'
          AND (qty_kombi+qty_matrosen+qty_seemann)>0 AND ${orderCompleteClause()}
          AND EXISTS(SELECT 1 FROM envelope_progress ep WHERE ep.order_id=orders.id AND ep.packed_at IS NOT NULL)`).bind(status,shipped?1:0,id).run();
      if((res.meta?.changes||0)!==1)fail(409,'Versand nicht möglich: Zahlung oder Ticketzuordnung unvollständig, oder bereits versendet.');
      await audit(db,actor,shipped?'order.sent':'order.ready','order',id).run();
      return json(await getOrder(db,id,role));
    }
  }
  if(method==='POST'&&path==='/api/tickets/import'){
    const b=await readBody(request);
    if(!Array.isArray(b.urls)||b.urls.length<1||b.urls.length>150)fail(400,'Pro Import 1–150 Codes.');
    const map=new Map();
    for(const value of b.urls){
      const code=parseCode(value);
      if(!code)fail(400,'Ungültige Ticket-URL in der Liste.');
      const url=`https://sturmflutfestival.de/info/?t=${code}`;
      map.set(code,{url,type:types[code[0]]});
    }
    const items=[...map].map(([code,entry])=>db.prepare(`INSERT OR IGNORE INTO tickets(code,qr_url,ticket_type,print_batch,status)
      VALUES(?,?,?,'SFO27-01','available')`).bind(code,entry.url,entry.type));
    const result=await db.batch(items);
    const added=result.reduce((sum,item)=>sum+(item.meta?.changes||0),0);
    const count=await db.prepare('SELECT COUNT(*) AS total FROM tickets').first();
    return json({received:b.urls.length,distinct:map.size,added,total:count.total});
  }
  fail(404,'Unbekannter Vorgang.');
}
export default {
  async fetch(request, env){
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/'))return new Response('Nicht gefunden',{status:404,headers:COMMON_HEADERS});
    try{
      if(request.method==='POST')enforceOrigin(request);
      const actor=await accessEmail(request,env);
      return await handleApi(request,env,actor);
    }catch(e){
      if(e.status)return json({error:e.message},e.status);
      console.error('SturmKnoten server error',e?.message||'unknown');
      return json({error:'Serverfehler. Der Vorgang wurde nicht bestätigt. Bitte Status prüfen.'},500);
    }
  }
};