import express from 'express';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { availableParallelism } from 'node:os';
import cluster from 'node:cluster';
import { createAdapter, setupPrimary } from '@socket.io/cluster-adapter';

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

if (cluster.isPrimary) {
    const numCPUs = availableParallelism();
    // create one worker per available core
    for (let i = 0; i < numCPUs; i++) {
      cluster.fork({
        PORT: 3000 + i
      });
    }
    
    // set up the adapter on the primary thread
    setupPrimary();
} else {
    const app = express();
    const server = createServer(app);
    const io = new Server(server, {
        connectionStateRecovery: {},
        adapter: createAdapter()
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

    const port = process.env.PORT;

    server.listen(port, () => {
        console.log(`server running at http://localhost:${port}`);
    });

}