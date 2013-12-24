"use strict";

// vendor
var express = require('express');
var http = require('http');
var app = express();
// setup helpers
var globals = require("./globals");
globals.install();

var config = require_core("server/config");
var hooks = require_core("server/hooks");

var package_json = require_core("../package.json");
var app_name = package_json.name;

// setup() fills these in
var http_server,
    https_server;


require("longjohn");
var socket = require_core("server/socket");
function setup() {
  // Better stack traces

  if (config.behind_proxy) {
    app.enable('trust proxy');
  }

  http_server = http.createServer(app);

  // Opportunity for Authorization and other stuff
  var main = require_app("main");
  hooks.set_main(main);

  // Setup an HTTPS server
  var auth = require_core("server/auth");
  https_server = auth.setup_ssl_server(app);

  http.globalAgent.maxSockets = config.max_http_sockets;

  // Add timestamps
  require("./console").install();

  hooks.call("error_handling", app, function(app) {
    // setup error handling
    //var errorHandlers = require_core("server/error_handlers");
    //app.use(errorHandlers.default);
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
  });

  // Setting up some cookie parsing goodness
  hooks.call("cookies", app, function() {
    app.use(express.cookieParser());
  });

  // This is where the persistance store is created
  hooks.call("store", app, function(app) {
    var store = require("./store");
    store.install(app);
  });

  // This is where the session is created
  hooks.call("session", app, function(app) {
    var session = require("./session");
    session.install(app);
  });

  hooks.call("app", app, function() {
  
  });

  hooks.call("compression", app, function(app) {
    app.use(express.compress());
  });

  hooks.call("cache", app, function(app) {
    // setup static helpers
    var oneDay = 1000 * 60 * 60 * 24;
    var oneYear = oneDay * 365;
    app.use(express.static('app/static', { maxAge: oneYear }));
    app.use(express.static('core/static', { maxAge: oneYear }));
  });

  hooks.call("packager", app, function() { });

  hooks.call("routes", app, function(app) {
    var routes = require('./routes');
    routes.setup(app);
  });

  hooks.call("realtime", app, http_server, function(app, http_server) {
    socket.setup_io(app, http_server);
  });

  hooks.call("marshalls", app, function() {
    require_core("server/component").install_marshalls();
    require_core("server/backbone").install_marshalls();
  });

  var when_ready = function() {
    hooks.call("http_server", http_server, function() { 
      var http_port = config.http_port;
      http_server.listen(http_port);
      http_server.on('error', try_restart(http_server, http_port));

      console.log("Listening for HTTP connections on port", http_port);
    });

    hooks.call("https_server", https_server, function() { 
      var https_port = config.https_port;
      // Setting up SSL server
      if (https_server && https_port) {
        console.log("Listening for HTTPS connections on port", https_port);
        hooks.call("realtime", app, https_server, function(app, https_server) {
          socket.setup_io(app, https_server);
        });

        https_server.listen(https_port);
        https_server.on('error', try_restart(https_server, https_port));
      }
    });
    // End SSL Server
  };

  when_ready = _.once(when_ready);
  hooks.call("ready", when_ready, function(when_ready) {
    when_ready();
  });
}

function try_restart(server, port) {
  var retries = 0;

  return function(e) {
    if (e.code === 'EADDRINUSE') {
      console.log('Port', port, 'in use, retrying...');
      setTimeout(function () {
        try { server.close(); } catch(e) {}

        if (retries > 5) {
          console.log("Couldn't listen on port", port, ", exiting.");
          process.exit();
        }

        retries += 1;
        server.listen(port);
      }, 2000);
    }
  };
}
module.exports = {
  name: app_name,
  app: app,
  run: function() {
    setup();

    
  }
};
