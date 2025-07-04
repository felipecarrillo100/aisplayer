'use strict';

const Stomp = require('stompjs');

class MessageProducerSTOMP {
  /**
   * @param {object} options
   * @param {string} options.relayhost - hostname or IP (e.g. 'localhost')
   * @param {string|number} options.port - TCP port number (e.g. 61613)
   * @param {string} [options.username] - username for authentication (optional)
   * @param {string} [options.password] - password for authentication (optional)
   * @param {string} [options.topicSeparator='/'] - topic separator (default '/')
   */
  constructor(options) {
    options = options || {};
    this.relayhost = options.relayhost;
    this.port = options.port;
    this.username = options.username;
    this.password = options.password;
    this.topicSeparator = options.topicSeparator || '/';

    this.stompClient = null;
    this.prospectStompClient = null;
    this.connected = false;

    this._connectionResolve = null;
    this._reconnectTimeout = null;

    // Bind callbacks
    this._onConnect = this._onConnect.bind(this);
    this._onError = this._onError.bind(this);
  }

  init() {
    return new Promise((resolve, reject) => {
      this._connectionResolve = resolve;

      // Create TCP client (not websocket)
      this.prospectStompClient = Stomp.overTCP(this.relayhost, this.port);

      // Disable debug logging
      this.prospectStompClient.debug = () => {};

      // Connect with credentials if provided
      this.prospectStompClient.connect(
        this.username || '',
        this.password || '',
        this._onConnect,
        this._onError
      );
    });
  }

  _onConnect(frame) {
    console.log('STOMP client connected');
    this.stompClient = this.prospectStompClient;
    this.connected = true;
    if (this._connectionResolve) {
      this._connectionResolve(this);
      this._connectionResolve = null;
    }
  }

  _onError(error) {
    console.error('STOMP connection error:', error);
    this.connected = false;
    this.stompClient = null;
    this.prospectStompClient = null;

    // Retry connection after 10 seconds
    if (this._reconnectTimeout) clearTimeout(this._reconnectTimeout);
    this._reconnectTimeout = setTimeout(() => {
      console.log('STOMP: Reconnecting in 10 seconds...');
      this.init();
    }, 10000);
  }

  createPath(path) {
    if (this.topicSeparator === '.') {
      // Replace / with .
      return "/topic/" + path.split('/').map((part) => {
        return part.replace(/\//g, '.');
      }).join(this.topicSeparator);
    }
    // Default no change
    return "/topic/" + path;
  }

  sendMessage(path, message) {
    if (!this.connected || !this.stompClient) {
      console.warn('STOMP client not connected, cannot send message');
      return;
    }
    const topicPath = this.createPath(path);
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    this.stompClient.send(topicPath, {}, payload);
  }

  disconnect() {
    if (this.stompClient) {
      this.stompClient.disconnect(() => {
        console.log('STOMP client disconnected');
      });
      this.connected = false;
      this.stompClient = null;
      this.prospectStompClient = null;
    }
  }
}

module.exports = MessageProducerSTOMP;
