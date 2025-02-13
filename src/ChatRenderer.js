export async function setup() {
  Hooks.on('renderChatMessage', async (message, html, speaker) => {
    // Ensure this is a Discord message
    if (!message.content.includes('d2fvtt-message')) return;

    const language = message.getFlag('polyglot', 'language') || 'common';
    const channelName = html.find('.d2fvtt-message').attr('data-discord-channel');

    // Add a Discord icon with language info in the tooltip
    const el = document.createElement('i');
    el.classList.add('fa-brands', 'fa-discord');
    el.title = `Discord Channel: ${channelName} | Language: ${language}`;

    html
      .find('header.message-header')
      .first()
      .prepend(el);
  });

  // Update all existing messages with proper flags or rendering adjustments
  await Promise.all(
    game.messages.map(async (message) => {
      if (message.content.includes('d2fvtt-message')) {
        // Update message to ensure proper Polyglot encoding or metadata
        const language = message.getFlag('polyglot', 'language') || 'common';
        if (!message.flags[MODULE_ID]?.language) {
          await message.update({
            flags: {
              [MODULE_ID]: {
                language
              }
            }
          });
        }
      }
    })
  );
}
