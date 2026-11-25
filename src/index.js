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
const reviewMap={unchecked:'unpaid',open:'unpaid',paid:'paid',partial:'partial',refunded:'refunded',partial_refund:'partial'};
const reviewExpr="COALESCE(r.state,CASE o.payment_status WHEN 'paid' THEN 'paid' WHEN 'partial' THEN 'partial' WHEN 'refunded' THEN 'refunded' ELSE 'unchecked' END)";
let reviewInit=null;
async function ensureReviewSchema(db){
  if(!reviewInit){reviewInit=db.prepare("CREATE TABLE IF NOT EXISTS order_review (order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE, state TEXT NOT NULL CHECK(state IN ('unchecked','open','paid','partial','refunded','partial_refund')), order_date TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();reviewInit.catch(()=>{reviewInit=null;});}
  await reviewInit;
}
async function getOrder(db,id,role='admin'){
  const order=await db.prepare(`SELECT o.id,o.external_order_id,o.sales_channel,o.payment_status,o.shipping_status,o.qty_kombi,o.qty_matrosen,o.qty_seemann,o.internal_note,o.created_at,o.updated_at,o.shipped_at,
    c.full_name,c.address_line1,c.address_line2,c.postal_code,c.city,c.country,c.email,c.phone,r.order_date,${reviewExpr} AS review_state
    FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN order_review r ON r.order_id=o.id WHERE o.id=?`).bind(id).first();
  if(!order)fail(404,'Bestellung nicht gefunden.');
  if(role==='dispatch'&&order.sales_channel==='internal_test')fail(403,'Testbestellung nicht freigegeben.');
  const tickets=await db.prepare('SELECT code,ticket_type,assigned_at FROM tickets WHERE order_id=? ORDER BY assigned_at,code').bind(id).all();
  return {order,tickets:tickets.results||[]};
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
// Physical ticket custody for off-site sales points; no admission or sale is implied.
let salesPointSchemaReady=null;
async function ensureSalesPointSchema(db){
  if(!salesPointSchemaReady){
    salesPointSchemaReady=(async()=>{
      await db.prepare(`CREATE TABLE IF NOT EXISTS sales_points (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`).run();
      await db.prepare(`CREATE TABLE IF NOT EXISTS sales_point_tickets (
        ticket_code TEXT PRIMARY KEY REFERENCES tickets(code) ON DELETE RESTRICT,
        point_id TEXT NOT NULL REFERENCES sales_points(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status IN ('at_point','returned')),
        issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        returned_at TEXT,
        updated_by TEXT NOT NULL,
        CHECK (status <> 'at_point' OR returned_at IS NULL)
      )`).run();
      await db.prepare('CREATE INDEX IF NOT EXISTS idx_sales_point_tickets_point ON sales_point_tickets(point_id,status)').run();
    })();
    salesPointSchemaReady.catch(()=>{salesPointSchemaReady=null;});
  }
  return salesPointSchemaReady;
}
function audit(db,actor,action,entity,id,metadata={}){
  return db.prepare('INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,metadata_json) VALUES (?,?,?,?,?,?)')
    .bind(makeId(),actor,action,entity,id,JSON.stringify(metadata).slice(0,2000));
}

// Explicitly allow only operational routes for the second organizer.
// This is server-side authorization: hidden buttons or direct API calls cannot bypass it.
function dispatchAllowed(method,path){
  if(method==='GET'&&['/api/me','/api/overview','/api/orders','/api/envelopes','/api/sales-points'].includes(path))return true;
  if(method==='GET'&&/^\/api\/sales-points\/[a-f0-9-]{36}\/tickets$/.test(path))return true;
  if(method==='POST'&&path==='/api/tickets/check')return true;
  if(method==='POST'&&['/api/orders','/api/orders/import','/api/sales-points'].includes(path))return true;
  if(method==='POST'&&/^\/api\/sales-points\/[a-f0-9-]{36}\/(issue|return)$/.test(path))return true;
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
  await ensureReviewSchema(db);
  if(role==='dispatch'&&method==='POST'&&path==='/api/envelopes/status'){
    // Do not allow fictitious test prints from a real shipping account.
    const input=await request.clone().json().catch(()=>null);
    if(input?.action==='demo_printed')fail(403,'Testfunktionen sind ausschließlich für die Administration.');
  }
  if(method==='GET'&&path==='/api/sales-points'){
    await ensureSalesPointSchema(db);
    const [points,totals]=await Promise.all([
      db.prepare(`SELECT p.id,p.name,
        COUNT(CASE WHEN s.status='at_point' THEN 1 END) AS ticket_count,
        COUNT(CASE WHEN s.status='at_point' AND t.ticket_type='Kombi' THEN 1 END) AS kombi_count,
        COUNT(CASE WHEN s.status='at_point' AND t.ticket_type='Matrosen' THEN 1 END) AS matrosen_count,
        COUNT(CASE WHEN s.status='at_point' AND t.ticket_type='Seemann' THEN 1 END) AS seemann_count
        FROM sales_points p LEFT JOIN sales_point_tickets s ON s.point_id=p.id
        LEFT JOIN tickets t ON t.code=s.ticket_code
        GROUP BY p.id,p.name ORDER BY p.name COLLATE NOCASE`).all(),
      db.prepare(`SELECT COUNT(*) AS free FROM tickets t WHERE t.status='available'
        AND t.order_id IS NULL AND t.admitted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM sales_point_tickets s WHERE s.ticket_code=t.code AND s.status='at_point')`).first()
    ]);
    return json({points:points.results||[],free:totals?.free||0});
  }
  if(method==='POST'&&path==='/api/sales-points'){
    await ensureSalesPointSchema(db);
    const b=await readBody(request),name=clean(b.name,90);
    if(name.length<2||/[<>\\]/.test(name))fail(400,'Name der Verkaufsstelle ungültig.');
    const id=makeId();
    const r=await db.prepare('INSERT OR IGNORE INTO sales_points(id,name) VALUES (?,?)').bind(id,name).run();
    const point=await db.prepare('SELECT id,name FROM sales_points WHERE name=? COLLATE NOCASE').bind(name).first();
    if(r.meta?.changes)await audit(db,actor,'sales_point.created','sales_point',id,{name}).run();
    return json({point,created:Boolean(r.meta?.changes)});
  }
  const pointPath=path.match(/^\/api\/sales-points\/([a-f0-9-]{36})\/(tickets|issue|return)$/);
  if(pointPath){
    await ensureSalesPointSchema(db);
    const pointId=pointPath[1],action=pointPath[2];
    const point=await db.prepare('SELECT id,name FROM sales_points WHERE id=?').bind(pointId).first();
    if(!point)fail(404,'Verkaufsstelle nicht gefunden.');
    if(method==='GET'&&action==='tickets'){
      const result=await db.prepare(`SELECT s.ticket_code AS code,t.ticket_type,s.issued_at
        FROM sales_point_tickets s JOIN tickets t ON t.code=s.ticket_code
        WHERE s.point_id=? AND s.status='at_point' ORDER BY s.issued_at DESC,s.ticket_code DESC
        LIMIT 1000`).bind(pointId).all();
      return json({point,tickets:result.results||[]});
    }
    if(method==='POST'&&(action==='issue'||action==='return')){
      const b=await readBody(request),code=parseCode(b.code);
      if(!code)fail(400,'Kein gültiger Sturmflut-Ticketcode.');
      const ticket=await db.prepare('SELECT code,ticket_type,status,order_id,admitted_at FROM tickets WHERE code=?').bind(code).first();
      if(!ticket)fail(404,'Dieser Ticketcode ist nicht importiert.');
      let r;
      if(action==='issue'){
        if(ticket.status!=='available'||ticket.order_id||ticket.admitted_at)
          fail(409,'Ticket nicht frei: bereits zugeordnet, gesperrt oder entwertet.');
        r=await db.prepare(`INSERT INTO sales_point_tickets(ticket_code,point_id,status,issued_at,returned_at,updated_by)
          SELECT t.code,?,'at_point',CURRENT_TIMESTAMP,NULL,? FROM tickets t
          WHERE t.code=? AND t.status='available' AND t.order_id IS NULL AND t.admitted_at IS NULL
          AND NOT EXISTS(SELECT 1 FROM sales_point_tickets s WHERE s.ticket_code=t.code AND s.status='at_point')
          ON CONFLICT(ticket_code) DO UPDATE SET
            point_id=excluded.point_id,status='at_point',issued_at=excluded.issued_at,
            returned_at=NULL,updated_by=excluded.updated_by
          WHERE sales_point_tickets.status='returned'
          AND EXISTS(SELECT 1 FROM tickets t WHERE t.code=excluded.ticket_code
            AND t.status='available' AND t.order_id IS NULL AND t.admitted_at IS NULL)`)
          .bind(pointId,actor,code).run();
        if((r.meta?.changes||0)!==1){
          const existing=await db.prepare(`SELECT p.name FROM sales_point_tickets s JOIN sales_points p
            ON p.id=s.point_id WHERE s.ticket_code=? AND s.status='at_point'`).bind(code).first();
          fail(409,existing?'Ticket ist bereits bei '+existing.name+'.':'Ticket kann nicht ausgegeben werden.');
        }
        await audit(db,actor,'sales_point.ticket_issued','ticket',code,{point_id:pointId,ticket_type:ticket.ticket_type}).run();
      }else{
        r=await db.prepare(`UPDATE sales_point_tickets SET status='returned',returned_at=CURRENT_TIMESTAMP,updated_by=?
          WHERE ticket_code=? AND point_id=? AND status='at_point'
          AND EXISTS(SELECT 1 FROM tickets t WHERE t.code=sales_point_tickets.ticket_code
            AND t.order_id IS NULL AND t.status='available' AND t.admitted_at IS NULL)`)
          .bind(actor,code,pointId).run();
        if((r.meta?.changes||0)!==1)fail(409,'Dieses Ticket ist dieser Verkaufsstelle nicht als Bestand zugeordnet.');
        await audit(db,actor,'sales_point.ticket_returned','ticket',code,{point_id:pointId,ticket_type:ticket.ticket_type}).run();
      }
      return json({ok:true,action,ticket_type:ticket.ticket_type,point_name:point.name});
    }
  }
  if(method==='POST'&&path==='/api/tickets/check'){
    // Read-only QR test. Never assign, redeem, or log a ticket as scanned.
    const b=await readBody(request);
    const code=parseCode(b.code);
    if(!code)return json({recognized:false,reason:'format'});
    await ensureSalesPointSchema(db);
    const ticket=await db.prepare(`SELECT t.ticket_type,t.status,t.order_id,p.name AS sales_point_name
      FROM tickets t LEFT JOIN sales_point_tickets s ON s.ticket_code=t.code AND s.status='at_point'
      LEFT JOIN sales_points p ON p.id=s.point_id WHERE t.code=?`).bind(code).first();
    if(!ticket)return json({recognized:false,reason:'unknown'});
    return json({recognized:true,ticket_type:ticket.ticket_type,status:ticket.status,
      assigned:Boolean(ticket.order_id),sales_point:ticket.sales_point_name||null});
  }
  if(method==='GET'&&path==='/api/overview'){
    const [tickets,orders]=await Promise.all([
      db.prepare(`SELECT ticket_type,status,COUNT(*) AS count FROM tickets GROUP BY ticket_type,status`).all(),
      db.prepare(`SELECT COUNT(*) AS orders,SUM(CASE WHEN payment_status='paid' AND shipping_status<>'cancelled' THEN 1 ELSE 0 END) AS paid_orders,
        SUM(CASE WHEN shipping_status='sent' THEN 1 ELSE 0 END) AS sent FROM orders`).first()
    ]);
    return json({tickets:tickets.results||[],orders});
  }
  if(method==='GET'&&path==='/api/orders'){
    const q=clean(url.searchParams.get('q'),80);
    const rows=await db.prepare(`SELECT o.id,o.external_order_id,o.created_at,o.payment_status,o.shipping_status,o.sales_channel,
      o.updated_at,o.qty_kombi,o.qty_matrosen,o.qty_seemann,c.full_name,o.internal_note,r.order_date,${reviewExpr} AS review_state,
      (SELECT COUNT(*) FROM tickets WHERE order_id=o.id) AS assigned_count
      FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN order_review r ON r.order_id=o.id
      WHERE (?='' OR c.full_name LIKE ? OR o.external_order_id LIKE ?)
        AND (?='admin' OR o.sales_channel<>'internal_test')
      ORDER BY o.created_at DESC,o.id DESC LIMIT 1000`).bind(q,`%${q}%`,`%${q}%`,role).all();
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
      WHERE (o.payment_status='paid' OR o.sales_channel='internal_test' OR o.shipping_status='sent') AND o.shipping_status<>'cancelled' AND (?='admin' OR o.sales_channel<>'internal_test')
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
          SELECT id,? FROM orders WHERE id IN (${marks}) AND shipping_status IN ('not_ready','ready') AND (payment_status='paid' OR sales_channel='internal_test')
          ON CONFLICT(order_id) DO NOTHING`).bind(actor,...ids),
        db.prepare(`UPDATE envelope_progress SET printed_at=?,updated_by=?
          WHERE order_id IN (${marks}) AND printed_at IS NULL AND packed_at IS NULL
          AND EXISTS(SELECT 1 FROM orders WHERE orders.id=envelope_progress.order_id
            AND shipping_status IN ('not_ready','ready') AND (payment_status='paid' OR sales_channel='internal_test'))`).bind(stamp,actor,...ids),
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
            AND (payment_status='paid' OR sales_channel='internal_test') AND (qty_kombi+qty_matrosen+qty_seemann)>0 AND ${orderCompleteClause()})`).bind(actor,id,id).run();
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
  if(method==='POST'&&path==='/api/orders/import'){
    // Server-side CSV mapped import. Never infer prices or mark shipping as sent.
    // Import is idempotent by the external shop order number.
    const b=await readBody(request);
    if(!Array.isArray(b.orders)||b.orders.length<1||b.orders.length>20)
      fail(400,'Je Importvorgang 1 bis 20 Bestellungen.');
    const seen=new Set(),checked=[];
    for(const x of b.orders){
      if(!x||typeof x!=='object'||Array.isArray(x))fail(400,'Importzeile ungültig.');
      const external=clean(x.external_order_id,80);
      if(!external||seen.has(external))fail(400,'Jede Zeile benötigt eine eindeutige Bestellnummer.');
      seen.add(external);
      const name=clean(x.full_name,120),street=clean(x.address_line1,180),
        postal=clean(x.postal_code,20),city=clean(x.city,90),
        email=clean(x.email,150),phone=clean(x.phone,50);
      if(name.length<2||!street||!postal||!city)fail(400,'Fehlende Lieferanschrift bei '+external);
      if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'E-Mail ungültig bei '+external);
      const qK=integer(x.qty_kombi,'Kombi',500),qM=integer(x.qty_matrosen,'Matrosen',100),
        qS=integer(x.qty_seemann,'Seemann',100);
      if(qK+qM+qS<1||qK+qM+qS>100)fail(400,'Ticketanzahl ungültig bei '+external);
      const orderDate=clean(x.order_date,10);
      if(orderDate&&!/^\d{4}-\d{2}-\d{2}$/.test(orderDate))fail(400,'Bestelldatum ungültig bei '+external);
      const existing=await db.prepare('SELECT id FROM orders WHERE external_order_id=?').bind(external).first();
      checked.push({external,name,street,postal,city,email,phone,add2:clean(x.address_line2,180),note:clean(x.internal_note,500),orderDate,
        qK,qM,qS,existing:Boolean(existing)});
    }
    let imported=0,skipped=0;const ids=[];
    for(const item of checked){
      if(item.existing){skipped++;continue;}
      const id=makeId(),customerId=makeId(),stamp=new Date().toISOString();
      const rows=[
        db.prepare(`INSERT INTO customers(id,full_name,address_line1,address_line2,postal_code,city,country,email,phone,created_at,updated_at)
          VALUES (?,?,?,?,?,?,'DE',?,?,?,?)`).bind(customerId,item.name,item.street,item.add2||null,item.postal,item.city,item.email||null,item.phone||null,stamp,stamp),
        db.prepare(`INSERT INTO orders(id,customer_id,external_order_id,sales_channel,payment_status,shipping_status,qty_kombi,qty_matrosen,qty_seemann,internal_note,created_at,updated_at)
          VALUES (?,?,?,'online','unpaid','not_ready',?,?,?,?,?,?)`).bind(id,customerId,item.external,item.qK,item.qM,item.qS,item.note||null,stamp,stamp),
        db.prepare("INSERT INTO order_review(order_id,state,order_date) VALUES (?,'unchecked',?)").bind(id,item.orderDate||null),
        audit(db,actor,'order.imported','order',id,{external:item.external})
      ];
      try{await db.batch(rows);}
      catch(err){
        // A concurrent import could have inserted the same order number.
        const present=await db.prepare('SELECT id FROM orders WHERE external_order_id=?').bind(item.external).first();
        if(present){skipped++;continue;}
        throw err;
      }
      imported++;ids.push(id);
    }
    return json({imported,skipped,received:checked.length,ids});
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
    const orderDate=clean(b.order_date,10);if(orderDate&&!/^\d{4}-\d{2}-\d{2}$/.test(orderDate))fail(400,'Bestelldatum ungültig.');
    const channel=clean(b.sales_channel,40)||'manual';
    if(!['manual','online','sales_point','other'].includes(channel))fail(400,'Ungültiger Verkaufskanal.');
    const external=clean(b.external_order_id,80)||null;
    const cid=makeId(),id=makeId(),stamp=new Date().toISOString();
    await db.batch([
      db.prepare('INSERT INTO customers(id,full_name,address_line1,address_line2,postal_code,city,country,email,phone,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .bind(cid,full_name,address,clean(b.address_line2,180)||null,postal,city,'DE',email||null,phone||null,stamp,stamp),
      db.prepare(`INSERT INTO orders(id,customer_id,external_order_id,sales_channel,payment_status,shipping_status,qty_kombi,qty_matrosen,qty_seemann,internal_note,created_at,updated_at)
        VALUES(?,?,?,?,'unpaid','not_ready',?,?,?,?,?,?)`)
        .bind(id,cid,external,channel,qK,qM,qS,note||null,stamp,stamp),
      db.prepare("INSERT INTO order_review(order_id,state,order_date) VALUES (?,'unchecked',?)").bind(id,orderDate||null),
      audit(db,actor,'order.created','order',id,{external,qK,qM,qS})
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
      await ensureSalesPointSchema(db);
      const b=await readBody(request),code=parseCode(b.code);
      if(!code)fail(400,'QR-Code hat kein gültiges Ticketformat.');
      const existing=await db.prepare('SELECT code,ticket_type,status,order_id FROM tickets WHERE code=?').bind(code).first();
      if(!existing)fail(404,'Dieser QR-Code gehört nicht zu den importierten 700 Tickets.');
      if(existing.order_id){
        if(existing.order_id===id)fail(409,'Dieses Ticket ist der Bestellung bereits zugeordnet.');
        fail(409,'Dieses Ticket ist schon einer anderen Bestellung zugeordnet.');
      }
      if(existing.status!=='available')fail(409,'Ticket ist gesperrt oder nicht verfügbar.');
      const allocated=await db.prepare(`SELECT p.name FROM sales_point_tickets s
        JOIN sales_points p ON p.id=s.point_id WHERE s.ticket_code=? AND s.status='at_point'`).bind(code).first();
      if(allocated)fail(409,'Ticket befindet sich bei Verkaufsstelle '+allocated.name+'.');
      const order=await db.prepare('SELECT shipping_status,payment_status,sales_channel FROM orders WHERE id=?').bind(id).first();
      if(!order)fail(404,'Bestellung nicht gefunden.');
      if(order.payment_status!=='paid'&&order.sales_channel!=='internal_test')fail(409,'Zahlung zuerst bestätigen.');
      if(order.shipping_status==='sent'||order.shipping_status==='handed_over'||order.shipping_status==='cancelled')fail(409,'Bestellung nicht mehr bearbeitbar.');
      const stamp=new Date().toISOString();
      const update=await db.batch([
        db.prepare(`UPDATE tickets SET order_id=?,status='assigned',assigned_at=?,updated_at=?
          WHERE code=? AND status='available' AND order_id IS NULL
          AND NOT EXISTS(SELECT 1 FROM sales_point_tickets sp WHERE sp.ticket_code=tickets.code AND sp.status='at_point')
          AND EXISTS(SELECT 1 FROM orders WHERE id=? AND shipping_status IN ('not_ready','ready') AND (payment_status='paid' OR sales_channel='internal_test'))
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
      const b=await readBody(request),state=clean(b.state,30);
      if(!Object.prototype.hasOwnProperty.call(reviewMap,state))fail(400,'Ungültiger Zahlungsstatus.');
      const {order}=await getOrder(db,id,role);
      if(order.sales_channel==='internal_test')fail(409,'Testbestellung: keine Zahlungsbestätigung.');
      if(b.expected_updated_at!==order.updated_at||b.expected_state!==order.review_state)fail(409,'Bestellung inzwischen geändert. Bitte neu laden.');
      const note=b.internal_note===undefined?order.internal_note:clean(b.internal_note,500);
      const cancel=b.cancel===true,edit=b.quantities!==undefined,shipping=order.shipping_status,open=['not_ready','ready'].includes(shipping);
      if((cancel||edit)&&!open)fail(409,'Mengen/Stornierung nur vor Versand möglich.');
      if(shipping==='cancelled')fail(409,'Bestellung bereits storniert.');
      if(edit&&(!b.quantities||typeof b.quantities!=='object'))fail(400,'Ticketmengen ungültig.');
      const qty=edit?['qty_kombi','qty_matrosen','qty_seemann'].map(k=>integer(b.quantities[k],k,100)):[order.qty_kombi,order.qty_matrosen,order.qty_seemann];
      if(qty.reduce((a,b)=>a+b,0)<1||qty.reduce((a,b)=>a+b,0)>100)fail(400,'Ticketmenge ungültig.');
      await ensureEnvelopeSchema(db);
      const stamp=new Date().toISOString().replace('Z','')+String(crypto.getRandomValues(new Uint32Array(1))[0]).padStart(10,'0')+'Z',marker=makeId(),nextShip=cancel?'cancelled':open&&(state!=='paid'||edit)?'not_ready':shipping;
      const result=await db.batch([
        db.prepare(`UPDATE orders SET payment_status=?,shipping_status=?,qty_kombi=?,qty_matrosen=?,qty_seemann=?,internal_note=?,updated_at=?
          WHERE id=? AND updated_at=? AND shipping_status=?
          AND (?=0 OR NOT EXISTS(SELECT 1 FROM tickets WHERE order_id=orders.id))
          AND (?=0 OR NOT EXISTS(SELECT 1 FROM envelope_progress WHERE order_id=orders.id AND packed_at IS NOT NULL))
          AND (SELECT COUNT(*) FROM tickets WHERE order_id=orders.id AND ticket_type='Kombi')<=?
          AND (SELECT COUNT(*) FROM tickets WHERE order_id=orders.id AND ticket_type='Matrosen')<=?
          AND (SELECT COUNT(*) FROM tickets WHERE order_id=orders.id AND ticket_type='Seemann')<=?`)
          .bind(reviewMap[state],nextShip,...qty,note||null,stamp,id,order.updated_at,shipping,cancel?1:0,open&&(cancel||edit||state!=='paid')?1:0,...qty),
        db.prepare(`INSERT INTO order_review(order_id,state,updated_at) SELECT id,?,? FROM orders WHERE id=? AND updated_at=?
          ON CONFLICT(order_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at`).bind(state,marker,id,stamp),
        db.prepare(`INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,metadata_json)
          SELECT ?,?,'order.review','order',?,? WHERE EXISTS(SELECT 1 FROM order_review WHERE order_id=? AND updated_at=?)`)
          .bind(makeId(),actor,id,JSON.stringify({before:{state:order.review_state,shipping,qty:[order.qty_kombi,order.qty_matrosen,order.qty_seemann]},after:{state,shipping:nextShip,qty},note_changed:(order.internal_note||'')!==note}),id,marker)
      ]);
      if(result[0].meta?.changes!==1||result[1].meta?.changes!==1)fail(409,'Nicht geändert: Verpackung zuerst lösen, bei Stornierung Tickets freigeben oder Bestellung neu laden.');
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