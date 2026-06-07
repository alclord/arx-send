const http = require('http');
const { Server } = require('socket.io');

function createHTTPServer(app) {
  const server = http.createServer(app);
  const io = new Server(server);
  return { server, io };
}

module.exports = { createHTTPServer };
