const express = require('express');
const app = express();
const server = require('http').Server(app);
const port = process.env.PORT || 80;

app.use(express.static('public'));

server.listen(port, () => {
    console.log(`App listening on port ${port}!`);
});