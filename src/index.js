import express from 'express';
import { createServer } from 'node:http';

const app = express();
const server = createServer(app);

app.get('/', (req, res) => {
    res.send('<h1> Hello World! </h1>')
});

app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});