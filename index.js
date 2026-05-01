const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('baileys');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR);

let sock = null;
let isConnecting = false;

// Iniciar Express UNA SOLA VEZ
app.listen(PORT, () => {
    console.log(`🌐 API del bot escuchando en puerto ${PORT}`);
    startBot();
});

// Endpoint para enviar mensajes
app.post('/message/sendText/:instance', async (req, res) => {
    const { number, text } = req.body;
    if (!number || !text) return res.status(400).json({ error: 'Faltan number o text' });
    if (!sock) return res.status(503).json({ error: 'WhatsApp no conectado aún' });
    try {
        const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text });
        res.json({ status: 200, response: 'enviado' });
    } catch (e) {
        console.error('Error enviando mensaje:', e.message);
        res.status(500).json({ error: e.message });
    }
});

async function startBot() {
    if (isConnecting) return;
    isConnecting = true;

    try {
        // Limpiar socket previo
        if (sock) { try { sock.end(); } catch(_) {} }

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            browser: ['Control Financiero', 'Chrome', '1.0.0'],  // Perfil de escritorio
            // ¡NO usar 'mobile: true'!
            connectTimeoutMs: 60_000,
            qrTimeout: 40_000,
        });

        sock.ev.on('connection.update', ({ qr, connection, lastDisconnect }) => {
            if (qr) {
                console.log('🟢 ***** ESCANEA ESTE CÓDIGO QR *****');
                require('qrcode-terminal').generate(qr, { small: true });
            }

            if (connection === 'open') {
                console.log('✅ Conectado a WhatsApp');
                isConnecting = false;
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log('🔌 Conexión cerrada. Motivo:', statusCode);
                if (shouldReconnect) {
                    console.log('⏳ Reintentando conexión en 5 segundos...');
                    isConnecting = false;
                    setTimeout(() => startBot(), 5000);
                } else {
                    console.log('❌ Sesión cerrada. Deberás escanear un nuevo QR.');
                    isConnecting = false;
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;
            if (WEBHOOK_URL) {
                try {
                    await fetch(WEBHOOK_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            event: 'messages.upsert',
                            data: {
                                key: msg.key,
                                message: msg.message,
                                participant: msg.key.participant,
                                remoteJid: msg.key.remoteJid
                            }
                        })
                    });
                    console.log('📩 Mensaje reenviado al webhook');
                } catch (e) {
                    console.error('Error enviando webhook:', e.message);
                }
            }
        });

    } catch (e) {
        console.error('Error fatal en startBot:', e);
        isConnecting = false;
        setTimeout(() => startBot(), 10000);
    }
}