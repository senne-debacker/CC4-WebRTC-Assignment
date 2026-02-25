const express = require('express');
const app = express();

const fs = require('fs');

const options = {
  key: fs.readFileSync('localhost.key'),
  cert: fs.readFileSync('localhost.crt')
};

const server = require('https').Server(options, app);
const port = process.env.PORT || 443;

app.use(express.static('public'));

server.listen(port, () => {
    console.log(`App listening on port ${port}!`);
});