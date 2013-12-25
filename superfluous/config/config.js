module.exports = {
  sockets: true,
  ssl: {
    key: "config/certs/server.key",
    certificate: "config/certs/server.crt"
  },
  udp: {
    port: 59036
  },
  authorized_users: "config/users.htpasswd",
  // setting to true will make the UDP collector and the web server run as
  // different processes, for stability reasons
  separate_services: false,
  session_secret: "keyboard cat",
  http_port: process.env.PORT || process.env.HTTP_PORT || 3300,
  https_port: process.env.HTTPS_PORT || 3443,
  max_http_sockets: 1000,
  max_https_sockets: 1000,
  require_https: true,
  backend: {
    driver: "mongo"
  }
};
