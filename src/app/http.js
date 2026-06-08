const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');

function createHTTPServer(app) {
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: config.IS_ELECTRON ? { origin: true } : { origin: false },
  });
  return { server, io };
}

module.exports = { createHTTPServer };
