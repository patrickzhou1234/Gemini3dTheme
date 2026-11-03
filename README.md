yeah so basically this started as a theme for the gemini interface that we use at [https://gemini.google.com](https://gemini.google.com) lol. now theres telegram themes for discord and claude too

theres 6 scripts in here now and u run them with [tampermonkey](https://www.tampermonkey.net/). tg.js, discord.js and claude.js are all for gemini so only turn on ONE of those at a time, if u run two they fight over the page and it looks cursed. discord-tg.js and claude-tg.js are for discord.com and claude.ai so they can be on at the same time as whatever

## just use tg.js its the good one fr

**tg.js is the actual theme.** it makes gemini look and work basically exactly like telegram web lol. heres what it does:

- the chat list looks like telegram, avatars + last message + real dates ("Thu", "Oct 17") and stuff, theres a search bar and the pencil button for new chats too
- the ☰ menu and settings are telegram style, all of geminis settings got shoved into telegram pages (notifications and sounds, privacy and security, general settings etc)
- header at the top says "bot" or "typing…" like a real telegram bot lmao, click it and u get a chat info panel
- messages:
  - bubbles have the little tails and real send times ("2:46 PM ✓✓"), plus the date chips
  - if u send a couple pics together they show up side by side in one bubble like telegram does
  - right click a message for reactions, reply, copy, translate, pin, forward, select n delete. double click to ❤️ it
- message box has the "☰ Auto" model button, emoji, paperclip for attachments and the round mic/send button
- other random stuff:
  - temporary chats look like telegram secret chats (green lock and everything lol)
  - if gemini is on light mode u get telegrams day theme
  - ctrl+f searches inside a chat
  - u get a notification when an answer finishes and ur on another tab

reactions, pins and hidden msgs only save in ur browser btw, they dont sync anywhere

**how to install:** open tampermonkey, hit **create a new script**, paste ALL of tg.js in there and ctrl+s. then reload gemini and ur good. colors, wallpaper, text size and more r in ☰ → Settings → General Settings (or at the top of the file if u wanna mess with it). if u wanna go back to normal gemini do ☰ → More → Switch to Gemini version, and to turn it back on use the tampermonkey menu

## discord-tg.js = discord but its telegram

this one goes on actual discord (discord.com) and makes it look like telegram

- ur DMs turn into a telegram chat list, big round avatars and the time of the last message on the right ("Thu", "Jul 25"). theres the ☰ menu and search on top and the pencil button for new group / add friend / new server
- servers still work, the channels just turn into telegram rows and the server icons on the left are like telegrams folders
- messages are bubbles now. urs are on the right in purple with ✓✓, everyone elses on the left. in servers and group chats the name shows up in color on top of the bubble like telegram groups, in normal DMs theres no names or avatars (telegram doesnt do that either)
- date chips, replies show as the little quote block in the bubble, reactions turn into telegram pills, joins/pins/calls are the grey pills in the middle
- header says "online", "last seen recently", "typing…" or the server name under the chat name
- message box is telegrams: emoji on the left, paperclip on the right and the round send button
- ☰ → Settings is a telegram settings page and every row opens the right part of discords settings. General Settings has text size, wallpaper, accent color and stuff
- right click menus are still discords (they already have reactions on top lol) they just look like telegram now

heads up: if u got softx or some other betterdiscord theme it gets turned off while this ones on, and if something collapses ur channel list it opens it back up. both can be turned off in ☰ → Settings → General Settings

## claude-tg.js = claude but its telegram

and this one goes on claude.ai

- the sidebar is the telegram chat list, avatars, last message, real times, unread badges, a pin on starred chats and the search bar
- header has the chat avatar and says "bot" or "typing…"
- ur messages are purple bubbles on the right with times and ✓✓, claudes answers are the dark ones on the left. code blocks get the telegram look too
- right click a message for reactions, reply (quotes it into the box), copy, edit, retry and good/bad response. double click to ❤️ it
- the message box is one telegram row: the purple ☰ model pill, emoji, ur text, paperclip, mic and the round send button
- new chat shows the "What can this bot do?" card with claudes greeting in it
- incognito chats get the secret chat green
- ☰ → Settings is telegram style again, the rows open claudes own settings

reactions only save in ur browser here too

**how to install these 2:** same as tg.js, new script in tampermonkey, paste discord-tg.js or claude-tg.js, save, reload discord or claude. to go back its ☰ → More → Switch to Discord version (or Switch to Claude version), turn it back on from the tampermonkey menu

## discord.js = gemini but its discord

not to be confused with discord-tg.js lol. made this one after tg.js, it turns gemini into discord (the new look with the title bar on top and the user panel in the corner)

- theres a server rail on the left and ur chats are text channels in a "Gemini" server, with the lowercase-dash-names like real discord (#plan-a-trip-to-tokyo). hit the home button at the top and the same chats turn into DMs instead
- channel header has the topic (its just ur first message lol), pins, mute, search and the member list where gemini shows up as an APP. click anyone for their profile card, u can even message gemini from it
- messages got avatars, names, "Today at 4:51 PM" times, the date lines, reactions, replies with the little curvy line, forwarding and pinning ("Pin It. Pin It Good." is in there obviously)
- hover a message for the toolbar, right click it for the whole discord menu
- ctrl+k is the quick switcher, ctrl+f searches the channel, alt + up/down jumps between channels
- bottom left is ur user panel. mic = dictation, headphones = mute the sounds, gear = full screen user settings with themes (light, ash, dark, onyx), font size, notifications, keybinds etc
- temporary chats show up as private channels that "only you can see"

## claude.js = gemini but its claude

and then this one makes gemini look like claude.ai lmao. the way claude looks right now, or the old cream + orange look if u switch Color to Warm in settings

- claude sidebar with New chat, Projects, Artifacts, Scheduled, Customize and then Starred and Recents. hover a chat and it shows when u last used it
- answers are in the serif font with the copy / read aloud / thumbs / share / Retry bar under them, ur messages are the little bubbles on the right
- new chat has the greeting ("Back at it, Patrick") with the box right under it
- the ghost button up top starts an incognito chat (its geminis temporary chat)
- ctrl+k searches ur chats, ctrl+shift+, opens settings, ctrl+. hides the sidebar
- account menu in the bottom left and claudes settings window (theme, warm or neutral, serif or sans answers, text size, chat width and more)

**how to install these 2:** same as tg.js, just paste discord.js or claude.js instead. turn off the other gemini ones in tampermonkey first. to go back to normal gemini its Leave Server / Log Out in discord.js and Log out in claude.js, all that does is switch the look back, ur chats r fine

## script.js is kinda a troll ngl

script.js was the og "3D" theme lol. it tilts every button like 45 degrees and makes the icons giant and floaty and everythings glowing neon. its funny for like a minute but dont actually use it 💀
