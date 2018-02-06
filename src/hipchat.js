var Adapter, Connector, EnterMessage, HTTPS, HipChat, LeaveMessage, TextMessage, TopicMessage, User, errmsg, inspect, promise, ref,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice,
  indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

ref = require("hubot"), Adapter = ref.Adapter, TextMessage = ref.TextMessage, EnterMessage = ref.EnterMessage, LeaveMessage = ref.LeaveMessage, TopicMessage = ref.TopicMessage, User = ref.User;

HTTPS = require("https");

inspect = require("util").inspect;

Connector = require("./connector");

promise = require("./promises");

HipChat = (function(superClass) {
  extend(HipChat, superClass);

  function HipChat(robot) {
    var reconnectTimer;
    HipChat.__super__.constructor.call(this, robot);
    this.logger = robot.logger;
    reconnectTimer = null;
  }

  HipChat.prototype.emote = function() {
    var envelope, strings;
    envelope = arguments[0], strings = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    return this.send.apply(this, [envelope].concat(slice.call(strings.map(function(str) {
      return "/me " + str;
    }))));
  };

  HipChat.prototype.send = function() {
    var envelope, i, len, results, str, strings;
    envelope = arguments[0], strings = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    results = [];
    for (i = 0, len = strings.length; i < len; i++) {
      str = strings[i];
      results.push(this.connector.message(envelope.room, str));
    }
    return results;
  };

  HipChat.prototype.topic = function(envelope, message) {
    var room, target_jid, user;
    user = envelope.user, room = envelope.room;
    if (!user) {
      user = envelope;
    }
    target_jid = (user != null ? user.reply_to : void 0) || (user != null ? user.jid : void 0) || ((user != null ? typeof user.search === "function" ? user.search(/@/) : void 0 : void 0) >= 0 ? user : room);
    if (!target_jid) {
      return this.logger.error("ERROR: Not sure who to send to: envelope=" + (inspect(envelope)));
    }
    return this.connector.topic(target_jid, message);
  };

  HipChat.prototype.reply = function() {
    var envelope, i, len, results, str, strings, user;
    envelope = arguments[0], strings = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    user = envelope.user ? envelope.user : envelope;
    results = [];
    for (i = 0, len = strings.length; i < len; i++) {
      str = strings[i];
      results.push(this.send(envelope, "@" + user.mention_name + " " + str));
    }
    return results;
  };

  HipChat.prototype.waitAndReconnect = function() {
    var delay;
    if (!this.reconnectTimer) {
      delay = Math.round(Math.random() * (20 - 5) + 5);
      this.logger.info("Waiting " + delay + "s and then retrying...");
      return this.reconnectTimer = setTimeout((function(_this) {
        return function() {
          _this.logger.info("Attempting to reconnect...");
          delete _this.reconnectTimer;
          return _this.connector.connect();
        };
      })(this), delay * 1000);
    }
  };

  HipChat.prototype.run = function() {
    var botjid, botpw, connector, firstTime, host, init;
    botjid = process.env.HUBOT_HIPCHAT_JID;
    if (!botjid) {
      throw new Error("Environment variable HUBOT_HIPCHAT_JID is required to contain your bot's user JID.");
    }
    botpw = process.env.HUBOT_HIPCHAT_PASSWORD;
    if (!botpw) {
      throw new Error("Environment variable HUBOT_HIPCHAT_PASSWORD is required to contain your bot's user password.");
    }
    this.options = {
      jid: botjid,
      password: botpw,
      token: process.env.HUBOT_HIPCHAT_TOKEN || null,
      rooms: process.env.HUBOT_HIPCHAT_ROOMS || "All",
      rooms_blacklist: process.env.HUBOT_HIPCHAT_ROOMS_BLACKLIST || "",
      rooms_join_public: process.env.HUBOT_HIPCHAT_JOIN_PUBLIC_ROOMS !== "false",
      host: process.env.HUBOT_HIPCHAT_HOST || null,
      bosh: {
        url: process.env.HUBOT_HIPCHAT_BOSH_URL || null
      },
      autojoin: process.env.HUBOT_HIPCHAT_JOIN_ROOMS_ON_INVITE !== "false",
      xmppDomain: process.env.HUBOT_HIPCHAT_XMPP_DOMAIN || null,
      reconnect: process.env.HUBOT_HIPCHAT_RECONNECT !== "false"
    };
    this.logger.debug("HipChat adapter options: " + (JSON.stringify(this.options)));
    connector = new Connector({
      jid: this.options.jid,
      password: this.options.password,
      host: this.options.host,
      logger: this.logger,
      xmppDomain: this.options.xmppDomain,
      bosh: this.options.bosh
    });
    host = this.options.host ? this.options.host : "hipchat.com";
    this.logger.info("Connecting HipChat adapter...");
    init = promise();
    connector.onTopic((function(_this) {
      return function(channel, from, message) {
        var author;
        _this.logger.info("Topic change: " + message);
        author = {
          getAuthor: function() {
            return _this.robot.brain.userForName(from) || new User(from);
          }
        };
        author.room = channel;
        return _this.receive(new TopicMessage(author, message, 'id'));
      };
    })(this));
    connector.onDisconnect((function(_this) {
      return function() {
        _this.logger.info("Disconnected from " + host);
        if (_this.options.reconnect) {
          return _this.waitAndReconnect();
        }
      };
    })(this));
    connector.onError((function(_this) {
      return function() {
        _this.logger.error([].slice.call(arguments).map(inspect).join(", "));
        if (_this.options.reconnect) {
          return _this.waitAndReconnect();
        }
      };
    })(this));
    firstTime = true;
    connector.onConnect((function(_this) {
      return function() {
        var changePresence, handleMessage, joinRoom, saveUsers;
        _this.logger.info("Connected to " + host + " as @" + connector.mention_name);
        _this.robot.name = connector.mention_name;
        if (firstTime) {
          _this.emit("connected");
          _this.logger.debug("Sending connected event");
        }
        saveUsers = function(users) {
          var i, key, len, oldUser, results, user, value;
          results = [];
          for (i = 0, len = users.length; i < len; i++) {
            user = users[i];
            user.id = _this.userIdFromJid(user.jid);
            if (user.id in _this.robot.brain.data.users) {
              oldUser = _this.robot.brain.data.users[user.id];
              for (key in oldUser) {
                value = oldUser[key];
                if (!(key in user)) {
                  user[key] = value;
                }
              }
              delete _this.robot.brain.data.users[user.id];
            }
            results.push(_this.robot.brain.userForId(user.id, user));
          }
          return results;
        };
        joinRoom = function(jid) {
          if (jid && typeof jid === "object") {
            jid = jid.local + "@" + jid.domain;
          }
          if (indexOf.call(_this.options.rooms_blacklist.split(","), jid) >= 0) {
            _this.logger.info("Not joining " + jid + " because it is blacklisted");
            return;
          }
          _this.logger.info("Joining " + jid);
          return connector.join(jid);
        };
        connector.getRoster(function(err, users, stanza) {
          if (err) {
            return init.reject(err);
          }
          return init.resolve(users);
        });
        init.done(function(users) {
          var i, len, ref1, results, room_jid;
          saveUsers(users);
          if (_this.options.rooms === "All" || _this.options.rooms === "@All") {
            return connector.getRooms(function(err, rooms, stanza) {
              var i, len, results, room;
              if (rooms) {
                results = [];
                for (i = 0, len = rooms.length; i < len; i++) {
                  room = rooms[i];
                  if (!_this.options.rooms_join_public && room.guest_url !== '') {
                    results.push(_this.logger.info("Not joining " + room.jid + " because it is a public room"));
                  } else {
                    results.push(joinRoom(room.jid));
                  }
                }
                return results;
              } else {
                return _this.logger.error("Can't list rooms: " + (errmsg(err)));
              }
            });
          } else {
            ref1 = _this.options.rooms.split(",");
            results = [];
            for (i = 0, len = ref1.length; i < len; i++) {
              room_jid = ref1[i];
              results.push(joinRoom(room_jid));
            }
            return results;
          }
        }).fail(function(err) {
          if (err) {
            return _this.logger.error("Can't list users: " + (errmsg(err)));
          }
        });
        connector.onRosterChange(function(users) {
          return saveUsers(users);
        });
        handleMessage = function(opts) {
          return init.done(function() {
            var author, getAuthor, message, room;
            getAuthor = opts.getAuthor, message = opts.message, room = opts.room;
            author = getAuthor() || {};
            author.room = room;
            return _this.receive(new TextMessage(author, message));
          });
        };
        if (firstTime) {
          connector.onMessage(function(channel, from, message) {
            var mention_name, regex;
            mention_name = connector.mention_name;
            regex = new RegExp("^@" + mention_name + "\\b", "i");
            message = message.replace(regex, mention_name + ": ");
            return handleMessage({
              getAuthor: function() {
                return _this.robot.brain.userForName(from) || new User(from);
              },
              message: message,
              room: channel
            });
          });
          connector.onPrivateMessage(function(from, message) {
            var mention_name, regex;
            mention_name = connector.mention_name;
            regex = new RegExp("^@?" + mention_name + "\\b", "i");
            message = mention_name + ": " + (message.replace(regex, ""));
            return handleMessage({
              getAuthor: function() {
                return _this.robot.brain.userForId(_this.userIdFromJid(from));
              },
              message: message,
              room: from
            });
          });
        }
        changePresence = function(PresenceMessage, user_jid, room_jid, currentName) {
          return init.done(function() {
            var user;
            user = _this.robot.brain.userForId(_this.userIdFromJid(user_jid)) || {};
            if (user) {
              user.room = room_jid;
              if (currentName.length) {
                user.name = currentName;
              }
              return _this.receive(new PresenceMessage(user));
            }
          });
        };
        if (firstTime) {
          connector.onEnter(function(user_jid, room_jid, currentName) {
            return changePresence(EnterMessage, user_jid, room_jid, currentName);
          });
          connector.onLeave(function(user_jid, room_jid) {
            return changePresence(LeaveMessage, user_jid, room_jid);
          });
          connector.onInvite(function(room_jid, from_jid, message) {
            var action;
            action = _this.options.autojoin ? "joining" : "ignoring";
            _this.logger.info("Got invite to " + room_jid + " from " + from_jid + " - " + action);
            if (_this.options.autojoin) {
              return joinRoom(room_jid);
            }
          });
        }
        return firstTime = false;
      };
    })(this));
    connector.connect();
    return this.connector = connector;
  };

  HipChat.prototype.userIdFromJid = function(jid) {
    var e;
    try {
      return jid.match(/^\d+_(\d+)@chat\./)[1];
    } catch (_error) {
      e = _error;
      return this.logger.error("Bad user JID: " + jid);
    }
  };

  HipChat.prototype.get = function(path, callback) {
    return this.request("GET", path, null, callback);
  };

  HipChat.prototype.post = function(path, body, callback) {
    return this.request("POST", path, body, callback);
  };

  HipChat.prototype.request = function(method, path, body, callback) {
    var headers, host, options, request;
    this.logger.debug("Request:", method, path, body);
    host = this.options.host || "api.hipchat.com";
    headers = {
      "Host": host
    };
    if (!this.options.token) {
      return callback("No API token provided to Hubot", null);
    }
    options = {
      agent: false,
      host: host,
      port: 443,
      path: path += "?auth_token=" + this.options.token,
      method: method,
      headers: headers
    };
    if (method === "POST") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      options.headers["Content-Length"] = body.length;
    }
    request = HTTPS.request(options, (function(_this) {
      return function(response) {
        var data;
        data = "";
        response.on("data", function(chunk) {
          return data += chunk;
        });
        response.on("end", function() {
          var err;
          if (response.statusCode >= 400) {
            _this.logger.error("HipChat API error: " + response.statusCode);
          }
          try {
            return callback(null, JSON.parse(data));
          } catch (_error) {
            err = _error;
            return callback(null, data || {});
          }
        });
        return response.on("error", function(err) {
          return callback(err, null);
        });
      };
    })(this));
    if (method === "POST") {
      request.end(body, "binary");
    } else {
      request.end();
    }
    return request.on("error", (function(_this) {
      return function(err) {
        _this.logger.error(err);
        if (err.stack) {
          _this.logger.error(err.stack);
        }
        return callback(err);
      };
    })(this));
  };

  return HipChat;

})(Adapter);

errmsg = function(err) {
  return err + (err.stack ? '\n' + err.stack : '');
};

exports.use = function(robot) {
  return new HipChat(robot);
};

// ---
// generated by coffee-script 1.9.2
