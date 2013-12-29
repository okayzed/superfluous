"use strict";

/**
 * This module deals with how templates are rendered and the functions exposed
 * to the rendering context. In general, controllers will render templates, while Components
 * have their template rendering handled for them, so this class is mostly
 * called into from the Server Controller of the currently running app.
 *
 * @class template (server)
 * @module Superfluous
 * @submodule Server
 */

var path = require("path");
var _ = require_vendor("underscore");
var context = require("./context");
var readfile = require("./readfile");
var hooks = require("./hooks");

context.setDefault("CSS_DEPS", {});
context.setDefault("JS_DEPS", {});

var load_core_template = function(template, options) {
  return load_template(template, _.default(options, { core: true }));
};

var load_template = function(template, options) {
  var root_path;
  if (options.core) {
    root_path = "core/static/templates/";
    return readfile.core(root_path + template);
  } else {
    root_path = "app/static/templates/";
    return readfile(root_path + template);
  }
};

var load_controller_template = function(controller, template, aux_paths) {
  var root_path, other_path, read;

  if (_.isString(aux_paths)) {
    aux_paths = [ aux_paths ];
  }

  aux_paths = aux_paths || [ "templates" ];
  // First try the controller's local directory
  var ret;
  _.each(aux_paths, function(aux_path) {
    if (ret) {
      return;
    }

    try {
      var to_read = path.join("app/controllers", controller, aux_path, template);
      read = readfile(to_read);
      if (read) {
        ret = read;
      }
    } catch (e) {
    }
  });

  if (ret) {
    return ret;
  }

  // Try reading inside the controllers dir for templates
  try {
    root_path = "app/static/templates/controllers/";
    other_path = path.join(root_path, template);
    read = readfile(other_path);
    if (read) {
      return read;
    }
  } catch(e) {
  }

  _.each(aux_paths, function(aux_path) {
    if (ret) {
      return;
    }

    // Maybe it's really up one level (a partial or helper?)
    try {
      root_path = "app/static/templates/";
      other_path = path.join(root_path, aux_path, template);
      read = readfile(other_path);
      if (read) {
        ret = read;
      }
    } catch(e) {
    }

  });

  if (!ret) {
    console.log("Couldn't find template data for", template);
  }

  return ret;
};

function add_stylesheet(name) {
  context("CSS_DEPS")[name] = true;
}

function add_js(name) {
  context("JS_DEPS")[name] = true;
}

function render_css_link(stylesheet) {
  var root_path = "styles/"
  return render_core_template("helpers/css_link.html.erb", {
    path: root_path + stylesheet
  });

}

function render_js_link(script) {
  var root_path = "scripts/";
  return render_core_template("helpers/js_link.html.erb", {
    path: root_path + script,
  });
}

var render_controller_template = function() {
  var args = _.toArray(arguments);
  var controller = context("controller");
  var template;
  var options = {};

  if (args.length === 1) {
    template = args[0];
  } if (args.length === 2) {
    template = args[0];
    options = args[1];
  } else if (args.length === 3) {
    controller = args[0];
    template = args[1];
    options = args[2];
  } else {
    throw new Error("Incompatible controller template render call");
  }

  return _render_controller_template(controller, template, options);
};

function _render_controller_template(controller, template, options, aux_path) {
  // Need to figure out if the template is in app/controllers/<name>/template
  // or if it is in app/static/templates/controllers/name...
  //
  // We need to do the same thing for partials, too, i guess...
  var template_data = load_controller_template(controller, template, aux_path);
  return _render_template(path.join(controller, template), template_data, options);
}

function setup_render_context(options) {
  var ret = {};
  hooks.invoke("setup_template_context", ret, function() {
    _.extend(ret, options, {
      add_stylesheet: add_stylesheet,
      add_javascript: add_js,
      ctx: context.get(),
      url_for: _.bind(context("router").build, context("router")),
      add_socket: add_socket,
      render_template: render_template,
      render_partial: render_partial,
      render_controller_template: render_controller_template,
      render_controller_partial: render_controller_partial,
      render_core: render_core_template,
      set_default: function(key, value) {
        if (typeof this[key] === "undefined") {
          this[key] = value;
        }
      }
   });
  });

  return ret;
}

var render_core_template = function(template, options) {
  return render_template(template, options, true);
};

var _compiled_templates = {};

var render_template = function(template, options, core) {
  var template_data = load_template(template, { core: core });
  return _render_template(template, template_data, options, core);
};

var _render_template = function(template, template_data, options, core) {
  var template_key = template + ":" + (core ? "core" : " app");

  if (!options) {
    options = {};
  }


  options = setup_render_context(options);

  // TODO: this should be more extensible than just adding a user
  var user = context("req").user;
  options.username = (user && user.username) || "";
  options.loggedin = !!user;
  var templateSettings = {};
  if (!_compiled_templates[template_key]) {
    try {
      _compiled_templates[template_key] = _.template(template_data);
    } catch(e) {
      console.log("Error compiling template", template, e);
    }

  }

  var template_exec = _compiled_templates[template_key];

  var template_str = "";
  try {
    template_str = template_exec(options, templateSettings);
  } catch (ee) {
    var error_msg = "Error executing template " + template + ": '" + ee + "'";
    console.log(error_msg);
    return error_msg;
  }

  return template_str;
};

var render_partial = function(template, options) {
  return render_template("partials/" + template, options);
};

var render_controller_partial = function() {
  var args = _.toArray(arguments);
  var template, 
    options=  {};
  var controller = context("controller");


  if (args.length === 1) {
    template = args[0];
  } else if (args.length === 2) {
    template = args[0];
    options = args[1];
  } else if (args.length === 3) {
    controller = args[0];
    template = args[1];
    options = args[2];
  } else {
    throw new Error("Incompatible controller template render partial call");
  }

  return _render_controller_template(
    controller,
    template,
    options, 
    ["templates/partials"]);
};

var socket_header = function(prelude_hash) {

  if (prelude_hash) {
    var ret = render_core_template("helpers/js_link.html.erb", {
      path: "/pkg/socket",
      hash: prelude_hash
    });

    if (!context("added_socket")) {
      ret += add_socket();
    }


    return ret;
  }
};

var js_header = function(prelude_hash) {
  var ret = "";
  ret += render_core_template("helpers/js_link.html.erb", {
    path: "/pkg/prelude.js",
    hash: prelude_hash
  });
  return ret;
};

var css_header = function(prelude_hash) {
  var ret = "";
  ret += render_core_template("helpers/css_link.html.erb", {
    path: "/pkg/prelude.css",
    hash: prelude_hash
  });

  return ret;
};

var add_socket = function(socket) {
  if (!socket) {
    context("added_socket", true);
  }

  return render_core_template("helpers/socket.io.html.erb", {
    name: (socket || context("controller")),
    host: context("req").headers.host
  });
};

module.exports = {
  load: load_template,
  load_core: load_core_template,
  /**
   * Renders a template into a string
   *
   * @method render
   */
  render: render_template,
  render_core: render_core_template,
  /**
   * Renders a partial into a string
   *
   * @method partial
   *
   */
  partial: render_partial,
  /**
   * Renders a controller's template into a string
   *
   * @method controller
   */
  controller: render_controller_template,
  controller_partial: render_controller_partial,
  /**
   * Adds a stylesheet to load before inserting the current template
   *
   * @method add_stylesheet
   */
  add_stylesheet: add_stylesheet,
  add_js: add_js,
  js_header: js_header,
  css_header: css_header,
  socket_header: socket_header,
  setup_context: setup_render_context
};
