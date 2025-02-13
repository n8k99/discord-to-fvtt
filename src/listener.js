import OpCodes from './DiscordOpCodes';
import { log, MODULE_ID } from './index';

const config = {
  encoding: 'json',
  gatewayUrl: 'wss://gateway.discord.gg',
  version: 10
};

const State = {
  Closed: 'closed',
  Established: 'established',
  Open: 'open'
};

export class Listener extends EventTarget {
  #client;

  #initialState = {
    heartbeatAcknowledged: true,
    heartbeatInterval: -1,
    gatewayUrl: '',
    sessionId: '',
    seq: null,
    status: State.Closed
  };

  constructor() {
    super();

    this.acceptedChannels = game.settings.get(MODULE_ID, 'discordChannelIds');
    this.clientState = { ...this.#initialState };

    Hooks.on('getSceneControlButtons', this.addToggleControlBtn.bind(this));
  }

  set acceptedChannels(value) {
    this.acceptedChannelIds = value ? value.split(',') : [];
  }

  set token(value) {
    this.close();
    if (value) {
      this.#client = this.buildClient({ url: config.gatewayUrl, token: value });
    }
  }

  buildClient({ url, token }) {
    const ws = new WebSocket(`${url}/?v=${config.version}&encoding=${config.encoding}`);
    ws.addEventListener('open', () => {
      this.clientState = {
        ...this.#initialState,
        gatewayUrl: ws.url,
        token,
        status: State.Open
      };
    });
    ws.addEventListener('close', this.onClose.bind(this));
    ws.addEventListener('error', this.onError.bind(this));
    ws.addEventListener('message', this.onReceive.bind(this));
    return ws;
  }

  close(code = 1000, reason = '') {
    if (this.clientState.hb) clearInterval(this.clientState.hb);
    this.#client?.removeEventListener('close', this.onClose);
    this.#client?.removeEventListener('error', this.onError);
    this.#client?.removeEventListener('message', this.onReceive);
    this.#client?.close(code, reason);

    this.clientState = { ...this.#initialState };
  }

  isValidGuildChannel({ channel_id, guild_id }) {
    return (
      guild_id === game.settings.get(MODULE_ID, 'discordGuildId') &&
      (this.acceptedChannelIds.length === 0 || this.acceptedChannelIds.includes(channel_id))
    );
  }

  async _onMessageCreated(data) {
    const fvttUser = game.users.find((u) => u.getFlag(MODULE_ID, 'did') === data.author.id);

    // Map Discord channel to Polyglot language
    const channelLanguageMapping = {
      common: 'common',
      elvish: 'elvish',
      dwarvish: 'dwarvish'
    };

    const language = channelLanguageMapping[data.channel_id] || 'common';
    const encodedContent =
      language === 'common'
        ? data.content // Pass directly for #common
        : game.modules.get('polyglot').api.encode(data.content, language); // Encode for other languages

    return ChatMessage.create({
      author: fvttUser?.id,
      content: encodedContent,
      flags: {
        [MODULE_ID]: {
          managed: true,
          messageId: data.id
        }
      },
      speaker: { actor: fvttUser?.character, alias: fvttUser?.name ?? data.member.nick ?? data.author.username },
      style: 1
    });
  }

  async _onReceive({ data }) {
    const parsedData = JSON.parse(data);

    // Skip messages that are already flagged as managed
    if (parsedData.flags?.[MODULE_ID]?.managed) return;

    switch (parsedData.t) {
      case 'MESSAGE_CREATE':
        return this._onMessageCreated(parsedData.d);
      case 'MESSAGE_UPDATE':
        return this._onMessageUpdated(parsedData.d);
      case 'MESSAGE_DELETE':
        return this._onMessageDeleted(parsedData.d);
    }
  }

  async _sendToDiscord(message, language) {
    const channelMapping = {
      common: 'discord_common_channel_id', // Replace with actual channel IDs
      elvish: 'discord_elvish_channel_id',
      dwarvish: 'discord_dwarvish_channel_id'
    };

    if (language === 'common') {
      // Send directly to #common
      this.#client.send(
        JSON.stringify({
          op: 4,
          d: { channel_id: channelMapping.common, content: message.content }
        })
      );
    } else {
      // Garbled text to #common
      this.#client.send(
        JSON.stringify({
          op: 4,
          d: { channel_id: channelMapping.common, content: game.modules.get('polyglot').api.encode(message.content, 'common') }
        })
      );

      // Plain text to language-specific channel
      this.#client.send(
        JSON.stringify({
          op: 4,
          d: { channel_id: channelMapping[language], content: message.content }
        })
      );
    }
  }

  async _onMessageUpdated(data) {
    const msg = game.messages.find((m) => m.getFlag(MODULE_ID, 'messageId') === data.id);
    if (!msg) return;
    return msg.update({ content: await this._getRenderContent(data) });
  }

  async _onMessageDeleted(data) {
    const msg = game.messages.find((m) => m.getFlag(MODULE_ID, 'messageId') === data.id);
    if (!msg) return;
    return msg.delete();
  }

  async _onReceive({ data }) {
    const parsedData = JSON.parse(data);
    if (parsedData.flags?.[MODULE_ID]?.managed) return;
    switch (parsedData.t) {
      case 'MESSAGE_CREATE':
        return this._onMessageCreated(parsedData.d);
      case 'MESSAGE_UPDATE':
        return this._onMessageUpdated(parsedData.d);
      case 'MESSAGE_DELETE':
        return this._onMessageDeleted(parsedData.d);
    }
  }

  _sendHeartbeat() {
    if (this.#client && this.#client.readyState === WebSocket.OPEN) {
      if (this.clientState.status === 'ready' && !this.clientState.heartbeatAcknowledged) {
        this.close();
        this.resume();
      } else {
        this.clientState.heartbeatAcknowledged = false;
        this.#client.send(JSON.stringify({ op: OpCodes.Heartbeat, d: this.clientState.seq }));
      }
    }
  }

  _sendIdentify() {
    this.#client.send(
      JSON.stringify({
        op: OpCodes.Identify,
        d: {
          intents: (1 << 0) | (1 << 8) | (1 << 9) | (1 << 15),
          properties: {
            browser: window.navigator.userAgent,
            device: 'DiscordToFVTT'
          },
          token: this.clientState.token
        }
      })
    );
  }
}
