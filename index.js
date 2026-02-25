const express = require("express");
const app = express();

const fs = require("fs");

let options = {};
let server;

if (process.env.NODE_ENV === "development") {
  options = {
    key: fs.readFileSync("localhost.key"),
    cert: fs.readFileSync("localhost.crt"),
  };
  server = require("https").Server(options, app);
} else {
  server = require("http").Server(options, app);
}

const port = process.env.PORT || 443;

app.use(express.static("public"));

server.listen(port, () => {
  console.log(`App listening on port ${port}!`);
});

const io = require("socket.io")(server);

const clients = {};
io.on("connection", (socket) => {
  clients[socket.id] = { id: socket.id };

  socket.on("disconnect", () => {
    delete clients[socket.id];
    io.emit("clients", clients);
  });

  io.emit("clients", clients);
});
