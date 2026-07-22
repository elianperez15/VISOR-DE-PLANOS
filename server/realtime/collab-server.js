/**
 * SAF Planos — Microservicio de colaboración en tiempo real
 * WebSocket nativo sobre Node.js puro (módulos http + crypto).
 *
 * SIN DEPENDENCIAS: no requiere `npm install`. Funciona en redes sin acceso
 * al registro npm (entornos corporativos cerrados).
 *
 * QUÉ HACE: solo RETRANSMITE (relay) los cambios de markup y los cursores
 *           entre los usuarios que miran el MISMO plano (sala = id documento).
 * QUÉ NO HACE: no toca Oracle ni guarda nada. La persistencia es 100 % por
 *           tus APIs de APEX/ORDS. Si este proceso se reinicia, no se pierde
 *           nada: al reconectar, el visor relee de ORDS.
 *
 * Arranque:
 *   cd server/realtime
 *   COLLAB_PORT=3100 COLLAB_ORIGINS="http://192.168.50.163" node collab-server.js
 *   (producción: pm2 start collab-server.js --name saf-collab)
 *
 * Variables de entorno:
 *   COLLAB_PORT     puerto de escucha            (def. 3100)
 *   COLLAB_ORIGINS  orígenes permitidos (CORS),  (def. *) — en prod pon el
 *                   origen del visor: "http://192.168.50.163". Coma para varios.
 */

const http   = require('http');
const crypto = require('crypto');

const PORT    = parseInt(process.env.COLLAB_PORT || '3100', 10);
const ORIGINS = (process.env.COLLAB_ORIGINS || '*')
  .split(',').map(s => s.trim()).filter(Boolean);
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';  // RFC 6455

/** socket → { id, doc, user, color, buf, frag, fragOp } */
const clients = new Map();

function originOk(origin) {
  if (ORIGINS.includes('*')) return true;
  if (!origin) return true;                 // clientes no-navegador
  return ORIGINS.includes(origin);
}

/* ── Servidor HTTP (healthcheck) + upgrade a WebSocket ─────────────────── */
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/rt/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, clients: clients.size }));
    return;
  }
  res.writeHead(404); res.end();
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || !req.url.startsWith('/rt') || !originOk(req.headers.origin)) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); socket.destroy(); return;
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  onConnect(socket);
});

/* ── Conexión ──────────────────────────────────────────────────────────── */
function onConnect(socket) {
  const c = {
    id: crypto.randomBytes(8).toString('hex'),
    socket, doc: null, user: 'Anónimo', color: '#64748b',
    buf: Buffer.alloc(0), frag: [], fragOp: 0,
  };
  clients.set(socket, c);
  socket.on('data',  d => { c.buf = Buffer.concat([c.buf, d]); processBuffer(c); });
  socket.on('close', () => handleClose(c));
  socket.on('error', () => { try { socket.destroy(); } catch {} handleClose(c); });
}

function handleClose(c) {
  if (!clients.has(c.socket)) return;
  clients.delete(c.socket);
  if (c.doc) broadcast(c.doc, { t: 'peer-leave', id: c.id }, c.id);
}

/* ── Decodificación de frames WebSocket (cliente → servidor: enmascarados) ── */
function processBuffer(c) {
  let buf = c.buf;
  while (true) {
    if (buf.length < 2) break;
    const b0 = buf[0], b1 = buf[1];
    const fin    = (b0 & 0x80) !== 0;
    const opcode =  b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let off = 2;

    if (len === 126)      { if (buf.length < 4)  break; len = buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (buf.length < 10) break;
      len = buf.readUInt32BE(2) * 4294967296 + buf.readUInt32BE(6); off = 10; }

    let mask;
    if (masked) { if (buf.length < off + 4) break; mask = buf.slice(off, off + 4); off += 4; }
    if (buf.length < off + len) break;                 // frame incompleto → esperar

    let payload = buf.slice(off, off + len);
    if (masked) {
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
      payload = out;
    }
    buf = buf.slice(off + len);
    handleFrame(c, fin, opcode, payload);
  }
  c.buf = buf;
}

function handleFrame(c, fin, opcode, payload) {
  if (opcode === 0x8) { closeSocket(c); return; }        // close
  if (opcode === 0x9) { sendFrame(c.socket, 0xA, payload); return; }  // ping → pong
  if (opcode === 0xA) { return; }                        // pong

  // Reensamblar fragmentos (0x0 = continuación)
  if (opcode === 0x0) c.frag.push(payload);
  else { c.frag = [payload]; c.fragOp = opcode; }
  if (!fin) return;

  const full = Buffer.concat(c.frag); c.frag = [];
  let msg; try { msg = JSON.parse(full.toString('utf8')); } catch { return; }
  handleMessage(c, msg);
}

/* ── Lógica de salas ───────────────────────────────────────────────────── */
function roomPeers(doc) {
  const out = [];
  for (const c of clients.values()) if (c.doc === doc) out.push({ id: c.id, user: c.user, color: c.color });
  return out;
}

function broadcast(doc, obj, exceptId) {
  const data = JSON.stringify(obj);
  for (const c of clients.values()) {
    if (c.doc === doc && c.id !== exceptId) sendText(c.socket, data);
  }
}

function handleMessage(c, m) {
  if (m.t === 'join') {
    c.doc   = String(m.doc);
    c.user  = m.user  || 'Anónimo';
    c.color = m.color || '#64748b';
    // 1) Al recién llegado: quiénes ya están
    sendText(c.socket, JSON.stringify({ t: 'peers', peers: roomPeers(c.doc).filter(p => p.id !== c.id) }));
    // 2) A los demás: hay un nuevo participante
    broadcast(c.doc, { t: 'peer-join', peer: { id: c.id, user: c.user, color: c.color } }, c.id);

  } else if (m.t === 'delta') {
    if (c.doc == null) return;
    broadcast(c.doc, { t: 'delta', doc: m.doc, page: m.page, autor: m.autor, json: m.json }, c.id);

  } else if (m.t === 'cursor') {
    if (c.doc == null) return;
    broadcast(c.doc, { t: 'cursor', id: c.id, user: c.user, color: c.color, doc: m.doc, page: m.page, x: m.x, y: m.y }, c.id);

  } else if (m.t === 'scale') {
    // Escala calibrada GLOBAL: se retransmite a toda la sala en tiempo real
    if (c.doc == null) return;
    broadcast(c.doc, { t: 'scale', doc: m.doc, scale: m.scale, autor: c.user }, c.id);
  }
}

/* ── Codificación de frames (servidor → cliente: SIN máscara) ──────────── */
function sendText(socket, str) { sendFrame(socket, 0x1, Buffer.from(str, 'utf8')); }

function sendFrame(socket, opcode, payload) {
  if (!socket.writable) return;
  const len = payload.length;
  let header;
  if (len <= 125)        { header = Buffer.allocUnsafe(2);  header[1] = len; }
  else if (len <= 65535) { header = Buffer.allocUnsafe(4);  header[1] = 126; header.writeUInt16BE(len, 2); }
  else                   { header = Buffer.allocUnsafe(10); header[1] = 127;
    header.writeUInt32BE(Math.floor(len / 4294967296), 2); header.writeUInt32BE(len >>> 0, 6); }
  header[0] = 0x80 | opcode;                            // FIN + opcode
  try { socket.write(Buffer.concat([header, payload])); } catch {}
}

function closeSocket(c) {
  try { sendFrame(c.socket, 0x8, Buffer.alloc(0)); c.socket.end(); } catch {}
  handleClose(c);
}

/* ── Heartbeat: ping cada 25 s para detectar conexiones muertas ────────── */
setInterval(() => {
  for (const c of clients.values()) sendFrame(c.socket, 0x9, Buffer.alloc(0));
}, 25000);

server.listen(PORT, () => {
  console.log(`[SAF collab] WebSocket escuchando en :${PORT} (ruta /rt/...)`);
  console.log(`[SAF collab] Orígenes permitidos: ${ORIGINS.join(', ') || '*'}`);
});
