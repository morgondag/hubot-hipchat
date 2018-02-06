var Connector, EventEmitter, bind, fs, getChild, getInt, getText, isRegExp, isString, onClose, onOffline, onOnline, onStanza, onStreamError, pkg, ref, usersFromStanza, xmpp,
  bind1 = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

EventEmitter = require("events").EventEmitter;

fs = require("fs");

ref = require("underscore"), bind = ref.bind, isString = ref.isString, isRegExp = ref.isRegExp;

xmpp = require('node-xmpp-client');

pkg = (function() {
  var data;
  data = fs.readFileSync(__dirname + "/../package.json", "utf8");
  return JSON.parse(data);
})();

module.exports = Connector = (function(superClass) {
  var onMessageFor;

  extend(Connector, superClass);

  function Connector(options) {
    var jid;
    if (options == null) {
      options = {};
    }
    this.disconnect = bind1(this.disconnect, this);
    this.once("connect", (function() {}));
    this.setMaxListeners(0);
    this.jabber = null;
    this.keepalive = null;
    this.name = null;
    this.plugins = {};
    this.iq_count = 1;
    this.logger = options.logger;
    jid = new xmpp.JID(options.jid);
    if (!jid.resource) {
      jid.resource = "hubot-hipchat";
    }
    this.jid = jid.toString();
    this.password = options.password;
    this.host = options.host;
    this.caps_ver = options.caps_ver || ("hubot-hipchat:" + pkg.version);
    this.xmppDomain = options.xmppDomain;
    this.bosh = options.bosh;
    this.mucDomain = "conf." + (this.xmppDomain ? this.xmppDomain : 'hipchat.com');
    this.onError(this.disconnect);
  }

  Connector.prototype.connect = function() {
    this.jabber = new xmpp.Client({
      jid: this.jid,
      password: this.password,
      host: this.host,
      bosh: this.bosh
    });
    this.jabber.on("error", bind(onStreamError, this));
    this.jabber.on("online", bind(onOnline, this));
    this.jabber.on("stanza", bind(onStanza, this));
    this.jabber.on("offline", bind(onOffline, this));
    this.jabber.on("close", bind(onClose, this));
    return (function(_this) {
      return function() {
        var _send;
        _this.jabber.on("data", function(buffer) {
          return _this.logger.debug("  IN > %s", buffer.toString());
        });
        _send = _this.jabber.send;
        return _this.jabber.send = function(stanza) {
          _this.logger.debug(" OUT > %s", stanza);
          return _send.call(_this.jabber, stanza);
        };
      };
    })(this)();
  };

  Connector.prototype.disconnect = function() {
    this.logger.debug('Disconnecting here');
    if (this.keepalive) {
      clearInterval(this.keepalive);
      delete this.keepalive;
    }
    this.jabber.end();
    return this.emit("disconnect");
  };

  Connector.prototype.getProfile = function(callback) {
    var stanza;
    stanza = new xmpp.Element("iq", {
      type: "get"
    }).c("vCard", {
      xmlns: "vcard-temp"
    });
    return this.sendIq(stanza, function(err, res) {
      var data, field, i, len, ref1;
      data = {};
      if (!err) {
        ref1 = res.getChild("vCard").children;
        for (i = 0, len = ref1.length; i < len; i++) {
          field = ref1[i];
          data[field.name.toLowerCase()] = field.getText();
        }
      }
      return callback(err, data, res);
    });
  };

  Connector.prototype.getRooms = function(callback) {
    var iq;
    iq = new xmpp.Element("iq", {
      to: this.mucDomain,
      type: "get"
    }).c("query", {
      xmlns: "http://jabber.org/protocol/disco#items"
    });
    return this.sendIq(iq, function(err, stanza) {
      var rooms;
      rooms = err ? [] : stanza.getChild("query").getChildren("item").map(function(el) {
        var x;
        x = el.getChild("x", "http://hipchat.com/protocol/muc#room");
        return {
          jid: el.attrs.jid.trim(),
          name: el.attrs.name,
          id: getInt(x, "id"),
          topic: getText(x, "topic"),
          privacy: getText(x, "privacy"),
          owner: getText(x, "owner"),
          guest_url: getText(x, "guest_url"),
          is_archived: !!getChild(x, "is_archived")
        };
      });
      return callback(err, rooms || [], stanza);
    });
  };

  Connector.prototype.getRoster = function(callback) {
    var iq;
    iq = new xmpp.Element("iq", {
      type: "get"
    }).c("query", {
      xmlns: "jabber:iq:roster"
    });
    return this.sendIq(iq, function(err, stanza) {
      var items;
      items = err ? [] : usersFromStanza(stanza);
      return callback(err, items || [], stanza);
    });
  };

  Connector.prototype.setAvailability = function(availability, status) {
    var packet;
    packet = new xmpp.Element("presence", {
      type: "available"
    });
    packet.c("show").t(availability);
    if (status) {
      packet.c("status").t(status);
    }
    packet.c("c", {
      xmlns: "http://jabber.org/protocol/caps",
      node: "http://hipchat.com/client/bot",
      ver: this.caps_ver
    });
    return this.jabber.send(packet);
  };

  Connector.prototype.join = function(roomJid, historyStanzas) {
    var packet;
    if (!historyStanzas) {
      historyStanzas = 0;
    }
    packet = new xmpp.Element("presence", {
      to: roomJid + "/" + this.name
    });
    packet.c("x", {
      xmlns: "http://jabber.org/protocol/muc"
    });
    packet.c("history", {
      xmlns: "http://jabber.org/protocol/muc",
      maxstanzas: String(historyStanzas)
    });
    return this.jabber.send(packet);
  };

  Connector.prototype.part = function(roomJid) {
    var packet;
    packet = new xmpp.Element('presence', {
      type: 'unavailable',
      to: roomJid + "/" + this.name
    });
    packet.c('x', {
      xmlns: 'http://jabber.org/protocol/muc'
    });
    packet.c('status').t('hc-leave');
    return this.jabber.send(packet);
  };

  Connector.prototype.message = function(targetJid, message) {
    var packet, parsedJid;
    parsedJid = new xmpp.JID(targetJid);
    if (parsedJid.domain === this.mucDomain) {
      packet = new xmpp.Element("message", {
        to: targetJid + "/" + this.name,
        type: "groupchat"
      });
    } else {
      packet = new xmpp.Element("message", {
        to: targetJid,
        type: "chat",
        from: this.jid
      });
      packet.c("inactive", {
        xmlns: "http://jabber/protocol/chatstates"
      });
    }
    message = message.replace(/\x1B\[([0-9]{1,2}(;[0-9]{1,2})?)?[mGK]/g, "");
    this.logger.debug('building message');
    this.logger.debug(message);
    packet.c("body").t(message);
    return this.jabber.send(packet);
  };

  Connector.prototype.topic = function(targetJid, message) {
    var packet, parsedJid;
    parsedJid = new xmpp.JID(targetJid);
    packet = new xmpp.Element("message", {
      to: targetJid + "/" + this.name,
      type: "groupchat"
    });
    packet.c("subject").t(message);
    return this.jabber.send(packet);
  };

  Connector.prototype.sendIq = function(stanza, callback) {
    var id;
    stanza = stanza.root();
    id = this.iq_count++;
    stanza.attrs.id = id;
    this.once("iq:" + id, callback);
    return this.jabber.send(stanza);
  };

  Connector.prototype.loadPlugin = function(identifier, plugin, options) {
    if (typeof plugin !== "object") {
      throw new Error("Plugin argument must be an object");
    }
    if (typeof plugin.load !== "function") {
      throw new Error("Plugin object must have a load function");
    }
    this.plugins[identifier] = plugin;
    plugin.load(this, options);
    return true;
  };

  Connector.prototype.onConnect = function(callback) {
    return this.on("connect", callback);
  };

  Connector.prototype.onDisconnect = function(callback) {
    return this.on("disconnect", callback);
  };

  Connector.prototype.onInvite = function(callback) {
    return this.on("invite", callback);
  };

  onMessageFor = function(name) {
    return function(condition, callback) {
      if (!callback) {
        callback = condition;
        condition = null;
      }
      return this.on(name, function() {
        var args, match, message;
        message = arguments[arguments.length - 1];
        if (!condition || message === condition) {
          return callback.apply(this, arguments);
        } else if (isRegExp(condition)) {
          match = message.match(condition);
          if (!match) {
            return;
          }
          args = [].slice.call(arguments);
          args.push(match);
          return callback.apply(this, args);
        }
      });
    };
  };

  Connector.prototype.onMessage = onMessageFor("message");

  Connector.prototype.onPrivateMessage = onMessageFor("privateMessage");

  Connector.prototype.onTopic = function(callback) {
    return this.on("topic", callback);
  };

  Connector.prototype.onEnter = function(callback) {
    return this.on("enter", callback);
  };

  Connector.prototype.onLeave = function(callback) {
    return this.on("leave", callback);
  };

  Connector.prototype.onRosterChange = function(callback) {
    return this.on("rosterChange", callback);
  };

  Connector.prototype.onPing = function(callback) {
    return this.on("ping", callback);
  };

  Connector.prototype.onError = function(callback) {
    return this.on("error", callback);
  };

  return Connector;

})(EventEmitter);

onStreamError = function(err) {
  var condition, text;
  if (err instanceof xmpp.Element) {
    condition = err.children[0].name;
    text = err.getChildText("text");
    if (!text) {
      text = "No error text sent by HipChat, see http://xmpp.org/rfcs/rfc6120.html#streams-error-conditions for error condition descriptions.";
    }
    return this.emit("error", condition, text, err);
  } else {
    return this.emit("error", null, null, err);
  }
};

onOnline = function() {
  var ping;
  this.setAvailability("chat");
  ping = (function(_this) {
    return function() {
      _this.jabber.send(new xmpp.Element('r'));
      return _this.emit("ping");
    };
  })(this);
  this.keepalive = setInterval(ping, 30000);
  return this.getProfile((function(_this) {
    return function(err, data) {
      if (err) {
        return _this.emit("error", null, "Unable to get profile info: " + err, null);
      } else {
        _this.name = data.fn;
        _this.mention_name = data.nickname;
        return _this.emit("connect");
      }
    };
  })(this));
};

onStanza = function(stanza) {
  var body, condition, entity, error_elem, event_id, from, fromChannel, fromJid, fromNick, invite, inviteRoom, inviteSender, jid, name, reason, ref1, room, subject, type, users, x;
  this.emit("data", stanza);
  if (stanza.is("message")) {
    if (stanza.attrs.type === "groupchat") {
      if (stanza.getChild("delay")) {
        return;
      }
      fromJid = new xmpp.JID(stanza.attrs.from);
      fromChannel = fromJid.bare().toString();
      fromNick = fromJid.resource;
      if (fromNick === this.name) {
        return;
      }
      body = stanza.getChildText("body");
      subject = stanza.getChildText("subject");
      if (body) {
        return this.emit("message", fromChannel, fromNick, body);
      } else if (subject) {
        return this.emit("topic", fromChannel, fromNick, subject);
      } else {

      }
    } else if (stanza.attrs.type === "chat") {
      body = stanza.getChildText("body");
      if (!body) {
        return;
      }
      if (stanza.getChild("delay")) {
        return;
      }
      fromJid = new xmpp.JID(stanza.attrs.from);
      return this.emit("privateMessage", fromJid.bare().toString(), body);
    } else if (!stanza.attrs.type) {
      x = stanza.getChild("x", "http://jabber.org/protocol/muc#user");
      if (!x) {
        return;
      }
      invite = x.getChild("invite");
      if (!invite) {
        return;
      }
      reason = invite.getChildText("reason");
      inviteRoom = new xmpp.JID(stanza.attrs.from);
      inviteSender = new xmpp.JID(invite.attrs.from);
      return this.emit("invite", inviteRoom.bare(), inviteSender.bare(), reason);
    }
  } else if (stanza.is("iq")) {
    event_id = "iq:" + stanza.attrs.id;
    if (stanza.attrs.type === "result") {
      return this.emit(event_id, null, stanza);
    } else if (stanza.attrs.type === "set") {
      if (stanza.getChild("query").attrs.xmlns === "jabber:iq:roster") {
        users = usersFromStanza(stanza);
        return this.emit("rosterChange", users, stanza);
      }
    } else {
      condition = "unknown";
      error_elem = stanza.getChild("error");
      if (error_elem) {
        condition = error_elem.children[0].name;
      }
      return this.emit(event_id, condition, stanza);
    }
  } else if (stanza.is("presence")) {
    jid = new xmpp.JID(stanza.attrs.from);
    room = jid.bare().toString();
    if (!room) {
      return;
    }
    name = stanza.attrs.from.split("/")[1];
    if (name == null) {
      name = "";
    }
    type = stanza.attrs.type || "available";
    x = stanza.getChild("x", "http://jabber.org/protocol/muc#user");
    if (!x) {
      return;
    }
    entity = x.getChild("item");
    if (!entity) {
      return;
    }
    from = (ref1 = entity.attrs) != null ? ref1.jid : void 0;
    if (!from) {
      return;
    }
    if (type === "unavailable") {
      return this.emit("leave", from, room, name);
    } else if (type === "available" && entity.attrs.role === "participant") {
      return this.emit("enter", from, room, name);
    }
  }
};

onOffline = function() {
  return this.logger.info('Connection went offline');
};

onClose = function() {
  this.logger.info('Connection was closed');
  return this.disconnect();
};

usersFromStanza = function(stanza) {
  return stanza.getChild("query").getChildren("item").map(function(el) {
    return {
      jid: el.attrs.jid,
      name: el.attrs.name,
      mention_name: el.attrs.mention_name,
      email_address: el.attrs.email
    };
  });
};

getChild = function(el, name) {
  return el.getChild(name);
};

getText = function(el, name) {
  return getChild(el, name).getText();
};

getInt = function(el, name) {
  return parseInt(getText(el, name), 10);
};

// ---
// generated by coffee-script 1.9.2
