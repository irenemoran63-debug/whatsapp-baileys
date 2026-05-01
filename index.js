const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const AUTH_KEY = process.env.AUTHENTICATION_API_KEY || 'mi_clave_evolution_2024';
const WEBHOOK_URL = process.env.WEBHOOK_URL;

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR);

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['Control-Financiero', 'Chrome', '1.0.0']
    });

    sock.ev.on('connection.update', ({ qr, connection, lastDisconnect }) => {
        if (qr) {
            console.log('Escanea este QR con tu WhatsApp:');
            require('qrcode-terminal').generate(qr, { small: true });
        }
        if (connection === 'open') {
            console.log('✅ Conectado a WhatsApp');
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Reenviar mensajes entrantes al webhook del cerebro
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
                console.log('Mensaje reenviado al webhook');
            } catch (e) {
                console.error('Error enviando webhook:', e.message);
            }
        }
    });

    // Endpoint para enviar mensajes (igual que Evolution)
    app.post('/message/sendText/:instance', async (req, res) => {
        const { number, text } = req.body;
        if (!number || !text) {
            return res.status(400).json({ error: 'Faltan number o text' });
        }
        try {
            const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
            await sock.sendMessage(jid, { text });
            res.json({ status: 200, response: 'enviado' });
        } catch (e) {
            console.error('Error enviando mensaje:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    app.listen(PORT, () => {
        console.log(`🌐 API del bot escuchando en puerto ${PORT}`);
    });
}

startBot().catch(err => console.error('Error fatal:', err));