import * as ChatRenderer from './ChatRenderer';
import { Listener } from './listener';
import Polyglot from 'modules/polyglot/module.js';

export const MODULE_ID = 'discord-to-fvtt';
export const log = (message, ...args) => console.log(MODULE_ID, '|', message, ...args);

let listener;

// Map Discord channels to Polyglot languages
const languageMapping = {
  common: 'common',
  elvish: 'elvish',
  dwarvish: 'dwarvish'
};

Hooks.once('setup', () => {
  // Register game settings
  game.settings.register(MODULE_ID, 'discordGuildId', {
    name: 'Discord Server ID',
    hint: 'Enter your Discord server ID.',
    config: true,
    requiresReload: false,
    scope: 'world',
    type: String
  });

  game.settings.register(MODULE_ID, 'discordChannelIds', {
    name: 'Discord Channel IDs',
    hint: 'Enter a list of channel ID filters, separated by commas. Leave this blank to relay all accessible channels.',
    config: true,
    requiresReload: false,
    scope: 'world',
    type: String,
    onChange: (value) => (listener.acceptedChannels = value)
  });

  game.settings.register(MODULE_ID, 'discordToken', {
    name: 'Discord Token',
    hint: 'Enter your Discord bot token if you want to use your own bot.',
    config: true,
    requiresReload: false,
    scope: 'world',
    type: String,
    onChange: (value) => (listener.token = value)
  });

  ChatRenderer.setup().catch((err) => console.error(MODULE_ID, { error: err }));
  listener = new Listener();
});

// Bi-directional communication logic
Hooks.once('ready', () => {
  if (!game.users.activeGM.isSelf) return;

  // Set listener token
  listener.token = game.settings.get(MODULE_ID, 'discordToken');

  // Handle Discord -> FoundryVTT
  listener.onMessage((discordMessage) => {
    const { channel_id, content, author } = discordMessage;

    const polyglotLanguage = Object.keys(languageMapping).find(
      (key) => channel_id === game.settings.get(MODULE_ID, key)
    );

    if (polyglotLanguage) {
      const encodedMessage = polyglotLanguage === 'common' 
        ? content 
        : Polyglot.encode(content, polyglotLanguage);

      ChatMessage.create({
        content: encodedMessage,
        speaker: { alias: author.username },
        flags: { [MODULE_ID]: { discordChannel: channel_id } }
      });
    }
  });

  // Handle FoundryVTT -> Discord
  Hooks.on('createChatMessage', async (message) => {
    const language = message.getFlag('polyglot', 'language');
    const content = message.content;

    // Check if the language is Common
    if (language === 'common') {
      listener.sendToDiscord({
        channel: game.settings.get(MODULE_ID, 'common'),
        content
      });
      return;
    }

    // For other languages, garble in #common and send plain to specific channel
    const commonChannelId = game.settings.get(MODULE_ID, 'common');
    const languageChannelId = game.settings.get(MODULE_ID, language);

    if (commonChannelId) {
      listener.sendToDiscord({
        channel: commonChannelId,
        content: Polyglot.encode(content, 'common') // Garbled
      });
    }

    if (languageChannelId) {
      listener.sendToDiscord({
        channel: languageChannelId,
        content // Plain text
      });
    }
  });
});

export const Listener = {
  onMessage(callback) {
    // Listen for Discord WebSocket messages
    listener.#client.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      callback(message);
    });
  },
  sendToDiscord({ channel, content }) {
    listener.#client.send(
      JSON.stringify({
        op: 4, // Discord MESSAGE_CREATE operation
        d: {
          channel_id: channel,
          content
        }
      })
    );
  }
};
