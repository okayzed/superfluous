var context = require_core("server/context");

var config = require_core("server/config");
var useragent = require("useragent");
var app_name = require_core("server/app_name");

var geoip;
try {
  geoip = require('geoip-lite');
} catch(e) {
  console.log("NO GEOLITE DATA INSTALLED, IGNORING GEOIP DATA");

}

// {{{ SAMPLE API
// override Sample.__send to use this instrumentation to its fullest!
var Sample = function(dataset) {
  var dict = { integer: {}, set: {}, string: {} };

  var obj = {
    dataset: dataset,
    meta: {
      dataset: dataset,
    },
    integer: function(k, v) {
      dict.integer[k] = v;
      return obj;
    },
    string: function(k, v) {
      dict.string[k] = v;
      return obj;
    },
    send: function() {
      if (dict.__sent) {
        console.log("Trying to double send sample");
        return;
      }

      var copy = {};
      dict.__sent = true;
      var fields = [ "integer", "string" ];
      for (var f = 0; f < fields.length; f++) {
        var inner = dict[fields[f]];
        var keys = Object.keys(inner);
        if (dict[fields[f]] && keys.length > 0) {
          var inner_copy = {};
          for (var i = 0; i < keys.length; i++) {
            // only copy non falsey values
            if (inner[keys[i]]) {
              inner_copy[keys[i]] = inner[keys[i]];
            }
          }
          copy[fields[f]] = inner_copy;
        }
      }

      if (!copy.__ts) {
        copy.__ts = obj.__ts || obj.meta.ts;
        if (!copy.__ts) { delete copy.__ts; }
      }

      if (!copy.dataset) {
        copy.dataset = obj.dataset;
      }

      Sample.__send(copy, obj.meta);
    },
    data: dict,
  };

  return obj;
};

Sample.__send = function(s, meta) {
  console.log("Sending Sample", JSON.stringify(s), "with metadata", meta);
};

// }}} SAMPLE API


var crypto = require("crypto");
var gen_md5 = function(h) {
  var hash = crypto.Hash("md5");
  hash.update("" + h);
  return hash.digest("hex");
};

module.exports = gen_md5;
var DECO = {
  browser_info: function(s, req) {
    if (typeof req === "undefined") {
      req = context("request");
    }

    if (!req) {
      return;
    }

    // Add in UA flavors
    var userAgent = req.headers["user-agent"];
    var ua = useragent.parse(userAgent);
    var os = ua.os;

    s.string("browser_family", ua.family);
    s.string("browser_major", ua.major);
    s.string("browser_minor", ua.minor);

    s.string("os_family", os.family);

    var ip = req.ip;

    s.string("ip", gen_md5(app_name + ":" + ip));
    if (ip && geoip) {
      var geo = geoip.lookup(ip);

      if (geo) {
        s.string("country", geo.country);
        s.string("region", geo.region);
        s.string("city", geo.city);
      }



    }

    var sid = req.headers && req.headers.sid;
    if (sid) {
      var hashsid = gen_md5(app_name + ":" + sid);
      s.string("sid", hashsid);
    }

    return s;

  },
  server_info: "SERVER_INFO",
};

// Post it to the snorkel instance...
module.exports = {
  Sample: Sample,
  decorate_sample: function(s, decorations, request) {
    if (!_.isArray(decorations)) {
      if (_.isFunction(decorations)) {
        decorations = [ decorations ];
      }
    }

    _.each(decorations, function(deco) {
      deco(s, request);
    });
  },
  DECO: DECO,
  handle_json_sample: function(json_obj, request) {
    var s = new Sample();

    s.data.integer = json_obj.integer || {};
    s.data.string = json_obj.string || {};
    s.data.set = json_obj.set || {};

    // record server and client side timestamps, separately
    var ts = Date.now();
    if (s.__ts) {
      ts = +new Date(s.__ts);
      s.integer("client_time", parseInt(ts / 1000, 10));
    }

    s.integer("time", parseInt(ts / 1000, 10));

    s.dataset = json_obj.dataset;

    module.exports.decorate_sample(s, DECO.browser_info, request);


    _.each(s.data.integer, function(v, k) {
      s.data.integer[k] = parseInt(v, 10);
    });

    _.defer(function() {
      s.send();
    }, 1000);
    return s;
  },
}

function send_samples(dataset, samples) {
  var data = {
    dataset: app_name, // TODO: pull the dataset from the app name
    subset: dataset,
    samples: JSON.stringify(samples)
  };

  if (!config.analytics) {
    return;
  }

  var options = _.defaults(config.analytics, {
    hostname: 'localhost',
    port: 3000,
    path: '/data/import',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    }
  });

  if (!options.enabled) {
    return;
  }


  var http = require('http');
  if (options.https) {
    http = require('https');
  }

  var req = http.request(options, function(res) { });
  req.on('error', function(err) { });

  req.write(JSON.stringify(data));
  req.end();
}

var queue_sample_send = _.throttle(function() {
  _.each(SAMPLES, function(samples, dataset) {
    send_samples(dataset, samples);
    SAMPLES[dataset] = [];
  });

}, 10000);

var SAMPLES = {};
Sample.__send = function(sample) {
  var sample_list = SAMPLES[sample.dataset];
  if (!sample_list) {
    SAMPLES[sample.dataset] = [];
    sample_list = SAMPLES[sample.dataset];
    delete sample.dataset;
  }

  sample_list.push(sample);
  queue_sample_send();
};
