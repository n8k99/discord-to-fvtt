import * as ChatRenderer from './ChatRenderer';
import { Listener } from './listener';
import Polyglot from 'modules/polyglot/module.js';

export const MODULE_ID = 'discord-to-fvtt';
export const log = (message, ...args) => console.log(MODULE_ID, '|', message, ...args);

let listener;

Hooks.once('setup', () => {
  // Register settings for Discord integration
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
    hint: 'Enter a list of channel ID filters, separated by commas. Leave blank to relay all accessible channels.',
    config: true,
    requiresReload: false,
    scope: 'world',
    type: String,
    onChange: (value) => (listener.acceptedChannels = value)
  });

  game.settings.register(MODULE_ID, 'discordToken', {
    name: 'Discord Token',
    hint: 'Enter your Discord bot token for connecting to Discord.',
    config: true,
    requiresReload: false,
    scope: 'world',
    type: String,
    onChange: (value) => (listener.token = value)
  });

  game.settings.register(MODULE_ID, 'discordToPolyglotMapping', {
    name: 'Discord to Polyglot Mapping',
    hint: 'Map Discord channels to Polyglot languages (e.g., {"common": "common", "elvish": "elvish"}).',
    scope: 'world',
    config: true,
    type: Object,
    default: { common: 'common', elvish: 'elvish', dwarvish: 'dwarvish' }
  });

  game.settings.register(MODULE_ID, 'outgoingMessageBehavior', {
    name: 'Outgoing Message Behavior',
    hint: 'Define how messages are sent to Discord (#common garbled vs plain text for specific channels).',
    scope: 'world',
    config: true,
    type: Object,
    default: {
      garbleInCommon: true,
      sendPlainToLanguageChannel: true
    }
  });

  log('Settings registered successfully.');

  ChatRenderer.setup().catch((err) => console.error(MODULE_ID, { error: err }));
  listener = new Listener();
});

Hooks.once('ready', () => {
  if (!game.users.activeGM.isSelf) return;

  // Assign listener token
  listener.token = game.settings.get(MODULE_ID, 'discordToken');

  // Handle Discord → FoundryVTT messages
  listener.onMessage(async (discordMessage) => {
    const { channel_id, content, author } = discordMessage;
    const languageMapping = game.settings.get(MODULE_ID, 'discordToPolyglotMapping');
    const polyglotLanguage = Object.keys(languageMapping).find((key) => channel_id === key);

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

  // Handle FoundryVTT → Discord messages
  Hooks.on('createChatMessage', async (message) => {
    const language = message.getFlag('polyglot', 'language');
    const content = message.content;
    const behavior = game.settings.get(MODULE_ID, 'outgoingMessageBehavior');
    const languageMapping = game.settings.get(MODULE_ID, 'discordToPolyglotMapping');

    // Send messages in Common to Discord #common
    if (language === 'common') {
      listener.sendToDiscord({
        channel: languageMapping.common,
        content
      });
      return;
    }

    // Handle other languages: garbled to #common, plain text to language-specific channels
    if (behavior.garbleInCommon) {
      listener.sendToDiscord({
        channel: languageMapping.common,
        content: Polyglot.encode(content, 'common') // Garbled message for #common
      });
    }

    if (behavior.sendPlainToLanguageChannel) {
      const targetChannel = Object.keys(languageMapping).find((key) => languageMapping[key] === language);
      if (targetChannel) {
        listener.sendToDiscord({
          channel: targetChannel,
          content // Plain text for language-specific channels
        });
      }
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
