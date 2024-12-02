import express from 'express';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

const db = await open({
    filename: 'chat.db',
    driver: sqlite3.Database
});

await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_offset TEXT UNIQUE,
        content TEXT,
        timestamp TEXT
    );
`);

const app = express();
const server = createServer(app);
const io = new Server(server, {
    connectionStateRecovery: {}
})

const __dirname = dirname(fileURLToPath(import.meta.url)); 

app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
});

io.on('connection', async (socket) => {
    console.log('a user connected');
    
    socket.on('chat message', async (msg, clientOffset, callback) => {
        let result;

        const timestamp = new Date().toISOString();
        try {
            result = await db.run('INSERT INTO messages (content, timestamp, client_offset) VALUES (?, ?, ?)', msg, timestamp, clientOffset);

        } catch (e) {
            if (e.errno === 19 /* SQLITE_CONSTRAINT */ ) {
                // the message was already inserted, so we notify the client
                callback();

            } else {
                return console.log(e)
            };
        }
        
        io.emit('chat message', { content: msg, timestamp }, result.lastID);
        callback();
    });

    if (!socket.recovered) {
        try {
            await db.each('SELECT id, content, timestamp FROM messages WHERE id > ?', 
                [socket.handshake.auth.serverOffset || 0],
                (_err, row) => {
                    const { content, timestamp } = row;
                    socket.emit('chat message', { content, timestamp }, row.id)
                }
            )
        } catch (error) {
            
        }
    }
});

server.listen(3000, () => {
    console.log('server running at http://localhost:3000');
});